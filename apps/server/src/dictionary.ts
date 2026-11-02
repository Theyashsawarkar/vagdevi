import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensure, paths } from "./config.js";

const require = createRequire(import.meta.url);

export type Sense = { pos: string; gloss: string; examples: string[]; synonyms: string[] };

const POS: Record<string, string> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };

/** Parses one WordNet data line: its words, part of speech and gloss. */
export const parseDataLine = (line: string): { words: string[]; sense: Sense } | null => {
  if (!line || line.startsWith("  ")) return null;
  const bar = line.indexOf(" | ");
  if (bar < 0) return null;
  const head = line.slice(0, bar).split(" ");
  const pos = POS[head[2] ?? ""];
  const count = Number.parseInt(head[3] ?? "", 16);
  if (!pos || !count) return null;
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const w = head[4 + i * 2];
    if (w) words.push(w.replace(/\(.*\)$/, "").replace(/_/g, " "));
  }
  const raw = line.slice(bar + 3).trim();
  const examples = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  const gloss = raw
    .replace(/;?\s*"[^"]*"/g, "")
    .replace(/[;\s]+$/, "")
    .trim();
  return { words, sense: { pos, gloss, examples, synonyms: words } };
};

/** Common irregular words: WordNet's package leaves its exception lists out. */
const IRREGULAR: Record<string, string> = {
  be: "am is are was were been being", have: "has had having", do: "does did done doing", go: "goes went gone going",
  say: "says said saying", get: "gets got gotten getting", make: "makes made making", know: "knows knew known knowing",
  think: "thinks thought thinking", take: "takes took taken taking", see: "sees saw seen seeing", come: "comes came coming",
  find: "finds found finding", give: "gives gave given giving", tell: "tells told telling", feel: "feels felt feeling",
  become: "becomes became becoming", leave: "leaves left leaving", put: "puts putting", mean: "means meant meaning",
  keep: "keeps kept keeping", let: "lets letting", begin: "begins began begun beginning", show: "shows showed shown showing",
  hear: "hears heard hearing", run: "runs ran running", hold: "holds held holding", bring: "brings brought bringing",
  write: "writes wrote written writing", sit: "sits sat sitting", stand: "stands stood standing", lose: "loses lost losing",
  pay: "pays paid paying", meet: "meets met meeting", lead: "leads led leading", read: "reads reading", grow: "grows grew grown growing",
  fall: "falls fell fallen falling", send: "sends sent sending", build: "builds built building", understand: "understands understood understanding",
  draw: "draws drew drawn drawing", break: "breaks broke broken breaking", spend: "spends spent spending", cut: "cuts cutting",
  rise: "rises rose risen rising", drive: "drives drove driven driving", buy: "buys bought buying", wear: "wears wore worn wearing",
  choose: "chooses chose chosen choosing", speak: "speaks spoke spoken speaking", eat: "eats ate eaten eating", drink: "drinks drank drunk drinking",
  sing: "sings sang sung singing", swim: "swims swam swum swimming", fly: "flies flew flown flying", throw: "throws threw thrown throwing",
  catch: "catches caught catching", teach: "teaches taught teaching", sleep: "sleeps slept sleeping", win: "wins won winning",
  man: "men", woman: "women", child: "children", foot: "feet", tooth: "teeth", mouse: "mice", goose: "geese", person: "people",
  good: "better best", bad: "worse worst", far: "farther further farthest furthest", little: "less least", many: "more most",
};

export const dictionaryPath = () => join(ensure(paths().cache), "dictionary-1.db");

/** Builds the dictionary (WordNet) the first time: about 150,000 words. */
export const buildDictionary = (): string => {
  const out = dictionaryPath();
  if (existsSync(out)) return out;
  const wordnet = require("wordnet-db") as { path: string };
  const tmp = `${out}.tmp`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(`CREATE TABLE entries (word TEXT PRIMARY KEY, senses TEXT NOT NULL) WITHOUT ROWID;
           CREATE TABLE forms (form TEXT PRIMARY KEY, word TEXT NOT NULL) WITHOUT ROWID;`);
  const senses = new Map<string, Sense[]>();
  for (const part of ["noun", "verb", "adj", "adv"]) {
    for (const line of readFileSync(join(wordnet.path, `data.${part}`), "utf8").split("\n")) {
      const got = parseDataLine(line);
      if (!got) continue;
      for (const w of new Set(got.words.map((x) => x.toLowerCase()))) {
        const list = senses.get(w) ?? [];
        if (list.length < 8) {
          list.push({ ...got.sense, synonyms: got.sense.synonyms.filter((s) => s.toLowerCase() !== w).slice(0, 6) });
        }
        senses.set(w, list);
      }
    }
  }
  db.exec("BEGIN");
  const putEntry = db.prepare("INSERT INTO entries VALUES (?, ?)");
  for (const [w, list] of senses) putEntry.run(w, JSON.stringify(list));
  const putForm = db.prepare("INSERT OR IGNORE INTO forms VALUES (?, ?)");
  for (const [word, forms] of Object.entries(IRREGULAR)) {
    for (const form of forms.split(" ")) putForm.run(form, word);
  }
  db.exec("COMMIT");
  db.exec("VACUUM");
  db.close();
  renameSync(tmp, out);
  return out;
};

/** The base forms a word might come from: "running" -> "run". */
export const baseForms = (word: string): string[] => {
  const w = word.toLowerCase();
  const out = [w];
  const add = (s: string) => {
    if (s.length > 1 && !out.includes(s)) out.push(s);
  };
  for (const [suffix, repl] of [
    ["ies", "y"], ["ves", "f"], ["ves", "fe"], ["es", ""], ["es", "e"], ["s", ""],
    ["ied", "y"], ["ed", ""], ["ed", "e"], ["ing", ""], ["ing", "e"],
    ["ier", "y"], ["iest", "y"], ["er", ""], ["er", "e"], ["est", ""], ["est", "e"], ["ly", ""],
  ] as const) {
    if (!w.endsWith(suffix)) continue;
    const stem = w.slice(0, -suffix.length);
    add(stem + repl);
    // "running" -> "runn" -> "run"
    if (repl === "" && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
  }
  return out;
};

let open: DatabaseSync | undefined;

export const lookup = (word: string): { word: string; senses: Sense[] } | null => {
  open ??= new DatabaseSync(buildDictionary(), { readOnly: true });
  const clean = word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (!clean) return null;
  const entry = open.prepare("SELECT senses FROM entries WHERE word = ?");
  const form = open.prepare("SELECT word FROM forms WHERE form = ?");
  for (const w of baseForms(clean)) {
    const irregular = form.get(w) as { word: string } | undefined;
    for (const c of irregular ? [w, irregular.word] : [w]) {
      const r = entry.get(c) as { senses: string } | undefined;
      if (r) return { word: c, senses: JSON.parse(r.senses) };
    }
  }
  return null;
};
