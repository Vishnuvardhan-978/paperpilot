/**
 * PaperPilot desktop shell.
 * Run: npm run desktop
 *
 * Starts (or reuses) the local agent on 8787 and the Next.js app on 3000,
 * then opens the app in its own window — no browser tab, no second terminal.
 */
import { app, BrowserWindow, shell } from "electron";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = Number(process.env.PORT || 3000);
const AGENT_PORT = Number(process.env.PAPERPILOT_AGENT_PORT || 8787);
const APP_URL = `http://localhost:${APP_PORT}/app`;
const children = [];

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

/** Prefer the real Node that launched npm; Electron-as-Node is the fallback. */
function startNode(args) {
  const nodeBin = process.env.npm_node_execpath || process.execPath;
  const env = { ...process.env };
  if (nodeBin === process.execPath) env.ELECTRON_RUN_AS_NODE = "1";
  const child = spawn(nodeBin, args, { cwd: ROOT, env, stdio: "inherit", windowsHide: true });
  children.push(child);
  return child;
}

async function ensureServices() {
  if (!(await ping(`http://127.0.0.1:${AGENT_PORT}/health`))) {
    startNode([path.join(ROOT, "agent", "server.mjs")]);
  }
  if (!(await ping(`http://localhost:${APP_PORT}/`))) {
    const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
    const hasBuild = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
    startNode([nextBin, hasBuild ? "start" : "dev", "-p", String(APP_PORT)]);
  }
  return waitFor(`http://localhost:${APP_PORT}/`, 180_000);
}

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#06091a;color:#8ca3be;font-family:Segoe UI,sans-serif">
<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#fff">PaperPilot</div>
<div style="margin-top:10px;font-size:13px">Starting the app and local agent… (first start can take ~30s)</div></div>
</body></html>`)}`;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    title: "PaperPilot",
    backgroundColor: "#06091a",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(SPLASH);
  const ok = await ensureServices();
  if (ok) {
    await win.loadURL(APP_URL);
  } else {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<body style="background:#06091a;color:#fca5a5;font-family:Segoe UI;padding:40px">Could not start the app on port ${APP_PORT}. Check the terminal output.</body>`,
      )}`,
    );
  }
}

function stopChildren() {
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  stopChildren();
  app.quit();
});
app.on("before-quit", stopChildren);
