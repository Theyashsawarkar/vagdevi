import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from "@expo-google-fonts/geist";
import { Newsreader_400Regular, Newsreader_500Medium, useFonts } from "@expo-google-fonts/newsreader";
import { NotoSerifDevanagari_400Regular } from "@expo-google-fonts/noto-serif-devanagari";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { changed } from "../core/db";
import { useBus } from "../core/store";
import { watchNetwork } from "../core/downloads";
import { classifyLibrary } from "../core/classify";
import { startLogging } from "../core/log";
import { prepareReader } from "../core/reader";
import { useTheme } from "../ui/theme";

startLogging();
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function Root() {
  useBus(changed);
  const t = useTheme();
  const [ready] = useFonts({ Newsreader_400Regular, Newsreader_500Medium, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, NotoSerifDevanagari_400Regular });
  useEffect(() => {
    watchNetwork();
    // ready before the first book is opened
    void prepareReader().catch(() => undefined);
    void classifyLibrary();
  }, []);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <StatusBar style={t.dark ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: "fade" }}>
          <Stack.Screen name="index" options={{ animation: "none" }} />
          <Stack.Screen name="discover" options={{ animation: "none" }} />
          <Stack.Screen name="downloads" options={{ animation: "none" }} />
          <Stack.Screen name="book" options={{ animation: "slide_from_right" }} />
          <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
