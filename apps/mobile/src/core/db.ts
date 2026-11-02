import * as SQLite from "expo-sqlite";
import { listeners } from "./store";

/** Everything the app shows comes from this database on the phone: it all works offline. */
export type Book = {
  id: string;
  title: string;
  name: string;
  kind: "pdf" | "epub" | "image" | "markdown";
  size: number;
  mtime: number;
  pages: number;
  folder: string;
  /** none, queued, downloading, ready, failed */
  state: string;
  file: string | null; // on this phone
  file_mtime: number; // the version downloaded
  cover: string | null;
  page: number;
  total: number;
  read_at: number; // last opened
  progress_at: number;
  dirty: number; // kept for the sign-in that comes later
  gone: number;
  resume: string | null; // an interrupted download
  /** a library's name, or "phone" for a file you opened */
  source: string;
  source_url: string | null;
  author: string;
  cover_url: string | null;
};

const db = SQLite.openDatabaseSync("vagdevi.db");

db.execSync(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
  pages INTEGER NOT NULL DEFAULT 1, folder TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'none', file TEXT, file_mtime INTEGER NOT NULL DEFAULT 0,
  cover TEXT, page INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, read_at INTEGER NOT NULL DEFAULT 0, progress_at INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 0, gone INTEGER NOT NULL DEFAULT 0, resume TEXT,
  source TEXT NOT NULL DEFAULT '', source_url TEXT, author TEXT NOT NULL DEFAULT '', cover_url TEXT
);
CREATE TABLE IF NOT EXISTS bookmarks (book TEXT NOT NULL, page INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (book, page));
CREATE TABLE IF NOT EXISTS marks (book TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lookups (word TEXT PRIMARY KEY, at INTEGER NOT NULL, context TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const changed = listeners();

export const allBooks = (): Book[] => db.getAllSync<Book>("SELECT * FROM books ORDER BY title COLLATE NOCASE");
export const getBook = (id: string) => db.getFirstSync<Book>("SELECT * FROM books WHERE id = ?", id);
export const lastRead = () => db.getAllSync<Book>("SELECT * FROM books WHERE read_at > 0 AND state = 'ready' ORDER BY read_at DESC LIMIT 6");
export const queued = () => db.getAllSync<Book>("SELECT * FROM books WHERE state IN ('queued', 'downloading') ORDER BY read_at DESC, title");
export const setState = (id: string, state: string, more: { file?: string | null; file_mtime?: number; resume?: string | null } = {}) => {
  db.runSync(
    `UPDATE books SET state = ?, file = CASE WHEN ? THEN ? ELSE file END, file_mtime = COALESCE(?, file_mtime), resume = CASE WHEN ? THEN ? ELSE resume END WHERE id = ?`,
    state, "file" in more ? 1 : 0, more.file ?? null, more.file_mtime ?? null, "resume" in more ? 1 : 0, more.resume ?? null, id,
  );
  changed.emit();
};

export const setCover = (id: string, cover: string) => {
  db.runSync("UPDATE books SET cover = ? WHERE id = ?", cover, id);
  changed.emit();
};

export const saveProgress = (id: string, page: number, total: number) => {
  const now = Date.now();
  db.runSync("UPDATE books SET page = ?, total = ?, progress_at = ?, read_at = ?, dirty = 1 WHERE id = ?", page, total, now, now, id);
  changed.emit();
};

export const markOpened = (id: string) => {
  db.runSync("UPDATE books SET read_at = ? WHERE id = ?", Date.now(), id);
  changed.emit();
};

/** A file of yours leaves the shelf; a library book stays, ready to come down again. */
export const removeBook = (id: string) => {
  db.runSync("DELETE FROM books WHERE id = ? AND source = 'phone'", id);
  db.runSync("UPDATE books SET state = 'none', file = NULL, file_mtime = 0, resume = NULL WHERE id = ?", id);
  changed.emit();
};

/** Every download's gone: your own files leave the shelf, library books stay listed. */
export const forgetDownloads = () => {
  db.execSync("DELETE FROM books WHERE source = 'phone'; UPDATE books SET state = 'none', file = NULL, file_mtime = 0, resume = NULL;");
  changed.emit();
};

/** A book from a library, or a file opened on this phone. */
export const addBook = (b: { id: string; title: string; author: string; name: string; kind: Book["kind"]; size: number; source: string; source_url: string | null; cover_url: string | null }) => {
  db.runSync(
    `INSERT OR IGNORE INTO books (id, title, name, kind, size, mtime, source, source_url, author, cover_url, state) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'none')`,
    b.id, b.title, b.name, b.kind, b.size, b.source, b.source_url, b.author, b.cover_url,
  );
  changed.emit();
};

export const bookmarks = (id: string) => db.getAllSync<{ page: number }>("SELECT page FROM bookmarks WHERE book = ? ORDER BY page", id).map((r) => r.page);
export const toggleBookmark = (id: string, page: number) => {
  const r = db.runSync("DELETE FROM bookmarks WHERE book = ? AND page = ?", id, page);
  if (r.changes === 0) db.runSync("INSERT INTO bookmarks VALUES (?, ?, ?)", id, page, Date.now());
  changed.emit();
};

export type ResumeMark =
  | { kind: "flow"; section: number; block: number; snippet: string }
  | { kind: "page"; page: number; y: number; snippet: string };

/** The one place in a book you said you'd pick up from. */
export const getMark = (id: string): (ResumeMark & { at: number }) | null => {
  const r = db.getFirstSync<{ data: string; at: number }>("SELECT data, at FROM marks WHERE book = ?", id);
  if (!r) return null;
  try {
    return { ...(JSON.parse(r.data) as ResumeMark), at: r.at };
  } catch {
    return null;
  }
};
export const setMark = (id: string, m: ResumeMark | null) => {
  if (m) db.runSync("INSERT OR REPLACE INTO marks VALUES (?, ?, ?)", id, JSON.stringify(m), Date.now());
  else db.runSync("DELETE FROM marks WHERE book = ?", id);
  changed.emit();
};

export const rememberLookup = (word: string, context: string) => {
  db.runSync("INSERT OR REPLACE INTO lookups VALUES (?, ?, ?)", word.toLowerCase(), Date.now(), context);
};
export const recentLookups = () => db.getAllSync<{ word: string; context: string }>("SELECT word, context FROM lookups ORDER BY at DESC LIMIT 100");

export const getSetting = (key: string, def: string) => db.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value ?? def;
export const setSetting = (key: string, value: string) => {
  db.runSync("INSERT OR REPLACE INTO settings VALUES (?, ?)", key, value);
  changed.emit();
};
