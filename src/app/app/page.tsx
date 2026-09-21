"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  ChatSession,
  DocumentMeta,
  MAX_DOCS,
  Message,
  clearActiveChatId,
  combinedDocumentText,
  createEmptySession,
  deleteChat,
  documentNames,
  getActiveChatId,
  getDocuments,
  hasSeenOnboarding,
  listChats,
  markOnboardingSeen,
  saveChat,
  setActiveChatId,
  titleFromDocument,
} from "@/lib/chat-store";
import {
  exportChatMarkdown,
  exportChatText,
  formatBytes,
  formatChars,
  shareChatText,
} from "@/lib/export";
import { splitAnswerAndCitations } from "@/lib/citations";
import { canAsk, getAskUsage, recordAsk } from "@/lib/rate-limit";

const CHIPS = [
  "Summarize this document",
  "What are the key points?",
  "List all important dates",
  "Who are the people mentioned?",
];

const COMPARE_CHIPS = [
  "Compare these documents side by side",
  "What is the same and what is different?",
  "List conflicting numbers, dates, or names",
  "Which document is more complete?",
];

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
  eye: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  share: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  refresh: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
  stop: () => <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>,
  edit: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  pin: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 004.89 15H19.1a2 2 0 001.78-2.55l-1.78-.9A2 2 0 0118 10.76V6a2 2 0 00-2-2H8a2 2 0 00-2 2v4.76z"/></svg>,
  search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
};

