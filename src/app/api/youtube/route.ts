import { NextResponse } from "next/server";
import { parseYouTubeUrl, youtubeIdFromUrl } from "@/lib/media";

export const runtime = "nodejs";

async function fetchYouTubeTitle(url: string): Promise<string | null> {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembed, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const canonical = parseYouTubeUrl(body.url || "");

    if (!canonical) {
      return NextResponse.json(
        {
          error:
            "Paste a public YouTube link (youtube.com/watch or youtu.be). Private/unlisted videos are not supported.",
        },
        { status: 400 },
      );
    }

    const id = youtubeIdFromUrl(canonical);
    const title = (await fetchYouTubeTitle(canonical)) || `YouTube ${id}`;

    return NextResponse.json({
      name: title.slice(0, 80),
      kind: "youtube" as const,
      mimeType: "video/mp4",
      sourceUrl: canonical,
      pages: 1,
      sizeBytes: 0,
      charCount: 0,
      preview: `YouTube video · ${canonical}`,
      text: `YouTube video attached: ${title}\nURL: ${canonical}\n(Answers will use the full public video via Gemini.)`,
    });
  } catch (error) {
    console.error("youtube attach error", error);
    return NextResponse.json(
      { error: "Could not add that YouTube link. Try again." },
      { status: 500 },
    );
  }
}
