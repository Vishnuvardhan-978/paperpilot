const DEFAULT_AGENT = "http://127.0.0.1:8787";

export function agentBaseUrl() {
  if (typeof window === "undefined") return DEFAULT_AGENT;
  try {
    return localStorage.getItem("paperpilot-agent-url") || DEFAULT_AGENT;
  } catch {
    return DEFAULT_AGENT;
  }
}

export type AgentHealth = {
  ok: boolean;
  name?: string;
  workspace?: string;
  phase?: number;
  capabilities?: string[];
  error?: string;
};

export async function checkLocalAgent(timeoutMs = 2500): Promise<AgentHealth> {
  const base = agentBaseUrl();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    const data = (await r.json().catch(() => ({}))) as AgentHealth;
    if (!r.ok) return { ok: false, error: data.error || `Agent HTTP ${r.status}` };
    return { ...data, ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "AbortError"
          ? "Local agent not reachable. Run: npm run agent"
          : "Local agent offline. Run: npm run agent",
    };
  } finally {
    clearTimeout(t);
  }
}

export async function agentListDir(relPath = ".") {
  const base = agentBaseUrl();
  const r = await fetch(`${base}/list?path=${encodeURIComponent(relPath)}`);
  const data = (await r.json().catch(() => ({}))) as {
    entries?: { name: string; kind: string; path: string }[];
    error?: string;
  };
  if (!r.ok) throw new Error(data.error || `List failed (${r.status})`);
  return data;
}

export async function agentReadFile(relPath: string) {
  const base = agentBaseUrl();
  const r = await fetch(`${base}/read?path=${encodeURIComponent(relPath)}`);
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

export async function agentWriteFile(relPath: string, text: string) {
  const base = agentBaseUrl();
  const r = await fetch(`${base}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, text }),
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

export async function agentSearch(query: string, relPath = ".") {
  const base = agentBaseUrl();
  const r = await fetch(
    `${base}/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(relPath)}`,
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
  const base = agentBaseUrl();
  const r = await fetch(`${base}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const base = agentBaseUrl();
  const r = await fetch(`${base}/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const base = agentBaseUrl();
  const r = await fetch(`${base}/pick-folder`, { method: "POST" });
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
  const base = agentBaseUrl();
  const r = await fetch(`${base}/tree`);
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
