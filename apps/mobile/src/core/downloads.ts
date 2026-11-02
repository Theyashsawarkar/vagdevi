import * as FS from "expo-file-system/legacy";
import * as Network from "expo-network";
import { addBook, type Book, deleteBook, getBook, getSetting, queued, readyBooks, resetStuck, setCover, setError, setSetting, setSize, setState } from "./db";
import { fromBase64, pdfComplete, zipComplete } from "./files";
import { log } from "./log";
import { listeners } from "./store";

const dir = () => `${FS.documentDirectory}books/`;
const covers = () => `${FS.documentDirectory}covers/`;
const EXT: Record<string, string> = { pdf: ".pdf", epub: ".epub", markdown: ".md" };
const AT_ONCE = 2;

export const progressBus = listeners();
const progress = new Map<string, { written: number; expected: number }>();
export const downloadProgress = (id: string) => {
  const p = progress.get(id);
  return p && p.expected > 0 ? p.written / p.expected : 0;
};
export const downloadBytes = (id: string) => progress.get(id) ?? { written: 0, expected: 0 };

// bytes a second, smoothed so the number doesn't jump about
const speeds = new Map<string, { at: number; written: number; rate: number }>();
export const downloadSpeed = (id: string) => speeds.get(id)?.rate ?? 0;
const noteSpeed = (id: string, written: number) => {
  const now = Date.now();
  const s = speeds.get(id);
  if (!s) return void speeds.set(id, { at: now, written, rate: 0 });
  if (now - s.at < 500) return;
  const rate = ((written - s.written) * 1000) / (now - s.at);
  speeds.set(id, { at: now, written, rate: s.rate ? s.rate * 0.7 + rate * 0.3 : rate });
};

const running = new Map<string, FS.DownloadResumable | null>();
const stopping = new Map<string, "pause" | "cancel">();

const fileFor = (b: Book) => `${dir()}${b.id}${EXT[b.kind] ?? (/\.[a-z0-9]+$/i.exec(b.name)?.[0] ?? ".img")}`;

export const queueBook = (id: string) => {
  const b = getBook(id);
  if (b && b.state !== "ready" && b.state !== "downloading") setState(id, "queued");
};

let retry: ReturnType<typeof setTimeout> | null = null;

/** Starts what's waiting, up to two at a time: a big book never holds up a small one. */
export const pumpDownloads = () => {
  for (const b of queued()) {
    if (running.size >= AT_ONCE) return;
    if (b.state !== "queued" || !b.source_url || running.has(b.id)) continue;
    running.set(b.id, null);
    void fetchOne(b).then((fine) => {
      running.delete(b.id);
      stopping.delete(b.id);
      progress.delete(b.id);
      speeds.delete(b.id);
      progressBus.emit();
      if (fine) pumpDownloads();
      else if (!retry) {
        // no connection, probably: try again in a while, and whenever it comes back
        retry = setTimeout(() => {
          retry = null;
          pumpDownloads();
        }, 30000);
      }
    });
  }
};

/** Stops a download, keeping what arrived; resumeDownload carries on from there. */
export const pauseDownload = async (id: string) => {
  log.info("download", "pause", { id });
  if (running.has(id)) {
    stopping.set(id, "pause");
    await running.get(id)?.pauseAsync().catch(() => undefined);
  }
  setState(id, "paused");
};

export const resumeDownload = (id: string) => {
  log.info("download", "resume", { id });
  setState(id, "queued");
  pumpDownloads();
};

/** Stops a download and forgets it: the book leaves the shelf. */
export const cancelDownload = async (id: string) => {
  log.info("download", "cancel", { id });
  const b = getBook(id);
  if (running.has(id)) {
    stopping.set(id, "cancel");
    await running.get(id)?.pauseAsync().catch(() => undefined);
  }
  if (b) await removeFiles(b);
  deleteBook(id);
};

