import { XMLParser } from "fast-xml-parser";
import { log } from "./log";

/**
 * Free libraries, asked directly from the phone over HTTPS. Only public-domain
 * sources, so everything here is free to keep.
 */
export type Source = "Standard Ebooks" | "Project Gutenberg" | "Internet Archive";

export type CatalogBook = {
  key: string; // also the book's id on this phone
  source: Source;
  title: string;
  author: string;
  cover: string | null;
  about: string;
  kind: "epub" | "pdf";
  /** Internet Archive's file is found when you ask for it */
  url: string | null;
  size: number;
  ia?: string;
  rights: string;
};

const AGENT = { headers: { accept: "application/json, application/atom+xml" } };

const get = async (url: string, ms = 15000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...AGENT, signal: c.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    log.info("net", "GET", { url, status: r.status, bytes: text.length, ms: Date.now() - t0 });
    return text;
  } catch (e) {
    const why = c.signal.aborted ? `timed out after ${ms} ms` : e instanceof Error ? e.message : String(e);
    log.warn("net", "GET failed", { url, why, ms: Date.now() - t0 });
    throw new Error(why);
  } finally {
    clearTimeout(t);
  }
};

const safeId = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
const asList = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const https = (u: string | null | undefined) => (u?.startsWith("https://") ? u : u?.startsWith("http://") ? `https://${u.slice(7)}` : null);

/** "Austen, Jane" reads better as Jane Austen. */
export const nameOrder = (s: string) => {
  const m = /^([^,]+),\s*([^,]+)(?:,.*)?$/.exec(s.trim());
  return m ? `${m[2]} ${m[1]}` : s.trim();
};

// ---- Project Gutenberg, through Gutendex

type GutenBook = { id: number; title: string; authors: { name: string }[]; summaries?: string[]; formats: Record<string, string>; copyright: boolean | null };

export const parseGutendex = (text: string): CatalogBook[] => {
  const d = JSON.parse(text) as { results: GutenBook[] };
  return d.results
    .filter((b) => b.copyright === false)
    .flatMap((b): CatalogBook[] => {
      const epub = https(b.formats["application/epub+zip"]);
      if (!epub) return [];
      return [{
        key: `pg${b.id}`,
        source: "Project Gutenberg",
        title: b.title,
        author: b.authors.map((a) => nameOrder(a.name)).join(", "),
        cover: https(b.formats["image/jpeg"]),
        about: b.summaries?.[0] ?? "",
        kind: "epub",
        url: epub,
        size: 0,
        rights: "Public domain in the US; check local law elsewhere",
      }];
    });
};

export const gutenberg = async (query: string, lang: string) => {
  const q = new URLSearchParams({ languages: lang, copyright: "false" });
  if (query) q.set("search", query);
  return parseGutendex(await get(`https://gutendex.com/books/?${q}`));
};

// ---- Standard Ebooks

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

type AtomLink = { href: string; rel?: string; type?: string; title?: string; length?: string };
type AtomEntry = {
  id: string; title: string | { "#text": string }; author: { name: string } | { name: string }[];
  summary?: string | { "#text": string }; link: AtomLink | AtomLink[]; "media:thumbnail"?: { url: string };
};

const textOf = (v: string | { "#text": string } | undefined) => (typeof v === "object" ? v["#text"] : (v ?? ""));

export const parseStandardEbooks = (text: string): CatalogBook[] => {
  const feed = xml.parse(text)?.feed;
  return asList<AtomEntry>(feed?.entry).flatMap((e): CatalogBook[] => {
    // the plain EPUB: not the "advanced" or Kobo ones
    const link = asList(e.link).find((l) => /\.epub(\?|$)/.test(l.href) && !/_advanced|\.kepub/.test(l.href));
    const url = https(link?.href);
    if (!url) return [];
    return [{
      key: `se-${safeId(String(e.id).replace("https://standardebooks.org/ebooks/", ""))}`,
      source: "Standard Ebooks",
      title: String(textOf(e.title)),
      author: asList(e.author).map((a) => a.name).join(", "),
      cover: https(e["media:thumbnail"]?.url),
      about: String(textOf(e.summary)),
      kind: "epub",
      url,
      size: Number(link?.length ?? 0),
      rights: "Public domain in the US; check local law elsewhere",
    }];
  });
};

export const standardEbooks = async (query: string) => {
  const url = query ? `https://standardebooks.org/feeds/atom/all?query=${encodeURIComponent(query)}` : "https://standardebooks.org/feeds/atom/new-releases";
  return parseStandardEbooks(await get(url));
};

// ---- Internet Archive: scanned printed books, from the public-domain library collections

