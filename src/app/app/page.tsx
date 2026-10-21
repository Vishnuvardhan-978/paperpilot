"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type AgentRunView,
  type AgentStepView,
  ChatSession,
  DocumentMeta,
  MAX_DOCS,
  Message,
  type MediaView,
  clearActiveChatId,
  combinedDocumentText,
  createEmptySession,
  deleteChat,
  documentNames,
  getActiveChatId,
  getChat,
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
  type AgentResume,
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
import { addCards } from "@/lib/learning";
import { TOOL_GROUPS, groupForTool, policyForTool, setToolPolicy } from "@/lib/agent-permissions";
import { PdfQuoteViewer } from "@/components/pdf-quote-viewer";
import { GitPanel } from "@/components/git-panel";
import { getParentSettings, logKidQuestion } from "@/lib/parental";
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
import {
  FILE_WRITING_TOOLS,
  MAX_AGENT_STEPS,
  describeToolCall,
  toolResultError,
  type AgentToolCall,
} from "@/lib/agent-tools";
import { runLocalAgentTool } from "@/lib/run-agent-tool";
import { compactOldToolResults, lastThought, streamAgentStep, type AgentStepRequest } from "@/lib/agent-stream";
import type { AgentContent } from "@/lib/gemini";
import {
  changeStats,
  recordAgentChange,
  revertAgentChange,
  samePath,
  type AgentChange,
} from "@/lib/agent-changes";
import { CodeDiff, CodeEditor } from "@/components/code-editor";
import { TerminalPanel, type TerminalEntry } from "@/components/terminal-panel";
import { AgentReply } from "@/components/agent-reply";
import { MediaCard } from "@/components/media-card";
import { parseMediaRequest, type MediaRequest } from "@/lib/media-intent";
import { FileIcon, QuickOpen, SearchPanel, Splitter, useStoredWidth } from "@/components/workspace-ui";
import {
  directWorkspaceHint,
  directWorkspaceRoot,
  encodeDirectWorkspace,
  isDirectWorkspaceText,
  parseDirectWorkspace,
} from "@/lib/workspace-direct";
import {
  buildWorkspaceTree,
  getWorkspaceFile,
  parseWorkspaceFiles,
  prioritizeWorkspaceFile,
  replaceWorkspaceFileContent,
  type TreeNode,
} from "@/lib/workspace-files";
import {
  agentExec,
  agentPickFolder,
  agentReadFile,
  agentRestoreBackup,
  agentSetWorkspace,
  agentTree,
  agentWriteFile,
  checkLocalAgent,
  inferApplyPath,
  stripPathComment,
} from "@/lib/local-agent";
import { diffStats, lineDiff } from "@/lib/line-diff";
import { extractProposedPatches, type ProposedPatch } from "@/lib/proposed-patches";
import { planFileEdit } from "@/lib/apply-edit";
/** Open YouTube search / URL in a new tab. Web apps cannot control other desktop apps. */
/** Messages that pick up a paused or stopped agent run. */
const RESUME_WORDS = /^\s*(continue|resume|keep going|go on)\b/i;

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
  folder: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4"><path d="M3 6.5A2.5 2.5 0 015.5 4H10l2 2h6.5A2.5 2.5 0 0121 8.5v8A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-10z"/><path d="M3 9h18"/></svg>,
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
  const folderRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession>(() => createEmptySession());
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
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
  const [workspaceFocusPath, setWorkspaceFocusPath] = useState<string | null>(null);
  const [pendingPatch, setPendingPatch] = useState<ProposedPatch | null>(null);
  const [patchSourceMsgId, setPatchSourceMsgId] = useState<string | null>(null);
  const [agentOnline, setAgentOnline] = useState(false);
  const [fileEpoch, setFileEpoch] = useState(0);
  const [reviewPath, setReviewPath] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLog, setTerminalLog] = useState<TerminalEntry[]>([]);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatWidth, setChatWidth] = useStoredWidth("paperpilot-ide-chat", 420);
  const chatDragStart = useRef(0);
  const [streak, setStreak] = useState({ count: 0, best: 0, quizzes: 0, claims: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const [permissionAsk, setPermissionAsk] = useState<{ verb: string; target: string; group: string; detail: string } | null>(null);
  const permissionResolve = useRef<((ok: boolean) => void) | null>(null);
  const resumeRef = useRef<AgentResume | null>(null);
  /** Full traces of this session's agent runs (kept in memory only), for 👍/👎 training examples. */
  const agentTraces = useRef(new Map<string, { chatId: string; trace: Omit<AgentStepRequest, "turns"> & { turns: AgentContent[] } }>());
  const [rateableRuns, setRateableRuns] = useState<ReadonlySet<string>>(() => new Set());
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const [, tx] = useTransition();
  const router = useRouter();

  const docs = useMemo(() => getDocuments(session), [session]);
  const hasWorkspace = docs.some((d) => d.kind === "workspace");
  const workspaceDoc = docs.find((d) => d.kind === "workspace") ?? null;
  const previewDoc = docs.find((d) => d.id === previewDocId) ?? docs[0] ?? null;
  const ideLayout = Boolean(
    previewOpen &&
      previewDoc?.kind === "workspace" &&
      previewDoc.text &&
      isDirectWorkspaceText(previewDoc.text),
  );
  const agentChanges = useMemo(() => session.agentChanges ?? [], [session.agentChanges]);
  const pendingChanges = agentChanges.filter((c) => c.status === "pending");
  const workspaceRoot = directWorkspaceRoot(workspaceDoc?.text);
  const projectChats = useMemo(
    () =>
      workspaceRoot
        ? sessions.filter((chat) =>
            getDocuments(chat).some(
              (d) => d.kind === "workspace" && directWorkspaceRoot(d.text)?.toLowerCase() === workspaceRoot.toLowerCase(),
            ),
          )
        : [],
    [sessions, workspaceRoot],
  );
  const ideProps: IdeProps = {
    fileEpoch,
    changes: agentChanges,
    reviewPath,
    onOpenChange: openChangeInEditor,
    onCloseReview: () => setReviewPath(null),
    onSetChangeStatus: (paths, status) => void setChangeStatus(paths, status),
    onRestoreBackup: (p) => void restoreFromBackup(p),
    onSaveFile: saveFileManually,
    terminal: {
      open: terminalOpen,
      entries: terminalLog,
      busy: terminalBusy,
      onRun: (cmd) => void runTerminalCommand(cmd),
      onClear: () => setTerminalLog([]),
      onToggle: () => setTerminalOpen((v) => !v),
    },
  };
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
    let cancelled = false;
    queueMicrotask(() => {
      refresh()
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
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
    });
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    let alive = true;
    if (!hasWorkspace) {
      queueMicrotask(() => {
        if (alive) setAgentOnline(false);
      });
      return () => {
        alive = false;
      };
    }
    const ping = () => {
      void checkLocalAgent().then(async (h) => {
        if (!alive) return;
        setAgentOnline(h.ok);
        // The agent restarts in its own cwd; point it back at this chat's project.
        if (!h.ok || !workspaceRoot || h.workspace?.toLowerCase() === workspaceRoot.toLowerCase()) return;
        try {
          await agentSetWorkspace(workspaceRoot);
          if (alive) setFileEpoch((n) => n + 1);
        } catch {
          if (alive) setError(`Project folder not found on this machine: ${workspaceRoot}`);
        }
      });
    };
    ping();
    const id = window.setInterval(ping, 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hasWorkspace, workspaceRoot]);

  useEffect(() => {
    if (!hasWorkspace || asking) return;
    const last = [...session.messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
    if (!last || last.id === patchSourceMsgId) return;
    const patches = extractProposedPatches(last.content);
    if (!patches.length) return;
    const preferred =
      (workspaceFocusPath &&
        patches.find(
          (p) => p.path.replace(/\\/g, "/").toLowerCase() === workspaceFocusPath.replace(/\\/g, "/").toLowerCase(),
        )) ||
      patches[0];
    queueMicrotask(() => {
      setPendingPatch(preferred);
      setPatchSourceMsgId(last.id);
      setWorkspaceFocusPath(preferred.path);
      setPreviewOpen(true);
      if (workspaceDoc) setPreviewDocId(workspaceDoc.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, session.messages.length, hasWorkspace]);

  async function acceptPendingPatch() {
    if (!pendingPatch) return;
    const target = pendingPatch.path;
    const health = await checkLocalAgent();
    if (!health.ok) {
      setError(health.error || "Local agent offline. Run: npm run agent");
      return;
    }
    let before = "";
    try {
      before = (await agentReadFile(target)).text;
    } catch {
      before = workspaceDoc?.text ? getWorkspaceFile(workspaceDoc.text, target)?.content || "" : "";
    }
    const plan = planFileEdit(before, pendingPatch.text);
    if (plan.warning && plan.nextText === before) {
      setError(plan.warning);
      return;
    }
    const full = `${health.workspace}\\${target.replace(/\//g, "\\")}`;
    const ok = window.confirm(
      `Apply proposed edit to disk?\n\n${full}${plan.mode === "snippet-merge" ? "\n\n(Snippet will be merged into the existing file.)" : ""}`,
    );
    if (!ok) return;
    try {
      await agentWriteFile(target, plan.nextText);
      await syncWorkspaceFileAfterApply(target, plan.nextText);
      setPendingPatch(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    }
  }

  function rejectPendingPatch() {
    setPendingPatch(null);
  }

  async function setChangeStatus(paths: string[], status: AgentChange["status"]) {
    const list = session.agentChanges ?? [];
    const targets = list.filter((c) => paths.some((p) => samePath(p, c.path)) && c.status !== status);
    if (!targets.length) return;
    if (status === "reverted") {
      try {
        for (const change of targets) await revertAgentChange(change);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not restore file");
        return;
      }
      setFileEpoch((n) => n + 1);
    }
    await save({
      ...session,
      agentChanges: list.map((c) => (targets.includes(c) ? { ...c, status } : c)),
    });
    if (reviewPath && targets.some((c) => samePath(c.path, reviewPath))) setReviewPath(null);
  }

  async function restoreFromBackup(relPath: string) {
    if (!window.confirm(`Restore ${relPath} from its .ppbak backup (the version before the last save)?`)) return;
    try {
      await agentRestoreBackup(relPath);
      setFileEpoch((n) => n + 1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }

  async function saveFileManually(relPath: string, text: string) {
    await agentWriteFile(relPath, text);
    setFileEpoch((n) => n + 1);
  }

  function openChangeInEditor(relPath: string) {
    setReviewPath(relPath);
    setWorkspaceFocusPath(relPath);
    setPreviewOpen(true);
    if (workspaceDoc) setPreviewDocId(workspaceDoc.id);
  }

  async function runTerminalCommand(command: string, source: TerminalEntry["source"] = "you", cwd = ".") {
    const id = newId();
    setTerminalOpen(true);
    setTerminalLog((log) => [...log, { id, command, cwd, source, running: true }]);
    if (source === "you") setTerminalBusy(true);
    try {
      const out = await agentExec(command, cwd);
      setTerminalLog((log) =>
        log.map((e) =>
          e.id === id
            ? { ...e, running: false, code: out.code, timedOut: out.timedOut, stdout: out.stdout, stderr: out.stderr }
            : e,
        ),
      );
    } catch (err) {
      setTerminalLog((log) =>
        log.map((e) =>
          e.id === id ? { ...e, running: false, code: -1, stderr: err instanceof Error ? err.message : "Command failed" } : e,
        ),
      );
    } finally {
      if (source === "you") setTerminalBusy(false);
    }
  }

  function logAgentTerminal(call: AgentToolCall, result: string) {
    let out: { code?: number | null; timedOut?: boolean; stdout?: string; stderr?: string; error?: string } = {};
    try {
      out = JSON.parse(result);
    } catch {
      out = { stdout: result };
    }
    setTerminalOpen(true);
    setTerminalLog((log) => [
      ...log,
      {
        id: newId(),
        command: call.args.command || "(no command given)",
        cwd: call.args.cwd || ".",
        source: "agent",
        running: false,
        code: out.error ? -1 : out.code,
        timedOut: out.timedOut,
        stdout: out.stdout,
        stderr: out.error || out.stderr,
      },
    ]);
  }

  async function newChatInProject() {
    if (!workspaceDoc) return newChat();
    const s = createEmptySession();
    setError(null);
    setQ("");
    setPendingPatch(null);
    setPatchSourceMsgId(null);
    setReviewPath(null);
    setHistoryOpen(false);
    await save({ ...s, title: `${workspaceDoc.name} workspace`, documents: [workspaceDoc] });
    setPreviewDocId(workspaceDoc.id);
    setPreviewOpen(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

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
    setWorkspaceFocusPath(null);
    setPendingPatch(null);
    setPatchSourceMsgId(null);
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
    setHistoryOpen(false);
    setReviewPath(null);
    setPendingPatch(null);
    const d = getDocuments(found);
    const ws = d.find((x) => x.kind === "workspace" && isDirectWorkspaceText(x.text));
    setPreviewDocId(ws?.id ?? d[0]?.id ?? null);
    if (ws) setPreviewOpen(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function delChat(id: string) {
    await deleteChat(id);
    const rest = sessions.filter((c) => c.id !== id);
    setSessions(rest);
    if (activeId === id) {
      void (rest[0] ? openChat(rest[0].id) : newChat());
    }
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

  async function connectDirectWorkspace() {
    const current = getDocuments(session);
    if (current.length >= MAX_DOCS) {
      setError(`Max ${MAX_DOCS} sources per chat. Remove one first.`);
      return;
    }

    setError(null);
    setOpeningWorkspace(true);
    try {
      const health = await checkLocalAgent();
      if (!health.ok) {
        throw new Error(
          health.error || "Local agent offline. Run: npm run agent — then connect the folder (no upload).",
        );
      }

      let picked: string | null;
      try {
        picked = await agentPickFolder();
      } catch (e) {
        if (!(e instanceof Error && e.message === "PICK_UNSUPPORTED")) throw e;
        const typed = window.prompt(
          "Your agent is outdated (no folder dialog). Restart it with: npm run agent\n\nOr type the folder path:",
          "",
        );
        picked = typed?.trim() || null;
        if (picked) await agentSetWorkspace(picked);
      }
      if (!picked) return;

      const tree = await agentTree();
      const textWs = encodeDirectWorkspace({
        root: tree.root,
        name: tree.name,
        paths: tree.paths,
      });

      const doc: DocumentMeta = {
        id: newId(),
        name: tree.name,
        pages: tree.fileCount,
        text: textWs,
        kind: "workspace",
        mimeType: "text/plain",
        sizeBytes: 0,
        charCount: textWs.length,
        preview: `Direct · ${tree.fileCount} files (not uploaded)`,
      };

      const withoutWs = current.filter((d) => d.kind !== "workspace");
      const nextDocs = [...withoutWs, doc];
      await save({
        ...session,
        title: withoutWs.length ? `${session.title} · ${tree.name}` : `${tree.name} workspace`,
        documents: nextDocs,
        messages: [
          ...session.messages,
          {
            id: newId(),
            role: "assistant",
            content: `**Workspace connected (direct):** \`${tree.root}\`\n\nExplorer shows **${tree.fileCount}** files. Contents stay on disk — like VS Code / Cursor. Agent tools read/edit on demand.\n\n${tree.truncated ? "_Tree truncated at agent limit — search still works._\n\n" : ""}Ask things like "find the documents popup" or "fix this CSS".`,
          },
        ],
      });
      setAgentOnline(true);
      setPreviewDocId(doc.id);
      setPreviewOpen(true);
      setWorkspaceFocusPath(tree.paths[0] ?? null);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect workspace");
    } finally {
      setOpeningWorkspace(false);
    }
  }

  async function openWorkspaceFolder() {
    await connectDirectWorkspace();
  }

  async function onFolderPicked() {
    if (folderRef.current) folderRef.current.value = "";
    await connectDirectWorkspace();
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

    const mediaReq = intent === "ask" && !replaceFromUserId ? parseMediaRequest(raw, hasWorkspace) : null;
    if (mediaReq) {
      await generateMedia(mediaReq, raw.trim());
      return;
    }

    const kidMode = getParentSettings().kidMode;
    const quota = canAsk();
    if (!quota.ok) {
      setError(
        kidMode
          ? `That's all ${quota.limit} questions for today. Ask a parent if you need more.`
          : `Daily demo limit reached (${quota.limit} asks). Try again tomorrow.`,
      );
      return;
    }
    if (kidMode) logKidQuestion(raw.trim());

    if (workspaceDoc && isDirectWorkspaceText(workspaceDoc.text) && !agentOnline) {
      setError("Local agent offline. Run npm run agent, then ask again (direct workspace needs the agent).");
      return;
    }

    const documentText =
      scope === "docs"
        ? workspaceDoc && isDirectWorkspaceText(workspaceDoc.text)
          ? directWorkspaceHint(workspaceDoc.text)
          : prioritizeWorkspaceFile(combinedDocumentText(currentDocs), workspaceFocusPath)
        : "";
    const documentName =
      scope === "docs" ? documentNames(currentDocs) : "Open tutor";
    const youtubeUrls =
      scope === "docs" ? youtubeUrlsFromDocs(currentDocs) : [];
    const compare = scope === "docs" && compareMode && currentDocs.length >= 2;

    const displayQuestion = raw.trim();
    const question = workspaceFocusPath
      ? `[Focused file: ${workspaceFocusPath}]\n${displayQuestion}`
      : displayQuestion;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let baseMessages = session.messages;
    if (replaceFromUserId) {
      const idx = baseMessages.findIndex((m) => m.id === replaceFromUserId);
      if (idx >= 0) baseMessages = baseMessages.slice(0, idx);
    }

    const um: Message = { id: newId(), role: "user", content: displayQuestion };
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
    setLastQuestion(displayQuestion);
    await save(next);

    const history = baseMessages
      .filter((m) => m.content.trim())
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const useAgentLoop = hasWorkspace && agentOnline && intent === "ask";

      if (useAgentLoop) {
        const meta = workspaceDoc && isDirectWorkspaceText(workspaceDoc.text) ? parseDirectWorkspace(workspaceDoc.text) : null;
        const project = {
          name: meta?.name || workspaceDoc?.name || "workspace",
          root: meta?.root,
          paths: meta?.paths || [],
        };
        const resume = RESUME_WORDS.test(displayQuestion) ? next.agentResume : undefined;
        const runQuestion = resume?.question ?? displayQuestion;
        const turns: AgentContent[] = resume ? [...resume.turns] : [];
        let model: string | null = resume?.model ?? null;
        resumeRef.current = null;
        let runChanges: AgentChange[] = next.agentChanges ?? [];
        let run: AgentRunView = { steps: [], working: true, startedAt: Date.now() };
        let answer = "";
        const show = () => {
          const view = run;
          const content = answer;
          setSession((prev) => ({
            ...prev,
            messages: prev.messages.map((m) => (m.id === assistantId ? { ...m, content, agent: view } : m)),
          }));
        };
        const patchStep = (id: string, patch: Partial<AgentStepView>) => {
          run = { ...run, steps: run.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
        };
        show();

        let finished = false;
        for (let round = 0; round < MAX_AGENT_STEPS && !finished; round++) {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

          const step = await streamAgentStep(
            { question: runQuestion, history, project, focusPath: workspaceFocusPath, turns, model },
            controller.signal,
            (live) => {
              run = { ...run, thinking: live.status || lastThought(live.thought) };
              answer = live.text;
              show();
            },
          );
          model = step.model;
          turns.push(step.modelContent);
          run = { ...run, model, thinking: undefined };

          if (!step.calls.length) {
            answer = step.text || "Done.";
            finished = true;
            break;
          }
          answer = "";

          const responses: Record<string, unknown>[] = [];
          for (const raw of step.calls) {
            const call =
              workspaceFocusPath && !raw.args.path && (raw.name === "read_file" || FILE_WRITING_TOOLS.has(raw.name))
                ? { ...raw, args: { ...raw.args, path: workspaceFocusPath } }
                : raw;
            const label = describeToolCall(call);
            run = { ...run, steps: [...run.steps, { id: call.id, verb: label.verb, target: label.target, status: "running" }] };
            show();

            const writesFile = FILE_WRITING_TOOLS.has(call.name) && Boolean(call.args.path);
            let beforeWrite = "";
            let existed = false;
            if (writesFile) {
              try {
                beforeWrite = (await agentReadFile(call.args.path)).text;
                existed = true;
              } catch {
                beforeWrite = "";
              }
            }

            const policy = policyForTool(call.name);
            const allowed =
              policy === "allow" ||
              (policy === "ask" &&
                (await new Promise<boolean>((resolve) => {
                  permissionResolve.current = resolve;
                  setPermissionAsk({ ...label, group: groupForTool(call.name).label, detail: call.args.command || call.args.path || "" });
                })));
            setPermissionAsk(null);
            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
            const result = allowed
              ? await runLocalAgentTool(call, { paths: project.paths })
              : JSON.stringify({ error: `The user did not allow ${call.name}${policy === "deny" ? " (blocked in agent permissions)" : ""}. Do not retry it; continue another way or explain what you need.` });
            const err = toolResultError(call, result);
            patchStep(call.id, { status: err ? "error" : "ok", error: err ?? undefined });

            if (call.name === "run_terminal") logAgentTerminal(call, result);

            if (writesFile && !err) {
              try {
                const written = (await agentReadFile(call.args.path)).text;
                runChanges = recordAgentChange(runChanges, { path: call.args.path, before: beforeWrite, after: written, existed });
                const snapshot = runChanges;
                setSession((prev) => ({ ...prev, agentChanges: snapshot }));
                patchStep(call.id, { changedPath: call.args.path });
                openChangeInEditor(call.args.path);
                setFileEpoch((n) => n + 1);
              } catch {
                /* ignore sync errors */
              }
            }
            show();

            responses.push({
              functionResponse: {
                ...(call.id.startsWith("t_") ? {} : { id: call.id }),
                name: call.name,
                response: { output: result },
              },
            });
          }
          turns.push({ role: "user", parts: responses });
          compactOldToolResults(turns);
          resumeRef.current = { question: runQuestion, turns: [...turns], model, at: Date.now() };
        }

        if (!finished) {
          answer = `${answer ? `${answer}\n\n` : ""}_Paused after ${MAX_AGENT_STEPS} rounds — say **continue** to keep going._`;
        }
        const agentResume = finished ? undefined : resumeRef.current ?? undefined;
        resumeRef.current = null;
        run = { ...run, working: false, thinking: undefined, endedAt: Date.now() };
        show();
        const finalRun = run;
        agentTraces.current.set(assistantId, {
          chatId: next.id,
          trace: { question: displayQuestion, history, project, focusPath: workspaceFocusPath, turns: [...turns], model },
        });
        setRateableRuns((prev) => new Set(prev).add(assistantId));

        setAskUsage(recordAsk());
        setStreak(bumpStudyActivity("ask"));
        const titled =
          next.title === "New chat" || next.title.startsWith("Chat")
            ? displayQuestion.slice(0, 48) + (displayQuestion.length > 48 ? "…" : "")
            : next.title;
        await save({
          ...next,
          title: titled,
          agentChanges: runChanges,
          agentResume,
          messages: next.messages.map((m) =>
            m.id === assistantId ? { ...m, content: answer, agent: finalRun } : m,
          ),
        });
        setLastQuestion(null);
        return;
      }

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
          lens: getParentSettings().kidMode ? "kid" : "normal",
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
      let answeredBy: Message["answeredBy"];

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
            meta?: Message["answeredBy"];
          };
          if (payload.error) throw new Error(payload.error);
          if (payload.meta) {
            answeredBy = payload.meta;
            setSession((prev) => ({
              ...prev,
              messages: prev.messages.map((m) => (m.id === assistantId ? { ...m, answeredBy } : m)),
            }));
          }
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
          m.id === assistantId ? { ...m, content: answer, answeredBy } : m,
        ),
      });
      setLastQuestion(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        const current = getDocuments(session);
        setSession((prev) => {
          const msgs = [...prev.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && (last.content.trim() || last.agent?.steps.length)) {
            msgs[msgs.length - 1] = {
              ...last,
              content: `${last.content.trim()}\n\n_(Stopped${resumeRef.current ? " — say **continue** to pick up where it left off" : ""})_`.trim(),
              agent: last.agent ? { ...last.agent, working: false, thinking: undefined, endedAt: Date.now() } : undefined,
            };
          } else if (last?.role === "assistant") {
            msgs.pop();
          }
          const stopped = { ...prev, documents: current, messages: msgs, agentResume: resumeRef.current ?? prev.agentResume };
          void saveChat(stopped);
          return stopped;
        });
      } else {
        setError(e instanceof Error ? e.message : "Failed");
        setSession((prev) => {
          const partial = prev.messages.find((m) => m.id === assistantId);
          const keep = partial?.agent?.steps.length
            ? [{ ...partial, agent: { ...partial.agent, working: false, thinking: undefined, endedAt: Date.now() } }]
            : [];
          const failed = { ...prev, documents: currentDocs, messages: [...baseMessages, um, ...keep], agentResume: resumeRef.current ?? prev.agentResume };
          void saveChat(failed);
          return failed;
        });
      }
    } finally {
      setAsking(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  function withMediaPatch(chat: ChatSession, msgId: string, patch: Partial<MediaView>): ChatSession | null {
    if (!chat.messages.some((m) => m.id === msgId && m.media)) return null;
    return {
      ...chat,
      messages: chat.messages.map((m) => (m.id === msgId && m.media ? { ...m, media: { ...m.media, ...patch } } : m)),
    };
  }

  /** Works even if the user has switched to another chat while a video renders. */
  async function updateMedia(chatId: string, msgId: string, patch: Partial<MediaView>) {
    setSession((prev) => (prev.id === chatId ? withMediaPatch(prev, msgId, patch) ?? prev : prev));
    const stored = await getChat(chatId);
    const updated = stored && withMediaPatch(stored, msgId, patch);
    if (!updated) return;
    await saveChat(updated);
    setSessions((p) => p.map((c) => (c.id === chatId ? updated : c)));
  }

  async function generateMedia(req: MediaRequest, displayText: string) {
    const um: Message = { id: newId(), role: "user", content: displayText };
    const assistantId = newId();
    const media: MediaView = { kind: req.kind, prompt: req.prompt, aspect: req.aspect, status: "pending", startedAt: Date.now() };
    const titled =
      session.title === "New chat" || session.title.startsWith("Chat")
        ? displayText.slice(0, 48) + (displayText.length > 48 ? "…" : "")
        : session.title;
    const next: ChatSession = {
      ...session,
      title: titled,
      documents: getDocuments(session),
      messages: [...session.messages, um, { id: assistantId, role: "assistant", content: "", media }],
    };
    const chatId = next.id;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setQ("");
    setEditingId(null);
    setError(null);
    setAsking(true);
    await save(next);

    try {
      const res = await fetch(req.kind === "image" ? "/api/media/image" : "/api/media/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: req.prompt, aspect: req.aspect }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        src?: string;
        provider?: string;
        model?: string;
        jobId?: string;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error || `Generation failed (${res.status}).`);
      if (req.kind === "image") {
        if (!data.src) throw new Error("No image came back. Try again.");
        await updateMedia(chatId, assistantId, {
          status: "done",
          src: data.src,
          provider: data.provider,
          model: data.model,
          endedAt: Date.now(),
        });
      } else {
        if (!data.jobId) throw new Error("The video job did not start. Try again.");
        await updateMedia(chatId, assistantId, { jobId: data.jobId, model: data.model, provider: data.provider });
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      await updateMedia(chatId, assistantId, {
        status: "error",
        error: aborted ? "Stopped." : e instanceof Error ? e.message : "Generation failed.",
        endedAt: Date.now(),
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setAsking(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  async function rateAgentRun(msgId: string, rating: "good" | "bad") {
    const saved = agentTraces.current.get(msgId);
    if (!saved) throw new Error("This run can no longer be rated.");
    const res = await fetch("/api/training/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: msgId, rating, ...saved.trace }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Could not save");
    const patch = (chat: ChatSession): ChatSession => ({
      ...chat,
      messages: chat.messages.map((m) => (m.id === msgId && m.agent ? { ...m, agent: { ...m.agent, rating } } : m)),
    });
    setSession((prev) => (prev.id === saved.chatId ? patch(prev) : prev));
    const stored = await getChat(saved.chatId);
    if (stored) {
      const updated = patch(stored);
      await saveChat(updated);
      setSessions((p) => p.map((c) => (c.id === saved.chatId ? updated : c)));
    }
  }

  function regenerateMedia(media: MediaView) {
    if (asking) return;
    void generateMedia(
      { kind: media.kind, prompt: media.prompt, aspect: (media.aspect as MediaRequest["aspect"]) || "1:1" },
      `/${media.kind} ${media.prompt}`,
    );
  }

  function stopGenerating() {
    abortRef.current?.abort();
    permissionResolve.current?.(false);
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

    if (doc.kind === "text" || doc.kind === "docx" || doc.kind === "workspace") {
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
    if (!nextDocs.some((d) => d.kind === "workspace")) setWorkspaceFocusPath(null);
    if (nextDocs.length < 2) setCompareMode(false);
    if (!nextDocs.length) setError(null);
  }

  async function syncWorkspaceFileAfterApply(relPath: string, nextContent: string) {
    const docs = getDocuments(session);
    const ws = docs.find((d) => d.kind === "workspace");
    if (!ws) return;

    if (isDirectWorkspaceText(ws.text)) {
      setWorkspaceFocusPath(relPath);
      setPreviewDocId(ws.id);
      setPreviewOpen(true);
      setPendingPatch(null);
      setFileEpoch((n) => n + 1);
      return;
    }

    const updatedText = replaceWorkspaceFileContent(ws.text, relPath, nextContent);
    const nextDocs = docs.map((d) =>
      d.id === ws.id
        ? {
            ...d,
            text: updatedText,
            charCount: updatedText.length,
            preview: `${parseWorkspaceFiles(updatedText).length} files indexed`,
          }
        : d,
    );
    await save({ ...session, documents: nextDocs });
    setWorkspaceFocusPath(relPath);
    setPreviewDocId(ws.id);
    setPreviewOpen(true);
    setPendingPatch(null);
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
                {hasWorkspace
                  ? `${workspaceDoc?.pages || 0} files${workspaceFocusPath ? ` · ${workspaceFocusPath}` : ""}`
                  : `${docs.length} file${docs.length > 1 ? "s" : ""}`}
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
          {ideLayout && previewDoc && (
            <div className="hidden min-h-0 min-w-0 flex-1 flex-col bg-[#0b1127] lg:flex">
              <PreviewBody
                doc={previewDoc}
                url={previewUrl}
                highlight={findQuote}
                focusPath={workspaceFocusPath}
                onFocusPath={setWorkspaceFocusPath}
                pendingPatch={pendingPatch}
                onAcceptPatch={() => void acceptPendingPatch()}
                onRejectPatch={rejectPendingPatch}
                ide={ideProps}
              />
            </div>
          )}
          {/* chat column — right side once a project folder is open */}
          <div
            className={ideLayout
              ? "chat-col relative flex min-h-0 w-full min-w-0 flex-1 flex-col border-white/[0.06] bg-[#080d1c] lg:flex-none lg:border-l"
              : "flex min-w-0 flex-1 flex-col"}
            style={ideLayout ? ({ "--chat-w": `${chatWidth}px` } as React.CSSProperties) : undefined}
          >
            {ideLayout && (
              <Splitter
                side="left"
                onDrag={(dx, phase) => {
                  if (phase === "start") chatDragStart.current = chatWidth;
                  else setChatWidth(Math.min(760, Math.max(320, chatDragStart.current - dx)));
                }}
              />
            )}
            {ideLayout && (
              <div className="relative flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#080d1c] px-3">
                <span className="text-[12px] font-semibold text-white">Agent</span>
                <span className={`text-[10px] font-semibold ${agentOnline ? "text-[#00d4aa]" : "text-amber-200"}`}>
                  ● {agentOnline ? "Online" : "Offline"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((v) => !v)}
                    className={`pane-btn ${historyOpen ? "is-on" : ""}`}
                    title="Past chats in this project"
                  >
                    History{projectChats.length > 1 ? ` · ${projectChats.length}` : ""}
                  </button>
                  <button type="button" onClick={() => void newChatInProject()} className="pane-btn" title="New chat in this project">
                    + New
                  </button>
                </div>
                {historyOpen && (
                  <>
                    <button type="button" aria-label="Close" className="fixed inset-0 z-[60]" onClick={() => setHistoryOpen(false)} />
                    <div className="absolute right-2 top-full z-[70] mt-1 max-h-[360px] w-[300px] overflow-auto rounded-xl border border-white/[0.12] bg-[#101828] py-1 shadow-2xl">
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5a7390]">
                        {workspaceDoc?.name} · chats
                      </div>
                      {projectChats.map((chat) => (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => void openChat(chat.id)}
                          className={`block w-full px-3 py-2 text-left hover:bg-white/[0.05] ${chat.id === session.id ? "bg-[#00d4aa]/10" : ""}`}
                        >
                          <div className="truncate text-[12px] text-[#e2e8f0]">{chat.title}</div>
                          <div className="text-[10px] text-[#5a7390]">
                            {new Date(chat.updatedAt).toLocaleString()} · {chat.messages.filter((m) => m.role === "user").length} prompts
                            {(chat.agentChanges ?? []).length ? ` · ${(chat.agentChanges ?? []).length} file edits` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* compact sources strip — uploads live in the composer (+ / link) */}
            <div className={`shrink-0 border-b border-white/[0.06] px-3 py-2 sm:px-4 ${ideLayout && !error && !uploading && !openingWorkspace ? "hidden" : ""}`}>
              {(uploading || openingWorkspace) && (
                <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border border-[#00d4aa]/20 bg-[#00d4aa]/5 px-3 py-2 text-sm text-[#8ca3be]">
                  <Spinner /><span>{openingWorkspace ? "Choose a folder in the Windows dialog (check the taskbar if you don't see it)…" : "Reading file... scanned PDFs use OCR and can take 30-90s (local work, not usually your Wi-Fi)."}</span>
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
              <input ref={fileRef} type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" disabled={uploading || openingWorkspace || asking} onChange={(e) => upload(e.target.files?.[0])} />
              {/* LAN HTTP fallback: webkitdirectory works where showDirectoryPicker does not */}
              <input
                ref={(el) => {
                  folderRef.current = el;
                  if (el) {
                    el.setAttribute("webkitdirectory", "");
                    el.setAttribute("directory", "");
                  }
                }}
                type="file"
                multiple
                className="hidden"
                disabled={uploading || openingWorkspace || asking}
                onChange={() => void onFolderPicked()}
              />
            </div>

            <div className={`scroll-y min-h-0 flex-1 ${ideLayout ? "px-3 py-4" : "px-4 py-6 sm:px-6"}`}>
              {session.messages.length === 0 ? (
                <div className="stage-empty">
                  <div className="stage-folios" aria-hidden>
                    <div className="stage-folio" />
                    <div className="stage-folio" />
                    <div className="stage-folio" />
                  </div>
                  <p className="stage-kicker">{hasWorkspace ? "Workspace agent" : "Document intelligence"}</p>
                  <h2 className="stage-title">PaperPilot</h2>
                  <div className="stage-rule" aria-hidden />
                  <p className="stage-lede">
                    Ask with a source attached, or start open. Answers cite what you gave — nothing invented from thin air.
                  </p>
                  <div className="stage-actions">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
                      className="stage-action"
                    >
                      <strong>PDF / file</strong>
                      <span>Upload a document</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
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
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
                      className="stage-action"
                    >
                      <strong>YouTube</strong>
                      <span>Paste a video link</span>
                    </button>
                    <button
                      type="button"
                      onClick={openWorkspaceFolder}
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
                      className="stage-action"
                    >
                      <strong>Folder</strong>
                      <span>Direct connect (like Cursor)</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className={ideLayout ? "space-y-4" : "mx-auto max-w-2xl space-y-6"}>
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
                        onMediaUpdate={(patch) => void updateMedia(session.id, m.id, patch)}
                        onRateAgent={rateableRuns.has(m.id) ? (rating) => rateAgentRun(m.id, rating) : undefined}
                        onRegenerateMedia={regenerateMedia}
                        documentText={combinedDocumentText(docs)}
                        chatTitle={session.title}
                        onFindQuote={findInSources}
                        documentNames={documentNames(docs)}
                        canApply={hasWorkspace}
                        focusPath={workspaceFocusPath}
                        onApplied={syncWorkspaceFileAfterApply}
                        onOpenChange={openChangeInEditor}
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

            {ideLayout && pendingChanges.length > 0 && (
              <div className="review-bar shrink-0">
                <span className="text-[12px] text-[#c5d4e6]">
                  <strong className="text-white">{pendingChanges.length}</strong> file{pendingChanges.length > 1 ? "s" : ""} changed
                </span>
                <button type="button" onClick={() => openChangeInEditor(pendingChanges[0].path)} className="pane-btn">
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => void setChangeStatus(pendingChanges.map((c) => c.path), "reverted")}
                  className="pane-btn is-danger"
                >
                  Reject all
                </button>
                <button
                  type="button"
                  onClick={() => void setChangeStatus(pendingChanges.map((c) => c.path), "accepted")}
                  className="pane-btn is-primary"
                >
                  Accept all
                </button>
              </div>
            )}
            <div className={`shrink-0 border-t border-white/[0.06] bg-[rgba(6,9,26,0.92)] backdrop-blur-xl ${ideLayout ? "px-3 py-3" : "px-3 py-3.5 sm:px-6 sm:py-4"}`}>
              <div className={`composer-dock ${ideLayout ? "is-ide" : ""}`}>
                <div className="composer-meta">
                  <span>
                    {docs.length > 0 ? (
                      <>
                        {hasWorkspace ? "Agent mode" : "Grounded on"}{" "}
                        <strong>
                          {hasWorkspace
                            ? workspaceFocusPath
                              ? workspaceFocusPath
                              : `${docs.length} source${docs.length > 1 ? "s" : ""}`
                            : `${docs.length} source${docs.length > 1 ? "s" : ""}`}
                        </strong>
                      </>
                    ) : (
                      <>No source yet — answers stay general</>
                    )}
                  </span>
                  <span className="hidden sm:inline">
                    {hasWorkspace
                      ? agentOnline
                        ? "Agent online · auto tools"
                        : "Agent offline · run npm run agent"
                      : "Enter to send · Shift+Enter for line"}
                  </span>
                </div>
                <form
                  onSubmit={(e) => { e.preventDefault(); ask(q); }}
                  className="composer-desk"
                >
                  <div className="composer-tools" aria-label="Attach sources">
                    <button
                      type="button"
                      onClick={openAttachPicker}
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
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
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
                      title="Add YouTube link"
                      className="composer-tool"
                    >
                      <I.link />
                    </button>
                    <button
                      type="button"
                      onClick={openWorkspaceFolder}
                      disabled={uploading || openingWorkspace || asking || docs.length >= MAX_DOCS}
                      title="Open project folder"
                      className="composer-tool"
                    >
                      <I.folder />
                    </button>
                    <input
                      ref={attachRef}
                      type="file"
                      accept={ACCEPTED_FILE_TYPES}
                      className="hidden"
                      disabled={uploading || openingWorkspace || asking}
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
                            ? "Ask across your sources..."
                            : hasWorkspace
                              ? "Ask about this codebase..."
                              : "Ask about this source..."
                          : "Ask a question..."
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

          {/* Source preview — desktop side panel (documents; project folders use the editor layout) */}
          {!ideLayout && previewOpen && previewDoc && (previewUrl || previewDoc.kind === "text" || previewDoc.kind === "docx" || previewDoc.kind === "workspace") && (
            <aside className={`hidden min-h-0 flex-col border-l border-white/[0.06] bg-[rgba(11,17,39,0.85)] lg:flex ${previewDoc.kind === "workspace" ? "w-[48%] min-w-[380px] max-w-[640px]" : "w-[42%] min-w-[320px] max-w-[520px]"}`}>
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{previewDoc.name}</div>
                  <div className="text-[11px] text-[#415570]">
                    {previewDoc.kind === "workspace"
                      ? pendingPatch
                        ? "Proposed edit — Accept to write to disk"
                        : isDirectWorkspaceText(previewDoc.text)
                          ? "Direct disk access"
                          : "Workspace agent"
                      : `${kindLabel(previewDoc.kind)} preview`}
                  </div>
                </div>
                <button type="button" onClick={() => { setPreviewOpen(false); setFindQuote(null); }} className="rounded-lg p-1.5 text-[#415570] hover:text-white"><I.close /></button>
              </div>
              <PreviewBody
                doc={previewDoc}
                url={previewUrl}
                highlight={findQuote}
                focusPath={workspaceFocusPath}
                onFocusPath={setWorkspaceFocusPath}
                pendingPatch={pendingPatch}
                onAcceptPatch={() => void acceptPendingPatch()}
                onRejectPatch={rejectPendingPatch}
                ide={ideProps}
              />
            </aside>
          )}
        </div>
      </div>

      {/* Source preview — mobile / tablet overlay */}
      {previewOpen && previewDoc && (previewUrl || previewDoc.kind === "text" || previewDoc.kind === "docx" || previewDoc.kind === "workspace") && (
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
          <PreviewBody
            doc={previewDoc}
            url={previewUrl}
            highlight={findQuote}
            focusPath={workspaceFocusPath}
            onFocusPath={setWorkspaceFocusPath}
            pendingPatch={pendingPatch}
            onAcceptPatch={() => void acceptPendingPatch()}
            onRejectPatch={rejectPendingPatch}
            ide={ideProps}
          />
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
            { id: "settings", label: "Settings · API keys", run: () => { router.push("/settings"); } },
            { id: "study", label: "Study · flashcards & quizzes", run: () => { router.push("/study"); } },
            { id: "parent", label: "Parent dashboard", run: () => { router.push("/parent"); } },
            { id: "export", label: "Export chat", hint: "Ctrl+E", run: () => { setExportOpen(true); setCmdOpen(false); }, disabled: !session.messages.length },
            { id: "image", label: "Generate image", hint: "/image", run: () => { setQ("/image "); setCmdOpen(false); setTimeout(() => inputRef.current?.focus(), 50); }, disabled: asking },
            { id: "video", label: "Generate video", hint: "/video", run: () => { setQ("/video "); setCmdOpen(false); setTimeout(() => inputRef.current?.focus(), 50); }, disabled: asking },
            { id: "preview", label: previewOpen ? "Hide preview" : "Show preview", hint: "Ctrl+P", run: () => { setPreviewOpen((v) => !v); setCmdOpen(false); }, disabled: !docs.length },
            { id: "workspace", label: "Connect workspace (direct)", run: () => { void openWorkspaceFolder(); setCmdOpen(false); }, disabled: uploading || openingWorkspace || asking || docs.length >= MAX_DOCS },
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
      {permissionAsk && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1127] p-5 shadow-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8ca3be]">Agent wants to: {permissionAsk.group}</div>
            <div className="mt-2 text-sm text-white">
              {permissionAsk.verb} <span className="text-[#00d4aa]">{permissionAsk.target}</span>
            </div>
            {permissionAsk.detail && (
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#080d1c] p-3 font-mono text-[11px] text-[#c5d4e6]">{permissionAsk.detail}</pre>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => permissionResolve.current?.(false)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-[#c5d4e6] hover:bg-white/[0.06]">
                Deny
              </button>
              <button
                type="button"
                onClick={() => {
                  const g = TOOL_GROUPS.find((x) => x.label === permissionAsk.group);
                  if (g) setToolPolicy(g.id, "allow");
                  permissionResolve.current?.(true);
                }}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-[#c5d4e6] hover:bg-white/[0.06]"
              >
                Always allow
              </button>
              <button type="button" autoFocus onClick={() => permissionResolve.current?.(true)} className="rounded-lg bg-[#00d4aa] px-4 py-1.5 text-sm font-semibold text-[#06091a]">
                Allow once
              </button>
            </div>
          </div>
        </div>
      )}

      {showOnboard && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-3xl border border-white/[0.1] bg-[#0b1127] p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] text-sm font-black text-white">PP</div>
            <h3 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">PaperPilot is ready</h3>
            <ul className="mt-4 space-y-2 text-sm text-[#8ca3be]">
              <li>1. Type a question and press Enter — no file needed</li>
              <li>2. Use <strong className="text-white">+</strong> to attach a PDF/image, the link icon for YouTube, or the folder command for code</li>
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

function SaveToDeckBtn({ cards, source }: { cards: { front: string; back: string }[]; source: string }) {
  const [added, setAdded] = useState<number | null>(null);
  return (
    <button
      type="button"
      onClick={() => setAdded(addCards(cards, source))}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#415570] hover:text-[#00d4aa]"
    >
      {added === null ? "Save to deck" : added ? `Saved ${added}` : "Already in deck"}
    </button>
  );
}

function ProviderBadge({ by }: { by: NonNullable<Message["answeredBy"]> }) {
  const fellBack = by.skipped.length > 0;
  const title = [
    `Answered by ${by.provider} (${by.model})`,
    ...by.skipped.map((s) => `Skipped ${s.provider}: ${s.reason}`),
  ].join("\n");
  return (
    <span
      title={title}
      className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        fellBack ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 bg-white/[0.04] text-[#8ca3be]"
      }`}
    >
      {by.provider}
      {fellBack && <span>· fell back from {by.skipped.map((s) => s.provider).join(", ")}</span>}
    </span>
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

function WorkspaceTree({
  nodes,
  depth = 0,
  focusPath,
  onFocusPath,
}: {
  nodes: TreeNode[];
  depth?: number;
  focusPath: string | null;
  onFocusPath: (path: string) => void;
}) {
  return (
    <ul className="workspace-tree">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.kind === "dir" ? (
            <details open={depth < 2}>
              <summary style={{ paddingLeft: 8 + depth * 12 }}>
                <span className="truncate">{node.name}</span>
              </summary>
              {node.children?.length ? (
                <WorkspaceTree
                  nodes={node.children}
                  depth={depth + 1}
                  focusPath={focusPath}
                  onFocusPath={onFocusPath}
                />
              ) : null}
            </details>
          ) : (
            <button
              type="button"
              style={{ paddingLeft: 22 + depth * 12 }}
              className={`workspace-file ${focusPath === node.path ? "is-active" : ""}`}
              onClick={() => onFocusPath(node.path)}
              title={node.path}
            >
              <FileIcon path={node.name} />
              <span className="truncate">{node.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

type IdeProps = {
  fileEpoch: number;
  changes: AgentChange[];
  reviewPath: string | null;
  onOpenChange: (path: string) => void;
  onCloseReview: () => void;
  onSetChangeStatus: (paths: string[], status: AgentChange["status"]) => void;
  onRestoreBackup: (path: string) => void;
  onSaveFile: (path: string, text: string) => Promise<void>;
  terminal: {
    open: boolean;
    entries: TerminalEntry[];
    busy: boolean;
    onRun: (command: string) => void;
    onClear: () => void;
    onToggle: () => void;
  };
};

function ChangesList({ ide, activePath }: { ide: IdeProps; activePath: string | null }) {
  const pending = ide.changes.filter((c) => c.status === "pending");
  if (!pending.length) return null;
  return (
    <div className="changes-list shrink-0 border-b border-white/[0.06]">
      <div className="flex h-8 items-center gap-2 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#e8eef8]">Changes</span>
        <span className="rounded-full bg-[#00d4aa]/15 px-1.5 text-[10px] font-semibold text-[#00d4aa]">{pending.length}</span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => ide.onSetChangeStatus(pending.map((c) => c.path), "reverted")}
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#8ca3be] hover:text-red-300"
            title="Restore every changed file to how it was before the agent"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => ide.onSetChangeStatus(pending.map((c) => c.path), "accepted")}
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#00d4aa] hover:bg-[#00d4aa]/10"
          >
            Accept all
          </button>
        </div>
      </div>
      <ul className="max-h-[180px] overflow-auto pb-1">
        {pending.map((c) => {
          const stats = changeStats(c);
          const active = activePath ? samePath(activePath, c.path) : false;
          return (
            <li key={c.path} className={`change-row ${active ? "is-active" : ""}`}>
              <button type="button" onClick={() => ide.onOpenChange(c.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={c.path}>
                <span className="truncate text-[12px] text-[#c5d4e6]">{c.path.split("/").pop()}</span>
                {!c.existed ? <span className="text-[9px] font-bold text-[#00d4aa]">NEW</span> : null}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-[#00d4aa]">+{stats.added}</span>
                <span className="shrink-0 font-mono text-[10px] text-red-300">-{stats.removed}</span>
              </button>
              <button type="button" onClick={() => ide.onSetChangeStatus([c.path], "reverted")} className="change-btn hover:text-red-300" title="Reject (restore file)">
                ✕
              </button>
              <button type="button" onClick={() => ide.onSetChangeStatus([c.path], "accepted")} className="change-btn hover:text-[#00d4aa]" title="Accept">
                ✓
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DirectWorkspacePane({
  docText,
  focusPath = null,
  onFocusPath,
  pendingPatch = null,
  onAcceptPatch,
  onRejectPatch,
  ide,
}: {
  docText: string;
  focusPath?: string | null;
  onFocusPath?: (path: string) => void;
  pendingPatch?: ProposedPatch | null;
  onAcceptPatch?: () => void;
  onRejectPatch?: () => void;
  ide?: IdeProps;
}) {
  const meta = useMemo(() => parseDirectWorkspace(docText), [docText]);
  const paths = useMemo(() => {
    const base = meta?.paths || [];
    const added = (ide?.changes || [])
      .filter((c) => c.status !== "reverted" && !base.some((p) => samePath(p, c.path)))
      .map((c) => c.path);
    return added.length ? [...base, ...added] : base;
  }, [meta, ide?.changes]);
  const tree = useMemo(() => buildWorkspaceTree(paths), [paths]);
  const activePath = focusPath && paths.some((p) => samePath(p, focusPath)) ? focusPath : paths[0] || null;
  const fileEpoch = ide?.fileEpoch ?? 0;
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    if (!activePath) {
      queueMicrotask(() => {
        setContent("");
        setDraft(null);
        setReadError(null);
      });
      return;
    }
    let alive = true;
    queueMicrotask(() => {
      if (alive) {
        setLoading(true);
        setReadError(null);
      }
    });
    void agentReadFile(activePath)
      .then((f) => {
        if (!alive) return;
        setContent(f.text);
        setDraft(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setContent("");
        setDraft(null);
        setLoading(false);
        setReadError(e instanceof Error ? e.message : "Could not read file");
      });
    return () => {
      alive = false;
    };
  }, [activePath, fileEpoch]);

  const dirty = draft !== null && draft !== content;

  async function saveDraft(text: string) {
    if (!activePath || !ide || text === content) return;
    setSaving(true);
    try {
      await ide.onSaveFile(activePath, text);
      setContent(text);
      setDraft(null);
      setReadError(null);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function focusFile(p: string) {
    if (dirty && !window.confirm("You have unsaved edits in this file. Discard them?")) return;
    onFocusPath?.(p);
  }

  const patchForFile = pendingPatch && activePath && samePath(pendingPatch.path, activePath) ? pendingPatch : null;
  const planned = patchForFile ? planFileEdit(content, patchForFile.text) : null;
  const editorStats = planned ? diffStats(lineDiff(content, planned.nextText)) : null;
  const refuseApply = Boolean(planned?.warning && planned.nextText === content);

  const fileChange =
    activePath && ide
      ? [...ide.changes].reverse().find((c) => samePath(c.path, activePath) && c.status === "pending") ?? null
      : null;
  const reviewing = Boolean(fileChange && ide?.reviewPath && activePath && samePath(ide.reviewPath, activePath));
  const reviewStats = reviewing && fileChange ? changeStats(fileChange) : null;
  const term = ide?.terminal;

  const [tabs, setTabs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [sideView, setSideView] = useState<"files" | "search" | "git">("files");
  const [sideOpen, setSideOpen] = useState(true);
  const [sideWidth, setSideWidth] = useStoredWidth("paperpilot-ide-sidebar", 252);
  const dragStart = useRef(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [reveal, setReveal] = useState<{ path: string; line: number; nonce: number } | null>(null);

  useEffect(() => {
    if (!activePath) return;
    queueMicrotask(() => {
      setTabs((t) => (t.some((x) => samePath(x, activePath)) ? t : [...t, activePath].slice(-12)));
      setRecent((r) => [activePath, ...r.filter((x) => !samePath(x, activePath))].slice(0, 20));
    });
  }, [activePath]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "p" && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setQuickOpen(true);
      } else if (k === "b") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSideOpen((v) => !v);
      } else if (k === "f" && e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSideOpen(true);
        setSideView("search");
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function closeTab(p: string) {
    const idx = tabs.findIndex((x) => samePath(x, p));
    const rest = tabs.filter((x) => !samePath(x, p));
    setTabs(rest);
    if (activePath && samePath(activePath, p) && rest.length) focusFile(rest[Math.min(idx, rest.length - 1)]);
  }

  function openAtLine(p: string, line: number) {
    setReveal({ path: p, line, nonce: Date.now() });
    if (!activePath || !samePath(activePath, p)) focusFile(p);
  }

  const crumbs = activePath ? activePath.split("/") : [];

  return (
    <div className="flex min-h-0 flex-1">
      {sideOpen && (
        <div className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-white/[0.06] bg-[#080d1c]" style={{ width: sideWidth }}>
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
            <button type="button" onClick={() => setSideView("files")} className={`side-tab ${sideView === "files" ? "is-on" : ""}`}>
              Explorer
            </button>
            <button type="button" onClick={() => setSideView("search")} className={`side-tab ${sideView === "search" ? "is-on" : ""}`} title="Ctrl+Shift+F">
              Search
            </button>
            <button type="button" onClick={() => setSideView("git")} className={`side-tab ${sideView === "git" ? "is-on" : ""}`} title="Source control">
              Git
            </button>
            <button type="button" onClick={() => setQuickOpen(true)} className="side-tab ml-auto" title="Go to file (Ctrl+P)">
              ⌕
            </button>
          </div>
          {sideView === "files" ? (
            <>
              <div className="flex h-7 shrink-0 items-center gap-2 px-3">
                <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8ca3be]">
                  {meta?.name || "Project"}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-[#5a7390]">{paths.length}</span>
              </div>
              {ide ? <ChangesList ide={ide} activePath={activePath} /> : null}
              <div className="workspace-pane min-h-0 flex-1 overflow-auto pb-2">
                <WorkspaceTree nodes={tree} focusPath={activePath} onFocusPath={focusFile} />
              </div>
            </>
          ) : sideView === "git" ? (
            <GitPanel onOpen={focusFile} epoch={fileEpoch} />
          ) : (
            <SearchPanel onOpen={openAtLine} />
          )}
          <Splitter
            onDrag={(dx, phase) => {
              if (phase === "start") dragStart.current = sideWidth;
              else setSideWidth(Math.min(520, Math.max(180, dragStart.current + dx)));
            }}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col bg-[#0b1127]">
        <div className="flex h-9 shrink-0 items-stretch border-b border-white/[0.06] bg-[#080d1c]">
          <button
            type="button"
            onClick={() => setSideOpen((v) => !v)}
            className="flex w-8 shrink-0 items-center justify-center border-r border-white/[0.06] text-[13px] text-[#5a7390] hover:text-white"
            title="Toggle sidebar (Ctrl+B)"
          >
            {sideOpen ? "⟨" : "⟩"}
          </button>
          <div className="editor-tabs min-w-0 flex-1">
            {tabs.length === 0 ? <div className="px-3 py-2 text-[12px] text-[#415570]">Select a file · Ctrl+P to search</div> : null}
            {tabs.map((t) => {
              const active = activePath ? samePath(t, activePath) : false;
              const edited = ide?.changes.some((c) => c.status === "pending" && samePath(c.path, t));
              return (
                <div key={t} className={`editor-tab ${active ? "is-active" : ""}`} title={t}>
                  <button type="button" className="flex min-w-0 items-center gap-1.5" onClick={() => focusFile(t)}>
                    <FileIcon path={t} />
                    <span className="truncate">{t.split("/").pop()}</span>
                    {edited ? <span className="text-[9px] font-bold text-[#00d4aa]">M</span> : null}
                  </button>
                  {active && dirty ? (
                    <span className="editor-tab-dot" title="Unsaved" />
                  ) : (
                    <button type="button" className="editor-tab-close" onClick={() => closeTab(t)} title="Close">
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 px-2">
            {loading ? <span className="text-[10px] text-[#415570]">reading…</span> : null}
            {saving ? <span className="text-[10px] text-[#415570]">saving…</span> : null}
            {dirty && !patchForFile && !reviewing ? (
              <button type="button" onClick={() => void saveDraft(draft ?? content)} className="pane-btn is-primary" title="Ctrl+S">
                Save
              </button>
            ) : null}
            {fileChange && !reviewing && !patchForFile && activePath ? (
              <button type="button" onClick={() => ide?.onOpenChange(activePath)} className="pane-btn">
                Review change
              </button>
            ) : null}
            {reviewing && fileChange ? (
              <>
                <button type="button" onClick={ide?.onCloseReview} className="pane-btn">
                  Edit file
                </button>
                <button type="button" onClick={() => ide?.onSetChangeStatus([fileChange.path], "reverted")} className="pane-btn is-danger">
                  Reject
                </button>
                <button type="button" onClick={() => ide?.onSetChangeStatus([fileChange.path], "accepted")} className="pane-btn is-primary">
                  Accept
                </button>
              </>
            ) : null}
            {patchForFile && (
              <>
                <button type="button" onClick={onRejectPatch} className="pane-btn">
                  Reject
                </button>
                <button type="button" onClick={onAcceptPatch} disabled={refuseApply} className="pane-btn is-primary disabled:opacity-40">
                  Accept
                </button>
              </>
            )}
            {activePath && ide && !reviewing && !patchForFile ? (
              <button type="button" onClick={() => ide.onRestoreBackup(activePath)} className="pane-btn" title="Restore the .ppbak copy made before the last save">
                Undo save
              </button>
            ) : null}
            {term ? (
              <button type="button" onClick={term.onToggle} className={`pane-btn ${term.open ? "is-on" : ""}`} title="Toggle terminal">
                Terminal
              </button>
            ) : null}
          </div>
        </div>
        {crumbs.length > 0 && (
          <div className="flex h-6 shrink-0 items-center gap-1 border-b border-white/[0.04] px-3 text-[11px] text-[#5a7390]">
            {crumbs.map((c, i) => (
              <span key={`${c}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <span className="text-[#33445c]">›</span> : null}
                <span className={i === crumbs.length - 1 ? "text-[#c5d4e6]" : ""}>{c}</span>
              </span>
            ))}
            {dirty ? <span className="ml-2 text-[10px] text-amber-200">unsaved · Ctrl+S</span> : null}
          </div>
        )}
        {readError ? (
          <div className="border-b border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{readError}</div>
        ) : null}
        {planned?.warning ? (
          <div className="border-b border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
            {planned.warning}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          {patchForFile && planned && editorStats && activePath ? (
            <>
              <div className="flex gap-2 border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-[#8ca3be]">
                <span className="font-semibold text-white">
                  {planned.mode === "snippet-merge" ? "Merged snippet" : planned.mode === "search-replace" ? "Search/replace" : "Proposed edit"}
                </span>
                <span className="text-[#00d4aa]">+{editorStats.added}</span>
                <span className="text-red-300">-{editorStats.removed}</span>
              </div>
              <div className="min-h-0 flex-1">
                <CodeDiff path={activePath} original={content} modified={planned.nextText} />
              </div>
            </>
          ) : reviewing && fileChange && reviewStats ? (
            <>
              <div className="flex gap-2 border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-[#8ca3be]">
                <span className="font-semibold text-white">Agent change</span>
                <span className="text-[#00d4aa]">+{reviewStats.added}</span>
                <span className="text-red-300">-{reviewStats.removed}</span>
                <span className="truncate text-[#415570]">already saved to disk · Reject restores the original</span>
              </div>
              <div className="min-h-0 flex-1">
                <CodeDiff path={fileChange.path} original={fileChange.before} modified={fileChange.after} />
              </div>
            </>
          ) : activePath && !loading ? (
            <div className="min-h-0 flex-1">
              <CodeEditor
                path={activePath}
                value={draft ?? content}
                onChange={(next) => setDraft(next)}
                onSave={(text) => void saveDraft(text)}
                revealLine={reveal && samePath(reveal.path, activePath) ? { line: reveal.line, nonce: reveal.nonce } : null}
              />
            </div>
          ) : (
            <div className="p-3 font-mono text-[11px] text-[#415570]">{loading ? "Reading from disk…" : "No file selected"}</div>
          )}
        </div>
        {term?.open ? (
          <div className="h-[220px] shrink-0 border-t border-white/[0.08] bg-[#070b18]">
            <TerminalPanel
              entries={term.entries}
              busy={term.busy}
              onRun={term.onRun}
              onClear={term.onClear}
              onClose={term.onToggle}
            />
          </div>
        ) : null}
      </div>
      {quickOpen && (
        <QuickOpen
          paths={paths}
          recent={recent}
          onOpen={(p) => {
            setQuickOpen(false);
            focusFile(p);
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
}

function PreviewBody({
  doc,
  url,
  highlight,
  focusPath = null,
  onFocusPath,
  pendingPatch = null,
  onAcceptPatch,
  onRejectPatch,
  ide,
}: {
  doc: DocumentMeta;
  url: string | null;
  highlight?: string | null;
  focusPath?: string | null;
  onFocusPath?: (path: string) => void;
  pendingPatch?: ProposedPatch | null;
  onAcceptPatch?: () => void;
  onRejectPatch?: () => void;
  ide?: IdeProps;
}) {
  if (doc.kind === "image" && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={doc.name} className="min-h-0 flex-1 object-contain bg-[#0b1127] p-4" />
    );
  }

  if (doc.kind === "workspace" && doc.text && isDirectWorkspaceText(doc.text)) {
    return (
      <DirectWorkspacePane
        docText={doc.text}
        focusPath={focusPath}
        onFocusPath={onFocusPath}
        pendingPatch={pendingPatch}
        onAcceptPatch={onAcceptPatch}
        onRejectPatch={onRejectPatch}
        ide={ide}
      />
    );
  }

  if (doc.kind === "workspace" && doc.text) {
    const files = parseWorkspaceFiles(doc.text);
    const tree = buildWorkspaceTree(files.map((f) => f.path));
    const active = focusPath ? getWorkspaceFile(doc.text, focusPath) : files[0] || null;
    const code = (active?.content || "").slice(0, 40000);
    const patchForFile =
      pendingPatch &&
      active &&
      pendingPatch.path.replace(/\\/g, "/").toLowerCase() === active.path.replace(/\\/g, "/").toLowerCase()
        ? pendingPatch
        : null;
    const planned = patchForFile ? planFileEdit(active?.content || "", patchForFile.text) : null;
    const editorDiff = planned ? lineDiff(active?.content || "", planned.nextText) : null;
    const editorStats = editorDiff ? diffStats(editorDiff) : null;
    const refuseApply = Boolean(planned?.warning && planned.nextText === (active?.content || ""));

    return (
      <div className="flex min-h-0 flex-1">
        <div className="workspace-pane w-[38%] min-w-[140px] max-w-[220px] overflow-auto border-r border-white/[0.06] bg-[#080d1c] py-2">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5a7390]">
            Explorer · {files.length}
          </div>
          <WorkspaceTree
            nodes={tree}
            focusPath={active?.path ?? null}
            onFocusPath={(p) => onFocusPath?.(p)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
            <div className="min-w-0 flex-1 truncate text-[11px] text-[#8ca3be]">
              {active?.path || "Select a file"}
              {patchForFile ? <span className="ml-2 text-[#00d4aa]">· proposed edit</span> : null}
            </div>
            {patchForFile && (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={onRejectPatch}
                  className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-semibold text-[#8ca3be] hover:text-white"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={onAcceptPatch}
                  disabled={refuseApply}
                  className="rounded-lg border border-[#00d4aa]/40 bg-[#00d4aa]/15 px-2 py-1 text-[10px] font-semibold text-[#00d4aa] disabled:opacity-40"
                >
                  Accept
                </button>
              </div>
            )}
          </div>
          {planned?.warning ? (
            <div className="border-b border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
              {planned.warning}
            </div>
          ) : null}
          {patchForFile && editorDiff && editorStats ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex gap-2 border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-[#8ca3be]">
                <span className="font-semibold text-white">
                  {planned?.mode === "snippet-merge"
                    ? "Merged snippet diff"
                    : planned?.mode === "search-replace"
                      ? "Search/replace diff"
                      : "Inline diff"}
                </span>
                <span className="text-[#00d4aa]">+{editorStats.added}</span>
                <span className="text-red-300">-{editorStats.removed}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-[1.55]">
                {editorDiff.map((line, i) => (
                  <div
                    key={`ed-${line.type}-${i}-${line.oldNo ?? ""}-${line.newNo ?? ""}`}
                    className={
                      line.type === "add"
                        ? "diff-add"
                        : line.type === "del"
                          ? "diff-del"
                          : "diff-same"
                    }
                  >
                    <span className="diff-gutter">
                      {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                    </span>
                    <span className="diff-text">{line.text || " "}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre bg-[#0b1127] p-3 font-mono text-[11px] leading-relaxed text-[#c5d4e6]">
              {code || "No content"}
            </pre>
          )}
        </div>
      </div>
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
  if (url && doc.kind === "pdf") {
    return <PdfQuoteViewer url={url} quote={highlight} />;
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

function ApplyCodeBlock({
  className,
  code,
  focusPath,
  canApply,
  workspaceText,
  onApplied,
}: {
  className?: string;
  code: string;
  focusPath?: string | null;
  canApply?: boolean;
  workspaceText?: string;
  onApplied?: (path: string, text: string) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [detail, setDetail] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [agentRoot, setAgentRoot] = useState<string | null>(null);
  const [beforeText, setBeforeText] = useState<string | null>(null);
  const [beforeSource, setBeforeSource] = useState<"disk" | "index" | "new">("new");
  const [plannedNext, setPlannedNext] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState<"full-replace" | "snippet-merge" | "search-replace" | null>(null);
  const [planWarning, setPlanWarning] = useState<string | null>(null);

  const path = inferApplyPath(className, code, focusPath);
  const lang = (className || "").replace(/language-/, "").split(/\s+/)[0] || "code";
  const rawNext = stripPathComment(code);
  const showApply = Boolean(canApply && path && lang !== "diff" && rawNext.trim().length > 0);
  const fullPath = path && agentRoot ? `${agentRoot}\\${path.replace(/\//g, "\\")}` : path;

  const nextText = plannedNext ?? rawNext;
  const diffLines = useMemo(() => {
    if (!reviewOpen || beforeText === null) return [];
    return lineDiff(beforeText, nextText);
  }, [reviewOpen, beforeText, nextText]);
  const stats = useMemo(() => diffStats(diffLines), [diffLines]);
  const refuseApply = Boolean(planWarning && beforeText !== null && nextText === beforeText);

  async function loadReview() {
    if (!path) return;
    setLoadingReview(true);
    setDetail("");
    try {
      const health = await checkLocalAgent();
      if (!health.ok) throw new Error(health.error || "Local agent offline");
      setAgentRoot(health.workspace || null);

      let before = "";
      let source: "disk" | "index" | "new" = "new";
      try {
        const file = await agentReadFile(path);
        before = file.text;
        source = "disk";
      } catch {
        const indexed = workspaceText ? getWorkspaceFile(workspaceText, path)?.content : null;
        if (indexed != null) {
          before = indexed;
          source = "index";
        } else {
          before = "";
          source = "new";
        }
      }
      const plan = planFileEdit(before, rawNext);
      setBeforeText(before);
      setBeforeSource(source);
      setPlannedNext(plan.nextText);
      setPlanMode(plan.mode);
      setPlanWarning(plan.warning || null);
      setReviewOpen(true);
      setStatus("idle");
      if (plan.warning && plan.nextText === before) {
        setDetail(plan.warning);
      } else if (plan.mode === "snippet-merge") {
        setDetail(plan.warning || "Snippet merged into existing file for preview — click Apply to write.");
      } else if (source === "index") {
        setDetail(
          `Preview only — file not found under agent root ${health.workspace}. Show changes does not edit yet. Click Apply to write here (or restart agent with PAPERPILOT_WORKSPACE set to your real project).`,
        );
      } else {
        setDetail("Preview only — click Apply to write this change to disk.");
      }
    } catch (e) {
      setStatus("err");
      setDetail(e instanceof Error ? e.message : "Could not load review");
      setReviewOpen(false);
    } finally {
      setLoadingReview(false);
    }
  }

  async function onApply() {
    if (!path || refuseApply) return;
    const target = fullPath || path;
    const warn =
      beforeSource === "index"
        ? `\n\nWARNING: agent could not find this file on disk under its workspace.\nApply will CREATE/OVERWRITE:\n${target}\nThis may NOT be your Downloads/EEV6 file.`
        : "";
    const mergeNote = planMode === "snippet-merge" ? "\n\nSnippet will be merged into the existing file (not a full wipe)." : "";
    const ok = window.confirm(
      `Apply highlighted changes to:\n\n${target}\n\n+${stats.added} / -${stats.removed} lines\nA .ppbak backup is created if the file exists.${mergeNote}${warn}`,
    );
    if (!ok) return;
    setStatus("busy");
    setDetail("");
    try {
      const health = await checkLocalAgent();
      if (!health.ok) throw new Error(health.error || "Local agent offline");
      setAgentRoot(health.workspace || null);
      const result = await agentWriteFile(path, nextText);
      await onApplied?.(path, nextText);
      setBeforeText(nextText);
      setBeforeSource("disk");
      setPlannedNext(nextText);
      setStatus("ok");
      setDetail(
        result.backup
          ? `Applied to disk: ${health.workspace}\\${path.replace(/\//g, "\\")} (backup ${result.backup})`
          : `Applied to disk: ${health.workspace}\\${path.replace(/\//g, "\\")}`,
      );
    } catch (e) {
      setStatus("err");
      setDetail(e instanceof Error ? e.message : "Apply failed");
    }
  }

  return (
    <div className="apply-block my-3 overflow-hidden rounded-xl border border-white/[0.1] bg-[#080d1c]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5a7390]">{lang}</span>
        {path ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#8ca3be]" title={fullPath || path}>
            {fullPath || path}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-[11px] text-[#415570]">No file path — add // path: relative/file</span>
        )}
        {showApply && (
          <>
            <button
              type="button"
              onClick={() => void (reviewOpen ? setReviewOpen(false) : loadReview())}
              disabled={loadingReview || status === "busy"}
              className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-[#8ca3be] hover:text-white disabled:opacity-50"
            >
              {loadingReview ? "Loading…" : reviewOpen ? "Hide changes" : "Show changes"}
            </button>
            <button
              type="button"
              onClick={() => void onApply()}
              disabled={status === "busy" || loadingReview || !reviewOpen || refuseApply}
              className="rounded-lg border border-[#00d4aa]/35 bg-[#00d4aa]/10 px-2.5 py-1 text-[11px] font-semibold text-[#00d4aa] hover:border-[#00d4aa]/60 disabled:opacity-50"
              title={
                refuseApply
                  ? "Refused — snippet would wipe the file"
                  : reviewOpen
                    ? "Write highlighted changes to disk"
                    : "Show changes first"
              }
            >
              {status === "busy" ? "Applying…" : "Apply to disk"}
            </button>
          </>
        )}
      </div>

      {!reviewOpen && (
        <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-[#c5d4e6]">
          <code>{code}</code>
        </pre>
      )}

      {reviewOpen && beforeText !== null && (
        <div className="border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px] text-[#8ca3be]">
            <span className="font-semibold text-white">Change preview (not saved yet)</span>
            <span className="text-[#00d4aa]">+{stats.added}</span>
            <span className="text-red-300">-{stats.removed}</span>
            <span className={beforeSource === "disk" ? "text-[#415570]" : "text-amber-200"}>
              {planMode === "snippet-merge"
                ? "merged snippet into file"
                : planMode === "search-replace"
                  ? "search/replace hunks"
                  : beforeSource === "disk"
                    ? "vs disk file"
                    : beforeSource === "index"
                      ? "vs chat index only — agent disk file missing"
                      : "new file on agent disk"}
            </span>
          </div>
          {planWarning && (
            <div className="mx-3 mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
              {planWarning}
            </div>
          )}
          {beforeSource !== "disk" && !planWarning && (
            <div className="mx-3 mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
              Agent workspace is <strong>{agentRoot || "unknown"}</strong>. This relative path was not found there.
              Clicking Apply writes under that folder — not your Downloads EEV6 path unless you restart agent with the correct PAPERPILOT_WORKSPACE.
            </div>
          )}
          <div className="max-h-72 overflow-auto font-mono text-[11px] leading-[1.55]">
            {diffLines.map((line, i) => (
              <div
                key={`${line.type}-${i}-${line.oldNo ?? ""}-${line.newNo ?? ""}`}
                className={
                  line.type === "add"
                    ? "diff-add"
                    : line.type === "del"
                      ? "diff-del"
                      : "diff-same"
                }
              >
                <span className="diff-gutter">
                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                </span>
                <span className="diff-text">{line.text || " "}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <div
          className={`border-t px-3 py-1.5 text-[11px] ${
            status === "ok"
              ? "border-[#00d4aa]/20 text-[#00d4aa]"
              : status === "err"
                ? "border-red-400/20 text-red-300"
                : "border-white/10 text-[#8ca3be]"
          }`}
        >
          {detail}
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
  onAskNext,
  documentText,
  chatTitle,
  onFindQuote,
  documentNames: docNames,
  priorUserQuestion,
  canApply,
  focusPath,
  onApplied,
  onOpenChange,
  onMediaUpdate,
  onRegenerateMedia,
  onRateAgent,
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
  canApply?: boolean;
  focusPath?: string | null;
  onApplied?: (path: string, text: string) => void | Promise<void>;
  onOpenChange?: (path: string) => void;
  onMediaUpdate?: (patch: Partial<MediaView>) => void;
  onRegenerateMedia?: (media: MediaView) => void;
  onRateAgent?: (rating: "good" | "bad") => Promise<void>;
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

  if (msg.media) {
    const media = msg.media;
    return (
      <div className="animate-rise max-w-xl" style={{ animationDelay: `${Math.min(idx * 0.04, 0.2)}s` }}>
        <MediaCard media={media} onUpdate={onMediaUpdate} onRegenerate={() => onRegenerateMedia?.(media)} />
      </div>
    );
  }

  if (msg.agent) {
    return (
      <div className="animate-rise" style={{ animationDelay: `${Math.min(idx * 0.04, 0.2)}s` }}>
        <AgentReply run={msg.agent} answer={msg.content} onOpenFile={onOpenChange} onRate={onRateAgent} />
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
              {body ? (
                <ReactMarkdown
                  components={{
                    code({ className, children }) {
                      const text = String(children).replace(/\n$/, "");
                      const isBlock = Boolean(className) || text.includes("\n");
                      if (!isBlock) {
                        return <code className={className}>{children}</code>;
                      }
                      return (
                        <ApplyCodeBlock
                          className={className}
                          code={text}
                          focusPath={focusPath}
                          canApply={canApply && !streaming}
                          workspaceText={documentText}
                          onApplied={onApplied}
                        />
                      );
                    },
                    pre({ children }) {
                      return <>{children}</>;
                    },
                  }}
                >
                  {body}
                </ReactMarkdown>
              ) : null}
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
          {msg.answeredBy && <ProviderBadge by={msg.answeredBy} />}
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
                <SaveToDeckBtn cards={cards} source={chatTitle || "Chat"} />
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
