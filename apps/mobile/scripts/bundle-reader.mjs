// Copies what the reader needs next to it, as plain assets: they load in the
// reader's WebView from the phone's own storage, so reading needs no network.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// pdf.js's helpers: image decoders for scans (JPEG 2000, JBIG2), fonts for PDFs
// that don't embed theirs, character maps for Chinese, Japanese and Korean
const pdfRoot = dir("pdfjs-dist");
const data = join(out, "pdf");
rmSync(data, { recursive: true, force: true });
const files = [];
for (const sub of ["wasm", "cmaps", "standard_fonts", "iccs"]) {
  mkdirSync(join(data, sub), { recursive: true });
  for (const f of readdirSync(join(pdfRoot, sub))) {
    if (f.startsWith("LICENSE") || f.endsWith(".js") || f.endsWith(".mjs")) continue;
    copyFileSync(join(pdfRoot, sub, f), join(data, sub, f));
    files.push(`${sub}/${f}`);
  }
}
writeFileSync(
  join(here, "..", "src", "core", "reader-files.ts"),
  `// Written by scripts/bundle-reader.mjs\nexport const PDF_FILES: [number, string][] = [\n${files.map((f) => `  [require("../../assets/reader/pdf/${f}"), "${f}"],`).join("\n")}\n];\n`,
);

// the phone copies the reader again whenever any of its files changes
const hash = createHash("sha256");
for (const f of readdirSync(out, { recursive: true }).sort()) {
  const p = join(out, f);
  if (statSync(p).isFile()) hash.update(f).update(readFileSync(p));
}
writeFileSync(join(here, "..", "src", "core", "reader-version.ts"), `// Written by scripts/bundle-reader.mjs\nexport const READER_VERSION = "${hash.digest("hex").slice(0, 16)}";\n`);
console.log("reader assets ready");
