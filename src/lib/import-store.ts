import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDirectory } from "./config";
import { parseDelimitedText } from "./delimited";
import type { ImportedFile, ParsedWorkoutSheet } from "./types";
import { parseWorkoutValues } from "./workouts";

const IMPORT_FILE = "imported-workouts.json";

interface StoredImport extends ImportedFile {
  version: 1;
  contents: string;
}

export interface LoadedImport {
  file: ImportedFile;
  data: ParsedWorkoutSheet;
}

function importDirectory(homeDirectory?: string): string {
  if (homeDirectory) return configDirectory(homeDirectory);
  return Bun.env.WORKOUT_BOARD_DATA_DIRECTORY ?? configDirectory();
}

export function importDataPath(homeDirectory?: string): string {
  return join(importDirectory(homeDirectory), IMPORT_FILE);
}

export function parseImportedFile(fileName: string, contents: string): ParsedWorkoutSheet {
  const data = parseWorkoutValues(parseDelimitedText(contents, fileName));
  const headerError = data.warnings.find((warning) => warning.row === 1);
  if (data.records.length === 0 && headerError) throw new Error(headerError.message);
  return data;
}

export async function loadImportedFile(homeDirectory?: string): Promise<LoadedImport | null> {
  try {
    const raw = await readFile(importDataPath(homeDirectory), "utf8");
    const stored = JSON.parse(raw) as Partial<StoredImport>;
    if (
      stored.version !== 1 ||
      typeof stored.fileName !== "string" ||
      typeof stored.importedAt !== "string" ||
      !Number.isFinite(Date.parse(stored.importedAt)) ||
      typeof stored.contents !== "string"
    ) {
      throw new Error("invalid import data");
    }
    return {
      file: { type: "import", fileName: stored.fileName, importedAt: stored.importedAt },
      data: parseImportedFile(stored.fileName, stored.contents),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("保存したトレーニング記録を読み込めませんでした。", { cause: error });
  }
}

export async function saveImportedFile(
  fileName: string,
  contents: string,
  importedAt: string,
  homeDirectory?: string,
): Promise<void> {
  const directory = importDirectory(homeDirectory);
  const target = importDataPath(homeDirectory);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  const stored: StoredImport = { version: 1, type: "import", fileName, importedAt, contents };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
}

export async function clearImportedFile(homeDirectory?: string): Promise<void> {
  try {
    await unlink(importDataPath(homeDirectory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
