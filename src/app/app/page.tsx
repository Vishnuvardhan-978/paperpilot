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

const SUGGESTIONS = [
  "Summarize this document",
  "What are the key points?",
  "List all important dates",
  "Who are the people mentioned?",
];

/* ── tiny icon components ──────────────────────────────── */
function IconPdf() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0" stroke="currentColor" strokeWidth={1.6}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="12" y2="17" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.2}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={2}>
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" />
    </svg>
  );
}
function IconCopy({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-accent" stroke="currentColor" strokeWidth={2.2}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={2}>
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}
function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.2}>
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

/* ── copy button ────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    });
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted transition hover:bg-line hover:text-ink"
    >
      <IconCopy done={done} />
      <span className="hidden sm:inline">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

/* ── main component ─────────────────────────────────────── */
export default function WorkspacePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession>(() => createEmptySession());
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [, startTransition] = useTransition();

  const refreshSessions = useCallback(async (preferredId?: string | null) => {
    const chats = await listChats();
    setSessions(chats);
    if (chats.length === 0) {
      const fresh = createEmptySession();
      setSession(fresh);
      setActiveId(fresh.id);
      clearActiveChatId();
      return;
    }
    const targetId = preferredId ?? getActiveChatId();
    const selected = chats.find((c) => c.id === targetId) ?? chats[0];
    setSession(selected);
    setActiveId(selected.id);
    setActiveChatId(selected.id);
  }, []);

  useEffect(() => {
    refreshSessions()
      .catch(() => {
        const fresh = createEmptySession();
        setSession(fresh);
        setActiveId(fresh.id);
      })
      .finally(() => setReady(true));
  }, [refreshSessions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, asking]);

  async function persist(next: ChatSession) {
    const stamped = { ...next, updatedAt: Date.now() };
    setSession(stamped);
    setActiveId(stamped.id);
    setActiveChatId(stamped.id);
    await saveChat(stamped);
    startTransition(() => {
      setSessions((prev) => {
        const without = prev.filter((c) => c.id !== stamped.id);
        return [stamped, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
      });
    });
  }

  async function startNewChat() {
    const fresh = createEmptySession();
    setError(null);
    setQuestion("");
    setSidebarOpen(false);
    await persist(fresh);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function openChat(id: string) {
    const chats = sessions.length ? sessions : await listChats();
    const found = chats.find((c) => c.id === id);
    if (!found) return;
    setError(null);
    setQuestion("");
    setSession(found);
    setActiveId(found.id);
    setActiveChatId(found.id);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function removeChat(id: string) {
    await deleteChat(id);
    const remaining = sessions.filter((c) => c.id !== id);
    setSessions(remaining);
    if (activeId === id) {
      if (remaining[0]) {
        setSession(remaining[0]);
        setActiveId(remaining[0].id);
        setActiveChatId(remaining[0].id);
      } else {
        await startNewChat();
      }
    }
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      const welcome: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `📄 **"${data.name}"** loaded (${data.pages} ${data.pages === 1 ? "page" : "pages"}).\n\nAsk me anything about this document.`,
      };
      await persist({
        ...session,
        title: titleFromDocument(data.name),
        document: { name: data.name, pages: data.pages, text: data.text },
        messages: [welcome],
      });
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function askQuestion(raw: string) {
    if (!session.document || !raw.trim() || asking) return;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: raw.trim(),
    };
    const withUser = { ...session, messages: [...session.messages, userMessage] };
    setQuestion("");
    setAsking(true);
    setError(null);
    await persist(withUser);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMessage.content,
          documentText: session.document.text,
          documentName: session.document.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ask failed");
      await persist({
        ...withUser,
        messages: [
          ...withUser.messages,
          { id: crypto.randomUUID(), role: "assistant", content: data.answer },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setAsking(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    await askQuestion(question);
  }

  /* ── loading screen ─────────────────────────────────── */
  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center bg-sidebar-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
            <div className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-accent" />
          </div>
          <span className="text-sm font-medium text-white/50">Loading PaperPilot…</span>
        </div>
      </div>
    );
  }

  /* ── main render ────────────────────────────────────── */
  return (
    <div className="flex h-screen overflow-hidden bg-surface">

      {/* ── Sidebar overlay (mobile) ── */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close"
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-sidebar-bg transition-transform duration-300 ease-out lg:relative lg:translate-x-0 lg:w-64 xl:w-72 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.07]">
          <Link
            href="/"
            className="font-[family-name:var(--font-display)] text-lg font-semibold text-white tracking-tight"
          >
            PaperPilot
          </Link>
          <button
            type="button"
            onClick={startNewChat}
            title="New chat"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent transition hover:bg-accent hover:text-white"
          >
            <IconPlus />
          </button>
        </div>

        {/* Chat list */}
        <div className="scroll-y flex-1 px-2 py-3 space-y-0.5">
          {sessions.length === 0 ? (
            <p className="px-3 py-4 text-xs text-white/30 text-center">
              No saved chats yet.
              <br />Upload a PDF to start.
            </p>
          ) : (
            sessions.map((chat) => {
              const active = chat.id === activeId;
              return (
                <div
                  key={chat.id}
                  className={`group relative flex items-start gap-2 rounded-lg px-3 py-2.5 transition cursor-pointer ${
                    active
                      ? "bg-accent/20 text-white"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  onClick={() => openChat(chat.id)}
                >
                  <span className={`mt-0.5 shrink-0 ${active ? "text-accent" : "text-white/25"}`}>
                    <IconPdf />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-tight">
                      {chat.title}
                    </div>
                    <div className="mt-0.5 text-[11px] opacity-50">
                      {chat.document
                        ? `${chat.messages.length} msg · ${new Date(chat.updatedAt).toLocaleDateString()}`
                        : "Empty"}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeChat(chat.id); }}
                    title="Delete"
                    className="absolute right-2 top-2.5 flex h-5 w-5 items-center justify-center rounded opacity-0 transition hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                  >
                    <IconTrash />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.07]">
          <p className="text-[11px] text-white/25 text-center">
            Chats saved in this browser only
          </p>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-surface lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2}>
              <line x1="3" y1="6"  x2="21" y2="6"  />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            {session.document ? (
              <>
                <span className="text-accent"><IconPdf /></span>
                <span className="truncate text-sm font-semibold text-ink">
                  {session.document.name}
                </span>
                <span className="rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-semibold text-accent">
                  {session.document.pages}p
                </span>
              </>
            ) : (
              <span className="text-sm text-muted">No document loaded</span>
            )}
          </div>

          <button
            type="button"
            onClick={startNewChat}
            className="hidden items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-ink shadow-sm transition hover:bg-surface lg:flex"
          >
            <IconPlus /> New chat
          </button>
        </header>

        {/* Body: upload strip + chat */}
        <div className="flex min-h-0 flex-1 flex-col">

          {/* Upload zone */}
          <div className="shrink-0 border-b border-line bg-panel px-4 py-3">
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onUpload(e.dataTransfer.files?.[0]); }}
              className={`relative flex cursor-pointer items-center gap-3 rounded-xl border transition-all ${
                dragOver
                  ? "border-accent bg-accent-dim scale-[1.01]"
                  : "border-dashed border-accent/40 bg-surface hover:border-accent hover:bg-accent-dim"
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3 flex-1">
                {uploading ? (
                  <>
                    <div className="relative h-6 w-6 shrink-0">
                      <div className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-accent" />
                    </div>
                    <span className="text-sm font-semibold text-ink">Reading PDF…</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted"><IconUpload /></span>
                    <div>
                      <span className="text-sm font-semibold text-ink">
                        {session.document ? `Replace: ${session.document.name}` : "Upload a PDF"}
                      </span>
                      <span className="ml-2 text-xs text-muted">Drop here or click · max 8MB</span>
                    </div>
                  </>
                )}
              </div>
              {session.document && !uploading && (
                <span className="mr-4 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
                  Loaded
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={uploading || asking}
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
            </label>

            {error && (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Chat area */}
          <div className="scroll-y flex-1 px-4 py-5 sm:px-6">
            {session.messages.length === 0 ? (
              /* Empty state */
              <div className="animate-fade flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-dim text-accent">
                  <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M8 13h8M8 17h5" />
                  </svg>
                </div>
                <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink sm:text-3xl">
                  Ask your document
                </h2>
                <p className="mt-2 max-w-sm text-sm text-muted">
                  Upload a PDF above, then ask anything — "Summarize", "What is the total?", "List key dates".
                </p>
                <p className="mt-3 text-xs text-muted/60">Press <kbd className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px]">Enter</kbd> to send</p>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-5">
                {session.messages.map((msg) => (
                  <MessageRow key={msg.id} message={msg} />
                ))}
                {asking && <TypingRow />}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Suggestions */}
          {session.document && !asking && session.messages.length <= 2 && (
            <div className="shrink-0 border-t border-line bg-panel/80 px-4 py-2 sm:px-6">
              <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => askQuestion(s)}
                    className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-muted shadow-sm transition hover:border-accent hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input bar */}
          <div className="shrink-0 border-t border-line bg-panel px-4 py-3 sm:px-6">
            <form onSubmit={onAsk} className="mx-auto flex max-w-3xl gap-2">
              <input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={!session.document || asking}
                placeholder={
                  session.document
                    ? "Ask anything about this PDF…"
                    : "Upload a PDF to start asking questions"
                }
                className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink outline-none ring-accent/30 placeholder:text-muted/60 transition focus:border-accent focus:ring-2 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!session.document || asking || !question.trim()}
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {asking
                  ? <div className="h-4 w-4 animate-spin-slow rounded-full border-2 border-transparent border-t-white" />
                  : <><IconSend /><span className="hidden sm:inline">Ask</span></>
                }
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ── Message row ─────────────────────────────────────────── */
function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-ink px-4 py-3 text-sm leading-6 text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      {/* Avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-dim text-accent text-[11px] font-bold">
        PP
      </div>
      {/* Bubble */}
      <div className="group min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-line/70 bg-panel px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          <div className="prose-ai">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        </div>
        {/* Copy button */}
        <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={message.content} />
        </div>
      </div>
    </div>
  );
}

/* ── Typing indicator ──────────────────────────────────── */
function TypingRow() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-dim text-accent text-[11px] font-bold">
        PP
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-line/70 bg-panel px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
          <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
          <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
}
