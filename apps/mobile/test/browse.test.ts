import { afterEach, describe, expect, it, vi } from "vitest";
import { browse, type Shelf } from "../src/core/catalog";

const opds = `<feed><entry><id>https://www.gutenberg.org/ebooks/1.opds</id><title>Gita</title><content type="text">Vyasa</content></entry></feed>`;

afterEach(() => vi.unstubAllGlobals());

describe("Discover", () => {
  it("shows each shelf as its library answers, and a dead library doesn't hold up the rest", async () => {
    vi.stubGlobal("fetch", (url: string, init: { signal: AbortSignal }) => {
      if (url.includes("gutenberg")) return Promise.resolve(new Response(opds));
      if (url.includes("archive.org")) return Promise.reject(new Error("network down"));
      // Standard Ebooks never answers: only the time limit ends it
      return new Promise((_, no) => init.signal.addEventListener("abort", () => no(new Error("aborted"))));
    });
    vi.useFakeTimers();
    const seen: Shelf[] = [];
    const done = browse("", "en", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(10);
    // both answered before the slow one: in whatever order they came
    expect(Object.fromEntries(seen.map((s) => [s.source, s.state]))).toEqual({ "Project Gutenberg": "ready", "Internet Archive": "failed" });
    expect(seen.find((s) => s.source === "Project Gutenberg")?.books[0]?.title).toBe("Gita");
    await vi.advanceTimersByTimeAsync(16000);
    await done;
    expect(seen.at(-1)).toMatchObject({ source: "Standard Ebooks", state: "failed" });
    vi.useRealTimers();
  });
  it("a genre goes to each library in its own words", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(decodeURIComponent(url).replace(/\+/g, " "));
      return Promise.resolve(new Response(url.includes("archive.org") ? JSON.stringify({ response: { docs: [] } }) : "<feed></feed>"));
    });
    await browse("", "en", () => undefined, "psychology");
    expect(asked.find((u) => u.includes("gutenberg"))).toContain("s.psychology !s.fiction l.en");
    expect(asked.find((u) => u.includes("archive.org"))).toContain("subject:(psychology)");
    expect(asked.find((u) => u.includes("standardebooks"))).toContain("query=psychology");
  });
  it("asks Standard Ebooks only in English", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(url);
      return Promise.resolve(new Response(url.includes("gutenberg") ? opds : JSON.stringify({ response: { docs: [] } })));
    });
    await browse("", "sa", () => undefined);
    expect(asked.some((u) => u.includes("standardebooks"))).toBe(false);
    expect(decodeURIComponent(asked.find((u) => u.includes("gutenberg")) ?? "")).toContain("l.sa");
  });
});
