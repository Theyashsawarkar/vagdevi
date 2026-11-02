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
  subjects?: string[];
};

/** What each library calls a genre. */
export const GENRES = [
  ["all", "For you"], ["novels", "Novels"], ["philosophy", "Philosophy"], ["spirituality", "Spirituality"], ["psychology", "Psychology"],
  ["money", "Money"], ["tech", "Tech"], ["science", "Science"], ["poetry", "Poetry"], ["history", "History"],
] as const;
export type Genre = (typeof GENRES)[number][0];

const GENRE_QUERY: Record<Genre, { gutenberg: string; standard: string; archive: string }> = {
  all: { gutenberg: "", standard: "", archive: "" },
  novels: { gutenberg: "s.fiction", standard: "fiction", archive: "fiction" },
  philosophy: { gutenberg: "s.philosophy", standard: "philosophy", archive: "philosophy" },
  spirituality: { gutenberg: "s.hinduism", standard: "spirituality", archive: "hinduism OR vedanta OR spiritual" },
  // "psychology" alone also finds every "psychological fiction": Moby Dick, Gatsby
  psychology: { gutenberg: "s.psychology !s.fiction", standard: "psychology", archive: "psychology" },
  money: { gutenberg: "s.finance !s.fiction", standard: "money", archive: "finance OR wealth OR economics" },
  tech: { gutenberg: "s.computers", standard: "technology", archive: "computers OR \"computer science\" OR technology" },
  science: { gutenberg: "s.science !s.fiction", standard: "science", archive: "science" },
  poetry: { gutenberg: "s.poetry", standard: "poetry", archive: "poetry" },
  history: { gutenberg: "s.history !s.fiction", standard: "history", archive: "history" },
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

// ---- Project Gutenberg: its own catalogue feed, ranked by downloads

const unescape = (t: string) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

export const parseGutenberg = (text: string): CatalogBook[] => {
  const out: CatalogBook[] = [];
  for (const m of text.matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const e = m[0];
    // the feed mixes in "Authors" and "Subjects" links: only books have a number
    const id = /<id>[^<]*\/ebooks\/(\d+)\.opds<\/id>/.exec(e)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(e)?.[1];
    if (!id || !title) continue;
    out.push({
      key: `pg${id}`,
      source: "Project Gutenberg",
      title: unescape(title),
      author: unescape(/<content[^>]*>([^<]*)<\/content>/.exec(e)?.[1] ?? ""),
      cover: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
      about: "",
      kind: "epub",
      url: `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
      size: 0,
      rights: "Public domain in the US; check local law elsewhere",
    });
  }
  return out;
};

export const gutenberg = async (query: string, lang: string, genre: Genre = "all") => {
  const q = [query, GENRE_QUERY[genre].gutenberg, `l.${lang}`].filter(Boolean).join(" ");
  return parseGutenberg(await get(`https://www.gutenberg.org/ebooks/search.opds/?${new URLSearchParams({ query: q, sort_order: "downloads" })}`));
};

/** A book's two editions: pictures can make it fifty times bigger. */
export const parseGutenbergEditions = (text: string) => {
  const edition = (re: RegExp) => {
    const l = [...text.matchAll(/<link[^>]*>/g)].map((m) => m[0]).find((x) => x.includes("application/epub+zip") && re.test(x));
    const url = l && /href="([^"]+)"/.exec(l)?.[1];
    return url ? { url: https(url) as string, size: Number(/length="(\d+)"/.exec(l)?.[1] ?? 0) } : null;
  };
  return { pictures: edition(/\.epub3\.images/), plain: edition(/\.epub\.noimages/) };
};

/** The subjects a library files a book under: they say which genre it belongs to. */
export const parseGutenbergSubjects = (text: string) => [...text.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => unescape(m[1] as string));

export const subjectsOf = async (id: string, title = ""): Promise<string[]> => {
  if (id.startsWith("se-")) return parseStandardEbooks(await get(`https://standardebooks.org/feeds/atom/all?query=${encodeURIComponent(title)}`)).find((b) => b.key === id)?.subjects ?? [];
  if (id.startsWith("pg")) return parseGutenbergSubjects(await get(`https://www.gutenberg.org/ebooks/${id.slice(2)}.opds`));
  if (id.startsWith("ia-")) {
    const d = JSON.parse(await get(`https://archive.org/metadata/${encodeURIComponent(id.slice(3))}/metadata/subject`)) as { result?: string | string[] };
    return asList(d.result);
  }
  return [];
};

export const gutenbergEditions = async (id: string) => parseGutenbergEditions(await get(`https://www.gutenberg.org/ebooks/${id}.opds`));

/** Gutendex has summaries, but often doesn't answer: a nice extra, never needed. */
export const gutenbergSummary = async (id: string) => {
  const d = JSON.parse(await get(`https://gutendex.com/books/${id}`, 6000)) as { summaries?: string[] };
  return (d.summaries?.[0] ?? "").replace(/\s*\(This is an automatically generated summary\.\)\s*$/, "");
};

// ---- Standard Ebooks

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

type AtomLink = { href: string; rel?: string; type?: string; title?: string; length?: string };
type AtomEntry = {
  id: string; title: string | { "#text": string }; author: { name: string } | { name: string }[];
  category?: { term: string } | { term: string }[]; summary?: string | { "#text": string }; link: AtomLink | AtomLink[]; "media:thumbnail"?: { url: string };
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
      subjects: [...asList(e.category).map((c) => c.term)],
    }];
  });
};

