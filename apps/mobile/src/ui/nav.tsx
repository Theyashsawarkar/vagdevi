import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { changed, transfers } from "../core/db";
import { useBus } from "../core/store";
import { sansBold, sansMedium, type Palette } from "./theme";

const TABS = [
  ["/", "Library", "library-outline"],
  ["/discover", "Discover", "compass-outline"],
  ["/downloads", "Downloads", "arrow-down-circle-outline"],
] as const;

export function BottomNav({ t, at }: { t: Palette; at: (typeof TABS)[number][0] }) {
  useBus(changed);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const waiting = transfers().length;
  return (
    <View style={{ flexDirection: "row", backgroundColor: t.nav, paddingBottom: insets.bottom }}>
      {TABS.map(([href, label, icon]) => (
        <Pressable
          key={href}
          accessibilityRole="tab"
          accessibilityLabel={href === "/downloads" && waiting ? `${label}, ${waiting} in progress` : label}
          accessibilityState={{ selected: at === href }}
          style={{ flex: 1, height: 60, alignItems: "center", justifyContent: "center", gap: 3 }}
          onPress={() => at !== href && router.replace(href)}
        >
          <View>
            <Ionicons name={icon} size={22} color={at === href ? t.accent : t.soft} />
            {href === "/downloads" && waiting ? (
              <View style={{ position: "absolute", top: -5, right: -9, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: t.accentInk, fontFamily: sansBold, fontSize: 10 }}>{waiting}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontFamily: sansMedium, fontSize: 11, color: at === href ? t.accent : t.soft }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
