import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { browse, type CatalogBook, type Genre, GENRES, mergeShelves, type Shelf, shelvesFor } from "../core/catalog";
import { catalogGet, catalogPut, getSetting, setSetting } from "../core/db";
import { log } from "../core/log";
import { selectBook } from "../core/selected";
import starter from "../core/starter.json";
import { Cover } from "../ui/cover";
import { BottomNav } from "../ui/nav";
import { sans, sansMedium, serif, serifMedium, type Palette, useTheme } from "../ui/theme";

const LANGS = [["en", "English"], ["sa", "Sanskrit"], ["hi", "Hindi"], ["fr", "French"], ["de", "German"], ["es", "Spanish"]] as const;
const COVER = 112;
const COLUMNS = 3;

const cacheKey = (query: string, lang: string, genre: Genre) => `${lang}|${genre}|${query.toLowerCase()}`;

/** What to show before anyone answers: the last answer, else what came with the app. */
const known = (query: string, lang: string, genre: Genre): Shelf[] | null => {
  const saved = catalogGet<Shelf[]>(cacheKey(query, lang, genre));
  if (saved) return saved;
  if (query || lang !== "en") return null;
  return ((starter as unknown as Record<string, Shelf[]>)[genre] ?? null);
};

export default function Discover() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(() => getSetting("discoverLang", "en"));
  const [choosingLang, setChoosingLang] = useState(false);
  const [genre, setGenre] = useState<Genre>("all");
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [shelves, setShelves] = useState<Shelf[]>(() => known("", lang, "all") ?? shelvesFor(lang));
  const [waiting, setWaiting] = useState(0);
  const ticket = useRef(0);
  const tabs = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const tabAt = useRef<Record<string, number>>({});

  const load = useCallback((query: string, language: string, kind: Genre) => {
    const mine = ++ticket.current;
    const t0 = Date.now();
    const old = known(query, language, kind);
    // what we know shows now; the libraries' answers replace it as they come
    setShelves(shelvesFor(language).map((s) => old?.find((x) => x.source === s.source) ?? s));
    const got: Shelf[] = [];
    setWaiting(shelvesFor(language).length);
    log.info("discover", "browse", { query, lang: language, genre: kind, cached: !!old });
    void browse(
      query,
      language,
      (shelf) => {
        if (mine !== ticket.current) return;
        got.push(shelf);
        setWaiting((n) => n - 1);
        setShelves((now) => now.map((s) => (s.source !== shelf.source ? s : shelf.state === "failed" && s.books.length ? { ...s, state: "ready" } : shelf)));
        // covers ready before they're scrolled to
        void Image.prefetch(shelf.books.slice(0, 24).flatMap((b) => (b.cover ? [b.cover] : [])), { cachePolicy: "memory-disk" }).catch(() => undefined);
      },
      kind,
    ).then(() => {
      if (mine !== ticket.current) return;
      log.info("discover", "all answered", { ms: Date.now() - t0, shelves: got.map((s) => `${s.source}:${s.state}:${s.books.length}`) });
      const good = got.filter((s) => s.state === "ready" && s.books.length);
      if (good.length) catalogPut(cacheKey(query, language, kind), shelvesFor(language).map((s) => good.find((g) => g.source === s.source) ?? old?.find((x) => x.source === s.source) ?? { ...s, state: "ready" }));
    });
  }, []);

  useEffect(() => {
    load(asked, lang, genre);
  }, [load, asked, lang, genre]);

  // back from here goes to your books, not out of the app
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      router.replace("/");
      return true;
    });
    return () => sub.remove();
  }, [router]);

  const pick = (b: CatalogBook) => {
    selectBook(b, genre === "all" ? "" : genre);
    router.push("/book");
  };

  const home = genre === "all" && !asked;
  const merged = useMemo(() => mergeShelves(shelves), [shelves]);
  const nothingYet = !merged.length;
  const allFailed = nothingYet && shelves.every((s) => s.state === "failed");
  const noneFound = nothingYet && !waiting && !allFailed;
  // one book a day, from the best-made shelf
  const hero = useMemo(() => {
    const pool = shelves.find((s) => s.books.length)?.books ?? [];
    return home && pool.length ? pool[Math.floor(Date.now() / 86400000) % pool.length] : undefined;
  }, [home, shelves]);
  const gridW = Math.floor((Dimensions.get("window").width - 20 * 2 - 16 * (COLUMNS - 1)) / COLUMNS);
  const langName = LANGS.find(([k]) => k === lang)?.[1] ?? "English";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 28 }} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[2]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: t.ink }]}>Discover</Text>
          <Pressable accessibilityLabel={`Language: ${langName}`} onPress={() => setChoosingLang((v) => !v)} style={styles.langBtn}>
            <Text style={{ color: t.soft, fontFamily: sansMedium, fontSize: 14 }}>{langName}</Text>
            <Ionicons name={choosingLang ? "chevron-up" : "chevron-down"} size={15} color={t.soft} />
          </Pressable>
        </View>

        <View>
          {choosingLang ? (
            <View style={styles.langs}>
              {LANGS.map(([k, label]) => (
                <Pressable
                  key={k}
                  accessibilityState={{ selected: lang === k }}
                  style={{ height: 40, justifyContent: "center", paddingRight: 18 }}
                  onPress={() => {
                    setLang(k);
                    setSetting("discoverLang", k);
                    setChoosingLang(false);
                  }}
                >
                  <Text style={{ color: lang === k ? t.accent : t.soft, fontFamily: sansMedium, fontSize: 14 }}>{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={[styles.search, { backgroundColor: t.card }]}>
            <Ionicons name="search" size={18} color={t.soft} />
            <TextInput
              value={q}
              onChangeText={setQ}
              returnKeyType="search"
              onSubmitEditing={() => {
                // a search looks everywhere, not just in the genre on show
                setGenre("all");
                setAsked(q.trim());
              }}
              placeholder="Title, author or subject"
              placeholderTextColor={t.faint}
              style={{ flex: 1, height: 48, color: t.ink, fontFamily: sans, fontSize: 15 }}
            />
            {q ? (
              <Pressable
                accessibilityLabel="Clear search"
                style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}
                onPress={() => {
                  setQ("");
                  setAsked("");
                }}
              >
                <Ionicons name="close" size={18} color={t.soft} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* genres stay in reach as you scroll */}
        <View style={{ backgroundColor: t.bg }}>
          <ScrollView ref={tabs as never} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
            {GENRES.map(([k, label]) => {
              const on = genre === k;
              return (
                <Pressable
                  key={k}
                  accessibilityState={{ selected: on }}
                  onLayout={(e) => {
                    tabAt.current[k] = e.nativeEvent.layout.x;
                  }}
                  onPress={() => {
                    setGenre(k);
                    // choosing a genre clears a search, and brings its tab fully into view
                    setQ("");
                    setAsked("");
                    tabs.current?.scrollTo({ x: Math.max(0, (tabAt.current[k] ?? 0) - 90), animated: true });
                  }}
                  style={styles.genre}
                >
                  <Text style={{ color: on && !asked ? t.ink : t.soft, fontFamily: on && !asked ? sansMedium : sans, fontSize: 15 }}>{label}</Text>
                  <View style={[styles.genreDot, { backgroundColor: on && !asked ? t.accent : "transparent" }]} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {allFailed ? (
          <View style={styles.message}>
            <Ionicons name="cloud-offline-outline" size={30} color={t.soft} />
            <Text style={[styles.messageText, { color: t.soft }]}>Finding new books needs a connection.{"\n"}Everything you've kept is in your Library.</Text>
            <Pressable onPress={() => load(asked, lang, genre)} style={{ height: 44, justifyContent: "center" }}>
              <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 15 }}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {noneFound ? <Text style={[styles.messageText, { color: t.soft, marginTop: 60 }]}>Nothing here in any of the libraries.{"\n"}Try other words, or another language.</Text> : null}

        {home ? (
          <>
            {hero ? <Hero b={hero} t={t} onPress={() => pick(hero)} /> : null}
            {shelves.map((s) =>
              s.state === "ready" && !s.books.length ? null : (
                <View key={s.source} style={{ marginTop: 26 }}>
                  <View style={styles.shelfHead}>
                    <Text style={{ color: t.ink, fontFamily: serifMedium, fontSize: 21 }}>{s.title}</Text>
                    <Text style={{ color: t.faint, fontFamily: sans, fontSize: 12 }}>{s.note}</Text>
                  </View>
                  {s.state === "failed" && !s.books.length ? (
                    <Pressable onPress={() => load(asked, lang, genre)} style={styles.retry}>
                      <Ionicons name="refresh" size={16} color={t.accent} />
                      <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 14 }}>Couldn't reach it. Try again</Text>
                    </Pressable>
                  ) : !s.books.length ? (
                    <Placeholders t={t} />
                  ) : (
                    <FlatList
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      data={s.books}
                      keyExtractor={(b) => b.key}
                      initialNumToRender={5}
                      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, gap: 14 }}
                      renderItem={({ item: b }) => <Tile b={b} width={COVER} t={t} onPress={() => pick(b)} />}
                    />
                  )}
                </View>
              ),
            )}
          </>
        ) : nothingYet && waiting ? (
          <View style={styles.grid}>
            {Array.from({ length: 9 }, (_, i) => (
              <View key={i} style={{ width: gridW, height: Math.round(gridW * 1.42), borderRadius: 6, backgroundColor: t.card, opacity: 1 - i * 0.07 }} />
            ))}
          </View>
        ) : (
          <View style={styles.grid}>
            {merged.map((b) => (
              <Tile key={b.key} b={b} width={gridW} t={t} onPress={() => pick(b)} />
            ))}
          </View>
        )}
      </ScrollView>
      {/* scrolled content doesn't run under the clock */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: t.bg }} />
      <BottomNav t={t} at="/discover" />
    </View>
  );
}

function Hero({ b, t, onPress }: { b: CatalogBook; t: Palette; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={`Today's pick: ${b.title}`} style={styles.hero}>
      <Cover id={b.key} title={b.title} author={b.author} uri={b.cover} width={118} />
      <View style={{ flex: 1, marginLeft: 18 }}>
        <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 12 }}>Today's pick</Text>
        <Text numberOfLines={3} style={{ color: t.ink, fontFamily: serifMedium, fontSize: 25, lineHeight: 29, marginTop: 6, letterSpacing: -0.3 }}>{b.title}</Text>
        {b.author ? <Text numberOfLines={1} style={{ color: t.soft, fontFamily: sans, fontSize: 14, marginTop: 6 }}>{b.author}</Text> : null}
        {b.about ? <Text numberOfLines={2} style={{ color: t.soft, fontFamily: serif, fontSize: 14, lineHeight: 19, marginTop: 8 }}>{b.about}</Text> : null}
      </View>
    </Pressable>
  );
}

function Tile({ b, width, t, onPress }: { b: CatalogBook; width: number; t: Palette; onPress: () => void }) {
  return (
    <Pressable style={{ width }} onPress={onPress} accessibilityLabel={`${b.title}${b.author ? `, ${b.author}` : ""}`}>
      <Cover id={b.key} title={b.title} author={b.author} uri={b.cover} width={width} />
      <Text numberOfLines={2} style={{ color: t.ink, fontFamily: sans, fontSize: 12, lineHeight: 16, marginTop: 8 }}>{b.title}</Text>
      {b.kind === "pdf" ? <Text style={{ color: t.faint, fontFamily: sans, fontSize: 11, marginTop: 2 }}>Printed scan</Text> : null}
    </Pressable>
  );
}

/** Book-shaped gaps while a library answers: the page doesn't jump when they arrive. */
function Placeholders({ t }: { t: Palette }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 20, paddingTop: 12, overflow: "hidden" }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: COVER, height: Math.round(COVER * 1.42), borderRadius: 6, backgroundColor: t.card, opacity: 1 - i * 0.18 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 12 },
  title: { fontFamily: serifMedium, fontSize: 36, letterSpacing: -0.7 },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 8 },
  langs: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginTop: 10, paddingLeft: 14, paddingRight: 4, borderRadius: 16 },
  genre: { height: 48, alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 6 },
  genreDot: { width: 4, height: 4, borderRadius: 2 },
  hero: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginTop: 14 },
  shelfHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, rowGap: 22, paddingHorizontal: 20, marginTop: 14 },
  message: { alignItems: "center", marginTop: 70, gap: 12, paddingHorizontal: 30 },
  messageText: { fontFamily: sans, fontSize: 14, lineHeight: 22, textAlign: "center", paddingHorizontal: 30 },
  retry: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 20, marginTop: 8 },
});
