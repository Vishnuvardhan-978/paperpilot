/** Browser text-to-speech for tutor answers. */

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
}

export function speakText(text: string, opts?: { rate?: number }) {
  if (!canSpeak()) return false;
  stopSpeaking();
  const clean = text
    .replace(/#{1,6}\s*/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/SOURCES:[\s\S]*$/i, "")
    .replace(/KEY POINTS:[\s\S]*?(?=ASK NEXT:|ACTIONS:|CONFIDENCE:|SOURCES:|$)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
  if (!clean) return false;
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = opts?.rate ?? 1;
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
  return true;
}
