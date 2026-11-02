import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sansMedium, type Palette } from "./theme";

const TABS = [
  ["/", "Library", "library-outline"],
  ["/discover", "Discover", "compass-outline"],
] as const;

export function BottomNav({ t, at }: { t: Palette; at: "/" | "/discover" }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: "row", backgroundColor: t.nav, paddingBottom: insets.bottom }}>
      {TABS.map(([href, label, icon]) => (
        <Pressable
          key={href}
          accessibilityRole="tab"
          accessibilityState={{ selected: at === href }}
          style={{ flex: 1, height: 60, alignItems: "center", justifyContent: "center", gap: 3 }}
          onPress={() => at !== href && router.replace(href)}
        >
          <Ionicons name={icon} size={22} color={at === href ? t.accent : t.soft} />
          <Text style={{ fontFamily: sansMedium, fontSize: 11, color: at === href ? t.accent : t.soft }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
