import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { initTRPC, TRPCError } from "@trpc/server";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { z } from "zod";
import { allowAttempt, claim, type Device, verify } from "./auth.js";
import { buildDictionary, lookup } from "./dictionary.js";
import { cover, type Item, MIME, publicItem, scan } from "./library.js";
import { allProgress, putProgress } from "./progress.js";

export type Ctx = { device: Device | null; ip: string };

const t = initTRPC.context<Ctx>().create();
const authed = t.procedure.use(({ ctx, next }) => {
  if (!ctx.device) throw new TRPCError({ code: "UNAUTHORIZED", message: "This phone isn't paired" });
  return next({ ctx: { ...ctx, device: ctx.device } });
});

export type Options = {
  folders: string[];
  /** How "Open on laptop" shows a file; darshan by default. */
  openOnLaptop?: (path: string, page: number) => void;
};

const darshan = (path: string, page: number) => {
  const c = spawn("darshan", ["open", path, "-p", String(page)], { stdio: "ignore", detached: true });
  c.on("error", () => undefined);
  c.unref();
};

export const makeRouter = (opt: Options) => {
  let items: Item[] = [];
  let scannedAt = 0;
  const library = async () => {
    if (Date.now() - scannedAt > 15_000) {
      items = await scan(opt.folders);
      scannedAt = Date.now();
    }
    return items;
  };
  const find = async (id: string) => (await library()).find((i) => i.id === id);

  const router = t.router({
    ping: t.procedure.query(({ ctx }) => ({ ok: true, paired: !!ctx.device })),
    pair: t.procedure.input(z.object({ code: z.string().max(100), name: z.string().max(60) })).mutation(({ input, ctx }) => {
      if (!allowAttempt(ctx.ip)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many tries: wait a minute" });
      const got = claim(input.code, input.name);
      if (!got) throw new TRPCError({ code: "FORBIDDEN", message: "That code is wrong or has expired: run pustak pair again" });
      return got;
    }),
    library: authed.query(async () => {
      const progress = allProgress();
      return (await library()).map((i) => ({ ...publicItem(i), progress: progress[i.id] ?? null }));
    }),
    putProgress: authed
      .input(z.object({ id: z.string().max(64), page: z.number().int().min(0), total: z.number().int().min(0), updatedAt: z.number() }))
      .mutation(({ input: { id, ...p } }) => putProgress(id, p)),
    define: authed.input(z.object({ word: z.string().max(80) })).query(({ input }) => lookup(input.word)),
    openOnLaptop: authed.input(z.object({ id: z.string().max(64), page: z.number().int().min(1) })).mutation(async ({ input }) => {
      const item = await find(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "That book is no longer on the laptop" });
      (opt.openOnLaptop ?? darshan)(item.path, input.page);
      return { ok: true };
    }),
  });
  return { router, find };
};

export type AppRouter = ReturnType<typeof makeRouter>["router"];

const bearer = (req: IncomingMessage) => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
};

/** Sends a file, honouring Range so an interrupted download can resume. */
const sendFile = (req: IncomingMessage, res: ServerResponse, path: string, mime: string) => {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    res.writeHead(404).end();
    return;
  }
  const common = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...common, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...common, "Content-Length": size });
  createReadStream(path).pipe(res);
};

export const makeServer = (opt: Options): Server => {
  const { router, find } = makeRouter(opt);
  const trpc = createHTTPHandler({
    router,
    basePath: "/trpc/",
    createContext: ({ req }) => ({ device: verify(bearer(req)), ip: req.socket.remoteAddress ?? "" }),
  });
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/trpc/")) {
      trpc(req, res);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (!verify(bearer(req))) {
      res.writeHead(401).end();
      return;
    }
    void (async () => {
      const file = /^\/files\/([0-9a-f]{24})$/.exec(url.pathname);
      if (file) {
        const item = await find(file[1] as string);
        if (!item) return void res.writeHead(404).end();
        return sendFile(req, res, item.path, MIME[extname(item.path).toLowerCase()] ?? "application/octet-stream");
      }
      const thumb = /^\/covers\/([0-9a-f]{24})$/.exec(url.pathname);
      if (thumb) {
        const item = await find(thumb[1] as string);
        const c = item && (await cover(item));
        if (!c) return void res.writeHead(404).end();
        return sendFile(req, res, c, MIME[extname(c).toLowerCase()] ?? "image/png");
      }
      if (url.pathname === "/dictionary.db") return sendFile(req, res, buildDictionary(), "application/vnd.sqlite3");
      res.writeHead(404).end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
};
