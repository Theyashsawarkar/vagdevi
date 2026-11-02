import { Ionicons } from "@expo/vector-icons";
import * as FS from "expo-file-system/legacy";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { setStatusBarHidden } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView as RNWebView } from "react-native-webview";
import { bookmarks, changed, getBook, getMark, getSetting, markOpened, rememberLookup, type ResumeMark, saveProgress, setCover, setFavorite, setMark, setSetting, toggleBookmark } from "../../core/db";
import { log } from "../../core/log";
import { define, type Definition } from "../../core/dict";
import { prepareReader, readerDir } from "../../core/reader";
import { useBus } from "../../core/store";
import { Slider } from "../../ui/slider";
import { sans, sansMedium, serif } from "../../ui/theme";

// its types don't match this React's yet
const WebView = RNWebView as unknown as ComponentType<Record<string, unknown>>;

type Theme = "paper" | "sepia" | "night" | "black" | "eink";
const THEMES: [Theme, string, string][] = [["paper", "Paper", "#FBFAF6"], ["sepia", "Sepia", "#F3E7CF"], ["night", "Night", "#101114"], ["black", "Black", "#000000"], ["eink", "E-ink", "#FFFFFF"]];
const COLORS: Record<Theme, { bg: string; ink: string; soft: string; bar: string; edge: string; well: string; accent: string; onAccent: string; flat: boolean }> = {
  paper: { bg: "#FBFAF6", ink: "#1F1E1B", soft: "#66635C", bar: "#F1EFE8", edge: "#DCD9CF", well: "#FBFAF6", accent: "#A34A12", onAccent: "#FFFFFF", flat: false },
  sepia: { bg: "#F3E7CF", ink: "#3A2E1E", soft: "#6E5C41", bar: "#EADBBC", edge: "#D3BF97", well: "#F3E7CF", accent: "#8F4A12", onAccent: "#FFF8EA", flat: false },
  night: { bg: "#101114", ink: "#D9D5CC", soft: "#969AA2", bar: "#1C1E24", edge: "#30333B", well: "#101114", accent: "#F2B45A", onAccent: "#101114", flat: false },
  black: { bg: "#000000", ink: "#C9C9C9", soft: "#8C8C8C", bar: "#0B0B0B", edge: "#262626", well: "#000000", accent: "#F2B45A", onAccent: "#000000", flat: true },
  eink: { bg: "#FFFFFF", ink: "#000000", soft: "#444444", bar: "#FFFFFF", edge: "#000000", well: "#FFFFFF", accent: "#000000", onAccent: "#FFFFFF", flat: true },
};
const FONTS = [["Newsreader", "Newsreader"], ["Literata", "Literata"], ["serif", "System"]] as const;
const TURNS = [["flip", "Book flip"], ["fold", "Quick fold"], ["none", "None"]] as const;
type Turn = (typeof TURNS)[number][0];

type Message = { type: string; target?: ResumeMark | null; marked?: boolean; resumed?: boolean; level?: "debug" | "info" | "warn" | "error"; msg?: string; page?: number; total?: number; word?: string; context?: string; message?: string; dir?: number; toc?: { title: string; page: number; depth?: number }[]; busy?: boolean; data?: string; layout?: string; canFlow?: boolean; flow?: boolean };

const speedWord = (ms: number) => (ms < 400 ? "brisk" : ms < 800 ? "like a real page" : "unhurried");

