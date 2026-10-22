/** Style presets for image generation, shared by the chat and the Image Studio. */

export type ImageStyleId = "none" | "photo" | "illustration" | "anime" | "3d" | "watercolor" | "pixel" | "sketch" | "poster";

export const IMAGE_STYLES: { id: ImageStyleId; label: string; suffix: string; words: RegExp }[] = [
  { id: "none", label: "Auto", suffix: "", words: /$^/ },
  { id: "photo", label: "Photo", suffix: "photorealistic photograph, natural light, sharp focus, 35mm, high detail", words: /\b(photo(?:graph)?|realistic|photorealistic)\b/i },
  { id: "illustration", label: "Illustration", suffix: "clean digital illustration, vibrant colors, crisp shapes", words: /\b(illustration|illustrated|cartoon)\b/i },
  { id: "anime", label: "Anime", suffix: "anime style, studio quality, expressive lighting, detailed background", words: /\b(anime|manga)\b/i },
  { id: "3d", label: "3D", suffix: "3D render, soft global illumination, octane, smooth materials", words: /\b(3d|three.?d|render(?:ed)?|pixar)\b/i },
  { id: "watercolor", label: "Watercolor", suffix: "watercolor painting, soft washes, textured paper", words: /\b(watercolou?r|painting|painted)\b/i },
  { id: "pixel", label: "Pixel art", suffix: "pixel art, 32-bit, crisp pixels, limited palette", words: /\b(pixel(?:\s*art)?|8.?bit|16.?bit)\b/i },
  { id: "sketch", label: "Sketch", suffix: "pencil sketch, hand-drawn lines, cross-hatching, paper texture", words: /\b(sketch|pencil|drawing|line art)\b/i },
  { id: "poster", label: "Poster", suffix: "bold graphic poster design, strong composition, clean typography space", words: /\b(poster|flyer|banner)\b/i },
];

export function isImageStyle(id: unknown): id is ImageStyleId {
  return IMAGE_STYLES.some((s) => s.id === id);
}

/** Style implied by the words of a request ("an anime cat" → anime), or "none". */
export function detectStyle(text: string): ImageStyleId {
  return IMAGE_STYLES.find((s) => s.id !== "none" && s.words.test(text))?.id ?? "none";
}

export function applyStyle(prompt: string, style: ImageStyleId): string {
  const s = IMAGE_STYLES.find((x) => x.id === style);
  return s?.suffix ? `${prompt.trim().replace(/[.,;]+$/, "")}, ${s.suffix}` : prompt.trim();
}
