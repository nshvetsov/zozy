import "./style.css";
import { buildHtmlPreviewModel } from "./htmlPreview";
import { recognizeImageText, type BrowserOcrResult } from "./browserOcr";
import { extractHtmlImages, type HtmlImageAsset } from "./htmlImages";
import { buildViolationsCsvUtf8Sig } from "./batch/exportViolationsCsv";
import { runCheckJob } from "./batch/jobRunner";
import type { CheckJob } from "./batch/types";
import {
  renderImageOverlays,
  type ImageOverlayAsset,
  type ImageOverlayHandle,
  type ImageViolationRange,
} from "./imageOverlay";
import { renderPreviewWithOverlay, type OverlayRange, type PreviewRenderHandle } from "./previewOverlay";
import { russianStem } from "./russianStem";
import { buildRulesCsv, parseRulesCsv } from "./rules/csv";
import { buildRulesContext, normalizeRulePhrase, type RuleEntry } from "./rules/domain";
import { loadRulesUser, saveRulesUser } from "./rules/storage";
import { verifyWord } from "./sqlite/engine";
import { ensureLookupDb, getLookupDbVersion, type LookupProgress } from "./sqlite/runtime";
import type { Database } from "sql.js";

type ViolationType = "LAT_PROHIBITED" | "CYR_NOT_IN_DICT" | "TECH_ABBREV";
type SourceType = "email_text" | "image_text";

interface GlossaryEntry {
  original: string;
  replacements: string[];
  preferred: string;
  type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
}

interface TrademarkEntry {
  name: string;
  type: "trademark";
  registration?: string;
  note?: string;
}

interface NormEntry {
  code: ViolationType;
  norm: string;
  url: string;
}

interface ParsedDictionary {
  words: Record<string, string[]>;
  stems?: Record<string, boolean>;
}

interface TechAbbrevData {
  abbreviations: string[];
}

interface Token {
  raw: string;
  normalized: string;
  start: number;
  end: number;
}

interface PhraseMatch {
  phrase: string;
  startTokenIdx: number;
  endTokenIdx: number;
  start: number;
  end: number;
}

interface Violation {
  id?: string;
  word: string;
  position: { start: number; end: number };
  source: SourceType;
  sourceDetails?: string;
  imageAssetId?: string;
  type: ViolationType;
  risk: "HIGH" | "MEDIUM" | "LOW";
  norm: string;
  normUrl?: string;
  replacements: string[];
  explanation?: string;
  uncertain?: boolean;
}

interface OcrImageAssetState extends HtmlImageAsset {
  recognizedText: string;
  ocrConfidence?: number;
  ocrWords: BrowserOcrResult["words"];
  imageWidth?: number;
  imageHeight?: number;
  violations: Violation[];
}

interface CheckedWord {
  id: string;
  word: string;
  normalized: string;
  start: number;
  end: number;
  statusLabel?: string;
  details?: string;
  uncertain?: boolean;
}

interface ViolationUiText {
  issueTitle: string;
  legalSeverityLabel: string;
  confidenceLabel: string;
}

interface CheckResult {
  violations: Violation[];
  correctedText: string;
}

interface HistoryEntry {
  id: string;
  createdAt: string;
  emailText: string;
  combinedViolations: Violation[];
  correctedEmailText: string;
}

interface LegacyHistoryEntry {
  id?: string;
  createdAt?: string;
  emailText?: string;
  imageText?: string;
  combinedViolations?: Violation[];
  correctedEmailText?: string;
  correctedImageText?: string;
  result?: {
    combinedViolations?: Violation[];
    email?: { corrected_text?: string };
    images?: { corrected_text?: string };
  };
}

const HISTORY_KEY = "checks_history";
const URL_SOURCE_PROXY_ENDPOINT = "https://functions.yandexcloud.net/d4efv16nna2p2eiie8cb";

const rootCandidate = document.querySelector<HTMLDivElement>("#app");
if (!rootCandidate) throw new Error("Root element #app not found");
const root: HTMLDivElement = rootCandidate;

const state = {
  dictionary: null as ParsedDictionary | null,
  techAbbrev: null as TechAbbrevData | null,
  glossaryBuiltIn: [] as GlossaryEntry[],
  rulesUser: loadRulesUser(localStorage),
  trademarksBuiltIn: [] as TrademarkEntry[],
  norms: [] as NormEntry[],
  history: loadHistoryEntries(),
  lookupDb: null as Database | null,
  lookupDbReady: false,
  lookupDbVersion: "",
  lookupDbLoading: false,
  lookupDbProgressLabel: "",
  jobs: [] as CheckJob[],
  selectedJobId: null as string | null,
  emailText: "",
  combinedViolations: [] as Violation[],
  checkedWords: [] as CheckedWord[],
  correctedEmailText: "",
  previewModel: null as ReturnType<typeof buildHtmlPreviewModel> | null,
  hasChecked: false,
  isChecking: false,
  checkProgressLabel: "",
  ocrAssets: [] as OcrImageAssetState[],
  ocrInProgress: false,
  showCheckedWords: true,
  collapsedGroups: new Set<string>(),
};

root.innerHTML = `
  <main class="layout">
    <nav class="tabs">
      <button data-tab-btn="checker" class="active">Проверка</button>
      <div class="nav-spacer"></div>
      <div class="nav-right">
        <div class="nav-utilities">
          <span id="statusDot" class="status-dot hidden" aria-label="Статус сервиса"></span>
          <div class="nav-api-key">
            <span id="apiKeyNavDisplay"></span>
            <button id="apiKeyNavEditBtn" type="button" class="btn-ghost icon-btn" aria-label="Обновить словарную базу">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4l10.4-10.4-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                <path d="M12.9 6.6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
            <div id="apiKeyDetails" class="api-key-popup hidden"></div>
          </div>
        </div>
        <div class="nav-menu">
          <button data-tab-btn="rules" type="button">Правила</button>
          <button data-tab-btn="history" type="button">История</button>
        </div>
      </div>
    </nav>

    <section data-tab="checker" class="panel panel--flat">
      <label class="field">
        <textarea id="urlListInput" rows="2" placeholder="https://example.com/mail-1"></textarea>
      </label>
      <div class="html-source-toggles">
        <button id="manualHtmlToggleBtn" type="button" class="btn-ghost btn-sm">вставить HTML вручную</button>
        <button id="sourceFileToggleBtn" type="button" class="btn-ghost btn-sm">загрузить HTML файлы</button>
        <div class="mindbox-upload">
          <button id="templateCsvToggleBtn" type="button" class="btn-ghost btn-sm">загрузить CSV (Mindbox)</button>
          <button
            type="button"
            class="legend-help mindbox-help"
            title="Аналитика → Рассылки → Сводные показатели → Выбрать канал «Email» и тип рассылки «Автоматические» → Выбрать даты, в которых работали триггеры, которые интересуют, например, последние 30 дней → Выгрузить через кнопку «Экспорт в .csv»"
            aria-label="Подсказка по CSV Mindbox"
          >?</button>
        </div>
      </div>
      <div id="manualHtmlArea" class="hidden">
        <label class="field">
          <textarea id="emailText" rows="9" placeholder="Вставьте текст или HTML-код письма..."></textarea>
        </label>
      </div>
      <input id="sourceFile" class="hidden" type="file" accept=".html,text/html" multiple />
      <input id="templateCsvFile" class="hidden" type="file" accept=".csv,text/csv" />
      <div class="actions">
        <button id="runCheckBtn">Проверить</button>
        <button id="stopCheckBtn" type="button" class="hidden btn-stop">Остановить проверку</button>
        <button id="exportViolationsCsvBtn" type="button" class="hidden">Скачать отчёт (.csv)</button>
        <button id="runImageOcrBtn" type="button" class="hidden">Распознать текст на изображениях</button>
      </div>
      <div id="checkProgress" class="check-progress hidden">
        <div id="checkProgressBar" class="check-progress-bar"></div>
      </div>
      <div class="single-word-checker">
        <div class="single-word-row">
          <input id="singleWordInput" placeholder="Проверка одного слова" />
          <button id="runSingleWordBtn" type="button" class="btn-sm">Проверить слово</button>
        </div>
        <div id="singleWordResult" class="hint hidden"></div>
      </div>
      <section id="queueSection" class="queue-section hidden">
        <ul id="jobsList" class="list violations-list"></ul>
      </section>
      <div id="ocrStatus" class="ocr-status hidden"></div>
      <div id="techHint" class="hint hidden"></div>
      <div id="checkerSplit" class="checker-split no-preview hidden">
        <section id="emailPreviewBlock" class="preview hidden">
          <div id="previewHint" class="preview-hint">Введите HTML и нажмите «Проверить», чтобы увидеть подсветку.</div>
          <iframe id="emailPreviewFrame" class="preview-frame" sandbox="allow-same-origin" scrolling="no"></iframe>
        </section>
        <section id="violationsPanel" class="violations-panel">
          <div class="violations-toolbar">
            <span id="violationsCounter" class="badge">0</span>
          </div>
          <ul id="violationsList" class="list violations-list"></ul>
        </section>
      </div>
    </section>

    <section data-tab="rules" class="panel panel--flat hidden secondary-tab">
      <h1>Правила слов и словосочетаний</h1>
      <div class="secondary-form rules-form">
        <input id="rulePhrase" placeholder="слово или словосочетание" />
        <select id="ruleMode">
          <option value="allow">можно использовать</option>
          <option value="deny">нельзя использовать</option>
        </select>
        <input id="ruleReason" placeholder="причина" />
        <input id="ruleReplacements" placeholder="замены через запятую (для 'нельзя')" />
        <label class="rules-inflection-toggle">
          <input id="ruleApplyToInflections" type="checkbox" />
          учитывать словоформы (через лемму)
        </label>
        <button id="addRuleBtn" class="btn-sm">Сохранить</button>
      </div>
      <div class="secondary-toolbar">
        <span id="rulesCount" class="badge">0 записей</span>
        <button id="exportRulesCsvBtn" type="button" class="btn-ghost btn-sm">Экспорт CSV</button>
        <label class="file btn-sm">
          Импорт CSV
          <input id="importRulesCsvInput" type="file" accept=".csv,text/csv" />
        </label>
      </div>
      <div class="secondary-hint">Записи из старых «Мои ТЗ» при необходимости перенесите вручную.</div>
      <section class="violations-panel secondary-list-panel">
        <ul id="rulesRows" class="list violations-list"></ul>
      </div>
    </section>

    <section data-tab="history" class="panel panel--flat hidden secondary-tab">
      <h1>История проверок</h1>
      <div class="secondary-toolbar">
        <span id="historyCount" class="badge">0 записей</span>
      </div>
      <section class="violations-panel secondary-list-panel">
        <ul id="historyRows" class="list violations-list"></ul>
      </section>
    </section>
  </main>
`;

