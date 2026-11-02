import { subjectsOf } from "./catalog";
import { allBooks, setGenre } from "./db";
import { genreOf } from "./genres";
import { log } from "./log";

/** Puts books with no genre on a shelf: from the library's subjects, else their titles. */
export const classifyLibrary = async () => {
  for (const b of allBooks().filter((x) => !x.genre)) {
    let subjects: string[] = [];
    try {
      subjects = await subjectsOf(b.id, b.title);
    } catch {
      // no connection: the title may be enough, and it's tried again next time
    }
    const genre = genreOf(subjects) || genreOf([b.title]);
    log.debug("library", "genre", { id: b.id, genre, subjects: subjects.length });
    if (genre) setGenre([b.id], genre);
    else if (subjects.length || !b.source_url) setGenre([b.id], "other");
  }
};
