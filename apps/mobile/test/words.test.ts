import { describe, expect, it } from "vitest";
import { baseForms, cleanWord, percent } from "../src/core/words";

describe("words", () => {
  it("finds base forms", () => {
    expect(baseForms("running")).toContain("run");
    expect(baseForms("Berries")).toContain("berry");
    expect(baseForms("wolves")).toContain("wolf");
    expect(baseForms("book")).toEqual(["book"]);
  });
  it("strips punctuation, keeps inner apostrophes", () => {
    expect(cleanWord('"hello,"')).toBe("hello");
    expect(cleanWord("don't.")).toBe("don't");
    expect(cleanWord("123")).toBe("");
  });
});

describe("progress", () => {
  it("percent reads sensibly at the ends", () => {
    expect(percent(1, 100)).toBe(0);
    expect(percent(100, 100)).toBe(100);
    expect(percent(1, 1)).toBe(0);
  });
});