const apiKeyNavDisplay = queryEl<HTMLSpanElement>("#apiKeyNavDisplay");
const apiKeyNavEditBtn = queryEl<HTMLButtonElement>("#apiKeyNavEditBtn");
const urlListInput = queryEl<HTMLTextAreaElement>("#urlListInput");
const emailInput = queryEl<HTMLTextAreaElement>("#emailText");
const manualHtmlToggleBtn = queryEl<HTMLButtonElement>("#manualHtmlToggleBtn");
const manualHtmlArea = queryEl<HTMLDivElement>("#manualHtmlArea");
const sourceFileToggleBtn = queryEl<HTMLButtonElement>("#sourceFileToggleBtn");
const templateCsvToggleBtn = queryEl<HTMLButtonElement>("#templateCsvToggleBtn");
const templateCsvFileInput = queryEl<HTMLInputElement>("#templateCsvFile");
const sourceFileInput = queryEl<HTMLInputElement>("#sourceFile");
const runCheckBtn = queryEl<HTMLButtonElement>("#runCheckBtn");
const stopCheckBtn = queryEl<HTMLButtonElement>("#stopCheckBtn");
const exportViolationsCsvBtn = queryEl<HTMLButtonElement>("#exportViolationsCsvBtn");
const runImageOcrBtn = queryEl<HTMLButtonElement>("#runImageOcrBtn");
const statusDot = queryEl<HTMLSpanElement>("#statusDot");
const checkProgress = queryEl<HTMLDivElement>("#checkProgress");
const checkProgressBar = queryEl<HTMLDivElement>("#checkProgressBar");
const singleWordInput = queryEl<HTMLInputElement>("#singleWordInput");
const runSingleWordBtn = queryEl<HTMLButtonElement>("#runSingleWordBtn");
const singleWordResult = queryEl<HTMLDivElement>("#singleWordResult");
const ocrStatus = queryEl<HTMLDivElement>("#ocrStatus");
const techHint = queryEl<HTMLDivElement>("#techHint");
const violationsList = queryEl<HTMLUListElement>("#violationsList");
const violationsCounter = queryEl<HTMLSpanElement>("#violationsCounter");
const emailPreviewBlock = queryEl<HTMLElement>("#emailPreviewBlock");
const emailPreviewFrame = queryEl<HTMLIFrameElement>("#emailPreviewFrame");
const checkerSplit = queryEl<HTMLElement>("#checkerSplit");
const previewHint = queryEl<HTMLDivElement>("#previewHint");
const violationsPanel = queryEl<HTMLElement>("#violationsPanel");
const queueSection = queryEl<HTMLElement>("#queueSection");

const rulePhraseInput = queryEl<HTMLInputElement>("#rulePhrase");
const ruleModeInput = queryEl<HTMLSelectElement>("#ruleMode");
const ruleReasonInput = queryEl<HTMLInputElement>("#ruleReason");
const ruleReplacementsInput = queryEl<HTMLInputElement>("#ruleReplacements");
const ruleApplyToInflectionsInput = queryEl<HTMLInputElement>("#ruleApplyToInflections");
const addRuleBtn = queryEl<HTMLButtonElement>("#addRuleBtn");
const rulesRows = queryEl<HTMLUListElement>("#rulesRows");
const rulesCount = queryEl<HTMLSpanElement>("#rulesCount");
const exportRulesCsvBtn = queryEl<HTMLButtonElement>("#exportRulesCsvBtn");
const importRulesCsvInput = queryEl<HTMLInputElement>("#importRulesCsvInput");

const historyRows = queryEl<HTMLUListElement>("#historyRows");
const historyCount = queryEl<HTMLSpanElement>("#historyCount");
const jobsList = queryEl<HTMLUListElement>("#jobsList");
let previewHandle: PreviewRenderHandle | null = null;
let imageOverlayHandle: ImageOverlayHandle | null = null;
let previewRenderRevision = 0;
let activeCheckController: AbortController | null = null;
const RUN_CHECK_DEFAULT_LABEL = "Проверить";
const RUN_CHECK_BUSY_LABEL = "Проверка...";

attachEvents();
showStatus("warn", "Загрузка настроек...");
void init();
window.addEventListener("resize", syncViolationsHeightWithPreview);

function setCheckControls(inProgress: boolean) {
  runCheckBtn.disabled = inProgress || state.lookupDbLoading || !state.lookupDbReady;
  runCheckBtn.textContent = inProgress ? RUN_CHECK_BUSY_LABEL : RUN_CHECK_DEFAULT_LABEL;
  updateExportButtonState(inProgress);
  stopCheckBtn.classList.toggle("hidden", !inProgress);
}

function updateExportButtonState(inProgress: boolean) {
  const hasDoneJobs = state.jobs.some((job) => job.status === "done");
  exportViolationsCsvBtn.classList.toggle("hidden", !hasDoneJobs);
  exportViolationsCsvBtn.disabled = inProgress;
}

async function init() {
  try {
    const [glossary, trademarks, norms] = await Promise.all([
      fetchJson<GlossaryEntry[]>("data/glossary.json"),
      fetchJson<TrademarkEntry[]>("data/trademarks.json"),
      fetchJson<NormEntry[]>("data/norms.json"),
    ]);

    state.glossaryBuiltIn = glossary;
    state.trademarksBuiltIn = trademarks;
    state.norms = norms;
    renderStatus();
    renderRulesRows();
    renderHistoryRows();
    renderJobsList();
    await prepareLookupDb();
  } catch (error) {
    console.error("Init failed:", error);
    showStatus(
      "error",
      "✗ Не удалось загрузить данные. Обновите страницу или проверьте публикацию data/*.json",
    );
  }
}

function attachEvents() {
  root.querySelectorAll<HTMLButtonElement>("[data-tab-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      switchTab(button.dataset.tabBtn ?? "checker");
    });
  });

  apiKeyNavEditBtn.addEventListener("click", () => {
    void prepareLookupDb({ forceRefresh: true });
  });
  manualHtmlToggleBtn.addEventListener("click", () => {
    manualHtmlArea.classList.toggle("hidden");
    manualHtmlToggleBtn.textContent = manualHtmlArea.classList.contains("hidden")
      ? "вставить HTML вручную"
      : "скрыть HTML";
  });
  sourceFileToggleBtn.addEventListener("click", () => {
    sourceFileInput.click();
  });
  templateCsvToggleBtn.addEventListener("click", () => {
    templateCsvFileInput.click();
  });

  emailInput.addEventListener("input", () => {
    state.emailText = emailInput.value;
    state.hasChecked = false;
    state.combinedViolations = [];
    state.checkedWords = [];
    resetOcrState();
    renderViolations();
    void renderEmailPreview([], false);
  });

  sourceFileInput.addEventListener("change", () => {
    void enqueueSources({ includeUrls: false, warnIfEmpty: false });
  });
  templateCsvFileInput.addEventListener("change", () => {
    void importTemplateUrlsFromCsv();
  });

  runCheckBtn.addEventListener("click", () => {
    void runCheck();
  });
  runSingleWordBtn.addEventListener("click", () => {
    void runSingleWordCheck();
  });
  singleWordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSingleWordCheck();
    }
  });
  stopCheckBtn.addEventListener("click", () => {
    activeCheckController?.abort();
  });
  runImageOcrBtn.addEventListener("click", () => {
    void runImageOcr();
  });
  exportViolationsCsvBtn.addEventListener("click", () => {
    const csv = buildViolationsCsvUtf8Sig(state.jobs);
    downloadFile("violations.csv", csv, "text/csv;charset=utf-8");
  });

  ruleModeInput.addEventListener("change", syncRulesFormState);
  addRuleBtn.addEventListener("click", saveRuleFromForm);
  rulesRows.addEventListener("click", (event) => {
    const removeBtn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-rule]");
    if (!removeBtn) return;
    const key = removeBtn.dataset.removeRule ?? "";
    removeRuleByPhrase(key);
  });

  exportRulesCsvBtn.addEventListener("click", () => {
    downloadFile("user_rules.csv", buildRulesCsv(state.rulesUser));
  });

  importRulesCsvInput.addEventListener("change", async () => {
    const file = importRulesCsvInput.files?.[0];
    if (!file) return;
    try {
      const text = await readTextFile(file);
      const imported = parseRulesCsv(text);
      state.rulesUser = imported;
      saveRulesUser(localStorage, state.rulesUser);
      renderRulesRows();
      showNotice("ok", `Импортировано правил: ${state.rulesUser.length}.`);
    } catch (error) {
      console.error("Rules CSV import failed:", error);
      showNotice("error", "Не удалось импортировать CSV правил.");
    } finally {
      importRulesCsvInput.value = "";
    }
  });
  syncRulesFormState();
}

