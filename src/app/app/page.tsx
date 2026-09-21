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
  "List important names and dates",
];

export default function WorkspacePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
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
    const selected =
      chats.find((chat) => chat.id === targetId) ?? chats[0];

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
        const without = prev.filter((item) => item.id !== stamped.id);
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
  }

  async function openChat(id: string) {
    const chats = sessions.length ? sessions : await listChats();
    const found = chats.find((chat) => chat.id === id);
    if (!found) return;
    setError(null);
    setQuestion("");
    setSession(found);
    setActiveId(found.id);
    setActiveChatId(found.id);
    setSidebarOpen(false);
  }

  async function removeChat(id: string) {
    await deleteChat(id);
    const remaining = sessions.filter((chat) => chat.id !== id);
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

      const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      const welcome: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Loaded “${data.name}” (${data.pages} pages). Ask me anything about it.`,
      };

      await persist({
        ...session,
        title: titleFromDocument(data.name),
        document: {
          name: data.name,
          pages: data.pages,
          text: data.text,
        },
        messages: [welcome],
      });
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

    const withUser = {
      ...session,
      messages: [...session.messages, userMessage],
    };

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

      if (!res.ok) {
        throw new Error(data.error || "Ask failed");
      }

      await persist({
        ...withUser,
        messages: [
          ...withUser.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.answer,
          },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    await askQuestion(question);
  }

  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center bg-paper text-muted">
        <div className="flex items-center gap-2 text-sm">
          <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
          <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
          <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
          <span className="ml-2">Loading PaperPilot...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-[linear-gradient(180deg,#eef3f7_0%,#e7eef5_100%)]">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-panel/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink lg:hidden"
            >
              Chats
            </button>
            <Link
              href="/"
              className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink"
            >
              PaperPilot
            </Link>
          </div>
          <div className="hidden min-w-0 flex-1 truncate px-4 text-sm text-muted sm:block">
            {session.document
              ? `${session.document.name} · ${session.document.pages} pages`
              : "No document yet"}
          </div>
          <button
            type="button"
            onClick={startNewChat}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-soft"
          >
            New chat
          </button>
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-7xl flex-1 gap-0 lg:gap-6 lg:px-6 lg:py-6">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close chats"
            className="fixed inset-0 z-30 bg-ink/35 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[86%] max-w-xs flex-col border-r border-line bg-panel p-4 shadow-xl transition-transform lg:static lg:z-0 lg:w-[280px] lg:max-w-none lg:shrink-0 lg:rounded-2xl lg:border lg:shadow-sm ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Saved chats</h2>
            <button
              type="button"
              onClick={startNewChat}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              New
            </button>
          </div>

          <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto pr-1">
            {sessions.length === 0 ? (
              <p className="rounded-xl bg-paper px-3 py-4 text-sm text-muted">
                Your chats will appear here after you upload a PDF.
              </p>
            ) : (
              sessions.map((chat) => {
                const active = chat.id === activeId;
                return (
                  <div
                    key={chat.id}
                    className={`group rounded-xl border px-3 py-3 transition ${
                      active
                        ? "border-accent/40 bg-[rgba(15,118,110,0.08)]"
                        : "border-transparent bg-paper hover:border-line"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(chat.id)}
                      className="w-full text-left"
                    >
                      <div className="truncate text-sm font-semibold text-ink">
                        {chat.title}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {chat.document
                          ? `${chat.messages.length} messages`
                          : "Empty chat"}
                        {" · "}
                        {new Date(chat.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChat(chat.id)}
                      className="mt-2 text-xs font-medium text-muted opacity-100 transition hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
                    >
                      Delete
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-line px-3 py-3 text-xs text-muted">
            Chats are saved in this browser only. Clear site data will remove them.
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 lg:px-0 lg:py-0">
          <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">Document</h2>
                <p className="mt-1 text-sm text-muted">
                  Upload a PDF, then chat. Progress is saved automatically.
                </p>
              </div>
              {session.document && (
                <div className="rounded-xl bg-paper px-3 py-2 text-sm">
                  <div className="font-semibold text-ink">{session.document.name}</div>
                  <div className="text-muted">{session.document.pages} pages loaded</div>
                </div>
              )}
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onUpload(e.dataTransfer.files?.[0]);
              }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${
                dragOver
                  ? "border-accent bg-[rgba(15,118,110,0.12)]"
                  : "border-accent/40 bg-[rgba(15,118,110,0.05)] hover:border-accent hover:bg-[rgba(15,118,110,0.08)]"
              }`}
            >
              {uploading ? (
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="ml-1">Reading PDF...</span>
                </div>
              ) : (
                <>
                  <span className="text-sm font-semibold text-ink">
                    Drop PDF here or tap to choose
                  </span>
                  <span className="mt-1 text-xs text-muted">Max 8MB · PDF only</span>
                </>
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
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </section>

          <section className="flex min-h-[58vh] flex-1 flex-col rounded-2xl border border-line bg-panel shadow-sm">
            <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
              {session.messages.length === 0 ? (
                <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                  <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-ink sm:text-4xl">
                    Ask your document
                  </h1>
                  <p className="mt-2 max-w-md text-sm text-muted sm:text-base">
                    Upload a PDF above, then ask things like “What is the total?”
                    or “Summarize the main points”.
                  </p>
                </div>
              ) : (
                session.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[80%] ${
                      message.role === "user"
                        ? "ml-auto bg-ink text-white"
                        : "bg-paper text-ink"
                    }`}
                  >
                    {message.content}
                  </div>
                ))
              )}

              {asking && (
                <div className="flex max-w-[80%] items-center gap-2 rounded-2xl bg-paper px-4 py-3 text-sm text-muted">
                  <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="ml-1">Thinking...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {session.document && !asking && session.messages.length <= 2 && (
              <div className="flex flex-wrap gap-2 border-t border-line px-4 pt-3 sm:px-5">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => askQuestion(item)}
                    className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={onAsk} className="border-t border-line p-3 sm:p-4">
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={!session.document || asking}
                  placeholder={
                    session.document
                      ? "Ask a question about this PDF..."
                      : "Upload a PDF first"
                  }
                  className="min-w-0 flex-1 rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none ring-accent/30 placeholder:text-muted focus:ring-2 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!session.document || asking || !question.trim()}
                  className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
                >
                  {asking ? "..." : "Ask"}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