export default function Read() {
  useKeepAwake();
  useBus(changed);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const wide = screenW > screenH;
  const book = useMemo(() => getBook(id), [id]);
  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => getSetting("readerTheme", "night") as Theme);
  const [page, setPage] = useState(Math.max(book?.page ?? 1, 1));
  const [total, setTotal] = useState(Math.max(book?.total ?? 1, 1));
  const [chrome, setChrome] = useState(false);
  const [sheet, setSheet] = useState<"none" | "settings" | "contents">("none");
  const [word, setWord] = useState<{ word: string | null; def?: Definition | null; failed?: boolean; target: ResumeMark | null; marked: boolean } | null>(null);
  const mark = getMark(id ?? "");
  const [turn, setTurn] = useState<Turn>(() => getSetting("turn", "flip") as Turn);
  const [speed, setSpeed] = useState(() => Number(getSetting("flipMs", "600")));
  const [size, setSize] = useState(() => Number(getSetting("fontSize", "18")));
  const [font, setFont] = useState(() => getSetting("readerFont", "Newsreader"));
  // a PDF opens as printed; Reading mode is one tap away in the controls
  const [layout, setLayoutState] = useState(() => getSetting(`layout:${id}`, "page"));
  const [canFlow, setCanFlow] = useState(true);
  const [flow, setFlow] = useState(false);
  const [toc, setToc] = useState<{ title: string; page: number; depth?: number }[]>([]);
  const [tocBusy, setTocBusy] = useState(false);
  const contents = useRef<{ scrollTo: (o: { y: number; animated: boolean }) => void } | null>(null);
  const [note, setNote] = useState("");
  const [coach, setCoach] = useState(() => getSetting("coached", "") === "");
  const c = COLORS[theme];
  const call = (js: string) => web.current?.injectJavaScript(`${js};true;`);
  const cacheKey = `${id}:${book?.file_mtime ?? 0}:3`;

  useEffect(() => {
    if (id) markOpened(id);
    log.info("read", "open book", { id, kind: book?.kind, source: book?.source, bytes: book?.size });
    void prepareReader().then(setUri);
    return () => setStatusBarHidden(false, "fade");
  }, [id]);

  useEffect(() => {
    setStatusBarHidden(!chrome && sheet === "none", "fade");
  }, [chrome, sheet]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(""), 3500);
    return () => clearTimeout(timer);
  }, [note]);

  const onMessage = async (e: { nativeEvent: { data: string } }) => {
    const m = JSON.parse(e.nativeEvent.data) as Message;
    switch (m.type) {
      case "ready": {
        if (!book?.file) return;
        const text = book.kind === "markdown" ? await FS.readAsStringAsync(book.file) : undefined;
        const settings = { turn, speed, size, font, safeBottom: insets.bottom, safeTop: insets.top };
        const saved = getMark(book.id);
        call(`reader.open(${JSON.stringify({ id, url: book.file, kind: book.kind, page: Math.max(book.page, 1), savedTotal: book.total, theme, settings, text, layout, cacheKey, wantCover: !book.cover && !book.cover_url, mark: saved })})`);
        break;
      }
      case "log":
        log[m.level ?? "info"]("reader", m.msg ?? "", m.data);
        break;
      case "loaded":
        setFlow(!!m.flow);
        if (m.resumed && book) {
          const saved = getMark(book.id);
          setNote(saved?.snippet ? `Picking up where you stopped: “${saved.snippet.slice(0, 60)}…”` : "Picking up where you stopped");
        }
        setPage(m.page ?? 1);
        setTotal(m.total ?? 1);
        if (id) saveProgress(id, m.page ?? 1, m.total ?? 1);
        break;
      case "page":
        setPage(m.page ?? 1);
        setTotal(m.total ?? 1);
        if (id) saveProgress(id, m.page ?? 1, m.total ?? 1);
        break;
      case "layout":
        setLayoutState(m.layout ?? "page");
        setFlow(m.layout === "text");
        break;
      case "scanned":
        setCanFlow(false);
        setNote("This is a scan with no text in it, so it stays as printed pages.");
        break;
      case "toc":
        setToc(m.toc ?? []);
        log.debug("read", "contents", { entries: m.toc?.length ?? 0 });
        break;
      case "tocBusy":
        setTocBusy(!!m.busy);
        break;
      case "cover":
        if (id && m.data) {
          const dir = `${FS.documentDirectory}covers/`;
          await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
          await FS.writeAsStringAsync(`${dir}${id}.jpg`, m.data, { encoding: FS.EncodingType.Base64 });
          setCover(id, `${dir}${id}.jpg`);
        }
        break;
      case "tap":
        if (word) {
          setWord(null);
          call("reader.clearMark()");
        } else if (sheet !== "none") setSheet("none");
        else setChrome((v) => !v);
        break;
      case "hold": {
        // a long press: the word's meaning, and the paragraph to resume from
        const looked = m.word ?? null;
        setChrome(false);
        setSheet("none");
        setWord({ word: looked, target: m.target ?? null, marked: !!m.marked });
        if (!looked) break;
        rememberLookup(looked, m.context ?? "");
        const def = await define(looked).catch((e: unknown) => {
          log.error("dict", "lookup failed", e instanceof Error ? e : { e: String(e) });
          return undefined;
        });
        log.debug("dict", "lookup", { word: looked, found: !!def });
        setWord((w) => (w?.word === looked ? { ...w, def: def ?? null, failed: def === undefined } : w));
        break;
      }
      case "markLost":
        setNote("That mark is in the other layout of this PDF");
        break;
      case "edge":
        if (m.dir === 1) setNote("That's the last page");
        else if (m.dir === -1) setNote("That's the first page");
        break;
      case "error":
        setNote(m.message ?? "This file can't be read");
        log.error("read", "reader error", { id, message: m.message });
        break;
    }
  };

  const pickTheme = (next: Theme) => {
    setThemeState(next);
    setSetting("readerTheme", next);
    call(`reader.setTheme(${JSON.stringify(next)})`);
    // e-ink has no animation to show; leaving it brings yours back
    const wanted: Turn = next === "eink" ? "none" : (getSetting("turn", "flip") as Turn);
    setTurn(wanted);
    call(`reader.setSettings(${JSON.stringify({ turn: wanted })})`);
  };
  const pickTurn = (next: Turn) => {
    setTurn(next);
    setSetting("turn", next);
    call(`reader.setSettings(${JSON.stringify({ turn: next })})`);
  };
  const resize = (d: number) => {
    const s = Math.min(30, Math.max(13, size + d));
    setSize(s);
    setSetting("fontSize", String(s));
    call(`reader.setSettings(${JSON.stringify({ size: s })})`);
  };
  const pickFont = (f: string) => {
    setFont(f);
    setSetting("readerFont", f);
    call(`reader.setSettings(${JSON.stringify({ font: f })})`);
  };
  const pickLayout = (l: string) => {
    setSetting(`layout:${id}`, l);
    setSheet("none");
    setChrome(false);
    call(`reader.setLayout(${JSON.stringify(l)}, ${JSON.stringify(cacheKey)})`);
  };

  if (!book?.file) {
    return (
      <View style={[styles.gone, { backgroundColor: c.bg }]}>
        <Text style={{ color: c.ink, fontFamily: serif, fontSize: 18 }}>This book isn't on the phone any more.</Text>
        <Pressable onPress={() => router.back()} style={{ height: 44, justifyContent: "center" }}>
          <Text style={{ color: c.accent, fontFamily: sansMedium }}>Back to your library</Text>
        </Pressable>
      </View>
    );
  }

  const marked = bookmarks(book.id);
  const live = getBook(book.id);
  const isMarked = marked.includes(page);
  const bar = { backgroundColor: c.bar, borderColor: c.edge, borderWidth: c.flat ? StyleSheet.hairlineWidth : 0 };
  const closeBtn = (onPress: () => void) => (
    <Pressable accessibilityLabel="Close" onPress={onPress} style={styles.icon}>
      <Ionicons name="close" size={22} color={c.soft} />
    </Pressable>
  );
  const sheetRadius = theme === "eink" ? 0 : 24;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {uri ? (
        <WebView
          ref={web}
          source={{ uri }}
          style={{ flex: 1, backgroundColor: c.bg }}
          originWhitelist={["file://*"]}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          allowingReadAccessToURL={readerDir()}
          // only the reader's own files: nothing in a book can open the web
          onShouldStartLoadWithRequest={(r: { url: string }) => r.url.startsWith("file://") || r.url.startsWith("blob:")}
          setSupportMultipleWindows={false}
          overScrollMode="never"
          scrollEnabled={false}
          textZoom={100}
          domStorageEnabled
          onMessage={(e: { nativeEvent: { data: string } }) => void onMessage(e)}
        />
      ) : null}

      {note ? (
        <View pointerEvents="none" style={[styles.note, bar, { bottom: insets.bottom + (chrome ? 150 : 40) }]}>
          <Text style={{ color: c.ink, fontFamily: sans, fontSize: 14 }}>{note}</Text>
        </View>
      ) : null}

      {chrome ? (
        <>
          <View style={[styles.top, bar, { paddingTop: insets.top + 6 }]}>
            <Pressable accessibilityLabel="Back to your library" onPress={() => router.back()} style={styles.icon}>
              <Ionicons name="chevron-back" size={24} color={c.ink} />
            </Pressable>
            <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontFamily: serif, fontSize: 17 }}>{book.title}</Text>
            <Pressable accessibilityLabel={live?.favorite ? "Remove from favorites" : "Add to favorites"} accessibilityState={{ selected: !!live?.favorite }} onPress={() => setFavorite([book.id], !live?.favorite)} style={styles.icon}>
              <Ionicons name={live?.favorite ? "heart" : "heart-outline"} size={21} color={live?.favorite ? c.accent : c.soft} />
            </Pressable>
            <Pressable accessibilityLabel="Bookmark this page" accessibilityState={{ selected: isMarked }} onPress={() => toggleBookmark(book.id, page)} style={styles.icon}>
              <Ionicons name={isMarked ? "bookmark" : "bookmark-outline"} size={21} color={isMarked ? c.accent : c.soft} />
            </Pressable>
          </View>
          <View style={[styles.bottom, bar, { paddingBottom: insets.bottom + (wide ? 2 : 8), paddingTop: wide ? 4 : 14 }]}>
            <View style={wide ? styles.wideRow : undefined}>
              <View style={[styles.rowBetween, wide && { gap: 10 }]}>
                <Text style={{ color: c.soft, fontFamily: sans, fontSize: 13 }}>Page {page} of {total}</Text>
                {wide ? null : <Text style={{ color: c.soft, fontFamily: sans, fontSize: 13 }}>{Math.round(((page - 1) / Math.max(1, total - 1)) * 100)}%</Text>}
              </View>
              {total > 1 ? (
                <View style={wide ? { flex: 1 } : undefined}>
                  <Slider label="Page" value={page} min={1} max={total} track={c.edge} fill={c.accent} onChange={setPage} onDone={(p) => call(`reader.goTo(${p})`)} />
                </View>
              ) : null}
            </View>
            <View style={wide ? styles.wideRow : undefined}>
              {book.kind === "pdf" && canFlow ? (
                <View style={wide ? { flex: 1, marginTop: -8 } : undefined}>
                  <Segments c={c} options={[["page", "Original"], ["text", "Reading mode"]] as const} value={layout} onPick={pickLayout} />
                </View>
              ) : null}
              <View style={{ flexDirection: "row", flex: wide ? 1 : undefined }}>
                <Pressable style={styles.barButton} onPress={() => setSheet("contents")}>
                  <Text style={{ color: c.ink, fontFamily: sansMedium, fontSize: 14 }}>Contents</Text>
                </Pressable>
                <Pressable style={styles.barButton} onPress={() => setSheet("settings")}>
                  <Text style={{ color: c.ink, fontFamily: sansMedium, fontSize: 14 }}>Page and text</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </>
      ) : null}

      {sheet === "settings" ? (
        <View style={[styles.sheet, bar, { paddingBottom: insets.bottom + 16, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius }]}>
          <View style={{ alignItems: "flex-end", marginRight: -12 }}>{closeBtn(() => setSheet("none"))}</View>
          <ScrollView style={{ maxHeight: Math.min(560, screenH * 0.72) }} showsVerticalScrollIndicator={false}>
            <Label c={c}>Page</Label>
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              {THEMES.map(([k, label, color]) => (
                <Pressable key={k} accessibilityState={{ selected: theme === k }} onPress={() => pickTheme(k)} style={{ flex: 1, alignItems: "center", gap: 6, paddingVertical: 4 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: color, borderWidth: 2, borderColor: theme === k ? c.accent : c.edge }} />
                  <Text style={{ color: theme === k ? c.ink : c.soft, fontFamily: sans, fontSize: 12 }}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Label c={c} top={16}>Page turn</Label>
            <Segments c={c} options={TURNS} value={turn} onPick={pickTurn} />
            {turn !== "none" ? (
              <>
                <View style={[styles.rowBetween, { marginTop: 14 }]}>
                  <Text style={{ color: c.soft, fontFamily: sans, fontSize: 13 }}>Flip speed</Text>
                  <Text style={{ color: c.soft, fontFamily: sans, fontSize: 13 }}>{(speed / 1000).toFixed(2)} s, {speedWord(speed)}</Text>
                </View>
                <Slider
                  label="Flip speed"
                  value={speed}
                  min={150}
                  max={1500}
                  step={50}
                  track={c.edge}
                  fill={c.accent}
                  onChange={setSpeed}
                  onDone={(v) => {
                    setSetting("flipMs", String(v));
                    // shows the new speed, and comes back to your page
                    call(`reader.setSettings(${JSON.stringify({ speed: v })});reader.next();setTimeout(()=>reader.prev(),${v + 200})`);
                  }}
                />
              </>
            ) : null}

            {book.kind === "pdf" && !canFlow ? <Text style={{ color: c.soft, fontFamily: sans, fontSize: 13, lineHeight: 19, marginTop: 8 }}>A scan with no text inside, so it stays as printed pages.</Text> : null}

            {flow ? (
              <>
                <Label c={c} top={14}>Typeface</Label>
                <Segments c={c} options={FONTS} value={font} onPick={pickFont} />
                <View style={[styles.rowBetween, { marginTop: 10 }]}>
                  <Label c={c}>Text size</Label>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Pressable accessibilityLabel="Smaller text" onPress={() => resize(-1)} style={styles.sizeBtn}>
                      <Text style={{ color: c.ink, fontFamily: serif, fontSize: 16 }}>A</Text>
                    </Pressable>
                    <Text style={{ width: 30, textAlign: "center", color: c.soft, fontFamily: sans, fontSize: 13 }}>{size}</Text>
                    <Pressable accessibilityLabel="Larger text" onPress={() => resize(1)} style={styles.sizeBtn}>
                      <Text style={{ color: c.ink, fontFamily: serif, fontSize: 25 }}>A</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {sheet === "contents" ? (
        <View style={[styles.index, { backgroundColor: c.bg, paddingTop: insets.top + 6, paddingBottom: insets.bottom }]}>
          <View style={styles.indexHead}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: c.ink, fontFamily: serif, fontSize: 26 }}>Contents</Text>
              <Text numberOfLines={1} style={{ color: c.soft, fontFamily: sans, fontSize: 13, marginTop: 2 }}>{book.title} · page {page} of {total}</Text>
            </View>
            {closeBtn(() => setSheet("none"))}
          </View>
          <View style={[styles.indexBar, { backgroundColor: c.edge }]}>
            <View style={{ height: "100%", width: `${Math.round(((page - 1) / Math.max(1, total - 1)) * 100)}%`, backgroundColor: c.accent }} />
          </View>
          <ScrollView ref={contents as never} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 24 }}>
            {mark ? (
              <View style={{ marginTop: 14 }}>
                <Label c={c}>Resume mark</Label>
                <View style={styles.row}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }} onPress={() => { setSheet("none"); setChrome(false); call("reader.goToMark()"); }}>
                    <Ionicons name="flag" size={15} color={c.accent} />
                    <Text numberOfLines={2} style={{ flex: 1, color: c.ink, fontFamily: serif, fontSize: 16, lineHeight: 21 }}>“{mark.snippet || "Where you stopped"}”</Text>
                  </Pressable>
                  <Pressable accessibilityLabel="Remove resume mark" style={styles.icon} onPress={() => { if (id) setMark(id, null); call("reader.setMark(null)"); log.info("mark", "removed from contents", { id }); }}>
                    <Ionicons name="close" size={18} color={c.soft} />
                  </Pressable>
                </View>
              </View>
            ) : null}
            {marked.length ? (
              <View style={{ marginTop: 14 }}>
                <Label c={c}>Bookmarks</Label>
                {marked.map((p) => (
                  <Pressable key={p} style={styles.row} onPress={() => { setSheet("none"); setChrome(false); call(`reader.goTo(${p})`); }}>
                    <Ionicons name="bookmark" size={15} color={c.accent} />
                    <Text style={{ color: c.ink, fontFamily: serif, fontSize: 17 }}>Page {p}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {mark || marked.length ? <View style={{ marginTop: 14 }}><Label c={c}>Chapters</Label></View> : <View style={{ height: 8 }} />}
            {toc.length === 0 ? <Text style={{ color: c.soft, fontFamily: sans, fontSize: 14, lineHeight: 21, marginTop: 8 }}>{tocBusy ? "Reading the book for its chapters…" : "This book doesn't list its chapters. The slider moves through it."}</Text> : null}
            {toc.map((x, i) => {
              const next = toc[i + 1]?.page ?? Number.POSITIVE_INFINITY;
              const here = page >= x.page && page < next;
              const depth = Math.min(x.depth ?? 0, 3);
              return (
                <Pressable
                  key={`${x.page}${i}`}
                  accessibilityState={{ selected: here }}
                  onLayout={here ? (e) => contents.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 160), animated: false }) : undefined}
                  style={[styles.indexRow, { paddingLeft: depth * 16 }]}
                  onPress={() => { setSheet("none"); setChrome(false); call(`reader.goTo(${x.page})`); }}
                >
                  <Text numberOfLines={2} style={{ flex: 1, color: here ? c.accent : depth ? c.soft : c.ink, fontFamily: depth ? sans : serif, fontSize: depth ? 14 : 18, lineHeight: depth ? 20 : 24 }}>{x.title}</Text>
                  <Text style={{ color: here ? c.accent : c.soft, fontFamily: sans, fontSize: 13 }}>{x.page}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {word ? (
        <View style={[styles.sheet, bar, { paddingBottom: insets.bottom + 18, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius, paddingTop: 14 }]}>
          <View style={styles.rowBetween}>
            <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontFamily: serif, fontSize: word.word ? 36 : 24 }}>{word.def?.word ?? word.word ?? "This paragraph"}</Text>
            <View style={{ marginRight: -12 }}>{closeBtn(() => { setWord(null); call("reader.clearMark()"); })}</View>
          </View>

          {word.target ? (
            <Pressable
              accessibilityState={{ selected: word.marked }}
              onPress={() => {
                const next = word.marked ? null : word.target;
                if (id) setMark(id, next);
                call(`reader.setMark(${JSON.stringify(next)})`);
                call("reader.clearMark()");
                setWord(null);
                setNote(next ? "Marked. Tomorrow the book opens right here." : "Resume mark removed");
                log.info("mark", next ? "set" : "removed", { id, kind: next?.kind });
              }}
              style={[styles.markBtn, { borderColor: c.accent, backgroundColor: word.marked ? "transparent" : c.accent }]}
            >
              <Ionicons name={word.marked ? "close-circle-outline" : "flag-outline"} size={18} color={word.marked ? c.accent : c.onAccent} />
              <Text style={{ color: word.marked ? c.accent : c.onAccent, fontFamily: sansMedium, fontSize: 15 }}>{word.marked ? "Remove resume mark" : "Resume here tomorrow"}</Text>
            </Pressable>
          ) : null}
          <ScrollView style={{ maxHeight: Math.min(280, screenH * 0.38) }}>
            {word.word && word.def === undefined && !word.failed ? <Text style={{ color: c.soft, fontFamily: sans }}>Looking it up…</Text> : null}
            {word.word && (word.def === null || word.failed) ? (
              <Text style={{ color: c.soft, fontFamily: sans, lineHeight: 21 }}>{word.failed ? "The dictionary couldn't be opened." : "Not in this dictionary. It covers nouns, verbs, adjectives and adverbs in English."}</Text>
            ) : null}
            {word.def?.senses.map((s, i) => (
              <View key={`${s.pos}${i}`} style={{ marginBottom: 14 }}>
                <Text style={{ color: c.accent, fontFamily: sansMedium, fontSize: 12 }}>{s.pos}</Text>
                <Text style={{ color: c.ink, fontFamily: serif, fontSize: 18, lineHeight: 26, marginTop: 3 }}>{s.gloss}</Text>
                {s.examples[0] ? <Text style={{ color: c.soft, fontFamily: "Newsreader_400Regular", fontStyle: "italic", fontSize: 16, lineHeight: 23 }}>“{s.examples[0]}”</Text> : null}
                {s.synonyms.length ? <Text style={{ color: c.soft, fontFamily: sans, fontSize: 13, marginTop: 4 }}>Also: {s.synonyms.join(", ")}</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {coach && uri ? (
        <View style={styles.coach}>
          <View style={{ flex: 1, flexDirection: "row" }}>
            <Zone icon="chevron-back" label="Back" flex={3} />
            <View style={styles.zoneLine} />
            <Zone icon="menu" label="Controls" flex={4} />
            <View style={styles.zoneLine} />
            <Zone icon="chevron-forward" label="Next" flex={3} />
          </View>
          <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 26 }}>
            <Text style={{ color: "#fff", fontFamily: sans, fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 14 }}>Swipe to turn a page by hand. Press and hold a word for its meaning.</Text>
            <Pressable
              style={styles.gotIt}
              onPress={() => {
                setSetting("coached", "1");
                setCoach(false);
              }}
            >
              <Text style={{ color: "#000", fontFamily: sansMedium, fontSize: 15 }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

type C = (typeof COLORS)[Theme];

const Label = ({ c, top, children }: { c: C; top?: number; children: ReactNode }) => <Text style={{ color: c.soft, fontFamily: sansMedium, fontSize: 13, marginTop: top ?? 0 }}>{children}</Text>;

function Segments<K extends string>({ c, options, value, onPick }: { c: C; options: readonly (readonly [K, string])[]; value: string; onPick: (k: K) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, marginTop: 8, padding: 3, borderRadius: c.accent === "#000000" ? 0 : 13, backgroundColor: c.well, borderWidth: c.accent === "#000000" ? 1 : 0 }}>
      {options.map(([k, label]) => (
        <Pressable key={k} accessibilityState={{ selected: value === k }} onPress={() => onPick(k)} style={{ flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: c.accent === "#000000" ? 0 : 10, backgroundColor: value === k ? c.accent : "transparent" }}>
          <Text style={{ color: value === k ? c.onAccent : c.soft, fontFamily: sansMedium, fontSize: 14 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const Zone = ({ icon, label, flex }: { icon: keyof typeof Ionicons.glyphMap; label: string; flex: number }) => (
  <View style={{ flex, alignItems: "center", justifyContent: "center", gap: 8 }}>
    <Ionicons name={icon} size={26} color="#fff" />
    <Text style={{ color: "#fff", fontFamily: sansMedium, fontSize: 15 }}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  gone: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingBottom: 8 },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 14 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wideRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  barButton: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 8 },
  sizeBtn: { width: 54, height: 44, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 6 },
  index: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  indexHead: { flexDirection: "row", alignItems: "center", paddingLeft: 22, paddingRight: 10, paddingBottom: 10 },
  indexBar: { height: 2, overflow: "hidden" },
  indexRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 46, paddingVertical: 6 },
  markBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 24, borderWidth: 1.5, marginBottom: 14 },
  note: { position: "absolute", alignSelf: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, maxWidth: "88%" },
  coach: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,.76)" },
  zoneLine: { width: 1, marginVertical: 80, backgroundColor: "rgba(255,255,255,.35)" },
  gotIt: { height: 50, borderRadius: 25, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
