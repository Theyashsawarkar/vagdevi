// Turns the loose text of a PDF back into a book's paragraphs. A PDF only says
// "put these letters here", so lines, columns, headings and paragraphs are worked
// out from where the letters sit. No DOM in here, so it can be tested.

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export const escapeHTML = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Items ({str,x,y,w,h}) into lines, top of the page first. */
export function buildLines(items) {
  const clean = items.filter((i) => i.str && i.str.trim() && i.h > 0);
  clean.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of clean) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < Math.min(r.h, it.h) * 0.5);
    if (row) {
      row.items.push(it);
      row.h = Math.max(row.h, it.h);
    } else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  const lines = rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = "";
    let end = r.items[0].x;
    for (const it of r.items) {
      if (text && !text.endsWith(" ") && !it.str.startsWith(" ") && it.x - end > it.h * 0.16) text += " ";
      text += it.str;
      end = it.x + it.w;
    }
    const size = median(r.items.flatMap((i) => Array(Math.max(1, i.str.length)).fill(i.h)));
    return { text: text.normalize("NFKC").replace(/\s+/g, " ").trim(), x0: r.items[0].x, x1: end, y: r.y, size };
  });
  return lines.filter((l) => l.text).sort((a, b) => b.y - a.y);
}

/** Puts a two-column page in reading order: across-the-page lines stay in place. */
export function orderColumns(lines, pageW) {
  const mid = pageW / 2;
  const slack = pageW * 0.03;
  const left = lines.filter((l) => l.x1 < mid + slack);
  const right = lines.filter((l) => l.x0 > mid - slack);
  const across = lines.filter((l) => !left.includes(l) && !right.includes(l));
  if (left.length < 6 || right.length < 6 || across.length > lines.length * 0.2) return lines;
  const columnsTop = Math.max(left[0].y, right[0].y);
  const above = across.filter((l) => l.y > columnsTop);
  const below = across.filter((l) => l.y <= columnsTop);
  return [...above, ...left, ...right, ...below];
}

const runningKey = (s) => s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const isFolio = (s) => /^[\s\-–—.]*(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—.]*$/i.test(s);

