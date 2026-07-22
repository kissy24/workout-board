import type {
  DashboardSummary,
  ExerciseSummary,
  ParsedWorkoutSheet,
  Period,
  SessionExercise,
  SessionSummary,
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

function sessionCount(records: WorkoutRecord[]): number {
  return new Set(records.map((record) => record.date)).size;
}

function calendarDayDifference(later: string, earlier: string): number {
  return Math.floor(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS,
  );
}

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = value.getUTCDay();
  return subtractDays(date, weekday === 0 ? 6 : weekday - 1);
}

function hasSessionInWeek(sessionDates: Set<string>, weekStart: string): boolean {
  const weekEnd = subtractDays(weekStart, -6);
  return [...sessionDates].some((date) => date >= weekStart && date <= weekEnd);
}

function activeWeekStreak(records: WorkoutRecord[], referenceDate: string): number {
  const sessionDates = new Set(
    records.filter((record) => record.date <= referenceDate).map((record) => record.date),
  );
  const currentWeek = mondayOfWeek(referenceDate);
  let cursor = hasSessionInWeek(sessionDates, currentWeek)
    ? currentWeek
    : subtractDays(currentWeek, 7);
  if (!hasSessionInWeek(sessionDates, cursor)) return 0;

  let streak = 0;
  while (hasSessionInWeek(sessionDates, cursor)) {
    streak += 1;
    cursor = subtractDays(cursor, 7);
  }
  return streak;
}

function weeklyFrequency(records: WorkoutRecord[], referenceDate: string): number {
  const start = subtractDays(referenceDate, 27);
  const days = new Set(
    records
      .filter((record) => record.date >= start && record.date <= referenceDate)
      .map((record) => record.date),
  ).size;
  return days / 4;
}

function personalRecordExerciseCount(
  records: WorkoutRecord[],
  rangeStart: string | null,
  rangeEnd: string | null,
): number {
  if (!rangeStart || !rangeEnd) return 0;
  const dailyBest = new Map<string, { exercise: string; date: string; weightKg: number }>();
  for (const record of records) {
    if (record.date > rangeEnd) continue;
    const key = `${record.exercise}\0${record.date}`;
    const existing = dailyBest.get(key);
    if (!existing || record.weightKg > existing.weightKg) {
      dailyBest.set(key, {
        exercise: record.exercise,
        date: record.date,
        weightKg: record.weightKg,
      });
    }
  }

  const bestByExercise = new Map<string, number>();
  const updatedExercises = new Set<string>();
  const points = [...dailyBest.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.exercise.localeCompare(b.exercise, "ja"),
  );
  for (const point of points) {
    const previousBest = bestByExercise.get(point.exercise);
    if (point.date >= rangeStart && previousBest !== undefined && point.weightKg > previousBest) {
      updatedExercises.add(point.exercise);
    }
    bestByExercise.set(point.exercise, Math.max(previousBest ?? point.weightKg, point.weightKg));
  }
  return updatedExercises.size;
}

function betterSet(a: WorkoutRecord, b: WorkoutRecord): WorkoutRecord {
  if (a.weightKg !== b.weightKg) return a.weightKg > b.weightKg ? a : b;
  if (a.reps !== b.reps) return a.reps > b.reps ? a : b;
  return a.set < b.set ? a : b;
}

function buildExerciseSummaries(records: WorkoutRecord[]): ExerciseSummary[] {
  const groups = new Map<string, WorkoutRecord[]>();
  for (const record of records) {
    const entries = groups.get(record.exercise) ?? [];
    entries.push(record);
    groups.set(record.exercise, entries);
  }
  return [...groups.entries()]
    .map(([exercise, entries]) => {
      const bestSet = entries.reduce(betterSet);
      return {
        exercise,
        latestDate: entries.at(-1)?.date ?? "",
        bestSetWeightKg: bestSet.weightKg,
        bestSetReps: bestSet.reps,
        sessionCount: sessionCount(entries),
      };
    })
    .sort(
      (a, b) =>
        b.latestDate.localeCompare(a.latestDate) || a.exercise.localeCompare(b.exercise, "ja"),
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
      return { date, exercises };
    });
}

export function buildDashboard(
  allRecords: WorkoutRecord[],
  warnings: ValidationWarning[],
  lastSyncedAt: string | null,
  period: Period,
  referenceDate = localToday(),
): DashboardSummary {
  const availableExercises = [...new Set(allRecords.map((record) => record.exercise))].sort(
    (a, b) => a.localeCompare(b, "ja"),
  );
  const latestDate = allRecords.at(-1)?.date ?? null;
  const days = period === "all" ? null : Number(period);
  const start = latestDate && days ? subtractDays(latestDate, days - 1) : null;
  const current = allRecords.filter(
    (record) => (!start || record.date >= start) && (!latestDate || record.date <= latestDate),
  );
  const rangeStart = period === "all" ? (allRecords[0]?.date ?? null) : start;
  const lastWorkoutDate = latestDate;

  return {
    period,
    range: {
      start: rangeStart,
      end: latestDate,
    },
    insights: {
      lastWorkoutDate,
      daysSinceLastWorkout: lastWorkoutDate
        ? Math.max(0, calendarDayDifference(referenceDate, lastWorkoutDate))
        : null,
      weeklyFrequency: weeklyFrequency(allRecords, referenceDate),
      activeWeekStreak: activeWeekStreak(allRecords, referenceDate),
      personalRecordExerciseCount: personalRecordExerciseCount(allRecords, rangeStart, latestDate),
    },
    exercises: buildExerciseSummaries(current),
    sessions: buildSessions(current),
    availableExercises,
    warnings,
    lastSyncedAt,
  };
}