interface EnqueueOptions {
  includeUrls?: boolean;
  warnIfEmpty?: boolean;
}

interface AppendUrlJobsResult {
  addedCount: number;
  skippedDuplicates: number;
}

interface UrlSourceEntry {
  url: string;
  messageName?: string;
  messageLink?: string;
}

async function enqueueSources(options: EnqueueOptions = {}): Promise<number> {
  const includeUrls = options.includeUrls ?? true;
  const warnIfEmpty = options.warnIfEmpty ?? true;
  const files = Array.from(sourceFileInput.files ?? []).filter((file) =>
    file.name.toLowerCase().endsWith(".html"),
  );
  const urls = includeUrls
    ? urlListInput.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    : [];
  const urlEntries: UrlSourceEntry[] = urls.map((url) => ({ url }));

  if (!files.length && !urls.length) {
    if (warnIfEmpty) showNotice("warn", "Добавьте хотя бы один .html файл или URL.");
    return 0;
  }

  const now = new Date().toISOString();
  const jobsFromFiles: CheckJob[] = files.map((file) => ({
    id: crypto.randomUUID(),
    sourceType: "file",
    sourceName: file.name,
    sourceValue: file.name,
    sourceFile: file,
    html: "",
    plainText: "",
    status: "pending",
    progressLabel: "В очереди",
    violations: [],
    checkedWords: [],
    createdAt: now,
  }));
  const { addedCount: addedUrlsCount } = appendUrlJobs(urlEntries);
  state.jobs = [...state.jobs, ...jobsFromFiles];
  await ensureSelectedJob();
  if (includeUrls) {
    urlListInput.value = "";
  }
  sourceFileInput.value = "";
  renderJobsList();
  const addedCount = jobsFromFiles.length + addedUrlsCount;
  showNotice("ok", `Добавлено в очередь: ${addedCount}`);
  return addedCount;
}

async function ensureSelectedJob() {
  if (!state.selectedJobId && state.jobs.length) {
    state.selectedJobId = state.jobs[0].id;
    await selectJob(state.jobs[0].id);
  }
}

function appendUrlJobs(entries: UrlSourceEntry[]): AppendUrlJobsResult {
  const existing = new Set(
    state.jobs
      .filter((job) => job.sourceType === "url")
      .map((job) => normalizeUrlForDedup(job.sourceValue)),
  );
  const uniqueEntries: UrlSourceEntry[] = [];
  let skippedDuplicates = 0;

  entries.forEach((entry) => {
    const normalized = normalizeUrlForDedup(entry.url);
    if (!normalized) return;
    if (existing.has(normalized)) {
      skippedDuplicates += 1;
      return;
    }
    existing.add(normalized);
    uniqueEntries.push({
      url: entry.url.trim(),
      messageName: (entry.messageName ?? "").trim(),
      messageLink: (entry.messageLink ?? "").trim(),
    });
  });

  if (!uniqueEntries.length) {
    return { addedCount: 0, skippedDuplicates };
  }

  const now = new Date().toISOString();
  const jobsFromUrls: CheckJob[] = uniqueEntries.map((entry) => ({
    id: crypto.randomUUID(),
    sourceType: "url",
    sourceName: entry.messageName || entry.url,
    sourceValue: entry.url,
    sourceMessageName: entry.messageName || undefined,
    sourceMessageLink: entry.messageLink || undefined,
    html: "",
    plainText: "",
    status: "pending",
    progressLabel: "В очереди",
    violations: [],
    checkedWords: [],
    createdAt: now,
  }));
  state.jobs = [...state.jobs, ...jobsFromUrls];
  return { addedCount: jobsFromUrls.length, skippedDuplicates };
}

function normalizeUrlForDedup(value: string): string {
  return value.trim();
}

async function importTemplateUrlsFromCsv() {
  const file = templateCsvFileInput.files?.[0];
  if (!file) return;
  try {
    const content = await readTextFile(file, "utf-8");
    const parsed = parseTemplateUrlsCsv(content);
    if (!parsed.ok) {
      showNotice("error", parsed.error);
      return;
    }
    const { addedCount, skippedDuplicates } = appendUrlJobs(parsed.entries);
    await ensureSelectedJob();
    renderJobsList();
    if (!addedCount) {
      if (skippedDuplicates || parsed.skippedInvalid || parsed.skippedEmpty) {
        showNotice(
          "warn",
          `CSV обработан: новых ссылок нет (дубли: ${skippedDuplicates}, пустые: ${parsed.skippedEmpty}, некорректные: ${parsed.skippedInvalid}).`,
        );
      } else {
        showNotice("warn", "CSV обработан: валидных ссылок в столбце template не найдено.");
      }
      return;
    }
    showNotice(
      "ok",
      `Добавлено из CSV: ${addedCount} (дубли: ${skippedDuplicates}, пустые: ${parsed.skippedEmpty}, некорректные: ${parsed.skippedInvalid}).`,
    );
  } catch (error) {
    console.error("CSV template import failed:", error);
    showNotice("error", "Не удалось прочитать CSV-файл.");
  } finally {
    templateCsvFileInput.value = "";
  }
}

function renderJobsList() {
  jobsList.innerHTML = "";
  queueSection.classList.toggle("hidden", !state.jobs.length);
  updateExportButtonState(state.isChecking);
  if (!state.jobs.length) {
    return;
  }
  const fragment = document.createDocumentFragment();
  state.jobs.forEach((job) => {
    const li = document.createElement("li");
    li.className = "job-row";
    if (job.status === "done") li.classList.add("job-row--done");
    if (job.status === "error") li.classList.add("job-row--error");
    if (job.status === "loading" || job.status === "checking") li.classList.add("job-row--active");
    if (job.id === state.selectedJobId) li.classList.add("active-preview");
    const violationsCount = job.violations.length;
    const typeBadge = job.sourceType === "file" ? "html" : "url";
    const summary = job.status === "done" ? `${violationsCount} наруш.` : "";
    li.innerHTML = `
      <span class="job-source"><span class="job-type-badge">${typeBadge}</span>${escapeHtml(job.sourceName)}</span>
      <span class="job-summary">${summary}</span>
    `;
    li.title = job.progressLabel || "";
    li.addEventListener("click", () => {
      void selectJob(job.id);
    });
    fragment.appendChild(li);
  });
  jobsList.appendChild(fragment);
}

async function selectJob(jobId: string) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  state.selectedJobId = jobId;
  state.emailText = job.html || "";
  emailInput.value = state.emailText;
  state.combinedViolations = job.violations as Violation[];
  state.checkedWords = job.checkedWords as CheckedWord[];
  state.hasChecked = job.status === "done";
  renderJobsList();
  renderViolations();
  if (job.status === "done") {
    await renderEmailPreview(state.combinedViolations.filter((item) => item.source === "email_text"), true);
  } else {
    await renderEmailPreview([], false);
  }
}

