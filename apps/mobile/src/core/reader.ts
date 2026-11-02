import { Asset } from "expo-asset";
import * as FS from "expo-file-system/legacy";

// Bump when the reader changes, so phones get the new files.
const VERSION = "2";

const FILES: [number, string][] = [
  [require("../../assets/reader/index.html.txt"), "index.html"],
  [require("../../assets/reader/reader.css.txt"), "reader.css"],
  [require("../../assets/reader/reader.js.txt"), "reader.js"],
  [require("../../assets/reader/marked.js.txt"), "marked.js"],
  [require("../../assets/reader/pdf.mjs.txt"), "pdf.mjs"],
  [require("../../assets/reader/pdf.worker.mjs.txt"), "pdf.worker.mjs"],
  [require("../../assets/reader/fflate.js.txt"), "fflate.js"],
  [require("../../assets/reader/reflow.js.txt"), "reflow.js"],
  [require("../../assets/reader/newsreader-400.woff2"), "newsreader-400.woff2"],
  [require("../../assets/reader/newsreader-400i.woff2"), "newsreader-400i.woff2"],
  [require("../../assets/reader/newsreader-600.woff2"), "newsreader-600.woff2"],
  [require("../../assets/reader/literata-400.woff2"), "literata-400.woff2"],
  [require("../../assets/reader/literata-400i.woff2"), "literata-400i.woff2"],
  [require("../../assets/reader/literata-600.woff2"), "literata-600.woff2"],
];

export const readerDir = () => `${FS.documentDirectory}reader/`;

/** Puts the reader's files on the phone once: it needs nothing else to run. */
export const prepareReader = async (): Promise<string> => {
  const dir = readerDir();
  const stamp = `${dir}.version`;
  const have = await FS.readAsStringAsync(stamp).catch(() => "");
  if (have !== VERSION || __DEV__) {
    await FS.deleteAsync(dir, { idempotent: true });
    await FS.makeDirectoryAsync(dir, { intermediates: true });
    for (const [mod, name] of FILES) {
      const a = Asset.fromModule(mod);
      await a.downloadAsync();
      if (!a.localUri) throw new Error(`reader: ${name}`);
      await FS.copyAsync({ from: a.localUri, to: dir + name });
    }
    await FS.writeAsStringAsync(stamp, VERSION);
  }
  return `${dir}index.html`;
};
