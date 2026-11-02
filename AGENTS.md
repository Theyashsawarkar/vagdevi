# vagdevi: notes for Claude

A phone book reader (Expo, React Native) in `apps/mobile`, offline only for now; sign-in comes later. `apps/server` builds the bundled dictionary and holds the parked laptop server.

- The reader runs in a WebView from `assets/reader/*.txt`; `src/reader/reflow.mjs` holds its testable logic. `scripts/bundle-reader.mjs` copies assets and writes `src/core/reader-version.ts`: run it after changing any of them, or phones keep the old reader.
- Debug logs: `src/core/log.ts`. Log what would help find a bug later; read them with `adb logcat -s ReactNativeJS | grep vagdevi`.
- Tests that touch paths or keyrings run with a throwaway HOME.
- Release: `./gradlew assembleRelease`, then `scripts/sign-release.sh`. The key is in `~/.config/vagdevi-release`, never in the repo.
- Public screenshots show public-domain books only.
