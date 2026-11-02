import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Book, changed, transfers } from "../core/db";
import { cancelDownload, downloadBytes, downloadProgress, downloadSpeed, pauseDownload, progressBus, pumpDownloads, resumeDownload } from "../core/downloads";
import { useBus } from "../core/store";
import { fileSize } from "../core/words";
import { Cover, coverOf } from "../ui/cover";
import { BottomNav } from "../ui/nav";
import { sans, sansMedium, serif, serifMedium, type Palette, useTheme } from "../ui/theme";

export default function Downloads() {
  useBus(changed);
  useBus(progressBus);
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const books = transfers();

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      router.replace("/");
      return true;
    });
    return () => sub.remove();
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 28, paddingHorizontal: 20 }}>
        <Text style={[styles.title, { color: t.ink }]}>Downloads</Text>
        {books.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={34} color={t.soft} />
            <Text style={{ color: t.ink, fontFamily: serif, fontSize: 20, marginTop: 10 }}>Nothing on its way</Text>
            <Text style={{ color: t.soft, fontFamily: sans, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 6 }}>Books you keep from Discover show their progress here, then move to your Library.</Text>
            <Pressable onPress={() => router.replace("/discover")} style={{ minHeight: 44, justifyContent: "center", marginTop: 8 }}>
              <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 15 }}>Find a book</Text>
            </Pressable>
          </View>
        ) : (
          books.map((b) => <Row key={b.id} b={b} t={t} />)
        )}
      </ScrollView>
      <BottomNav t={t} at="/downloads" />
    </View>
  );
}

/** What's happening to it, in words. */
export const describe = (state: string, written: number, expected: number, rate: number, error: string | null) => {
  if (state === "failed") return error ?? "Couldn't download";
  if (state === "paused") return expected ? `Paused at ${fileSize(written)} of ${fileSize(expected)}` : "Paused";
  if (state === "queued") return error ? "Waiting for a connection. It carries on by itself." : "Next in line";
  if (!expected) return "Starting…";
  const left = rate > 1024 ? Math.ceil((expected - written) / rate) : 0;
  const when = left > 90 ? ` · ${Math.ceil(left / 60)} min left` : left > 0 ? ` · ${left} s left` : "";
  return `${fileSize(written)} of ${fileSize(expected)}${rate > 1024 ? ` · ${fileSize(rate)}/s` : ""}${when}`;
};

function Row({ b, t }: { b: Book; t: Palette }) {
  const going = b.state === "downloading";
  const failed = b.state === "failed";
  const { written, expected } = downloadBytes(b.id);
  return (
    <View style={styles.row}>
      <Cover id={b.id} title={b.title} author={b.author} uri={coverOf(b)} width={54} />
      <View style={{ flex: 1, marginLeft: 14, gap: 5 }}>
        <Text numberOfLines={1} style={{ color: t.ink, fontFamily: serifMedium, fontSize: 17 }}>{b.title}</Text>
        {going ? (
          <View style={[styles.track, { backgroundColor: t.line }]}>
            <View style={{ height: "100%", width: `${Math.round(downloadProgress(b.id) * 100)}%`, backgroundColor: t.accent }} />
          </View>
        ) : null}
        <Text numberOfLines={2} style={{ color: failed ? t.danger : t.soft, fontFamily: sans, fontSize: 12, lineHeight: 17 }}>{describe(b.state, written, expected, downloadSpeed(b.id), b.error)}</Text>
      </View>
      <Pressable
        accessibilityLabel={going ? `Pause ${b.title}` : failed ? `Retry ${b.title}` : `Resume ${b.title}`}
        style={styles.icon}
        onPress={() => {
          if (going) void pauseDownload(b.id);
          else if (b.state === "queued") pumpDownloads();
          else resumeDownload(b.id);
        }}
      >
        <Ionicons name={going ? "pause" : failed || b.state === "queued" ? "refresh" : "play"} size={21} color={t.ink} />
      </Pressable>
      <Pressable accessibilityLabel={`Cancel ${b.title}`} style={styles.icon} onPress={() => void cancelDownload(b.id)}>
        <Ionicons name="close" size={21} color={t.soft} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: serifMedium, fontSize: 36, letterSpacing: -0.7, marginBottom: 14 },
  empty: { alignItems: "center", marginTop: 90, paddingHorizontal: 20 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  track: { height: 3, borderRadius: 2, overflow: "hidden" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
