import { describe, expect, it } from "vitest";
import { mergeShelves, nameOrder, parseArchive, parseArchiveFiles, parseGutenberg, parseGutenbergEditions, parseStandardEbooks, type Shelf } from "../src/core/catalog";

describe("Project Gutenberg", () => {
  const feed = `<feed><entry><id>https://www.gutenberg.org/ebooks/authors/search.opds/?query=x</id><title>Authors</title></entry>
  <entry><id>https://www.gutenberg.org/ebooks/1232.opds</id><title>The Prince &amp; Others</title><content type="text">Niccol\u00f2 Machiavelli</content></entry></feed>`;
  it("reads books and skips the feed's other links", () => {
    expect(parseGutenberg(feed)).toEqual([expect.objectContaining({ key: "pg1232", title: "The Prince & Others", author: "Niccol\u00f2 Machiavelli", kind: "epub", url: "https://www.gutenberg.org/ebooks/1232.epub3.images", cover: "https://www.gutenberg.org/cache/epub/1232/pg1232.cover.medium.jpg" })]);
  });
  it("finds both editions and their sizes", () => {
    const e = parseGutenbergEditions(`<link type="application/epub+zip" rel="a" title="no images" length="609138" href="https://www.gutenberg.org/ebooks/1342.epub.noimages"/><link type="application/x-mobipocket-ebook" length="1" href="https://x/k"/><link type="application/epub+zip" rel="a" length="24864457" href="https://www.gutenberg.org/ebooks/1342.epub3.images"/>`);
    expect(e.plain).toEqual({ url: "https://www.gutenberg.org/ebooks/1342.epub.noimages", size: 609138 });
    expect(e.pictures?.size).toBe(24864457);
  });
});

describe("one list from every library", () => {
  const shelf = (source: Shelf["source"], titles: string[]): Shelf => ({ title: "", note: "", source, state: "ready", books: titles.map((title) => ({ key: title, source, title, author: "", cover: null, about: "", kind: "epub", url: null, size: 0, rights: "" })) });
  it("takes turns, and never lists a book twice", () => {
    const m = mergeShelves([shelf("Standard Ebooks", ["Meditations", "The Republic"]), shelf("Project Gutenberg", ["Walden", "Meditations", "Leviathan"])]);
    expect(m.map((b) => b.title)).toEqual(["Meditations", "Walden", "The Republic", "Leviathan"]);
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
