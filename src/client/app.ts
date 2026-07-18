import type { DashboardSummary, ImportedFile, TrendPoint } from "../lib/types";

interface BootstrapState {
  csrfToken: string;
  importedFile: ImportedFile | null;
  hasData: boolean;
  demoMode: boolean;
}

interface ImportResult {
  file: ImportedFile;
  recordCount: number;
  warningCount: number;
}

type ChartMetric = "volumeKg" | "topWeightKg" | "estimatedOneRepMaxKg";

const elements = {
  dashboard: query<HTMLElement>("#dashboard"),
  emptyState: query<HTMLElement>("#empty-state"),
  settingsDialog: query<HTMLDialogElement>("#settings-dialog"),
  settingsButton: query<HTMLButtonElement>("#settings-button"),
  emptySettingsButton: query<HTMLButtonElement>("#empty-settings-button"),
  syncButton: query<HTMLButtonElement>("#sync-button"),
  syncStatus: query<HTMLElement>("#sync-status"),
  demoBadge: query<HTMLElement>("#demo-badge"),
  periodSelect: query<HTMLSelectElement>("#period-select"),
  exerciseSelect: query<HTMLSelectElement>("#exercise-select"),
  dateRange: query<HTMLElement>("#date-range"),
  chooseFileButton: query<HTMLLabelElement>("#choose-file-button"),
  importFile: query<HTMLInputElement>("#import-file"),
  importSource: query<HTMLElement>("#import-source"),
  settingsMessage: query<HTMLElement>("#settings-message"),
  dangerActions: query<HTMLElement>("#danger-actions"),
  resetButton: query<HTMLButtonElement>("#reset-button"),
  toast: query<HTMLElement>("#toast"),
  chart: query<SVGSVGElement>("#trend-chart"),
  chartEmpty: query<HTMLElement>("#chart-empty"),
  exerciseTable: query<HTMLTableSectionElement>("#exercise-table"),
  noteList: query<HTMLUListElement>("#note-list"),
  historyList: query<HTMLElement>("#history-list"),
  warningPanel: query<HTMLDetailsElement>("#warning-panel"),
  warningCount: query<HTMLElement>("#warning-count"),
  warningList: query<HTMLUListElement>("#warning-list"),
};

let bootstrapState: BootstrapState;
let summary: DashboardSummary | null = null;
let chartMetric: ChartMetric = "volumeKg";
let toastTimer: number | null = null;

void initialize();

async function initialize(): Promise<void> {
  attachListeners();
  try {
    bootstrapState = await get<BootstrapState>("/api/bootstrap");
    renderSourceState();
    if (bootstrapState.demoMode) elements.demoBadge.classList.remove("hidden");
    if (isConfigured()) {
      await loadDashboard();
    } else {
      showEmptyState();
      elements.settingsDialog.showModal();
    }
  } catch (error) {
    showToast(messageFrom(error), true);
    showEmptyState();
  }
}

function attachListeners(): void {
  elements.settingsButton.addEventListener("click", openSettings);
  elements.emptySettingsButton.addEventListener("click", openSettings);
  elements.syncButton.addEventListener("click", openImportDialog);
  elements.periodSelect.addEventListener("change", () => void loadDashboard());
  elements.exerciseSelect.addEventListener("change", () => void loadDashboard());
  elements.chooseFileButton.addEventListener("click", requestFileSelection);
  elements.importFile.addEventListener("change", () => void importFile());
  elements.resetButton.addEventListener("click", () => void resetSettings());
  query<HTMLElement>("#metric-tabs").addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-metric]");
    if (!button) return;
    chartMetric = button.dataset.metric as ChartMetric;
    for (const item of document.querySelectorAll("#metric-tabs button"))
      item.classList.toggle("active", item === button);
    if (summary) drawChart(summary.trends);
  });
}

