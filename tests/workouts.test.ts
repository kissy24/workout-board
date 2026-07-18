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
    ["2026-03-04", "チェストプレス", 1, 30, 10, 300, ""],
  ]);

  test("Epley式で推定1RMを求める", () => {
    expect(estimatedOneRepMax(30, 5)).toBeCloseTo(35);
  });

  test("最新記録を終点として期間と種目を集計する", () => {
    const dashboard = buildDashboard(parsed.records, [], "2026-03-04T10:00:00Z", "90", null);
    expect(dashboard.range).toEqual({ start: "2025-12-05", end: "2026-03-04" });
    expect(dashboard.kpis.totalVolumeKg.value).toBe(575);
    expect(dashboard.kpis.sessionCount.value).toBe(1);
    expect(dashboard.kpis.setCount.value).toBe(3);
    expect(dashboard.trends).toHaveLength(1);
    expect(dashboard.exercises[0]?.exercise).toBe("チェストプレス");
  });

  test("種目フィルターと全期間を適用する", () => {
    const dashboard = buildDashboard(parsed.records, [], null, "all", "ベンチプレス");
    expect(dashboard.kpis.totalVolumeKg.value).toBe(475);
    expect(dashboard.kpis.setCount.value).toBe(3);
    expect(dashboard.exercises).toHaveLength(1);
    expect(dashboard.kpis.totalVolumeKg.percentChange).toBeNull();
  });
});
