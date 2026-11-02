import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensure, paths } from "./config.js";

export type Progress = { page: number; total: number; updatedAt: number };
type Stored = Record<string, Progress>;

const file = () => join(ensure(paths().state), "progress.json");
const load = (): Stored => {
  try {
    return JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
};

export const allProgress = load;

/** Keeps whichever reading is newest: a phone offline for a week can't undo today. */
export const putProgress = (id: string, p: Progress): Progress => {
  const s = load();
  const cur = s[id];
  if (cur && cur.updatedAt >= p.updatedAt) return cur;
  s[id] = p;
  writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });
  return p;
};