function openSettings(): void {
  renderSourceState();
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

function openImportDialog(): void {
  if (bootstrapState.demoMode) {
    showToast("デモデータは変更できません。");
    return;
  }
  openSettings();
}

function requestFileSelection(event: MouseEvent): void {
  event.preventDefault();
  elements.importFile.value = "";
  elements.importFile.click();
}

function isConfigured(): boolean {
  return bootstrapState.demoMode || bootstrapState.importedFile !== null;
}

function renderSourceState(): void {
  const source = bootstrapState.importedFile;
  elements.chooseFileButton.setAttribute("aria-disabled", String(bootstrapState.demoMode));
  elements.importFile.disabled = bootstrapState.demoMode;
  elements.importSource.classList.toggle("hidden", source === null);
  elements.importSource.textContent = source
    ? `現在のファイル: ${source.fileName}（${formatDateTime(source.importedAt)}）`
    : "";
  elements.dangerActions.classList.toggle("hidden", bootstrapState.demoMode || source === null);
}

async function importFile(): Promise<void> {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1_024 * 1_024) {
    elements.importFile.value = "";
    setSettingsMessage("ファイルは5MB以下にしてください。", true);
    return;
  }
  elements.syncButton.classList.add("loading");
  elements.syncButton.disabled = true;
  elements.syncStatus.textContent = "取り込み中…";
  setSettingsMessage("ファイルを読み込んでいます…");
  try {
    const result = await post<ImportResult>("/api/import", {
      fileName: file.name,
      contents: await file.text(),
    });
    bootstrapState.importedFile = result.file;
    bootstrapState.hasData = true;
    renderSourceState();
    await loadDashboard();
    setSettingsMessage("");
    elements.settingsDialog.close();
    showToast(`${result.recordCount}セットを取り込みました。`);
  } catch (error) {
    elements.syncStatus.textContent = "取り込みエラー";
    setSettingsMessage(messageFrom(error), true);
  } finally {
    elements.importFile.value = "";
    elements.syncButton.classList.remove("loading");
    elements.syncButton.disabled = false;
  }
}

async function loadDashboard(): Promise<void> {
  const queryString = new URLSearchParams({ period: elements.periodSelect.value });
  if (elements.exerciseSelect.value) queryString.set("exercise", elements.exerciseSelect.value);
  summary = await get<DashboardSummary>(`/api/dashboard?${queryString}`);
  renderDashboard(summary);
}

function renderDashboard(data: DashboardSummary): void {
  elements.emptyState.classList.add("hidden");
  elements.dashboard.classList.remove("hidden");
  updateExerciseOptions(data.availableExercises, data.exercise);
  elements.dateRange.textContent =
    data.range.start && data.range.end
      ? `${formatDate(data.range.start)} — ${formatDate(data.range.end)}`
      : "表示できる記録がありません";
  elements.syncStatus.textContent = data.lastSyncedAt
    ? `最終取込 ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.lastSyncedAt))}`
    : "未取り込み";
  setMetric(
    "volume",
    `${formatNumber(data.kpis.totalVolumeKg.value)} kg`,
    data.kpis.totalVolumeKg.percentChange,
  );
  setMetric(
    "sessions",
    `${formatNumber(data.kpis.sessionCount.value)} 日`,
    data.kpis.sessionCount.percentChange,
  );
  setMetric(
    "sets",
    `${formatNumber(data.kpis.setCount.value)} sets`,
    data.kpis.setCount.percentChange,
  );
  setMetric(
    "one-rm",
    `${formatDecimal(data.kpis.estimatedOneRepMaxKg.value)} kg`,
    data.kpis.estimatedOneRepMaxKg.percentChange,
  );
  drawChart(data.trends);
  renderExercises(data);
  renderNotes(data);
  renderHistory(data);
  renderWarnings(data);
}

function updateExerciseOptions(exercises: string[], selected: string | null): void {
  const current = selected ?? elements.exerciseSelect.value;
  elements.exerciseSelect.replaceChildren(
    option("", "すべての種目", current === ""),
    ...exercises.map((exercise) => option(exercise, exercise, exercise === current)),
  );
}