async function runCheck() {
  if (state.isChecking) return;
  if (!state.lookupDbReady || !state.lookupDb) {
    showNotice("warn", "Словарная база ещё не готова. Дождитесь загрузки или обновите базу.");
    void prepareLookupDb();
    return;
  }
  await enqueueSources({ includeUrls: true, warnIfEmpty: false });
  const pendingJobs = state.jobs.filter((job) => job.status === "pending" || job.status === "error");
  if (!pendingJobs.length) {
    showNotice("warn", "Нет задач для проверки. Добавьте .html файлы или URL в очередь.");
    return;
  }

  const startedAtMs = Date.now();
  const doneBefore = state.jobs.filter((job) => job.status === "done").length;
  const controller = new AbortController();
  activeCheckController = controller;
  state.isChecking = true;
  state.checkProgressLabel = "Подготовка запроса...";
  const totalJobs = pendingJobs.length;
  let completedJobs = 0;
  checkProgressBar.style.width = "0%";
  checkProgress.classList.remove("hidden");
  setCheckControls(true);
  renderViolations();
  clearNotice();
  const rulesContext = buildRulesContext(state.rulesUser);
  const glossaryMap = buildGlossaryMap([...state.glossaryBuiltIn, ...rulesContext.denyGlossary]) as Map<
    string,
    { original: string; replacements: string[]; preferred: string; type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT" }
  >;
  const allowedTerms = [
    ...state.trademarksBuiltIn.map((item) => item.name),
    ...rulesContext.allowTerms,
  ];

  try {
    for (const job of pendingJobs) {
      if (controller.signal.aborted) break;
      job.status = "loading";
      job.progressLabel = "Загрузка источника...";
      renderJobsList();
      if (state.selectedJobId === job.id) {
        state.checkProgressLabel = job.progressLabel;
        renderViolations();
      }
      try {
        const result = await runCheckJob(job, {
          db: state.lookupDb,
          urlProxyEndpoint: URL_SOURCE_PROXY_ENDPOINT,
          norms: state.norms.map((norm) => ({ code: norm.code, norm: norm.norm, url: norm.url })),
          glossaryMap,
          rules: state.rulesUser,
          allowTerms: allowedTerms.map((item) => item.toLowerCase()),
          signal: controller.signal,
          onProgress: (label) => {
            job.status = "checking";
            job.progressLabel = label;
            renderJobsList();
            if (state.selectedJobId === job.id) {
              state.checkProgressLabel = label;
              renderViolations();
            }
          },
        });
        job.html = result.html;
        job.plainText = result.plainText;
        job.violations = assignViolationIds(result.violations as Violation[], `job-${job.id}`) as CheckJob["violations"];
        job.checkedWords = result.checkedWords as CheckJob["checkedWords"];
        job.status = "done";
        job.progressLabel = `Готово: ${job.violations.length} нарушений`;
        appendHistoryEntryFromJob(job);
      } catch (error) {
        if (controller.signal.aborted) {
          job.status = "cancelled";
          job.progressLabel = "Остановлено пользователем";
        } else {
          job.status = "error";
          job.errorMessage = explainJobError(error, job);
          job.progressLabel = `Ошибка: ${job.errorMessage}`;
        }
      }
      completedJobs += 1;
      checkProgressBar.style.width = `${Math.round((completedJobs / totalJobs) * 100)}%`;

      if (!state.selectedJobId) state.selectedJobId = job.id;
      if (state.selectedJobId === job.id) {
        await selectJob(job.id);
      } else {
        renderJobsList();
      }
    }
    const doneAfter = state.jobs.filter((job) => job.status === "done").length;
    const checkedCount = Math.max(0, doneAfter - doneBefore);
    const violationsCount = pendingJobs
      .filter((job) => job.status === "done")
      .reduce((sum, job) => sum + job.violations.length, 0);
    const elapsedSec = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
    showNotice("ok", `Проверено: ${checkedCount} писем, нарушений: ${violationsCount}, время: ${elapsedSec} сек.`);
  } finally {
    if (controller.signal.aborted) {
      showNotice("warn", "Проверка остановлена пользователем.");
    }
    state.isChecking = false;
    state.checkProgressLabel = "";
    setCheckControls(false);
    checkProgress.classList.add("hidden");
    checkProgressBar.style.width = "0%";
    activeCheckController = null;
    renderJobsList();
    renderViolations();
  }
}

function explainApiError(error: unknown): string {
  const message = (error as Error)?.message ?? "";
  if (message.includes("Failed to fetch")) return "не удалось обратиться к локальным данным (возможна сеть/CORS).";
  return message || "неизвестная ошибка проверки.";
}

function explainJobError(error: unknown, job: CheckJob): string {
  const message = (error as Error)?.message ?? "";
  let mapped = explainApiError(error);
  if (job.sourceType === "url" && message.includes("URL_SOURCE_PROXY_FAILED")) {
    mapped =
      "не удалось загрузить HTML по URL через Yandex Cloud Function proxy (проверьте endpoint, CORS и доступность источника).";
  }
  if (job.sourceType === "url" && message.includes("URL_SOURCE_TIMEOUT")) {
    mapped = "не удалось загрузить HTML по URL: источник не ответил в разумное время (таймаут).";
  }
  if (job.sourceType === "url" && (message.includes("URL_SOURCE_FETCH_FAILED") || message.includes("Failed to fetch"))) {
    mapped = "не удалось загрузить HTML по URL через proxy endpoint. Проверьте настройки Yandex Cloud Function и CORS.";
  }
  if (job.sourceType === "url" && message.includes("URL_SOURCE_EMPTY_TEXT")) {
    mapped =
      "HTML по URL загружен, но из письма не удалось извлечь видимый текст. Проверьте, что веб-версия содержит текстовый контент, а не только динамический скрипт или изображения.";
  }
  return mapped;
}

async function runImageOcr() {
  if (!state.dictionary || !state.techAbbrev) return;
  if (!isHtmlLike(state.emailText)) {
    showOcrStatus("Вставьте HTML письма с изображениями, чтобы запустить OCR.", true);
    return;
  }

  await renderEmailPreview([], false);
  const previewDoc = previewHandle?.getDocument();
  const previewImages = previewDoc ? Array.from(previewDoc.querySelectorAll<HTMLImageElement>("img")) : [];

  const extractedAssets = extractHtmlImages(state.emailText).map<OcrImageAssetState>((asset) => ({
    ...asset,
    recognizedText: "",
    ocrWords: [],
    violations: [],
  }));
  state.ocrAssets = extractedAssets;
  if (!state.ocrAssets.length) {
    showOcrStatus("В HTML не найдено изображений для OCR.", true);
    return;
  }

  state.ocrInProgress = true;
  runImageOcrBtn.disabled = true;
  const rulesContext = buildRulesContext(state.rulesUser);
  const glossaryMap = buildGlossaryMap([...state.glossaryBuiltIn, ...rulesContext.denyGlossary]);
  const allowedTerms = [
    ...state.trademarksBuiltIn.map((item) => item.name),
    ...rulesContext.allowTerms,
  ];

  let processed = 0;
  for (const asset of state.ocrAssets) {
    if (asset.status === "skipped") {
      processed += 1;
      showOcrStatus(buildOcrSummary(processed, state.ocrAssets.length), false);
      continue;
    }
    try {
      asset.status = "loading";
      showOcrStatus(buildOcrSummary(processed, state.ocrAssets.length, asset.id), false);
      const result = await recognizeImageText(asset.src);
      asset.recognizedText = result.text;
      asset.ocrWords = result.words;
      asset.ocrConfidence = result.confidence;
      asset.imageWidth = result.imageWidth;
      asset.imageHeight = result.imageHeight;
      const checkResult = checkSingleText(
        result.text,
        "image_text",
        state.dictionary,
        state.techAbbrev,
        state.norms,
        glossaryMap,
        allowedTerms.map((item) => ({ name: item, type: "trademark" as const })),
      );
      asset.violations = assignViolationIds(checkResult.violations, `ocr-${asset.id}`).map((violation) => ({
        ...violation,
        sourceDetails: `OCR: ${buildAssetLabel(asset)}`,
        imageAssetId: asset.id,
      }));
      asset.status = "ocr_done";
    } catch (error) {
      asset.status = "skipped";
      const sourceHint = previewImages[asset.domIndex]
        ? "Картинка отображается в письме, но сервер не разрешил браузеру скачать её данные для OCR."
        : "Изображение не найдено в DOM preview по позиции.";
      asset.warning = `Пропущено (${buildAssetLabel(asset)}): ${explainOcrError(error)} ${sourceHint}`;
    } finally {
      processed += 1;
      showOcrStatus(buildOcrSummary(processed, state.ocrAssets.length), false);
    }
  }

  state.ocrInProgress = false;
  runImageOcrBtn.disabled = false;
  const skippedWarnings = state.ocrAssets
    .map((asset) => asset.warning)
    .filter((item): item is string => Boolean(item));
  if (skippedWarnings.length) {
    showOcrStatus(`${buildOcrSummary(state.ocrAssets.length, state.ocrAssets.length)} ${skippedWarnings.join(" ")}`, true);
  }
  if (state.hasChecked) void runCheck();
}

function checkSingleText(
  inputText: string,
  source: SourceType,
  dictionary: ParsedDictionary,
  techAbbrev: TechAbbrevData,
  norms: NormEntry[],
  glossaryMap: Map<string, GlossaryEntry>,
  trademarks: TrademarkEntry[],
): CheckResult {
  const text = inputText;
  const tokens = tokenize(text);
  const phrasePool = [
    ...Array.from(glossaryMap.keys()).filter((phrase) => phrase.includes(" ")),
    ...trademarks.map((item) => item.name.toLowerCase()).filter((name) => name.includes(" ")),
  ];
  const phraseMatches = matchPhrasesLongest(tokens, phrasePool);
  const consumedIndexes = new Set<number>();
  const violations: Violation[] = [];

  for (const match of phraseMatches) {
    for (let i = match.startTokenIdx; i <= match.endTokenIdx; i += 1) consumedIndexes.add(i);
    const phraseText = text.slice(match.start, match.end);
    if (isTrademarkPhrase(match, tokens, trademarks)) continue;
    const normType = "LAT_PROHIBITED";
    const isTech = isTechAbbreviation(phraseText, techAbbrev);
    const type: ViolationType = isTech ? "TECH_ABBREV" : normType;
    const norm = getNorm(type, norms);
    violations.push({
      word: phraseText,
      position: { start: match.start, end: match.end },
      source,
      type,
      risk: getRisk(type),
      norm: norm.norm,
      normUrl: norm.url,
      replacements: getReplacements(phraseText, glossaryMap),
    });
  }

  tokens.forEach((token, idx) => {
    if (consumedIndexes.has(idx)) return;
    if (isTrademarkToken(token.normalized, trademarks)) return;

    if (isCyrillicWord(token.normalized)) {
      if (!isWordAllowed(token.normalized, dictionary)) {
        const norm = getNorm("CYR_NOT_IN_DICT", norms);
        violations.push({
          word: token.raw,
          position: { start: token.start, end: token.end },
          source,
          type: "CYR_NOT_IN_DICT",
          risk: "MEDIUM",
          norm: norm.norm,
          normUrl: norm.url,
          replacements: getReplacements(token.raw, glossaryMap),
        });
      }
      return;
    }

    if (isLatinWord(token.normalized)) {
      const type: ViolationType = isTechAbbreviation(token.raw, techAbbrev)
        ? "TECH_ABBREV"
        : "LAT_PROHIBITED";
      const norm = getNorm(type, norms);
      violations.push({
        word: token.raw,
        position: { start: token.start, end: token.end },
        source,
        type,
        risk: getRisk(type),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: getReplacements(token.raw, glossaryMap),
      });
    }
  });

  const correctedText = applyPreferredReplacements(text, violations);
  return { violations, correctedText };
}

function tokenize(text: string): Token[] {
  const regex = /[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g;
  const result: Token[] = [];
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    result.push({ raw, normalized: raw.toLowerCase(), start, end });
    match = regex.exec(text);
  }
  return result;
}

function matchPhrasesLongest(tokens: Token[], phrases: string[]): PhraseMatch[] {
  const normalizedPhrases = phrases
    .map((phrase) => phrase.trim().toLowerCase().split(/\s+/))
    .filter((words) => words.length > 1)
    .sort((a, b) => b.length - a.length);

  const matches: PhraseMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    let chosen: PhraseMatch | null = null;
    for (const phraseWords of normalizedPhrases) {
      const end = i + phraseWords.length - 1;
      if (end >= tokens.length) continue;
      let ok = true;
      for (let k = 0; k < phraseWords.length; k += 1) {
        if (tokens[i + k].normalized !== phraseWords[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        chosen = {
          phrase: phraseWords.join(" "),
          startTokenIdx: i,
          endTokenIdx: end,
          start: tokens[i].start,
          end: tokens[end].end,
        };
        break;
      }
    }
    if (chosen) {
      matches.push(chosen);
      i = chosen.endTokenIdx + 1;
    } else {
      i += 1;
    }
  }
  return matches;
}

function isTrademarkPhrase(match: PhraseMatch, tokens: Token[], trademarks: TrademarkEntry[]): boolean {
  const phrase = tokens
    .slice(match.startTokenIdx, match.endTokenIdx + 1)
    .map((token) => token.normalized)
    .join(" ");
  return trademarks.some((item) => item.name.toLowerCase() === phrase);
}

function isTrademarkToken(token: string, trademarks: TrademarkEntry[]): boolean {
  return trademarks.some((entry) => {
    const name = entry.name.toLowerCase();
    if (name === token) return true;
    if (token.includes("-")) return token.split("-").includes(name);
    return false;
  });
}

function isWordAllowed(word: string, dictionary: ParsedDictionary): boolean {
  const lower = word.toLowerCase();
  if (lower in dictionary.words) return true;
  const stem = russianStem(lower);
  return Boolean(dictionary.stems?.[stem]);
}

function isTechAbbreviation(value: string, techAbbrev: TechAbbrevData): boolean {
  const lower = value.toLowerCase();
  return techAbbrev.abbreviations.some((item) => item.toLowerCase() === lower);
}

function getRisk(type: ViolationType): "HIGH" | "MEDIUM" | "LOW" {
  if (type === "LAT_PROHIBITED") return "HIGH";
  if (type === "CYR_NOT_IN_DICT") return "MEDIUM";
  return "LOW";
}

function getNorm(type: ViolationType, norms: NormEntry[]): { norm: string; url?: string } {
  const item = norms.find((norm) => norm.code === type);
  return item ? { norm: item.norm, url: item.url } : { norm: "Норма не указана" };
}

function buildGlossaryMap(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  const map = new Map<string, GlossaryEntry>();
  entries.forEach((item) => map.set(item.original.toLowerCase(), item));
  return map;
}

function getReplacements(value: string, glossaryMap: Map<string, GlossaryEntry>): string[] {
  const entry = glossaryMap.get(value.toLowerCase());
  if (!entry) return [];
  const ordered = entry.preferred
    ? [entry.preferred, ...entry.replacements.filter((x) => x.toLowerCase() !== entry.preferred.toLowerCase())]
    : entry.replacements;
  return ordered.slice(0, 3);
}

function applyPreferredReplacements(text: string, violations: Violation[]): string {
  if (!violations.length) return text;
  const sorted = [...violations].sort((a, b) => a.position.start - b.position.start);
  let cursor = 0;
  let output = "";
  for (const violation of sorted) {
    const replacement = violation.replacements[0];
    if (!replacement || violation.position.start < cursor) continue;
    output += text.slice(cursor, violation.position.start);
    output += replacement;
    cursor = violation.position.end;
  }
  output += text.slice(cursor);
  return output;
}

function renderViolations() {
  updateCheckerSplitVisibility();
  violationsList.innerHTML = "";
  violationsCounter.textContent = `Нарушений: ${state.combinedViolations.length}`;
  const selectedJob = state.selectedJobId
    ? state.jobs.find((item) => item.id === state.selectedJobId) ?? null
    : null;
  const selectedJobIsInProgress = selectedJob
    ? selectedJob.status === "pending" || selectedJob.status === "loading" || selectedJob.status === "checking"
    : false;
  if (state.isChecking && selectedJobIsInProgress) {
    violationsList.innerHTML = `<li class="violation-card">${escapeHtml(state.checkProgressLabel || "Идёт проверка...")}</li>`;
    return;
  }
  if (selectedJob?.status === "error") {
    const message = selectedJob.errorMessage ?? "Ошибка проверки.";
    violationsList.innerHTML = `<li class="violation-card">${escapeHtml(`Ошибка: ${message}`)}</li>`;
    return;
  }
  if (selectedJob?.status === "cancelled") {
    violationsList.innerHTML = "<li class=\"violation-card\">Проверка остановлена.</li>";
    return;
  }
  if (!state.hasChecked) {
    violationsList.innerHTML = "<li class=\"violation-card\">Проверка ещё не запускалась. Нажмите «Проверить».</li>";
    return;
  }

  const latViolations = state.combinedViolations.filter((item) => item.type === "LAT_PROHIBITED");
  const cyrViolations = state.combinedViolations.filter((item) => item.type === "CYR_NOT_IN_DICT");
  const techViolations = state.combinedViolations.filter((item) => item.type === "TECH_ABBREV");
  const hasOcrIssues = state.ocrAssets.some((asset) => asset.status === "skipped" || asset.status === "ocr_failed");
  if (!latViolations.length && !cyrViolations.length && !techViolations.length && !state.checkedWords.length && !hasOcrIssues) {
    violationsList.innerHTML = "<li class=\"violation-card\">Нарушений не найдено.</li>";
    return;
  }

  const fragment = document.createDocumentFragment();
  appendViolationGroup(fragment, "lat", "Латиница", latViolations);
  appendViolationGroup(fragment, "cyr", "Не в словаре", cyrViolations);
  appendViolationGroup(fragment, "tech", "Аббревиатуры", techViolations);
  appendOcrIssueRows(fragment);
  appendCheckedWordsGroup(fragment);
  violationsList.appendChild(fragment);
}

function appendViolationGroup(
  fragment: DocumentFragment,
  groupKey: "lat" | "cyr" | "tech",
  title: string,
  violations: Violation[],
) {
  if (violations.length === 0) return;
  const item = document.createElement("li");
  item.className = "vgroup";
  const isCollapsed = state.collapsedGroups.has(groupKey);
  item.innerHTML = `
    <div class="vgroup-header${isCollapsed ? " is-collapsed" : ""}" data-group="${groupKey}">
      ${escapeHtml(title)} <span class="vgroup-count">${violations.length}</span> <span class="vgroup-arrow">›</span>
    </div>
  `;
  const header = item.querySelector<HTMLDivElement>(".vgroup-header");
  if (header) {
    header.addEventListener("click", () => {
      if (state.collapsedGroups.has(groupKey)) {
        state.collapsedGroups.delete(groupKey);
      } else {
        state.collapsedGroups.add(groupKey);
      }
      renderViolations();
    });
  }
  if (!isCollapsed) {
    const rows = document.createElement("ul");
    rows.className = "vgroup-rows";
    violations.forEach((violation) => rows.appendChild(createViolationRow(violation)));
    item.appendChild(rows);
  }
  fragment.appendChild(item);
}

function createViolationRow(violation: Violation): HTMLLIElement {
  const uiText = getViolationUiText(violation);
  const typeClass = violation.type === "LAT_PROHIBITED" ? "lat" : violation.type === "CYR_NOT_IN_DICT" ? "cyr" : "tech";
  const replacementText = violation.replacements.join(" / ") || "нет";
  const preferred = violation.replacements[0] ?? "";
  const hasReplacement = preferred.length > 0;
  const previewViolationId = violation.id ?? "";
  const confidenceNote = violation.uncertain ? "не уверены на 100%" : "уверенно";
  const row = document.createElement("li");
  row.className = `violation-row vtype-${typeClass}`;
  if (previewViolationId) {
    row.classList.add("preview-link");
    row.dataset.previewViolationId = previewViolationId;
  }
  row.innerHTML = `
    <span class="vr-word">${escapeHtml(violation.word)}</span>
    <span class="vr-type ${typeClass}" aria-hidden="true"></span>
    ${hasReplacement ? `<span class="vr-arrow">→</span>` : `<span class="vr-arrow"></span>`}
    <span class="vr-replacement">${hasReplacement ? escapeHtml(preferred) : ""}</span>
    ${hasReplacement ? `<button class="vr-action btn-ghost" type="button">в словарь</button>` : `<span></span>`}
    <div class="violation-details">
      <div><b>${escapeHtml(uiText.issueTitle)}</b> (${escapeHtml(uiText.confidenceLabel)})</div>
      <div><b>Уверенность:</b> ${escapeHtml(confidenceNote)}</div>
      <div><b>Юридическая критичность:</b> ${escapeHtml(uiText.legalSeverityLabel)}</div>
      <div><b>Норма закона:</b> ${
        violation.normUrl
          ? `<a href="${violation.normUrl}" target="_blank" rel="noreferrer">${escapeHtml(violation.norm)}</a>`
          : escapeHtml(violation.norm)
      }</div>
      <div><b>Рекомендуемая замена:</b> ${escapeHtml(replacementText)}</div>
      ${violation.explanation ? `<div><b>Пояснение:</b> ${escapeHtml(violation.explanation)}</div>` : ""}
    </div>
  `;
  const actionButton = row.querySelector<HTMLButtonElement>(".vr-action");
  actionButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    rulePhraseInput.value = violation.word.toLowerCase();
    ruleModeInput.value = "deny";
    ruleReasonInput.value = "Добавлено из нарушений";
    ruleReplacementsInput.value = violation.replacements.join(", ");
    switchTab("rules");
  });
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a") || (event.target as HTMLElement).closest("button")) return;
    row.classList.toggle("expanded");
    if (!previewViolationId) return;
    highlightViolationCard(previewViolationId);
    previewHandle?.focusViolation(previewViolationId);
    imageOverlayHandle?.focusViolation(previewViolationId);
    if (violation.imageAssetId) focusImageAsset(violation.imageAssetId);
  });
  return row;
}

