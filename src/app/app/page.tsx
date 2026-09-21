"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  ChatSession,
  Message,
  clearActiveChatId,
  createEmptySession,
  deleteChat,
  getActiveChatId,
  listChats,
  saveChat,
  setActiveChatId,
  titleFromDocument,
} from "@/lib/chat-store";
import {
  exportChatMarkdown,
  exportChatText,
  formatBytes,
  formatChars,
} from "@/lib/export";

const CHIPS = [
  "Summarize this document",
  "What are the key points?",
  "List all important dates",
  "Who are the people mentioned?",
];

/* ─────────────────── icons ─────────────────── */
const I = {
  close: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  plus:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  send:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  file:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  menu:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3.5 w-3.5 text-[#00d4aa]"><polyline points="20 6 9 17 4 12"/></svg>,
  copy:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  warn:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-red-400"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  download: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  clear: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>,
};

function Spinner({ size = "h-4 w-4" }: { size?: string }) {
  return (
    <div className={`${size} animate-spin rounded-full border-2 border-transparent border-t-[#00d4aa]`} />
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] transition hover:text-[#8ca3be]"
    >
      {ok ? <I.check /> : <I.copy />}
      <span>{ok ? "Copied" : "Copy"}</span>
    </button>
  );
}

/* ─────────────────── page ─────────────────── */
export default function App() {
  const fileRef  = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef   = useRef<HTMLDivElement>(null);
  const [ready,       setReady]       = useState(false);
  const [sessions,    setSessions]    = useState<ChatSession[]>([]);
  const [activeId,    setActiveId]    = useState<string | null>(null);
  const [session,     setSession]     = useState<ChatSession>(() => createEmptySession());
  const [q,           setQ]           = useState("");
  const [uploading,   setUploading]   = useState(false);
  const [asking,      setAsking]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [navOpen,     setNavOpen]     = useState(false);
  const [drag,        setDrag]        = useState(false);
  const [exportOpen,  setExportOpen]  = useState(false);
  const [, tx] = useTransition();

  const refresh = useCallback(async (id?: string | null) => {
    const all = await listChats();
    setSessions(all);
    if (!all.length) {
      const s = createEmptySession();
      setSession(s); setActiveId(s.id); clearActiveChatId(); return;
    }
    const target = all.find(c => c.id === (id ?? getActiveChatId())) ?? all[0];
    setSession(target); setActiveId(target.id); setActiveChatId(target.id);
  }, []);

  useEffect(() => { refresh().catch(() => {}).finally(() => setReady(true)); }, [refresh]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [session.messages, asking]);

  async function save(next: ChatSession) {
    const s = { ...next, updatedAt: Date.now() };
    setSession(s); setActiveId(s.id); setActiveChatId(s.id);
    await saveChat(s);
    tx(() => setSessions(p => [s, ...p.filter(c => c.id !== s.id)].sort((a,b) => b.updatedAt - a.updatedAt)));
  }

  async function newChat() {
    const s = createEmptySession();
    setError(null); setQ(""); setNavOpen(false);
    await save(s);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function openChat(id: string) {
    const all = sessions.length ? sessions : await listChats();
    const found = all.find(c => c.id === id);
    if (!found) return;
    setError(null); setQ(""); setSession(found); setActiveId(found.id);
    setActiveChatId(found.id); setNavOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function delChat(id: string) {
    await deleteChat(id);
    const rest = sessions.filter(c => c.id !== id);
    setSessions(rest);
    if (activeId === id) rest[0] ? openChat(rest[0].id) : newChat();
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null); setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Upload failed");
      await save({
        ...session,
        title: titleFromDocument(d.name),
        document: {
          name: d.name,
          pages: d.pages,
          text: d.text,
          sizeBytes: d.sizeBytes,
          charCount: d.charCount,
          preview: d.preview,
        },
        messages: [{
          id: crypto.randomUUID(), role: "assistant",
          content: `📄 **"${d.name}"** loaded — ${d.pages} ${d.pages===1?"page":"pages"}${d.sizeBytes ? ` · ${formatBytes(d.sizeBytes)}` : ""}.\n\nAsk me anything.`,
        }],
      });
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function ask(raw: string) {
    if (!session.document || !raw.trim() || asking) return;
    const um: Message = { id: crypto.randomUUID(), role: "user", content: raw.trim() };
    const next = { ...session, messages: [...session.messages, um] };
    setQ(""); setAsking(true); setError(null);
    await save(next);
    try {
      const r = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: um.content, documentText: session.document.text, documentName: session.document.name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Ask failed");
      await save({ ...next, messages: [...next.messages, { id: crypto.randomUUID(), role: "assistant", content: d.answer }] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAsking(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  async function clearMessages() {
    if (!session.document) return;
    await save({
      ...session,
      messages: [{
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Chat cleared. **"${session.document.name}"** is still loaded — ask a new question.`,
      }],
    });
  }

  async function removeDocument() {
    await save({
      ...session,
      title: "New chat",
      document: null,
      messages: [],
    });
    setError(null);
  }

  /* ── loading ── */
  if (!ready) return (
    <div className="flex min-h-full items-center justify-center bg-bg0">
      <div className="flex flex-col items-center gap-5">
        <div className="relative">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] p-px">
            <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[#06091a]">
              <span className="font-[family-name:var(--font-display)] text-lg font-bold text-gradient">PP</span>
            </div>
          </div>
        </div>
        <Spinner size="h-5 w-5" />
        <span className="text-sm text-[#415570]">Loading PaperPilot…</span>
      </div>
    </div>
  );

  /* ── main ── */
  return (
    <div className="relative flex h-screen overflow-hidden bg-bg0">

      {/* ambient gradients */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-64 -top-64 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(0,212,170,0.06),transparent_65%)]" />
        <div className="absolute -right-48 top-1/3 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.06),transparent_65%)]" />
        <div className="absolute bottom-0 left-1/2 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(0,212,170,0.04),transparent_60%)]" />
      </div>

      {/* mobile overlay */}
      {navOpen && (
        <button aria-label="Close" className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />
      )}

      {/* ── sidebar ── */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col transition-transform duration-300 ease-out lg:relative lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* glass background */}
        <div className="absolute inset-0 border-r border-white/[0.06] bg-[rgba(11,17,39,0.85)] backdrop-blur-2xl" />

        <div className="relative flex flex-col h-full">
          {/* brand */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <Link href="/" className="group flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6]">
                <span className="text-[11px] font-black text-white">PP</span>
              </div>
              <span className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-white">PaperPilot</span>
            </Link>
            <button onClick={() => setNavOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#415570] hover:bg-white/[0.06] hover:text-[#8ca3be] lg:hidden"><I.close /></button>
          </div>

          {/* new chat btn */}
          <div className="px-4 pb-3">
            <button onClick={newChat} className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]">
              <I.plus /><span>New chat</span>
            </button>
          </div>

          {/* divider label */}
          <div className="px-5 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#415570]">Recents</span>
          </div>

          {/* chat list */}
          <div className="scroll-y flex-1 px-3 pb-3 space-y-0.5">
            {sessions.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[#415570]">No chats yet. Upload a PDF to begin.</p>
            ) : sessions.map(chat => {
              const active = chat.id === activeId;
              return (
                <div key={chat.id} onClick={() => openChat(chat.id)} className={`group relative flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 transition ${active ? "bg-gradient-to-r from-[#00d4aa]/15 to-[#3b82f6]/10 border border-[#00d4aa]/20" : "hover:bg-white/[0.04] border border-transparent"}`}>
                  <span className={`mt-0.5 shrink-0 ${active ? "text-[#00d4aa]" : "text-[#415570]"}`}><I.file /></span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[13px] font-medium leading-tight ${active ? "text-white" : "text-[#8ca3be]"}`}>{chat.title}</div>
                    <div className="mt-0.5 text-[11px] text-[#415570]">
                      {chat.document ? `${chat.messages.length} messages` : "Empty"} · {new Date(chat.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); delChat(chat.id); }} className="absolute right-2 top-3 flex h-5 w-5 items-center justify-center rounded opacity-0 text-[#415570] transition hover:bg-white/[0.08] hover:text-[#f87171] group-hover:opacity-100">
                    <I.trash />
                  </button>
                </div>
              );
            })}
          </div>

          {/* bottom */}
          <div className="px-5 py-4 border-t border-white/[0.06]">
            <p className="text-[11px] text-[#415570] text-center">Saved locally in this browser</p>
          </div>
        </div>
      </aside>

      {/* ── main ── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">

        {/* top bar */}
        <header className="relative z-50 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[rgba(6,9,26,0.95)] px-4 backdrop-blur-xl">
          <button onClick={() => setNavOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#415570] hover:border-white/[0.15] hover:text-[#8ca3be] lg:hidden"><I.menu /></button>

          {/* doc badge */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {session.document ? (
              <>
                <span className="text-[#00d4aa]"><I.file /></span>
                <span className="truncate text-sm font-semibold text-white/90">{session.document.name}</span>
                <span className="shrink-0 rounded-full bg-[#00d4aa]/10 px-2 py-0.5 text-[11px] font-bold text-[#00d4aa]">{session.document.pages}p</span>
              </>
            ) : (
              <span className="text-sm text-[#415570]">No document</span>
            )}
          </div>

          {/* actions */}
          <div className="relative z-50 flex items-center gap-2">
            {session.messages.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExportOpen((v) => !v);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa]"
                >
                  <I.download /><span className="hidden sm:inline">Export</span>
                </button>
                {exportOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close export"
                      className="fixed inset-0 z-[60] cursor-default bg-transparent"
                      onClick={() => setExportOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-[70] mt-2 w-52 overflow-hidden rounded-xl border border-white/[0.12] bg-[#101828] shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
                      <p className="border-b border-white/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#415570]">
                        Save conversation
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportChatMarkdown(session);
                          setExportOpen(false);
                        }}
                        className="block w-full px-4 py-3 text-left text-sm text-[#e2e8f0] transition hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]"
                      >
                        Download Markdown (.md)
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportChatText(session);
                          setExportOpen(false);
                        }}
                        className="block w-full px-4 py-3 text-left text-sm text-[#e2e8f0] transition hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]"
                      >
                        Download Text (.txt)
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {session.document && session.messages.length > 1 && (
              <button
                type="button"
                onClick={clearMessages}
                title="Clear chat"
                className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] transition hover:border-red-400/40 hover:text-red-400 sm:flex"
              >
                Clear
              </button>
            )}
            <button type="button" onClick={newChat} className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-semibold text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa] lg:flex">
              <I.plus /><span>New</span>
            </button>
          </div>
        </header>

        {/* upload / PDF panel */}
        <div className="shrink-0 border-b border-white/[0.06] bg-[rgba(6,9,26,0.5)] px-4 py-3 backdrop-blur-sm">
          {session.document && !uploading ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#00d4aa]"><I.file /></span>
                    <span className="truncate text-sm font-semibold text-white">{session.document.name}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-[#00d4aa]/10 px-2.5 py-0.5 text-[11px] font-bold text-[#00d4aa]">
                      {session.document.pages} pages
                    </span>
                    {session.document.sizeBytes != null && (
                      <span className="rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-[#8ca3be]">
                        {formatBytes(session.document.sizeBytes)}
                      </span>
                    )}
                    {(session.document.charCount ?? session.document.text.length) > 0 && (
                      <span className="rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-[#8ca3be]">
                        {formatChars(session.document.charCount ?? session.document.text.length)}
                      </span>
                    )}
                  </div>
                  {session.document.preview && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#415570]">
                      Preview: {session.document.preview}…
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <label className="cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa]">
                    Replace
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={asking}
                      onChange={(e) => upload(e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={removeDocument}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-[#8ca3be] transition hover:border-red-400/40 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <label
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
              className={`group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border transition-all duration-300 ${drag ? "border-[#00d4aa]/70 bg-[#00d4aa]/10 scale-[1.01]" : "border-white/[0.08] bg-white/[0.03] hover:border-[#00d4aa]/40 hover:bg-[#00d4aa]/05"}`}
            >
              <div className="pointer-events-none absolute inset-0 opacity-0 bg-gradient-to-r from-[#00d4aa]/5 via-transparent to-[#3b82f6]/5 transition-opacity group-hover:opacity-100" />
              <div className="relative flex flex-1 items-center gap-3 px-4 py-3">
                {uploading ? (
                  <><Spinner /><span className="text-sm font-semibold text-white">Reading PDF…</span></>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5 shrink-0 text-[#415570]">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <div>
                      <span className="text-sm font-semibold text-[#8ca3be] group-hover:text-white transition">Upload PDF</span>
                      <span className="ml-2 text-xs text-[#415570]">Drop here or click · max 8MB</span>
                    </div>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" disabled={uploading||asking} onChange={e => upload(e.target.files?.[0])} />
            </label>
          )}

          {error && (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <I.warn />{error}
            </div>
          )}
        </div>

        {/* chat */}
        <div className="scroll-y flex-1 px-4 py-6 sm:px-6">
          {session.messages.length === 0 ? (
            <div className="animate-fade flex h-full min-h-[42vh] flex-col items-center justify-center text-center">
              {/* icon */}
              <div className="animate-float mb-6 relative">
                <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] p-px shadow-[0_0_40px_rgba(0,212,170,0.3)]">
                  <div className="flex h-full w-full items-center justify-center rounded-3xl bg-[#0b1127]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className="h-9 w-9 text-[#00d4aa]">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="8" y1="13" x2="16" y2="13"/>
                      <line x1="8" y1="17" x2="12" y2="17"/>
                    </svg>
                  </div>
                </div>
                <div className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] shadow-[0_0_10px_rgba(0,212,170,0.6)]" />
              </div>

              <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-shimmer sm:text-4xl">
                Ask your document
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#415570]">
                Upload any PDF above — invoices, contracts, resumes, reports — then ask questions in plain English.
              </p>

              {/* keyboard hint */}
              <div className="mt-5 flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-[12px] text-[#415570]">
                <span>Press</span>
                <kbd className="rounded-md border border-white/[0.12] bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-[#8ca3be]">Enter</kbd>
                <span>to send · Drag to upload</span>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6">
              {session.messages.map((m, i) => <Bubble key={m.id} msg={m} idx={i} />)}
              {asking && <ThinkingBubble />}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* chips */}
        {session.document && !asking && session.messages.length <= 2 && (
          <div className="shrink-0 border-t border-white/[0.06] bg-[rgba(6,9,26,0.5)] px-4 py-2.5 backdrop-blur-sm sm:px-6">
            <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
              {CHIPS.map(c => (
                <button key={c} onClick={() => ask(c)} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa]">{c}</button>
              ))}
            </div>
          </div>
        )}

        {/* input */}
        <div className="shrink-0 border-t border-white/[0.06] bg-[rgba(6,9,26,0.7)] px-4 py-4 backdrop-blur-xl sm:px-6">
          <form onSubmit={e => { e.preventDefault(); ask(q); }} className="mx-auto flex max-w-2xl items-center gap-2">
            <div className={`relative flex flex-1 items-center rounded-2xl border transition-all duration-200 ${q ? "border-[#00d4aa]/40 bg-[rgba(0,212,170,0.04)]" : "border-white/[0.08] bg-white/[0.03]"}`}>
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                disabled={!session.document || asking}
                placeholder={session.document ? "Ask anything about this PDF…" : "Upload a PDF to start"}
                className="flex-1 bg-transparent px-4 py-3.5 text-sm text-white outline-none placeholder:text-[#415570] disabled:opacity-40"
              />
            </div>
            <button
              type="submit"
              disabled={!session.document || asking || !q.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#0ea5e9] text-white shadow-[0_0_20px_rgba(0,212,170,0.3)] transition hover:shadow-[0_0_30px_rgba(0,212,170,0.5)] hover:scale-105 disabled:opacity-30 disabled:scale-100 disabled:shadow-none"
            >
              {asking ? <Spinner size="h-4 w-4" /> : <I.send />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ── bubbles ── */
function Bubble({ msg, idx }: { msg: Message; idx: number }) {
  const user = msg.role === "user";
  return (
    <div className="animate-rise" style={{ animationDelay: `${Math.min(idx * 0.04, 0.2)}s` }}>
      {user ? (
        <div className="flex justify-end">
          <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#1c3148] to-[#0f1e33] px-4 py-3 text-sm leading-relaxed text-white/90 shadow ring-1 ring-white/[0.07]">
            {msg.content}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {/* PP avatar */}
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-[10px] font-black text-white shadow-[0_0_12px_rgba(0,212,170,0.4)]">
            PP
          </div>
          {/* card */}
          <div className="group min-w-0 flex-1">
            <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[rgba(16,24,40,0.8)] px-4 py-3.5 shadow-lg backdrop-blur-sm">
              <div className="prose-ai">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
            <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100">
              <CopyBtn text={msg.content} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="animate-fade flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-[10px] font-black text-white">PP</div>
      <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[rgba(16,24,40,0.8)] px-4 py-3.5 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
          <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
          <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
        </div>
      </div>
    </div>
  );
}
