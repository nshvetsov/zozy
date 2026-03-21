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
}

interface OcrImageAssetState extends HtmlImageAsset {
  recognizedText: string;
  ocrConfidence?: number;
  ocrWords: BrowserOcrResult["words"];
  imageWidth?: number;
  imageHeight?: number;
  violations: Violation[];
}

interface ReviewCardViolation {
  kind: "violation";
  violation: Violation;
}

interface ReviewCardOk {
  kind: "ok";
  title: string;
  text: string;
  violationId?: string;
  imageAssetId?: string;
}

interface CheckedWord {
  id: string;
  word: string;
  normalized: string;
  start: number;
  end: number;
}

interface ReviewCardIssue {
  kind: "ocr_issue";
  title: string;
  text: string;
  imageAssetId?: string;
}

type ReviewCard = ReviewCardViolation | ReviewCardOk | ReviewCardIssue;

type ReviewFilter = "all" | "errors" | "ok";

interface ViolationUiText {
  issueTitle: string;
  legalSeverityLabel: string;
  confidenceLabel: string;
  confidenceReason: string;
  sourceLabel: string;
  lawPlainText: string;
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

const USER_GLOSSARY_KEY = "user_glossary";
const USER_TRADEMARKS_KEY = "user_trademarks";
const GOSSLOVAR_API_KEY = "gosslovar_api_key";
const HISTORY_KEY = "checks_history";

const rootCandidate = document.querySelector<HTMLDivElement>("#app");
if (!rootCandidate) throw new Error("Root element #app not found");
const root: HTMLDivElement = rootCandidate;

const state = {
  dictionary: null as ParsedDictionary | null,
  techAbbrev: null as TechAbbrevData | null,
  glossaryBuiltIn: [] as GlossaryEntry[],
  glossaryUser: loadStorage<GlossaryEntry[]>(USER_GLOSSARY_KEY, []),
  trademarksBuiltIn: [] as TrademarkEntry[],
  trademarksUser: loadStorage<TrademarkEntry[]>(USER_TRADEMARKS_KEY, []),
  norms: [] as NormEntry[],
  history: loadHistoryEntries(),
  apiKey: loadStorage<string>(GOSSLOVAR_API_KEY, ""),
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
  reviewFilter: "all" as ReviewFilter,
};

root.innerHTML = `
  <main class="layout">
    <nav class="tabs">
      <button data-tab-btn="checker" class="active">Проверка</button>
      <button data-tab-btn="glossary">Глоссарий</button>
      <button data-tab-btn="trademarks">Мои ТЗ</button>
      <button data-tab-btn="history">История</button>
    </nav>

    <section data-tab="checker" class="panel">
      <h1>Проверка текста email на соответствие 168-ФЗ</h1>
      <label class="field">
        <span>API ключ ГосСловарь</span>
        <input id="apiKeyInput" type="password" placeholder="GS-..." autocomplete="off" />
      </label>
      <label class="field">
        <span>Список URL (по одному на строку)</span>
        <textarea id="urlListInput" rows="4" placeholder="https://example.com/mail-1"></textarea>
      </label>
      <label class="field">
        <span>HTML выбранного письма</span>
        <textarea id="emailText" rows="9" placeholder="Вставьте текст или HTML-код письма..."></textarea>
      </label>
      <div class="actions">
        <label class="file">
          Загрузить .html
          <input id="sourceFile" type="file" accept=".html,text/html" multiple />
        </label>
        <button id="addJobsBtn" type="button">Добавить в очередь</button>
        <button id="runCheckBtn">Запустить проверку</button>
        <button id="stopCheckBtn" type="button" class="hidden">Остановить проверку</button>
        <button id="exportViolationsCsvBtn" type="button">Экспорт violations.csv</button>
        <button id="runImageOcrBtn" type="button" class="hidden">Распознать текст на изображениях</button>
        <span id="charCount">0 символов</span>
      </div>
      <div id="statusBar" class="status hidden"></div>
      <section class="panel">
        <h2>Очередь проверок</h2>
        <ul id="jobsList" class="list violations-list"></ul>
      </section>
      <div id="ocrStatus" class="ocr-status hidden"></div>
      <div id="techHint" class="hint hidden"></div>
      <div id="checkerSplit" class="checker-split no-preview">
        <section id="emailPreviewBlock" class="preview hidden">
          <div class="preview-header">
            <h2>Предпросмотр письма</h2>
            <div class="preview-legend">
              <span class="legend-item legend-ok">Проверено</span>
              <span class="legend-item legend-violation">Нарушение</span>
              <span class="legend-item legend-tech">Тех. аббревиатура</span>
            </div>
          </div>
          <div id="previewHint" class="preview-hint">Введите HTML и нажмите «Проверить», чтобы увидеть подсветку.</div>
          <iframe id="emailPreviewFrame" class="preview-frame" sandbox="allow-same-origin" scrolling="no"></iframe>
        </section>
        <section id="violationsPanel" class="violations-panel">
          <div class="violations-header">
            <h2>Нарушения</h2>
            <span id="violationsCounter" class="badge">0</span>
          </div>
          <div id="reviewFilter" class="review-filter">
            <button type="button" data-review-filter="all" class="active">Все</button>
            <button type="button" data-review-filter="errors">Только ошибки</button>
            <button type="button" data-review-filter="ok">Только не ошибки</button>
          </div>
          <ul id="violationsList" class="list violations-list"></ul>
        </section>
      </div>
    </section>

    <section data-tab="glossary" class="panel hidden">
      <h1>Глоссарий (пользовательские оверрайды)</h1>
      <div class="grid-form">
        <input id="glossaryOriginal" placeholder="original" />
        <input id="glossaryPreferred" placeholder="preferred" />
        <input id="glossaryReplacements" placeholder="replacements через запятую" />
        <select id="glossaryType">
          <option value="LAT_PROHIBITED">LAT_PROHIBITED</option>
          <option value="CYR_NOT_IN_DICT">CYR_NOT_IN_DICT</option>
        </select>
        <button id="addGlossaryBtn">Добавить / обновить</button>
      </div>
      <div class="actions">
        <button id="exportGlossaryCsvBtn">Экспорт CSV</button>
        <label class="file">
          Импорт CSV
          <input id="importGlossaryCsvInput" type="file" accept=".csv,text/csv" />
        </label>
      </div>
      <table>
        <thead>
          <tr><th>Original</th><th>Preferred</th><th>Replacements</th><th>Type</th><th></th></tr>
        </thead>
        <tbody id="glossaryRows"></tbody>
      </table>
    </section>

    <section data-tab="trademarks" class="panel hidden">
      <h1>Мои товарные знаки</h1>
      <div class="grid-form">
        <input id="tmName" placeholder="Название ТЗ" />
        <input id="tmRegistration" placeholder="Регистрационный номер" />
        <input id="tmNote" placeholder="Примечание" />
        <button id="addTmBtn">Добавить</button>
      </div>
      <ul id="tmRows" class="list"></ul>
    </section>

    <section data-tab="history" class="panel hidden">
      <h1>История проверок</h1>
      <ul id="historyRows" class="list"></ul>
    </section>
  </main>
`;

const apiKeyInput = queryEl<HTMLInputElement>("#apiKeyInput");
const urlListInput = queryEl<HTMLTextAreaElement>("#urlListInput");
const emailInput = queryEl<HTMLTextAreaElement>("#emailText");
const sourceFileInput = queryEl<HTMLInputElement>("#sourceFile");
const addJobsBtn = queryEl<HTMLButtonElement>("#addJobsBtn");
const runCheckBtn = queryEl<HTMLButtonElement>("#runCheckBtn");
const stopCheckBtn = queryEl<HTMLButtonElement>("#stopCheckBtn");
const exportViolationsCsvBtn = queryEl<HTMLButtonElement>("#exportViolationsCsvBtn");
const runImageOcrBtn = queryEl<HTMLButtonElement>("#runImageOcrBtn");
const charCount = queryEl<HTMLSpanElement>("#charCount");
const statusBar = queryEl<HTMLDivElement>("#statusBar");
const ocrStatus = queryEl<HTMLDivElement>("#ocrStatus");
const techHint = queryEl<HTMLDivElement>("#techHint");
const violationsList = queryEl<HTMLUListElement>("#violationsList");
const violationsCounter = queryEl<HTMLSpanElement>("#violationsCounter");
const emailPreviewBlock = queryEl<HTMLElement>("#emailPreviewBlock");
const emailPreviewFrame = queryEl<HTMLIFrameElement>("#emailPreviewFrame");
const checkerSplit = queryEl<HTMLElement>("#checkerSplit");
const previewHint = queryEl<HTMLDivElement>("#previewHint");
const violationsPanel = queryEl<HTMLElement>("#violationsPanel");
const reviewFilter = queryEl<HTMLDivElement>("#reviewFilter");

const glossaryOriginal = queryEl<HTMLInputElement>("#glossaryOriginal");
const glossaryPreferred = queryEl<HTMLInputElement>("#glossaryPreferred");
const glossaryReplacements = queryEl<HTMLInputElement>("#glossaryReplacements");
const glossaryType = queryEl<HTMLSelectElement>("#glossaryType");
const addGlossaryBtn = queryEl<HTMLButtonElement>("#addGlossaryBtn");
const glossaryRows = queryEl<HTMLTableSectionElement>("#glossaryRows");
const exportGlossaryCsvBtn = queryEl<HTMLButtonElement>("#exportGlossaryCsvBtn");
const importGlossaryCsvInput = queryEl<HTMLInputElement>("#importGlossaryCsvInput");

const tmName = queryEl<HTMLInputElement>("#tmName");
const tmRegistration = queryEl<HTMLInputElement>("#tmRegistration");
const tmNote = queryEl<HTMLInputElement>("#tmNote");
const addTmBtn = queryEl<HTMLButtonElement>("#addTmBtn");
const tmRows = queryEl<HTMLUListElement>("#tmRows");

const historyRows = queryEl<HTMLUListElement>("#historyRows");
const jobsList = queryEl<HTMLUListElement>("#jobsList");
let previewHandle: PreviewRenderHandle | null = null;
let imageOverlayHandle: ImageOverlayHandle | null = null;
let previewRenderRevision = 0;
let activeCheckController: AbortController | null = null;
const RUN_CHECK_DEFAULT_LABEL = "Запустить проверку";
const RUN_CHECK_BUSY_LABEL = "Проверка...";

apiKeyInput.value = state.apiKey;
attachEvents();
showStatus("warn", "Загрузка настроек...");
void init();
window.addEventListener("resize", syncViolationsHeightWithPreview);

function setCheckControls(inProgress: boolean) {
  runCheckBtn.disabled = inProgress;
  runCheckBtn.textContent = inProgress ? RUN_CHECK_BUSY_LABEL : RUN_CHECK_DEFAULT_LABEL;
  addJobsBtn.disabled = inProgress;
  exportViolationsCsvBtn.disabled = inProgress;
  stopCheckBtn.classList.toggle("hidden", !inProgress);
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
    renderGlossaryRows();
    renderTrademarkRows();
    renderHistoryRows();
    renderJobsList();
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
    button.addEventListener("click", () => switchTab(button.dataset.tabBtn ?? "checker"));
  });

  apiKeyInput.addEventListener("input", () => {
    state.apiKey = apiKeyInput.value.trim();
    saveStorage(GOSSLOVAR_API_KEY, state.apiKey);
  });

  emailInput.addEventListener("input", () => {
    state.emailText = emailInput.value;
    state.hasChecked = false;
    state.combinedViolations = [];
    state.checkedWords = [];
    resetOcrState();
    updateCharCount();
    renderViolations();
    void renderEmailPreview([], false);
  });

  addJobsBtn.addEventListener("click", () => {
    void enqueueSources();
  });

  runCheckBtn.addEventListener("click", () => {
    void runCheck();
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
  reviewFilter.querySelectorAll<HTMLButtonElement>("[data-review-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewFilter = (button.dataset.reviewFilter ?? "all") as ReviewFilter;
      reviewFilter
        .querySelectorAll<HTMLButtonElement>("[data-review-filter]")
        .forEach((node) => node.classList.toggle("active", node === button));
      renderViolations();
    });
  });

  addGlossaryBtn.addEventListener("click", () => {
    const original = glossaryOriginal.value.trim().toLowerCase();
    if (!original) return;
    const preferred = glossaryPreferred.value.trim();
    const replacements = glossaryReplacements.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const type =
      glossaryType.value === "CYR_NOT_IN_DICT"
        ? "CYR_NOT_IN_DICT"
        : ("LAT_PROHIBITED" as const);

    const next: GlossaryEntry[] = [
      ...state.glossaryUser.filter((item) => item.original.toLowerCase() !== original),
      { original, preferred, replacements, type },
    ];
    state.glossaryUser = next;
    saveStorage(USER_GLOSSARY_KEY, state.glossaryUser);
    glossaryOriginal.value = "";
    glossaryPreferred.value = "";
    glossaryReplacements.value = "";
    renderGlossaryRows();
  });

  exportGlossaryCsvBtn.addEventListener("click", () => {
    const rows = state.glossaryUser.map((item) => ({
      original: item.original,
      preferred: item.preferred,
      replacements: item.replacements.join("|"),
      type: item.type,
    }));
    downloadFile("user_glossary.csv", toCsv(rows));
  });

  importGlossaryCsvInput.addEventListener("change", () => {
    const file = importGlossaryCsvInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const imported: GlossaryEntry[] = parseCsv(text).map((row) => {
        const type: GlossaryEntry["type"] =
          row.type === "CYR_NOT_IN_DICT" ? "CYR_NOT_IN_DICT" : "LAT_PROHIBITED";
        return {
          original: (row.original ?? "").toLowerCase(),
          preferred: row.preferred ?? "",
          replacements: (row.replacements ?? "")
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean),
          type,
        };
      });
      state.glossaryUser = imported.filter((item) => item.original);
      saveStorage(USER_GLOSSARY_KEY, state.glossaryUser);
      renderGlossaryRows();
    };
    reader.readAsText(file);
  });

  addTmBtn.addEventListener("click", () => {
    const name = tmName.value.trim();
    if (!name) return;
    const next = [
      ...state.trademarksUser.filter((item) => item.name.toLowerCase() !== name.toLowerCase()),
      {
        name,
        type: "trademark" as const,
        registration: tmRegistration.value.trim(),
        note: tmNote.value.trim(),
      },
    ];
    state.trademarksUser = next;
    saveStorage(USER_TRADEMARKS_KEY, state.trademarksUser);
    tmName.value = "";
    tmRegistration.value = "";
    tmNote.value = "";
    renderTrademarkRows();
  });
}

