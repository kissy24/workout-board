import type { SheetSettings, WorksheetInfo } from "./types";
import { parseWorkoutValues } from "./workouts";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

interface SpreadsheetMetadataResponse {
  properties?: { title?: unknown };
  sheets?: Array<{ properties?: Record<string, unknown> }>;
  error?: { message?: unknown };
}

export async function inspectSpreadsheet(
  spreadsheetId: string,
  accessToken: string,
): Promise<{ title: string; sheets: WorksheetInfo[] }> {
  const query = new URLSearchParams({ fields: "properties.title,sheets.properties" });
  const data = await googleRequest<SpreadsheetMetadataResponse>(
    `${API_BASE}/${encodeURIComponent(spreadsheetId)}?${query}`,
    accessToken,
  );
  const title = typeof data.properties?.title === "string" ? data.properties.title : "名称未設定";
  const sheets = (data.sheets ?? []).flatMap((item): WorksheetInfo[] => {
    const properties = item.properties;
    if (
      typeof properties?.sheetId !== "number" ||
      typeof properties.title !== "string" ||
      typeof properties.index !== "number"
    ) {
      return [];
    }
    return [
      {
        sheetId: properties.sheetId,
        title: properties.title,
        index: properties.index,
        hidden: properties.hidden === true,
      },
    ];
  });
  if (sheets.length === 0) throw new Error("読み取れるワークシートがありません。");
  return { title, sheets };
}

export async function fetchWorkoutSheet(settings: SheetSettings, accessToken: string) {
  const range = `'${settings.sheetTitle.replaceAll("'", "''")}'!A:G`;
  const query = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
    majorDimension: "ROWS",
  });
  const data = await googleRequest<{ values?: unknown[][] }>(
    `${API_BASE}/${encodeURIComponent(settings.spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    accessToken,
  );
  return parseWorkoutValues(data.values ?? []);
}

async function googleRequest<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    // The status code still provides a stable, non-sensitive error below.
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Google認証の有効期限が切れています。");
    if (response.status === 403) throw new Error("スプレッドシートの読み取り権限がありません。");
    if (response.status === 404) throw new Error("スプレッドシートまたはシートが見つかりません。");
    if (response.status === 429)
      throw new Error("Google APIの利用上限に達しました。しばらく待ってください。");
    throw new Error("Google Sheetsからデータを取得できませんでした。");
  }
  return data as T;
}