const removeFiles = async (b: Book) => {
  const f = fileFor(b);
  for (const path of [f, `${f}.part`, b.file, `${covers()}${b.id}.jpg`, `${covers()}${b.id}.lib.jpg`]) {
    if (path) await FS.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
};

/** Deletes books for good: files, cover, your place, your marks. */
export const deleteBooks = async (ids: string[]) => {
  log.info("library", "delete", { ids });
  for (const id of ids) {
    if (running.has(id)) await cancelDownload(id);
    else {
      const b = getBook(id);
      if (b) await removeFiles(b);
      deleteBook(id);
    }
  }
};

const size = async (path: string) => {
  const i = await FS.getInfoAsync(path).catch(() => null);
  return i?.exists ? (i.size ?? 0) : 0;
};

/**
 * Some libraries drop the connection partway and still say "done" (Gutenberg
 * sends 1 MB of a 25 MB book and a 200). So: keep resuming from what arrived
 * until it's all there, then check the file really is complete.
 */
const fetchOne = async (b: Book): Promise<boolean> => {
  if (!b.source_url) return true;
  const to = fileFor(b);
  const tmp = `${to}.part`;
  await FS.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
  setError(b.id, null);
  setState(b.id, "downloading");
  const t0 = Date.now();
  let expected = b.size;
  let tries = 0;
  // what's there must be the start of this book: a failed try can leave an error page
  if (b.kind === "pdf" || b.kind === "epub") {
    const had = await size(tmp);
    if (had > 0) {
      const head = had >= 4 ? await FS.readAsStringAsync(tmp, { encoding: FS.EncodingType.Base64, position: 0, length: 4 }).catch(() => "") : "";
      if (!head.startsWith(b.kind === "pdf" ? "JVBERg" : "UEsDB")) {
        log.warn("download", "partial file isn't the book, starting over", { id: b.id, had });
        await FS.deleteAsync(tmp, { idempotent: true });
      }
    }
  }
  log.info("download", "start", { id: b.id, url: b.source_url, resumeFrom: await size(tmp) });
  const stopped = () => stopping.get(b.id);
  try {
    for (;;) {
      const have = await size(tmp);
      progress.set(b.id, { written: have, expected });
      progressBus.emit();
      const task = FS.createDownloadResumable(
        b.source_url,
        tmp,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > expected) expected = p.totalBytesExpectedToWrite;
          progress.set(b.id, { written: p.totalBytesWritten, expected });
          noteSpeed(b.id, p.totalBytesWritten);
          progressBus.emit();
        },
        have > 0 ? String(have) : undefined,
      );
      running.set(b.id, task);
      if (stopped()) return true;
      const r = have > 0 ? await task.resumeAsync() : await task.downloadAsync();
      if (stopped()) return true;
      const got = await size(tmp);
      log.debug("download", "piece", { id: b.id, status: r?.status, got, expected, try: tries });
      if (r && r.status >= 400) {
        // the error page was written to the file, after whatever was there: it can't be resumed from
        log.warn("download", "error reply, starting over next time", { id: b.id, status: r.status, had: have });
        await FS.deleteAsync(tmp, { idempotent: true });
      }
      if (!r || r.status >= 400) throw new Error(`HTTP ${r?.status}`);
      if (have > 0 && r.status === 200) {
        // the server ignored the resume and sent it all again, after what was there: start over
        log.warn("download", "no resume support, starting over", { id: b.id });
        await FS.deleteAsync(tmp, { idempotent: true });
        if (++tries > 40) throw new Error("can't resume");
        continue;
      }
      if (expected > 0 && got < expected) {
        if (got <= have || ++tries > 40) throw new Error(`stuck at ${got} of ${expected} bytes`);
        continue; // the connection dropped: carry on from here
      }
      break;
    }
    await checkFile(tmp, b.kind);
    await FS.deleteAsync(to, { idempotent: true });
    await FS.moveAsync({ from: tmp, to });
    setSize(b.id, await size(to));
    setState(b.id, "ready", { file: to, file_mtime: 0, resume: null });
    log.info("download", "done", { id: b.id, bytes: await size(to), ms: Date.now() - t0, resumes: tries });
    void keepCover(b);
    return true;
  } catch (e) {
    // pausing or cancelling can surface as an error from the download
    if (stopped()) return true;
    if (e instanceof BadFile) {
      log.error("download", "bad file", { id: b.id, why: e.message, bytes: await size(tmp) });
      await FS.deleteAsync(tmp, { idempotent: true });
      setError(b.id, "The library sent something other than the book.");
      setState(b.id, "failed", { resume: null });
      return true;
    }
    // a file that claimed to be whole but wasn't: next time it starts fresh
    if (e instanceof CutShort) await FS.deleteAsync(tmp, { idempotent: true });
    // otherwise what arrived stays in the .part file: the next try carries on from it
    log.warn("download", "paused by network", { id: b.id, why: e instanceof Error ? e.message : String(e), have: await size(tmp) });
    setError(b.id, e instanceof Error ? e.message : String(e));
    setState(b.id, "queued");
    return false;
  }
};

