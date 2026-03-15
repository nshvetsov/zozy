import "./style.css";

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
  word: string;
  position: { start: number; end: number };
  source: SourceType;
  type: ViolationType;
  risk: "HIGH" | "MEDIUM" | "LOW";
  norm: string;
  normUrl?: string;
  replacements: string[];
}

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
  imageText: string;
  combinedViolations: Violation[];
  correctedEmailText: string;
  correctedImageText: string;
}

const USER_GLOSSARY_KEY = "user_glossary";
const USER_TRADEMARKS_KEY = "user_trademarks";
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
  history: loadStorage<HistoryEntry[]>(HISTORY_KEY, []),
  emailText: "",
  imageText: "",
  combinedViolations: [] as Violation[],
  correctedEmailText: "",
  correctedImageText: "",
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
        <span>Текст письма / HTML</span>
        <textarea id="emailText" rows="9" placeholder="Вставьте текст или HTML-код письма..."></textarea>
      </label>
      <label class="field">
        <span>Текст с баннеров и изображений (необязательно)</span>
        <textarea id="imageText" rows="5" placeholder="Скопируйте текст с изображений..."></textarea>
      </label>
      <div class="actions">
        <label class="file">
          Загрузить .txt / .html
          <input id="sourceFile" type="file" accept=".txt,.html,text/plain,text/html" />
        </label>
        <button id="runCheckBtn">Проверить</button>
        <span id="charCount">0 / 50000</span>
      </div>
      <div id="statusBar" class="status hidden"></div>
      <div id="techHint" class="hint hidden"></div>
      <h2>Нарушения</h2>
      <ul id="violationsList" class="list"></ul>
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

const emailInput = queryEl<HTMLTextAreaElement>("#emailText");
const imageInput = queryEl<HTMLTextAreaElement>("#imageText");
const sourceFileInput = queryEl<HTMLInputElement>("#sourceFile");
const runCheckBtn = queryEl<HTMLButtonElement>("#runCheckBtn");
const charCount = queryEl<HTMLSpanElement>("#charCount");
const statusBar = queryEl<HTMLDivElement>("#statusBar");
const techHint = queryEl<HTMLDivElement>("#techHint");
const violationsList = queryEl<HTMLUListElement>("#violationsList");

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

attachEvents();
showStatus("warn", "Загрузка справочников...");
void init();

async function init() {
  try {
    const [dictionary, techAbbrev, glossary, trademarks, norms] = await Promise.all([
      fetchJson<ParsedDictionary>("data/parsed_dictionary.json"),
      fetchJson<TechAbbrevData>("data/tech_abbrev.json"),
      fetchJson<GlossaryEntry[]>("data/glossary.json"),
      fetchJson<TrademarkEntry[]>("data/trademarks.json"),
      fetchJson<NormEntry[]>("data/norms.json"),
    ]);

    state.dictionary = dictionary;
    state.techAbbrev = techAbbrev;
    state.glossaryBuiltIn = glossary;
    state.trademarksBuiltIn = trademarks;
    state.norms = norms;
    renderStatus();
    renderGlossaryRows();
    renderTrademarkRows();
    renderHistoryRows();
  } catch (error) {
    console.error("Init failed:", error);
    showStatus(
      "error",
      "✗ Не удалось загрузить справочники. Обновите страницу или проверьте публикацию data/*.json",
    );
  }
}

function attachEvents() {
  root.querySelectorAll<HTMLButtonElement>("[data-tab-btn]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tabBtn ?? "checker"));
  });

  emailInput.addEventListener("input", () => {
    state.emailText = emailInput.value;
    updateCharCount();
  });

  imageInput.addEventListener("input", () => {
    state.imageText = imageInput.value;
    updateCharCount();
  });

  sourceFileInput.addEventListener("change", () => {
    const file = sourceFileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.emailText = String(reader.result ?? "");
      emailInput.value = state.emailText;
      updateCharCount();
    };
    reader.readAsText(file);
  });

  runCheckBtn.addEventListener("click", runCheck);

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

