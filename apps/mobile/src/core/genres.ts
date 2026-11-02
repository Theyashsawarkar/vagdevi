/** Which shelf a book goes on, from the words its library files it under. No React Native here. */
export const SHELVES = [
  ["novels", "Novels"], ["philosophy", "Philosophy"], ["spirituality", "Spirituality"], ["psychology", "Psychology"], ["money", "Money"],
  ["tech", "Tech"], ["science", "Science"], ["poetry", "Poetry"], ["history", "History"], ["other", "Other"],
] as const;
export type ShelfKey = (typeof SHELVES)[number][0];

const RULES: [ShelfKey, RegExp][] = [
  // first: "psychological fiction" and "historical fiction" are novels
  ["novels", /\b(fiction|novels?|romances?|detective|mystery stories|love stories|adventure stories|short stories|horror tales|vampires)\b/i],
  ["spirituality", /\b(hindu\w*|vedanta|upanishads?|bhagavad|gita|yoga|buddhis\w*|spiritual\w*|religio\w*|meditation|mystic\w*|kama ?sutra|sanskrit)\b/i],
  ["psychology", /\b(psycholog\w*|mind and body|behaviou?r|psychoanalysis)\b/i],
  ["philosophy", /\b(philosoph\w*|ethics|stoic\w*|metaphysics|logic)\b/i],
  ["money", /\b(financ\w*|econom\w*|money|wealth|invest\w*|business|banks?|banking|capital)\b/i],
  ["tech", /\b(comput\w*|software|programming|electronic\w*|engineering|technolog\w*|internet|algorithms?|systems? design|data structures)\b/i],
  ["science", /\b(science|scientific|physics|biology|chemistry|astronomy|mathematics|evolution|geology|medicine)\b/i],
  ["poetry", /\b(poetry|poems?|verse|ballads?|sonnets?|epic)\b/i],
  ["history", /\b(history|historical|biography|memoirs?|autobiography|wars?)\b/i],
];

/** Subjects first, then the title: "" when nothing says, so it can be asked again. */
export const genreOf = (words: string[]): ShelfKey | "" => {
  for (const [key, re] of RULES) if (words.some((w) => re.test(w))) return key;
  return "";
};

export const shelfName = (key: string) => SHELVES.find(([k]) => k === key)?.[1] ?? "Other";
