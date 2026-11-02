// Builds the English dictionary (WordNet, about 150,000 words) into the app,
// so looking a word up never needs a connection.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets", "dict", "dictionary.db");
if (existsSync(out)) process.exit(0);
const home = mkdtempSync(join(tmpdir(), "vagdevi-dict-"));
process.env.VAGDEVI_HOME = home;
const { buildDictionary } = await import("../../server/dist/dictionary.js");
mkdirSync(dirname(out), { recursive: true });
copyFileSync(buildDictionary(), out);
rmSync(home, { recursive: true, force: true });
console.log("dictionary ready");
