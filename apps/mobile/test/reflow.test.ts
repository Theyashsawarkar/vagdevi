import { describe, expect, it } from "vitest";
import { buildLines, classify, guessContents, orderColumns, rescale, stripRunning, tidyTitle, toBlocks, toSections } from "../src/reader/reflow.mjs";

const line = (text: string, y: number, x = 72, size = 12, w = 400) => ({ str: text, x, y, w, h: size });
const page = (n: number, items: ReturnType<typeof line>[]) => ({ n, lines: buildLines(items), images: [] });

describe("lines", () => {
  it("joins pieces of one line, left to right, with spaces where there's a gap", () => {
    const [l] = buildLines([line("world", 700, 130, 12, 30), line("hello", 700, 72, 12, 30)]);
    expect(l?.text).toBe("hello world");
  });
  it("keeps separate lines top first", () => {
    expect(buildLines([line("b", 680), line("a", 700)]).map((l: { text: string }) => l.text)).toEqual(["a", "b"]);
  });
});

describe("paragraphs", () => {
  it("rejoins words split across lines and paragraphs split across pages", () => {
    const { blocks } = toBlocks([
      page(1, [line("The tide came up through the salt pans and the wa-", 700), line("ter went out by a different road and it did not", 686)]),
      page(2, [line("stop there at all.", 700, 72, 12, 90)]),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("The tide came up through the salt pans and the water went out by a different road and it did not stop there at all.");
  });
  it("rejoins a word cut at the foot of a page, even if the next page is indented", () => {
    const { blocks } = toBlocks([page(1, [line("Activities such as preventive mainte-", 700)]), page(2, [line("nance and repair reduce the time.", 700, 110), line("A second line of the page here", 686)])]);
    expect(blocks[0].text.startsWith("Activities such as preventive maintenance and repair")).toBe(true);
  });
  it("starts a new paragraph at an indent or after a short line", () => {
    const { blocks } = toBlocks([
      page(1, [
        line("First paragraph goes on across the whole width here", 700),
        line("and it ends.", 686, 72, 12, 60),
        line("Second paragraph begins here across the whole width", 672),
        line("Third starts with an indent, as books do it", 658, 92, 12, 380),
      ]),
    ]);
    expect(blocks.map((b: { text: string }) => b.text.split(" ")[0])).toEqual(["First", "Second", "Third"]);
  });
  it("finds headings by size", () => {
    const body = Array.from({ length: 6 }, (_, i) => line("Some ordinary sentence of text across the page width", 600 - i * 14));
    const { blocks } = toBlocks([page(1, [line("Chapter One", 700, 200, 22, 200), ...body])]);
    expect(blocks[0]).toMatchObject({ tag: "h2", text: "Chapter One" });
  });
  it("doesn't let a page's text through as markup", () => {
    const { blocks, pageStart } = toBlocks([page(1, [line("<script>alert(1)</script>", 700)])]);
    expect(toSections(blocks, pageStart).sections[0]).toContain("&lt;script&gt;");
  });
});

describe("page furniture", () => {
  it("drops page numbers and running heads, keeps the text", () => {
    const pages = ["Marta walked", "The gulls watched", "Teo sank twice", "A creek vanished"].map((t, i) =>
      page(i + 1, [line("THE SALT CARTOGRAPHER", 760), line(t, 700), line(`${t} again`, 686), line("More body", 672), line(String(i + 11), 40)]),
    );
    const text = stripRunning(pages).flatMap((p: { lines: { text: string }[] }) => p.lines.map((l) => l.text));
    expect(text).not.toContain("THE SALT CARTOGRAPHER");
    expect(text).not.toContain("11");
    expect(text).toContain("Marta walked");
  });
});

describe("columns", () => {
  it("reads the left column before the right", () => {
    const items = Array.from({ length: 8 }, (_, i) => [line(`L${i}`, 700 - i * 14, 40, 12, 200), line(`R${i}`, 700 - i * 14, 330, 12, 200)]).flat();
    const lines = orderColumns(buildLines(items), 595);
    expect(lines.length).toBeGreaterThan(0);
  });
  it("leaves a single column alone", () => {
    const lines = buildLines(Array.from({ length: 8 }, (_, i) => line(`Across ${i}`, 700 - i * 14)));
    expect(orderColumns(lines, 595)).toEqual(lines);
  });
});

describe("kinds of PDF", () => {
  it("tells them apart", () => {
    expect(classify([{ chars: 2000, fullImage: false }, { chars: 1800, fullImage: false }])).toBe("digital");
    expect(classify([{ chars: 2, fullImage: true }, { chars: 0, fullImage: true }])).toBe("scanned");
    expect(classify([{ chars: 1500, fullImage: true }, { chars: 1600, fullImage: true }])).toBe("ocr");
  });
});

describe("your place", () => {
  it("survives a new layout", () => {
    expect(rescale(50, 100, 200)).toBe(99);
    expect(rescale(1, 100, 200)).toBe(1);
    expect(rescale(100, 100, 300)).toBe(300);
    expect(rescale(7, 0, 20)).toBe(7);
    expect(rescale(30, 30, 20)).toBe(20);
  });
});

describe("finding chapters in a PDF with no list of them", () => {
  const body = (y: number, n = 6) => Array.from({ length: n }, (_, i) => line("Ordinary running text across the whole of the page width", y - i * 14));
  it("finds large headings and named chapters, with their pages", () => {
    const pages = [
      page(1, [line("Chapter I", 700, 200, 20, 120), ...body(660)]),
      page(2, body(700)),
      page(3, [line("Chapter II", 700, 72, 12, 80), ...body(660)]),
      page(4, [line("A Larger Heading", 700, 150, 20, 200), ...body(660)]),
    ];
    expect(guessContents(pages).map((c: { title: string; pdfPage: number }) => [c.title, c.pdfPage])).toEqual([["Chapter I", 1], ["Chapter II", 3], ["A Larger Heading", 4]]);
  });
  it("isn't fooled by a running head set large on every page", () => {
    const pages = [1, 2, 3, 4, 5, 6].map((n) => page(n, [line("THE BOOK OF THINGS", 760, 150, 18, 200), ...body(700)]));
    expect(guessContents(pages)).toEqual([]);
  });
  it("finds nothing in plain text", () => {
    expect(guessContents([page(1, body(700)), page(2, body(700))])).toEqual([]);
  });
});

describe("contents titles", () => {
  it("drop a picture's caption in front of a chapter", () => {
    expect(tidyTitle("A note for Miss Bennet. CHAPTER VII.")).toBe("CHAPTER VII.");
    expect(tidyTitle("\u201cTo assure you in the most animated language.\u201d CHAPTER XIX.")).toBe("CHAPTER XIX.");
  });
  it("leave ordinary titles alone", () => {
    expect(tidyTitle("Chapter 3. The Survey")).toBe("Chapter 3. The Survey");
    expect(tidyTitle("The Salt   Cartographer")).toBe("The Salt Cartographer");
    expect(tidyTitle("Mr. Darcy and the Part 2 question")).toBe("Mr. Darcy and the Part 2 question");
  });
});

describe("page anchors", () => {
  it("mark where each PDF page begins", () => {
    const { blocks, pageStart } = toBlocks([page(1, [line("First page text goes here.", 700)]), page(2, [line("Second page starts a new paragraph.", 700, 92)])]);
    expect(toSections(blocks, pageStart).sections.join("")).toContain('<span data-a="p2"></span>');
  });
});

describe("recognised text from a scan", () => {
  it("isn't taken for headings because its line heights wobble", () => {
    const sizes = [10, 13, 15, 11, 14, 10, 15, 12];
    const items = sizes.map((h, i) => line(`Ordinary sentence number ${i} running across the whole page width`, 700 - i * 16, 72, h));
    const { blocks } = toBlocks([page(1, items)], { noisy: true });
    expect(blocks.every((b: { tag: string }) => b.tag === "p")).toBe(true);
  });
  it("still finds a real heading", () => {
    const items = [line("Fundamental Concepts", 720, 150, 26, 240), ...Array.from({ length: 6 }, (_, i) => line("Ordinary sentence running across the page", 680 - i * 16, 72, 12))];
    expect(toBlocks([page(1, items)], { noisy: true }).blocks[0]).toMatchObject({ tag: "h2", text: "Fundamental Concepts" });
  });
});
