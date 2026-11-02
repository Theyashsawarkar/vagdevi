/** The base forms a word might come from; the server's dictionary uses the same rules. */
export const baseForms = (word: string): string[] => {
  const w = word.toLowerCase();
  const out = [w];
  const add = (s: string) => {
    if (s.length > 1 && !out.includes(s)) out.push(s);
  };
  const rules: [string, string][] = [
    ["ies", "y"], ["ves", "f"], ["ves", "fe"], ["es", ""], ["es", "e"], ["s", ""],
    ["ied", "y"], ["ed", ""], ["ed", "e"], ["ing", ""], ["ing", "e"],
    ["ier", "y"], ["iest", "y"], ["er", ""], ["er", "e"], ["est", ""], ["est", "e"], ["ly", ""],
  ];
  for (const [suffix, repl] of rules) {
    if (!w.endsWith(suffix)) continue;
    const stem = w.slice(0, -suffix.length);
    add(stem + repl);
    if (repl === "" && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
  }
  return out;
};

export const cleanWord = (word: string) => word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");

export const percent = (page: number, total: number) => (total > 1 ? Math.round(((page - 1) / (total - 1)) * 100) : page > 1 ? 100 : 0);

export const fileSize = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
