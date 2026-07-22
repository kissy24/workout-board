import type { DashboardSummary, ImportedFile, SessionExercise } from "../lib/types";

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

type WorkoutSet = SessionExercise["sets"][number];

interface TopSetPoint {
  date: string;
  topSet: WorkoutSet;
  sets: WorkoutSet[];
}

const elements = {
  dashboard: query<HTMLElement>("#dashboard"),
  emptyState: query<HTMLElement>("#empty-state"),
  settingsDialog: query<HTMLDialogElement>("#settings-dialog"),
  settingsButton: query<HTMLButtonElement>("#settings-button"),
  emptySettingsButton: query<HTMLButtonElement>("#empty-settings-button"),
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
  chart: query<SVGSVGElement>("#progress-chart"),
  chartEmpty: query<HTMLElement>("#chart-empty"),
  chartTooltip: query<HTMLElement>("#chart-tooltip"),
  exerciseLatestSet: query<HTMLElement>("#exercise-latest-set"),
  exerciseBestSet: query<HTMLElement>("#exercise-best-set"),
  exerciseWeightChange: query<HTMLElement>("#exercise-weight-change"),
  exerciseTable: query<HTMLTableSectionElement>("#exercise-table"),
  noteList: query<HTMLUListElement>("#note-list"),
  historyList: query<HTMLElement>("#history-list"),
  warningPanel: query<HTMLDetailsElement>("#warning-panel"),
  warningCount: query<HTMLElement>("#warning-count"),
  warningList: query<HTMLUListElement>("#warning-list"),
};

let bootstrapState: BootstrapState;
let summary: DashboardSummary | null = null;
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
  elements.periodSelect.addEventListener("change", () => void loadDashboard());
  elements.exerciseSelect.addEventListener("change", renderExerciseProgress);
  elements.chooseFileButton.addEventListener("click", requestFileSelection);
  elements.importFile.addEventListener("change", () => void importFile());
  elements.resetButton.addEventListener("click", () => void resetSettings());
  elements.exerciseTable.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-exercise]");
    if (!button?.dataset.exercise || !summary) return;
    elements.exerciseSelect.value = button.dataset.exercise;
    renderExerciseProgress();
    query<HTMLElement>("#exercise-progress").scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

function openSettings(): void {
  renderSourceState();
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
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
  elements.settingsButton.classList.add("loading");
  elements.settingsButton.disabled = true;
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
    elements.settingsButton.classList.remove("loading");
    elements.settingsButton.disabled = false;
  }
}

async function loadDashboard(): Promise<void> {
  const queryString = new URLSearchParams({ period: elements.periodSelect.value });
  summary = await get<DashboardSummary>(`/api/dashboard?${queryString}`);
  renderDashboard(summary);
}

function renderDashboard(data: DashboardSummary): void {
  elements.emptyState.classList.add("hidden");
  elements.dashboard.classList.remove("hidden");
  elements.dateRange.textContent =
    data.range.start && data.range.end
      ? `${formatDate(data.range.start)} — ${formatDate(data.range.end)}`
      : "表示できる記録がありません";
  elements.syncStatus.textContent = data.lastSyncedAt
    ? `最終取込 ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.lastSyncedAt))}`
    : "未取り込み";

  renderInsights(data);
  updateExerciseOptions(data);
  renderExerciseProgress();
  renderExercises(data);
  renderNotes(data);
  renderHistory(data);
  renderWarnings(data);
}

function renderInsights(data: DashboardSummary): void {
  const insights = data.insights;
  query<HTMLElement>("#insight-last").textContent =
    insights.daysSinceLastWorkout === null
      ? "—"
      : insights.daysSinceLastWorkout === 0
        ? "今日"
        : `${insights.daysSinceLastWorkout}日前`;
  query<HTMLElement>("#insight-last-detail").textContent = insights.lastWorkoutDate
    ? formatDate(insights.lastWorkoutDate)
    : "記録なし";
  query<HTMLElement>("#insight-frequency").textContent =
    `${formatDecimal(insights.weeklyFrequency)} 回`;
  query<HTMLElement>("#insight-streak").textContent = `${insights.activeWeekStreak} 週`;
  query<HTMLElement>("#insight-pr").textContent = `${insights.personalRecordExerciseCount} 種目`;
}

