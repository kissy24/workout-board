# セキュリティ

脆弱性や認証情報の漏えいを発見した場合は、公開Issueへ秘密情報を記載せず、GitHubのPrivate vulnerability reportingから報告してください。

## ローカルデータ

- ローカルHTTPサーバーは起動せず、権限を限定したTauri IPCだけを使用します。
- 取り込んだCSV／TSVの内容は`~/Library/Application Support/workout-board/imported-workouts.json`へ権限`0600`で保存します。
- 通常モードではGoogleを含む外部サービスへ接続せず、取り込んだ内容を外部へ送信しません。
- 取り込みファイルは5MB以下のCSV／TSVに限定し、ダッシュボードへ表示する際はHTMLとして解釈しません。

トレーニング記録をリポジトリへ追加しないでください。誤ってコミットした場合は、公開範囲を確認したうえでGit履歴からも削除してください。
