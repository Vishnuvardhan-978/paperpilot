/**
 * Manage PaperPilot API keys for the PaperPilot AI server (/api/v1).
 *
 *   node scripts/pp-keys.mjs create "Ravi's laptop" [--daily 200] [--per-minute 30] [--test]
 *   node scripts/pp-keys.mjs list
 *   node scripts/pp-keys.mjs usage [YYYY-MM-DD]
 *   node scripts/pp-keys.mjs disable <id> | enable <id> | delete <id>
 *
 * Keys are stored only as SHA-256 hashes; the full key is shown once at creation.
 * Storage: PAPERPILOT_SERVER_DIR or ~/.paperpilot/server
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.PAPERPILOT_SERVER_DIR?.trim() || path.join(os.homedir(), ".paperpilot", "server");
const KEYS = path.join(DIR, "keys.json");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const load = () => {
  try {
    return JSON.parse(fs.readFileSync(KEYS, "utf8"));
  } catch {
    return { keys: [] };
  }
};
const save = (data) => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(KEYS, JSON.stringify(data, null, 2), { mode: 0o600 });
};
const token = (n) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join("");
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const [cmd, arg] = process.argv.slice(2);
const data = load();

switch (cmd) {
  case "create": {
    if (!arg) throw new Error('Give the key a name: create "Ravi\'s laptop"');
    const daily = Number(flag("--daily", "200"));
    if (!Number.isInteger(daily) || daily < 1) throw new Error("--daily must be a positive whole number");
    const perMinute = Number(flag("--per-minute", "30"));
    if (!Number.isInteger(perMinute) || perMinute < 1) throw new Error("--per-minute must be a positive whole number");
    const raw = `pp_${process.argv.includes("--test") ? "test" : "live"}_${token(40)}`;
    const record = {
      id: `key_${token(10)}`,
      name: arg,
      hash: createHash("sha256").update(raw).digest("hex"),
      dailyRequests: daily,
      perMinute,
      createdAt: new Date().toISOString(),
    };
    data.keys.push(record);
    save(data);
    console.log(`Created ${record.id} "${arg}" (${daily} requests/day, ${perMinute}/minute)\n\n  ${raw}\n\nCopy it now — it can't be shown again.`);
    break;
  }
  case "list": {
    if (!data.keys.length) console.log("No keys yet. Create one: node scripts/pp-keys.mjs create \"name\"");
    for (const k of data.keys) {
      console.log(`${k.id}  ${k.disabled ? "DISABLED" : "active  "}  ${String(k.dailyRequests).padStart(5)}/day  ${k.createdAt.slice(0, 10)}  ${k.name}`);
    }
    break;
  }
  case "usage": {
    const day = arg || new Date().toISOString().slice(0, 10);
    let usage = {};
    try {
      usage = JSON.parse(fs.readFileSync(path.join(DIR, "usage", `${day}.json`), "utf8"));
    } catch {
      /* none */
    }
    console.log(`Usage on ${day} (UTC):`);
    for (const k of data.keys) {
      const u = usage[k.id] || { requests: 0, promptTokens: 0, completionTokens: 0 };
      console.log(`  ${k.id}  ${String(u.requests).padStart(5)}/${k.dailyRequests} req  ${u.promptTokens} in / ${u.completionTokens} out tokens  ${k.name}`);
    }
    break;
  }
  case "disable":
  case "enable":
  case "delete": {
    const k = data.keys.find((x) => x.id === arg);
    if (!k) throw new Error(`No key with id ${arg}. Run: node scripts/pp-keys.mjs list`);
    if (cmd === "delete") data.keys = data.keys.filter((x) => x !== k);
    else k.disabled = cmd === "disable";
    save(data);
    console.log(`${cmd}d ${k.id} "${k.name}"`);
    break;
  }
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^\s*\* ?/gm, "").trim());
}
