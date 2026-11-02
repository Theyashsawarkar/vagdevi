import * as FS from "expo-file-system/legacy";
import * as Network from "expo-network";
import { addBook, type Book, getBook, queued, removeBook, setState } from "./db";
import { fromBase64, pdfComplete, zipComplete } from "./files";
import { log } from "./log";
import { listeners } from "./store";

const dir = () => `${FS.documentDirectory}books/`;
const EXT: Record<string, string> = { pdf: ".pdf", epub: ".epub", markdown: ".md" };

export const progressBus = listeners();
const progress = new Map<string, number>();
export const downloadProgress = (id: string) => progress.get(id) ?? 0;

export const queueBook = (id: string) => {
  const b = getBook(id);
  if (b && b.state !== "ready" && b.state !== "downloading") setState(id, "queued");
};

let pumping = false;

/** Downloads what's queued, one at a time; stops quietly when the connection goes. */
export const pumpDownloads = () => {
  if (pumping) return;
  pumping = true;
  void (async () => {
    try {
      await FS.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
      for (;;) {
        const next = queued().find((b) => b.state === "queued" && b.source_url);
        if (!next) return;
        if (!(await fetchOne(next))) return;
      }
    } finally {
      pumping = false;
    }
  })();
};

let watching = false;

/** Picks up waiting downloads whenever a connection comes back. */
export const watchNetwork = () => {
  if (watching) return;
  watching = true;
  Network.addNetworkStateListener((s) => {
    if (s.isConnected) pumpDownloads();
  });
  pumpDownloads();
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
  const ext = EXT[b.kind] ?? (/\.[a-z0-9]+$/i.exec(b.name)?.[0] ?? ".img");
  const to = `${dir()}${b.id}${ext}`;
  const tmp = `${to}.part`;
  setState(b.id, "downloading");
  const t0 = Date.now();
  let expected = 0;
  let tries = 0;
  log.info("download", "start", { id: b.id, url: b.source_url, resumeFrom: await size(tmp) });
  try {
    for (;;) {
      const have = await size(tmp);
      const task = FS.createDownloadResumable(
        b.source_url,
        tmp,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > expected) expected = p.totalBytesExpectedToWrite;
          progress.set(b.id, expected > 0 ? p.totalBytesWritten / expected : 0);
          progressBus.emit();
        },
        have > 0 ? String(have) : undefined,
      );
      const r = have > 0 ? await task.resumeAsync() : await task.downloadAsync();
      const got = await size(tmp);
      log.debug("download", "piece", { id: b.id, status: r?.status, got, expected, try: tries });
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
    setState(b.id, "ready", { file: to, file_mtime: 0, resume: null });
    log.info("download", "done", { id: b.id, bytes: await size(to), ms: Date.now() - t0, resumes: tries });
    progress.delete(b.id);
    progressBus.emit();
    return true;
  } catch (e) {
    progress.delete(b.id);
    progressBus.emit();
    if (e instanceof BadFile) {
      log.error("download", "bad file", { id: b.id, why: e.message, bytes: await size(tmp) });
      await FS.deleteAsync(tmp, { idempotent: true });
      setState(b.id, "failed", { resume: null });
      return true;
    }
    // a file that claimed to be whole but wasn't: next time it starts fresh
    if (e instanceof CutShort) await FS.deleteAsync(tmp, { idempotent: true });
    // otherwise what arrived stays in the .part file: the next try carries on from it
    log.warn("download", "paused", { id: b.id, why: e instanceof Error ? e.message : String(e), have: await size(tmp) });
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

/** Keeps a file you opened on this phone, wherever it came from. */
export const importFile = async (uri: string, name: string, size: number): Promise<string | null> => {
  const lower = name.toLowerCase();
  const kind: Book["kind"] | null = lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".epub") ? "epub" : /\.(md|markdown)$/.test(lower) ? "markdown" : /\.(png|jpe?g|webp|gif)$/.test(lower) ? "image" : null;
  if (!kind) return null;
  await FS.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
  const id = `f${Date.now().toString(36)}`;
  const to = `${dir()}${id}${lower.slice(lower.lastIndexOf("."))}`;
  log.info("import", "file", { name, kind, size });
  await FS.copyAsync({ from: uri, to });
  try {
    await checkFile(to, kind);
  } catch (e) {
    await FS.deleteAsync(to, { idempotent: true });
    throw e;
  }
  const title = name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim() || name;
  addBook({ id, title, author: "", name, kind, size, source: "phone", source_url: null, cover_url: null });
  setState(id, "ready", { file: to, file_mtime: 0 });
  return id;
};

/** Frees the phone's copy. A library book can come down again; a file of yours goes. */
export const removeDownload = async (b: Book) => {
  if (b.file) await FS.deleteAsync(b.file, { idempotent: true });
  removeBook(b.id);
};

export const usedSpace = async () => {
  const info = await FS.getInfoAsync(dir()).catch(() => null);
  if (!info?.exists) return 0;
  let total = 0;
  for (const f of await FS.readDirectoryAsync(dir())) {
    const i = await FS.getInfoAsync(dir() + f);
    if (i.exists) total += i.size ?? 0;
  }
  return total;
};

export const removeAllFiles = () => FS.deleteAsync(dir(), { idempotent: true });