function setMetric(id: string, value: string, change: number | null): void {
  query<HTMLElement>(`#kpi-${id}`).textContent = value;
  const changeElement = query<HTMLElement>(`#change-${id}`);
  changeElement.className = change === null ? "" : change >= 0 ? "positive" : "negative";
  changeElement.textContent =
    change === null
      ? "比較データなし"
      : `${change >= 0 ? "↗" : "↘"} ${Math.abs(change).toFixed(1)}% 前期間比`;
}

function drawChart(trends: TrendPoint[]): void {
  const svg = elements.chart;
  const title = svg.querySelector("title") ?? svgElement("title");
  title.textContent = `トレーニング成長推移: ${metricLabel(chartMetric)}`;
  const description = svg.querySelector("desc") ?? svgElement("desc");
  description.textContent = `${trends.length}回の記録を日付順に表示しています。`;
  svg.replaceChildren(title, description);
  elements.chartEmpty.classList.toggle("hidden", trends.length > 0);
  svg.classList.toggle("hidden", trends.length === 0);
  if (trends.length === 0) return;

  const width = 960;
  const height = 320;
  const padding = { top: 26, right: 24, bottom: 48, left: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = trends.map((point) => point[chartMetric]);
  const max = Math.max(...values, 1);
  const roundedMax = niceMax(max);
  const coordinates = trends.map((point, index) => ({
    x:
      padding.left +
      (trends.length === 1 ? plotWidth / 2 : (index / (trends.length - 1)) * plotWidth),
    y: padding.top + plotHeight - (point[chartMetric] / roundedMax) * plotHeight,
    point,
  }));

  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (index / 4) * plotHeight;
    const line = svgElement("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y,
      class: "chart-grid",
    });
    const label = svgElement("text", {
      x: padding.left - 12,
      y: y + 4,
      class: "chart-label",
      "text-anchor": "end",
    });
    label.textContent = compactNumber(roundedMax * (1 - index / 4));
    svg.append(line, label);
  }

  const linePoints = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const baseline = padding.top + plotHeight;
  svg.append(
    svgElement("polygon", {
      points: `${coordinates[0]?.x},${baseline} ${linePoints} ${coordinates.at(-1)?.x},${baseline}`,
      class: "chart-area",
    }),
    svgElement("polyline", { points: linePoints, class: "chart-line" }),
  );

  const labelEvery = Math.max(1, Math.ceil(trends.length / 6));
  coordinates.forEach(({ x, y, point }, index) => {
    const circle = svgElement("circle", { cx: x, cy: y, r: 5, class: "chart-point", tabindex: 0 });
    const pointTitle = svgElement("title");
    pointTitle.textContent = `${formatDate(point.date)}: ${formatDecimal(point[chartMetric])}${chartMetric === "volumeKg" ? " kg" : " kg"}`;
    circle.append(pointTitle);
    svg.append(circle);
    if (index % labelEvery === 0 || index === coordinates.length - 1) {
      const label = svgElement("text", {
        x,
        y: height - 18,
        class: "chart-label",
        "text-anchor": "middle",
      });
      label.textContent = shortDate(point.date);
      svg.append(label);
    }
  });
}

function renderExercises(data: DashboardSummary): void {
  elements.exerciseTable.replaceChildren(
    ...data.exercises.map((exercise) => {
      const row = document.createElement("tr");
      row.append(
        cell(exercise.exercise),
        cell(`${formatDecimal(exercise.topWeightKg)} kg`),
        cell(`${formatDecimal(exercise.estimatedOneRepMaxKg)} kg`),
        cell(`${formatNumber(exercise.totalVolumeKg)} kg`),
      );
      return row;
    }),
  );
}

function renderNotes(data: DashboardSummary): void {
  const notes = data.sessions
    .flatMap((session) =>
      session.exercises.flatMap((exercise) =>
        exercise.sets
          .filter((set) => set.memo)
          .map((set) => ({
            memo: set.memo,
            date: session.date,
            exercise: exercise.exercise,
            set: set.set,
          })),
      ),
    )
    .slice(0, 5);
  if (notes.length === 0) {
    const item = document.createElement("li");
    item.className = "no-notes";
    item.textContent = "この期間のメモはありません。";
    elements.noteList.replaceChildren(item);
    return;
  }
  elements.noteList.replaceChildren(
    ...notes.map((note) => {
      const item = document.createElement("li");
      const text = document.createElement("p");
      text.textContent = note.memo;
      const meta = document.createElement("span");
      meta.textContent = `${formatDate(note.date)} · ${note.exercise} · SET ${note.set}`;
      item.append(text, meta);
      return item;
    }),
  );
}

