import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Dimensions, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { allBooks, type Book, changed, lastRead } from "../core/db";
import { downloadProgress, importFile, progressBus, pumpDownloads, queueBook, removeDownload } from "../core/downloads";
import { takeIncoming } from "../core/selected";
import { useBus } from "../core/store";
import { fileSize, percent } from "../core/words";
import { Cover } from "../ui/cover";
import { BottomNav } from "../ui/nav";
import { deva, SHLOKA, sans, sansMedium, serif, serifMedium, type Palette, useTheme } from "../ui/theme";
import { log } from "../core/log";

const FILTERS = [
  ["all", "All"], ["phone", "On this phone"], ["book", "Books"], ["markdown", "Notes"], ["image", "Pictures"],
] as const;
type Filter = (typeof FILTERS)[number][0];
const COLUMNS = 3;

export default function Library() {
  useBus(changed);
  useBus(progressBus);
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const books = allBooks();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return books.filter((b) => {
      if (s && !b.title.toLowerCase().includes(s) && !b.author.toLowerCase().includes(s) && !b.folder.toLowerCase().includes(s)) return false;
      if (filter === "phone") return b.state === "ready";
      if (filter === "all") return true;
      if (filter === "book") return b.kind === "pdf" || b.kind === "epub";
      return b.kind === filter;
    });
  }, [books, filter, q]);

  const read = (id: string) => router.push({ pathname: "/read/[id]", params: { id } });

  // a PDF or EPUB opened from another app
  useEffect(() => {
    const uri = takeIncoming();
    if (!uri) return;
    const name = decodeURIComponent(uri.split("/").pop() ?? "book.pdf");
    void importFile(uri, /\.[a-z]+$/i.test(name) ? name : `${name}.pdf`, 0)
      .then((id) => id && read(id))
      .catch(() => Alert.alert("That file can't be read"));
  }, []);

  const open = (b: Book) => {
    log.info("library", "open", { id: b.id, state: b.state });
    if (b.state === "ready" && b.file) return read(b.id);
    queueBook(b.id);
    pumpDownloads();
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

  const manage = (b: Book) => {
    if (b.state !== "ready") return open(b);
    Alert.alert(b.title, `${fileSize(b.size)} on this phone.${b.source === "phone" ? " It leaves your library." : " It stays in your library to download again."}`, [
      { text: "Keep" },
      { text: "Remove from phone", style: "destructive", onPress: () => void removeDownload(b) },
    ]);
  };

  const width = Dimensions.get("window").width;
  const coverW = Math.floor((width - 20 * 2 - 16 * (COLUMNS - 1)) / COLUMNS);
  const recent = lastRead().find((b) => b.state === "ready");

  if (books.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <Text style={[styles.shloka, { color: t.accent }]}>{SHLOKA.lines.join("\n")}</Text>
          <Text style={[styles.meaning, { color: t.soft }]}>{SHLOKA.meaning}</Text>
          <Text style={[styles.source, { color: t.faint }]}>{SHLOKA.source}</Text>
          <Text style={[styles.hello, { color: t.ink }]}>A library that fits in your hand</Text>
          <Text style={[styles.helloSub, { color: t.soft }]}>Find free books from the world's public libraries, or open a PDF or EPUB from this phone. Everything you keep reads offline.</Text>
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
      <FlatList
        style={{ flex: 1 }}
        data={shown}
        keyExtractor={(b) => b.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: 16, paddingHorizontal: 20 }}
        contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
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
            {recent && !q && filter === "all" ? <Continue b={recent} t={t} onPress={() => read(recent.id)} /> : null}
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={FILTERS}
              keyExtractor={([k]) => k}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}
              style={{ marginTop: 8, marginBottom: 6 }}
              renderItem={({ item: [k, label] }) => (
                <Pressable onPress={() => setFilter(k)} style={{ height: 44, justifyContent: "center" }} accessibilityState={{ selected: filter === k }}>
                  <View style={[styles.chip, { backgroundColor: filter === k ? t.chipOn : t.chip }]}>
                    <Text style={{ color: filter === k ? t.chipOnInk : t.soft, fontFamily: sansMedium, fontSize: 13 }}>{label}</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.none, { color: t.soft }]}>{filter === "phone" ? "Nothing on this phone yet.\nTap a book and it stays here." : q ? "No book by that name." : "None of these yet."}</Text>
        }
        renderItem={({ item: b }) => (
          <Pressable style={{ width: coverW, marginBottom: 18 }} onPress={() => open(b)} onLongPress={() => manage(b)} accessibilityLabel={b.title}>
            <Cover id={b.id} title={b.title} author={b.author} uri={b.cover} width={coverW} faded={b.state !== "ready" && b.state !== "downloading"} />
            <Status b={b} t={t} />
          </Pressable>
        )}
      />
      <BottomNav t={t} at="/" />
    </View>
  );
}

