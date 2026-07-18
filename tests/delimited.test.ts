import { describe, expect, test } from "bun:test";
import { parseDelimitedText } from "../src/lib/delimited";
import { parseImportedFile } from "../src/lib/import-store";

const header = "日付,種目,セット,重さ(kg),レップ数,ボリューム(kg),メモ";

describe("parseDelimitedText", () => {
  test("BOM、引用符、カンマ、セル内改行を含むCSVを読み取る", () => {
    const rows = parseDelimitedText(
      `\uFEFF${header}\r\n2026-03-04,ベンチプレス,1,30,5,150,"好調, 次も\n継続"\r\n`,
      "workouts.csv",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[6]).toBe("好調, 次も\n継続");
  });

  test("TSVを読み取る", () => {
    const rows = parseDelimitedText("日付\t種目\n2026-03-04\tスクワット\n", "workouts.tsv");
    expect(rows[1]).toEqual(["2026-03-04", "スクワット"]);
  });

  test("未対応の拡張子と閉じていない引用符を拒否する", () => {
    expect(() => parseDelimitedText(header, "workouts.txt")).toThrow("CSVまたはTSV");
    expect(() => parseDelimitedText(`${header}\n"broken`, "workouts.csv")).toThrow("引用符");
  });
});

describe("parseImportedFile", () => {
  test("CSVを既存のトレーニング形式へ変換する", () => {
    const result = parseImportedFile(
      "workouts.csv",
      `${header}\n2026/03/04,ベンチプレス,1,30,5,,好調\n`,
    );
    expect(result.records[0]).toMatchObject({
      date: "2026-03-04",
      exercise: "ベンチプレス",
      volumeKg: 150,
    });
  });

  test("必須ヘッダーがなければ拒否する", () => {
    expect(() => parseImportedFile("workouts.csv", "日付,種目\n")).toThrow("必要な列");
  });
});