export const standardEbooks = async (query: string, genre: Genre = "all") => {
  const q = [query, GENRE_QUERY[genre].standard].filter(Boolean).join(" ");
  const url = q ? `https://standardebooks.org/feeds/atom/all?query=${encodeURIComponent(q)}` : "https://standardebooks.org/feeds/atom/new-releases";
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

export const archive = async (query: string, lang: string, genre: Genre = "all") => {
  const parts = ["mediatype:texts", 'format:"Text PDF"', IA_COLLECTIONS, "NOT access-restricted-item:true", `language:${IA_LANG[lang] ?? "eng"}`];
  if (GENRE_QUERY[genre].archive) parts.unshift(`subject:(${GENRE_QUERY[genre].archive})`);
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
  ...(lang === "en" ? [{ title: "Beautifully made", note: "Standard Ebooks", source: "Standard Ebooks" as const }] : []),
  { title: "Most read", note: "Project Gutenberg", source: "Project Gutenberg" as const },
  { title: "Original printed pages", note: "Internet Archive", source: "Internet Archive" as const },
].map((s) => ({ ...s, books: [], state: "loading" as const }));

const ASK: Record<Source, (query: string, lang: string, genre: Genre) => Promise<CatalogBook[]>> = {
  // Standard Ebooks publishes in English only
  "Standard Ebooks": (query, _lang, genre) => standardEbooks(query, genre),
  "Project Gutenberg": gutenberg,
  "Internet Archive": archive,
};

/** Asks every library at once; each shelf fills in as its library answers, and one being slow or down never holds up the others. */
export const browse = (query: string, lang: string, onShelf: (s: Shelf) => void, genre: Genre = "all"): Promise<void> =>
  Promise.all(
    shelvesFor(lang).map(async (shelf) => {
      try {
        const books = await ASK[shelf.source](query, lang, genre);
        log.info("discover", "shelf", { source: shelf.source, query, lang, genre, books: books.length });
        onShelf({ ...shelf, books, state: "ready" });
      } catch (e) {
        log.warn("discover", "shelf failed", { source: shelf.source, query, lang, genre, why: e instanceof Error ? e.message : String(e) });
        onShelf({ ...shelf, state: "failed" });
      }
    }),
  ).then(() => undefined);

/** One list from every shelf: turn about, no book twice. */
export const mergeShelves = (shelves: Shelf[]): CatalogBook[] => {
  const seen = new Set<string>();
  const out: CatalogBook[] = [];
  const longest = Math.max(0, ...shelves.map((s) => s.books.length));
  for (let i = 0; i < longest; i++) {
    for (const s of shelves) {
      const b = s.books[i];
      if (!b) continue;
      const k = b.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").slice(0, 5).join(" ");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
  }
  return out;
};
