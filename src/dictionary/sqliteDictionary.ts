import type { Database } from "sql.js";
import { russianStem } from "../russianStem";

const BATCH = 50;

export interface CyrillicSqliteLookup {
  allowsNormalizedBatch(normalizedWords: string[]): Set<string>;
}

/**
 * Exact headword_norm, compound_markup / compound_components, then stem index (Russian Snowball).
 */
export class DictionarySqlite implements CyrillicSqliteLookup {
  private readonly stemOfHeadword = new Set<string>();
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    this.buildStemIndex();
  }

  private buildStemIndex(): void {
    const res = this.db.exec("SELECT headword_norm FROM headwords");
    if (!res.length) return;
    const colIdx = res[0]!.columns.indexOf("headword_norm");
    if (colIdx < 0) return;
    for (const row of res[0]!.values) {
      const hw = row[colIdx];
      if (typeof hw === "string" && hw.length) {
        this.stemOfHeadword.add(russianStem(hw));
      }
    }
  }

  private selectIn(table: string, column: string, words: string[]): Set<string> {
    const found = new Set<string>();
    if (!words.length) return found;
    for (let i = 0; i < words.length; i += BATCH) {
      const chunk = words.slice(i, i + BATCH);
      const ph = chunk.map(() => "?").join(",");
      const sql = `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IN (${ph})`;
      const stmt = this.db.prepare(sql);
      stmt.bind(chunk);
      while (stmt.step()) {
        const row = stmt.get()[0];
        if (typeof row === "string") found.add(row);
      }
      stmt.free();
    }
    return found;
  }

  allowsNormalizedBatch(normalizedWords: string[]): Set<string> {
    const allowed = new Set<string>();
    const unique = [...new Set(normalizedWords.filter((w) => w.length > 0))];
    if (!unique.length) return allowed;

    const exact = this.selectIn("headwords", "headword_norm", unique);
    exact.forEach((w) => allowed.add(w));

    const noExact = unique.filter((w) => !allowed.has(w));
    if (noExact.length) {
      const compoundHead = this.selectIn("compound_markup", "headword_norm", noExact);
      compoundHead.forEach((w) => allowed.add(w));

      const still = noExact.filter((w) => !allowed.has(w));
      if (still.length) {
        const compoundComp = this.selectIn("compound_components", "component_norm", still);
        compoundComp.forEach((w) => allowed.add(w));
      }
    }

    const noMeta = unique.filter((w) => !allowed.has(w));
    for (const w of noMeta) {
      if (this.stemOfHeadword.has(russianStem(w))) {
        allowed.add(w);
      }
    }

    return allowed;
  }
}
