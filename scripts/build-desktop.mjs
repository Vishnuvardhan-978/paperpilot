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
    win: { target: "nsis" },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      shortcutName: "PaperPilot",
    },
  },
});

console.log(`\n[desktop] done → ${OUT}`);