async function enqueueSources() {
  const files = Array.from(sourceFileInput.files ?? []).filter((file) =>
    file.name.toLowerCase().endsWith(".html"),
  );
  const urls = urlListInput.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!files.length && !urls.length) {
    showStatus("warn", "Добавьте хотя бы один .html файл или URL.");
    return;
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

  const jobsFromUrls: CheckJob[] = urls.map((url) => ({
    id: crypto.randomUUID(),
    sourceType: "url",
    sourceName: url,
    sourceValue: url,
    html: "",
    plainText: "",
    status: "pending",
    progressLabel: "В очереди",
    violations: [],
    checkedWords: [],
    createdAt: now,
  }));

  state.jobs = [...state.jobs, ...jobsFromFiles, ...jobsFromUrls];
  if (!state.selectedJobId && state.jobs.length) {
    state.selectedJobId = state.jobs[0].id;
    await selectJob(state.jobs[0].id);
  }
  urlListInput.value = "";
  sourceFileInput.value = "";
  renderJobsList();
  showStatus("ok", `Добавлено в очередь: ${jobsFromFiles.length + jobsFromUrls.length}`);
}

function renderJobsList() {
  jobsList.innerHTML = "";
  if (!state.jobs.length) {
    jobsList.innerHTML = "<li class=\"violation-card\">Очередь пуста. Добавьте .html файлы или URL.</li>";
    return;
  }
  const fragment = document.createDocumentFragment();
  state.jobs.forEach((job) => {
    const li = document.createElement("li");
    li.className = "violation-card preview-link";
    if (job.id === state.selectedJobId) li.classList.add("active-preview");
    const violationsCount = job.violations.length;
    li.innerHTML = `
      <div class="violation-title"><strong>${escapeHtml(job.sourceName)}</strong></div>
      <div>Источник: ${job.sourceType === "file" ? "файл" : "url"}</div>
      <div>Статус: ${escapeHtml(job.status)}</div>
      <div>Нарушений: ${violationsCount}</div>
      <div>${escapeHtml(job.progressLabel || "")}</div>
    `;
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
  updateCharCount();
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
  if (!state.apiKey) {
    showStatus("error", "✗ Укажите API ключ ГосСловарь в поле выше.");
    return;
  }
  const pendingJobs = state.jobs.filter((job) => job.status === "pending" || job.status === "error");
  if (!pendingJobs.length) {
    showStatus("warn", "Нет задач для проверки. Добавьте .html файлы или URL в очередь.");
    return;
  }

  const controller = new AbortController();
  activeCheckController = controller;
  state.isChecking = true;
  state.checkProgressLabel = "Подготовка запроса...";
  setCheckControls(true);
  techHint.classList.add("hidden");
  techHint.textContent = "";
  const glossaryMap = buildGlossaryMap([...state.glossaryBuiltIn, ...state.glossaryUser]) as Map<
    string,
    { original: string; replacements: string[]; preferred: string; type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT" }
  >;
  const trademarks = [...state.trademarksBuiltIn, ...state.trademarksUser];

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
          apiKey: state.apiKey,
          norms: state.norms.map((norm) => ({ code: norm.code, norm: norm.norm, url: norm.url })),
          glossaryMap,
          trademarks: trademarks.map((item) => ({ name: item.name })),
          chunkSize: 650,
          jitterMinMs: 100,
          jitterMaxMs: 500,
          pollIntervalMs: 3000,
          signal: controller.signal,
          onProgress: (label) => {
            job.status = "checking";
            job.progressLabel = label;
            renderJobsList();
            if (state.selectedJobId === job.id) {
              state.checkProgressLabel = label;
              showStatus("warn", label);
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

      if (!state.selectedJobId) state.selectedJobId = job.id;
      if (state.selectedJobId === job.id) {
        await selectJob(job.id);
      } else {
        renderJobsList();
      }
    }
    const checkedCount = state.jobs.filter((job) => job.status === "done").length;
    const failedCount = state.jobs.filter((job) => job.status === "error").length;
    const cancelledCount = state.jobs.filter((job) => job.status === "cancelled").length;
    showStatus("ok", `Проверка завершена: готово ${checkedCount}, ошибок ${failedCount}, остановлено ${cancelledCount}.`);
  } finally {
    if (controller.signal.aborted) {
      showStatus("warn", "Проверка остановлена пользователем.");
    }
    state.isChecking = false;
    state.checkProgressLabel = "";
    setCheckControls(false);
    activeCheckController = null;
    renderJobsList();
    renderViolations();
  }
}

function explainApiError(error: unknown): string {
  const message = (error as Error)?.message ?? "";
  if (message.includes("401")) return "неверный API ключ (401).";
  if (message.includes("429")) return "лимит запросов исчерпан, попробуйте позже (429).";
  if (message.includes("Failed to fetch")) return "не удалось обратиться к API (возможен CORS или сеть).";
  return message || "неизвестная ошибка API.";
}

function explainJobError(error: unknown, job: CheckJob): string {
  const message = (error as Error)?.message ?? "";
  let mapped = explainApiError(error);
  if (job.sourceType === "url" && message.includes("URL_SOURCE_PROXY_FAILED")) {
    mapped = "не удалось загрузить HTML по URL ни напрямую, ни через proxy (возможны CORS/защита источника или закрытый доступ по cookie).";
  }
  if (job.sourceType === "url" && message.includes("URL_SOURCE_TIMEOUT")) {
    mapped = "не удалось загрузить HTML по URL: источник не ответил в разумное время (таймаут).";
  }
  if (job.sourceType === "url" && (message.includes("URL_SOURCE_FETCH_FAILED") || message.includes("Failed to fetch"))) {
    mapped = "не удалось загрузить HTML по URL из браузера (вероятно CORS/блокировка источника).";
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
  const glossaryMap = buildGlossaryMap([...state.glossaryBuiltIn, ...state.glossaryUser]);
  const trademarks = [...state.trademarksBuiltIn, ...state.trademarksUser];

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
        trademarks,
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
  violationsList.innerHTML = "";
  violationsCounter.textContent = String(state.combinedViolations.length);
  if (state.isChecking) {
    violationsList.innerHTML = `<li class="violation-card">${escapeHtml(state.checkProgressLabel || "Идёт проверка...")}</li>`;
    return;
  }
  if (!state.hasChecked) {
    violationsList.innerHTML =
      "<li class=\"violation-card\">Проверка ещё не запускалась. Нажмите «Проверить».</li>";
    return;
  }
  const reviewCards = buildReviewCards();
  if (!reviewCards.length) {
    violationsList.innerHTML =
      "<li class=\"violation-card\">По выбранному фильтру нет элементов для отображения.</li>";
    return;
  }
  const fragment = document.createDocumentFragment();
  reviewCards.forEach((card) => {
    if (card.kind === "ok") {
      const li = document.createElement("li");
      li.className = "violation-card review-ok";
      if (card.violationId) {
        li.classList.add("preview-link");
        li.dataset.previewViolationId = card.violationId;
        li.addEventListener("click", () => {
          highlightViolationCard(card.violationId ?? "");
          previewHandle?.focusViolation(card.violationId ?? "");
        });
      }
      if (card.imageAssetId) {
        li.classList.add("preview-link");
        li.dataset.previewImageAssetId = card.imageAssetId;
        li.addEventListener("click", () => {
          focusImageAsset(card.imageAssetId ?? "");
        });
      }
      li.innerHTML = `<div class="violation-title"><strong>${escapeHtml(card.title)}</strong></div><div>${escapeHtml(card.text)}</div>`;
      fragment.appendChild(li);
      return;
    }
    if (card.kind === "ocr_issue") {
      const li = document.createElement("li");
      li.className = "violation-card review-issue";
      if (card.imageAssetId) {
        li.classList.add("preview-link");
        li.dataset.previewImageAssetId = card.imageAssetId;
        li.addEventListener("click", () => {
          focusImageAsset(card.imageAssetId ?? "");
        });
      }
      li.innerHTML = `<div class="violation-title"><strong>${escapeHtml(card.title)}</strong></div><div>${escapeHtml(card.text)}</div>`;
      fragment.appendChild(li);
      return;
    }

    const violation = card.violation;
    const uiText = getViolationUiText(violation);
    const li = document.createElement("li");
    li.className = "violation-card";
    const previewViolationId = violation.id ?? "";
    if (previewViolationId) li.dataset.previewViolationId = previewViolationId;
    li.innerHTML = `
      <div class="violation-title"><strong>${escapeHtml(violation.word)}</strong></div>
      <div><b>Проблема:</b> ${escapeHtml(uiText.issueTitle)}</div>
      <div><b>Юридическая критичность:</b> ${escapeHtml(uiText.legalSeverityLabel)}</div>
      <div><b>Уверенность автопроверки:</b> ${escapeHtml(uiText.confidenceLabel)}</div>
      <div><b>Почему такая уверенность:</b> ${escapeHtml(uiText.confidenceReason)}</div>
      <div><b>Где найдено:</b> ${escapeHtml(violation.sourceDetails ?? uiText.sourceLabel)}</div>
      <div><b>Что это значит:</b> ${escapeHtml(uiText.lawPlainText)}</div>
      <div><b>Норма закона:</b> ${
        violation.normUrl
          ? `<a href="${violation.normUrl}" target="_blank" rel="noreferrer">${escapeHtml(violation.norm)}</a>`
          : escapeHtml(violation.norm)
      }</div>
      <div><b>Рекомендуемая замена:</b> ${escapeHtml(violation.replacements.join(" / ") || "нет")}</div>
    `;
    if (previewViolationId) {
      li.classList.add("preview-link");
      li.addEventListener("click", () => {
        highlightViolationCard(previewViolationId);
        previewHandle?.focusViolation(previewViolationId);
        imageOverlayHandle?.focusViolation(previewViolationId);
        if (violation.imageAssetId) focusImageAsset(violation.imageAssetId);
      });
    }
    fragment.appendChild(li);
  });
  violationsList.appendChild(fragment);
}

function renderStatus() {
  if (!state.apiKey) {
    showStatus("warn", "Укажите API ключ ГосСловарь для запуска проверки.");
  } else {
    showStatus("ok", "✓ Сервис готов к проверке");
  }
  updateCharCount();
}

function showStatus(level: "ok" | "warn" | "error", label: string) {
  statusBar.className = `status ${level}`;
  statusBar.textContent = label;
  statusBar.classList.remove("hidden");
}

function getOverallStatus(violations: Violation[]): { level: "ok" | "warn" | "error"; label: string } {
  if (!violations.length) return { level: "ok", label: "✓ Нарушений не найдено" };
  if (violations.every((item) => item.type === "TECH_ABBREV")) {
    return { level: "warn", label: `⚠ Найдено ${violations.length} спорных аббревиатур` };
  }
  return { level: "error", label: `✗ Найдено ${violations.length} нарушений` };
}

function getViolationUiText(violation: Violation): ViolationUiText {
  const sourceLabel =
    violation.source === "email_text" ? "основной текст письма" : "текст с изображений";

  if (violation.type === "LAT_PROHIBITED") {
    return {
      issueTitle: "Иностранное слово на латинице в рекламном тексте.",
      legalSeverityLabel: "высокая",
      confidenceLabel: "высокая",
      confidenceReason:
        "Правило почти однозначное: найдена латиница, это не товарный знак и не техническая аббревиатура.",
      sourceLabel,
      lawPlainText:
        "Для потребительской рекламы требуется русский язык. Латиницу лучше заменить русским вариантом.",
    };
  }

  if (violation.type === "CYR_NOT_IN_DICT") {
    return {
      issueTitle: "Слово не найдено в нормативных словарях.",
      legalSeverityLabel: "высокая",
      confidenceLabel: "средняя",
      confidenceReason:
        "Проверка зависит от полноты парсинга PDF-словарей и нормализации словоформ, поэтому бывают пограничные случаи.",
      sourceLabel,
      lawPlainText:
        "Формулировки должны опираться на нормативную словарную форму. Лучше использовать более официальный вариант.",
    };
  }

  return {
    issueTitle: "Техническая аббревиатура (спорная зона).",
    legalSeverityLabel: "низкая",
    confidenceLabel: "средняя",
    confidenceReason:
      "Само обнаружение надёжное, но правоприменительная практика по таким сокращениям пока не до конца устоялась.",
    sourceLabel,
    lawPlainText:
      "Такие сокращения обычно допустимы, но иногда безопаснее дать русский эквивалент рядом.",
  };
}

function renderGlossaryRows() {
  glossaryRows.innerHTML = "";
  const rows = [...state.glossaryUser];
  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.original)}</td>
      <td>${escapeHtml(item.preferred)}</td>
      <td>${escapeHtml(item.replacements.join(", "))}</td>
      <td>${item.type}</td>
      <td><button data-remove-glossary="${escapeHtml(item.original)}" class="danger">Удалить</button></td>
    `;
    glossaryRows.appendChild(tr);
  });
  glossaryRows.querySelectorAll<HTMLButtonElement>("[data-remove-glossary]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.removeGlossary ?? "";
      state.glossaryUser = state.glossaryUser.filter((item) => item.original !== key);
      saveStorage(USER_GLOSSARY_KEY, state.glossaryUser);
      renderGlossaryRows();
    });
  });
}

function renderTrademarkRows() {
  tmRows.innerHTML = "";
  state.trademarksUser.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      ${item.registration ? `<span>(${escapeHtml(item.registration)})</span>` : ""}
      ${item.note ? `<span> — ${escapeHtml(item.note)}</span>` : ""}
      <button data-remove-tm="${escapeHtml(item.name)}" class="danger">Удалить</button>
    `;
    tmRows.appendChild(li);
  });
  tmRows.querySelectorAll<HTMLButtonElement>("[data-remove-tm]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.removeTm ?? "";
      state.trademarksUser = state.trademarksUser.filter((item) => item.name !== name);
      saveStorage(USER_TRADEMARKS_KEY, state.trademarksUser);
      renderTrademarkRows();
    });
  });
}

