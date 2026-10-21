#!/usr/bin/env node
/**
 * Builds the Windows installer: release/dist/PaperPilot Setup <version>.exe
 * Run: npm run desktop:build
 *
 * 1. next build with output: "standalone" (self-contained server, no node_modules install needed)
 * 2. stage server + static files + agent into release/stage
 * 3. electron-builder packs electron/ as the app and the stage as resources
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import builder from "electron-builder";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = path.join(ROOT, "release", "stage");
const OUT = path.join(ROOT, "release", "dist");

function run(args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\nFailed: node ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

console.log("\n[desktop] 1/3 building Next.js (standalone)…");
run([path.join(ROOT, "scripts", "copy-monaco.mjs")]);
run([path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], { PAPERPILOT_STANDALONE: "1" });

console.log("\n[desktop] 2/3 staging server and agent…");
const standalone = path.join(ROOT, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("No .next/standalone/server.js — the standalone build did not run.");
  process.exit(1);
}
fs.rmSync(STAGE, { recursive: true, force: true });
const server = path.join(STAGE, "server");
copy(standalone, server);
copy(path.join(ROOT, ".next", "static"), path.join(server, ".next", "static"));
copy(path.join(ROOT, "public"), path.join(server, "public"));
for (const name of fs.readdirSync(server)) {
  if (name.startsWith(".env")) fs.rmSync(path.join(server, name), { force: true });
}
copy(path.join(ROOT, "agent"), path.join(STAGE, "agent"));

// Updates: the installed app reads latest.yml from this HTTPS folder (see electron/updater.mjs).
const UPDATE_URL = (process.env.PAPERPILOT_UPDATE_URL || "").trim().replace(/\/+$/, "");
const UPDATE_FILE = path.join(ROOT, "electron", "update.json");
if (UPDATE_URL && !/^https:\/\//i.test(UPDATE_URL)) {
  console.error("PAPERPILOT_UPDATE_URL must be an https:// URL.");
  process.exit(1);
}
fs.rmSync(UPDATE_FILE, { force: true });
if (UPDATE_URL) fs.writeFileSync(UPDATE_FILE, JSON.stringify({ url: UPDATE_URL }));

// Signing: electron-builder signs when CSC_LINK (path or base64 of a .pfx) and CSC_KEY_PASSWORD are set.
const signing = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
if (!signing && process.env.PAPERPILOT_REQUIRE_SIGNING === "1") {
  console.error("PAPERPILOT_REQUIRE_SIGNING=1 but CSC_LINK / CSC_KEY_PASSWORD are not set.");
  process.exit(1);
}
console.log(`[desktop] signing: ${signing ? "on (CSC_LINK)" : "off, so the installer shows 'Unknown publisher'"}`);
console.log(`[desktop] updates: ${UPDATE_URL || "off (set PAPERPILOT_UPDATE_URL)"}`);

console.log("\n[desktop] 3/3 packaging installer…");
fs.rmSync(OUT, { recursive: true, force: true });
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, "node_modules", "electron", "package.json"), "utf8"),
).version;

await builder.build({
  targets: builder.Platform.WINDOWS.createTarget("nsis", builder.Arch.x64),
  config: {
    appId: "com.paperpilot.desktop",
    productName: "PaperPilot",
    electronVersion,
    directories: { app: path.join(ROOT, "electron"), output: OUT },
    files: ["**/*"],
    // The shell has no npm dependencies; without this, electron-builder packs the whole project's node_modules.
    beforeBuild: async () => false,
    // extraResources drops node_modules folders, which the standalone server needs, so copy the stage directly.
    afterPack: async ({ appOutDir }) => {
      copy(path.join(STAGE, "server"), path.join(appOutDir, "resources", "server"));
      copy(path.join(STAGE, "agent"), path.join(appOutDir, "resources", "agent"));
    },
    win: {
      target: "nsis",
      // Timestamped SHA-256 signatures stay valid after the certificate expires.
      signtoolOptions: { signingHashAlgorithms: ["sha256"], rfc3161TimeStampServer: "http://timestamp.digicert.com" },
    },
    // The generic provider makes electron-builder write latest.yml next to the installer; upload both to UPDATE_URL.
    publish: UPDATE_URL ? [{ provider: "generic", url: UPDATE_URL }] : null,
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      shortcutName: "PaperPilot",
    },
  },
});

fs.rmSync(UPDATE_FILE, { force: true });
console.log(`\n[desktop] done → ${OUT}`);
if (UPDATE_URL) console.log(`[desktop] upload release/dist/latest.yml and the Setup .exe to ${UPDATE_URL}`);
