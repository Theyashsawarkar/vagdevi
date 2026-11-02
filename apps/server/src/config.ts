import { mkdirSync, readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";

/** Where vagdevi keeps things; VAGDEVI_HOME puts it all in one place (tests). */
export const paths = () => {
  const one = process.env.VAGDEVI_HOME;
  const home = homedir();
  const at = (env: string, def: string) => one ?? join(process.env[env] ?? join(home, def), "vagdevi");
  return {
    config: at("XDG_CONFIG_HOME", ".config"),
    state: at("XDG_STATE_HOME", ".local/state"),
    cache: at("XDG_CACHE_HOME", ".cache"),
  };
};

export type Config = { folders: string[]; port: number; host: string };

const expand = (p: string) => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : resolve(p));

/**
 * Only these folders are ever served: the phone can't reach the rest of the
 * disk. config.toml: folders = ["~/Books"], port, host.
 */
export const loadConfig = (): Config => {
  let raw: Record<string, unknown> = {};
  try {
    raw = parse(readFileSync(join(paths().config, "config.toml"), "utf8"));
  } catch {
    // no config yet: the defaults
  }
  const folders = Array.isArray(raw.folders) ? (raw.folders as string[]) : ["~/Books", "~/Documents", "~/Downloads"];
  return {
    folders: folders.map(expand),
    port: typeof raw.port === "number" ? raw.port : 7733,
    host: typeof raw.host === "string" ? raw.host : "0.0.0.0",
  };
};

export const ensure = (dir: string) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

/** The addresses a phone can reach this laptop on, Tailscale first. */
export const addresses = (port: number): string[] => {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const url = `http://${a.address}:${port}`;
      if (name.startsWith("tailscale") || a.address.startsWith("100.")) out.unshift(url);
      else out.push(url);
    }
  }
  return out;
};
