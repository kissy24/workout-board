function demoDate(daysAgo: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const DEMO_VALUES: unknown[][] = [
  ["日付", "種目", "セット", "重さ(kg)", "レップ数", "ボリューム(kg)", "メモ"],
  [demoDate(35), "ベンチプレス", 1, 25, 8, 200, "フォームを意識"],
  [demoDate(35), "ベンチプレス", 2, 25, 7, 175, ""],
  [demoDate(35), "チェストプレス", 1, 25, 10, 250, ""],
  [demoDate(21), "ベンチプレス", 1, 27.5, 7, 192.5, ""],
  [demoDate(21), "ベンチプレス", 2, 27.5, 6, 165, ""],
  [demoDate(21), "インクラインダンベルプレス", 1, 8, 8, 64, ""],
  [demoDate(14), "ベンチプレス", 1, 30, 5, 150, ""],
  [demoDate(14), "ベンチプレス", 2, 30, 4, 120, "最後の1回が重かった"],
  [demoDate(14), "チェストプレス", 1, 30, 10, 300, ""],
  [demoDate(7), "ベンチプレス", 1, 32.5, 4, 130, "自己ベスト更新"],
  [demoDate(7), "ベンチプレス", 2, 27.5, 7, 192.5, ""],
  [demoDate(7), "インクラインダンベルプレス", 1, 10, 8, 80, ""],
  [demoDate(1), "ベンチプレス", 1, 32.5, 5, 162.5, "前回より安定"],
  [demoDate(1), "ベンチプレス", 2, 30, 6, 180, ""],
  [demoDate(1), "ベンチプレス", 3, 27.5, 8, 220, ""],
  [demoDate(1), "インクラインダンベルプレス", 1, 12, 6, 72, ""],
  [demoDate(1), "インクラインダンベルプレス", 2, 10, 8, 80, ""],
  [demoDate(1), "チェストプレス", 1, 32.5, 10, 325, ""],
];