function renderHistoryRows() {
  historyRows.innerHTML = "";
  state.history.forEach((entry) => {
    const li = document.createElement("li");
    const count = entry.combinedViolations?.length ?? 0;
    li.innerHTML = `
      <div><strong>${new Date(entry.createdAt).toLocaleString()}</strong> — ${count} наруш.</div>
      <button data-open-history="${entry.id}">Открыть</button>
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
      showStatus(status.level, status.label);
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

function updateCharCount() {
  const total = state.emailText.length;
  charCount.textContent = `${total} символов`;
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

function buildReviewCards(): ReviewCard[] {
  const violations = state.combinedViolations.map((violation) => ({
    kind: "violation" as const,
    violation,
  }));
  const issues = state.ocrAssets
    .filter((asset) => asset.status === "skipped" || asset.status === "ocr_failed")
    .map((asset) => ({
      kind: "ocr_issue" as const,
      title: `OCR не выполнен: ${buildAssetLabel(asset)}`,
      text: asset.warning ?? "Изображение недоступно для OCR в браузере.",
      imageAssetId: asset.id,
    }));

  const oks: ReviewCardOk[] = [];
  state.checkedWords.forEach((item) => {
    oks.push({
      kind: "ok",
      title: item.word,
      text: "Проверено через API: нарушений не найдено.",
      violationId: item.id,
    });
  });
  const emailViolations = state.combinedViolations.filter((item) => item.source === "email_text");
  if (!emailViolations.length && !state.checkedWords.length) {
    oks.push({
      kind: "ok",
      title: "Основной текст письма",
      text: "Проверено: нарушений не найдено.",
    });
  }

  state.ocrAssets
    .filter((asset) => asset.status === "ocr_done")
    .forEach((asset) => {
      if (asset.violations.length) return;
      const conf =
        typeof asset.ocrConfidence === "number" ? ` OCR confidence: ${Math.round(asset.ocrConfidence)}%.` : "";
      oks.push({
        kind: "ok",
        title: `OCR: ${buildAssetLabel(asset)}`,
        text: `Распознано и проверено: нарушений не найдено.${conf}`,
        imageAssetId: asset.id,
      });
    });

  if (state.reviewFilter === "errors") return [...violations, ...issues];
  if (state.reviewFilter === "ok") return oks;
  return [...violations, ...issues, ...oks];
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

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const parts = line.split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = parts[idx] ?? "";
    });
    return row;
  });
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escape(row[header] ?? "")).join(","));
  });
  return lines.join("\n");
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