function renderHistory(data: DashboardSummary): void {
  elements.historyList.replaceChildren(
    ...data.sessions.map((session) => {
      const article = document.createElement("article");
      article.className = "session";
      const date = document.createElement("div");
      date.className = "session-date";
      const strong = document.createElement("strong");
      strong.textContent = formatDate(session.date);
      const volume = document.createElement("span");
      volume.textContent = `${formatNumber(session.totalVolumeKg)} kg volume`;
      date.append(strong, volume);
      const exercises = document.createElement("div");
      exercises.className = "session-exercises";
      for (const exercise of session.exercises) {
        const block = document.createElement("section");
        block.className = "session-exercise";
        const heading = document.createElement("h3");
        heading.textContent = exercise.exercise;
        const setList = document.createElement("div");
        setList.className = "set-list";
        for (const set of exercise.sets) {
          const wrapper = document.createElement("div");
          const chip = document.createElement("div");
          chip.className = `set-chip${set.memo ? " has-memo" : ""}`;
          const index = document.createElement("b");
          index.textContent = `SET ${set.set}`;
          chip.append(
            index,
            document.createTextNode(`${formatDecimal(set.weightKg)}kg × ${set.reps}`),
          );
          wrapper.append(chip);
          if (set.memo) {
            const memo = document.createElement("p");
            memo.className = "set-memo";
            memo.textContent = set.memo;
            wrapper.append(memo);
          }
          setList.append(wrapper);
        }
        block.append(heading, setList);
        exercises.append(block);
      }
      article.append(date, exercises);
      return article;
    }),
  );
}

function renderWarnings(data: DashboardSummary): void {
  elements.warningPanel.classList.toggle("hidden", data.warnings.length === 0);
  elements.warningCount.textContent = `${data.warnings.length}件`;
  elements.warningList.replaceChildren(
    ...data.warnings.map((warning) => {
      const item = document.createElement("li");
      item.textContent = `${warning.row}行目: ${warning.message}`;
      return item;
    }),
  );
}

async function resetSettings(): Promise<void> {
  if (!confirm("このMacに保存した取り込みデータを削除しますか？")) return;
  await post("/api/reset", {});
  bootstrapState.importedFile = null;
  bootstrapState.hasData = false;
  summary = null;
  showEmptyState();
  renderSourceState();
  elements.settingsDialog.close();
  showToast("取り込んだデータを削除しました。");
}

function showEmptyState(): void {
  elements.dashboard.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  elements.syncStatus.textContent = "未取り込み";
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

async function post<T = { ok: true }>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": bootstrapState.csrfToken },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  const data = (await response.json()) as T | { error?: { message?: string } };
  if (!response.ok) {
    const errorData = data as { error?: { message?: string } };
    throw new Error(errorData.error?.message ?? "リクエストに失敗しました。");
  }
  return data as T;
}

function setSettingsMessage(message: string, error = false): void {
  elements.settingsMessage.textContent = message;
  elements.settingsMessage.classList.toggle("error", error);
}

function showToast(message: string, error = false): void {
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast${error ? " error" : ""}`;
  toastTimer = window.setTimeout(() => elements.toast.classList.add("hidden"), 4_500);
}

function option(value: string, label: string, selected = false): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  return element;
}

function cell(text: string): HTMLTableCellElement {
  const element = document.createElement("td");
  element.textContent = text;
  return element;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面要素が見つかりません: ${selector}`);
  return element;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function niceMax(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function metricLabel(metric: ChartMetric): string {
  return { volumeKg: "ボリューム", topWeightKg: "最高重量", estimatedOneRepMaxKg: "推定1RM" }[
    metric
  ];
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました。";
}
