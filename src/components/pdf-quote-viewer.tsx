"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { findQuoteSpan } from "@/lib/quote-locate";

type PageHit = { page: number; rects: { x: number; y: number; w: number; h: number }[] };

const SCALE = 1.4;

/** Renders a PDF with pdf.js, scrolls to the page holding `quote` and highlights it. */
export function PdfQuoteViewer({ url, quote }: { url: string; quote?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hit, setHit] = useState<PageHit | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const loading = pdfjs.getDocument({ url });
        task = loading;
        const doc = await loading.promise;
        if (!cancelled) setPdf(doc);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  // Find the quote: page by page, matching normalized text and mapping back to text items.
  useEffect(() => {
    if (!pdf || !quote?.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHit(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      let best: { page: number; score: number; rects: PageHit["rects"] } | null = null;
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: SCALE });
        const content = await page.getTextContent();
        const items = content.items.flatMap((it) => ("str" in it ? [it] : []));
        const span = findQuoteSpan(items.map((it) => it.str), quote);
        if (!span || (best && span.score <= best.score)) continue;
        const rects = span.items.map((i) => {
          const it = items[i];
          const [a, b, , , e, f] = it.transform as number[];
          const fontH = Math.hypot(a, b);
          const [x, y] = viewport.convertToViewportPoint(e, f);
          return { x, y: y - fontH * SCALE, w: it.width * SCALE, h: fontH * SCALE * 1.15 };
        });
        best = { page: n, score: span.score, rects };
        if (span.score >= 0.99) break;
      }
      if (!cancelled) {
        setHit(best && best.score >= 0.5 ? { page: best.page, rects: best.rects } : null);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, quote]);

  useEffect(() => {
    if (!hit) return;
    containerRef.current?.querySelector(`[data-page="${hit.page}"]`)?.scrollIntoView({ block: "start" });
  }, [hit]);

  if (error) return <div className="p-4 text-sm text-red-300">Could not open PDF: {error}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {quote && (
        <div className="border-b border-white/[0.08] bg-[#00d4aa]/10 px-3 py-2 text-[11px] text-[#8ca3be]">
          {searching ? "Finding" : hit ? `Found on page ${hit.page}` : "Couldn't find"}:{" "}
          <span className="italic text-white">“{quote.slice(0, 120)}”</span>
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-[#0b1127] p-3">
        {pdf &&
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={i} pdf={pdf} n={i + 1} rects={hit?.page === i + 1 ? hit.rects : []} />
          ))}
      </div>
    </div>
  );
}

function PdfPage({ pdf, n, rects }: { pdf: PDFDocumentProxy; n: number; rects: PageHit["rects"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(n <= 2);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(n).then((page) => {
      if (!cancelled) {
        const v = page.getViewport({ scale: SCALE });
        setSize({ w: v.width, h: v.height });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, n]);

  const show = visible || rects.length > 0;
  // One render per canvas at a time: wait for the previous one to settle before starting.
  const renderChain = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    renderChain.current = renderChain.current.then(async () => {
      const page = await pdf.getPage(n);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const viewport = page.getViewport({ scale: SCALE });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = viewport.width * ratio;
      canvas.height = viewport.height * ratio;
      task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, n, show]);

  return (
    <div
      ref={ref}
      data-page={n}
      className="relative mx-auto mb-3 bg-white shadow"
      style={size ? { width: size.w, height: size.h, maxWidth: "100%" } : { height: 800 }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {rects.map((r, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-sm bg-[#00d4aa]/40 mix-blend-multiply"
          style={size ? { left: `${(r.x / size.w) * 100}%`, top: `${(r.y / size.h) * 100}%`, width: `${(r.w / size.w) * 100}%`, height: `${(r.h / size.h) * 100}%` } : undefined}
        />
      ))}
    </div>
  );
}
