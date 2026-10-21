"use client";

import { useCallback, useEffect, useState } from "react";
import { agentGitCommit, agentGitDiff, agentGitLog, agentGitStatus, type GitStatus } from "@/lib/local-agent";

const STATUS_MARK: Record<string, { letter: string; color: string }> = {
  modified: { letter: "M", color: "text-amber-300" },
  added: { letter: "A", color: "text-[#00d4aa]" },
  untracked: { letter: "U", color: "text-[#00d4aa]" },
  deleted: { letter: "D", color: "text-red-300" },
  renamed: { letter: "R", color: "text-sky-300" },
};

/** Source control for the connected workspace: changed files, diffs, commit, recent history. */
export function GitPanel({ onOpen, epoch }: { onOpen: (path: string) => void; epoch: number }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [log, setLog] = useState<{ hash: string; subject: string; when: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([agentGitStatus(), agentGitLog().catch(() => ({ commits: [] }))]);
      setStatus(s);
      setLog(l.commits);
      setSelected(new Set((s.files || []).map((f) => f.path)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, epoch]);

  async function showDiff(path: string) {
    if (diff?.path === path) return setDiff(null);
    try {
      const d = await agentGitDiff(path);
      setDiff({ path, text: d.diff || d.error || "(no changes)" });
    } catch (e) {
      setDiff({ path, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function commit() {
    setBusy(true);
    setNote(null);
    try {
      const r = await agentGitCommit(message, [...selected]);
      if (!r.ok) throw new Error(r.error || r.output || "Commit failed");
      setMessage("");
      setDiff(null);
      setNote(r.output?.split("\n")[0] || "Committed");
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="p-3 text-[11px] text-red-300">{error}</div>;
  if (!status) return <div className="p-3 text-[11px] text-[#5a7390]">Loading…</div>;
  if (!status.repo) return <div className="p-3 text-[11px] text-[#5a7390]">This folder isn&apos;t a git repository.</div>;

  const files = status.files || [];
  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12px]">
      <div className="flex h-7 shrink-0 items-center gap-2 px-3 text-[11px] text-[#8ca3be]">
        <span className="truncate font-semibold">⎇ {status.branch}</span>
        {(status.ahead || 0) > 0 && <span className="text-[#00d4aa]">↑{status.ahead}</span>}
        {(status.behind || 0) > 0 && <span className="text-amber-300">↓{status.behind}</span>}
        <button type="button" onClick={() => void refresh()} className="ml-auto text-[#5a7390] hover:text-white" title="Refresh">
          ↻
        </button>
      </div>
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && message.trim() && selected.size) void commit();
          }}
          rows={2}
          placeholder="Commit message (Ctrl+Enter)"
          className="w-full resize-none rounded border border-white/10 bg-[#0b1127] px-2 py-1.5 text-[12px] text-white outline-none placeholder:text-[#415570] focus:border-[#00d4aa]/50"
        />
        <button
          type="button"
          disabled={busy || !message.trim() || !selected.size}
          onClick={() => void commit()}
          className="w-full rounded bg-[#00d4aa] py-1.5 text-[12px] font-semibold text-[#06091a] disabled:opacity-40"
        >
          {busy ? "Committing…" : `Commit ${selected.size} file${selected.size === 1 ? "" : "s"}`}
        </button>
        {note && <div className="break-words text-[11px] text-[#8ca3be]">{note}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5a7390]">Changes ({files.length})</div>
        {files.length === 0 && <div className="px-3 text-[11px] text-[#415570]">Working tree clean.</div>}
        {files.map((f) => {
          const mark = STATUS_MARK[f.status] || STATUS_MARK.modified;
          return (
            <div key={f.path}>
              <div className="group flex items-center gap-1.5 px-3 py-0.5 hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={selected.has(f.path)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(f.path);
                      else n.delete(f.path);
                      return n;
                    })
                  }
                  className="accent-[#00d4aa]"
                />
                <button type="button" onClick={() => void showDiff(f.path)} className="min-w-0 flex-1 truncate text-left text-[#c5d4e6]" title={f.path}>
                  {f.path.split("/").pop()}
                  <span className="ml-1 text-[10px] text-[#415570]">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
                </button>
                {f.status !== "deleted" && (
                  <button type="button" onClick={() => onOpen(f.path)} className="hidden text-[10px] text-[#5a7390] hover:text-white group-hover:block">
                    open
                  </button>
                )}
                <span className={`w-3 text-center text-[10px] font-bold ${mark.color}`}>{mark.letter}</span>
              </div>
              {diff?.path === f.path && (
                <pre className="mx-2 mb-1 max-h-72 overflow-auto rounded bg-[#0b1127] p-2 font-mono text-[10.5px] leading-[1.5]">
                  {diff.text.split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.startsWith("+") && !line.startsWith("+++")
                          ? "text-[#00d4aa]"
                          : line.startsWith("-") && !line.startsWith("---")
                            ? "text-red-300"
                            : line.startsWith("@@")
                              ? "text-sky-300"
                              : "text-[#5a7390]"
                      }
                    >
                      {line || " "}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          );
        })}
        {log.length > 0 && (
          <>
            <div className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5a7390]">History</div>
            {log.map((c) => (
              <div key={c.hash} className="flex gap-2 px-3 py-0.5 text-[11px]" title={c.subject}>
                <span className="shrink-0 font-mono text-[#415570]">{c.hash}</span>
                <span className="min-w-0 flex-1 truncate text-[#8ca3be]">{c.subject}</span>
                <span className="shrink-0 text-[10px] text-[#415570]">{c.when.replace(" ago", "")}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
