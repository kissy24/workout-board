import { describe, expect, test } from "bun:test";
import { buildDashboard, estimatedOneRepMax, parseWorkoutValues } from "../src/lib/workouts";

const headers = ["日付", "種目", "セット", "重さ(kg)", "レップ数", "ボリューム(kg)", "メモ"];

describe("parseWorkoutValues", () => {
  test("Google Sheetsの行を正規化し、空のボリュームを補完する", () => {
    const result = parseWorkoutValues([
      headers,
      ["2026/03/04", " ベンチプレス ", "1", "30.0", "5", "", "好調"],
      [46_356, "チェストプレス", 1, 30, 10, 300, ""],
      ["", "", "", "", "", "", ""],
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      date: "2026-03-04",
      exercise: "ベンチプレス",
      volumeKg: 150,
      memo: "好調",
    });
    expect(result.records[1]?.date).toBe("2026-11-30");
  });

  test("不正な行を除外して行番号付き警告を返す", () => {
    const result = parseWorkoutValues([
      headers,
      ["2026-02-30", "ベンチプレス", 0, -1, 0, -1, ""],
      ["2026-03-04", "ベンチプレス", 1, 30, 5, 150, ""],
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.row).toBe(2);
    expect(result.warnings[0]?.message).toContain("日付");
  });

  test("必須ヘッダーが欠けていればデータを取り込まない", () => {
    const result = parseWorkoutValues([["日付", "種目"]]);
    expect(result.records).toEqual([]);
    expect(result.warnings[0]?.message).toContain("セット");
  });
});

describe("dashboard aggregation", () => {
  const parsed = parseWorkoutValues([
    headers,
    ["2025-12-01", "ベンチプレス", 1, 20, 10, 200, "以前"],
    ["2026-03-04", "ベンチプレス", 1, 30, 5, 150, "潰れた"],
    ["2026-03-04", "ベンチプレス", 2, 25, 5, 125, ""],
    ["2026-03-04", "ベンチプレス", 3, 30, 7, 210, ""],
    ["2026-03-04", "チェストプレス", 1, 30, 10, 300, ""],
  ]);

  test("Epley式で推定1RMを求める", () => {
    expect(estimatedOneRepMax(30, 5)).toBeCloseTo(35);
  });

  test("最新記録を終点として期間と種目サマリーを集計する", () => {
    const dashboard = buildDashboard(
      parsed.records,
      [],
      "2026-03-04T10:00:00Z",
      "90",
      "2026-03-04",
    );
    expect(dashboard.range).toEqual({ start: "2025-12-05", end: "2026-03-04" });
    expect(dashboard.sessions).toHaveLength(1);
    expect(dashboard.exercises).toHaveLength(2);
    expect(dashboard.exercises.find((item) => item.exercise === "ベンチプレス")).toMatchObject({
      latestDate: "2026-03-04",
      bestSetWeightKg: 30,
      bestSetReps: 7,
      sessionCount: 1,
    });
  });

  test("今日を基準に継続と成果の指標を返す", () => {
    const dashboard = buildDashboard(parsed.records, [], null, "90", "2026-03-04");
    expect(dashboard.insights).toEqual({
      lastWorkoutDate: "2026-03-04",
      daysSinceLastWorkout: 0,
      weeklyFrequency: 0.25,
      activeWeekStreak: 1,
      personalRecordExerciseCount: 1,
    });
  });

  test("今週が空なら先週から連続週を数え、直近28日の頻度を求める", () => {
    const consistency = parseWorkoutValues([
      headers,
      ["2026-02-23", "スクワット", 1, 80, 5, "", ""],
      ["2026-03-02", "スクワット", 1, 82.5, 5, "", ""],
      ["2026-03-02", "ベンチプレス", 1, 60, 5, "", ""],
    ]);
    const dashboard = buildDashboard(consistency.records, [], null, "all", "2026-03-09");
    expect(dashboard.insights.daysSinceLastWorkout).toBe(7);
    expect(dashboard.insights.weeklyFrequency).toBe(0.5);
    expect(dashboard.insights.activeWeekStreak).toBe(2);
    expect(dashboard.insights.personalRecordExerciseCount).toBe(1);
  });

  test("記録がなければ空の指標を返す", () => {
    const dashboard = buildDashboard([], [], null, "180", "2026-03-04");
    expect(dashboard.range).toEqual({ start: null, end: null });
    expect(dashboard.insights).toEqual({
      lastWorkoutDate: null,
      daysSinceLastWorkout: null,
      weeklyFrequency: 0,
      activeWeekStreak: 0,
      personalRecordExerciseCount: 0,
    });
  });

  test("年をまたぐ連続週を数え、空白週でストリークを区切る", () => {
    const consecutive = parseWorkoutValues([
      headers,
      ["2025-12-22", "スクワット", 1, 80, 5, "", ""],
      ["2025-12-29", "スクワット", 1, 82.5, 5, "", ""],
      ["2026-01-05", "スクワット", 1, 85, 5, "", ""],
    ]);
    const gapped = parseWorkoutValues([
      headers,
      ["2025-12-22", "スクワット", 1, 80, 5, "", ""],
      ["2026-01-05", "スクワット", 1, 85, 5, "", ""],
    ]);

    expect(
      buildDashboard(consecutive.records, [], null, "all", "2026-01-06").insights.activeWeekStreak,
    ).toBe(3);
    expect(
      buildDashboard(gapped.records, [], null, "all", "2026-01-06").insights.activeWeekStreak,
    ).toBe(1);
  });
});
