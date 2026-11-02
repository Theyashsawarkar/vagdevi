import { describe, expect, it } from "vitest";
import { nameOrder, parseArchive, parseArchiveFiles, parseGutendex, parseStandardEbooks } from "../src/core/catalog";

describe("Project Gutenberg", () => {
  const body = (over: object) => JSON.stringify({ results: [{ id: 1342, title: "Pride and Prejudice", authors: [{ name: "Austen, Jane" }], summaries: ["A novel."], copyright: false, formats: { "application/epub+zip": "http://www.gutenberg.org/ebooks/1342.epub3.images", "image/jpeg": "https://www.gutenberg.org/cache/epub/1342/cover.jpg" }, ...over }] });
  it("reads a book, always over HTTPS", () => {
    const [b] = parseGutendex(body({}));
    expect(b).toMatchObject({ key: "pg1342", author: "Jane Austen", kind: "epub", url: "https://www.gutenberg.org/ebooks/1342.epub3.images" });
  });
  it("leaves out anything marked as under copyright", () => {
    expect(parseGutendex(body({ copyright: true }))).toEqual([]);
    expect(parseGutendex(body({ copyright: null }))).toEqual([]);
  });
  it("leaves out books with no EPUB", () => {
    expect(parseGutendex(body({ formats: {} }))).toEqual([]);
  });
});

describe("Standard Ebooks", () => {
  const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><entry><id>https://standardebooks.org/ebooks/mary-shelley/frankenstein</id><title>Frankenstein</title><author><name>Mary Shelley</name></author><summary type="text">A monster.</summary><media:thumbnail url="https://standardebooks.org/c.jpg" width="350" height="525"/>
  <link href="https://standardebooks.org/ebooks/mary-shelley/frankenstein" rel="alternate" type="application/xhtml+xml"/>
  <link href="https://standardebooks.org/x/f_advanced.epub?source=feed" length="9" rel="enclosure"/>
  <link href="https://standardebooks.org/x/f.kepub.epub?source=feed" length="8" rel="enclosure"/>
  <link href="https://standardebooks.org/x/f.epub?source=feed" length="7" rel="enclosure"/></entry></feed>`;
  it("picks the plain EPUB", () => {
    const [b] = parseStandardEbooks(feed);
    expect(b).toMatchObject({ title: "Frankenstein", author: "Mary Shelley", about: "A monster.", url: "https://standardebooks.org/x/f.epub?source=feed", size: 7, cover: "https://standardebooks.org/c.jpg" });
    expect(b?.key).toMatch(/^[a-z0-9-]+$/i);
  });
  it("copes with an empty feed", () => {
    expect(parseStandardEbooks('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toEqual([]);
  });
});

describe("Internet Archive", () => {
  it("cleans up names and descriptions", () => {
    const [b] = parseArchive(JSON.stringify({ response: { docs: [{ identifier: "panch00ryde", title: "The Panchatantra", creator: ["Ryder, Arthur W, 1877-1938"], description: "<p>Tales</p>" }] } }));
    expect(b).toMatchObject({ key: "ia-panch00ryde", author: "Arthur W Ryder", about: "Tales", kind: "pdf", ia: "panch00ryde", url: null });
  });
  it("takes the smallest PDF that has text", () => {
    const f = parseArchiveFiles("x y", JSON.stringify({ result: [{ name: "a.pdf", format: "Image Container PDF", size: "1" }, { name: "big.pdf", format: "Text PDF", size: "90" }, { name: "sub/sm all.pdf", format: "Text PDF", size: "30" }] }));
    expect(f).toEqual({ url: "https://archive.org/download/x%20y/sub/sm%20all.pdf", size: 30 });
  });
  it("says so when there's no PDF", () => {
    expect(parseArchiveFiles("x", JSON.stringify({ result: [] }))).toBeNull();
  });
});

it("turns names around", () => {
  expect(nameOrder("Austen, Jane")).toBe("Jane Austen");
  expect(nameOrder("Homer")).toBe("Homer");
  expect(nameOrder("Melville, Herman, 1819-1891")).toBe("Herman Melville");
});