class BadFile extends Error {}
class CutShort extends Error {}

/** Is it what it says it is, and all of it? Libraries answer some requests with a web page. */
const checkFile = async (path: string, kind: Book["kind"]) => {
  if (kind !== "pdf" && kind !== "epub") return;
  const head = await FS.readAsStringAsync(path, { encoding: FS.EncodingType.Base64, position: 0, length: 4 });
  // "%PDF" and "PK\x03\x04", in base64
  if (!head.startsWith(kind === "pdf" ? "JVBERg" : "UEsDB")) throw new BadFile(`not a ${kind}`);
  const total = await size(path);
  const n = Math.min(total, 65536);
  const tail = fromBase64(await FS.readAsStringAsync(path, { encoding: FS.EncodingType.Base64, position: total - n, length: n }));
  if (!(kind === "pdf" ? pdfComplete(tail) : zipComplete(tail))) throw new CutShort(`the ${kind} is cut short`);
};

/** The library's cover, kept on the phone: a kept book looks right with no connection. */
const keepCover = async (b: Book) => {
  if (!b.cover_url) return;
  const to = `${covers()}${b.id}.lib.jpg`;
  try {
    await FS.makeDirectoryAsync(covers(), { intermediates: true }).catch(() => undefined);
    const r = await FS.downloadAsync(b.cover_url, to);
    if (r.status < 300) setCover(b.id, to);
    else await FS.deleteAsync(to, { idempotent: true });
  } catch (e) {
    log.debug("download", "cover not kept", { id: b.id, why: e instanceof Error ? e.message : String(e) });
  }
};

/** Books kept before these checks existed may be cut short: those come down again. */
const checkKept = async () => {
  for (const b of readyBooks()) {
    if (getSetting(`checked:${b.id}`, "") || !b.file) continue;
    try {
      await checkFile(b.file, b.kind);
      setSetting(`checked:${b.id}`, "1");
      if (b.cover_url && !b.cover?.endsWith(".lib.jpg")) void keepCover(b);
    } catch (e) {
      log.warn("library", "kept file is broken", { id: b.id, why: e instanceof Error ? e.message : String(e) });
      await FS.deleteAsync(b.file, { idempotent: true }).catch(() => undefined);
      setState(b.id, b.source_url ? "queued" : "failed", { file: null, resume: null });
    }
  }
  pumpDownloads();
};

let watching = false;

/** On start: carry on what was cut off, and whenever a connection comes back. */
export const watchNetwork = () => {
  if (watching) return;
  watching = true;
  resetStuck();
  Network.addNetworkStateListener((s) => {
    log.debug("net", "state", { connected: s.isConnected, type: s.type });
    if (s.isConnected) pumpDownloads();
  });
  void checkKept();
};

/** Keeps a file you opened on this phone, wherever it came from. */
export const importFile = async (uri: string, name: string, bytes: number): Promise<string | null> => {
  const lower = name.toLowerCase();
  const kind: Book["kind"] | null = lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".epub") ? "epub" : /\.(md|markdown)$/.test(lower) ? "markdown" : /\.(png|jpe?g|webp|gif)$/.test(lower) ? "image" : null;
  if (!kind) return null;
  await FS.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
  const id = `f${Date.now().toString(36)}`;
  const to = `${dir()}${id}${lower.slice(lower.lastIndexOf("."))}`;
  log.info("import", "file", { name, kind, bytes });
  await FS.copyAsync({ from: uri, to });
  try {
    await checkFile(to, kind);
  } catch (e) {
    await FS.deleteAsync(to, { idempotent: true });
    throw e;
  }
  const title = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
  addBook({ id, title, author: "", name, kind, size: bytes || (await size(to)), source: "phone", source_url: null, cover_url: null });
  setState(id, "ready", { file: to, file_mtime: 0 });
  return id;
};

export const usedSpace = async () => {
  const info = await FS.getInfoAsync(dir()).catch(() => null);
  if (!info?.exists) return 0;
  let total = 0;
  for (const f of await FS.readDirectoryAsync(dir())) total += await size(dir() + f);
  return total;
};

export const removeAllFiles = async () => {
  await FS.deleteAsync(dir(), { idempotent: true });
  await FS.deleteAsync(covers(), { idempotent: true });
};
