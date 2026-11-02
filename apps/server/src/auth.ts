import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensure, paths } from "./config.js";

const CODE_MS = 10 * 60 * 1000;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export type Device = { id: string; name: string; tokenHash: string; pairedAt: number };
type Stored = { devices: Device[]; code?: { hash: string; expires: number } };

const file = () => join(ensure(paths().state), "devices.json");
const load = (): Stored => {
  try {
    return JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    return { devices: [] };
  }
};
const save = (s: Stored) => writeFileSync(file(), JSON.stringify(s, null, 1), { mode: 0o600 });

/** A one-time code for the QR: 10 minutes, the first phone to use it. */
export const newPairingCode = () => {
  const code = randomBytes(16).toString("base64url");
  const s = load();
  s.code = { hash: hash(code), expires: Date.now() + CODE_MS };
  save(s);
  return code;
};

/** Trades a code for a device token; null when the code is wrong or spent. */
export const claim = (code: string, name: string): { token: string; deviceId: string } | null => {
  const s = load();
  if (!s.code || s.code.expires < Date.now()) return null;
  const a = Buffer.from(hash(code));
  const b = Buffer.from(s.code.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const token = randomBytes(32).toString("base64url");
  const deviceId = randomBytes(6).toString("hex");
  s.devices.push({ id: deviceId, name: name.slice(0, 60), tokenHash: hash(token), pairedAt: Date.now() });
  delete s.code;
  save(s);
  return { token, deviceId };
};

export const verify = (token: string | undefined): Device | null => {
  if (!token) return null;
  const h = Buffer.from(hash(token));
  for (const d of load().devices) {
    const t = Buffer.from(d.tokenHash);
    if (t.length === h.length && timingSafeEqual(t, h)) return d;
  }
  return null;
};

export const devices = () => load().devices;

export const revoke = (id: string) => {
  const s = load();
  const before = s.devices.length;
  s.devices = s.devices.filter((d) => d.id !== id && d.name !== id);
  save(s);
  return before - s.devices.length;
};

/** Too many wrong codes from one address slow it down. */
const tries = new Map<string, { n: number; at: number }>();
export const allowAttempt = (who: string) => {
  const now = Date.now();
  const t = tries.get(who);
  if (!t || now - t.at > 60_000) {
    tries.set(who, { n: 1, at: now });
    return true;
  }
  t.n++;
  return t.n <= 10;
};
