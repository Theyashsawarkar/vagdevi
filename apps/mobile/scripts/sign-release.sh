#!/usr/bin/env bash
# Signs the built APK with the permanent release key. The key lives outside the
# repo (~/.config/vagdevi-release): lose it and the app can't be updated.
# The lineage lets it update installs signed with the old debug key.
#   scripts/sign-release.sh [out.apk]
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
keys=${VAGDEVI_KEYS:-$HOME/.config/vagdevi-release}
tools=$(ls -d "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/* | sort -V | tail -1)
apk=$here/android/app/build/outputs/apk/release/app-release.apk
out=${1:-$here/dist/vagdevi.apk}
debug=$here/android/app/debug.keystore
mkdir -p "$(dirname "$out")"
if [ ! -f "$keys/lineage.bin" ]; then
  "$tools/apksigner" rotate --out "$keys/lineage.bin" \
    --old-signer --ks "$debug" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
    --new-signer --ks "$keys/release.jks" --ks-pass "file:$keys/keystore.pass" --ks-key-alias vagdevi
fi
"$tools/apksigner" sign --out "$out" --lineage "$keys/lineage.bin" --rotation-min-sdk-version 28 \
  --ks "$debug" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --next-signer --ks "$keys/release.jks" --ks-pass "file:$keys/keystore.pass" --ks-key-alias vagdevi \
  "$apk"
"$tools/apksigner" verify --print-certs "$out" | grep -E 'Signer|DN' | head -6
sha256sum "$out"
