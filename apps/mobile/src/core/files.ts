/** Checks on a file's last bytes: is it all there? No React Native in here, so it can be tested. */

const find = (bytes: Uint8Array, sig: number[]) => {
  outer: for (let i = bytes.length - sig.length; i >= 0; i--) {
    for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
    return true;
  }
  return false;
};

/** A ZIP (an EPUB) ends with its directory's end record, "PK\x05\x06", in the last 64 KB. */
export const zipComplete = (tail: Uint8Array) => find(tail, [0x50, 0x4b, 0x05, 0x06]);

/** A PDF ends with "%%EOF", give or take some trailing bytes. */
export const pdfComplete = (tail: Uint8Array) => find(tail, [0x25, 0x25, 0x45, 0x4f, 0x46]);

export const fromBase64 = (b64: string) => {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
