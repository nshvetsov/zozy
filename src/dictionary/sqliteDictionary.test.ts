// @vitest-environment node
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DictionarySqlite } from "./sqliteDictionary";
import { normalizeForSearch } from "./normalizeForSearch";
import { russianStem } from "../russianStem";

const distDir = join(fileURLToPath(new URL("../../node_modules/sql.js/dist/", import.meta.url)));

async function openEmptyDb() {
  const SQL = await initSqlJs({ locateFile: (f: string) => join(distDir, f) });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE headwords (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      dictionary_id INTEGER NOT NULL,
      headword_display TEXT NOT NULL,
      headword_norm TEXT NOT NULL
    );
    CREATE TABLE compound_markup (
      id INTEGER PRIMARY KEY,
      headword_norm TEXT NOT NULL,
      component_id INTEGER NOT NULL,
      remainder_norm TEXT NOT NULL,
      confidence TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_dictionaries_json TEXT NOT NULL,
      component_evidence_count INTEGER NOT NULL
    );
    CREATE TABLE compound_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_norm TEXT NOT NULL UNIQUE,
      evidence_count INTEGER NOT NULL,
      evidence_types_json TEXT NOT NULL,
      source_dictionaries_json TEXT NOT NULL
    );
  `);
  return db;
}

describe("DictionarySqlite", () => {
  it("tier A exact headword_norm", async () => {
    const db = await openEmptyDb();
    db.run("INSERT INTO headwords VALUES (1, 1, 1, 'стол', 'стол')");
    const dict = new DictionarySqlite(db);
    const w = normalizeForSearch("стол");
    expect(dict.allowsNormalizedBatch([w]).has(w)).toBe(true);
    expect(dict.allowsNormalizedBatch([normalizeForSearch("неттакого")]).size).toBe(0);
    db.close();
  });

  it("tier C stem match for inflected form", async () => {
    const db = await openEmptyDb();
    db.run("INSERT INTO headwords VALUES (1, 1, 1, 'стол', 'стол')");
    const dict = new DictionarySqlite(db);
    const forma = normalizeForSearch("стола");
    expect(forma.length).toBeGreaterThan(0);
    expect(russianStem(forma)).toBe(russianStem("стол"));
    expect(dict.allowsNormalizedBatch([forma]).has(forma)).toBe(true);
    db.close();
  });

  it("tier B compound headword_norm", async () => {
    const db = await openEmptyDb();
    db.run("INSERT INTO compound_components VALUES (1, 'свет', 1, '[]', '[]')");
    db.run(
      `INSERT INTO compound_markup VALUES (1, 'светофор', 1, 'офор', 'high', 'test', '[]', 1)`,
    );
    const dict = new DictionarySqlite(db);
    const w = normalizeForSearch("светофор");
    expect(dict.allowsNormalizedBatch([w]).has(w)).toBe(true);
    db.close();
  });

  it("tier B component_norm", async () => {
    const db = await openEmptyDb();
    db.run("INSERT INTO compound_components VALUES (1, 'подстрочник', 1, '[]', '[]')");
    const dict = new DictionarySqlite(db);
    const w = normalizeForSearch("подстрочник");
    expect(dict.allowsNormalizedBatch([w]).has(w)).toBe(true);
    db.close();
  });
});
