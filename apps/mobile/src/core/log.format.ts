export type Level = "debug" | "info" | "warn" | "error";

const clean = (data: unknown): string => {
  if (data === undefined) return "";
  if (data instanceof Error) return ` ${JSON.stringify({ error: data.message, stack: data.stack?.split("\n").slice(0, 6).join(" | ") })}`;
  try {
    const s = JSON.stringify(data);
    return ` ${s.length > 1500 ? `${s.slice(0, 1500)}…` : s}`;
  } catch {
    return ` ${String(data)}`;
  }
};

/** One log line: time, level, tag, message, data as JSON. */
export const formatLine = (level: Level, tag: string, msg: string, data?: unknown, at = new Date()) =>
  `${at.toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}${clean(data)}`;

