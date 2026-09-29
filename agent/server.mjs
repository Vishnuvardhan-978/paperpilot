#!/usr/bin/env node
/**
 * PaperPilot Local Agent — Phase 2
 * Run: npm run agent
 *
 * Tools: list, read, write, search, exec (cwd = workspace root)
 */
import http from "http";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
let pickingFolder = false;

const PORT = Number(process.env.PAPERPILOT_AGENT_PORT || 8787);
/** Mutable so the UI can point at a folder without restarting (Cursor-like). */
let ROOT = path.resolve(process.env.PAPERPILOT_WORKSPACE || process.cwd());
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);
const MAX_SEARCH_FILES = 400;
const MAX_SEARCH_HITS = 40;
const MAX_TREE_FILES = 2500;
const MAX_EXEC_MS = Number(process.env.PAPERPILOT_EXEC_MS || 45000);
const MAX_EXEC_OUT = 80_000;

const BLOCKED_EXEC =
  /\b(format\s+[a-z]:|shutdown|restart-computer|rm\s+-rf\s+[\/\\]|del\s+\/[sq]|Remove-Item\s+.*-Recurse\s+[A-Z]:|mkfs|dd\s+if=)/i;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
  });
  res.end(json);
}

function safeJoin(rel) {
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.split("/").includes("..")) throw new Error("Path escape blocked");
  const full = path.resolve(ROOT, clean);
  const rootCmp = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (full !== ROOT && !full.toLowerCase().startsWith(rootCmp.toLowerCase())) {
    throw new Error("Path outside workspace");
  }
  return full;
}

/** Drop a repeated project-folder prefix so EEAIAdmin/EEAIAdmin/file resolves to EEAIAdmin/file. */
function resolveInsideRoot(rel) {
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const options = [clean];
  const base = path.basename(ROOT);
  let cur = clean;
  const prefix = base.toLowerCase() + "/";
  while (base && cur.toLowerCase().startsWith(prefix)) {
    cur = cur.slice(base.length + 1);
    options.push(cur);
  }
  let fallback = null;
  for (const option of options) {
    const full = safeJoin(option);
    if (!fallback) fallback = full;
    if (fs.existsSync(full)) return full;
  }
  return fallback;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function walkFiles(dir, acc = []) {
  if (acc.length >= MAX_SEARCH_FILES) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const d of entries) {
    if (acc.length >= MAX_SEARCH_FILES) break;
    if (d.name.startsWith(".") && d.name !== ".env.example") continue;
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      walkFiles(path.join(dir, d.name), acc);
    } else if (d.isFile()) {
      acc.push(path.join(dir, d.name));
    }
  }
  return acc;
}

/** Paths only — no file contents (fast, Cursor-like explorer). */
function walkTreePaths(dir, acc = [], depth = 0) {
  if (acc.length >= MAX_TREE_FILES || depth > 10) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const d of entries) {
    if (acc.length >= MAX_TREE_FILES) break;
    if (d.name === "." || d.name === "..") continue;
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      if (d.name.startsWith(".") && d.name !== ".github") continue;
      walkTreePaths(path.join(dir, d.name), acc, depth + 1);
    } else if (d.isFile()) {
      if (d.name.startsWith(".") && d.name !== ".env.example" && d.name !== ".gitignore") continue;
      const full = path.join(dir, d.name);
      let rel = path.relative(ROOT, full).replace(/\\/g, "/");
      const base = path.basename(ROOT);
      const prefix = base.toLowerCase() + "/";
      if (base && rel.toLowerCase().startsWith(prefix)) {
        const stripped = rel.slice(base.length + 1);
        if (fs.existsSync(path.join(ROOT, stripped)) && !fs.existsSync(path.join(ROOT, rel))) {
          rel = stripped;
        }
      }
      acc.push(rel);
    }
  }
  return acc;
}

