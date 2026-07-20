# Workout Board

筋力トレーニングの記録を、Macの中だけで安全に可視化するローカルファーストなダッシュボードです。CSV／TSVを取り込むだけで、トレーニング量や種目ごとの成長をすぐに振り返れます。

[![CI](https://github.com/kissy24/workout-board/actions/workflows/ci.yml/badge.svg)](https://github.com/kissy24/workout-board/actions/workflows/ci.yml)
![Bun](https://img.shields.io/badge/runtime-Bun%201.3.14-19231f)
[![License: MIT](https://img.shields.io/badge/license-MIT-b9f34a)](LICENSE)

## 特徴

- 総ボリューム、セッション数、完了セット数、推定1RMを一覧表示
- 1ヶ月・3ヶ月・6ヶ月・全期間で成長推移を切り替え
- 種目ごとに最高重量、推定1RM、ボリュームの変化をグラフ表示
- グラフ上のポイントから、その日の数値をすぐに確認
- 種目別サマリー、セット履歴、最近のメモを表示
- 不正な行を集計から除外し、元ファイルの行番号と理由を表示
- ライト／ダーク表示、レスポンシブ表示、キーボード操作に対応
- 取り込んだデータはMac内にのみ保存

推定1RMにはEpley式 `重量 × (1 + レップ数 / 30)` を使用します。ダンベル重量は入力値をそのまま扱い、両手分への自動換算は行いません。

## 必要な環境

- macOS
- [Bun](https://bun.sh/) 1.3.14以上
- Git

Node.jsとnpmは使用しません。依存関係のインストールからテスト、ビルドまでBunで実行します。

## クイックスタート

```sh
git clone https://github.com/kissy24/workout-board.git
cd workout-board
bun install --frozen-lockfile
bun run dev
```

ブラウザーで [http://127.0.0.1:4173](http://127.0.0.1:4173) を開きます。

1. 初回画面の「ファイルを取り込む」を選択します。
2. Google Sheetsなどから保存したCSVまたはTSVを選択します。
3. データを更新するときは、画面右上の「データ管理」から新しいファイルを取り込みます。

実データを使わずに画面を確認する場合は、組み込みデータを読み込むデモモードを利用できます。

```sh
WORKOUT_BOARD_DEMO=1 bun run dev
```

デモモードはメモリ上のサンプルだけを使い、保存済みデータを変更しません。

## データの準備

Google Sheetsを利用する場合は、記録のあるワークシートを開き、`ファイル` → `ダウンロード` → `カンマ区切り形式（.csv）`から保存します。Google Cloudの設定やGoogleログインは不要です。

- 対応形式: `.csv`、`.tsv`
- ファイルサイズ上限: 5MB
- 形式サンプル: [examples/workouts.csv](examples/workouts.csv)

### 必須列

先頭行に以下の列が必要です。列順は自由で、追加の列が含まれていても構いません。

| 列名 | 内容 | 例 |
| --- | --- | --- |
| 日付 | `YYYY-MM-DD` または `YYYY/MM/DD` | `2026-07-15` |
| 種目 | 種目名（100文字以内） | `ベンチプレス` |
| セット | 1〜100の整数 | `1` |
| 重さ(kg) | 0〜2,000 | `60` |
| レップ数 | 1〜1,000の整数 | `5` |
| ボリューム(kg) | 任意。空欄なら重さ×レップ数で補完 | `300` |
| メモ | 任意。2,000文字以内 | `最後まで安定` |

```csv
日付,種目,セット,重さ(kg),レップ数,ボリューム(kg),メモ
2026-07-15,ベンチプレス,1,60,5,,最後まで安定
2026-07-15,ベンチプレス,2,57.5,6,,
```

不正な値を含む行は取り込み全体を止めず、その行だけを集計から除外します。除外理由はダッシュボード下部で確認できます。

## データ保存とセキュリティ

Workout Boardは `127.0.0.1` だけで待ち受け、通常モードでは外部サービスへトレーニング記録を送信しません。

取り込んだ内容は次の場所へ保存され、次回起動時に復元されます。

```text
~/Library/Application Support/workout-board/imported-workouts.json
```

- 保存ディレクトリの権限: `0700`
- 保存ファイルの権限: `0600`
- 画面に表示する値はHTMLとして解釈しません
- 「データ管理」→「取り込んだデータを削除」から保存データを削除できます
- 元のCSV／TSVファイルは削除しません

脆弱性の報告方法は [SECURITY.md](SECURITY.md) を参照してください。

## コマンド

| コマンド | 用途 |
| --- | --- |
| `bun run dev` | ホットリロード付きで開発サーバーを起動 |
| `bun run start` | 通常のローカルサーバーを起動 |
| `bun run typecheck` | TypeScriptの型チェック |
| `bun run lint` | Biomeによる静的チェック |
| `bun test` | テストを実行 |
| `bun run build` | Bun向けにサーバーをビルド |
| `bun run check` | 型、Lint、テスト、ビルドをまとめて実行 |
| `bun run security` | 依存関係の脆弱性を検査 |

ポートを変更する場合は、1024〜65535の値を指定します。

```sh
WORKOUT_BOARD_PORT=5173 bun run dev
```

保存先を一時的に変更したい場合は `WORKOUT_BOARD_DATA_DIRECTORY` を指定できます。

## プロジェクト構成

```text
src/
├── client/       # ダッシュボードのHTML、CSS、ブラウザー処理
├── lib/          # CSV解析、集計、保存、Google連携用アダプター
└── server.ts     # BunローカルサーバーとAPI
tests/            # 単体・統合テスト
examples/         # 取り込み用サンプル
```

CIではmacOS上の型チェック、Lint、テスト、ビルドに加えて、OSVによる依存関係検査とGitleaksによる秘密情報検査を実行します。

## ライセンス

[MIT License](LICENSE)
