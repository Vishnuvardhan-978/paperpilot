"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PageShell, btn, btnGhost, input } from "@/components/page-shell";
import { IMAGE_STYLES, type ImageStyleId } from "@/lib/image-styles";
import { deleteFromGallery, listGallery, newImageId, saveToGallery, updateGallery, type GalleryImage } from "@/lib/gallery";

const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const IDEAS = [
  "a cozy reading nook with rain on the window",
  "a robot teaching kids about the solar system",
  "a lighthouse on a cliff at sunset",
  "the water cycle as a friendly diagram",
  "a dragon made of autumn leaves",
];

type Result = { src: string; provider: string; seed?: number };

function fileName(img: GalleryImage) {
  const slug = img.idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "paperpilot";
  const ext = /^data:image\/(png|jpeg|webp)/.exec(img.src)?.[1] ?? "png";
  return `${slug}.${ext === "jpeg" ? "jpg" : ext}`;
}

export default function CreatePage() {
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState<ImageStyleId>("none");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("1:1");
  const [count, setCount] = useState(1);
  const [enhance, setEnhance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [usedPrompt, setUsedPrompt] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [open, setOpen] = useState<GalleryImage | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void listGallery().then(setGallery).catch(() => setGallery([]));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function generate(opts: { prompt?: string; seed?: number; enhance?: boolean; style?: ImageStyleId; aspect?: string; count?: number } = {}) {
    const text = (opts.prompt ?? idea).trim();
    if (!text || busy) return;
    const useStyle = opts.style ?? style;
    const useAspect = opts.aspect ?? aspect;
    setBusy(true);
    setStarted(Date.now());
    setNow(Date.now());
    setError(null);
    try {
      const r = await fetch("/api/media/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          style: useStyle,
          aspect: useAspect,
          count: opts.count ?? count,
          enhance: opts.enhance ?? enhance,
          ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        }),
      });
      const data = (await r.json()) as { images?: Result[]; prompt?: string; failed?: number; error?: string };
      if (!r.ok || !data.images?.length) throw new Error(data.error || "Image generation failed.");
      setUsedPrompt(data.prompt || text);
      const made: GalleryImage[] = data.images.map((img) => ({
        id: newImageId(),
        src: img.src,
        prompt: data.prompt || text,
        idea: text,
        style: useStyle,
        aspect: useAspect,
        provider: img.provider,
        seed: img.seed,
        createdAt: Date.now(),
      }));
      await saveToGallery(made).catch(() => {});
      setGallery((g) => [...made, ...g]);
      if (data.failed) setError(`${data.failed} of ${data.failed + made.length} images failed; the free service may be busy.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(img: GalleryImage) {
    const next = { ...img, favorite: !img.favorite };
    await updateGallery(next).catch(() => {});
    setGallery((g) => g.map((x) => (x.id === img.id ? next : x)));
    if (open?.id === img.id) setOpen(next);
  }

  async function remove(img: GalleryImage) {
    await deleteFromGallery(img.id).catch(() => {});
    setGallery((g) => g.filter((x) => x.id !== img.id));
    if (open?.id === img.id) setOpen(null);
  }

  const shown = filter === "favorites" ? gallery.filter((g) => g.favorite) : gallery;
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${on ? "border-[#00d4aa]/60 bg-[#00d4aa]/10 text-[#00d4aa]" : "border-white/10 text-[#8ca3be] hover:bg-white/[0.04]"}`;

  return (
    <PageShell title="Image Studio" subtitle="Describe an idea, pick a style, and keep everything you make in your gallery.">
      <Card>
        <div className="space-y-4">
          <textarea
            ref={box}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void generate();
            }}
            rows={3}
            placeholder="What should the image show? (Ctrl+Enter to create)"
            className={input}
          />
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map((i) => (
              <button key={i} type="button" onClick={() => setIdea(i)} className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#8ca3be] hover:text-white">
                {i}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-[#415570]">Style</div>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_STYLES.map((s) => (
                <button key={s.id} type="button" onClick={() => setStyle(s.id)} className={chip(style === s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-[#415570]">Shape</div>
              <div className="flex gap-1.5">
                {ASPECTS.map((a) => (
                  <button key={a} type="button" onClick={() => setAspect(a)} className={chip(aspect === a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-[#415570]">How many</div>
              <div className="flex gap-1.5">
                {[1, 2, 4].map((n) => (
                  <button key={n} type="button" onClick={() => setCount(n)} className={chip(count === n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-[#c5d4e6]">
              <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} className="accent-[#00d4aa]" />
              Enhance prompt with AI
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btn} disabled={busy || !idea.trim()} onClick={() => void generate()}>
              {busy ? `Creating… ${Math.max(0, Math.round((now - started) / 1000))}s` : count > 1 ? `Create ${count} images` : "Create image"}
            </button>
            {busy && count > 1 && <span className="text-xs text-[#415570]">The free service makes one at a time, so several can take a minute or two.</span>}
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          {usedPrompt && usedPrompt !== idea.trim() && !busy && (
            <p className="text-xs text-[#8ca3be]">
              <span className="text-[#415570]">Prompt used: </span>
              {usedPrompt}
            </p>
          )}
        </div>
      </Card>

      <Card
        title={`Gallery (${gallery.length})`}
        action={
          <div className="flex gap-1.5">
            <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
              All
            </button>
            <button type="button" className={chip(filter === "favorites")} onClick={() => setFilter("favorites")}>
              ★ Favorites
            </button>
          </div>
        }
      >
        {shown.length === 0 && <p className="text-sm text-[#415570]">{filter === "favorites" ? "No favorites yet." : "Your images will appear here."}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((img) => (
            <figure key={img.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
              <button type="button" onClick={() => setOpen(img)} className="block w-full" title={img.prompt}>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data: URL */}
                <img src={img.src} alt={img.idea} className="aspect-square w-full object-cover" loading="lazy" />
              </button>
              <figcaption className="truncate px-2 py-1.5 text-[11px] text-[#8ca3be]">{img.idea}</figcaption>
              <button
                type="button"
                onClick={() => void toggleFavorite(img)}
                className={`absolute right-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-sm ${img.favorite ? "text-amber-300" : "text-white/70 opacity-0 group-hover:opacity-100"}`}
                title={img.favorite ? "Unfavorite" : "Favorite"}
              >
                ★
              </button>
            </figure>
          ))}
        </div>
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-[#0b1127] p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data: URL */}
            <img src={open.src} alt={open.idea} className="mx-auto max-h-[60vh] w-auto rounded-lg" />
            <p className="mt-3 text-sm text-white">{open.idea}</p>
            <p className="mt-1 text-xs text-[#8ca3be]">{open.prompt}</p>
            <p className="mt-1 text-[11px] text-[#415570]">
              {open.provider} · {open.aspect} · {IMAGE_STYLES.find((s) => s.id === open.style)?.label || "Auto"}
              {open.seed !== undefined ? ` · seed ${open.seed}` : ""} · {new Date(open.createdAt).toLocaleString()}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={open.src} download={fileName(open)} className={btnGhost}>
                Download
              </a>
              <button
                type="button"
                className={btnGhost}
                disabled={busy}
                onClick={() => {
                  const o = open;
                  setOpen(null);
                  void generate({ prompt: o.idea, style: o.style as ImageStyleId, aspect: o.aspect, count: 2 });
                }}
              >
                2 more like this
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setIdea(open.idea);
                  setStyle(open.style as ImageStyleId);
                  setAspect(open.aspect as (typeof ASPECTS)[number]);
                  setOpen(null);
                  box.current?.focus();
                }}
              >
                Edit prompt
              </button>
              <button type="button" className={btnGhost} onClick={() => void toggleFavorite(open)}>
                {open.favorite ? "★ Favorited" : "☆ Favorite"}
              </button>
              <button type="button" className={`${btnGhost} text-red-300`} onClick={() => void remove(open)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
