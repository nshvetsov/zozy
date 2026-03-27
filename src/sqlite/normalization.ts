const LOOKALIKE_MAP: Record<string, string> = {
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

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .split("")
    .map((ch) => LOOKALIKE_MAP[ch] ?? ch)
    .join("")
    .replace(/[\u0300\u0301]/g, "")
    .replaceAll("ё", "е")
    .replace(/[^а-я0-9\- ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
