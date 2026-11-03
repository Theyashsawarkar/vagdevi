import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { archiveFile, gutenbergEditions, gutenbergSummary } from "../core/catalog";
import { addBook, changed, getBook } from "../core/db";
import { cancelDownload, downloadBytes, downloadProgress, pauseDownload, progressBus, pumpDownloads, queueBook, resumeDownload } from "../core/downloads";
import { log } from "../core/log";
import { genreOf } from "../core/genres";
import { selectedBook, selectedGenre } from "../core/selected";
import { useBus } from "../core/store";
import { fileSize } from "../core/words";
import { Cover } from "../ui/cover";
import { toast } from "../ui/toast";
import { sans, sansBold, sansMedium, serif, serifMedium, useTheme } from "../ui/theme";

type Edition = { url: string; size: number };

export default function BookDetail() {
  useBus(changed);
  useBus(progressBus);
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const b = selectedBook();
  const [size, setSize] = useState(b?.size ?? 0);
  const [url, setUrl] = useState(b?.url ?? null);
  const [about, setAbout] = useState(b?.about ?? "");
  const [editions, setEditions] = useState<{ pictures: Edition; plain: Edition } | null>(null);
  const [problem, setProblem] = useState("");
  const [wantRead, setWantRead] = useState(false);
  const guten = b?.key.startsWith("pg") ? b.key.slice(2) : null;

  useEffect(() => {
    if (b?.ia && !b.url) {
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
    if (guten) {
      // extras: the book can be kept without them
      void gutenbergEditions(guten)
        .then((e) => {
          if (e.pictures) {
            setUrl(e.pictures.url);
            setSize(e.pictures.size);
          }
          if (e.pictures && e.plain && e.pictures.size > e.plain.size * 2) {
            setEditions({ pictures: e.pictures, plain: e.plain });
            // on a big one, start from the light edition: pictures are one tap away
            if (e.pictures.size > 8 * 1024 * 1024) {
              setUrl(e.plain.url);
              setSize(e.plain.size);
            }
          }
        })
        .catch(() => undefined);
      void gutenbergSummary(guten)
        .then((s) => s && setAbout(s))
        .catch(() => undefined);
    }
  }, [b?.ia, b?.url, guten]);

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
    addBook({ id: b.key, title: b.title, author: b.author, name: `${b.key}.${b.kind}`, kind: b.kind, size, source: b.source, source_url: url, cover_url: b.cover, genre: selectedGenre() || genreOf([b.title, ...(b.subjects ?? [])]) });
    queueBook(b.key);
    pumpDownloads();
    setWantRead(true);
    toast({ title: "Saved to your Library", detail: "It downloads now, then reads without the internet", icon: "checkmark" });
  };
  const going = state === "queued" || state === "downloading";
  const paused = state === "paused";
  const { written, expected } = downloadBytes(b.key);

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
        {about ? <Text style={{ color: t.ink, opacity: 0.86, fontFamily: serif, fontSize: 17, lineHeight: 25, marginTop: 18 }}>{about}</Text> : null}

        {editions && state === "none" ? (
          <View style={[styles.editions, { backgroundColor: t.card }]}>
            {[["Text only", editions.plain], ["With pictures", editions.pictures]].map(([label, e]) => {
              const on = url === (e as Edition).url;
              return (
                <Pressable
                  key={label as string}
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setUrl((e as Edition).url);
                    setSize((e as Edition).size);
                  }}
                  style={[styles.edition, on && { backgroundColor: t.chipOn }]}
                >
                  <Text style={{ color: on ? t.chipOnInk : t.ink, fontFamily: sansMedium, fontSize: 14 }}>{label as string}</Text>
                  <Text style={{ color: on ? t.chipOnInk : t.soft, fontFamily: sans, fontSize: 12, marginTop: 2 }}>{fileSize((e as Edition).size)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={{ marginTop: 18, gap: 8 }}>
          <Fact t={t} name="From" value={b.source} />
          <Fact t={t} name="Format" value={`${b.kind.toUpperCase()}${size ? `, ${fileSize(size)}` : ""}`} />
          <Fact t={t} name="Rights" value={b.rights} />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24 }}>
        {problem ? <Text style={{ color: t.danger, fontFamily: sans, fontSize: 13, textAlign: "center", marginBottom: 10 }}>{problem}</Text> : null}
        {going || paused ? (
          <>
            <View style={[styles.track, { backgroundColor: t.line }]}>
              <View style={{ height: "100%", width: `${Math.round(downloadProgress(b.key) * 100)}%`, backgroundColor: t.accent }} />
            </View>
            <View style={styles.controls}>
              <Text numberOfLines={1} style={{ flex: 1, color: t.soft, fontFamily: sans, fontSize: 13 }}>
                {paused ? "Paused" : expected ? `${fileSize(written)} of ${fileSize(expected)}` : state === "queued" ? "Waiting for a connection" : "Starting…"}
              </Text>
              <Pressable
                accessibilityLabel={paused ? "Resume download" : "Pause download"}
                style={styles.control}
                onPress={() => {
                  if (paused) resumeDownload(b.key);
                  else void pauseDownload(b.key);
                }}
              >
                <Ionicons name={paused ? "play" : "pause"} size={20} color={t.ink} />
              </Pressable>
              <Pressable
                accessibilityLabel="Cancel download"
                style={styles.control}
                onPress={() => {
                  setWantRead(false);
                  void cancelDownload(b.key);
                }}
              >
                <Ionicons name="close" size={22} color={t.soft} />
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Pressable disabled={!url && state !== "ready"} onPress={keep} style={[styles.button, { backgroundColor: t.accent, opacity: !url && state !== "ready" ? 0.7 : 1 }]}>
              {!url && state !== "ready" && !problem ? (
                <ActivityIndicator color={t.accentInk} />
              ) : (
                <Text style={{ color: t.accentInk, fontFamily: sansBold, fontSize: 16 }}>{state === "ready" ? "Read" : state === "failed" ? "Try again" : "Keep and read"}</Text>
              )}
            </Pressable>
            <Text style={{ textAlign: "center", color: t.soft, fontFamily: sans, fontSize: 12, marginTop: 10 }}>
              {state === "failed" ? "The library sent something other than the book." : "Downloads to this phone. Works offline after that."}
            </Text>
          </>
        )}
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
  editions: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, marginTop: 18 },
  edition: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 11 },
  button: { height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  controls: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  control: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
