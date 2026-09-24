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
  newId,
  docPreviewBytes,
  saveChat,
  setActiveChatId,
  titleFromDocument,
  youtubeUrlsFromDocs,
} from "@/lib/chat-store";
import {
  exportChatMarkdown,
  exportChatText,
  formatBytes,
  shareChatText,
} from "@/lib/export";
import { splitAnswerAndCitations } from "@/lib/citations";
import { scoreAnswerGroundedness } from "@/lib/groundedness";
import type { GroundednessResult } from "@/lib/groundedness";
import {
  exportStudyNotes,
  exportStudyPackAnki,
  exportStudyPackMarkdown,
  flashcardsFromAnswer,
} from "@/lib/study-pack";
import { exportTrustReceipt } from "@/lib/trust-receipt";
import { bumpStudyActivity, getStudyStreak } from "@/lib/progress";
import { canAsk, getAskUsage, recordAsk } from "@/lib/rate-limit";
import {
  ACCEPTED_FILE_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  kindLabel,
  parseYouTubeUrl,
} from "@/lib/media";
import type { AskIntent } from "@/lib/lenses";
import {
  CLAIM_PROMPT_PREFIX,
  CONFLICT_PROMPT,
  DOC_MAP_PROMPT,
  BLIND_SPOT_PROMPT,
  TEACH_PROMPT,
  EXPLAIN_PROMPT,
  QUIZ_PROMPT,
} from "@/lib/lenses";
import type { AskScope } from "@/lib/scopes";
import { canSpeak, speakText, stopSpeaking } from "@/lib/speak";

/** Open YouTube search / URL in a new tab. Web apps cannot control other desktop apps. */
function tryOpenExternal(prompt: string): { opened: boolean; reply: string } | null {
  const text = prompt.trim();
  const ytSearch = text.match(
    /(?:open|go to|play|search|find)\s+(?:on\s+)?youtube(?:\s+and)?\s+(?:search(?:\s+for)?|for)?\s*(.+)$/i,
  );
  if (ytSearch?.[1]) {
    const q = ytSearch[1].replace(/["']/g, "").trim();
    if (q) {
      window.open(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
        "_blank",
        "noopener,noreferrer",
      );
      return {
        opened: true,
        reply: `Opened **YouTube search** for “${q}” in a new browser tab.\n\nBrowsers can’t control the YouTube desktop/mobile app for security — I can open links and searches for you instead.`,
      };
    }
  }
  if (/^(?:open\s+)?youtube\s*$/i.test(text) || /^open\s+youtube/i.test(text)) {
    window.open("https://www.youtube.com", "_blank", "noopener,noreferrer");
    return {
      opened: true,
      reply:
        "Opened **YouTube** in a new tab.\n\nI can’t click around inside YouTube or other apps from here — only open pages in your browser.",
    };
  }
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && /^(?:open|go to|visit)\b/i.test(text)) {
    window.open(urlMatch[0], "_blank", "noopener,noreferrer");
    return {
      opened: true,
      reply: `Opened this link in a new tab:\n${urlMatch[0]}`,
    };
  }
  return null;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [i: number]: { [j: number]: { transcript: string } } };
};

