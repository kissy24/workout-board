import type {
  DashboardSummary,
  ExerciseSummary,
  Metric,
  ParsedWorkoutSheet,
  Period,
  SessionExercise,
  SessionSummary,
  TrendPoint,
  ValidationWarning,
  WorkoutRecord,
} from "./types";

const EXPECTED_HEADERS = [
  "日付",
  "種目",
  "セット",
  "重さ(kg)",
  "レップ数",
  "ボリューム(kg)",
  "メモ",
] as const;

const DAY_MS = 86_400_000;
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

function normalizedHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replaceAll(/\s+/g, "")
    .toLowerCase();
}

function parseDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return new Date(SHEETS_EPOCH_MS + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
  }
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "")
    .trim()
    .replaceAll(",", "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? "").trim() === "");
}

export function parseWorkoutValues(values: unknown[][]): ParsedWorkoutSheet {
  if (values.length === 0) {
    return { records: [], warnings: [{ row: 1, message: "ヘッダー行がありません。" }] };
  }

  const headers = values[0] ?? [];
  const indexes = new Map<string, number>();
  headers.forEach((header, index) => {
    indexes.set(normalizedHeader(header), index);
  });
  const missing = EXPECTED_HEADERS.filter((header) => !indexes.has(normalizedHeader(header)));
  if (missing.length > 0) {
    return {
      records: [],
      warnings: [{ row: 1, message: `必要な列がありません: ${missing.join("、")}` }],
    };
  }

  const at = (row: unknown[], header: (typeof EXPECTED_HEADERS)[number]) =>
    row[indexes.get(normalizedHeader(header)) ?? -1];
  const records: WorkoutRecord[] = [];
  const warnings: ValidationWarning[] = [];

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const rowNumber = index + 1;
    if (emptyRow(row)) continue;

    const date = parseDate(at(row, "日付"));
    const exercise = String(at(row, "種目") ?? "")
      .trim()
      .normalize("NFKC");
    const set = parseNumber(at(row, "セット"));
    const weightKg = parseNumber(at(row, "重さ(kg)"));
    const reps = parseNumber(at(row, "レップ数"));
    const rawVolume = at(row, "ボリューム(kg)");
    const parsedVolume = parseNumber(rawVolume);
    const memo = String(at(row, "メモ") ?? "").trim();
    const problems: string[] = [];

    if (!date) problems.push("日付がYYYY-MM-DD形式ではありません");
    if (!exercise || exercise.length > 100) problems.push("種目が空、または100文字を超えています");
    if (set === null || !Number.isInteger(set) || set < 1 || set > 100) {
      problems.push("セットは1〜100の整数にしてください");
    }
    if (weightKg === null || weightKg < 0 || weightKg > 2_000) {
      problems.push("重さは0〜2000kgにしてください");
    }
    if (reps === null || !Number.isInteger(reps) || reps < 1 || reps > 1_000) {
      problems.push("レップ数は1〜1000の整数にしてください");
    }
    if (parsedVolume !== null && (parsedVolume < 0 || parsedVolume > 10_000_000)) {
      problems.push("ボリュームが許容範囲外です");
    }
    if (memo.length > 2_000) problems.push("メモは2000文字以内にしてください");

    if (
      problems.length > 0 ||
      !date ||
      !exercise ||
      set === null ||
      weightKg === null ||
      reps === null
    ) {
      warnings.push({ row: rowNumber, message: problems.join("。") });
      continue;
    }

    records.push({
      date,
      exercise,
      set,
      weightKg,
      reps,
      volumeKg: parsedVolume ?? weightKg * reps,
      memo,
      sourceRow: rowNumber,
    });
  }

  records.sort((a, b) => a.date.localeCompare(b.date) || a.set - b.set);
  return { records, warnings };
}