function runSearch(query, relRoot = ".") {
  const q = String(query || "").trim();
  if (!q || q.length < 2) throw new Error("query too short");
  const start = safeJoin(relRoot === "." ? "" : relRoot);
  const files = walkFiles(fs.statSync(start).isDirectory() ? start : path.dirname(start));
  const hits = [];
  const lower = q.toLowerCase();
  for (const full of files) {
    if (hits.length >= MAX_SEARCH_HITS) break;
    let text;
    try {
      const st = fs.statSync(full);
      if (st.size > 400_000) continue;
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_SEARCH_HITS) break;
      if (lines[i].toLowerCase().includes(lower)) {
        hits.push({
          path: path.relative(ROOT, full).replace(/\\/g, "/"),
          line: i + 1,
          text: lines[i].slice(0, 240),
        });
      }
    }
  }
  return { query: q, hits, truncated: hits.length >= MAX_SEARCH_HITS };
}

/** Native OS folder dialog. Resolves to a path, or null if the user cancelled. */
function pickFolderNative() {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === "win32") {
    cmd = "powershell.exe";
    args = [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(AGENT_DIR, "pick-folder.ps1"),
    ];
  } else if (platform === "darwin") {
    cmd = "osascript";
    args = ["-e", 'POSIX path of (choose folder with prompt "Select a project folder for PaperPilot")'];
  } else {
    cmd = "zenity";
    args = ["--file-selection", "--directory", "--title=Select a project folder for PaperPilot"];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", (b) => (err += b.toString("utf8")));
    child.on("error", (e) => reject(new Error(`Folder dialog unavailable: ${e.message}`)));
    child.on("close", () => {
      const picked = out.trim().replace(/[\\/]+$/, "");
      if (picked) resolve(picked);
      else if (err.trim() && !/cancel/i.test(err)) reject(new Error(err.trim().slice(0, 300)));
      else resolve(null);
    });
  });
}

