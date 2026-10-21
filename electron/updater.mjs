/**
 * Auto-update for the installed app, without extra dependencies.
 * The build publishes release/dist/latest.yml + the installer to an HTTPS folder
 * (PAPERPILOT_UPDATE_URL at build time). On start we read latest.yml, and when it names
 * a newer version we download the installer, check its sha512, and run it silently.
 */
import { app, dialog } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": `PaperPilot/${app.getVersion()}` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url);
          if (next.protocol !== "https:") return reject(new Error("Update redirect left HTTPS"));
          return resolve(get(next.toString(), redirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        resolve(res);
      })
      .on("error", reject);
  });
}

async function getText(url) {
  const res = await get(url);
  let text = "";
  for await (const chunk of res) text += chunk;
  return text;
}

/** Just the fields we need from electron-builder's latest.yml. */
export function parseLatestYml(text) {
  const field = (name) => new RegExp(`^${name}:\\s*['"]?([^'"\\r\\n]+)`, "m").exec(text)?.[1]?.trim();
  return { version: field("version"), path: field("path"), sha512: field("sha512") };
}

export function isNewer(remote, local) {
  const parts = (v) => String(v).replace(/^v/, "").split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(remote);
  const b = parts(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function download(url, file, sha512) {
  const res = await get(url);
  const hash = crypto.createHash("sha512");
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    res.on("data", (c) => hash.update(c));
    res.pipe(out);
    out.on("finish", resolve);
    res.on("error", reject);
    out.on("error", reject);
  });
  if (hash.digest("base64") !== sha512) {
    fs.rmSync(file, { force: true });
    throw new Error("Downloaded update failed its checksum");
  }
}

/** Checks once; asks before installing. Errors are logged, never shown — updates are best-effort. */
export async function checkForUpdates({ win, feedUrl, log = console.log, onBeforeInstall }) {
  if (!app.isPackaged || !feedUrl || !/^https:\/\//i.test(feedUrl)) return;
  try {
    const base = feedUrl.replace(/\/+$/, "");
    const latest = parseLatestYml(await getText(`${base}/latest.yml`));
    if (!latest.version || !latest.path || !latest.sha512) throw new Error("latest.yml is missing version/path/sha512");
    if (!isNewer(latest.version, app.getVersion())) return;

    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Install and restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `PaperPilot ${latest.version} is available (you have ${app.getVersion()}).`,
      detail: "It downloads in the background and restarts the app when ready.",
    });
    if (response !== 0) return;

    const file = path.join(os.tmpdir(), `PaperPilot-Setup-${latest.version}.exe`);
    await download(`${base}/${encodeURIComponent(latest.path)}`, file, latest.sha512);
    log(`update: installing ${latest.version}`);
    onBeforeInstall?.();
    // electron-builder NSIS: /S installs silently, --force-run starts the app afterwards.
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    app.quit();
  } catch (e) {
    log(`update check failed: ${e instanceof Error ? e.message : e}`);
  }
}
