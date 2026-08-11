# 変更履歴

FlareLobby の利用者に影響する変更を日本語で記録します。

## 0.1.0 - 2026-08-12

### 追加

- 公開・一覧非表示・招待コード・パスワード方式のカスタムルームを追加
- 参加、観戦、準備、チーム選択、ホスト移譲、強制退出、開始、退出を追加
- SQLite-backed Durable Objects による状態保存、冪等なコマンド、単一 Alarm を追加
- Hibernation 対応 WebSocket、自動再接続、再開トークン、Snapshot 復元を追加
- D1 投影による公開ルーム一覧と検索を追加
- 1 対 1 ランクマッチング、待機時間に応じた検索幅拡大、取消、期限切れを追加
- D1 による ELO、試合履歴、試合結果の冪等登録を追加
- ブラウザ向け `@flarelobby/client` と決定論的な `@flarelobby/testing` を追加
- 招待ルームとランク戦を確認できる最小じゃんけんゲームを追加
- 日本語の利用ガイド、API リファレンス、設計文書、ADR を追加

### 品質と公開準備

- 純粋ロジックの単体テストと Workers・Durable Objects・D1 の横断統合テストを追加
- 公開 Export、API 文書、ES Modules、Workers 型、npm package 内容の自動検証を追加
- npm publish dry-run と Cloudflare deploy dry-run を再実行可能な公開前チェックへ追加
- 公開 package の metadata、README、MIT ライセンス、Release Note を整備

既知の制限と対象外は [v0.1.0 Release Note](./docs/releases/v0.1.0.md) を参照してください。
