import { Asset } from "expo-asset";
import * as FS from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { baseForms, cleanWord } from "./words";

export type Sense = { pos: string; gloss: string; examples: string[]; synonyms: string[] };
export type Definition = { word: string; senses: Sense[] };

// Bump when the bundled dictionary changes, so phones copy the new one.
const NAME = "dictionary-1.db";
const dir = () => `${FS.documentDirectory}SQLite/`;

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/** The dictionary comes inside the app; the first lookup puts it where SQLite reads it. */
const open = () =>
  (opening ??= (async () => {
    const info = await FS.getInfoAsync(dir() + NAME);
    if (!info.exists) {
      const a = Asset.fromModule(require("../../assets/dict/dictionary.db"));
      await a.downloadAsync();
      if (!a.localUri) throw new Error("dictionary missing");
      await FS.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
      await FS.copyAsync({ from: a.localUri, to: `${dir()}${NAME}.part` });
      await FS.moveAsync({ from: `${dir()}${NAME}.part`, to: dir() + NAME });
    }
    return SQLite.openDatabaseSync(NAME);
  })().catch((e) => {
    opening = null;
    throw e;
  }));

/** Looks a word up on the phone, trying its base forms (ran → run, berries → berry). */
export const define = async (raw: string): Promise<Definition | null> => {
  const clean = cleanWord(raw);
  if (!clean) return null;
  const db = await open();
  for (const w of baseForms(clean)) {
    const form = db.getFirstSync<{ word: string }>("SELECT word FROM forms WHERE form = ?", w);
    for (const c of form ? [w, form.word] : [w]) {
      const r = db.getFirstSync<{ senses: string }>("SELECT senses FROM entries WHERE word = ?", c);
      if (r) return { word: c, senses: JSON.parse(r.senses) as Sense[] };
    }
  }
  return null;
};
