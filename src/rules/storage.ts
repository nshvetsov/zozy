import { normalizeRuleEntry, type RuleEntry } from "./domain";

export interface LegacyGlossaryEntry {
  original: string;
  replacements: string[];
  preferred?: string;
  type?: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
}

export const USER_RULES_KEY = "user_rules";
export const USER_GLOSSARY_KEY = "user_glossary";

export function loadRulesUser(storage: Pick<Storage, "getItem">): RuleEntry[] {
  const storedRulesRaw = storage.getItem(USER_RULES_KEY);
  if (storedRulesRaw) {
    try {
      const storedRules = JSON.parse(storedRulesRaw) as RuleEntry[];
      if (Array.isArray(storedRules) && storedRules.length) {
        return storedRules
          .map((item) => normalizeRuleEntry(item))
          .filter((item): item is RuleEntry => Boolean(item));
      }
    } catch {
      // keep legacy fallback below
    }
  }

  const legacyGlossaryRaw = storage.getItem(USER_GLOSSARY_KEY);
  if (!legacyGlossaryRaw) return [];
  try {
    const legacyGlossary = JSON.parse(legacyGlossaryRaw) as LegacyGlossaryEntry[];
    if (!Array.isArray(legacyGlossary) || !legacyGlossary.length) return [];
    return legacyGlossary
      .map((item) => normalizeRuleEntry({
        phrase: item.original,
        mode: "deny",
        reason: "",
        replacements: item.replacements,
      }))
      .filter((item): item is RuleEntry => Boolean(item));
  } catch {
    return [];
  }
}

export function saveRulesUser(storage: Pick<Storage, "setItem">, rules: RuleEntry[]) {
  storage.setItem(USER_RULES_KEY, JSON.stringify(rules));
}
