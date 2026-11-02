import Constants from "expo-constants";
import * as FS from "expo-file-system/legacy";
import { AppState, Platform } from "react-native";
import { formatLine, type Level } from "./log.format";

/**
 * Debug logs: every network call, download, reader event and crash, one line
 * each. They go to logcat (`adb logcat -s ReactNativeJS`) and to a file per day
 * on the phone, kept a week; Settings › Share debug logs sends them on.
 */

const dir = () => `${FS.documentDirectory}logs/`;
const KEEP_DAYS = 7;
const MAX_DAY = 2 * 1024 * 1024; // a day's file stops growing past this; logcat still has it all

let pending: string[] = [];
let today = "";
let todayText = "";
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const day = () => new Date().toISOString().slice(0, 10);

const write = (level: Level, tag: string, msg: string, data?: unknown) => {
  const line = formatLine(level, tag, msg, data);
  // logcat: readable over USB even when the app can't be opened
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`vagdevi ${line}`);
  pending.push(line);
  if (!timer) timer = setTimeout(() => void flush(), 2000);
};

export const log = {
  debug: (tag: string, msg: string, data?: unknown) => write("debug", tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => write("info", tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => write("warn", tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => write("error", tag, msg, data),
};

/** Writes what's waiting. The day's file is rewritten whole: the file API can't append. */
export const flush = async () => {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending.length) return;
  const lines = pending;
  pending = [];
  try {
    await FS.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
    const d = day();
    if (d !== today || !loaded) {
      today = d;
      loaded = true;
      todayText = await FS.readAsStringAsync(`${dir()}${d}.log`).catch(() => "");
    }
    if (todayText.length < MAX_DAY) {
      todayText += `${lines.join("\n")}\n`;
      await FS.writeAsStringAsync(`${dir()}${d}.log`, todayText);
    }
  } catch (e) {
    console.warn("vagdevi log: can't write", e);
  }
};

const prune = async () => {
  const files = await FS.readDirectoryAsync(dir()).catch(() => [] as string[]);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const f of files) if (f.endsWith(".log") && f.slice(0, 10) < cutoff) await FS.deleteAsync(dir() + f, { idempotent: true });
};

/** All the logs in one file, newest day last, with what phone and version this is. */
export const exportLogs = async () => {
  await flush();
  const files = (await FS.readDirectoryAsync(dir()).catch(() => [] as string[])).filter((f) => f.endsWith(".log")).sort();
  let text = `Vāgdevī ${Constants.expoConfig?.version ?? "?"} · Android ${Platform.Version} · ${new Date().toISOString()}\n\n`;
  for (const f of files) text += `===== ${f}\n${await FS.readAsStringAsync(dir() + f).catch(() => "")}\n`;
  const out = `${FS.cacheDirectory}vagdevi-logs-${day()}.txt`;
  await FS.writeAsStringAsync(out, text);
  return out;
};

let started = false;

/** Catches what would otherwise vanish: crashes, unhandled promise rejections. */
export const startLogging = () => {
  if (started) return;
  started = true;
  log.info("app", "start", { version: Constants.expoConfig?.version, android: Platform.Version });
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void; setGlobalHandler: (h: (e: Error, fatal?: boolean) => void) => void };
    HermesInternal?: { enablePromiseRejectionTracker?: (o: { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void }) => void };
  };
  const before = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    log.error("crash", fatal ? "fatal error" : "error", e);
    void flush();
    before?.(e, fatal);
  });
  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, e) => log.error("promise", "unhandled rejection", e instanceof Error ? e : { value: String(e) }),
  });
  AppState.addEventListener("change", (s) => {
    log.debug("app", `state ${s}`);
    if (s !== "active") void flush();
  });
  void prune();
};