function appendOcrIssueRows(fragment: DocumentFragment) {
  const issues = state.ocrAssets.filter((asset) => asset.status === "skipped" || asset.status === "ocr_failed");
  issues.forEach((asset) => {
    const row = document.createElement("li");
    row.className = "violation-row violation-row--issue";
    row.innerHTML = `
      <span class="vr-word">OCR не выполнен: ${escapeHtml(buildAssetLabel(asset))}</span>
      <span class="vr-type tech">OCR</span>
      <span class="vr-arrow">→</span>
      <span class="vr-replacement">${escapeHtml(asset.warning ?? "Изображение недоступно для OCR в браузере.")}</span>
      <span></span>
    `;
    row.addEventListener("click", () => {
      focusImageAsset(asset.id);
    });
    fragment.appendChild(row);
  });
}

function appendCheckedWordsGroup(fragment: DocumentFragment) {
  if (!state.checkedWords.length) return;
  const item = document.createElement("li");
  item.className = "vgroup";
  const isCollapsed = !state.showCheckedWords;
  item.innerHTML = `
    <div class="vgroup-header${isCollapsed ? " is-collapsed" : ""}">
      Без ошибок <span class="vgroup-count">${state.checkedWords.length}</span> <span class="vgroup-arrow">›</span>
    </div>
  `;
  const header = item.querySelector<HTMLDivElement>(".vgroup-header");
  header?.addEventListener("click", () => {
    state.showCheckedWords = !state.showCheckedWords;
    renderViolations();
  });
  if (!isCollapsed) {
    const rows = document.createElement("ul");
    rows.className = "vgroup-rows";
    state.checkedWords.forEach((word) => rows.appendChild(createCheckedWordRow(word)));
    item.appendChild(rows);
  }
  fragment.appendChild(item);
}

