import { describe, expect, it } from "vitest";
import { parseGutenbergSubjects } from "../src/core/catalog";
import { pdfComplete, zipComplete } from "../src/core/files";
import { genreOf } from "../src/core/genres";
import { formatLine } from "../src/core/log.format";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("is the whole file there", () => {
  it("knows a complete ZIP by its end record", () => {
    expect(zipComplete(new Uint8Array([1, 2, 0x50, 0x4b, 0x05, 0x06, 0, 0, 0]))).toBe(true);
    expect(zipComplete(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe(false);
  });
  it("knows a complete PDF by %%EOF, even with bytes after it", () => {
    expect(pdfComplete(bytes("...\nstartxref\n123\n%%EOF\n\n"))).toBe(true);
    expect(pdfComplete(bytes("%PDF-1.7 ... cut off"))).toBe(false);
  });
});

describe("log lines", () => {
  it("are one line each, with level, tag and data", () => {
    const at = new Date("2026-11-02T10:00:00.000Z");
    expect(formatLine("info", "discover", "shelf", { n: 3 }, at)).toBe('2026-11-02T10:00:00.000Z INFO  [discover] shelf {"n":3}');
    expect(formatLine("error", "x", "boom", new Error("bad"), at)).toMatch(/ERROR \[x\] boom \{"error":"bad"/);
  });
});

describe("which shelf a book goes on", () => {
  it("reads the library's subjects", () => {
    expect(genreOf(["England -- Fiction", "Love stories"])).toBe("novels");
    expect(genreOf(["Upanishads", "Hinduism -- Sacred books"])).toBe("spirituality");
    expect(genreOf(["Finance -- United States"])).toBe("money");
    expect(genreOf(["Poetry"])).toBe("poetry");
  });
  it("calls psychological and historical fiction novels", () => {
    expect(genreOf(["Psychological fiction"])).toBe("novels");
    expect(genreOf(["Historical fiction"])).toBe("novels");
  });
  it("can go by the title, and says when it can't tell", () => {
    expect(genreOf(["Reliable computer systems : design and evaluation"])).toBe("tech");
    expect(genreOf(["The Salt Cartographer"])).toBe("");
  });
});

describe("Gutenberg's subjects", () => {
  it("come from the feed's categories", () => {
    expect(parseGutenbergSubjects('<category scheme="x" term="England -- Fiction"/><category term="Love &amp; war"/>')).toEqual(["England -- Fiction", "Love & war"]);
  });
});
