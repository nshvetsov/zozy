import { normalizeRuleEntry, type RuleEntry } from "./domain";

function stripQuotes(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(stripQuotes);
  return lines.slice(1).map((line) => {
    const parts = line.split(",").map(stripQuotes);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = parts[idx] ?? "";
    });
    return row;
  });
}

function toCsvRows(rows: Array<Record<string, string>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escape(row[header] ?? "")).join(","));
  });
  return lines.join("\n");
}

export function parseRulesCsv(content: string): RuleEntry[] {
  const rows = parseCsv(content);
  if (!rows.length) return [];
  const hasNewFormat = "phrase" in rows[0] || "mode" in rows[0];
  if (hasNewFormat) {
    return rows
      .map((row) => normalizeRuleEntry({
        phrase: row.phrase ?? "",
        mode: row.mode === "deny" ? "deny" : "allow",
        reason: row.reason ?? "",
        applyToInflections: row.apply_to_inflections === "1" || row.apply_to_inflections === "true",
        replacements: (row.replacements ?? "")
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean),
      }))
      .filter((item): item is RuleEntry => Boolean(item));
  }
  return rows
    .map((row) => normalizeRuleEntry({
      phrase: row.original ?? "",
      mode: "deny",
      reason: "",
      applyToInflections: false,
      replacements: (row.replacements ?? "")
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean),
    }))
    .filter((item): item is RuleEntry => Boolean(item));
}

export function buildRulesCsv(rules: RuleEntry[]): string {
  const rows = rules.map((item) => ({
    phrase: item.phrase,
    mode: item.mode,
    reason: item.reason,
    apply_to_inflections: item.applyToInflections ? "1" : "0",
    replacements: item.replacements.join("|"),
  }));
  return toCsvRows(rows);
}