export function estimatedOneRepMax(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

function subtractDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function metric(current: number, previous: number): Metric {
  return { value: current, percentChange: percentChange(current, previous) };
}

function totalVolume(records: WorkoutRecord[]): number {
  return records.reduce((sum, record) => sum + record.volumeKg, 0);
}

function sessionCount(records: WorkoutRecord[]): number {
  return new Set(records.map((record) => record.date)).size;
}

function bestOneRepMax(records: WorkoutRecord[]): number {
  return records.reduce(
    (best, record) => Math.max(best, estimatedOneRepMax(record.weightKg, record.reps)),
    0,
  );
}

function buildTrends(records: WorkoutRecord[]): TrendPoint[] {
  const byDate = new Map<string, WorkoutRecord[]>();
  for (const record of records) {
    const entries = byDate.get(record.date) ?? [];
    entries.push(record);
    byDate.set(record.date, entries);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({
      date,
      volumeKg: totalVolume(entries),
      topWeightKg: Math.max(...entries.map((entry) => entry.weightKg)),
      estimatedOneRepMaxKg: bestOneRepMax(entries),
    }));
}

function buildExerciseSummaries(records: WorkoutRecord[]): ExerciseSummary[] {
  const groups = new Map<string, WorkoutRecord[]>();
  for (const record of records) {
    const entries = groups.get(record.exercise) ?? [];
    entries.push(record);
    groups.set(record.exercise, entries);
  }
  return [...groups.entries()]
    .map(([exercise, entries]) => ({
      exercise,
      totalVolumeKg: totalVolume(entries),
      topWeightKg: Math.max(...entries.map((entry) => entry.weightKg)),
      estimatedOneRepMaxKg: bestOneRepMax(entries),
      setCount: entries.length,
      sessionCount: sessionCount(entries),
    }))
    .sort(
      (a, b) => b.totalVolumeKg - a.totalVolumeKg || a.exercise.localeCompare(b.exercise, "ja"),
    );
}

function buildSessions(records: WorkoutRecord[]): SessionSummary[] {
  const dates = new Map<string, WorkoutRecord[]>();
  for (const record of records) {
    const entries = dates.get(record.date) ?? [];
    entries.push(record);
    dates.set(record.date, entries);
  }
  return [...dates.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => {
      const exerciseGroups = new Map<string, WorkoutRecord[]>();
      for (const record of entries) {
        const exerciseRecords = exerciseGroups.get(record.exercise) ?? [];
        exerciseRecords.push(record);
        exerciseGroups.set(record.exercise, exerciseRecords);
      }
      const exercises: SessionExercise[] = [...exerciseGroups.entries()].map(
        ([exercise, exerciseRecords]) => ({
          exercise,
          sets: exerciseRecords
            .sort((a, b) => a.set - b.set)
            .map(({ set, weightKg, reps, volumeKg, memo }) => ({
              set,
              weightKg,
              reps,
              volumeKg,
              memo,
            })),
        }),
      );
      return { date, totalVolumeKg: totalVolume(entries), exercises };
    });
}

export function buildDashboard(
  allRecords: WorkoutRecord[],
  warnings: ValidationWarning[],
  lastSyncedAt: string | null,
  period: Period,
  exercise: string | null,
): DashboardSummary {
  const availableExercises = [...new Set(allRecords.map((record) => record.exercise))].sort(
    (a, b) => a.localeCompare(b, "ja"),
  );
  const exerciseRecords = exercise
    ? allRecords.filter((record) => record.exercise === exercise)
    : allRecords;
  const latestDate = exerciseRecords.at(-1)?.date ?? null;
  const days = period === "all" ? null : Number(period);
  const start = latestDate && days ? subtractDays(latestDate, days - 1) : null;
  const current = exerciseRecords.filter(
    (record) => (!start || record.date >= start) && (!latestDate || record.date <= latestDate),
  );
  const previousEnd = start && days ? subtractDays(start, 1) : null;
  const previousStart = previousEnd && days ? subtractDays(previousEnd, days - 1) : null;
  const previous =
    previousStart && previousEnd
      ? exerciseRecords.filter(
          (record) => record.date >= previousStart && record.date <= previousEnd,
        )
      : [];

  return {
    period,
    exercise,
    range: {
      start: period === "all" ? (exerciseRecords[0]?.date ?? null) : start,
      end: latestDate,
    },
    kpis: {
      totalVolumeKg: metric(totalVolume(current), totalVolume(previous)),
      sessionCount: metric(sessionCount(current), sessionCount(previous)),
      setCount: metric(current.length, previous.length),
      estimatedOneRepMaxKg: metric(bestOneRepMax(current), bestOneRepMax(previous)),
    },
    trends: buildTrends(current),
    exercises: buildExerciseSummaries(current),
    sessions: buildSessions(current),
    availableExercises,
    warnings,
    lastSyncedAt,
  };
}
