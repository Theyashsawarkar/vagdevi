import { Asset } from "expo-asset";
import * as FS from "expo-file-system/legacy";
import { log } from "./log";
import { PDF_FILES } from "./reader-files";
import { READER_VERSION as VERSION } from "./reader-version";


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

let preparing: Promise<string> | null = null;

const copyIn = async (mod: number, to: string) => {
  const a = Asset.fromModule(mod);
  await a.downloadAsync();
  if (!a.localUri) throw new Error(`reader: ${to}`);
  await FS.copyAsync({ from: a.localUri, to });
};

/** Puts the reader's files on the phone once: it needs nothing else to run. */
export const prepareReader = (): Promise<string> =>
  (preparing ??= (async () => {
    const dir = readerDir();
    const stamp = `${dir}.version`;
    const have = await FS.readAsStringAsync(stamp).catch(() => "");
    if (have !== VERSION) {
      const t0 = Date.now();
      await FS.deleteAsync(dir, { idempotent: true });
      for (const sub of ["", "pdf/wasm/", "pdf/cmaps/", "pdf/standard_fonts/", "pdf/iccs/"]) await FS.makeDirectoryAsync(dir + sub, { intermediates: true });
      for (const [mod, name] of FILES) await copyIn(mod, dir + name);
      // a few at a time: there are some two hundred small ones
      const rest = [...PDF_FILES];
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          for (let f = rest.pop(); f; f = rest.pop()) await copyIn(f[0], `${dir}pdf/${f[1]}`);
        }),
      );
      await FS.writeAsStringAsync(stamp, VERSION);
      log.info("reader", "files ready", { version: VERSION, ms: Date.now() - t0 });
    }
    return `${dir}index.html`;
  })().catch((e) => {
    preparing = null;
    log.error("reader", "couldn't prepare files", e instanceof Error ? e : { e: String(e) });
    throw e;
  }));
