import { afterEach, describe, expect, test } from "bun:test";
import { fetchWorkoutSheet, inspectSpreadsheet } from "../src/lib/google-sheets";
import type { SheetSettings } from "../src/lib/types";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Google Sheets adapter", () => {
  test("メタデータからワークシート一覧を作る", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
      return Response.json({
        properties: { title: "記録" },
        sheets: [
          { properties: { sheetId: 0, title: "トレーニング", index: 0 } },
          { properties: { sheetId: 1, title: "設定", index: 1, hidden: true } },
        ],
      });
    }) as unknown as typeof fetch;
    const result = await inspectSpreadsheet("sheet-id", "token");
    expect(result.title).toBe("記録");
    expect(result.sheets).toHaveLength(2);
    expect(result.sheets[1]?.hidden).toBe(true);
  });

  test("選択シートのA:Gを読み込んで検証する", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("'%E8%A8%98%E9%8C%B2'!A%3AG");
      return Response.json({
        values: [
          ["日付", "種目", "セット", "重さ(kg)", "レップ数", "ボリューム(kg)", "メモ"],
          ["2026-03-04", "ベンチプレス", 1, 30, 5, 150, ""],
        ],
      });
    }) as unknown as typeof fetch;
    const settings: SheetSettings = {
      spreadsheetId: "sheet-id",
      spreadsheetTitle: "記録",
      sheetId: 0,
      sheetTitle: "記録",
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    };
    const result = await fetchWorkoutSheet(settings, "token");
    expect(result.records[0]?.volumeKg).toBe(150);
  });

  test("Google APIのエラー本文を外部へ露出しない", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: { message: "sensitive" } },
        { status: 403 },
      )) as unknown as typeof fetch;
    expect(inspectSpreadsheet("sheet-id", "token")).rejects.toThrow("読み取り権限");
  });
});