function createCheckedWordRow(item: CheckedWord): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "violation-row violation-row--ok preview-link";
  row.dataset.previewViolationId = item.id;
  const uncertainBadge = item.uncertain ? `<span class="job-type-badge">не уверены на 100%</span>` : "";
  row.innerHTML = `
    <span class="vr-word">${escapeHtml(item.word)}</span>
    <span class="secondary-row-meta">${escapeHtml(item.statusLabel ?? "можно использовать")}</span>
    ${uncertainBadge}
  `;
  if (item.details) row.title = item.details;
  row.addEventListener("click", () => {
    highlightViolationCard(item.id);
    previewHandle?.focusViolation(item.id);
  });
  return row;
}

function updateCheckerSplitVisibility() {
  const shouldShow = state.isChecking || state.hasChecked;
  checkerSplit.classList.toggle("hidden", !shouldShow);
}

async function prepareLookupDb(options: { forceRefresh?: boolean } = {}) {
  if (state.lookupDbLoading) return;
  state.lookupDbLoading = true;
  state.lookupDbProgressLabel = "Подготавливаем словарную базу...";
  renderStatus();
  try {
    const result = await ensureLookupDb({
      forceRefresh: options.forceRefresh ?? false,
      onProgress: (progress: LookupProgress) => {
        if (!progress.message) return;
        state.lookupDbProgressLabel = progress.total && progress.loaded
          ? `${progress.message} ${Math.round((progress.loaded / progress.total) * 100)}%`
          : progress.message;
        showNotice("warn", state.lookupDbProgressLabel);
        renderStatus();
      },
    });
    state.lookupDb = result.db;
    state.lookupDbReady = true;
    state.lookupDbVersion = result.manifest.version;
    state.lookupDbProgressLabel = "";
    renderStatus();
    clearNotice();
    if (options.forceRefresh) {
      showNotice("ok", "Словарная база обновлена.");
    }
  } catch (error) {
    console.error("Lookup DB initialization failed:", error);
    state.lookupDb = null;
    state.lookupDbReady = false;
    state.lookupDbProgressLabel = "";
    renderStatus();
    showNotice("error", "Не удалось подготовить словарную базу.");
  } finally {
    state.lookupDbLoading = false;
  }
}

function renderStatus() {
  const shouldDisableRun = state.lookupDbLoading || !state.lookupDbReady || state.isChecking;
  runCheckBtn.disabled = shouldDisableRun;
  if (!state.isChecking) {
    runCheckBtn.textContent = RUN_CHECK_DEFAULT_LABEL;
  }
  if (state.lookupDbLoading) {
    apiKeyNavDisplay.textContent = state.lookupDbProgressLabel || "база загружается...";
    showStatus("warn", "Словарная база загружается.");
    return;
  }
  if (!state.lookupDbReady) {
    apiKeyNavDisplay.textContent = "база не готова";
    showStatus("error", "Словарная база недоступна.");
    return;
  }
  const versionLabel = state.lookupDbVersion || getLookupDbVersion();
  apiKeyNavDisplay.textContent = versionLabel
    ? `база: ${versionLabel.slice(0, 12)}...`
    : "база готова";
  showStatus("ok", "✓ Сервис готов к проверке");
}

function showStatus(level: "ok" | "warn" | "error", label: string) {
  statusDot.className = `status-dot ${level}`;
  statusDot.title = label;
  statusDot.setAttribute("aria-label", label);
  statusDot.classList.remove("hidden");
}

function showNotice(level: "ok" | "warn" | "error", label: string) {
  techHint.className = `hint ${level}`;
  techHint.textContent = label;
  techHint.classList.remove("hidden");
}

function findMatchingRuleForWord(normalized: string, lemma: string): RuleEntry | null {
  const matches = state.rulesUser.filter((rule) => {
    if (rule.phrase === normalized) return true;
    if (rule.applyToInflections && lemma && rule.phrase === lemma) return true;
    return false;
  });
  if (!matches.length) return null;
  const deny = matches.find((rule) => rule.mode === "deny");
  return deny ?? matches[0];
}

function isAllowedByBuiltinTerms(normalized: string): boolean {
  const terms = state.trademarksBuiltIn.map((item) => item.name.toLowerCase());
  if (terms.includes(normalized)) return true;
  if (!normalized.includes("-")) return false;
  return normalized.split("-").some((part) => terms.includes(part));
}