function updateExerciseOptions(data: DashboardSummary): void {
  const current = data.exercises.some(
    (exercise) => exercise.exercise === elements.exerciseSelect.value,
  )
    ? elements.exerciseSelect.value
    : (data.exercises[0]?.exercise ?? "");
  elements.exerciseSelect.replaceChildren(
    ...data.exercises.map((exercise) =>
      option(exercise.exercise, exercise.exercise, exercise.exercise === current),
    ),
  );
  elements.exerciseSelect.disabled = data.exercises.length === 0;
}

function renderExerciseProgress(): void {
  if (!summary) return;
  const exerciseName = elements.exerciseSelect.value;
  const points = exerciseName ? buildTopSetPoints(summary, exerciseName) : [];
  const latest = points.at(-1);
  const first = points[0];
  const best = points.reduce<TopSetPoint | null>(
    (current, point) =>
      !current || betterWorkoutSet(point.topSet, current.topSet) === point.topSet ? point : current,
    null,
  );

  elements.exerciseLatestSet.textContent = latest ? formatSet(latest.topSet) : "—";
  elements.exerciseBestSet.textContent = best ? formatSet(best.topSet) : "—";
  if (!first || !latest) {
    elements.exerciseWeightChange.textContent = "—";
    elements.exerciseWeightChange.className = "summary-value";
  } else {
    const change = latest.topSet.weightKg - first.topSet.weightKg;
    elements.exerciseWeightChange.textContent = `${change > 0 ? "+" : ""}${formatDecimal(change)} kg`;
    elements.exerciseWeightChange.className = `summary-value${change > 0 ? " positive" : change < 0 ? " negative" : ""}`;
  }
  drawChart(points, exerciseName);
}

