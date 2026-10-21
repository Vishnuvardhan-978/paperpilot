"use client";

import { useEffect, useState } from "react";
import type { MediaView } from "@/lib/chat-store";

const POLL_MS = 5_000;
/** An image request that never finished (tab closed mid-way) is shown as interrupted. */
const IMAGE_STALE_MS = 200_000;
const VIDEO_STALE_MS = 15 * 60_000;

function since(from: number, to: number) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fileName(media: MediaView) {
  const slug = media.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "paperpilot";
  if (media.kind === "video") return `${slug}.mp4`;
  const ext = /^data:image\/(png|jpeg|webp)/.exec(media.src || "")?.[1] ?? "png";
  return `${slug}.${ext === "jpeg" ? "jpg" : ext}`;
}

export function MediaCard({
  media,
  onUpdate,
  onRegenerate,
}: {
  media: MediaView;
  onUpdate?: (patch: Partial<MediaView>) => void;
  onRegenerate?: (prompt: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const pending = media.status === "pending";

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const stale = pending && now - media.startedAt > (media.kind === "video" ? VIDEO_STALE_MS : IMAGE_STALE_MS);

  useEffect(() => {
    if (!pending || !media.jobId || !onUpdate) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/media/video?job=${encodeURIComponent(media.jobId!)}`, { cache: "no-store" });
        const data = (await res.json()) as { status?: string; src?: string; error?: string };
        if (stop) return;
        if (data.status === "done" && data.src) {
          onUpdate({ status: "done", src: data.src, endedAt: Date.now() });
          return;
        }
        if (data.status === "error" || !res.ok) {
          onUpdate({ status: "error", error: data.error || "Video generation failed.", endedAt: Date.now() });
          return;
        }
      } catch {
        /* network blip — keep polling */
      }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // onUpdate is recreated every render; the job id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, media.jobId]);

  const label = media.kind === "video" ? "Video" : "Image";
  const ratio = media.aspect.replace(":", " / ");
  const failed = media.status === "error" || stale;

  return (
    <div className="media-card overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1e33]/80">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-xs text-[#8ca3be]">
        <span className="rounded-md bg-[#00d4aa]/10 px-1.5 py-0.5 font-semibold text-[#00d4aa]">{label}</span>
        <span className="min-w-0 flex-1 truncate" title={media.prompt}>{media.prompt}</span>
        {media.aspect ? <span className="shrink-0 text-[#415570]">{media.aspect}</span> : null}
      </div>

      {pending && !stale ? (
        <div className="relative mx-auto grid max-w-full place-items-center bg-black/20" style={{ aspectRatio: ratio, maxHeight: 420, height: media.aspect === "9:16" ? 420 : undefined }}>
          <div className="flex flex-col items-center gap-3 text-sm text-[#8ca3be]">
            <span className="agent-spin" style={{ width: 22, height: 22 }} />
            <span>
              {media.kind === "video" ? (media.jobId ? "Rendering video" : "Starting video") : "Creating image"}… {since(media.startedAt, now)}
            </span>
            {media.kind === "video" ? <span className="text-[11px] text-[#415570]">Videos usually take 1–3 minutes.</span> : null}
          </div>
        </div>
      ) : failed ? (
        <div className="px-4 py-4 text-sm text-[#ff9b9b]">
          {stale ? `${label} generation was interrupted.` : media.error || `${label} generation failed.`}
        </div>
      ) : media.src ? (
        <div className="bg-black/30">
          {media.kind === "video" ? (
            <video
              src={media.src}
              controls
              playsInline
              className={`mx-auto block max-w-full ${media.aspect === "9:16" ? "h-[480px] w-auto" : "max-h-[480px] w-full"}`}
              style={{ aspectRatio: ratio }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, nothing for next/image to optimise
            <img src={media.src} alt={media.prompt} className="mx-auto block max-h-[520px] w-auto max-w-full" />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[11px] text-[#415570]">
        {media.provider && media.status === "done" ? (
          <span title={media.model}>
            {media.provider}
            {media.endedAt ? ` · ${since(media.startedAt, media.endedAt)}` : ""}
          </span>
        ) : null}
        <span className="flex-1" />
        {media.status === "done" && media.src ? (
          <a href={media.src} download={fileName(media)} className="rounded-lg px-2 py-1 text-[#8ca3be] hover:bg-white/5 hover:text-white">
            Download
          </a>
        ) : null}
        {!pending || stale ? (
          <button
            type="button"
            onClick={() => onRegenerate?.(media.prompt)}
            className="rounded-lg px-2 py-1 text-[#8ca3be] hover:bg-white/5 hover:text-white"
          >
            {failed ? "Try again" : "Regenerate"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
