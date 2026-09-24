import type { LensId } from "@/lib/lenses";
import type { AskScope } from "@/lib/scopes";

const LENS_KEY = "paperpilot-lens";
const SCOPE_KEY = "paperpilot-scope";
const VALID: LensId[] = ["kid", "study", "normal", "proof", "bridge"];
const VALID_SCOPE: AskScope[] = ["docs", "library", "open"];

export function getSavedLens(): LensId {
  if (typeof window === "undefined") return "normal";
  try {
    const v = localStorage.getItem(LENS_KEY) as LensId | null;
    if (v && VALID.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "normal";
}

export function saveLens(lens: LensId) {
  try {
    localStorage.setItem(LENS_KEY, lens);
  } catch {
    /* ignore */
  }
}

export function getSavedScope(): AskScope {
  if (typeof window === "undefined") return "docs";
  try {
    const v = localStorage.getItem(SCOPE_KEY) as AskScope | null;
    if (v && VALID_SCOPE.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "docs";
}

export function saveScope(scope: AskScope) {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* ignore */
  }
}
