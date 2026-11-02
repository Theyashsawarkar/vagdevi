import type { CatalogBook } from "./catalog";

// the book the detail screen shows: a catalogue entry is too long for a route
let selected: CatalogBook | null = null;
let fromGenre = "";
export const selectBook = (b: CatalogBook, genre = "") => {
  selected = b;
  fromGenre = genre;
};
export const selectedBook = () => selected;
/** The genre you were browsing when you picked it. */
export const selectedGenre = () => fromGenre;

// a file another app asked us to open
let incoming: string | null = null;
export const setIncoming = (uri: string) => {
  incoming = uri;
};
export const takeIncoming = () => {
  const u = incoming;
  incoming = null;
  return u;
};