function Spinner({ size = "h-4 w-4" }: { size?: string }) {
  return <div className={`${size} animate-spin rounded-full border-2 border-transparent border-t-[#00d4aa]`} />;
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1800);
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] transition hover:text-[#8ca3be]"
    >
      {ok ? <I.check /> : <I.copy />}
      <span>{ok ? "Copied" : label}</span>
    </button>
  );
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession>(() => createEmptySession());
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [askUsage, setAskUsage] = useState({ used: 0, limit: 40, remaining: 40 });
  const [compareMode, setCompareMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [, tx] = useTransition();

  const docs = useMemo(() => getDocuments(session), [session]);
  const previewDoc = docs.find((d) => d.id === previewDocId) ?? docs[0] ?? null;
  const filteredSessions = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((chat) => {
      const inTitle = chat.title.toLowerCase().includes(q);
      const inDocs = getDocuments(chat).some((d) => d.name.toLowerCase().includes(q));
      const inMsgs = chat.messages.some((m) => m.content.toLowerCase().includes(q));
      return inTitle || inDocs || inMsgs;
    });
  }, [sessions, chatSearch]);

  const previewUrl = useMemo(() => {
    if (!previewDoc?.pdfBytes) return null;
    try {
      const raw = previewDoc.pdfBytes;
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer);
      if (!bytes.byteLength) return null;
      return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    } catch {
      return null;
    }
  }, [previewDoc]);

  function openAttachPicker() {
    if (docs.length >= MAX_DOCS) {
      setError(`Max ${MAX_DOCS} PDFs per chat. Remove one first.`);
      return;
    }
    attachRef.current?.click();
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const refresh = useCallback(async (id?: string | null) => {
    const all = await listChats();
    setSessions(all);
    if (!all.length) {
      const s = createEmptySession();
      setSession(s);
      setActiveId(s.id);
      clearActiveChatId();
      return;
    }
    const target = all.find((c) => c.id === (id ?? getActiveChatId())) ?? all[0];
    setSession(target);
    setActiveId(target.id);
    setActiveChatId(target.id);
    const d = getDocuments(target);
    setPreviewDocId(d[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => {
        setReady(true);
        setAskUsage(getAskUsage());
        if (!hasSeenOnboarding()) setShowOnboard(true);
      });
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, asking]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
      if (meta && e.key.toLowerCase() === "e" && session.messages.length) {
        e.preventDefault();
        setExportOpen(true);
      }
      if (meta && e.key.toLowerCase() === "p" && docs.length && previewOpen) {
        e.preventDefault();
        setPreviewOpen(false);
      }
      if (e.key === "Escape") {
        setExportOpen(false);
        setNavOpen(false);
        setShowOnboard(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.messages.length, docs.length]);

  async function save(next: ChatSession) {
    const s = {
      ...next,
      updatedAt: Date.now(),
      documents: getDocuments(next),
      document: null,
      pinned: next.pinned ?? session.pinned,
    };
    setSession(s);
    setActiveId(s.id);
    setActiveChatId(s.id);
    await saveChat(s);
    tx(() =>
      setSessions((p) =>
        [s, ...p.filter((c) => c.id !== s.id)].sort((a, b) => {
          const pin = Number(!!b.pinned) - Number(!!a.pinned);
          if (pin !== 0) return pin;
          return b.updatedAt - a.updatedAt;
        }),
      ),
    );
  }

  async function newChat() {
    const s = createEmptySession();
    setError(null);
    setLastQuestion(null);
    setQ("");
    setNavOpen(false);
    setPreviewDocId(null);
    await save(s);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function openChat(id: string) {
    const all = sessions.length ? sessions : await listChats();
    const found = all.find((c) => c.id === id);
    if (!found) return;
    setError(null);
    setLastQuestion(null);
    setQ("");
    setSession(found);
    setActiveId(found.id);
    setActiveChatId(found.id);
    setNavOpen(false);
    const d = getDocuments(found);
    setPreviewDocId(d[0]?.id ?? null);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function delChat(id: string) {
    await deleteChat(id);
    const rest = sessions.filter((c) => c.id !== id);
    setSessions(rest);
    if (activeId === id) (rest[0] ? openChat(rest[0].id) : newChat());
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    const current = getDocuments(session);
    if (current.length >= MAX_DOCS) {
      setError(`Max ${MAX_DOCS} PDFs per chat. Remove one first.`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const pdfBytes = (await file.arrayBuffer()).slice(0);
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Upload failed");

      const doc: DocumentMeta = {
        id: crypto.randomUUID(),
        name: d.name,
        pages: d.pages,
        text: d.text,
        sizeBytes: d.sizeBytes ?? file.size,
        charCount: d.charCount,
        preview: d.preview,
        pdfBytes,
      };

      const nextDocs = [...current, doc];
      const title =
        nextDocs.length === 1
          ? titleFromDocument(doc.name)
          : `${titleFromDocument(nextDocs[0].name)} +${nextDocs.length - 1}`;

      await save({
        ...session,
        title,
        documents: nextDocs,
        messages: [
          ...session.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `📄 **"${doc.name}"** added (${doc.pages} pages · ${formatBytes(doc.sizeBytes || file.size)}).\n\nYou now have **${nextDocs.length}** document${nextDocs.length > 1 ? "s" : ""} in this chat. Ask anything.`,
          },
        ],
      });
      setPreviewDocId(doc.id);
      setError(null);
      if (nextDocs.length >= 2) setCompareMode(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (attachRef.current) attachRef.current.value = "";
    }
  }

  async function ask(raw: string, replaceFromUserId?: string) {
    const currentDocs = getDocuments(session);
    if (!currentDocs.length || !raw.trim() || asking) return;

    const quota = canAsk();
    if (!quota.ok) {
      setError(`Daily demo limit reached (${quota.limit} asks). Try again tomorrow.`);
      return;
    }

    const question = raw.trim();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let baseMessages = session.messages;
    if (replaceFromUserId) {
      const idx = baseMessages.findIndex((m) => m.id === replaceFromUserId);
      if (idx >= 0) baseMessages = baseMessages.slice(0, idx);
    }

    const um: Message = { id: crypto.randomUUID(), role: "user", content: question };
    const assistantId = crypto.randomUUID();
    const next: ChatSession = {
      ...session,
      documents: currentDocs,
      messages: [
        ...baseMessages,
        um,
        { id: assistantId, role: "assistant", content: "" },
      ],
    };

    setQ("");
    setEditingId(null);
    setAsking(true);
    setError(null);
    setLastQuestion(question);
    await save(next);
    setAskUsage(recordAsk());

    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          documentText: combinedDocumentText(currentDocs),
          documentName: documentNames(currentDocs),
          compareMode: compareMode && currentDocs.length >= 2,
        }),
      });

      if (!r.ok || !r.body) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || "Ask failed");
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim()) as {
            text?: string;
            done?: boolean;
            error?: string;
          };
          if (payload.error) throw new Error(payload.error);
          if (payload.text) {
            answer += payload.text;
            setSession((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantId ? { ...m, content: answer } : m,
              ),
            }));
          }
        }
      }

      if (!answer.trim()) throw new Error("Empty answer. Try again.");

      await save({
        ...next,
        messages: next.messages.map((m) =>
          m.id === assistantId ? { ...m, content: answer } : m,
        ),
      });
      setLastQuestion(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        const current = getDocuments(session);
        setSession((prev) => {
          const msgs = [...prev.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.content.trim()) {
            msgs[msgs.length - 1] = {
              ...last,
              content: `${last.content.trim()}\n\n_(Stopped)_`,
            };
          } else if (last?.role === "assistant") {
            msgs.pop();
          }
          const stopped = { ...prev, documents: current, messages: msgs };
          void saveChat(stopped);
          return stopped;
        });
      } else {
        setError(e instanceof Error ? e.message : "Failed");
        await save({
          ...session,
          documents: currentDocs,
          messages: [...baseMessages, um],
        });
      }
    } finally {
      setAsking(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  function startEdit(msg: Message) {
    if (asking) return;
    setEditingId(msg.id);
    setEditDraft(msg.content);
  }

  async function submitEdit() {
    if (!editingId || !editDraft.trim()) return;
    const id = editingId;
    setEditingId(null);
    await ask(editDraft, id);
  }

  async function togglePin(chat: ChatSession) {
    const next = { ...chat, pinned: !chat.pinned };
    await saveChat(next);
    if (chat.id === activeId) setSession(next);
    setSessions((prev) =>
      [...prev.map((c) => (c.id === chat.id ? next : c))].sort((a, b) => {
        const pin = Number(!!b.pinned) - Number(!!a.pinned);
        if (pin !== 0) return pin;
        return b.updatedAt - a.updatedAt;
      }),
    );
  }

  function startRename(chat: ChatSession) {
    setRenamingId(chat.id);
    setRenameDraft(chat.title);
  }

  async function submitRename() {
    if (!renamingId || !renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    const chat = sessions.find((c) => c.id === renamingId);
    if (!chat) return;
    const next = { ...chat, title: renameDraft.trim().slice(0, 60) };
    await saveChat(next);
    if (chat.id === activeId) setSession(next);
    setSessions((prev) => prev.map((c) => (c.id === chat.id ? next : c)));
    setRenamingId(null);
  }

  function viewAttachment(docId: string) {
    const doc = docs.find((d) => d.id === docId);
    if (!doc?.pdfBytes) {
      setError("PDF preview needs a fresh upload for this file. Re-add it, then tap View.");
      return;
    }
    setPreviewDocId(docId);
    setPreviewOpen(true);
  }

  async function clearMessages() {
    const currentDocs = getDocuments(session);
    if (!currentDocs.length) return;
    await save({
      ...session,
      documents: currentDocs,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Chat cleared. **${currentDocs.length}** document${currentDocs.length > 1 ? "s" : ""} still loaded — ask a new question.`,
        },
      ],
    });
    setLastQuestion(null);
  }

  async function removeDoc(id: string) {
    const nextDocs = getDocuments(session).filter((d) => d.id !== id);
    await save({
      ...session,
      title: nextDocs[0] ? titleFromDocument(nextDocs[0].name) : "New chat",
      documents: nextDocs,
      messages: nextDocs.length ? session.messages : [],
    });
    if (previewDocId === id) {
      setPreviewDocId(nextDocs[0]?.id ?? null);
      if (!nextDocs.length) setPreviewOpen(false);
    }
    if (nextDocs.length < 2) setCompareMode(false);
    if (!nextDocs.length) setError(null);
  }

  async function shareConversation() {
    const text = shareChatText(session);
    if (navigator.share) {
      try {
        await navigator.share({ title: session.title, text });
        return;
      } catch {
        /* fall through */
      }
    }
    await navigator.clipboard.writeText(text);
    setError(null);
    // brief soft feedback via temporary message isn't needed; clipboard is enough
  }

  function dismissOnboard() {
    markOnboardingSeen();
    setShowOnboard(false);
  }

  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg0">
        <div className="flex flex-col items-center gap-5">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] p-px">
            <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[#06091a]">
              <span className="font-[family-name:var(--font-display)] text-lg font-bold text-gradient">PP</span>
            </div>
          </div>
          <Spinner size="h-5 w-5" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-bg0">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-64 -top-64 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(0,212,170,0.06),transparent_65%)]" />
        <div className="absolute -right-48 top-1/3 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.06),transparent_65%)]" />
      </div>

      {navOpen && (
        <button aria-label="Close" className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />
      )}

      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col transition-transform duration-300 lg:relative lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="absolute inset-0 border-r border-white/[0.06] bg-[rgba(11,17,39,0.85)] backdrop-blur-2xl" />
        <div className="relative flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pb-4 pt-5">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6]">
                <span className="text-[11px] font-black text-white">PP</span>
              </div>
              <span className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-white">PaperPilot</span>
            </Link>
            <button type="button" onClick={() => setNavOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#415570] hover:bg-white/[0.06] lg:hidden"><I.close /></button>
          </div>
          <div className="px-4 pb-3">
            <button type="button" onClick={newChat} className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa]">
              <I.plus /><span>New chat</span>
              <kbd className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-[#415570]">Ctrl+N</kbd>
            </button>
          </div>
          <div className="px-5 pb-2"><span className="text-[10px] font-semibold uppercase tracking-widest text-[#415570]">Recents</span></div>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <span className="text-[#415570]"><I.search /></span>
              <input
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                placeholder="Search chats…"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-[#415570]"
              />
            </div>
          </div>
          <div className="scroll-y flex-1 space-y-0.5 px-3 pb-3">
            {filteredSessions.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[#415570]">
                {chatSearch ? "No chats match your search." : "No chats yet."}
              </p>
            ) : (
              filteredSessions.map((chat) => {
                const active = chat.id === activeId;
                const count = getDocuments(chat).length;
                return (
                  <div
                    key={chat.id}
                    className={`group relative rounded-xl px-3 py-2.5 transition ${
                      active
                        ? "border border-[#00d4aa]/20 bg-gradient-to-r from-[#00d4aa]/15 to-[#3b82f6]/10"
                        : "border border-transparent hover:bg-white/[0.04]"
                    }`}
                  >
                    {renamingId === chat.id ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); void submitRename(); }}
                        className="flex items-center gap-1"
                      >
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => void submitRename()}
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[13px] text-white outline-none"
                        />
                      </form>
                    ) : (
                      <button type="button" onClick={() => openChat(chat.id)} className="flex w-full items-start gap-2.5 text-left">
                        <span className={`mt-0.5 shrink-0 ${active ? "text-[#00d4aa]" : "text-[#415570]"}`}>
                          {chat.pinned ? <I.pin /> : <I.file />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-[13px] font-medium ${active ? "text-white" : "text-[#8ca3be]"}`}>
                            {chat.title}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#415570]">{count} PDF · {chat.messages.length} msg</div>
                        </div>
                      </button>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      <button type="button" onClick={() => togglePin(chat)} className="rounded px-1.5 py-0.5 text-[10px] text-[#415570] hover:text-[#00d4aa]">
                        {chat.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button type="button" onClick={() => startRename(chat)} className="rounded px-1.5 py-0.5 text-[10px] text-[#415570] hover:text-[#8ca3be]">Rename</button>
                      <button type="button" onClick={() => delChat(chat.id)} className="rounded px-1.5 py-0.5 text-[10px] text-[#415570] hover:text-[#f87171]">Delete</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-white/[0.06] px-5 py-4 text-center text-[11px] text-[#415570]">
            Demo asks today: {askUsage.used}/{askUsage.limit}
          </div>
        </div>
      </aside>

      {/* main */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="relative z-50 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[rgba(6,9,26,0.95)] px-4 backdrop-blur-xl">
          <button type="button" onClick={() => setNavOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#415570] lg:hidden"><I.menu /></button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">
            {docs.length
              ? `${docs.length} document${docs.length > 1 ? "s" : ""} loaded${compareMode && docs.length >= 2 ? " · Compare ON" : ""}`
              : "No documents"}
          </div>
          <div className="relative z-50 flex items-center gap-2">
            {docs.length > 0 && previewOpen && (
              <button type="button" onClick={() => setPreviewOpen(false)} className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] hover:text-[#00d4aa]" title="Ctrl+P">
                <I.eye /><span className="hidden sm:inline">Hide PDF</span>
              </button>
            )}
            {session.messages.length > 0 && (
              <>
                <button type="button" onClick={shareConversation} className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] hover:text-[#00d4aa] sm:flex">
                  <I.share /><span>Share</span>
                </button>
                <div className="relative">
                  <button type="button" onClick={() => setExportOpen((v) => !v)} className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] hover:text-[#00d4aa]">
                    <I.download /><span className="hidden sm:inline">Export</span>
                  </button>
                  {exportOpen && (
                    <>
                      <button type="button" aria-label="Close" className="fixed inset-0 z-[60]" onClick={() => setExportOpen(false)} />
                      <div className="absolute right-0 top-full z-[70] mt-2 w-52 overflow-hidden rounded-xl border border-white/[0.12] bg-[#101828] shadow-2xl">
                        <button type="button" onClick={() => { exportChatMarkdown(session); setExportOpen(false); }} className="block w-full px-4 py-3 text-left text-sm text-[#e2e8f0] hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]">Markdown (.md)</button>
                        <button type="button" onClick={() => { exportChatText(session); setExportOpen(false); }} className="block w-full px-4 py-3 text-left text-sm text-[#e2e8f0] hover:bg-[#00d4aa]/10 hover:text-[#00d4aa]">Text (.txt)</button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            {docs.length > 0 && session.messages.length > 1 && (
              <button type="button" onClick={clearMessages} className="hidden rounded-xl border border-white/[0.08] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] hover:text-red-400 sm:block">Clear</button>
            )}
            <button type="button" onClick={newChat} className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 py-1.5 text-[13px] font-semibold text-[#8ca3be] hover:text-[#00d4aa] lg:flex"><I.plus />New</button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* chat column */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* docs panel */}
            <div className="shrink-0 border-b border-white/[0.06] bg-[rgba(6,9,26,0.5)] px-4 py-3">
              {docs.length > 0 && !uploading ? (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${
                        previewOpen && previewDocId === doc.id
                          ? "border-[#00d4aa]/30 bg-[#00d4aa]/5"
                          : "border-white/[0.08] bg-white/[0.03]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[#00d4aa]"><I.file /></span>
                          <span className="truncate text-sm font-semibold text-white">{doc.name}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-[#00d4aa]/10 px-2 py-0.5 text-[10px] font-bold text-[#00d4aa]">{doc.pages}p</span>
                          {doc.sizeBytes != null && <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-[#8ca3be]">{formatBytes(doc.sizeBytes)}</span>}
                          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-[#8ca3be]">{formatChars(doc.charCount ?? doc.text.length)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => viewAttachment(doc.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-[#8ca3be] hover:border-[#00d4aa]/40 hover:text-[#00d4aa]"
                        >
                          <I.eye /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => removeDoc(doc.id)}
                          className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-[#8ca3be] hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {docs.length < MAX_DOCS && (
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] px-3 py-2 text-xs font-semibold text-[#8ca3be] hover:border-[#00d4aa]/40 hover:text-[#00d4aa]">
                      <I.plus /> Add another PDF ({docs.length}/{MAX_DOCS})
                      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" disabled={asking} onChange={(e) => upload(e.target.files?.[0])} />
                    </label>
                  )}
                  {docs.length >= 2 && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#3b82f6]/25 bg-[#3b82f6]/10 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white">Compare mode</div>
                        <div className="text-[11px] text-[#8ca3be]">
                          AI will contrast {docs.length} documents by name
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCompareMode((v) => !v)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                          compareMode
                            ? "bg-[#3b82f6] text-white"
                            : "border border-white/15 bg-white/[0.04] text-[#8ca3be]"
                        }`}
                      >
                        {compareMode ? "ON" : "OFF"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <label
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${drag ? "border-[#00d4aa]/70 bg-[#00d4aa]/10" : "border-white/[0.08] bg-white/[0.03] hover:border-[#00d4aa]/40"}`}
                >
                  {uploading ? <><Spinner /><span className="text-sm font-semibold text-white">Reading PDF…</span></> : (
                    <div>
                      <span className="text-sm font-semibold text-[#8ca3be]">Upload PDF</span>
                      <span className="ml-2 text-xs text-[#415570]">up to {MAX_DOCS} files · 8MB each</span>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden" disabled={uploading || asking} onChange={(e) => upload(e.target.files?.[0])} />
                </label>
              )}

              {error && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  <I.warn /><span className="flex-1">{error}</span>
                  {lastQuestion && (
                    <button type="button" onClick={() => ask(lastQuestion)} className="flex items-center gap-1 rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20">
                      <I.refresh /> Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="scroll-y flex-1 px-4 py-6 sm:px-6">
              {session.messages.length === 0 ? (
                <div className="animate-fade flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                  <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-shimmer sm:text-4xl">Ask your documents</h2>
                  <p className="mt-3 max-w-sm text-sm text-[#415570]">
                    Upload a PDF above or tap <strong className="text-[#8ca3be]">+</strong> in the chat box. Use <strong className="text-[#8ca3be]">View</strong> next to each file to preview.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2 text-[11px] text-[#415570]">
                    <kbd className="rounded border border-white/10 px-2 py-1">Ctrl+N</kbd> new
                    <kbd className="rounded border border-white/10 px-2 py-1">Ctrl+E</kbd> export
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-2xl space-y-6">
                  {session.messages.map((m, i) => {
                    const isLastUser =
                      m.role === "user" &&
                      !session.messages.slice(i + 1).some((x) => x.role === "user");
                    return (
                      <Bubble
                        key={m.id}
                        msg={m}
                        idx={i}
                        streaming={asking && i === session.messages.length - 1 && m.role === "assistant"}
                        canEdit={isLastUser && !asking}
                        editing={editingId === m.id}
                        editDraft={editDraft}
                        onEditDraft={setEditDraft}
                        onStartEdit={() => startEdit(m)}
                        onCancelEdit={() => setEditingId(null)}
                        onSubmitEdit={submitEdit}
                      />
                    );
                  })}
                  {asking && session.messages[session.messages.length - 1]?.content === "" && <ThinkingBubble />}
                  <div ref={endRef} />
                </div>
              )}
            </div>

            {docs.length > 0 && !asking && session.messages.length <= 3 && (
              <div className="shrink-0 border-t border-white/[0.06] px-4 py-2.5 sm:px-6">
                <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
                  {(compareMode && docs.length >= 2 ? COMPARE_CHIPS : CHIPS).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => ask(c)}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                        compareMode && docs.length >= 2
                          ? "border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#93c5fd] hover:border-[#3b82f6]/60"
                          : "border-white/[0.08] bg-white/[0.04] text-[#8ca3be] hover:text-[#00d4aa]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="shrink-0 border-t border-white/[0.06] bg-[rgba(6,9,26,0.7)] px-4 py-4 backdrop-blur-xl sm:px-6">
              <form
                onSubmit={(e) => { e.preventDefault(); ask(q); }}
                className="mx-auto flex max-w-2xl items-center gap-2"
              >
                <div className={`flex min-w-0 flex-1 items-center gap-1 rounded-2xl border bg-white/[0.03] pl-2 pr-3 transition ${q ? "border-[#00d4aa]/40" : "border-white/[0.08] focus-within:border-[#00d4aa]/40"}`}>
                  <button
                    type="button"
                    onClick={openAttachPicker}
                    disabled={uploading || asking || docs.length >= MAX_DOCS}
                    title={docs.length ? "Add another PDF" : "Upload PDF"}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#8ca3be] transition hover:bg-white/[0.06] hover:text-[#00d4aa] disabled:opacity-40"
                  >
                    <I.plus />
                  </button>
                  <input
                    ref={attachRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    disabled={uploading || asking}
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        ask(q);
                      }
                    }}
                    disabled={!docs.length || asking}
                    placeholder={
                      !docs.length
                        ? "Tap + to upload a PDF"
                        : compareMode && docs.length >= 2
                          ? "Ask a compare question… (Enter to send)"
                          : "Ask anything… (Enter to send)"
                    }
                    className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-[#415570] disabled:opacity-40"
                  />
                </div>
                <button
                  type={asking ? "button" : "submit"}
                  onClick={asking ? stopGenerating : undefined}
                  disabled={!asking && (!docs.length || !q.trim())}
                  title={asking ? "Stop generating" : "Send"}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#0ea5e9] text-white shadow-[0_0_20px_rgba(0,212,170,0.3)] disabled:opacity-30"
                >
                  {asking ? <I.stop /> : <I.send />}
                </button>
              </form>
            </div>
          </div>

          {/* PDF preview — desktop side panel */}
          {previewOpen && previewUrl && (
            <aside className="hidden min-h-0 w-[42%] min-w-[320px] max-w-[520px] flex-col border-l border-white/[0.06] bg-[rgba(11,17,39,0.85)] lg:flex">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{previewDoc?.name}</div>
                  <div className="text-[11px] text-[#415570]">Live PDF preview</div>
                </div>
                <button type="button" onClick={() => setPreviewOpen(false)} className="rounded-lg p-1.5 text-[#415570] hover:text-white"><I.close /></button>
              </div>
              <iframe title="PDF preview" src={`${previewUrl}#toolbar=1`} className="min-h-0 flex-1 w-full bg-[#0b1127]" />
            </aside>
          )}
        </div>
      </div>

      {/* PDF preview — mobile / tablet overlay */}
      {previewOpen && previewUrl && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-[#06091a] lg:hidden">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{previewDoc?.name}</div>
              <div className="text-[11px] text-[#415570]">PDF preview</div>
            </div>
            <button type="button" onClick={() => setPreviewOpen(false)} className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-sm text-[#8ca3be]">
              Hide
            </button>
          </div>
          <iframe title="PDF preview mobile" src={`${previewUrl}#toolbar=1`} className="min-h-0 flex-1 w-full bg-[#0b1127]" />
        </div>
      )}

      {/* onboarding */}
      {showOnboard && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-3xl border border-white/[0.1] bg-[#0b1127] p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-sm font-black text-white">PP</div>
            <h3 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">Welcome to PaperPilot</h3>
            <ul className="mt-4 space-y-2 text-sm text-[#8ca3be]">
              <li>1. Upload up to <strong className="text-white">{MAX_DOCS} PDFs</strong></li>
              <li>2. Tap <strong className="text-white">View</strong> beside a file to preview</li>
              <li>3. Answers stream live with <strong className="text-white">source quotes</strong></li>
              <li>4. Edit a question · stop generation anytime</li>
            </ul>
            <button type="button" onClick={dismissOnboard} className="mt-6 w-full rounded-xl bg-gradient-to-r from-[#00d4aa] to-[#0ea5e9] py-3 text-sm font-semibold text-white">
              Got it — start asking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({
  msg,
  idx,
  streaming,
  canEdit,
  editing,
  editDraft,
  onEditDraft,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  msg: Message;
  idx: number;
  streaming?: boolean;
  canEdit?: boolean;
  editing?: boolean;
  editDraft?: string;
  onEditDraft?: (v: string) => void;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: () => void;
}) {
  const user = msg.role === "user";
  if (user) {
    return (
      <div className="animate-rise flex justify-end" style={{ animationDelay: `${Math.min(idx * 0.04, 0.2)}s` }}>
        <div className="group max-w-[85%] sm:max-w-[78%]">
          {editing ? (
            <div className="rounded-2xl border border-[#00d4aa]/40 bg-[#0f1e33] p-3">
              <textarea
                value={editDraft}
                onChange={(e) => onEditDraft?.(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={onCancelEdit} className="rounded-lg px-3 py-1.5 text-xs text-[#8ca3be]">Cancel</button>
                <button type="button" onClick={onSubmitEdit} className="rounded-lg bg-[#00d4aa] px-3 py-1.5 text-xs font-semibold text-[#06091a]">Resend</button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#1c3148] to-[#0f1e33] px-4 py-3 text-sm text-white/90 ring-1 ring-white/[0.07]">
                {msg.content}
              </div>
              {canEdit && (
                <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={onStartEdit} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#8ca3be]">
                    <I.edit /> Edit & resend
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (!msg.content && !streaming) return null;
  const { body, citations } = streaming
    ? { body: msg.content || "", citations: [] as ReturnType<typeof splitAnswerAndCitations>["citations"] }
    : splitAnswerAndCitations(msg.content || "");
  const showCitations = !streaming && citations.length > 0 && !(citations.length === 1 && citations[0].document.toLowerCase() === "none");

  return (
    <div className="animate-rise flex items-start gap-3" style={{ animationDelay: `${Math.min(idx * 0.04, 0.2)}s` }}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-[10px] font-black text-white">PP</div>
      <div className="group min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[rgba(16,24,40,0.8)] px-4 py-3.5 shadow-lg">
          {body || streaming ? (
            <div className="prose-ai">
              {body ? <ReactMarkdown>{body}</ReactMarkdown> : null}
              {!body && streaming && (
                <div className="flex gap-1.5">
                  <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
                </div>
              )}
            </div>
          ) : null}
          {streaming && body && <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-[#00d4aa]" />}
          {showCitations && (
            <div className="mt-3 border-t border-white/[0.08] pt-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#415570]">Sources</div>
              <div className="space-y-2">
                {citations.map((c, i) => (
                  <div key={`${c.document}-${i}`} className="rounded-xl border border-[#00d4aa]/15 bg-[#00d4aa]/5 px-3 py-2">
                    <div className="text-[11px] font-semibold text-[#00d4aa]">{c.document}</div>
                    <div className="mt-0.5 text-xs italic text-[#8ca3be]">“{c.quote}”</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {body && !streaming && (
          <div className="mt-1 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyBtn text={body} label="Copy answer" />
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-[10px] font-black text-white">PP</div>
      <div className="rounded-2xl border border-white/[0.08] bg-[rgba(16,24,40,0.8)] px-4 py-3.5">
        <div className="flex gap-1.5">
          <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
          <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
          <span className="typing-dot h-2 w-2 rounded-full bg-[#00d4aa]" />
        </div>
      </div>
    </div>
  );
}