function buildTopSetPoints(data: DashboardSummary, exerciseName: string): TopSetPoint[] {
  return data.sessions
    .flatMap((session) => {
      const exercise = session.exercises.find((item) => item.exercise === exerciseName);
      if (!exercise || exercise.sets.length === 0) return [];
      return [
        {
          date: session.date,
          topSet: exercise.sets.reduce(betterWorkoutSet),
          sets: exercise.sets,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function betterWorkoutSet(a: WorkoutSet, b: WorkoutSet): WorkoutSet {
  if (a.weightKg !== b.weightKg) return a.weightKg > b.weightKg ? a : b;
  if (a.reps !== b.reps) return a.reps > b.reps ? a : b;
  return a.set < b.set ? a : b;
}

function drawChart(points: TopSetPoint[], exerciseName: string): void {
  const svg = elements.chart;
  const title = svg.querySelector("title") ?? svgElement("title");
  title.textContent = `${exerciseName || "種目"}のトップセット推移`;
  const description = svg.querySelector("desc") ?? svgElement("desc");
  description.textContent = `${points.length}回のトップセットを日付順に表示しています。`;
  svg.replaceChildren(title, description);
  hideChartTooltip();
  elements.chartEmpty.classList.toggle("hidden", points.length > 0);
  svg.classList.toggle("hidden", points.length === 0);
  if (points.length === 0) return;

  const width = 960;
  const height = 320;
  const padding = { top: 28, right: 28, bottom: 48, left: 68 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(...points.map((point) => point.topSet.weightKg), 1);
  const roundedMax = niceMax(max);
  const coordinates = points.map((point, index) => ({
    x:
      padding.left +
      (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth),
    y: padding.top + plotHeight - (point.topSet.weightKg / roundedMax) * plotHeight,
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
    label.textContent = `${formatDecimal(roundedMax * (1 - index / 4))}`;
    svg.append(line, label);
  }

  const linePoints = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  svg.append(svgElement("polyline", { points: linePoints, class: "chart-line" }));

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  coordinates.forEach(({ x, y, point }, index) => {
    const hitTarget = svgElement("circle", { cx: x, cy: y, r: 14, class: "chart-hit" });
    const circle = svgElement("circle", {
      cx: x,
      cy: y,
      r: 5,
      class: "chart-point",
      tabindex: 0,
    });
    circle.setAttribute("aria-label", `${formatDate(point.date)}、${formatSet(point.topSet)}`);
    const showTooltip = () => displayChartTooltip(svg, x, y, point);
    for (const target of [hitTarget, circle]) {
      target.addEventListener("mouseenter", showTooltip);
      target.addEventListener("mouseleave", hideChartTooltip);
    }
    circle.addEventListener("focus", showTooltip);
    circle.addEventListener("blur", hideChartTooltip);
    svg.append(hitTarget, circle);
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

function displayChartTooltip(svg: SVGSVGElement, x: number, y: number, point: TopSetPoint): void {
  const date = document.createElement("strong");
  date.textContent = formatDate(point.date);
  const topSet = document.createElement("p");
  topSet.className = "tooltip-top-set";
  topSet.textContent = `トップセット  ${formatSet(point.topSet)}`;
  const list = document.createElement("ul");
  for (const set of point.sets.slice(0, 8)) {
    const item = document.createElement("li");
    item.textContent = `SET ${set.set}　${formatSet(set)}`;
    list.append(item);
  }
  if (point.sets.length > 8) {
    const remaining = document.createElement("li");
    remaining.className = "tooltip-remaining";
    remaining.textContent = `ほか ${point.sets.length - 8} セット`;
    list.append(remaining);
  }
  elements.chartTooltip.replaceChildren(date, topSet, list);

  const svgRect = svg.getBoundingClientRect();
  const parentRect = elements.chartTooltip.parentElement?.getBoundingClientRect();
  if (parentRect) {
    const anchorLeft = svgRect.left - parentRect.left + (x / 960) * svgRect.width;
    const tooltipLeft = Math.min(Math.max(anchorLeft, 112), parentRect.width - 112);
    const anchorTop = svgRect.top - parentRect.top + (y / 320) * svgRect.height;
    elements.chartTooltip.style.left = `${tooltipLeft}px`;
    elements.chartTooltip.style.top = `${anchorTop}px`;
    elements.chartTooltip.style.setProperty("--tip-offset", `${anchorLeft - tooltipLeft}px`);
    elements.chartTooltip.classList.toggle(
      "below",
      anchorTop < elements.chartTooltip.offsetHeight + 12,
    );
  }
  elements.chartTooltip.classList.add("visible");
}

function hideChartTooltip(): void {
  elements.chartTooltip.classList.remove("visible");
}

function renderExercises(data: DashboardSummary): void {
  elements.exerciseTable.replaceChildren(
    ...data.exercises.map((exercise) => {
      const row = document.createElement("tr");
      const exerciseCell = document.createElement("td");
      const exerciseButton = document.createElement("button");
      exerciseButton.type = "button";
      exerciseButton.className = "exercise-link";
      exerciseButton.dataset.exercise = exercise.exercise;
      exerciseButton.textContent = exercise.exercise;
      exerciseButton.setAttribute("aria-label", `${exercise.exercise}の推移を見る`);
      exerciseCell.append(exerciseButton);
      row.append(
        exerciseCell,
        cell(formatDate(exercise.latestDate)),
        cell(`${formatDecimal(exercise.bestSetWeightKg)} kg × ${exercise.bestSetReps}`),
        cell(`${exercise.sessionCount} 日`),
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
      const meta = document.createElement("span");
      const setCount = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
      meta.textContent = `${session.exercises.length}種目 · ${setCount}セット`;
      date.append(strong, meta);
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
          chip.append(index, document.createTextNode(formatSet(set)));
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

function formatSet(set: Pick<WorkoutSet, "weightKg" | "reps">): string {
  return `${formatDecimal(set.weightKg)} kg × ${set.reps}`;
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

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
}

function niceMax(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました。";
}