async function runSingleWordCheck() {
  const value = singleWordInput.value.trim();
  if (!value) {
    singleWordResult.className = "hint warn";
    singleWordResult.textContent = "Введите слово для проверки.";
    singleWordResult.classList.remove("hidden");
    return;
  }
  if (!state.lookupDbReady || !state.lookupDb) {
    singleWordResult.className = "hint warn";
    singleWordResult.textContent = "Словарная база не готова. Дождитесь загрузки.";
    singleWordResult.classList.remove("hidden");
    return;
  }

  const verification = await verifyWord(state.lookupDb, value);
  const matchingRule = findMatchingRuleForWord(verification.normalizedWord, verification.lemma);
  const allowedByBuiltin = isAllowedByBuiltinTerms(verification.normalizedWord);
  const hasLatin = /[A-Za-z]/.test(value);
  const dictionaryFound = verification.status !== "no_match";

  let statusLabel = "можно использовать";
  let level: "ok" | "warn" | "error" = "ok";
  if (matchingRule?.mode === "deny") {
    statusLabel = "нельзя по правилам";
    level = "error";
  } else if (matchingRule?.mode === "allow") {
    statusLabel = "можно по правилам";
    level = "ok";
  } else if (allowedByBuiltin) {
    statusLabel = "можно использовать";
    level = "ok";
  } else if (hasLatin) {
    statusLabel = "нельзя использовать";
    level = "error";
  } else if (!dictionaryFound) {
    statusLabel = "нельзя использовать";
    level = "error";
  }

  const uncertainLabel = verification.uncertain ? " · не уверены на 100%" : "";
  const details = verification.matches.length
    ? verification.matches.slice(0, 3).map((match) =>
      `${match.dictionaryTitle}, стр. ${match.pageStart}-${match.pageEnd}`).join("; ")
    : verification.compoundParts.length
      ? `Составные части: ${verification.compoundParts.join(" + ")}`
      : "Нет словарных совпадений.";

  singleWordResult.className = `hint ${level}`;
  singleWordResult.textContent = `${statusLabel}${uncertainLabel}. ${details}`;
  singleWordResult.classList.remove("hidden");
}

function clearNotice() {
  techHint.classList.add("hidden");
  techHint.textContent = "";
  techHint.className = "hint hidden";
}

function getOverallStatus(violations: Violation[]): { level: "ok" | "warn" | "error"; label: string } {
  if (!violations.length) return { level: "ok", label: "✓ Нарушений не найдено" };
  if (violations.every((item) => item.type === "TECH_ABBREV")) {
    return { level: "warn", label: `⚠ Найдено ${violations.length} спорных аббревиатур` };
  }
  return { level: "error", label: `✗ Найдено ${violations.length} нарушений` };
}

function getViolationUiText(violation: Violation): ViolationUiText {
  if (violation.type === "LAT_PROHIBITED") {
    return {
      issueTitle: "Иностранное слово на латинице в рекламном тексте.",
      legalSeverityLabel: "высокая",
      confidenceLabel: "высокая",
    };
  }

  if (violation.type === "CYR_NOT_IN_DICT") {
    return {
      issueTitle: "Слово не найдено в нормативных словарях.",
      legalSeverityLabel: "высокая",
      confidenceLabel: "средняя",
    };
  }

  return {
    issueTitle: "Техническая аббревиатура (спорная зона).",
    legalSeverityLabel: "низкая",
    confidenceLabel: "средняя",
  };
}

function syncRulesFormState() {
  const mode: RuleEntry["mode"] = ruleModeInput.value === "deny" ? "deny" : "allow";
  const isDeny = mode === "deny";
  ruleReplacementsInput.disabled = !isDeny;
  ruleReplacementsInput.placeholder = isDeny
    ? "замены через запятую (для 'нельзя')"
    : "замены не используются для режима 'можно'";
  if (!isDeny) ruleReplacementsInput.value = "";
}

function saveRuleFromForm() {
  const phrase = normalizeRulePhrase(rulePhraseInput.value);
  if (!phrase) return;
  const mode: RuleEntry["mode"] = ruleModeInput.value === "deny" ? "deny" : "allow";
  const reason = ruleReasonInput.value.trim();
  const applyToInflections = ruleApplyToInflectionsInput.checked;
  const replacements = mode === "deny"
    ? ruleReplacementsInput.value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const next: RuleEntry[] = [
    ...state.rulesUser.filter((item) => item.phrase.toLowerCase() !== phrase),
    { phrase, mode, reason, replacements, applyToInflections },
  ];
  state.rulesUser = next;
  saveRulesUser(localStorage, state.rulesUser);
  rulePhraseInput.value = "";
  ruleReasonInput.value = "";
  ruleModeInput.value = "allow";
  ruleApplyToInflectionsInput.checked = false;
  syncRulesFormState();
  renderRulesRows();
  showNotice("ok", "Правило сохранено.");
}

function removeRuleByPhrase(phrase: string) {
  if (!phrase) return;
  const before = state.rulesUser.length;
  state.rulesUser = state.rulesUser.filter((item) => item.phrase !== phrase);
  if (state.rulesUser.length === before) return;
  saveRulesUser(localStorage, state.rulesUser);
  renderRulesRows();
  showNotice("ok", "Правило удалено.");
}

function renderRulesRows() {
  rulesRows.innerHTML = "";
  const rows = [...state.rulesUser];
  rulesCount.textContent = `${rows.length} записей`;
  if (!rows.length) {
    rulesRows.innerHTML = `<li class="violation-card">Список правил пуст.</li>`;
    return;
  }
  rows.forEach((item) => {
    const li = document.createElement("li");
    li.className = "violation-card secondary-row glossary-row";
    li.innerHTML = `
      <div class="secondary-row-top">
        <span class="secondary-row-title">${escapeHtml(item.phrase)}</span>
        <span class="job-type-badge">${item.mode === "allow" ? "можно" : "нельзя"}</span>
      </div>
      <div class="secondary-row-meta"><b>Причина:</b> ${escapeHtml(item.reason || "—")}</div>
      <div class="secondary-row-meta"><b>Словоформы:</b> ${item.applyToInflections ? "да" : "нет"}</div>
      <div class="secondary-row-meta"><b>Замены:</b> ${escapeHtml(item.replacements.join(", ") || "—")}</div>
      <button data-remove-rule="${escapeHtml(item.phrase)}" class="btn-ghost btn-sm btn-danger-ghost" type="button">Удалить</button>
    `;
    rulesRows.appendChild(li);
  });
}

function renderHistoryRows() {
  historyRows.innerHTML = "";
  historyCount.textContent = `${state.history.length} записей`;
  if (!state.history.length) {
    historyRows.innerHTML = `<li class="violation-card">История пока пуста.</li>`;
    return;
  }
  state.history.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "violation-card secondary-row secondary-row--history";
    const count = entry.combinedViolations?.length ?? 0;
    li.innerHTML = `
      <div class="secondary-row-top">
        <span class="secondary-row-title">${escapeHtml(new Date(entry.createdAt).toLocaleString())}</span>
        <span class="job-summary">${count} наруш.</span>
      </div>
      <button data-open-history="${entry.id}" type="button" class="btn-ghost btn-sm">Открыть</button>
    `;
    historyRows.appendChild(li);
  });
  historyRows.querySelectorAll<HTMLButtonElement>("[data-open-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.openHistory ?? "";
      const item = state.history.find((entry) => entry.id === id);
      if (!item) return;
      state.emailText = item.emailText;
      state.combinedViolations = item.combinedViolations ?? [];
      state.checkedWords = [];
      resetOcrState();
      state.correctedEmailText = item.correctedEmailText;
      emailInput.value = state.emailText;
      renderViolations();
      const status = getOverallStatus(state.combinedViolations);
      showNotice(status.level, status.label);
      const emailViolations = state.combinedViolations.filter(
        (violation) => violation.source === "email_text",
      );
      state.hasChecked = true;
      void renderEmailPreview(emailViolations, true);
      switchTab("checker");
    });
  });
}

function switchTab(tab: string) {
  root.querySelectorAll<HTMLButtonElement>("[data-tab-btn]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabBtn === tab);
  });
  root.querySelectorAll<HTMLElement>("[data-tab]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tab !== tab);
  });
}

function resetOcrState() {
  state.ocrAssets = [];
  state.ocrInProgress = false;
  runImageOcrBtn.disabled = false;
  ocrStatus.classList.add("hidden");
  ocrStatus.textContent = "";
}

function showOcrStatus(message: string, warn: boolean) {
  ocrStatus.className = `ocr-status ${warn ? "warn" : "ok"}`;
  ocrStatus.textContent = message;
  ocrStatus.classList.remove("hidden");
}

function buildOcrSummary(processed: number, total: number, currentAssetId?: string): string {
  const done = state.ocrAssets.filter((item) => item.status === "ocr_done").length;
  const skipped = state.ocrAssets.filter((item) => item.status === "skipped").length;
  const tail = currentAssetId ? ` Обрабатывается: ${currentAssetId}` : "";
  return `OCR: ${processed}/${total}, распознано: ${done}, пропущено: ${skipped}.${tail}`;
}

function assignViolationIds(violations: Violation[], prefix: string): Violation[] {
  return violations.map((violation, idx) => ({ ...violation, id: `${prefix}-${idx + 1}` }));
}

function explainOcrError(error: unknown): string {
  const message = (error as Error)?.message ?? "";
  if (message.startsWith("DOM OCR failed:")) {
    return message
      .replace("DOM OCR failed:", "OCR из DOM не сработал:")
      .replace("; fallback failed:", " Резервная загрузка по src тоже не сработала:");
  }
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch")) {
    return "Браузер не смог скачать изображение (обычно CORS/защита источника).";
  }
  if (message.includes("403") || message.includes("401")) {
    return "Источник изображения запретил доступ (401/403).";
  }
  if (message.includes("404")) {
    return "Изображение не найдено по ссылке (404).";
  }
  return message || "Не удалось распознать изображение.";
}

function buildAssetLabel(asset: HtmlImageAsset): string {
  if (asset.alt) return `${asset.alt} (${asset.id})`;
  const shortName = extractImageName(asset.src);
  return shortName ? `${shortName} (${asset.id})` : asset.id;
}

