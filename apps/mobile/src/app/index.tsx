import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { allBooks, type Book, changed, lastRead, setFavorite, setGenre } from "../core/db";
import { deleteBooks, importFile } from "../core/downloads";
import { SHELVES, shelfName } from "../core/genres";
import { log } from "../core/log";
import { takeIncoming } from "../core/selected";
import { useBus } from "../core/store";
import { percent } from "../core/words";
import { Cover, coverOf } from "../ui/cover";
import { BottomNav } from "../ui/nav";
import { deva, SHLOKA, sans, sansMedium, serif, serifMedium, type Palette, useTheme } from "../ui/theme";

const COLUMNS = 3;
const SHELF_COVER = 104;
const UNDO_MS = 6000;

export default function Library() {
  useBus(changed);
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<string>("all");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choosingGenre, setChoosingGenre] = useState(false);
  const [leaving, setLeaving] = useState<string[]>([]); // deleted, until Undo runs out
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string[]>([]);
  const selecting = selected.size > 0;

  // books on their way live in Downloads; here is what you can read
  const all = allBooks();
  const books = all.filter((b) => b.state === "ready" && !leaving.includes(b.id));
  const onTheWay = all.length - books.length - leaving.length;

  const shelves = useMemo(() => {
    const by = new Map<string, Book[]>();
    for (const b of books) {
      const k = SHELVES.some(([s]) => s === b.genre) ? b.genre : "other";
      by.set(k, [...(by.get(k) ?? []), b]);
    }
    return SHELVES.flatMap(([k]) => (by.has(k) ? [{ key: k as string, books: by.get(k) as Book[] }] : []));
  }, [books]);
  const favorites = books.filter((b) => b.favorite);

  const s = q.trim().toLowerCase();
  const list = s ? books.filter((b) => b.title.toLowerCase().includes(s) || b.author.toLowerCase().includes(s)) : (shelves.find((x) => x.key === tab)?.books ?? []);
  const showGrid = !!s || tab !== "all";

  const read = (id: string) => router.push({ pathname: "/read/[id]", params: { id } });

  // a PDF or EPUB opened from another app
  useEffect(() => {
    const uri = takeIncoming();
    if (!uri) return;
    const name = decodeURIComponent(uri.split("/").pop() ?? "book.pdf");
    void importFile(uri, /\.[a-z]+$/i.test(name) ? name : `${name}.pdf`, 0)
      .then((id) => id && read(id))
      .catch((e: unknown) => {
        log.error("library", "open from another app failed", e instanceof Error ? e : { e: String(e) });
        Alert.alert("That file can't be read");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // back leaves selecting before it leaves the app
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(new Set());
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  const finish = (ids: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = [];
    if (ids.length) void deleteBooks(ids);
    setLeaving([]);
  };
  // leaving this screen during the Undo time still deletes
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current.length) void deleteBooks(pending.current);
    },
    [],
  );

  const toggle = (id: string) =>
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = () => {
    const ids = [...selected, ...leaving];
    setSelected(new Set());
    setLeaving(ids);
    pending.current = ids;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => finish(ids), UNDO_MS);
  };

  const open = (b: Book) => {
    if (selecting) return toggle(b.id);
    log.info("library", "open", { id: b.id });
    read(b.id);
  };

  const addFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/epub+zip", "text/markdown", "image/*"], copyToCacheDirectory: true });
    const f = r.assets?.[0];
    if (!f) return;
    try {
      const id = await importFile(f.uri, f.name, f.size ?? 0);
      if (id) read(id);
      else Alert.alert("That kind of file can't be read yet", "PDF, EPUB, Markdown and pictures can.");
    } catch (e) {
      log.error("library", "import failed", e instanceof Error ? e : { e: String(e) });
      Alert.alert("That file can't be read");
    }
  };

  const gridW = Math.floor((Dimensions.get("window").width - 20 * 2 - 16 * (COLUMNS - 1)) / COLUMNS);
  const recent = lastRead().find((b) => b.state === "ready" && !leaving.includes(b.id));
  const chosen = books.filter((b) => selected.has(b.id));
  const allLoved = chosen.length > 0 && chosen.every((b) => b.favorite);

  const tile = (b: Book, width: number) => (
    <Tile key={b.id} b={b} width={width} t={t} selecting={selecting} on={selected.has(b.id)} onPress={() => open(b)} onLongPress={() => toggle(b.id)} />
  );

  if (books.length === 0 && !leaving.length) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <Text style={[styles.shloka, { color: t.accent }]}>{SHLOKA.lines.join("\n")}</Text>
          <Text style={[styles.meaning, { color: t.soft }]}>{SHLOKA.meaning}</Text>
          <Text style={[styles.source, { color: t.faint }]}>{SHLOKA.source}</Text>
          <Text style={[styles.hello, { color: t.ink }]}>A library that fits in your hand</Text>
          <Text style={[styles.helloSub, { color: t.soft }]}>
            {onTheWay ? "Your books are on their way. See them in Downloads." : "Find free books from the world's public libraries, or open a PDF or EPUB from this phone. Everything you keep reads offline."}
          </Text>
          <Pressable style={[styles.primary, { backgroundColor: t.accent }]} onPress={() => router.replace("/discover")}>
            <Text style={{ color: t.accentInk, fontFamily: sansMedium, fontSize: 16 }}>Find a book</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => void addFile()}>
            <Text style={{ color: t.ink, fontFamily: sansMedium, fontSize: 15 }}>Open a file</Text>
          </Pressable>
        </View>
        <BottomNav t={t} at="/" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <View>
            <Text style={[styles.title, { color: t.ink }]}>Library</Text>
            <Text accessibilityLabel={SHLOKA.meaning} style={[styles.tag, { color: t.accent }]}>{SHLOKA.short}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 2 }}>
            <Icon t={t} name="search" label="Find a book" onPress={() => setSearching((v) => !v)} />
            <Icon t={t} name="add" label="Open a file" onPress={() => void addFile()} />
            <Icon t={t} name="options-outline" label="Settings" onPress={() => router.push("/settings")} />
          </View>
        </View>
        {searching ? (
          <View style={[styles.search, { backgroundColor: t.card }]}>
            <Ionicons name="search" size={17} color={t.soft} />
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Title or author" placeholderTextColor={t.faint} style={{ flex: 1, height: 46, color: t.ink, fontFamily: sans, fontSize: 15 }} />
          </View>
        ) : null}

        {!s && recent ? <Continue b={recent} t={t} onPress={() => open(recent)} onLongPress={() => toggle(recent.id)} /> : null}

        {!s && favorites.length ? (
          <View style={{ marginTop: 24 }}>
            <View style={styles.shelfHead}>
              <Ionicons name="heart" size={15} color={t.accent} style={{ marginRight: 7 }} />
              <Text style={[styles.shelfName, { color: t.ink }]}>Favorites</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {favorites.map((b) => tile(b, SHELF_COVER))}
            </ScrollView>
          </View>
        ) : null}

        {!s && shelves.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 20 }}>
            {[{ key: "all" }, ...shelves].map(({ key }) => {
              const on = tab === key;
              return (
                <Pressable key={key} accessibilityState={{ selected: on }} onPress={() => setTab(key)} style={styles.genre}>
                  <Text style={{ color: on ? t.ink : t.soft, fontFamily: on ? sansMedium : sans, fontSize: 15 }}>{key === "all" ? "All" : shelfName(key)}</Text>
                  <View style={[styles.genreDot, { backgroundColor: on ? t.accent : "transparent" }]} />
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {showGrid ? (
          <View style={styles.grid}>
            {list.length ? list.map((b) => tile(b, gridW)) : <Text style={[styles.none, { color: t.soft }]}>{s ? "No book by that name." : "None here yet."}</Text>}
          </View>
        ) : (
          shelves.map((shelf) => (
            <View key={shelf.key} style={{ marginTop: 20 }}>
              <Pressable onPress={() => setTab(shelf.key)} style={styles.shelfHead} accessibilityLabel={`${shelfName(shelf.key)}, ${shelf.books.length} books`}>
                <Text style={[styles.shelfName, { color: t.ink }]}>{shelfName(shelf.key)}</Text>
                <Text style={{ color: t.faint, fontFamily: sans, fontSize: 13, marginLeft: 8 }}>{shelf.books.length}</Text>
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {shelf.books.map((b) => tile(b, SHELF_COVER))}
              </ScrollView>
            </View>
          ))
        )}
      </ScrollView>

      {/* scrolled content doesn't run under the clock */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: t.bg }} />
      {selecting ? (
        <View style={[styles.selectBar, { backgroundColor: t.nav, paddingTop: insets.top + 6 }]}>
          <Pressable accessibilityLabel="Stop selecting" style={styles.icon} onPress={() => setSelected(new Set())}>
            <Ionicons name="close" size={24} color={t.ink} />
          </Pressable>
          <Text style={{ flex: 1, color: t.ink, fontFamily: sansMedium, fontSize: 17 }}>{selected.size}</Text>
          <Pressable style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }} onPress={() => setSelected(selected.size === books.length ? new Set() : new Set(books.map((b) => b.id)))}>
            <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 14 }}>{selected.size === books.length ? "None" : "All"}</Text>
          </Pressable>
          <Pressable accessibilityLabel={allLoved ? "Remove from favorites" : "Add to favorites"} style={styles.icon} onPress={() => { setFavorite([...selected], !allLoved); setSelected(new Set()); }}>
            <Ionicons name={allLoved ? "heart" : "heart-outline"} size={22} color={t.accent} />
          </Pressable>
          <Pressable accessibilityLabel="Change genre" style={styles.icon} onPress={() => setChoosingGenre(true)}>
            <Ionicons name="pricetag-outline" size={21} color={t.ink} />
          </Pressable>
          <Pressable accessibilityLabel={`Delete ${selected.size} selected`} style={styles.icon} onPress={removeSelected}>
            <Ionicons name="trash-outline" size={22} color={t.danger} />
          </Pressable>
        </View>
      ) : null}

      {choosingGenre ? (
        <View style={[styles.sheet, { backgroundColor: t.nav, paddingBottom: 12, bottom: 60 + insets.bottom }]}>
          <Text style={{ color: t.soft, fontFamily: sansMedium, fontSize: 13, marginBottom: 6 }}>Move to</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {SHELVES.map(([k, label]) => (
              <Pressable
                key={k}
                style={{ width: "50%", minHeight: 44, justifyContent: "center" }}
                onPress={() => {
                  setGenre([...selected], k);
                  setChoosingGenre(false);
                  setSelected(new Set());
                }}
              >
                <Text style={{ color: t.ink, fontFamily: serif, fontSize: 18 }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {leaving.length ? (
        <View style={[styles.undo, { backgroundColor: t.chipOn }]}>
          <Text style={{ flex: 1, color: t.chipOnInk, fontFamily: sans, fontSize: 14 }}>{leaving.length === 1 ? "Book deleted" : `${leaving.length} books deleted`}</Text>
          <Pressable
            hitSlop={10}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
            onPress={() => {
              if (timer.current) clearTimeout(timer.current);
              timer.current = null;
              pending.current = [];
              log.info("library", "undo delete", { ids: leaving });
              setLeaving([]);
            }}
          >
            <Text style={{ color: t.chipOnInk, fontFamily: sansMedium, fontSize: 14, textDecorationLine: "underline" }}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
      <BottomNav t={t} at="/" />
    </View>
  );
}

const Icon = ({ t, name, label, onPress }: { t: Palette; name: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) => (
  <Pressable accessibilityLabel={label} onPress={onPress} style={styles.icon}>
    <Ionicons name={name} size={22} color={t.soft} />
  </Pressable>
);

function Tile({ b, width, t, selecting, on, onPress, onLongPress }: { b: Book; width: number; t: Palette; selecting: boolean; on: boolean; onPress: () => void; onLongPress: () => void }) {
  const reading = b.page > 1 && b.total > 1;
  return (
    <Pressable style={{ width }} onPress={onPress} onLongPress={onLongPress} delayLongPress={350} accessibilityLabel={b.title} accessibilityState={{ selected: on }}>
      <View>
        <Cover id={b.id} title={b.title} author={b.author} uri={coverOf(b)} width={width} dim={selecting && !on ? "rgba(15,17,21,.5)" : undefined} />
        {selecting ? (
          <View style={[styles.tick, { backgroundColor: on ? t.accent : "rgba(0,0,0,.45)", borderColor: on ? t.accent : "#fff" }]}>
            {on ? <Ionicons name="checkmark" size={16} color={t.accentInk} /> : null}
          </View>
        ) : b.favorite ? (
          <View style={styles.loved}>
            <Ionicons name="heart" size={13} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={styles.status}>
        {reading ? (
          <>
            <View style={[styles.bar, { backgroundColor: t.line }]}>
              <View style={{ width: `${Math.round(((b.page - 1) / (b.total - 1)) * 100)}%`, height: "100%", backgroundColor: t.accent }} />
            </View>
            <Text style={{ color: t.soft, fontFamily: sans, fontSize: 11 }}>{percent(b.page, b.total)}%</Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

function Continue({ b, t, onPress, onLongPress }: { b: Book; t: Palette; onPress: () => void; onLongPress: () => void }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} accessibilityLabel={`Continue reading ${b.title}`} style={[styles.continue, { backgroundColor: t.card }]}>
      <Cover id={b.id} title={b.title} author={b.author} uri={coverOf(b)} width={92} />
      <View style={{ flex: 1, marginLeft: 16 }}>
        <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 12 }}>Continue reading</Text>
        <Text numberOfLines={2} style={{ color: t.ink, fontFamily: serif, fontSize: 23, lineHeight: 26, marginTop: 6 }}>{b.title}</Text>
        {b.author ? <Text numberOfLines={1} style={{ color: t.soft, fontFamily: sans, fontSize: 13, marginTop: 5 }}>{b.author}</Text> : null}
        {b.total > 1 ? (
          <>
            <View style={{ marginTop: 14, flexDirection: "row" }}>
              <View style={[styles.bar, { backgroundColor: t.line }]}>
                <View style={{ width: `${Math.round(((Math.max(b.page, 1) - 1) / (b.total - 1)) * 100)}%`, height: "100%", backgroundColor: t.accent }} />
              </View>
            </View>
            <Text style={{ color: t.soft, fontFamily: sans, fontSize: 12, marginTop: 7 }}>Page {Math.max(b.page, 1)} of {b.total}</Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 6 },
  shloka: { fontFamily: deva, fontSize: 24, lineHeight: 40, textAlign: "center" },
  meaning: { fontFamily: serif, fontStyle: "italic", fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 6, paddingHorizontal: 10 },
  source: { fontFamily: sans, fontSize: 11, letterSpacing: 0.3, marginTop: 6, marginBottom: 34 },
  tag: { fontFamily: deva, fontSize: 13, marginTop: -2 },
  hello: { fontFamily: serifMedium, fontSize: 28, lineHeight: 33, textAlign: "center", letterSpacing: -0.4 },
  helloSub: { fontFamily: sans, fontSize: 15, lineHeight: 23, textAlign: "center", marginTop: 8 },
  primary: { height: 54, paddingHorizontal: 40, borderRadius: 27, marginTop: 22, justifyContent: "center" },
  secondary: { height: 48, paddingHorizontal: 20, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 10 },
  title: { fontFamily: serifMedium, fontSize: 36, letterSpacing: -0.7 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  continue: { flexDirection: "row", alignItems: "center", marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginTop: 8, paddingHorizontal: 14, borderRadius: 14 },
  genre: { height: 48, alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 6 },
  genreDot: { width: 4, height: 4, borderRadius: 2 },
  shelfHead: { flexDirection: "row", alignItems: "center", minHeight: 36, paddingHorizontal: 20 },
  shelfName: { fontFamily: serifMedium, fontSize: 21 },
  row: { paddingHorizontal: 20, paddingTop: 6, gap: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, paddingHorizontal: 20, marginTop: 10 },
  none: { textAlign: "center", lineHeight: 22, marginTop: 44, width: "100%", fontFamily: sans },
  bar: { flex: 1, height: 3, borderRadius: 2, overflow: "hidden" },
  status: { height: 22, flexDirection: "row", alignItems: "center", gap: 5 },
  tick: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  loved: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,.45)", alignItems: "center", justifyContent: "center" },
  selectBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingBottom: 8 },
  sheet: { position: "absolute", left: 0, right: 0, paddingHorizontal: 22, paddingTop: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  undo: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 10, paddingLeft: 16, paddingRight: 8, borderRadius: 14, minHeight: 50 },
});
