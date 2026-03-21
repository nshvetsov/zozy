import type { CheckJob } from "./types";

export interface CsvViolationRow {
  source_type: "file" | "url";
  source_name: string;
  source_value: string;
  job_status: string;
  word: string;
  type: string;
  start: number;
  end: number;
  risk: string;
  norm: string;
  norm_url: string;
  replacement_1: string;
  replacement_2: string;
  replacement_3: string;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function toCsv(rows: CsvViolationRow[]): string {
  if (!rows.length) {
    return [
      "source_type,source_name,source_value,job_status,word,type,start,end,risk,norm,norm_url,replacement_1,replacement_2,replacement_3",
    ].join("\n");
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsv(String(row[header as keyof CsvViolationRow] ?? ""))).join(","));
  });
  return lines.join("\n");
}

export function buildViolationsCsvUtf8Sig(jobs: CheckJob[]): string {
  const rows: CsvViolationRow[] = [];
  jobs.forEach((job) => {
    job.violations.forEach((violation) => {
      rows.push({
        source_type: job.sourceType,
        source_name: job.sourceName,
        source_value: job.sourceValue,
        job_status: job.status,
        word: violation.word,
        type: violation.type,
        start: violation.position.start,
        end: violation.position.end,
        risk: violation.risk,
        norm: violation.norm,
        norm_url: violation.normUrl ?? "",
        replacement_1: violation.replacements[0] ?? "",
        replacement_2: violation.replacements[1] ?? "",
        replacement_3: violation.replacements[2] ?? "",
      });
    });
  });
  return `\uFEFF${toCsv(rows)}`;
}
