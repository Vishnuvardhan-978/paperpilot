import type { ChatSession } from "@/lib/chat-store";
import { getDocuments } from "@/lib/chat-store";

function safeName(title: string) {
  return title.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "paperpilot-chat";
}

export function chatToMarkdown(session: ChatSession) {
  const docs = getDocuments(session);
  const lines: string[] = [
    `# ${session.title}`,
    "",
    `Exported from PaperPilot · ${new Date().toLocaleString()}`,
    "",
  ];

  if (docs.length) {
    lines.push(`**Documents (${docs.length}):**`);
    for (const d of docs) {
      lines.push(
        `- ${d.name} · ${d.pages} pages${d.sizeBytes ? ` · ${formatBytes(d.sizeBytes)}` : ""}`,
      );
    }
    lines.push("", "---", "");
  }

  for (const msg of session.messages) {
    const who = msg.role === "user" ? "You" : "PaperPilot";
    lines.push(`### ${who}`, "", msg.content, "", "---", "");
  }

  return lines.filter(Boolean).join("\n");
}

export function chatToText(session: ChatSession) {
  const docs = getDocuments(session);
  const lines: string[] = [
    session.title,
    `Exported from PaperPilot · ${new Date().toLocaleString()}`,
    "",
  ];

  if (docs.length) {
    lines.push(`Documents: ${docs.map((d) => d.name).join(", ")}`, "");
  }

  for (const msg of session.messages) {
    const who = msg.role === "user" ? "You" : "PaperPilot";
    lines.push(`[${who}]`, msg.content, "");
  }

  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportChatMarkdown(session: ChatSession) {
  downloadText(
    `${safeName(session.title)}.md`,
    chatToMarkdown(session),
    "text/markdown;charset=utf-8",
  );
}

export function exportChatText(session: ChatSession) {
  downloadText(
    `${safeName(session.title)}.txt`,
    chatToText(session),
    "text/plain;charset=utf-8",
  );
}

export function shareChatText(session: ChatSession) {
  return chatToText(session);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatChars(count: number) {
  if (count < 1000) return `${count} chars`;
  return `${(count / 1000).toFixed(1)}k chars`;
}

/** Rough silent reading time from character count. */
export function formatReadTime(chars: number) {
  const words = Math.max(1, Math.round(chars / 5));
  const minutes = Math.max(1, Math.ceil(words / 200));
  return minutes === 1 ? "~1 min read" : `~${minutes} min read`;
}