/** Takes away page numbers, and the running heads repeated on page after page. */
export function stripRunning(pages) {
  const seen = new Map();
  for (const p of pages) {
    const edge = new Set([...p.lines.slice(0, 2), ...p.lines.slice(-2)].map((l) => runningKey(l.text)));
    for (const k of edge) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const limit = Math.max(3, pages.length * 0.12);
  return pages.map((p) => {
    const edge = new Set([...p.lines.slice(0, 2), ...p.lines.slice(-2)]);
    return { ...p, lines: p.lines.filter((l) => !edge.has(l) || !(isFolio(l.text) || (seen.get(runningKey(l.text)) ?? 0) >= limit)) };
  });
}

const ENDS = /[.!?:;…"”’)\]]$/;

/** The stream of paragraphs, headings and pictures. A paragraph may cross a page. */
export function toBlocks(pages) {
  const sizes = [];
  for (const p of pages) for (const l of p.lines) for (let i = 0; i < Math.min(l.text.length, 80); i += 8) sizes.push(Math.round(l.size * 2) / 2);
  const counts = new Map();
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);
  const body = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;

  const gaps = [];
  for (const p of pages) for (let i = 1; i < p.lines.length; i++) {
    const g = p.lines[i - 1].y - p.lines[i].y;
    if (g > 0 && g < body * 3) gaps.push(g);
  }
  const lead = median(gaps) || body * 1.25;

  const blocks = [];
  const pageStart = {};
  let para = null;
  const flush = () => {
    if (para) blocks.push(para);
    para = null;
  };
  const append = (l) => {
    if (para.text.endsWith("-") && /^\p{Ll}/u.test(l.text) && /\p{L}-$/u.test(para.text)) para.text = para.text.slice(0, -1) + l.text;
    else if (para.text.endsWith("­")) para.text = para.text.slice(0, -1) + l.text;
    else para.text += ` ${l.text}`;
  };

  for (const p of pages) {
    pageStart[p.n] = blocks.length + (para ? 1 : 0);
    const left = median(p.lines.filter((l) => Math.abs(l.size - body) < 1).map((l) => l.x0));
    const right = Math.max(0, ...p.lines.map((l) => l.x1));
    const pics = [...(p.images ?? [])].sort((a, b) => b.y - a.y);
    let prev = null;
    for (const l of p.lines) {
      while (pics.length && pics[0].y > l.y) {
        flush();
        blocks.push({ tag: "img", ...pics.shift() });
      }
      const heading = l.size >= body * 1.18 && l.text.length < 120;
      if (heading) {
        const tag = l.size >= body * 1.45 ? "h2" : "h3";
        if (para?.tag === tag && prev && prev.y - l.y < l.size * 1.8) para.text += ` ${l.text}`;
        else {
          flush();
          para = { tag, text: l.text };
        }
        prev = l;
        continue;
      }
      const small = l.size < body * 0.85;
      if (para && para.tag !== (small ? "small" : "p")) flush();
      if (!para) {
        para = { tag: small ? "small" : "p", text: l.text };
        prev = l;
        continue;
      }
      if (!prev) {
        // a new page: the sentence carries on unless it had ended
        const continues = !ENDS.test(para.text) || /^\p{Ll}/u.test(l.text);
        if (continues && l.x0 - left <= body * 0.8) append(l);
        else {
          flush();
          para = { tag: "p", text: l.text };
        }
        prev = l;
        continue;
      }
      const gap = prev.y - l.y;
      const indent = l.x0 - left > body * 0.8 && prev.x0 - left <= body * 0.8;
      const shortPrev = prev.x1 < right - body * 3 && ENDS.test(prev.text);
      const newColumn = gap < 0;
      if (gap > lead * 1.45 || indent || (shortPrev && !newColumn)) {
        flush();
        para = { tag: small ? "small" : "p", text: l.text };
      } else append(l);
      prev = l;
    }
    if (pics.length) {
      flush();
      for (const pic of pics) blocks.push({ tag: "img", ...pic });
    }
  }
  flush();
  return { blocks, pageStart, body };
}

export const blockHTML = (b) => {
  if (b.tag === "img") return `<figure><img src="${escapeHTML(b.src ?? "")}" width="${b.width}" height="${b.height}" alt=""></figure>`;
  if (b.tag === "small") return `<p class="small">${escapeHTML(b.text)}</p>`;
  return `<${b.tag}>${escapeHTML(b.text)}</${b.tag}>`;
};

/** Cuts the stream into runs short enough to lay out quickly, at headings if it can. */
export function toSections(blocks, pageStart, limit = 40000) {
  const sections = [];
  const blockSection = [];
  let cur = "";
  blocks.forEach((b, i) => {
    const html = blockHTML(b);
    if (cur && (cur.length + html.length > limit || (b.tag === "h2" && cur.length > limit / 8))) {
      sections.push(cur);
      cur = "";
    }
    blockSection[i] = sections.length;
    cur += html;
  });
  if (cur) sections.push(cur);
  const pageSection = {};
  for (const [page, at] of Object.entries(pageStart)) pageSection[page] = blockSection[Math.min(at, blocks.length - 1)] ?? 0;
  return { sections, pageSection };
}

/** Which kind of PDF a sample of its pages shows. */
export function classify(sample) {
  if (!sample.length) return "digital";
  const noText = sample.filter((p) => p.chars < 40).length;
  const fullImage = sample.filter((p) => p.fullImage).length;
  if (noText > sample.length * 0.6) return "scanned"; // pictures of pages and no text under them
  if (fullImage > sample.length * 0.6) return "ocr"; // scans with recognised text beneath
  return "digital";
}

/** A saved place, in a book now laid out to a different number of pages. */
export const rescale = (page, savedTotal, total) => {
  if (!savedTotal || savedTotal === total || savedTotal < 2) return Math.min(Math.max(page || 1, 1), total);
  return Math.min(Math.max(1 + Math.round(((page - 1) / (savedTotal - 1)) * (total - 1)), 1), total);
};
