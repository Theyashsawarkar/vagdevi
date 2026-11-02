import { useState } from "react";
import { Image, Text, View } from "react-native";
import { sans, serif } from "./theme";

const CLOTH = [
  ["#23465F", "#F4EAD7", "#E9A23B"], ["#B93A20", "#FFF1E0", "#F2B45A"], ["#E8D9B5", "#1C2B2A", "#2F6F62"], ["#2E5A3C", "#EAF2D7", "#A7C957"],
  ["#23262E", "#E8E6E1", "#7C8CF8"], ["#3B2A5C", "#F3E3C2", "#F2B45A"], ["#F0EDE4", "#14222B", "#D9482B"], ["#0E3B66", "#EAF1FA", "#F4F1E6"], ["#7A2E3A", "#FBE9E0", "#E9A23B"],
] as const;

const hash = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** A book's face: its own cover if it has one, else a made one, never a blank. */
export function Cover({ id, title, author, uri, width, faded }: { id: string; title: string; author?: string; uri?: string | null; width: number; faded?: boolean }) {
  const [bad, setBad] = useState(false);
  const height = Math.round(width * 1.42);
  const h = hash(id);
  const [bg, fg, mark] = CLOTH[h % CLOTH.length] as (typeof CLOTH)[number];
  const r = width * 0.6;
  const radius = { borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 7, borderBottomRightRadius: 7 };
  return (
    <View style={{ width, height, overflow: "hidden", opacity: faded ? 0.38 : 1, backgroundColor: bg, ...radius }}>
      {uri && !bad ? (
        <Image source={{ uri }} onError={() => setBad(true)} style={{ width, height }} resizeMode="cover" />
      ) : (
        <View style={{ flex: 1, padding: width * 0.09, paddingLeft: width * 0.13, justifyContent: "flex-end" }}>
          <View style={{ position: "absolute", width: r, height: r, borderRadius: r / 2, backgroundColor: mark, top: ((h >> 3) % 40) - 18, right: ((h >> 7) % 44) - 22 }} />
          <Text numberOfLines={4} style={{ fontFamily: serif, fontSize: Math.max(12, width * 0.135), lineHeight: Math.max(14, width * 0.15), color: fg }}>
            {title}
          </Text>
          {author ? (
            <Text numberOfLines={1} style={{ fontFamily: sans, fontSize: Math.max(8, width * 0.08), marginTop: 4, color: fg }}>
              {author}
            </Text>
          ) : null}
        </View>
      )}
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.max(3, width * 0.035), backgroundColor: "rgba(0,0,0,.22)" }} />
    </View>
  );
}
