"use client";

import { useEffect, useRef, useState } from "react";

export type TerminalEntry = {
  id: string;
  command: string;
  cwd: string;
  source: "agent" | "you";
  running: boolean;
  code?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
};

export function TerminalPanel({
  entries,
  onRun,
  onClear,
  onClose,
  busy = false,
}: {
  entries: TerminalEntry[];
  onRun: (command: string) => void;
  onClear: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  function submit() {
    const cmd = draft.trim();
    if (!cmd || busy) return;
    onRun(cmd);
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
    setHistIdx(-1);
    setDraft("");
  }

  return (
    <div className="terminal-panel flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-white/[0.06] px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#e8eef8]">Terminal</span>
        <span className="text-[10px] text-[#415570]">runs in the project folder via the local agent</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onClear} className="rounded px-2 py-0.5 text-[10px] text-[#8ca3be] hover:text-white">
            Clear
          </button>
          <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-[10px] text-[#8ca3be] hover:text-white">
            Hide
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.5]">
        {entries.length === 0 ? (
          <div className="text-[#415570]">Commands the agent runs show up here. Type your own below.</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="mb-2">
              <div className="flex items-center gap-2">
                <span className={e.source === "agent" ? "text-[#a78bfa]" : "text-[#00d4aa]"}>
                  {e.source === "agent" ? "agent" : "you"}
                </span>
                <span className="text-[#5a7390]">{e.cwd === "." ? "~" : e.cwd}</span>
                <span className="text-[#e8eef8]">$ {e.command}</span>
                {e.running ? (
                  <span className="text-amber-200">running…</span>
                ) : e.timedOut ? (
                  <span className="text-red-300">timed out</span>
                ) : (
                  <span className={e.code === 0 ? "text-[#00d4aa]" : "text-red-300"}>exit {e.code ?? "?"}</span>
                )}
              </div>
              {e.stdout ? <pre className="whitespace-pre-wrap break-words text-[#c5d4e6]">{e.stdout}</pre> : null}
              {e.stderr ? <pre className="whitespace-pre-wrap break-words text-red-300/90">{e.stderr}</pre> : null}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 py-1.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        <span className="font-mono text-[12px] text-[#00d4aa]">$</span>
        <input
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "ArrowUp" && history.length) {
              ev.preventDefault();
              const i = Math.min(histIdx + 1, history.length - 1);
              setHistIdx(i);
              setDraft(history[i]);
            } else if (ev.key === "ArrowDown") {
              ev.preventDefault();
              const i = histIdx - 1;
              setHistIdx(Math.max(i, -1));
              setDraft(i >= 0 ? history[i] : "");
            }
          }}
          placeholder={busy ? "Running…" : "npm test, git status, dir …"}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-white outline-none placeholder:text-[#415570]"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
