// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { runCheckJob } from "./jobRunner";
import type { CheckJob } from "./types";

async function createTestDb() {
  const SQL = await initSqlJs({
    locateFile: () => "node_modules/sql.js/dist/sql-wasm.wasm",
  });
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE dictionaries (id INTEGER PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE entries (id INTEGER PRIMARY KEY, dictionary_id INTEGER NOT NULL, source_pdf TEXT NOT NULL, page_start INTEGER NOT NULL, page_end INTEGER NOT NULL, entry_text_clean TEXT NOT NULL, warnings_json TEXT NOT NULL);
    CREATE TABLE headwords (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, dictionary_id INTEGER NOT NULL, headword_display TEXT NOT NULL, headword_norm TEXT NOT NULL);
    INSERT INTO dictionaries(id, code, title) VALUES (1, 'orto', 'Орфографический словарь');
    INSERT INTO entries(id, dictionary_id, source_pdf, page_start, page_end, entry_text_clean, warnings_json)
      VALUES (1, 1, 'test.pdf', 10, 10, 'скидка', '[]'),
             (2, 1, 'test.pdf', 12, 12, 'авто', '[]'),
             (3, 1, 'test.pdf', 13, 13, 'химия', '[]'),
             (4, 1, 'test.pdf', 14, 14, 'бренд', '[]');
    INSERT INTO headwords(entry_id, dictionary_id, headword_display, headword_norm)
      VALUES (1, 1, 'скидка', 'скидка'),
             (2, 1, 'авто', 'авто'),
             (3, 1, 'химия', 'химия'),
             (4, 1, 'бренд', 'бренд');
  `);
  return db;
}

describe("runCheckJob", () => {
  it("marks latin words as violations and keeps dictionary words", async () => {
    const db = await createTestDb();

    const job: CheckJob = {
      id: "job-1",
      sourceType: "file",
      sourceName: "mail.html",
      sourceValue: "mail.html",
      sourceFile: new File(["<html><body>Скидка VR</body></html>"], "mail.html", { type: "text/html" }),
      html: "",
      plainText: "",
      status: "pending",
      progressLabel: "",
      violations: [],
      checkedWords: [],
      createdAt: new Date().toISOString(),
    };

    const result = await runCheckJob(job, {
      db,
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map(),
      rules: [],
      allowTerms: [],
    });

    expect(result.plainText.toLowerCase()).toContain("скидка");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("LAT_PROHIBITED");
    expect(result.checkedWords.some((item) => item.word.toLowerCase() === "скидка")).toBe(true);
  });

  it("applies allow terms and suppresses missing-word violation", async () => {
    const db = await createTestDb();

    const job: CheckJob = {
      id: "job-allow-1",
      sourceType: "url",
      sourceName: "mail-1",
      sourceValue: "https://example.com/mail-1",
      html: "<html><body>Скидка VR</body></html>",
      plainText: "",
      status: "pending",
      progressLabel: "",
      violations: [],
      checkedWords: [],
      createdAt: new Date().toISOString(),
    };

    const result = await runCheckJob(job, {
      db,
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map(),
      rules: [],
      allowTerms: ["vr"],
    });

    expect(result.violations).toEqual([]);
    expect(result.checkedWords.some((item) => item.word === "VR")).toBe(true);
  });

  it("applies deny rule over dictionary match", async () => {
    const db = await createTestDb();

    const job: CheckJob = {
      id: "job-deny-1",
      sourceType: "file",
      sourceName: "mail.html",
      sourceValue: "mail.html",
      sourceFile: new File(["<html><body>Скидка VR</body></html>"], "mail.html", { type: "text/html" }),
      html: "",
      plainText: "",
      status: "pending",
      progressLabel: "",
      violations: [],
      checkedWords: [],
      createdAt: new Date().toISOString(),
    };

    const result = await runCheckJob(job, {
      db,
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map([
        [
          "скидка",
          {
            original: "скидка",
            preferred: "выгода",
            replacements: ["выгода"],
            type: "CYR_NOT_IN_DICT",
          },
        ],
      ]),
      rules: [
        {
          phrase: "скидка",
          mode: "deny",
          reason: "policy",
          replacements: ["выгода"],
          applyToInflections: false,
        },
      ],
      allowTerms: [],
    });

    expect(result.violations.some((item) => item.word.toLowerCase() === "скидка")).toBe(true);
    expect(result.checkedWords.some((item) => item.word.toLowerCase() === "скидка")).toBe(false);
  });
});
