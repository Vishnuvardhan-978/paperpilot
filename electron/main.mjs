/**
 * PaperPilot desktop shell.
 * Dev:       npm run desktop          (uses this folder, next dev / next start)
 * Installer: npm run desktop:build    (bundled Next server + agent in resources/)
 *
 * Starts (or reuses) the local agent on 8787 and the Next.js app,
 * then opens the app in its own window — no browser tab, no second terminal.
 */
import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { checkForUpdates } from "./updater.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGED = app.isPackaged;
const ROOT = PACKAGED ? process.resourcesPath : path.join(HERE, "..");
const APP_PORT = Number(process.env.PORT || (PACKAGED ? 3917 : 3000));
const AGENT_PORT = Number(process.env.PAPERPILOT_AGENT_PORT || 8787);
const APP_HOST = PACKAGED ? "127.0.0.1" : "localhost";
const APP_URL = `http://${APP_HOST}:${APP_PORT}/app`;
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const LOG_DIR = path.join(app.getPath("userData"), "logs");
/** Keys saved from the in-app Settings page; survives reinstalls, unlike resources/server. */
const KEYS_FILE = path.join(app.getPath("userData"), "keys.env");
/** Written by scripts/build-desktop.mjs when PAPERPILOT_UPDATE_URL is set. */
const UPDATE_FILE = path.join(HERE, "update.json");

function readKeysFile() {
  const env = {};
  try {
    for (const line of fs.readFileSync(KEYS_FILE, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let value = m[2].trim();
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          /* keep raw */
        }
      }
      env[m[1]] = value;
    }
  } catch {
    /* no keys saved yet */
  }
  return env;
}

function updateFeedUrl() {
  if (process.env.PAPERPILOT_UPDATE_URL) return process.env.PAPERPILOT_UPDATE_URL;
  try {
    return JSON.parse(fs.readFileSync(UPDATE_FILE, "utf8")).url || "";
  } catch {
    return "";
  }
}
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

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** The installed app has no console, so child output goes to a log file. */
function childStdio(name) {
  if (!PACKAGED) return "inherit";
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const fd = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  return ["ignore", fd, fd];
}

/** Prefer the real Node that launched npm; Electron-as-Node is the fallback (and the only option when installed). */
function startNode(name, args, { cwd = ROOT, env = {} } = {}) {
  const nodeBin = process.env.npm_node_execpath || process.execPath;
  const childEnv = { ...process.env, ...env };
  if (nodeBin === process.execPath) childEnv.ELECTRON_RUN_AS_NODE = "1";
  const child = spawn(nodeBin, args, { cwd, env: childEnv, stdio: childStdio(name), windowsHide: true });
  children.push(child);
  return child;
}

async function ensureServices(settings) {
  if (!(await ping(`http://127.0.0.1:${AGENT_PORT}/`))) {
    startNode("agent", [path.join(ROOT, "agent", "server.mjs")], {
      env: PACKAGED ? { PAPERPILOT_WORKSPACE: os.homedir() } : {},
    });
  }
  if (!(await ping(`http://${APP_HOST}:${APP_PORT}/`))) {
    if (PACKAGED) {
      const serverDir = path.join(ROOT, "server");
      startNode("app", [path.join(serverDir, "server.js")], {
        cwd: serverDir,
        env: {
          PORT: String(APP_PORT),
          HOSTNAME: APP_HOST,
          PAPERPILOT_ENV_FILE: KEYS_FILE,
          ...readKeysFile(),
          GEMINI_API_KEY: readKeysFile().GEMINI_API_KEY || settings.geminiApiKey || "",
          ...(settings.geminiAgentModel ? { GEMINI_AGENT_MODEL: settings.geminiAgentModel } : {}),
        },
      });
    } else {
      const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
      const hasBuild = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
      startNode("app", [nextBin, hasBuild ? "start" : "dev", "-p", String(APP_PORT)]);
    }
  }
  return waitFor(`http://${APP_HOST}:${APP_PORT}/`, 180_000);
}

/** First launch of the installed app: ask for the user's own Gemini key (never bundled). */
async function ensureSettings(win) {
  const settings = readSettings();
  if (!PACKAGED || settings.geminiApiKey || readKeysFile().GEMINI_API_KEY) return settings;
  const saved = new Promise((resolve) => {
    ipcMain.handleOnce("paperpilot:save-settings", (_event, input) => {
      const next = {
        ...settings,
        geminiApiKey: String(input?.geminiApiKey || "").trim(),
        geminiAgentModel: String(input?.geminiAgentModel || "").trim(),
      };
      writeSettings(next);
      resolve(next);
      return true;
    });
  });
  await win.loadFile(path.join(HERE, "setup.html"));
  return saved;
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Change Gemini API key…",
          visible: PACKAGED,
          click: () => {
            const settings = readSettings();
            delete settings.geminiApiKey;
            writeSettings(settings);
            stopChildren();
            app.relaunch();
            app.exit(0);
          },
        },
        { label: "Open logs folder", visible: PACKAGED, click: () => void shell.openPath(LOG_DIR) },
        { type: "separator", visible: PACKAGED },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(HERE, "preload.cjs"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const settings = await ensureSettings(win);
  await win.loadURL(SPLASH);
  const ok = await ensureServices(settings);
  if (ok) {
    await win.loadURL(APP_URL);
    setTimeout(() => {
      const log = (msg) => {
        try {
          fs.mkdirSync(LOG_DIR, { recursive: true });
          fs.appendFileSync(path.join(LOG_DIR, "updater.log"), `${new Date().toISOString()} ${msg}\n`);
        } catch {
          /* ignore */
        }
      };
      void checkForUpdates({ win, feedUrl: updateFeedUrl(), log, onBeforeInstall: stopChildren });
    }, 8_000);
  } else {
    const where = PACKAGED ? `See the logs in ${LOG_DIR}` : "Check the terminal output.";
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<body style="background:#06091a;color:#fca5a5;font-family:Segoe UI;padding:40px">Could not start the app on port ${APP_PORT}. ${where}</body>`,
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    buildMenu();
    return createWindow();
  });
}
app.on("window-all-closed", () => {
  stopChildren();
  app.quit();
});
app.on("before-quit", stopChildren);
