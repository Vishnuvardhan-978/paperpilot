"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { agentSearch } from "@/lib/local-agent";

const ICONS: Record<string, [string, string]> = {
  ts: ["TS", "#3b82f6"],
  tsx: ["TSX", "#38bdf8"],
  js: ["JS", "#facc15"],
  jsx: ["JSX", "#facc15"],
  mjs: ["JS", "#facc15"],
  cjs: ["JS", "#facc15"],
  json: ["{}", "#fbbf24"],
  jsp: ["JSP", "#f97316"],
  java: ["J", "#ef4444"],
  xml: ["<>", "#fb923c"],
  html: ["<>", "#f97316"],
  htm: ["<>", "#f97316"],
  css: ["#", "#a78bfa"],
  scss: ["#", "#f472b6"],
  md: ["M↓", "#94a3b8"],
  py: ["PY", "#60a5fa"],
  sql: ["DB", "#22d3ee"],
  yml: ["Y", "#f87171"],
  yaml: ["Y", "#f87171"],
  properties: ["⚙", "#94a3b8"],
  jar: ["☕", "#a16207"],
  png: ["▣", "#34d399"],
  jpg: ["▣", "#34d399"],
  jpeg: ["▣", "#34d399"],
  svg: ["◇", "#fbbf24"],
  sh: ["$", "#4ade80"],
  bat: ["$", "#4ade80"],
  ps1: ["PS", "#60a5fa"],
};

export function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const [label, color] = ICONS[ext] || ["•", "#5a7390"];
  return (
    <span className="file-icon" style={{ color }}>
      {label}
    </span>
  );
}

/** Subsequence fuzzy score; higher is better, -1 = no match. Rewards filename hits and contiguous runs. */
function fuzzyScore(query: string, path: string) {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const name = p.split("/").pop() || p;
  if (name.includes(q)) return 1000 - name.length + (name.startsWith(q) ? 200 : 0);
  if (p.includes(q)) return 600 - p.length;
  let score = 0;
  let pi = 0;
  let run = 0;
  for (const ch of q) {
    const found = p.indexOf(ch, pi);
    if (found < 0) return -1;
    run = found === pi ? run + 1 : 0;
    score += 1 + run * 2;
    pi = found + 1;
  }
  return score - p.length * 0.01;
}

export function QuickOpen({
  paths,
  recent,
  onOpen,
  onClose,
}: {
  paths: string[];
  recent: string[];
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [...recent.filter((r) => paths.includes(r)), ...paths.filter((p) => !recent.includes(p))].slice(0, 60);
    return paths
      .map((p) => ({ p, s: fuzzyScore(q, p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.p);
  }, [query, paths, recent]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <div className="quick-open" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && results[sel]) {
              e.preventDefault();
              onOpen(results[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Go to file…  (type part of a name)"
          className="quick-open-input"
          spellCheck={false}
        />
        <ul ref={listRef} className="quick-open-list">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[#415570]">No matching files</li>
          ) : (
            results.map((p, i) => {
              const name = p.split("/").pop() || p;
              const dir = p.slice(0, p.length - name.length).replace(/\/$/, "");
              return (
                <li key={p} data-idx={i}>
                  <button
                    type="button"
                    className={`quick-open-item ${i === sel ? "is-sel" : ""}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => onOpen(p)}
                  >
                    <FileIcon path={p} />
                    <span className="truncate text-[12.5px] text-[#e8eef8]">{name}</span>
                    <span className="truncate text-[11px] text-[#5a7390]">{dir}</span>
                    {!query && recent.includes(p) ? <span className="ml-auto text-[10px] text-[#415570]">recent</span> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

type SearchHit = { path: string; line: number; text: string };

export function SearchPanel({ onOpen }: { onOpen: (path: string, line: number) => void }) {
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  async function run() {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const data = await agentSearch(q, ".", { regex, caseSensitive });
      setHits(data.hits || []);
      setTruncated(Boolean(data.truncated));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) map.set(h.path, [...(map.get(h.path) || []), h]);
    return [...map.entries()];
  }, [hits]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="shrink-0 space-y-1.5 border-b border-white/[0.06] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="search-box">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#415570]"
            spellCheck={false}
          />
          <button type="button" className={`search-opt ${caseSensitive ? "is-on" : ""}`} onClick={() => setCaseSensitive((v) => !v)} title="Match case">
            Aa
          </button>
          <button type="button" className={`search-opt ${regex ? "is-on" : ""}`} onClick={() => setRegex((v) => !v)} title="Regular expression">
            .*
          </button>
        </div>
        <div className="flex items-center justify-between text-[10px] text-[#5a7390]">
          <span>{busy ? "Searching…" : hits.length ? `${hits.length}${truncated ? "+" : ""} results in ${grouped.length} files` : "Press Enter to search"}</span>
        </div>
      </form>
      {error ? <div className="px-3 py-2 text-[11px] text-red-300">{error}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {grouped.map(([path, list]) => (
          <div key={path} className="mb-1">
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-[11.5px] text-[#c5d4e6]" title={path}>
              <FileIcon path={path} />
              <span className="truncate">{path.split("/").pop()}</span>
              <span className="ml-auto shrink-0 rounded-full bg-white/[0.06] px-1.5 text-[10px] text-[#8ca3be]">{list.length}</span>
            </div>
            {list.map((h) => (
              <button
                key={`${h.path}:${h.line}`}
                type="button"
                onClick={() => onOpen(h.path, h.line)}
                className="search-hit"
                title={h.text}
              >
                <span className="shrink-0 text-[#5a7390]">{h.line}</span>
                <span className="truncate">{h.text.trim()}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Width that survives reloads; the splitter drags it within [min, max]. */
export function useStoredWidth(key: string, initial: number) {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const saved = Number(localStorage.getItem(key));
    if (saved > 0) queueMicrotask(() => setWidth(saved));
  }, [key]);
  useEffect(() => {
    localStorage.setItem(key, String(Math.round(width)));
  }, [key, width]);
  return [width, setWidth] as const;
}

export function Splitter({
  onDrag,
  side = "right",
}: {
  /** Receives the pointer's horizontal movement since the drag began. */
  onDrag: (deltaX: number, phase: "start" | "move") => void;
  side?: "left" | "right";
}) {
  return (
    <div
      className={`splitter splitter-${side}`}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        onDrag(0, "start");
        document.body.classList.add("is-resizing");
        const move = (ev: PointerEvent) => onDrag(ev.clientX - startX, "move");
        const up = () => {
          document.body.classList.remove("is-resizing");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}
