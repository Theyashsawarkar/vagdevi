import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newPairingCode } from "../src/auth.js";
import { baseForms, lookup, parseDataLine } from "../src/dictionary.js";
import { idOf } from "../src/library.js";
import { type AppRouter, makeServer } from "../src/server.js";

const home = mkdtempSync(join(tmpdir(), "vagdevi-"));
process.env.VAGDEVI_HOME = join(home, "state");
const books = join(home, "books");
const secret = join(home, "secret");
mkdirSync(join(books, "novels"), { recursive: true });
mkdirSync(secret);
writeFileSync(join(books, "novels", "the-long-road.md"), "# The Long Road\n\nOnce upon a time.");
writeFileSync(join(books, "photo.png"), "not really a png");
writeFileSync(join(books, "notes.txt"), "not a book");
writeFileSync(join(secret, "passwords.md"), "secret");
symlinkSync(join(secret, "passwords.md"), join(books, "link.md"));

let base = "";
let opened: [string, number] | null = null;
const server = makeServer({ folders: [books], openOnLaptop: (p, n) => (opened = [p, n]) });
const client = (token?: string) =>
  createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${base}/trpc`, headers: () => (token ? { authorization: `Bearer ${token}` } : {}) })],
  });

let token = "";
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  token = (await client().pair.mutate({ code: newPairingCode(), name: "test phone" })).token;
});
afterAll(() => void server.close());

const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers: { authorization: `Bearer ${token}`, ...headers } });

describe("pairing", () => {
  it("a code works once", async () => {
    const code = newPairingCode();
    await client().pair.mutate({ code, name: "a" });
    await expect(client().pair.mutate({ code, name: "b" })).rejects.toThrow(/wrong or has expired/);
  });
  it("a wrong code is refused", async () => {
    newPairingCode();
    await expect(client().pair.mutate({ code: "guess", name: "x" })).rejects.toThrow();
  });
});

describe("only a paired phone gets in", () => {
  it("refuses the library without a token", async () => {
    await expect(client().library.query()).rejects.toThrow(/isn't paired/);
    await expect(client("wrong").library.query()).rejects.toThrow(/isn't paired/);
  });
  it("refuses files without a token", async () => {
    const id = idOf(join(books, "novels", "the-long-road.md"));
    expect((await fetch(`${base}/files/${id}`)).status).toBe(401);
    expect((await fetch(`${base}/dictionary.db`)).status).toBe(401);
  });
});

describe("the library", () => {
  it("lists books in the shared folders, and nothing else", async () => {
    const items = await client(token).library.query();
    expect(items.map((i) => i.name).sort()).toEqual(["photo.png", "the-long-road.md"]);
    expect(items.find((i) => i.kind === "markdown")).toMatchObject({ title: "the long road", folder: "novels" });
  });
  it("never tells the phone a path on this disk", async () => {
    expect(JSON.stringify(await client(token).library.query())).not.toContain(home);
  });
  it("doesn't follow a link out of the shared folders", async () => {
    const items = await client(token).library.query();
    expect(items.some((i) => i.name === "link.md")).toBe(false);
    expect((await get(`/files/${idOf(join(secret, "passwords.md"))}`)).status).toBe(404);
  });
  it("can't be tricked by a path instead of an id", async () => {
    expect((await get("/files/..%2F..%2Fsecret%2Fpasswords.md")).status).toBe(404);
    expect((await get(`/files/${join(secret, "passwords.md")}`)).status).toBe(404);
  });
});

describe("downloads", () => {
  const id = idOf(join(books, "novels", "the-long-road.md"));
  it("sends the file", async () => {
    const r = await get(`/files/${id}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Once upon a time");
  });
  it("resumes from where it stopped", async () => {
    const r = await get(`/files/${id}`, { range: "bytes=2-" });
    expect(r.status).toBe(206);
    expect(await r.text()).toMatch(/^The Long Road/);
    expect(r.headers.get("content-range")).toMatch(/^bytes 2-\d+\/\d+$/);
  });
  it("refuses a range past the end", async () => {
    expect((await get(`/files/${id}`, { range: "bytes=99999-" })).status).toBe(416);
  });
});

describe("reading progress", () => {
  it("keeps the newest, whatever order it arrives in", async () => {
    const c = client(token);
    await c.putProgress.mutate({ id: "b1", page: 10, total: 100, updatedAt: 2000 });
    const kept = await c.putProgress.mutate({ id: "b1", page: 3, total: 100, updatedAt: 1000 });
    expect(kept.page).toBe(10);
    expect((await c.putProgress.mutate({ id: "b1", page: 11, total: 100, updatedAt: 3000 })).page).toBe(11);
  });
});

describe("open on laptop", () => {
  it("opens the real file by id", async () => {
    await client(token).openOnLaptop.mutate({ id: idOf(join(books, "novels", "the-long-road.md")), page: 4 });
    expect(opened).toEqual([join(books, "novels", "the-long-road.md"), 4]);
  });
  it("refuses an id it doesn't know", async () => {
    await expect(client(token).openOnLaptop.mutate({ id: "nope", page: 1 })).rejects.toThrow(/no longer/);
  });
});

describe("the dictionary", () => {
  it("parses a WordNet line", () => {
    const got = parseDataLine('00001740 03 n 02 entity 0 thing 1 000 | that which is perceived; "an example"');
    expect(got?.words).toEqual(["entity", "thing"]);
    expect(got?.sense).toMatchObject({ pos: "noun", gloss: "that which is perceived", examples: ["an example"] });
  });
  it("finds base forms", () => {
    expect(baseForms("running")).toContain("run");
    expect(baseForms("berries")).toContain("berry");
  });
  it("defines words, also bent ones and with punctuation", () => {
    expect(lookup("book")?.senses.length).toBeGreaterThan(1);
    expect(lookup("running,")?.word).toBe("running");
    expect(lookup("went")?.word).toBe("go");
    expect(lookup("berries")?.word).toBe("berry");
    expect(lookup("zzqqx")).toBeNull();
  });
}, 120_000);
