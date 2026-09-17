# 変更履歴

FlareLobby の利用者に影響する変更を日本語で記録します。

## Unreleased（`main` の未公開分）

現行の公開状態と `main` の区別は
[現行リリース情報](./docs/releases/current.md) を参照してください。
npm registry では 4 package とも未公開のため（`2026-09-16` 時点で `404` を確認）、
次の版の確定と公開は Changesets の解決と所有者の承認後に行います。
GitHub Release とタグの作成は Issue #100 または別の所有者承認操作です。

### 追加

- パーティーとチーム編成（#62〜#65）：ADR-0005、N 人チケット対応の候補探索、Party / PartyMembership Durable Object、Match Pool のパーティー単位チケット、Gateway の `/v1/parties` とチケット作成時の `partyId`、D1 `0004_team_rating.sql` と `registerTeamMatchResult()`、パーティー操作の Client SDK（`createParty()` / `getParty()` / `joinParty()`、`invite()` / `leave()` / `transferLeadership()` / `dissolve()`、パーティー単位のランクキュー参加とキャンセル）
- レーティングの Strategy 化と Glicko-2（#66）：`glicko2()` エンジン、Pool 設定の `rating.algorithm: "glicko-2"`（省略時は `"elo"` で後方互換）、D1 `0005_rating_algorithm.sql`（`algorithm`、`rating_deviation`、`rating_volatility` 列）。既存行は ELO として扱う
- Gateway の許可 Origin 設定と CORS プリフライト処理（#80）
- D1 Migration の公開 package 同梱（#79）：公開分は `0001`、`0002`、`0004`、`0005`。デモ専用 `0003_local_demo_rps.sql` は同梱しない
- Client SDK のタイムアウト（#86）：`requestTimeoutMs`・`connectionTimeoutMs`・`commandTimeoutMs` と操作単位の `timeoutMs`、期限切れの安定エラー `TIMEOUT`（自動再送なし）
- SDK の HTTP エラーへの `httpStatus`・`retryAfterSeconds` 保持（#87）
- 英語 README・Quick Start と VitePress 言語切替（#103）

### 変更

- 必須 Binding と Secret の設定検証を完全にした（#81）：`FLARE_LOBBY_RATE_LIMITS` を必須に追加し、不足時は `GET /` を含む全要求を処理開始前に `500` で拒否する。`ready` は必須設定検証の結果であり、DB 疎通・Migration 適用済み・外部認証サービスの正常性の保証ではない
- 配布物検査の固定版を解消し CI 検証項目を統一した（#82）
- Standalone テンプレートと npm 利用者向け導入手順を整合させた（#83、#84）
- `client.dispose()` と `destroy()` がマッチメイキングの Ticket・待機 Promise・再接続処理をローカルで確実に終了するようにした（#78）。サーバー側の Ticket は自動でキャンセルしない
- MatchPool と Party のチケット・パーティーイベント WebSocket の `101` 応答に `Sec-WebSocket-Protocol: flarelobby.v1` を付与し、Room と同じサブプロトコル交渉にした
- マッチングチケットイベント端点の `after` クエリ不正値を `INVALID_PAYLOAD` の `400` 応答へ正規化した
- Party Gateway の不具合を修正した（空文字 DO 名での作成、`events/ws` のトークン転送、`leaveParty()` 再送時の冪等応答）
- `RatingCalculation.deltaB` の契約を「B 側の整数差分」とし、`deltaA + deltaB = 0` は ELO 固有の性質として文書化した（Glicko-2 では各側の不確実性に応じて独立に決まる）

### Migration

- D1：新規環境は公開 package の `0001`、`0002`、`0004`、`0005` を適用する。既存環境は [Cloudflare 設定](./docs/cloudflare-configuration.md) の履歴補正手順で差を確認してから適用する。デモ専用 `0003` を本体データベースに適用しない
- Durable Object：`v1`〜`v3` の既存タグを変更・再利用せず、新しい移行は新しいタグを追加する。更新の順序とロールバックは [更新手順](./docs/upgrading.md) を参照する

### 検証済み環境

- 本体開発：Node.js `24.19.0`、pnpm `11.21.0`、Wrangler `4.120.0`
- npm 利用者側：Node.js `>=22.12.0`、`pnpm@11.21.0`（テンプレート `engines`）
- ブラウザ：Playwright Chromium の独立 E2E で確認。Firefox と WebKit は未検証とする
- `protocolVersion: 1`、観測 `schemaVersion: 1` は package 版とは別の契約として維持する。詳しい方針は [バージョン方針](./docs/versioning.md) を参照する

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