const IA_LANG: Record<string, string> = { en: "eng", sa: "san", hi: "hin", fr: "fre", de: "ger", es: "spa" };
// libraries' scanning programmes: not "lending library" books still under copyright
const IA_COLLECTIONS = "collection:(americana OR toronto OR cdl OR europeanlibraries)";

type IADoc = { identifier: string; title?: string | string[]; creator?: string | string[]; description?: string | string[] };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export const parseArchive = (text: string): CatalogBook[] => {
  const d = JSON.parse(text) as { response?: { docs?: IADoc[] } };
  return (d.response?.docs ?? []).map((b) => ({
    key: `ia-${safeId(b.identifier)}`,
    source: "Internet Archive" as const,
    title: first(b.title),
    author: asList(b.creator).slice(0, 2).map((a) => nameOrder(a.replace(/,?\s*\d{4}.*$/, ""))).join(", "),
    cover: `https://archive.org/services/img/${encodeURIComponent(b.identifier)}`,
    about: first(b.description).replace(/<[^>]+>/g, "").slice(0, 600),
    kind: "pdf" as const,
    url: null,
    size: 0,
    ia: b.identifier,
    rights: "From a library's public-domain scans; check local law",
  }));
};

export const archive = async (query: string, lang: string) => {
  const parts = ["mediatype:texts", 'format:"Text PDF"', IA_COLLECTIONS, "NOT access-restricted-item:true", `language:${IA_LANG[lang] ?? "eng"}`];
  if (query) parts.unshift(`(title:(${query.replace(/[^\p{L}\p{N} ]/gu, " ")}) OR creator:(${query.replace(/[^\p{L}\p{N} ]/gu, " ")}))`);
  const q = new URLSearchParams({ q: parts.join(" AND "), rows: "20", output: "json" });
  for (const f of ["identifier", "title", "creator", "description"]) q.append("fl[]", f);
  q.append("sort[]", "downloads desc");
  return parseArchive(await get(`https://archive.org/advancedsearch.php?${q}`, 20000));
};

/** The PDF of an archive item: the smallest copy with text in it. */
export const parseArchiveFiles = (identifier: string, text: string) => {
  const d = JSON.parse(text) as { result?: { name: string; format?: string; size?: string }[] };
  const pdfs = (d.result ?? []).filter((f) => f.format === "Text PDF" && f.name.endsWith(".pdf"));
  const pick = pdfs.sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0))[0];
  if (!pick) return null;
  return { url: `https://archive.org/download/${encodeURIComponent(identifier)}/${pick.name.split("/").map(encodeURIComponent).join("/")}`, size: Number(pick.size ?? 0) };
};

export const archiveFile = async (identifier: string) => parseArchiveFiles(identifier, await get(`https://archive.org/metadata/${encodeURIComponent(identifier)}/files`));

// ---- all of them

export type Shelf = { title: string; note: string; source: Source; books: CatalogBook[]; state: "loading" | "ready" | "failed" };

/** The shelves Discover shows, in order, before any library has answered. */
export const shelvesFor = (lang: string): Shelf[] => [
  ...(lang === "en" ? [{ title: "Beautifully made", note: "Standard Ebooks: edited and typeset by volunteers", source: "Standard Ebooks" as const }] : []),
  { title: "Most read", note: "Project Gutenberg: over 70,000 books, many languages", source: "Project Gutenberg" as const },
  { title: "Original printed pages", note: "Internet Archive: public-domain scans as PDF", source: "Internet Archive" as const },
].map((s) => ({ ...s, books: [], state: "loading" as const }));

const ASK: Record<Source, (query: string, lang: string) => Promise<CatalogBook[]>> = {
  // Standard Ebooks publishes in English only
  "Standard Ebooks": (query) => standardEbooks(query),
  "Project Gutenberg": gutenberg,
  "Internet Archive": archive,
};

/** Asks every library at once; each shelf fills in as its library answers, and one being slow or down never holds up the others. */
export const browse = (query: string, lang: string, onShelf: (s: Shelf) => void): Promise<void> =>
  Promise.all(
    shelvesFor(lang).map(async (shelf) => {
      try {
        const books = await ASK[shelf.source](query, lang);
        log.info("discover", "shelf", { source: shelf.source, query, lang, books: books.length });
        onShelf({ ...shelf, books, state: "ready" });
      } catch (e) {
        log.warn("discover", "shelf failed", { source: shelf.source, query, lang, why: e instanceof Error ? e.message : String(e) });
        onShelf({ ...shelf, state: "failed" });
      }
    }),
  ).then(() => undefined);
