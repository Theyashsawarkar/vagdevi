import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { ensure, paths } from "./config.js";

const run = promisify(execFile);

export type Kind = "pdf" | "epub" | "image" | "markdown";

const KINDS: Record<string, Kind> = {
  ".pdf": "pdf",
  ".epub": "epub",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".md": "markdown",
  ".markdown": "markdown",
};

export const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
};

export type Item = {
  id: string;
  title: string;
  name: string;
  kind: Kind;
  size: number;
  mtime: number;
  pages: number;
  folder: string;
  path: string;
};

/** What the phone sees: never the path on this disk. */
export type PublicItem = Omit<Item, "path">;
export const publicItem = ({ path: _path, ...rest }: Item): PublicItem => rest;

export const idOf = (path: string) => createHash("sha256").update(path).digest("hex").slice(0, 24);

const SKIP = new Set(["node_modules", "__pycache__", "venv", "target", "dist", "build"]);

type Meta = { stamp: string; title: string; pages: number };

/** PDF titles and page counts, kept so a rescan needn't ask pdfinfo again. */
const metaFile = () => join(ensure(paths().cache), "meta.json");
const loadMeta = (): Record<string, Meta> => {
  try {
    return JSON.parse(readFileSync(metaFile(), "utf8"));
  } catch {
    return {};
  }
};

const tidy = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const pdfMeta = async (path: string): Promise<{ title: string; pages: number }> => {
  try {
    const { stdout } = await run("pdfinfo", [path], { timeout: 15000 });
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 1);
    const title = /^Title:\s+(.+)$/m.exec(stdout)?.[1]?.trim() ?? "";
    return { title, pages };
  } catch {
    return { title: "", pages: 1 };
  }
};

function* walk(dir: string): Generator<string> {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    // links could lead out of the shared folders: they aren't followed
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && KINDS[extname(e.name).toLowerCase()]) yield p;
  }
}

/** Every book in the shared folders. */
export const scan = async (folders: string[]): Promise<Item[]> => {
  const meta = loadMeta();
  const items: Item[] = [];
  for (const root of folders) {
    for (const path of walk(root)) {
      const st = statSync(path);
      const kind = KINDS[extname(path).toLowerCase()] as Kind;
      const name = basename(path);
      let title = tidy(name);
      let pages = 1;
      if (kind === "pdf") {
        const stamp = `${st.size}-${st.mtimeMs}`;
        let m = meta[path];
        if (m?.stamp !== stamp) {
          const got = await pdfMeta(path);
          m = { stamp, ...got };
          meta[path] = m;
        }
        pages = m.pages;
        // many PDFs carry junk titles ("untitled", "Microsoft Word - x.doc")
        if (m.title && !/untitled|microsoft|\.(docx?|tex|indd)$/i.test(m.title)) title = m.title;
      }
      const rel = dirname(relative(root, path));
      items.push({
        id: idOf(path),
        title,
        name,
        kind,
        size: st.size,
        mtime: Math.round(st.mtimeMs),
        pages,
        folder: rel === "." ? basename(root) : rel,
        path,
      });
    }
  }
  try {
    writeFileSync(metaFile(), JSON.stringify(meta));
  } catch {
    // only a cache
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
};

/** A cover: a PDF's first page, or the picture itself. */
export const cover = async (item: Item): Promise<string | null> => {
  if (item.kind === "image") return item.path;
  if (item.kind !== "pdf") return null;
  const dir = ensure(join(paths().cache, "covers"));
  const base = join(dir, `${item.id}-${Math.round(item.mtime)}`);
  try {
    statSync(`${base}.png`);
    return `${base}.png`;
  } catch {
    // not made yet
  }
  try {
    await run("pdftoppm", ["-png", "-singlefile", "-f", "1", "-l", "1", "-scale-to", "480", item.path, base], { timeout: 30000 });
    return `${base}.png`;
  } catch {
    return null;
  }
};