const I = {
  close: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  plus:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  send:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  file:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  menu:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  /** PaperPilot unique: folio panel fold (sidebar close) */
  folioIn: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <rect x="4" y="4" width="10" height="16" rx="2.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M14 7.5h4.5A1.5 1.5 0 0120 9v6a1.5 1.5 0 01-1.5 1.5H14" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M11 12H7.5M7.5 12l2-2M7.5 12l2 2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** PaperPilot unique: folio panel unfold (sidebar open) */
  folioOut: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <rect x="10" y="4" width="10" height="16" rx="2.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M10 7.5H5.5A1.5 1.5 0 004 9v6a1.5 1.5 0 001.5 1.5H10" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M13 12h3.5M16.5 12l-2-2M16.5 12l-2 2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
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
  link: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
  mic: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  cmd: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"/></svg>,
  speak: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>,
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const [sideOpen, setSideOpen] = useState(true);
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [findQuote, setFindQuote] = useState<string | null>(null);
  const [streak, setStreak] = useState({ count: 0, best: 0, quizzes: 0, claims: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const [, tx] = useTransition();

  const docs = useMemo(() => getDocuments(session), [session]);
  const previewDoc = docs.find((d) => d.id === previewDocId) ?? docs[0] ?? null;
  /** Auto: with a file → This chat; without → Open tutor (no mode pills). */
  const scope: AskScope = docs.length > 0 ? "docs" : "open";
  const canQuery = true;
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
    const bytes = previewDoc ? docPreviewBytes(previewDoc) : undefined;
    if (!bytes) return null;
    try {
      const raw = bytes;
      const arr = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer);
      if (!arr.byteLength) return null;
      const mime =
        previewDoc?.mimeType ||
        (previewDoc?.kind === "image" ? "image/png" : "application/pdf");
      return URL.createObjectURL(new Blob([arr], { type: mime }));
    } catch {
      return null;
    }
  }, [previewDoc]);

  function openAttachPicker() {
    if (docs.length >= MAX_DOCS) {
      setError(`Max ${MAX_DOCS} sources per chat. Remove one first.`);
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
        setStreak(getStudyStreak());
        try {
          if (localStorage.getItem("paperpilot-sidebar") === "0") setSideOpen(false);
        } catch {
          /* ignore */
        }
        if (!hasSeenOnboarding()) setShowOnboard(true);
      });
  }, [refresh]);

  function toggleSide() {
    setSideOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("paperpilot-sidebar", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    return () => {
      try {
        recogRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function toggleVoice() {
    const SR =
      typeof window !== "undefined"
        ? (window as unknown as {
            SpeechRecognition?: new () => SpeechRecognitionLike;
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).SpeechRecognition ||
          (window as unknown as {
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).webkitSpeechRecognition
        : undefined;
    if (!SR) {
      setError("Voice input needs Chrome/Edge on this device.");
      return;
    }
    if (listening) {
      try {
        recogRef.current?.stop();
      } catch {
        /* ignore */
      }
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    recogRef.current = rec;
    rec.onresult = (ev: SpeechRecognitionEventLike) => {
      let text = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      if (text.trim()) setQ(text.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
      setError(null);
    } catch {
      setError("Could not start microphone.");
      setListening(false);
    }
  }

  function findInSources(quote: string, documentHint?: string) {
    const needle = quote.trim();
    if (!needle) return;
    const pool = getDocuments(session);
    const named = documentHint
      ? pool.find((d) => d.name.toLowerCase().includes(documentHint.toLowerCase()))
      : undefined;
    const hit =
      named ||
      pool.find((d) => d.text && d.text.toLowerCase().includes(needle.toLowerCase().slice(0, 40))) ||
      pool[0];
    if (!hit) return;
    setPreviewDocId(hit.id);
    setFindQuote(needle);
    setPreviewOpen(true);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, asking]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setCmdQuery("");
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
      if (meta && e.key.toLowerCase() === "e" && session.messages.length) {
        e.preventDefault();
        setExportOpen(true);
      }
      if (meta && e.key.toLowerCase() === "p" && docs.length) {
        e.preventDefault();
        setPreviewOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setExportOpen(false);
        setNavOpen(false);
        setShowOnboard(false);
        setLinkOpen(false);
        setCmdOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.messages.length, docs.length]);

  useEffect(() => {
    if (!q && inputRef.current) inputRef.current.style.height = "auto";
  }, [q]);

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
      setError(`Max ${MAX_DOCS} sources per chat. Remove one first.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File is too large. Keep uploads under ${MAX_UPLOAD_LABEL}.`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fileBytes = (await file.arrayBuffer()).slice(0);
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Upload failed");

      const kind = d.kind || "pdf";
      const doc: DocumentMeta = {
        id: newId(),
        name: d.name,
        pages: d.pages ?? 1,
        text: d.text,
        kind,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes ?? file.size,
        charCount: d.charCount,
        preview: d.preview,
        fileBytes: kind === "pdf" || kind === "image" ? fileBytes : undefined,
        pdfBytes: kind === "pdf" ? fileBytes : undefined,
        usedOcr: Boolean(d.usedOcr),
      };

      const nextDocs = [...current, doc];
      const title =
        nextDocs.length === 1
          ? titleFromDocument(doc.name)
          : `${titleFromDocument(nextDocs[0].name)} +${nextDocs.length - 1}`;

      const ocrNote = d.usedOcr
        ? " · scanned pages · OCR (slow on passports/IDs — not your network)"
        : "";
      await save({
        ...session,
        title,
        documents: nextDocs,
        messages: [
          ...session.messages,
          {
            id: newId(),
            role: "assistant",
            content: `📎 **"${doc.name}"** added (${kindLabel(kind)}${doc.pages > 1 ? ` · ${doc.pages} pages` : ""} · ${formatBytes(doc.sizeBytes || file.size)}${ocrNote}).\n\nYou now have **${nextDocs.length}** source${nextDocs.length > 1 ? "s" : ""} in this chat. Ask anything about it.`,
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

  async function addYouTubeLink(rawUrl: string) {
    const current = getDocuments(session);
    if (current.length >= MAX_DOCS) {
      setError(`Max ${MAX_DOCS} sources per chat. Remove one first.`);
      return;
    }
    const canonical = parseYouTubeUrl(rawUrl);
    if (!canonical) {
      setError("Paste a public YouTube link (youtube.com or youtu.be).");
      return;
    }
    if (current.some((d) => d.sourceUrl === canonical)) {
      setError("That YouTube video is already in this chat.");
      return;
    }

    setError(null);
    setAddingLink(true);
    try {
      const r = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: canonical }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not add link");

      const doc: DocumentMeta = {
        id: newId(),
        name: d.name,
        pages: 1,
        text: d.text,
        kind: "youtube",
        mimeType: d.mimeType,
        sourceUrl: d.sourceUrl,
        sizeBytes: 0,
        charCount: d.text?.length,
        preview: d.preview,
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
            id: newId(),
            role: "assistant",
            content: `🎬 **YouTube added:** [${doc.name}](${doc.sourceUrl})\n\nAsk questions about this public video. Private/unlisted links will not work.`,
          },
        ],
      });
      setPreviewDocId(doc.id);
      setLinkDraft("");
      setLinkOpen(false);
      if (nextDocs.length >= 2) setCompareMode(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add link");
    } finally {
      setAddingLink(false);
    }
  }

  async function ask(
    raw: string,
    replaceFromUserId?: string,
    intent: AskIntent = "ask",
  ) {
    const currentDocs = getDocuments(session);
    if (!raw.trim() || asking) return;

    // Browser can open YouTube / URLs in a new tab — not control other apps
    const external = tryOpenExternal(raw.trim());
    if (external?.opened) {
      const um: Message = { id: newId(), role: "user", content: raw.trim() };
      const am: Message = { id: newId(), role: "assistant", content: external.reply };
      const next: ChatSession = {
        ...session,
        documents: currentDocs,
        messages: [...session.messages, um, am],
      };
      setQ("");
      setError(null);
      await save(next);
      return;
    }

    const quota = canAsk();
    if (!quota.ok) {
      setError(`Daily demo limit reached (${quota.limit} asks). Try again tomorrow.`);
      return;
    }

    const documentText =
      scope === "docs" ? combinedDocumentText(currentDocs) : "";
    const documentName =
      scope === "docs" ? documentNames(currentDocs) : "Open tutor";
    const youtubeUrls =
      scope === "docs" ? youtubeUrlsFromDocs(currentDocs) : [];
    const compare = scope === "docs" && compareMode && currentDocs.length >= 2;

    const question = raw.trim();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let baseMessages = session.messages;
    if (replaceFromUserId) {
      const idx = baseMessages.findIndex((m) => m.id === replaceFromUserId);
      if (idx >= 0) baseMessages = baseMessages.slice(0, idx);
    }

    const um: Message = { id: newId(), role: "user", content: question };
    const assistantId = newId();
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

    const history = baseMessages
      .filter((m) => m.content.trim())
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          documentText,
          documentName,
          compareMode: compare,
          youtubeUrls,
          lens: "normal",
          intent,
          history,
          scope,
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

      setAskUsage(recordAsk());
      setStreak(bumpStudyActivity(intent === "quiz" ? "quiz" : intent === "claim" ? "claim" : "ask"));
      const titled =
        next.title === "New chat" || next.title.startsWith("Chat")
          ? question.slice(0, 48) + (question.length > 48 ? "…" : "")
          : next.title;
      await save({
        ...next,
        title: titled,
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
    if (!doc) return;

    if (doc.kind === "youtube" && doc.sourceUrl) {
      window.open(doc.sourceUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (doc.kind === "text" || doc.kind === "docx") {
      setPreviewDocId(docId);
      setPreviewOpen(true);
      return;
    }

    if (!docPreviewBytes(doc)) {
      setError("Preview needs a fresh upload for this file. Re-add it, then tap View.");
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
          id: newId(),
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
      <div className="app-mesh flex min-h-full items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="animate-glow h-14 w-14 rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] p-px">
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
    <div className="app-mesh app-grain relative flex h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="animate-drift absolute -left-64 -top-64 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(0,212,170,0.08),transparent_65%)]" />
        <div
          className="animate-drift absolute -right-48 top-1/3 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.07),transparent_65%)]"
          style={{ animationDelay: "3s" }}
        />
      </div>

      {navOpen && (
        <button aria-label="Close" className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />
      )}

      {/* sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col transition-all duration-300 ease-out lg:relative ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          sideOpen
            ? "lg:w-72 lg:translate-x-0"
            : "lg:pointer-events-none lg:w-0 lg:-translate-x-full lg:overflow-hidden lg:opacity-0"
        }`}
      >
        <div className="absolute inset-0 border-r border-white/[0.06] bg-[rgba(11,17,39,0.85)] backdrop-blur-2xl" />
        <div className="relative flex h-full w-72 flex-col">
          <div className="flex items-center justify-between px-5 pb-4 pt-5">
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] shadow-[0_0_20px_rgba(0,212,170,0.2)]">
                <span className="text-[11px] font-black text-white">PP</span>
              </div>
              <div className="min-w-0 leading-tight">
                <span className="block font-[family-name:var(--font-display)] text-[15px] font-semibold text-white">PaperPilot</span>
                <span className="text-[10px] font-medium tracking-wide text-[#415570]">Truth Tutor</span>
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleSide}
                title="Close chats panel"
                aria-label="Close sidebar"
                className="hidden h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa] lg:flex"
              >
                <I.folioIn />
              </button>
              <button type="button" onClick={() => setNavOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#415570] hover:bg-white/[0.06] lg:hidden"><I.close /></button>
            </div>
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
                          <div className="mt-0.5 text-[11px] text-[#415570]">{count} file · {chat.messages.length} msg</div>
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
            {streak.count > 0 && (
              <span className="mt-1 block text-[10px] text-[#415570]">
                Today’s tutoring: {streak.count} · best {streak.best}
                {streak.quizzes ? ` · ${streak.quizzes} quizzes` : ""}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* main */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="relative z-50 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[rgba(6,9,26,0.8)] px-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#415570] lg:hidden"
            aria-label="Open menu"
          >
            <I.menu />
          </button>
          {!sideOpen && (
            <button
              type="button"
              onClick={toggleSide}
              title="Open chat list"
              aria-label="Open sidebar"
              className="hidden items-center gap-1.5 rounded-xl border border-[#00d4aa]/30 bg-[#00d4aa]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[#00d4aa] transition hover:border-[#00d4aa]/55 lg:flex"
            >
              <I.folioOut />
              <span>Chats</span>
            </button>
          )}
          <div className="min-w-0 flex-1 truncate">
            <div className="truncate text-sm font-semibold text-white/90">
              {session.title || "PaperPilot"}
            </div>
            {docs.length > 0 ? (
              <div className="truncate text-[11px] text-[#415570]">
                {docs.length} file{docs.length > 1 ? "s" : ""}
                {compareMode && docs.length >= 2 ? " · Compare ON" : ""}
              </div>
            ) : null}
          </div>
          <div className="relative z-50 flex items-center gap-2">
            {docs.length > 0 && previewOpen && (
              <button type="button" onClick={() => setPreviewOpen(false)} className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] font-semibold text-[#8ca3be] hover:text-[#00d4aa]" title="Ctrl+P">
                <I.eye /><span className="hidden sm:inline">Hide preview</span>
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
            {/* compact sources strip — uploads live in the composer (+ / link) */}
            <div className="shrink-0 border-b border-white/[0.06] px-4 py-2 sm:px-6">
              {uploading && (
                <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border border-[#00d4aa]/20 bg-[#00d4aa]/5 px-3 py-2 text-sm text-[#8ca3be]">
                  <Spinner /><span>Reading file… scanned PDFs use OCR and can take 30–90s (local work, not usually your Wi‑Fi).</span>
                </div>
              )}
              {docs.length > 0 && (
                <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className={`flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 ${
                        previewOpen && previewDocId === doc.id
                          ? "border-[#00d4aa]/40 bg-[#00d4aa]/10"
                          : "border-white/[0.08] bg-white/[0.03]"
                      }`}
                    >
                      <span className="truncate text-[11px] font-semibold text-white">{doc.name}</span>
                      <button type="button" onClick={() => viewAttachment(doc.id)} className="text-[10px] text-[#00d4aa]">
                        {doc.kind === "youtube" ? "Open" : "View"}
                      </button>
                      <button type="button" onClick={() => removeDoc(doc.id)} className="text-[10px] text-[#415570] hover:text-red-400">
                        ×
                      </button>
                    </div>
                  ))}
                  {docs.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => setCompareMode((v) => !v)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        compareMode ? "bg-[#3b82f6] text-white" : "border border-white/10 text-[#8ca3be]"
                      }`}
                    >
                      Compare {compareMode ? "ON" : "OFF"}
                    </button>
                  )}
                </div>
              )}

              {linkOpen && (
                <div className="mx-auto mt-2 flex max-w-2xl flex-col gap-2 rounded-2xl border border-white/[0.1] bg-[#0b1127] p-3 sm:flex-row sm:items-center">
                  <input
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addYouTubeLink(linkDraft);
                      }
                    }}
                    placeholder="https://youtube.com/watch?v=…"
                    className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-[#415570] focus:border-[#00d4aa]/40"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void addYouTubeLink(linkDraft)}
                      disabled={addingLink || !linkDraft.trim()}
                      className="rounded-xl bg-[#00d4aa] px-3 py-2 text-xs font-semibold text-[#06091a] disabled:opacity-40"
                    >
                      {addingLink ? "Adding…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLinkOpen(false); setLinkDraft(""); }}
                      className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-[#8ca3be]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="mx-auto mt-2 flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  <I.warn /><span className="flex-1">{error}</span>
                  {lastQuestion && (
                    <button type="button" onClick={() => ask(lastQuestion)} className="flex items-center gap-1 rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20">
                      <I.refresh /> Retry
                    </button>
                  )}
                </div>
              )}
              {/* keep file input available for empty-state Upload button */}
              <input ref={fileRef} type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" disabled={uploading || asking} onChange={(e) => upload(e.target.files?.[0])} />
            </div>

            <div className="scroll-y min-h-0 flex-1 px-4 py-6 sm:px-6">
              {session.messages.length === 0 ? (
                <div className="stage-empty">
                  <div className="stage-folios" aria-hidden>
                    <div className="stage-folio" />
                    <div className="stage-folio" />
                    <div className="stage-folio" />
                  </div>
                  <p className="stage-kicker">Document intelligence</p>
                  <h2 className="stage-title">PaperPilot</h2>
                  <div className="stage-rule" aria-hidden />
                  <p className="stage-lede">
                    Ask with a source attached, or start open. Answers cite what you gave — nothing invented from thin air.
                  </p>
                  <div className="stage-actions">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading || asking || docs.length >= MAX_DOCS}
                      className="stage-action"
                    >
                      <strong>PDF / file</strong>
                      <span>Upload a document</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading || asking || docs.length >= MAX_DOCS}
                      className="stage-action"
                    >
                      <strong>Image</strong>
                      <span>Screenshot or scan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (docs.length >= MAX_DOCS) {
                          setError(`Max ${MAX_DOCS} sources per chat. Remove one first.`);
                          return;
                        }
                        setLinkOpen(true);
                      }}
                      disabled={uploading || asking || docs.length >= MAX_DOCS}
                      className="stage-action"
                    >
                      <strong>YouTube</strong>
                      <span>Paste a video link</span>
                    </button>
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
                        onAskNext={(prompt) => ask(prompt)}
                        documentText={combinedDocumentText(docs)}
                        chatTitle={session.title}
                        onFindQuote={findInSources}
                        documentNames={documentNames(docs)}
                        priorUserQuestion={
                          i > 0 && session.messages[i - 1]?.role === "user"
                            ? session.messages[i - 1].content
                            : ""
                        }
                      />
                    );
                  })}
                  <div ref={endRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-white/[0.06] bg-[rgba(6,9,26,0.88)] px-3 py-3.5 backdrop-blur-xl sm:px-6 sm:py-4">
              <div className="composer-dock">
                <div className="composer-meta">
                  <span>
                    {docs.length > 0 ? (
                      <>
                        Grounded on <strong>{docs.length} source{docs.length > 1 ? "s" : ""}</strong>
                      </>
                    ) : (
                      <>No source yet — answers stay general</>
                    )}
                  </span>
                  <span className="hidden sm:inline">Enter to send · Shift+Enter for line</span>
                </div>
                <form
                  onSubmit={(e) => { e.preventDefault(); ask(q); }}
                  className="composer-desk"
                >
                  <div className="composer-tools" aria-label="Attach sources">
                    <button
                      type="button"
                      onClick={openAttachPicker}
                      disabled={uploading || asking || docs.length >= MAX_DOCS}
                      title={docs.length ? "Add another file" : "Upload file"}
                      className="composer-tool"
                    >
                      <I.plus />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (docs.length >= MAX_DOCS) {
                          setError(`Max ${MAX_DOCS} sources per chat. Remove one first.`);
                          return;
                        }
                        setLinkOpen(true);
                      }}
                      disabled={uploading || asking || docs.length >= MAX_DOCS}
                      title="Add YouTube link"
                      className="composer-tool"
                    >
                      <I.link />
                    </button>
                    <input
                      ref={attachRef}
                      type="file"
                      accept={ACCEPTED_FILE_TYPES}
                      className="hidden"
                      disabled={uploading || asking}
                      onChange={(e) => upload(e.target.files?.[0])}
                    />
                  </div>

                  <div className="composer-divider" aria-hidden />

                  <div className="composer-field">
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        const el = e.target;
                        el.style.height = "auto";
                        el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          ask(q);
                        }
                      }}
                      disabled={!canQuery || asking}
                      placeholder={
                        docs.length > 0
                          ? compareMode && docs.length >= 2
                            ? "Ask across your documents…"
                            : "Ask about this source…"
                          : "Ask a question…"
                      }
                      className="composer-input"
                    />
                  </div>

                  <div className="composer-tools">
                    <button
                      type="button"
                      onClick={toggleVoice}
                      disabled={!canQuery || asking}
                      title={listening ? "Stop listening" : "Voice ask"}
                      className={`composer-tool ${listening ? "is-live" : ""}`}
                    >
                      <I.mic />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCmdOpen(true); setCmdQuery(""); }}
                      title="Command palette (Ctrl+K)"
                      className="composer-tool"
                    >
                      <I.cmd />
                    </button>
                  </div>

                  <button
                    type={asking ? "button" : "submit"}
                    onClick={asking ? stopGenerating : undefined}
                    disabled={!asking && (!canQuery || !q.trim())}
                    title={asking ? "Stop generating" : "Send"}
                    className={`composer-send ${asking ? "is-stop" : ""}`}
                  >
                    {asking ? <I.stop /> : <I.send />}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Source preview — desktop side panel */}
          {previewOpen && previewDoc && (previewUrl || previewDoc.kind === "text" || previewDoc.kind === "docx") && (
            <aside className="hidden min-h-0 w-[42%] min-w-[320px] max-w-[520px] flex-col border-l border-white/[0.06] bg-[rgba(11,17,39,0.85)] lg:flex">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{previewDoc.name}</div>
                  <div className="text-[11px] text-[#415570]">{kindLabel(previewDoc.kind)} preview</div>
                </div>
                <button type="button" onClick={() => { setPreviewOpen(false); setFindQuote(null); }} className="rounded-lg p-1.5 text-[#415570] hover:text-white"><I.close /></button>
              </div>
              <PreviewBody doc={previewDoc} url={previewUrl} highlight={findQuote} />
            </aside>
          )}
        </div>
      </div>

      {/* Source preview — mobile / tablet overlay */}
      {previewOpen && previewDoc && (previewUrl || previewDoc.kind === "text" || previewDoc.kind === "docx") && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-[#06091a] lg:hidden">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{previewDoc.name}</div>
              <div className="text-[11px] text-[#415570]">{kindLabel(previewDoc.kind)} preview{findQuote ? " · quote find" : ""}</div>
            </div>
            <button type="button" onClick={() => { setPreviewOpen(false); setFindQuote(null); }} className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-sm text-[#8ca3be]">
              Hide
            </button>
          </div>
          <PreviewBody doc={previewDoc} url={previewUrl} highlight={findQuote} />
        </div>
      )}

      {/* command palette */}
      {cmdOpen && (
        <CommandPalette
          query={cmdQuery}
          onQuery={setCmdQuery}
          onClose={() => setCmdOpen(false)}
          actions={[
            { id: "new", label: "New chat", hint: "Ctrl+N", run: () => { newChat(); setCmdOpen(false); } },
            { id: "export", label: "Export chat", hint: "Ctrl+E", run: () => { setExportOpen(true); setCmdOpen(false); }, disabled: !session.messages.length },
            { id: "preview", label: previewOpen ? "Hide preview" : "Show preview", hint: "Ctrl+P", run: () => { setPreviewOpen((v) => !v); setCmdOpen(false); }, disabled: !docs.length },
            { id: "explain", label: "Explain simply", run: () => { ask(EXPLAIN_PROMPT, undefined, "explain"); setCmdOpen(false); }, disabled: !docs.length || asking },
            { id: "teach", label: "Teach me (lesson)", run: () => { ask(TEACH_PROMPT, undefined, "teach"); setCmdOpen(false); }, disabled: !docs.length || asking },
            { id: "quiz", label: "Quiz me", run: () => { ask(QUIZ_PROMPT, undefined, "quiz"); setCmdOpen(false); }, disabled: (!docs.length && scope === "docs") || asking },
            { id: "map", label: "Document map", run: () => { ask(DOC_MAP_PROMPT, undefined, "map"); setCmdOpen(false); }, disabled: !docs.length || asking },
            { id: "blind", label: "Find blind spots", run: () => { ask(BLIND_SPOT_PROMPT, undefined, "blind"); setCmdOpen(false); }, disabled: !docs.length || asking },
            { id: "conflict", label: "Conflict scan", run: () => { ask(CONFLICT_PROMPT, undefined, "conflict"); setCmdOpen(false); }, disabled: docs.length < 2 || asking },
            { id: "claim", label: "Check claim (from input box)", run: () => {
              const claim = q.trim();
              if (!claim) { setError("Type a claim first."); setCmdOpen(false); return; }
              ask(`${CLAIM_PROMPT_PREFIX}${claim}`, undefined, "claim");
              setCmdOpen(false);
            }, disabled: !docs.length || asking },
          ]}
        />
      )}

      {/* onboarding */}
      {showOnboard && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-3xl border border-white/[0.1] bg-[#0b1127] p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-sm font-black text-white">PP</div>
            <h3 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">PaperPilot is ready</h3>
            <ul className="mt-4 space-y-2 text-sm text-[#8ca3be]">
              <li>1. Type a question and press Enter — no file needed</li>
              <li>2. Use <strong className="text-white">+</strong> to attach a PDF/image, or the link icon for YouTube</li>
              <li>3. Say <strong className="text-white">“open YouTube and search …”</strong> to open a new tab</li>
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

function CommandPalette({
  query,
  onQuery,
  onClose,
  actions,
}: {
  query: string;
  onQuery: (v: string) => void;
  onClose: () => void;
  actions: { id: string; label: string; hint?: string; run: () => void; disabled?: boolean }[];
}) {
  const filtered = actions.filter(
    (a) => !query.trim() || a.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-rise w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b1127] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2.5">
          <I.search />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0] && !filtered[0].disabled) {
                e.preventDefault();
                filtered[0].run();
              }
            }}
            placeholder="Jump to a command…"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#415570]"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-[#415570]">Esc</kbd>
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[#415570]">No matching commands</div>
          )}
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled}
              onClick={() => a.run()}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-[#8ca3be] hover:bg-white/[0.04] hover:text-white disabled:opacity-40"
            >
              <span className="flex-1">{a.label}</span>
              {a.hint && <span className="text-[10px] text-[#415570]">{a.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroundBadge({ g }: { g: GroundednessResult }) {
  const color =
    g.level === "high"
      ? "border-[#00d4aa]/40 bg-[#00d4aa]/10 text-[#00d4aa]"
      : g.level === "medium"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : g.level === "low" || g.level === "none"
          ? "border-red-400/30 bg-red-500/10 text-red-300"
          : "border-white/10 bg-white/[0.04] text-[#8ca3be]";
  return (
    <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${color}`} title={g.detail}>
      <span className="text-[10px] font-semibold uppercase tracking-wider">Truth meter</span>
      <span className="text-xs font-semibold">{g.label}</span>
      <span className="text-[11px] opacity-80">{g.detail}</span>
    </div>
  );
}

function PreviewBody({
  doc,
  url,
  highlight,
}: {
  doc: DocumentMeta;
  url: string | null;
  highlight?: string | null;
}) {
  if (doc.kind === "image" && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={doc.name} className="min-h-0 flex-1 object-contain bg-[#0b1127] p-4" />
    );
  }
  if ((doc.kind === "text" || doc.kind === "docx") && doc.text) {
    const text = doc.text.slice(0, 20000);
    const needle = highlight?.trim();
    if (needle && needle.length >= 4) {
      const idx = text.toLowerCase().indexOf(needle.toLowerCase().slice(0, 80));
      if (idx >= 0) {
        const end = idx + Math.min(needle.length, 80);
        const before = text.slice(0, idx);
        const mid = text.slice(idx, end);
        const after = text.slice(end);
        return (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[#0b1127] p-4 text-xs leading-relaxed text-[#8ca3be]">
            {before}
            <mark className="rounded bg-[#00d4aa]/35 px-0.5 text-white">{mid}</mark>
            {after}
          </pre>
        );
      }
    }
    return (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[#0b1127] p-4 text-xs leading-relaxed text-[#8ca3be]">
        {text}
        {needle && (
          <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-[11px] text-amber-100">
            Quote not found in text preview (try PDF View or a shorter phrase).
          </div>
        )}
      </pre>
    );
  }
  if (url) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {highlight && (
          <div className="border-b border-white/[0.08] bg-[#00d4aa]/10 px-3 py-2 text-[11px] text-[#8ca3be]">
            Looking for: <span className="italic text-white">“{highlight.slice(0, 120)}”</span>
            <span className="ml-1 text-[#415570]">(use browser find in PDF)</span>
          </div>
        )}
        <iframe title="File preview" src={`${url}#toolbar=1`} className="min-h-0 flex-1 w-full bg-[#0b1127]" />
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-[#415570]">
      No preview available
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
  onAskNext,
  documentText,
  chatTitle,
  onFindQuote,
  documentNames: docNames,
  priorUserQuestion,
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
  onAskNext?: (prompt: string) => void;
  documentText?: string;
  chatTitle?: string;
  onFindQuote?: (quote: string, documentHint?: string) => void;
  documentNames?: string;
  priorUserQuestion?: string;
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
  const { body, citations, doNext, confidence } = streaming
    ? {
        body: msg.content || "",
        citations: [] as ReturnType<typeof splitAnswerAndCitations>["citations"],
        doNext: null as ReturnType<typeof splitAnswerAndCitations>["doNext"],
        confidence: null as ReturnType<typeof splitAnswerAndCitations>["confidence"],
      }
    : splitAnswerAndCitations(msg.content || "");
  const showCitations =
    !streaming &&
    citations.length > 0 &&
    !(citations.length === 1 && citations[0].document.toLowerCase() === "none") &&
    !citations.every((c) =>
      /world knowledge|general tutoring|not from an uploaded|not a file quote/i.test(
        `${c.document} ${c.quote}`,
      ),
    );
  const isStatusNote =
    /^📎/.test(msg.content || "") ||
    /\*\*".+"\*\* added \(/.test(msg.content || "") ||
    /Opened \*\*/.test(msg.content || "");
  const hasDocText = Boolean(documentText?.trim());
  const grounded =
    !streaming && msg.content && !isStatusNote && showCitations && hasDocText
      ? scoreAnswerGroundedness(msg.content, documentText || "")
      : null;
  const cards =
    !streaming && msg.content && !isStatusNote && (doNext || showCitations)
      ? flashcardsFromAnswer(msg.content, chatTitle || "Document")
      : [];
  // Hide structured extras on tiny/casual replies
  const showExtras =
    !streaming &&
    !isStatusNote &&
    (body?.trim().length || 0) > 180 &&
    Boolean(doNext || showCitations || confidence);

  return (
    <div className="animate-rise flex items-start gap-3" style={{ animationDelay: `${Math.min(idx * 0.04, 0.2)}s` }}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-[10px] font-black text-white">PP</div>
      <div className="group min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[rgba(16,24,40,0.88)] px-4 py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.25)] ring-1 ring-white/[0.03] break-words">
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
          {!streaming && grounded && grounded.total > 0 && <GroundBadge g={grounded} />}
          {showExtras && confidence && hasDocText && (
            <div className="mt-2 text-[11px] text-[#415570]">
              Model confidence:{" "}
              <span
                className={
                  confidence === "high"
                    ? "font-semibold text-[#00d4aa]"
                    : confidence === "medium"
                      ? "font-semibold text-amber-200"
                      : "font-semibold text-red-300"
                }
              >
                {confidence}
              </span>
            </div>
          )}
          {showExtras && doNext && (
            <div className="mt-3 space-y-3 border-t border-white/[0.08] pt-3">
              {doNext.keyPoints.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#415570]">Key points</div>
                  <ul className="space-y-1 text-sm text-[#8ca3be]">
                    {doNext.keyPoints.map((p) => (
                      <li key={p} className="flex gap-2">
                        <span className="text-[#00d4aa]">•</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {doNext.askNext.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#415570]">Ask next</div>
                  <div className="flex flex-wrap gap-1.5">
                    {doNext.askNext.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onAskNext?.(q)}
                        className="rounded-full border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-left text-[11px] text-[#8ca3be] hover:border-[#00d4aa]/40 hover:text-[#00d4aa]"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {doNext.actions.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#415570]">Actions</div>
                  <ul className="space-y-1 text-sm text-[#8ca3be]">
                    {doNext.actions.map((a) => (
                      <li key={a} className="flex gap-2">
                        <span className="text-[#3b82f6]">→</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {showExtras && showCitations && (
            <div className="mt-3 border-t border-white/[0.08] pt-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#415570]">Sources</div>
              <div className="space-y-2">
                {citations.map((c, i) => (
                  <div key={`${c.document}-${i}`} className="rounded-xl border border-[#00d4aa]/15 bg-[#00d4aa]/5 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[11px] font-semibold text-[#00d4aa]">{c.document}</div>
                      {c.document.toLowerCase() !== "none" && (
                        <button
                          type="button"
                          onClick={() => onFindQuote?.(c.quote, c.document)}
                          className="shrink-0 text-[10px] font-semibold text-[#8ca3be] hover:text-[#00d4aa]"
                        >
                          Find
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs italic text-[#8ca3be]">“{c.quote}”</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {body && !streaming && !isStatusNote && (
          <div className="mt-1 flex flex-wrap gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyBtn text={body} label="Copy answer" />
            {canSpeak() && (
              <button
                type="button"
                onClick={() => {
                  stopSpeaking();
                  speakText(body);
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#00d4aa]"
              >
                <I.speak /> Speak
              </button>
            )}
            {cards.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => exportStudyPackMarkdown(cards, chatTitle || "study")}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#00d4aa]"
                >
                  <I.download /> Flashcards
                </button>
                <button
                  type="button"
                  onClick={() => exportStudyPackAnki(cards, chatTitle || "study")}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#00d4aa]"
                >
                  Anki TSV
                </button>
              </>
            )}
            {msg.content && (
              <button
                type="button"
                onClick={() => exportStudyNotes(msg.content, chatTitle || "notes")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#00d4aa]"
              >
                Notes.md
              </button>
            )}
            {msg.content && (
              <button
                type="button"
                onClick={() =>
                  exportTrustReceipt({
                    title: chatTitle || "PaperPilot",
                    question: priorUserQuestion || "",
                    answer: msg.content,
                    documentNames: docNames || "sources",
                    documentText: documentText || "",
                  })
                }
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#00d4aa]"
              >
                Trust receipt
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
