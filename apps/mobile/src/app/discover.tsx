import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { browse, type CatalogBook, type Shelf, shelvesFor } from "../core/catalog";
import { getSetting, setSetting } from "../core/db";
import { log } from "../core/log";
import { selectBook } from "../core/selected";
import { Cover } from "../ui/cover";
import { BottomNav } from "../ui/nav";
import { sans, sansMedium, serifMedium, type Palette, useTheme } from "../ui/theme";

const LANGS = [["en", "English"], ["sa", "Sanskrit"], ["hi", "Hindi"], ["fr", "French"], ["de", "German"], ["es", "Spanish"]] as const;
const COVER = 112;

/** What you last saw stays on show, even with no connection. */
const remembered = (lang: string): Shelf[] | null => {
  try {
    const s = JSON.parse(getSetting(`discover2:${lang}`, "null")) as Shelf[] | null;
    return s?.map((x) => ({ ...x, state: "ready" as const })) ?? null;
  } catch {
    return null;
  }
};

export default function Discover() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(() => getSetting("discoverLang", "en"));
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [shelves, setShelves] = useState<Shelf[]>(() => remembered(lang) ?? shelvesFor(lang));
  const ticket = useRef(0);

  const load = useCallback((query: string, language: string, only?: Shelf["source"]) => {
    const mine = ++ticket.current;
    const kept = !query ? remembered(language) : null;
    // a shelf you've seen stays while its library is asked again
    setShelves((now) =>
      shelvesFor(language).map((s) => {
        if (only && s.source !== only) return now.find((x) => x.source === s.source) ?? s;
        const old = kept?.find((x) => x.source === s.source);
        return old?.books.length ? { ...old, state: "loading" as const } : s;
      }),
    );
    const got: Shelf[] = [];
    log.info("discover", "browse", { query, lang: language, only });
    void browse(query, language, (shelf) => {
      if (mine !== ticket.current || (only && shelf.source !== only)) return;
      got.push(shelf);
      setShelves((now) => now.map((s) => (s.source !== shelf.source ? s : shelf.state === "failed" && s.books.length ? { ...s, state: "ready" } : shelf)));
    }).then(() => {
      if (mine !== ticket.current || query || only) return;
      const good = got.filter((s) => s.state === "ready" && s.books.length);
      if (good.length) setSetting(`discover2:${language}`, JSON.stringify(shelvesFor(language).map((s) => good.find((g) => g.source === s.source) ?? s)));
    });
  }, []);

  useEffect(() => {
    load("", lang);
  }, [load, lang]);

  const pick = (b: CatalogBook) => {
    selectBook(b);
    router.push("/book");
  };
  const search = () => {
    setAsked(q.trim());
    load(q.trim(), lang);
  };
  const allFailed = shelves.every((s) => s.state === "failed");
  const noneFound = shelves.every((s) => s.state !== "loading") && shelves.every((s) => !s.books.length) && !allFailed;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: t.ink }]}>Discover</Text>
        <View style={[styles.search, { backgroundColor: t.card }]}>
          <Ionicons name="search" size={18} color={t.soft} />
          <TextInput
            value={q}
            onChangeText={setQ}
            returnKeyType="search"
            onSubmitEditing={search}
            placeholder="Title, author, subject"
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
                load("", lang);
              }}
            >
              <Ionicons name="close" size={18} color={t.soft} />
            </Pressable>
          ) : null}
        </View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={LANGS}
          keyExtractor={([k]) => k}
          style={{ marginTop: 6 }}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}
          renderItem={({ item: [k, label] }) => (
            <Pressable
              style={{ height: 44, justifyContent: "center" }}
              accessibilityState={{ selected: lang === k }}
              onPress={() => {
                setLang(k);
                setSetting("discoverLang", k);
              }}
            >
              <View style={[styles.chip, { backgroundColor: lang === k ? t.chipOn : t.chip }]}>
                <Text style={{ color: lang === k ? t.chipOnInk : t.soft, fontFamily: sansMedium, fontSize: 13 }}>{label}</Text>
              </View>
            </Pressable>
          )}
        />

        {allFailed ? (
          <View style={styles.message}>
            <Ionicons name="cloud-offline-outline" size={30} color={t.soft} />
            <Text style={[styles.messageText, { color: t.soft }]}>Finding new books needs a connection.{"\n"}Everything you've kept is in your Library.</Text>
            <Pressable onPress={() => load(asked, lang)} style={{ height: 44, justifyContent: "center" }}>
              <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 15 }}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {noneFound ? <Text style={[styles.messageText, { color: t.soft, marginTop: 50 }]}>Nothing by that name in any of the libraries.</Text> : null}

        {allFailed || noneFound
          ? null
          : shelves.map((s) =>
              s.state === "ready" && !s.books.length ? null : (
                <View key={s.source} style={{ marginTop: 18 }}>
                  <View style={{ paddingHorizontal: 20 }}>
                    <Text style={{ color: t.ink, fontFamily: serifMedium, fontSize: 22 }}>{s.title}</Text>
                    <Text style={{ color: t.soft, fontFamily: sans, fontSize: 13, marginTop: 3 }}>{s.note}</Text>
                  </View>
                  {s.state === "failed" ? (
                    <Pressable onPress={() => load(asked, lang, s.source)} style={styles.retry}>
                      <Ionicons name="refresh" size={16} color={t.accent} />
                      <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 14 }}>Couldn't reach {s.source}. Try again</Text>
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
                      renderItem={({ item: b }) => (
                        <Pressable style={{ width: COVER }} onPress={() => pick(b)} accessibilityLabel={`${b.title}, ${b.author}`}>
                          <Cover id={b.key} title={b.title} author={b.author} uri={b.cover} width={COVER} />
                          <Text numberOfLines={2} style={{ color: t.ink, fontFamily: sans, fontSize: 12, lineHeight: 16, marginTop: 8 }}>
                            {b.title}
                          </Text>
                          <Text numberOfLines={1} style={{ color: t.soft, fontFamily: sans, fontSize: 11, marginTop: 2 }}>
                            {b.kind.toUpperCase()}
                          </Text>
                        </Pressable>
                      )}
                    />
                  )}
                </View>
              ),
            )}
      </ScrollView>
      <BottomNav t={t} at="/discover" />
    </View>
  );
}

/** Book-shaped gaps while a library answers: the page doesn't jump when they arrive. */
function Placeholders({ t }: { t: Palette }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 20, paddingTop: 12, overflow: "hidden" }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: COVER }}>
          <View style={{ width: COVER, height: Math.round(COVER * 1.42), borderRadius: 6, backgroundColor: t.card, opacity: 1 - i * 0.18 }} />
          <View style={{ width: COVER * 0.8, height: 10, borderRadius: 5, backgroundColor: t.card, marginTop: 10, opacity: 1 - i * 0.18 }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: serifMedium, fontSize: 36, letterSpacing: -0.7, paddingHorizontal: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginTop: 12, paddingLeft: 14, paddingRight: 4, borderRadius: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 17 },
  message: { alignItems: "center", marginTop: 70, gap: 12, paddingHorizontal: 30 },
  messageText: { fontFamily: sans, fontSize: 14, lineHeight: 22, textAlign: "center", paddingHorizontal: 30 },
  retry: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 20, marginTop: 8 },
});
