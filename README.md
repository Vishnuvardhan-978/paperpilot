# PaperPilot — Truth Tutor

Ask PDFs, images, DOCX, text, and YouTube with age-adaptive **lenses** (Kid / Study / Normal / Proof). Answers stay grounded in your sources — with a truth meter, claim check, quizzes, and study packs.

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind 4
- Gemini API (`@google/genai`)
- `unpdf` + optional local Poppler/Tesseract OCR for scanned PDFs
- IndexedDB chat history (client-side)

## Setup

1. Copy `.env.example` to `.env.local`
2. Add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_key_here
   ```
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) · app at `/app`

### Optional: local OCR (scanned / JBIG2 PDFs)

Install [Poppler](https://github.com/oschwartz10612/poppler-windows/releases) and ensure `pdftoppm` is on `PATH` (or under `E:\poppler\...` as in `scripts/ocr-pdf.mjs`). Tesseract uses `eng.traineddata` in the repo root.

## Features

- **Lenses** — Kid, Study, Normal, Proof (persisted)
- **Explain / Teach me / Quiz / Document map / Blind spots / Claim check / Conflict scan**
- **Truth meter** — verifies source quotes against extracted text
- **Model confidence** line + **Trust receipt** export
- **Do-next** — Key points, Ask next, Actions
- **Study pack** — flashcards (Markdown + Anki TSV) + notes export
- **Compare mode** for multi-doc chats (up to 3 sources)
- **Voice ask** (Chrome/Edge) · **Ctrl+K** command palette
- **Find in source** on citation quotes
- Multi-format upload (10MB) · YouTube · streaming SSE answers
- Multi-turn history for continuity · auto chat titles
- Daily demo ask limit (client) · study activity streak
- Installable PWA manifest

## Scripts

```bash
npm run dev
npm run build
npx tsc --noEmit
node scripts/smoke-truth.mjs
```

## Built by

Vishnu
