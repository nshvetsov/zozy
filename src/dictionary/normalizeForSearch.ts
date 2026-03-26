const LATIN_LOOKALIKE: Record<string, string> = {
  a: "а",
  b: "в",
  c: "с",
  e: "е",
  h: "н",
  k: "к",
  m: "м",
  o: "о",
  p: "р",
  t: "т",
  x: "х",
  y: "у",
};

const COMBINING_ACCENT = /[\u0300\u0301]/g;

/** Behavior-compatible with normalization-contract.md (Python normalize_for_search). */
export function normalizeForSearch(text: string): string {
  let s = text.normalize("NFC").toLowerCase();
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    const mapped = LATIN_LOOKALIKE[ch];
    out += mapped ?? ch;
  }
  s = out.replace(COMBINING_ACCENT, "");
  s = s.replaceAll("ё", "е");
  s = s.replace(/[^а-я0-9\- ]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
