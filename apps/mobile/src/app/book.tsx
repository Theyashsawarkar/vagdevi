import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { archiveFile } from "../core/catalog";
import { addBook, changed, getBook } from "../core/db";
import { downloadProgress, progressBus, pumpDownloads, queueBook } from "../core/downloads";
import { log } from "../core/log";
import { selectedBook } from "../core/selected";
import { useBus } from "../core/store";
import { fileSize } from "../core/words";
import { Cover } from "../ui/cover";
import { sans, sansBold, serif, serifMedium, useTheme } from "../ui/theme";

export default function BookDetail() {
  useBus(changed);
  useBus(progressBus);
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const b = selectedBook();
  const [size, setSize] = useState(b?.size ?? 0);
  const [url, setUrl] = useState(b?.url ?? null);
  const [problem, setProblem] = useState("");
  const [wantRead, setWantRead] = useState(false);

  useEffect(() => {
    if (b?.ia && !url) {
      void archiveFile(b.ia)
        .then((f) => {
          if (!f) return setProblem("This scan has no PDF to download.");
          setUrl(f.url);
          setSize(f.size);
        })
        .catch((e: unknown) => {
          log.warn("book", "archive files failed", { ia: b.ia, why: e instanceof Error ? e.message : String(e) });
          setProblem("Can't reach the Internet Archive right now.");
        });
    }
  }, [b?.ia, url]);

  const kept = b ? getBook(b.key) : null;
  const state = kept?.state ?? "none";

  // opens by itself when the download you asked for arrives
  useEffect(() => {
    if (wantRead && state === "ready" && b) {
      setWantRead(false);
      router.replace({ pathname: "/read/[id]", params: { id: b.key } });
    }
  }, [wantRead, state, b, router]);

  if (!b) return null;

  const keep = () => {
    if (state === "ready") return router.replace({ pathname: "/read/[id]", params: { id: b.key } });
    if (!url) return;
    log.info("book", "keep", { key: b.key, source: b.source, kind: b.kind, url, size });
    addBook({ id: b.key, title: b.title, author: b.author, name: `${b.key}.${b.kind}`, kind: b.kind, size, source: b.source, source_url: url, cover_url: b.cover });
    queueBook(b.key);
    pumpDownloads();
    setWantRead(true);
  };
  const going = state === "queued" || state === "downloading";
  const pct = Math.round(downloadProgress(b.key) * 100);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 18 }}>
      <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
        <Ionicons name="chevron-back" size={24} color={t.ink} />
      </Pressable>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 12 }}>
        <View style={{ alignItems: "center", marginTop: 4 }}>
          <Cover id={b.key} title={b.title} author={b.author} uri={b.cover} width={164} />
        </View>
        <Text style={[styles.title, { color: t.ink }]}>{b.title}</Text>
        {b.author ? <Text style={{ textAlign: "center", color: t.soft, fontFamily: sans, fontSize: 14, marginTop: 6 }}>{b.author}</Text> : null}
        {b.about ? <Text style={{ color: t.ink, opacity: 0.86, fontFamily: serif, fontSize: 17, lineHeight: 25, marginTop: 18 }}>{b.about}</Text> : null}
        <View style={{ marginTop: 18, gap: 8 }}>
          <Fact t={t} name="From" value={b.source} />
          <Fact t={t} name="Format" value={`${b.kind.toUpperCase()}${size ? `, ${fileSize(size)}` : ""}`} />
          <Fact t={t} name="Rights" value={b.rights} />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24 }}>
        {problem ? <Text style={{ color: t.danger, fontFamily: sans, fontSize: 13, textAlign: "center", marginBottom: 10 }}>{problem}</Text> : null}
        <Pressable disabled={going || (!url && state !== "ready")} onPress={keep} style={[styles.button, { backgroundColor: t.accent, opacity: going || (!url && state !== "ready") ? 0.7 : 1 }]}>
          {!url && state !== "ready" && !problem ? <ActivityIndicator color={t.accentInk} /> : (
            <Text style={{ color: t.accentInk, fontFamily: sansBold, fontSize: 16 }}>
              {state === "ready" ? "Read" : going ? `Downloading ${pct}%` : state === "failed" ? "Try again" : "Keep and read"}
            </Text>
          )}
        </Pressable>
        <Text style={{ textAlign: "center", color: t.soft, fontFamily: sans, fontSize: 12, marginTop: 10 }}>
          {state === "failed" ? "The library sent something other than the book." : "Downloads to this phone. Works offline after that."}
        </Text>
      </View>
    </View>
  );
}

const Fact = ({ t, name, value }: { t: ReturnType<typeof useTheme>; name: string; value: string }) => (
  <View style={{ flexDirection: "row", gap: 16 }}>
    <Text style={{ width: 54, color: t.soft, fontFamily: sans, fontSize: 13 }}>{name}</Text>
    <Text style={{ flex: 1, color: t.ink, fontFamily: sans, fontSize: 13, lineHeight: 18 }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  back: { width: 44, height: 44, marginLeft: 12, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: serifMedium, fontSize: 30, lineHeight: 33, textAlign: "center", marginTop: 22, letterSpacing: -0.4 },
  button: { height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
});
