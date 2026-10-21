export type MediaRequest = {
  kind: "image" | "video";
  prompt: string;
  aspect: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
};

const IMAGE_NOUNS = "image|picture|pic|photo|illustration|drawing|painting|logo|poster|wallpaper|artwork|art|icon|banner|thumbnail|sketch";
const VIDEO_NOUNS = "video|clip|animation|movie|reel";

const LEAD = `^(?:please\\s+|can you\\s+|could you\\s+|pls\\s+)*(?:create|generate|make|draw|design|render|paint|produce)\\s+(?:me\\s+|us\\s+)?(?:an?\\s+|the\\s+|some\\s+|one\\s+)?`;
/** "create an image of a cat" / "make a short video: sunrise over hills" */
const NOUN_THEN_SUBJECT = new RegExp(
  `${LEAD}(?:[\\w-]+\\s+){0,2}?(${IMAGE_NOUNS}|${VIDEO_NOUNS})s?\\s*(?:of|for|about|showing|that shows|where|:|-)\\s*([\\s\\S]+)$`,
  "i",
);
/** "generate a cute cat image" — the noun must end the request. */
const SUBJECT_THEN_NOUN = new RegExp(`${LEAD}((?:[\\w'-]+\\s+){1,8}?)(${IMAGE_NOUNS}|${VIDEO_NOUNS})s?[.!]?$`, "i");

function aspectFrom(text: string, kind: MediaRequest["kind"]): MediaRequest["aspect"] {
  if (/\b(vertical|portrait|story|reel|shorts|9:16|phone wallpaper|mobile)\b/i.test(text)) return "9:16";
  if (/\b(landscape|wide|widescreen|banner|youtube thumbnail|16:9|desktop wallpaper)\b/i.test(text)) return "16:9";
  if (kind === "video") return "16:9";
  if (/\b4:3\b/.test(text)) return "4:3";
  if (/\b3:4\b/.test(text)) return "3:4";
  return "1:1";
}

/**
 * "/image …", "/video …", or plain requests like "create an image of a cat".
 * With `slashOnly` (coding workspace), only the slash commands count, so
 * "create an image component" still goes to the coding agent.
 */
export function parseMediaRequest(text: string, slashOnly = false): MediaRequest | null {
  const t = text.trim();
  const slash = /^\/(image|img|picture|video|vid)\b\s*([\s\S]*)$/i.exec(t);
  if (slash) {
    const kind = /^vid/i.test(slash[1]) ? "video" : "image";
    const prompt = slash[2].trim();
    return prompt ? { kind, prompt, aspect: aspectFrom(prompt, kind) } : null;
  }
  if (slashOnly) return null;
  const a = NOUN_THEN_SUBJECT.exec(t);
  const b = a ? null : SUBJECT_THEN_NOUN.exec(t);
  if (!a && !b) return null;
  const noun = (a ? a[1] : b![2]).toLowerCase();
  const subject = (a ? a[2] : b![1]).trim();
  const kind = new RegExp(`^(${VIDEO_NOUNS})$`, "i").test(noun) ? "video" : "image";
  if (subject.length < 3) return null;
  const prompt = kind === "image" && /logo|poster|icon|banner|thumbnail|wallpaper|sketch|painting|drawing/.test(noun) ? `${noun}: ${subject}` : subject;
  return { kind, prompt, aspect: aspectFrom(t, kind) };
}