function runExec(command, cwdRel = ".") {
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("command required");
  if (BLOCKED_EXEC.test(cmd)) throw new Error("Command blocked for safety");
  const cwd = safeJoin(cwdRel === "." ? "" : cwdRel);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error("cwd must be a directory under workspace");
  }

  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "cmd.exe" : "bash", isWin ? ["/c", cmd] : ["-lc", cmd], {
      cwd,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, MAX_EXEC_MS);

    child.stdout.on("data", (b) => {
      if (stdout.length < MAX_EXEC_OUT) stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b) => {
      if (stderr.length < MAX_EXEC_OUT) stderr += b.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        code: killed ? -1 : code,
        timedOut: killed,
        cwd: path.relative(ROOT, cwd).replace(/\\/g, "/") || ".",
        command: cmd,
        stdout: stdout.slice(0, MAX_EXEC_OUT),
        stderr: stderr.slice(0, MAX_EXEC_OUT),
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        code: -1,
        timedOut: false,
        cwd: path.relative(ROOT, cwd).replace(/\\/g, "/") || ".",
        command: cmd,
        stdout: "",
        stderr: e instanceof Error ? e.message : "exec failed",
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PaperPilot Local Agent</title>
  <style>
    body { margin:0; font-family:Segoe UI,sans-serif; background:#06091a; color:#e8eef8; }
    main { max-width:720px; margin:12vh auto; padding:24px; }
    h1 { font-size:28px; margin:0 0 8px; }
    .ok { color:#00d4aa; font-weight:700; letter-spacing:.08em; text-transform:uppercase; font-size:12px; }
    p { color:#8ca3be; line-height:1.6; }
    code { color:#7dd3fc; }
    a { color:#00d4aa; }
    .card { margin-top:20px; padding:16px; border:1px solid rgba(255,255,255,.1); border-radius:14px; background:rgba(255,255,255,.03); }
  </style>
</head>
<body>
  <main>
    <div class="ok">Phase 2 · Online</div>
    <h1>PaperPilot Local Agent</h1>
    <p>Machine helper for Cursor-like tools: read, write, search, terminal.</p>
    <div class="card">
      <p><strong>Workspace:</strong> <code>${ROOT.replace(/\\/g, "\\\\")}</code></p>
      <p><strong>Health:</strong> <a href="/health">/health</a></p>
      <p>Open the app and use Folder / Agent mode. Keep this process running.</p>
    </div>
  </main>
</body>
</html>`;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, {
        ok: true,
        name: "PaperPilot Local Agent",
        workspace: ROOT,
        phase: 2,
        capabilities: ["read", "write", "list", "search", "exec", "tree", "workspace", "pick-folder"],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/workspace") {
      send(res, 200, { workspace: ROOT });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pick-folder") {
      if (pickingFolder) {
        send(res, 409, { error: "A folder dialog is already open — check the taskbar." });
        return;
      }
      pickingFolder = true;
      let picked;
      try {
        picked = await pickFolderNative();
      } finally {
        pickingFolder = false;
      }
      if (!picked) {
        send(res, 200, { ok: false, cancelled: true });
        return;
      }
      const resolved = path.resolve(picked);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        send(res, 400, { error: "Selected folder not found" });
        return;
      }
      ROOT = resolved;
      send(res, 200, { ok: true, workspace: ROOT });
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace") {
      const body = await readBody(req);
      const next = String(body.path || "").trim();
      if (!next) {
        send(res, 400, { error: "path required" });
        return;
      }
      const resolved = path.resolve(next);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        send(res, 400, { error: "Folder not found on this machine" });
        return;
      }
      ROOT = resolved;
      send(res, 200, { ok: true, workspace: ROOT });
      return;
    }

    if (req.method === "GET" && url.pathname === "/tree") {
      const paths = walkTreePaths(ROOT, []);
      send(res, 200, {
        root: ROOT,
        name: path.basename(ROOT) || ROOT,
        paths,
        fileCount: paths.length,
        truncated: paths.length >= MAX_TREE_FILES,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/list") {
      const rel = url.searchParams.get("path") || ".";
      const dir = safeJoin(rel === "." ? "" : rel);
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({
        name: d.name,
        kind: d.isDirectory() ? "dir" : "file",
        path: path.relative(ROOT, path.join(dir, d.name)).replace(/\\/g, "/"),
      }));
      send(res, 200, { root: ROOT, path: rel, entries });
      return;
    }

    if (req.method === "GET" && url.pathname === "/read") {
      const rel = url.searchParams.get("path");
      if (!rel) {
        send(res, 400, { error: "path required" });
        return;
      }
      const full = resolveInsideRoot(rel);
      const text = fs.readFileSync(full, "utf8");
      send(res, 200, { path: rel, text });
      return;
    }

    if (req.method === "GET" && url.pathname === "/search") {
      const query = url.searchParams.get("q") || "";
      const rel = url.searchParams.get("path") || ".";
      const result = runSearch(query, rel);
      send(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/write") {
      const body = await readBody(req);
      if (!body.path || typeof body.text !== "string") {
        send(res, 400, { error: "path and text required" });
        return;
      }
      const full = resolveInsideRoot(body.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      let backup = null;
      if (fs.existsSync(full)) {
        backup = `${body.path}.ppbak`;
        fs.copyFileSync(full, safeJoin(backup));
      }
      fs.writeFileSync(full, body.text, "utf8");
      send(res, 200, {
        ok: true,
        path: body.path,
        bytes: Buffer.byteLength(body.text),
        backup,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/exec") {
      const body = await readBody(req);
      const result = await runExec(body.command, body.cwd || ".");
      send(res, result.ok || result.code === 0 ? 200 : 200, result);
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : "Agent error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PaperPilot Local Agent (phase 2) on http://127.0.0.1:${PORT}`);
  console.log(`Workspace root: ${ROOT}`);
  console.log(`Tools: list read write search exec`);
  console.log(`Set PAPERPILOT_WORKSPACE to point at a project folder.`);
});
