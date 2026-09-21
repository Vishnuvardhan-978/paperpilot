# PaperPilot

Upload a PDF. Ask anything. Get answers powered by Gemini.

## Stack

- Next.js (App Router)
- Tailwind CSS
- Gemini API
- `unpdf` for PDF text extraction

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
4. Open [http://localhost:3000](http://localhost:3000)

## MVP features

- Landing page
- PDF upload (up to 8MB)
- Chat Q&A against document text
