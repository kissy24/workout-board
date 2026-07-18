import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearImportedFile,
  importDataPath,
  loadImportedFile,
  saveImportedFile,
} from "../src/lib/import-store";

const temporaryHomes: string[] = [];
const contents = [
  "日付,種目,セット,重さ(kg),レップ数,ボリューム(kg),メモ",
  "2026-07-15,ベンチプレス,1,60,5,,好調",
].join("\n");

afterEach(async () => {
  await Promise.all(
    temporaryHomes.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("import store", () => {
  test("取り込んだ内容を権限0600で保存し、再読み込みできる", async () => {
    const home = await mkdtemp(join(tmpdir(), "workout-board-import-"));
    temporaryHomes.push(home);
    const importedAt = "2026-07-18T03:00:00.000Z";

    await saveImportedFile("workouts.csv", contents, importedAt, home);
    const loaded = await loadImportedFile(home);
    const fileStat = await stat(importDataPath(home));

    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(loaded?.file).toEqual({ type: "import", fileName: "workouts.csv", importedAt });
    expect(loaded?.data.records).toHaveLength(1);

    await clearImportedFile(home);
    expect(await loadImportedFile(home)).toBeNull();
  });
});
