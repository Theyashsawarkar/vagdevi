import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listeners, useBus } from "../core/store";
import { sans, sansMedium, useTheme } from "./theme";

type Toast = {
  title: string;
  /** one line on what this means, or where to find it */
  detail?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** how far above the bottom edge: screens with tall bottom bars lift it */
  above?: number;
};

const bus = listeners();
let current: (Toast & { n: number }) | null = null;

/** Says what just happened, for a moment. A new one replaces the last. */
export const toast = (t: Toast) => {
  current = { ...t, n: (current?.n ?? 0) + 1 };
  AccessibilityInfo.announceForAccessibility(t.detail ? `${t.title}. ${t.detail}` : t.title);
  bus.emit();
};

const SHOW_MS = 2600;

export function ToastHost() {
  useBus(bus);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<typeof current>(null);

  useEffect(() => {
    if (!current || current.n === shown?.n) return;
    setShown(current);
    anim.stopAnimation();
    anim.setValue(0);
    const run = Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(SHOW_MS),
      Animated.timing(anim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]);
    run.start(({ finished }) => finished && setShown(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus.version()]);

  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: insets.bottom + (shown.above ?? 76),
        alignItems: "center",
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          maxWidth: 420,
          paddingVertical: 12,
          paddingLeft: 14,
          paddingRight: 18,
          borderRadius: 18,
          backgroundColor: t.chipOn,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        {shown.icon ? (
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={shown.icon} size={18} color={t.accentInk} />
          </View>
        ) : null}
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: t.chipOnInk, fontFamily: sansMedium, fontSize: 15 }}>{shown.title}</Text>
          {shown.detail ? <Text style={{ color: t.chipOnInk, opacity: 0.75, fontFamily: sans, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{shown.detail}</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
}
