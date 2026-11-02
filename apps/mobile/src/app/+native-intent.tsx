import { setIncoming } from "../core/selected";

// A PDF or EPUB opened from another app arrives as a content:// link, not a route.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.startsWith("content://") || path.startsWith("file://")) {
    setIncoming(path);
    return "/";
  }
  return path;
}
