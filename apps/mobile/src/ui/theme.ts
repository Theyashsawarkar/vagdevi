import { useColorScheme } from "react-native";
import { getSetting } from "../core/db";

/** Graphite and lamplight by night; clean paper by day. */
const light = {
  dark: false, bg: "#F7F7F4", card: "#FFFFFF", ink: "#15171C", soft: "#5C616B", faint: "#8A8F99", line: "#E2E2DC", accent: "#A34A12",
  accentInk: "#FFFFFF", chip: "#EAEAE5", chipOn: "#15171C", chipOnInk: "#F7F7F4", nav: "#FFFFFF", danger: "#B3341C",
};
const dark: typeof light = {
  dark: true, bg: "#0F1115", card: "#191C22", ink: "#F1EEE8", soft: "#A0A5AE", faint: "#6E737C", line: "#2B2F37", accent: "#F2B45A",
  accentInk: "#0F1115", chip: "#191C22", chipOn: "#F1EEE8", chipOnInk: "#0F1115", nav: "#15181D", danger: "#FF9B85",
};

export type Palette = typeof light;

export type ThemeChoice = "auto" | "light" | "dark";

export const useTheme = (): Palette => {
  const scheme = useColorScheme();
  const pick = getSetting("appearance", "auto") as ThemeChoice;
  return pick === "dark" || (pick === "auto" && scheme === "dark") ? dark : light;
};

export const serif = "Newsreader_400Regular";
export const serifMedium = "Newsreader_500Medium";
export const sans = "Geist_400Regular";
export const sansMedium = "Geist_500Medium";
export const sansBold = "Geist_600SemiBold";
export const deva = "NotoSerifDevanagari_400Regular";

/** Bṛhadāraṇyaka Upaniṣad 1.3.28: the app's tagline. */
export const SHLOKA = {
  lines: ["असतो मा सद्गमय ।", "तमसो मा ज्योतिर्गमय ।"],
  short: "तमसो मा ज्योतिर्गमय",
  meaning: "From the unreal lead me to the real; from darkness lead me to light.",
  source: "Bṛhadāraṇyaka Upaniṣad 1.3.28",
};