function extractImageName(src: string): string {
  if (!src) return "";
  try {
    const url = new URL(src);
    const base = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return base || url.host;
  } catch {
    const base = src.split("/").filter(Boolean).pop() ?? "";
    return base;
  }
}

function focusImageAsset(assetId: string) {
  if (!assetId) return;
  const asset = state.ocrAssets.find((item) => item.id === assetId);
  if (!asset) return;
  const doc = previewHandle?.getDocument();
  if (!doc) return;
  const image = doc.querySelectorAll<HTMLImageElement>("img")[asset.domIndex];
  if (!image) return;
  doc.querySelectorAll<HTMLElement>(".image-focus-target").forEach((node) => {
    node.classList.remove("image-focus-target");
  });
  image.classList.add("image-focus-target");
  image.scrollIntoView({ block: "center", behavior: "smooth" });
}

function loadStorage<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadHistoryEntries(): HistoryEntry[] {
  const raw = loadStorage<LegacyHistoryEntry[]>(HISTORY_KEY, []);
  return raw.map(normalizeHistoryEntry);
}

function appendHistoryEntryFromJob(job: CheckJob) {
  if (job.status !== "done") return;
  const historyEntry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    emailText: job.html,
    combinedViolations: (job.violations as Violation[]).map((violation) => ({ ...violation })),
    correctedEmailText: "",
  };
  state.history = [historyEntry, ...state.history];
  saveStorage(HISTORY_KEY, state.history);
  renderHistoryRows();
}

function normalizeHistoryEntry(entry: LegacyHistoryEntry): HistoryEntry {
  const normalizedViolations = (entry.combinedViolations ?? entry.result?.combinedViolations ?? []).map(
    (violation, idx) => ({
      ...violation,
      id: violation.id ?? `history-${idx + 1}`,
    }),
  );
  return {
    id: entry.id ?? crypto.randomUUID(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    emailText: entry.emailText ?? "",
    combinedViolations: normalizedViolations,
    correctedEmailText:
      entry.correctedEmailText ?? entry.result?.email?.corrected_text ?? "",
  };
}

function saveStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function fetchJson<T>(path: string): Promise<T> {
  const normalizedPath = path.replace(/^\/+/, "");
  const urlWithBase = `${import.meta.env.BASE_URL}${normalizedPath}`;
  const response = await fetch(urlWithBase);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${urlWithBase}: ${response.status}`);
  }
  return (await response.json()) as T;
}

function queryEl<T extends Element>(selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Element not found: ${selector}`);
  return node;
}

function isHtmlLike(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

async function renderEmailPreview(emailViolations: Violation[], showOverlay: boolean) {
  if (!isHtmlLike(state.emailText)) {
    emailPreviewBlock.classList.add("hidden");
    checkerSplit.classList.add("no-preview");
    violationsPanel.style.height = "";
    previewHandle = null;
    imageOverlayHandle = null;
    return;
  }

  state.previewModel = buildHtmlPreviewModel(state.emailText);
  const ranges = showOverlay
    ? buildOverlayRanges(state.previewModel.plainText.length, emailViolations, state.checkedWords)
    : [];
  emailPreviewBlock.classList.remove("hidden");
  checkerSplit.classList.remove("no-preview");
  previewHint.classList.toggle("hidden", showOverlay);
  const revision = ++previewRenderRevision;
  const handle = await renderPreviewWithOverlay(emailPreviewFrame, state.previewModel, ranges);
  if (revision !== previewRenderRevision) return;
  syncViolationsHeightWithPreview();
  imageOverlayHandle = showOverlay ? renderImageOcrOverlays(handle.getDocument()) : null;
  handle.bindViolationSelect((violationId) => {
    highlightViolationCard(violationId);
    const card = violationsList.querySelector<HTMLElement>(
      `.violation-card[data-preview-violation-id="${violationId}"]`,
    );
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    imageOverlayHandle?.focusViolation(violationId);
  });
  previewHandle = handle;
}

function syncViolationsHeightWithPreview() {
  const previewHeight = emailPreviewFrame.clientHeight;
  if (!previewHeight) return;
  violationsPanel.style.height = `${previewHeight}px`;
}

function renderImageOcrOverlays(doc: Document): ImageOverlayHandle | null {
  const assets = state.ocrAssets
    .filter((asset) => asset.status === "ocr_done" && asset.ocrWords.length && asset.imageWidth && asset.imageHeight)
    .map<ImageOverlayAsset>((asset) => ({
      assetId: asset.id,
      domIndex: asset.domIndex,
      imageWidth: asset.imageWidth ?? 1,
      imageHeight: asset.imageHeight ?? 1,
      words: asset.ocrWords,
      violations: asset.violations.map<ImageViolationRange>((violation) => ({
        violationId: violation.id ?? "",
        start: violation.position.start,
        end: violation.position.end,
        kind: violation.type === "TECH_ABBREV" ? "tech" : "violation",
      })),
    }));

  if (!assets.length) return null;
  return renderImageOverlays(doc, assets, (violationId) => {
    highlightViolationCard(violationId);
    const card = violationsList.querySelector<HTMLElement>(
      `.violation-card[data-preview-violation-id="${violationId}"]`,
    );
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function buildOverlayRanges(
  textLength: number,
  violations: Violation[],
  checkedWords: CheckedWord[],
): OverlayRange[] {
  const kindByIndex: OverlayRange["kind"][] = Array.from({ length: textLength }, () => "ok");
  const idByIndex: Array<string | undefined> = Array.from({ length: textLength }, () => undefined);
  let skippedNoId = 0;
  violations.forEach((violation) => {
    const violationId = violation.id;
    if (!violationId) {
      skippedNoId += 1;
      return;
    }
    const kind: OverlayRange["kind"] = violation.type === "TECH_ABBREV" ? "tech" : "violation";
    const start = Math.max(0, violation.position.start);
    const end = Math.min(textLength, violation.position.end);
    for (let i = start; i < end; i += 1) {
      if (kind === "violation") {
        kindByIndex[i] = "violation";
        idByIndex[i] = violationId;
        continue;
      }
      if (kindByIndex[i] === "violation") continue;
      kindByIndex[i] = "tech";
      idByIndex[i] = violationId;
    }
  });

  checkedWords.forEach((word) => {
    const start = Math.max(0, word.start);
    const end = Math.min(textLength, word.end);
    for (let i = start; i < end; i += 1) {
      if (kindByIndex[i] !== "ok") continue;
      idByIndex[i] = word.id;
    }
  });

  const ranges: OverlayRange[] = [];
  let idx = 0;
  while (idx < textLength) {
    const kind = kindByIndex[idx];
    const violationId = idByIndex[idx];
    let cursor = idx + 1;
    while (cursor < textLength && kindByIndex[cursor] === kind && idByIndex[cursor] === violationId) {
      cursor += 1;
    }
    ranges.push({
      start: idx,
      end: cursor,
      kind,
      violationId,
    });
    idx = cursor;
  }
  return ranges;
}

function highlightViolationCard(violationId: string) {
  violationsList.querySelectorAll<HTMLElement>(".violation-card").forEach((card) => {
    card.classList.toggle("active-preview", card.dataset.previewViolationId === violationId);
  });
}

function isCyrillicWord(value: string): boolean {
  return /^[а-яё-]+$/i.test(value);
}

function isLatinWord(value: string): boolean {
  return /^[a-z-]+$/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function readTextFile(file: File, encoding = "utf-8"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsText(file, encoding);
  });
}

type TemplateCsvParseResult =
  | { ok: true; entries: UrlSourceEntry[]; skippedEmpty: number; skippedInvalid: number }
  | { ok: false; error: string };

function parseTemplateUrlsCsv(content: string): TemplateCsvParseResult {
  const rows = parseDelimitedRows(stripBom(content), ";");
  if (!rows.length) return { ok: false, error: "CSV пустой." };
  const headerRow = rows[0].map((cell) => normalizeCsvHeader(cell));
  const templateIdx = headerRow.findIndex((cell) => cell === "template");
  const messageNameIdx = headerRow.findIndex((cell) => cell === "messagename");
  const messageLinkIdx = headerRow.findIndex((cell) => cell === "messagelink");
  if (templateIdx < 0) return { ok: false, error: "В CSV не найден столбец template." };

  const entries: UrlSourceEntry[] = [];
  let skippedEmpty = 0;
  let skippedInvalid = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const templateUrl = (rows[i][templateIdx] ?? "").trim();
    if (!templateUrl) {
      skippedEmpty += 1;
      continue;
    }
    if (!isHttpUrl(templateUrl)) {
      skippedInvalid += 1;
      continue;
    }
    const messageName = messageNameIdx >= 0 ? (rows[i][messageNameIdx] ?? "").trim() : "";
    const rawMessageLink = messageLinkIdx >= 0 ? (rows[i][messageLinkIdx] ?? "").trim() : "";
    const messageLink = rawMessageLink && isHttpUrl(rawMessageLink) ? rawMessageLink : "";
    entries.push({
      url: templateUrl,
      messageName,
      messageLink,
    });
  }
  return { ok: true, entries, skippedEmpty, skippedInvalid };
}

function parseDelimitedRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === "\"") {
      if (inQuotes && content[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && content[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      const hasData = row.some((item) => item.length > 0);
      if (hasData) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function normalizeCsvHeader(value: string): string {
  return stripBom(value).trim().toLowerCase();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function downloadFile(filename: string, content: string, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
