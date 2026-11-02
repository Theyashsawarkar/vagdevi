import { hostname } from "node:os";
import qrcode from "qrcode-terminal";
import { devices, newPairingCode, revoke } from "./auth.js";
import { addresses, loadConfig } from "./config.js";
import { buildDictionary } from "./dictionary.js";
import { scan } from "./library.js";
import { makeServer } from "./server.js";

const usage = `pustak: your laptop's books on your phone.

  pustak serve             serve the shared folders (the background service runs this)
  pustak pair              show a QR code for the phone app (one use, 10 minutes)
  pustak devices           the paired phones
  pustak revoke NAME|ID    unpair a phone
  pustak list              what's being shared
  pustak doctor            check it all works

Folders, port: ~/.config/pustak/config.toml  (folders = ["~/Books"])
`;

export const main = async (args: string[]) => {
  const cfg = loadConfig();
  switch (args[0]) {
    case "serve": {
      const server = makeServer({ folders: cfg.folders });
      server.listen(cfg.port, cfg.host, () => {
        console.error(`pustak: serving ${cfg.folders.join(", ")} on ${cfg.host}:${cfg.port}`);
      });
      // the dictionary is ready before anyone asks
      setTimeout(() => {
        try {
          buildDictionary();
        } catch (e) {
          console.error("pustak: dictionary:", e);
        }
      }, 100);
      break;
    }
    case "pair": {
      const urls = addresses(cfg.port);
      if (urls.length === 0) {
        console.error("No network address: connect to Wi-Fi first.");
        process.exit(1);
      }
      const code = newPairingCode();
      const link = `pustak://pair?code=${code}&name=${encodeURIComponent(hostname())}&urls=${encodeURIComponent(urls.join(","))}`;
      qrcode.generate(link, { small: true });
      console.log(`Scan this in the pustak app (one use, for 10 minutes).\nReachable at: ${urls.join("  ")}`);
      if (!urls.some((u) => u.includes("//100."))) {
        console.log("Note: on a shared network the connection isn't encrypted. Tailscale makes it private from anywhere.");
      }
      break;
    }
    case "devices":
      for (const d of devices()) console.log(`${d.id}  ${d.name}  paired ${new Date(d.pairedAt).toLocaleDateString()}`);
      break;
    case "revoke": {
      const n = revoke(args[1] ?? "");
      console.log(n ? `Unpaired ${n}.` : "No such phone.");
      break;
    }
    case "list":
      for (const i of await scan(cfg.folders)) console.log(`${i.kind}\t${i.pages}\t${i.title}\t${i.folder}`);
      break;
    case "doctor": {
      const items = await scan(cfg.folders);
      console.log(`✓ ${items.length} files in ${cfg.folders.join(", ")}`);
      console.log(`✓ dictionary: ${buildDictionary()}`);
      console.log(`✓ reachable at: ${addresses(cfg.port).join("  ") || "(no network)"}`);
      console.log(`✓ ${devices().length} paired phones`);
      break;
    }
    default:
      console.log(usage);
      process.exit(args[0] && args[0] !== "help" ? 2 : 0);
  }
};
