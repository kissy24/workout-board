import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig, SheetSettings } from "./types";

const APP_DIRECTORY = "workout-board";

export function configDirectory(homeDirectory = Bun.env.HOME): string {
  if (!homeDirectory) throw new Error("ホームディレクトリを特定できません。");
  return join(homeDirectory, "Library", "Application Support", APP_DIRECTORY);
}

export function configPath(homeDirectory = Bun.env.HOME): string {
  return join(configDirectory(homeDirectory), "config.json");
}

export async function loadConfig(homeDirectory = Bun.env.HOME): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(homeDirectory), "utf8");
    const parsed = JSON.parse(raw) as { sheet?: unknown };
    return { sheet: validSheetSettings(parsed.sheet) ? parsed.sheet : null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sheet: null };
    throw new Error("設定ファイルを読み込めませんでした。", { cause: error });
  }
}

export async function saveConfig(config: AppConfig, homeDirectory = Bun.env.HOME): Promise<void> {
  const directory = configDirectory(homeDirectory);
  const target = configPath(homeDirectory);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
}

function validSheetSettings(value: unknown): value is SheetSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.spreadsheetId === "string" &&
    /^[\w-]{20,100}$/.test(candidate.spreadsheetId) &&
    typeof candidate.spreadsheetTitle === "string" &&
    typeof candidate.sheetId === "number" &&
    Number.isInteger(candidate.sheetId) &&
    typeof candidate.sheetTitle === "string" &&
    typeof candidate.sourceUrl === "string"
  );
}

export function extractSpreadsheetReference(rawUrl: string): {
  spreadsheetId: string;
  gid: number | null;
  canonicalUrl: string;
} {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("有効なGoogleスプレッドシートURLを入力してください。");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new Error("docs.google.com のHTTPS URLだけを指定できます。");
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,100})(?:\/|$)/);
  if (!match?.[1]) throw new Error("スプレッドシートIDをURLから取得できません。");
  const rawGid = url.searchParams.get("gid") ?? url.hash.match(/(?:^#|&)gid=(\d+)/)?.[1] ?? null;
  const gid = rawGid === null ? null : Number(rawGid);
  if (gid !== null && (!Number.isSafeInteger(gid) || gid < 0)) {
    throw new Error("シートIDが不正です。");
  }
  return {
    spreadsheetId: match[1],
    gid,
    canonicalUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/edit${gid === null ? "" : `#gid=${gid}`}`,
  };
}
