import { useRef } from "react";
import { PanResponder, View } from "react-native";

/** A slider for a thumb: the whole height is touchable. */
export function Slider({ value, min, max, step = 1, onChange, onDone, track, fill, label }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onDone?: (v: number) => void; track: string; fill: string; label: string;
}) {
  const width = useRef(1);
  const left = useRef(0);
  const box = useRef<{ measureInWindow: (cb: (x: number) => void) => void } | null>(null);
  const live = useRef({ min, max, step, onChange, onDone });
  live.current = { min, max, step, onChange, onDone };
  const at = (pageX: number) => {
    const { min: a, max: b, step: s } = live.current;
    const f = Math.min(1, Math.max(0, (pageX - left.current) / width.current));
    return Math.min(b, Math.max(a, a + Math.round((f * (b - a)) / s) * s));
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => live.current.onChange(at(e.nativeEvent.pageX)),
      onPanResponderMove: (e) => live.current.onChange(at(e.nativeEvent.pageX)),
      onPanResponderRelease: (e) => live.current.onDone?.(at(e.nativeEvent.pageX)),
    }),
  ).current;
  const pct = `${((value - min) / Math.max(1, max - min)) * 100}%` as const;
  return (
    <View
      ref={box as never}
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
        box.current?.measureInWindow((x) => {
          left.current = x;
        });
      }}
      style={{ height: 44, justifyContent: "center" }}
    >
      <View style={{ height: 3, borderRadius: 2, backgroundColor: track }} />
      <View style={{ position: "absolute", height: 3, borderRadius: 2, width: pct, backgroundColor: fill }} />
      <View style={{ position: "absolute", left: pct, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fill }} />
    </View>
  );
}
