const DEFAULT_AGENT = "http://127.0.0.1:8787";

export function agentBaseUrl() {
  if (typeof window === "undefined") return DEFAULT_AGENT;
  try {
    return localStorage.getItem("paperpilot-agent-url") || DEFAULT_AGENT;
  } catch {
    return DEFAULT_AGENT;
  }
}

const TOKEN_HEADER = "X-PaperPilot-Token";
let tokenPromise: Promise<string> | null = null;

async function fetchAgentToken() {
  try {
    const manual = localStorage.getItem("paperpilot-agent-token");
    if (manual) return manual;
  } catch {
    /* storage blocked */
  }
  const r = await fetch("/api/agent/token", { cache: "no-store" });
  const data = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!r.ok || !data.token) throw new Error(data.error || "Local agent offline. Run: npm run agent");
  return data.token;
}

function agentToken(refresh = false) {
  if (refresh || !tokenPromise) {
    tokenPromise = fetchAgentToken().catch((e) => {
      tokenPromise = null;
      throw e;
    });
  }
  return tokenPromise;
}

/** Every agent call carries the shared token; a 401 means the agent restarted with a new one. */
async function agentFetch(pathAndQuery: string, init: RequestInit = {}) {
  const call = async (token: string) =>
    fetch(`${agentBaseUrl()}${pathAndQuery}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), [TOKEN_HEADER]: token },
    });
  const r = await call(await agentToken());
  if (r.status !== 401) return r;
  return call(await agentToken(true));
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export type AgentHealth = {
  ok: boolean;
  name?: string;
  workspace?: string;
  phase?: number;
  capabilities?: string[];
  error?: string;
};

export async function checkLocalAgent(timeoutMs = 2500): Promise<AgentHealth> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await agentFetch("/health", { signal: ctrl.signal });
    const data = (await r.json().catch(() => ({}))) as AgentHealth;
    if (!r.ok) return { ok: false, error: data.error || `Agent HTTP ${r.status}` };
    return { ...data, ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "AbortError"
          ? "Local agent not reachable. Run: npm run agent"
          : e instanceof Error && /agent/i.test(e.message)
            ? e.message
            : "Local agent offline. Run: npm run agent",
    };
  } finally {
    clearTimeout(t);
  }
}

export async function agentListDir(relPath = ".") {
  const r = await agentFetch(`/list?path=${encodeURIComponent(relPath)}`);
  const data = (await r.json().catch(() => ({}))) as {
    entries?: { name: string; kind: string; path: string }[];
    error?: string;
  };
  if (!r.ok) throw new Error(data.error || `List failed (${r.status})`);
  return data;
}

export async function agentReadFile(relPath: string) {
  const r = await agentFetch(`/read?path=${encodeURIComponent(relPath)}`);
  const data = (await r.json().catch(() => ({}))) as {
    path?: string;
    text?: string;
    error?: string;
  };
  if (!r.ok) {
    throw new Error(data.error || `Read failed (${r.status})`);
  }
  return { path: data.path || relPath, text: data.text ?? "" };
}

export async function agentWriteFile(relPath: string, text: string, opts: { backup?: boolean } = {}) {
  const r = await agentFetch("/write", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path: relPath, text, backup: opts.backup ?? true }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    path?: string;
    bytes?: number;
    backup?: string | null;
    error?: string;
  };
  if (!r.ok || !data.ok) {
    throw new Error(data.error || `Write failed (${r.status})`);
  }
  return data;
}

/** Copy `<path>.ppbak` back over the file (one-level undo that survives a page refresh). */
export async function agentRestoreBackup(relPath: string) {
  const r = await agentFetch("/restore", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path: relPath }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
  if (!r.ok || !data.ok) throw new Error(data.error || `Restore failed (${r.status})`);
  return { text: data.text ?? "" };
}

export async function agentDeleteFile(relPath: string) {
  const r = await agentFetch("/delete", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path: relPath }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok || !data.ok) throw new Error(data.error || `Delete failed (${r.status})`);
}

export async function agentSearch(
  query: string,
  relPath = ".",
  opts: { regex?: boolean; caseSensitive?: boolean } = {},
) {
  const r = await agentFetch(
    `/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(relPath)}${opts.regex ? "&regex=1" : ""}${opts.caseSensitive ? "&case=1" : ""}`,
  );
  const data = (await r.json().catch(() => ({}))) as {
    query?: string;
    hits?: { path: string; line: number; text: string }[];
    truncated?: boolean;
    error?: string;
  };
  if (!r.ok) throw new Error(data.error || `Search failed (${r.status})`);
  return data;
}

export async function agentExec(command: string, cwd = ".") {
  const r = await agentFetch("/exec", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ command, cwd }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: number | null;
    timedOut?: boolean;
    cwd?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
  if (!r.ok && data.error) throw new Error(data.error);
  if (data.error) throw new Error(data.error);
  return data;
}

export async function agentSetWorkspace(folderPath: string) {
  const r = await agentFetch("/workspace", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path: folderPath }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    workspace?: string;
    error?: string;
  };
  if (!r.ok || !data.ok) throw new Error(data.error || `Set workspace failed (${r.status})`);
  return data;
}

/** Opens the OS folder dialog on the agent's machine. Returns null if cancelled. */
export async function agentPickFolder(): Promise<string | null> {
  const r = await agentFetch("/pick-folder", { method: "POST" });
  if (r.status === 404) throw new Error("PICK_UNSUPPORTED");
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    cancelled?: boolean;
    workspace?: string;
    error?: string;
  };
  if (data.cancelled) return null;
  if (!r.ok || !data.ok || !data.workspace) {
    throw new Error(data.error || `Folder picker failed (${r.status})`);
  }
  return data.workspace;
}

export async function agentTree() {
  const r = await agentFetch("/tree");
  const data = (await r.json().catch(() => ({}))) as {
    root?: string;
    name?: string;
    paths?: string[];
    fileCount?: number;
    truncated?: boolean;
    error?: string;
  };
  if (!r.ok) throw new Error(data.error || `Tree failed (${r.status})`);
  return {
    root: data.root || "",
    name: data.name || "workspace",
    paths: data.paths || [],
    fileCount: data.fileCount ?? (data.paths || []).length,
    truncated: Boolean(data.truncated),
  };
}

/** Infer target path from fence meta / first-line comments / focused file. */
export function inferApplyPath(
  className: string | undefined,
  code: string,
  fallback?: string | null,
): string | null {
  const cls = className || "";
  const fromMeta =
    cls.match(/(?:^|\s)path=([^\s]+)/i)?.[1] ||
    cls.match(/(?:^|\s)file=([^\s]+)/i)?.[1];
  if (fromMeta) return cleanPath(fromMeta);

  const head = code.split(/\r?\n/).slice(0, 4);
  for (const line of head) {
    const m =
      line.match(/^\s*(?:\/\/|#|--)\s*(?:path|file)\s*[:=]\s*(.+)\s*$/i) ||
      line.match(/^\s*(?:path|file)\s*[:=]\s*(.+)\s*$/i);
    if (m?.[1]) return cleanPath(m[1]);
  }

  if (fallback?.trim()) return cleanPath(fallback);
  return null;
}

function cleanPath(raw: string) {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/** Strip leading path comment lines so we don't write them into the file. */
export function stripPathComment(code: string) {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < Math.min(lines.length, 4)) {
    if (/^\s*(?:\/\/|#|--)\s*(?:path|file)\s*[:=]/i.test(lines[i])) {
      i++;
      continue;
    }
    if (/^\s*(?:path|file)\s*[:=]/i.test(lines[i])) {
      i++;
      continue;
    }
    if (i > 0 && /^\s*$/.test(lines[i])) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").replace(/^\n+/, "");
}

export type GitFile = { path: string; staged: boolean; status: "modified" | "added" | "deleted" | "renamed" | "untracked" };
export type GitStatus = { repo: boolean; error?: string; branch?: string; ahead?: number; behind?: number; files?: GitFile[] };

async function agentJson<T>(pathAndQuery: string, init?: RequestInit): Promise<T> {
  const r = await agentFetch(pathAndQuery, init);
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || `Agent error ${r.status}`);
  return data;
}

export function agentGitStatus() {
  return agentJson<GitStatus>("/git/status");
}

export function agentGitDiff(path: string) {
  return agentJson<{ path: string; diff: string; untracked?: boolean; error?: string }>(`/git/diff?path=${encodeURIComponent(path)}`);
}

export function agentGitLog() {
  return agentJson<{ commits: { hash: string; subject: string; author: string; when: string }[] }>("/git/log");
}

export function agentGitCommit(message: string, paths: string[]) {
  return agentJson<{ ok: boolean; output?: string; error?: string; status?: GitStatus }>("/git/commit", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ message, paths }),
  });
}
