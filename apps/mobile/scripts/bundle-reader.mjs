// Copies what the reader needs next to it, as plain assets: they load in the
// reader's WebView from the phone's own storage, so reading needs no network.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets", "reader");
mkdirSync(out, { recursive: true });
const dir = (p) => dirname(require.resolve(`${p}/package.json`));
const pdfjs = join(dir("pdfjs-dist"), "legacy", "build");
const marked = dir("marked");
const fonts = (f) => join(dir(`@fontsource/${f}`), "files");
for (const [from, to] of [
  [join(pdfjs, "pdf.min.mjs"), "pdf.mjs.txt"],
  [join(pdfjs, "pdf.worker.min.mjs"), "pdf.worker.mjs.txt"],
  [existsSync(join(marked, "lib", "marked.umd.js")) ? join(marked, "lib", "marked.umd.js") : join(marked, "marked.min.js"), "marked.js.txt"],
  [join(dir("fflate"), "umd", "index.js"), "fflate.js.txt"],
  [join(here, "..", "src", "reader", "reflow.mjs"), "reflow.js.txt"],
  [join(fonts("newsreader"), "newsreader-latin-400-normal.woff2"), "newsreader-400.woff2"],
  [join(fonts("newsreader"), "newsreader-latin-400-italic.woff2"), "newsreader-400i.woff2"],
  [join(fonts("newsreader"), "newsreader-latin-600-normal.woff2"), "newsreader-600.woff2"],
  [join(fonts("literata"), "literata-latin-400-normal.woff2"), "literata-400.woff2"],
  [join(fonts("literata"), "literata-latin-400-italic.woff2"), "literata-400i.woff2"],
  [join(fonts("literata"), "literata-latin-600-normal.woff2"), "literata-600.woff2"],
]) {
  copyFileSync(from, join(out, to));
}
console.log("reader assets ready");