function runCheck() {
  if (!state.dictionary || !state.techAbbrev) return;

  const charTotal = state.emailText.length + state.imageText.length;
  if (charTotal > 50000) {
    showStatus("error", "✗ Превышен лимит 50 000 символов");
    return;
  }

  const glossaryMap = buildGlossaryMap([...state.glossaryBuiltIn, ...state.glossaryUser]);
  const trademarks = [...state.trademarksBuiltIn, ...state.trademarksUser];

  const emailResult = checkSingleText(
    state.emailText,
    "email_text",
    state.dictionary,
    state.techAbbrev,
    state.norms,
    glossaryMap,
    trademarks,
  );
  const imageResult = checkSingleText(
    state.imageText,
    "image_text",
    state.dictionary,
    state.techAbbrev,
    state.norms,
    glossaryMap,
    trademarks,
  );

  state.combinedViolations = [...emailResult.violations, ...imageResult.violations];
  state.correctedEmailText = emailResult.correctedText;
  state.correctedImageText = imageResult.correctedText;

  const statusInfo = getOverallStatus(state.combinedViolations);
  showStatus(statusInfo.level, statusInfo.label);

  if (state.combinedViolations.some((item) => item.type === "TECH_ABBREV")) {
    techHint.classList.remove("hidden");
    techHint.textContent =
      "Технические аббревиатуры формально не выведены в исключения для рекламных текстов. Риск низкий, но не нулевой.";
  } else {
    techHint.classList.add("hidden");
    techHint.textContent = "";
  }

  renderViolations();
  pushHistory();
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
  const text = isHtmlLike(inputText) ? extractVisibleTextFromHtml(inputText) : inputText;
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

function russianStem(word: string): string {
  const endings = [
    "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "ая", "яя", "ой", "ий", "ый", "ов",
    "ев", "ей", "ам", "ям", "ах", "ях", "ом", "ем", "ы", "и", "а", "я", "е", "о", "у", "ю", "ь",
  ];
  for (const ending of endings) {
    if (word.endsWith(ending) && word.length - ending.length >= 3) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
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
  if (!state.combinedViolations.length) {
    violationsList.innerHTML = "<li>Нарушений не найдено.</li>";
    return;
  }

  const fragment = document.createDocumentFragment();
  state.combinedViolations.forEach((violation) => {
    const uiText = getViolationUiText(violation);
    const li = document.createElement("li");
    li.className = "violation-card";
    li.innerHTML = `
      <div class="violation-title"><strong>${escapeHtml(violation.word)}</strong></div>
      <div><b>Проблема:</b> ${escapeHtml(uiText.issueTitle)}</div>
      <div><b>Юридическая критичность:</b> ${escapeHtml(uiText.legalSeverityLabel)}</div>
      <div><b>Уверенность автопроверки:</b> ${escapeHtml(uiText.confidenceLabel)}</div>
      <div><b>Почему такая уверенность:</b> ${escapeHtml(uiText.confidenceReason)}</div>
      <div><b>Где найдено:</b> ${escapeHtml(uiText.sourceLabel)}</div>
      <div><b>Что это значит:</b> ${escapeHtml(uiText.lawPlainText)}</div>
      <div><b>Норма закона:</b> ${
        violation.normUrl
          ? `<a href="${violation.normUrl}" target="_blank" rel="noreferrer">${escapeHtml(violation.norm)}</a>`
          : escapeHtml(violation.norm)
      }</div>
      <div><b>Рекомендуемая замена:</b> ${escapeHtml(violation.replacements.join(" / ") || "нет")}</div>
    `;
    fragment.appendChild(li);
  });
  violationsList.appendChild(fragment);
}

function renderStatus() {
  showStatus("ok", "✓ Сервис готов к проверке");
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
    li.innerHTML = `
      <div><strong>${new Date(entry.createdAt).toLocaleString()}</strong> — ${entry.combinedViolations.length} наруш.</div>
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
      state.imageText = item.imageText;
      state.combinedViolations = item.combinedViolations;
      state.correctedEmailText = item.correctedEmailText;
      state.correctedImageText = item.correctedImageText;
      emailInput.value = state.emailText;
      imageInput.value = state.imageText;
      renderViolations();
      const status = getOverallStatus(state.combinedViolations);
      showStatus(status.level, status.label);
      switchTab("checker");
    });
  });
}

function pushHistory() {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    emailText: state.emailText,
    imageText: state.imageText,
    combinedViolations: state.combinedViolations,
    correctedEmailText: state.correctedEmailText,
    correctedImageText: state.correctedImageText,
  };
  state.history = [entry, ...state.history].slice(0, 50);
  saveStorage(HISTORY_KEY, state.history);
  renderHistoryRows();
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
  const total = state.emailText.length + state.imageText.length;
  charCount.textContent = `${total} / 50000`;
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

function extractVisibleTextFromHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((node) => node.remove());
  doc.querySelectorAll("[hidden], [aria-hidden='true']").forEach((node) => node.remove());
  doc.querySelectorAll<HTMLElement>("[style]").forEach((node) => {
    const style = node.getAttribute("style")?.toLowerCase().replace(/\s+/g, "") ?? "";
    if (style.includes("display:none") || style.includes("font-size:0") || style.includes("max-height:0")) {
      node.remove();
    }
  });
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
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

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
