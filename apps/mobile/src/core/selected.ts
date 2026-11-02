import type { CatalogBook } from "./catalog";

// the book the detail screen shows: a catalogue entry is too long for a route
let selected: CatalogBook | null = null;
export const selectBook = (b: CatalogBook) => {
  selected = b;
};
export const selectedBook = () => selected;

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
