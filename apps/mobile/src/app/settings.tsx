import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { changed, forgetDownloads, getSetting, recentLookups, setSetting } from "../core/db";
import * as Sharing from "expo-sharing";
import { removeAllFiles, usedSpace } from "../core/downloads";
import { exportLogs, log } from "../core/log";
import { useBus } from "../core/store";
import { fileSize } from "../core/words";
import { deva, SHLOKA, sans, sansMedium, serif, serifMedium, type Palette, useTheme } from "../ui/theme";

export default function Settings() {
  useBus(changed);
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [space, setSpace] = useState(0);
  const appearance = getSetting("appearance", "auto");
  const refresh = () => void usedSpace().then(setSpace);

  useEffect(refresh, []);

  const words = recentLookups().slice(0, 12);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 30, paddingHorizontal: 20 }}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </Pressable>
        <Text style={[styles.title, { color: t.ink }]}>Settings</Text>
      </View>

      <Section t={t} title="Appearance">
        <View style={styles.seg}>
          {(["auto", "light", "dark"] as const).map((k) => (
            <Pressable key={k} accessibilityState={{ selected: appearance === k }} onPress={() => setSetting("appearance", k)} style={[styles.segItem, appearance === k && { backgroundColor: t.accent }]}>
              <Text style={{ color: appearance === k ? t.accentInk : t.soft, fontFamily: sansMedium, fontSize: 14 }}>{k === "auto" ? "Like phone" : k === "light" ? "Light" : "Dark"}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: t.soft, fontFamily: sans, fontSize: 13, lineHeight: 19 }}>While reading, tap the middle of the page, then Page and text, for paper, sepia, night, true black and e-ink.</Text>
      </Section>

      <Section t={t} title="On this phone">
        <Row t={t} left="Books" right={fileSize(space)} />
        <Row t={t} left="Dictionary" right="Built in, works offline" />
        <Pressable
          style={{ minHeight: 44, justifyContent: "center" }}
          onPress={() =>
            Alert.alert("Remove all downloads?", "Library books stay listed and download again when you open them. Files you opened yourself are removed.", [
              { text: "Cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: () =>
                  void removeAllFiles().then(() => {
                    forgetDownloads();
                    refresh();
                  }),
              },
            ])
          }
        >
          <Text style={{ color: t.danger, fontFamily: sansMedium, fontSize: 14 }}>Remove all downloads</Text>
        </Pressable>
      </Section>

      <Section t={t} title="Debug logs">
        <Text style={{ color: t.soft, fontFamily: sans, fontSize: 13, lineHeight: 19 }}>The app writes down what it does, kept a week on this phone. If something goes wrong, share them.</Text>
        <Pressable
          style={{ minHeight: 44, justifyContent: "center" }}
          onPress={() =>
            void exportLogs()
              .then((f) => Sharing.shareAsync(f, { mimeType: "text/plain", dialogTitle: "Vāgdevī debug logs" }))
              .catch((e: unknown) => log.error("settings", "share logs failed", e instanceof Error ? e : { e: String(e) }))
          }
        >
          <Text style={{ color: t.accent, fontFamily: sansMedium, fontSize: 14 }}>Share debug logs</Text>
        </Pressable>
      </Section>

      {words.length ? (
        <Section t={t} title="Words you looked up">
          {words.map((w) => (
            <View key={w.word} style={{ marginBottom: 8 }}>
              <Text style={{ color: t.ink, fontFamily: serif, fontSize: 19 }}>{w.word}</Text>
              {w.context ? (
                <Text numberOfLines={1} style={{ color: t.soft, fontFamily: sans, fontSize: 13 }}>
                  {w.context}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}

      <View style={{ alignItems: "center", marginTop: 34, gap: 4 }}>
        <Text style={{ color: t.accent, fontFamily: deva, fontSize: 17, lineHeight: 30, textAlign: "center" }}>{SHLOKA.lines.join("\n")}</Text>
        <Text style={{ color: t.soft, fontFamily: serif, fontStyle: "italic", fontSize: 13, textAlign: "center", paddingHorizontal: 20 }}>{SHLOKA.meaning}</Text>
        <Text style={{ color: t.faint, fontFamily: sans, fontSize: 12, marginTop: 10 }}>Vāgdevī · everything stays on this phone</Text>
      </View>
    </ScrollView>
  );
}

function Section({ t, title, children }: { t: Palette; title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 22, gap: 10 }}>
      <Text style={{ color: t.soft, fontFamily: sansMedium, fontSize: 13 }}>{title}</Text>
      <View style={[styles.card, { backgroundColor: t.card }]}>{children}</View>
    </View>
  );
}

const Row = ({ t, left, right }: { t: Palette; left: string; right: string }) => (
  <View style={styles.row}>
    <Text style={{ color: t.ink, fontFamily: sans, fontSize: 15 }}>{left}</Text>
    <Text numberOfLines={1} style={{ color: t.soft, fontFamily: sans, fontSize: 14, flexShrink: 1, marginLeft: 16 }}>
      {right}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -12 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: serifMedium, fontSize: 30, letterSpacing: -0.5 },
  card: { padding: 16, borderRadius: 18, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 28 },
  seg: { flexDirection: "row", gap: 8 },
  segItem: { flex: 1, alignItems: "center", justifyContent: "center", height: 44, borderRadius: 11 },
});