const Icon = ({ t, name, label, onPress }: { t: Palette; name: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) => (
  <Pressable accessibilityLabel={label} onPress={onPress} style={styles.icon}>
    <Ionicons name={name} size={22} color={t.soft} />
  </Pressable>
);

function Bar({ value, t, color }: { value: number; t: Palette; color?: string }) {
  return (
    <View style={[styles.bar, { backgroundColor: t.line }]}>
      <View style={{ width: `${Math.round(Math.min(1, value) * 100)}%`, height: "100%", backgroundColor: color ?? t.accent }} />
    </View>
  );
}

/** Where a book is: being read, on the phone, on its way, or elsewhere. */
function Status({ b, t }: { b: Book; t: Palette }) {
  const row = (icon: keyof typeof Ionicons.glyphMap, text: string) => (
    <View style={styles.status}>
      <Ionicons name={icon} size={13} color={t.soft} />
      <Text numberOfLines={1} style={[styles.statusText, { color: t.soft }]}>{text}</Text>
    </View>
  );
  if (b.state === "downloading") {
    const p = downloadProgress(b.id);
    return (
      <View style={styles.status}>
        <Bar value={p} t={t} color={t.soft} />
        <Text style={[styles.statusText, { color: t.soft }]}>{Math.round(p * 100)}%</Text>
      </View>
    );
  }
  if (b.state === "ready") {
    if (b.page > 1 && b.total > 1) {
      return (
        <View style={styles.status}>
          <Bar value={(b.page - 1) / (b.total - 1)} t={t} />
          <Text style={[styles.statusText, { color: t.soft }]}>{percent(b.page, b.total)}%</Text>
        </View>
      );
    }
    return row("checkmark", "On phone");
  }
  if (b.state === "failed") return row("alert-circle-outline", "Tap to retry");
  if (b.state === "queued") return row("time-outline", "Waits for a connection");
  return row("cloud-outline", fileSize(b.size));
}

function Continue({ b, t, onPress }: { b: Book; t: Palette; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={`Continue reading ${b.title}`} style={[styles.continue, { backgroundColor: t.card }]}>
      <Cover id={b.id} title={b.title} author={b.author} uri={b.cover} width={92} />
      <View style={{ flex: 1, marginLeft: 16 }}>
        <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 12 }}>Continue reading</Text>
        <Text numberOfLines={2} style={{ color: t.ink, fontFamily: serif, fontSize: 23, lineHeight: 26, marginTop: 6 }}>{b.title}</Text>
        {b.author ? <Text numberOfLines={1} style={{ color: t.soft, fontFamily: sans, fontSize: 13, marginTop: 5 }}>{b.author}</Text> : null}
        {b.total > 1 ? (
          <>
            <View style={{ marginTop: 14 }}><Bar value={(Math.max(b.page, 1) - 1) / (b.total - 1)} t={t} /></View>
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
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 17 },
  none: { textAlign: "center", lineHeight: 22, marginTop: 44, paddingHorizontal: 30, fontFamily: sans },
  bar: { flex: 1, height: 3, borderRadius: 2, overflow: "hidden" },
  status: { height: 26, flexDirection: "row", alignItems: "center", gap: 5 },
  statusText: { fontFamily: sans, fontSize: 11 },
});
