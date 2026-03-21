export type CheckJobStatus =
  | "pending"
  | "loading"
  | "checking"
  | "done"
  | "error"
  | "cancelled";

export type CheckJobSourceType = "file" | "url";

export interface JobViolation {
  id?: string;
  word: string;
  position: { start: number; end: number };
  source: "email_text";
  type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT" | "TECH_ABBREV";
  risk: "HIGH" | "MEDIUM" | "LOW";
  norm: string;
  normUrl?: string;
  replacements: string[];
}

export interface JobCheckedWord {
  id: string;
  word: string;
  normalized: string;
  start: number;
  end: number;
}

export interface CheckJob {
  id: string;
  sourceType: CheckJobSourceType;
  sourceName: string;
  sourceValue: string;
  sourceFile?: File;
  html: string;
  plainText: string;
  status: CheckJobStatus;
  progressLabel: string;
  violations: JobViolation[];
  checkedWords: JobCheckedWord[];
  errorMessage?: string;
  createdAt: string;
}
