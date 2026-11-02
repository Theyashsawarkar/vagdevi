#!/usr/bin/env python3
"""Writes src/core/starter.json: book names and links from every library, so
Discover shows books the instant the app first opens, before any network.
Run it now and then; the app replaces these with live answers."""
import json, os, re, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RIGHTS = "Public domain in the US; check local law elsewhere"
GENRES = {
    "all": ("", ""), "novels": ("s.fiction", "fiction"), "philosophy": ("s.philosophy", "philosophy"),
    "spirituality": ("s.hinduism", "spirituality"), "psychology": ("s.psychology !s.fiction", "psychology"),
    "money": ("s.finance !s.fiction", "money"), "tech": ("s.computers", "technology"),
    "science": ("s.science !s.fiction", "science"), "poetry": ("s.poetry", "poetry"), "history": ("s.history !s.fiction", "history"),
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode()


def unesc(t):
    return re.sub(r"\s+", " ", t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")).strip()


def gutenberg(q):
    query = " ".join(x for x in (q, "l.en") if x)
    text = get("https://www.gutenberg.org/ebooks/search.opds/?" + urllib.parse.urlencode({"query": query, "sort_order": "downloads"}))
    out = []
    for e in re.findall(r"<entry>.*?</entry>", text, re.S):
        m = re.search(r"<id>[^<]*/ebooks/(\d+)\.opds</id>", e)
        title = re.search(r"<title>([^<]*)</title>", e)
        if not m or not title:
            continue
        i = m.group(1)
        author = re.search(r"<content[^>]*>([^<]*)</content>", e)
        out.append({"key": f"pg{i}", "source": "Project Gutenberg", "title": unesc(title.group(1)), "author": unesc(author.group(1)) if author else "",
                    "cover": f"https://www.gutenberg.org/cache/epub/{i}/pg{i}.cover.medium.jpg", "about": "", "kind": "epub",
                    "url": f"https://www.gutenberg.org/ebooks/{i}.epub3.images", "size": 0, "rights": RIGHTS})
    return out[:14]


def standard(q):
    url = "https://standardebooks.org/feeds/atom/all?query=" + urllib.parse.quote(q) if q else "https://standardebooks.org/feeds/atom/new-releases"
    out = []
    for e in re.findall(r"<entry>.*?</entry>", get(url), re.S):
        link = next((l for l in re.findall(r'<link href="([^"]+\.epub\?[^"]*)"[^>]*length="(\d+)"', e) if "_advanced" not in l[0] and ".kepub" not in l[0]), None)
        book = re.search(r"<id>https://standardebooks.org/ebooks/([^<]+)</id>", e)
        if not link or not book:
            continue
        thumb = re.search(r'<media:thumbnail[^>]*url="([^"]+)"', e)
        about = re.search(r"<summary[^>]*>([^<]*)</summary>", e)
        out.append({"key": "se-" + re.sub(r"[^a-z0-9]+", "-", book.group(1), flags=re.I)[:80], "source": "Standard Ebooks", "title": unesc(re.search(r"<title>([^<]*)</title>", e).group(1)),
                    "author": unesc(re.search(r"<name>([^<]*)</name>", e).group(1)), "cover": thumb.group(1) if thumb else None, "about": unesc(about.group(1)) if about else "",
                    "kind": "epub", "url": link[0].replace("&amp;", "&"), "size": int(link[1]), "rights": RIGHTS})
    return out[:14]


data = {}
for genre, (g, s) in GENRES.items():
    shelves = []
    for title, source, fn, arg in (("Beautifully made", "Standard Ebooks", standard, s), ("Most read", "Project Gutenberg", gutenberg, g)):
        try:
            books = fn(arg)
        except Exception as e:  # noqa: BLE001
            print(f"{genre} {source}: {e}")
            books = []
        if books:
            shelves.append({"title": title, "note": source, "source": source, "books": books, "state": "ready"})
    data[genre] = shelves
    print(genre, [len(x["books"]) for x in shelves])
with open(os.path.join(HERE, "..", "src", "core", "starter.json"), "w") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
