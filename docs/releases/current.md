# 現行リリース情報

このページは、FlareLobby の現行機能、公開済み版、未公開の `main` の区別を確認する入口です。
`v0.1.0` 時点の範囲と制限は歴史記録として
[v0.1.0 Release Note](./v0.1.0.md) に残し、現行仕様に書き換えません。

- [バージョン方針](../versioning.md)
- [更新手順](../upgrading.md)
- [変更履歴](https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md)

## 基準日と確認方法

基準日: `2026-09-16`。パッケージの公開状態は `package.json` だけから断定せず、
作業時に registry で照合してください。

```sh
npm view @flarelobby/core version
npm view @flarelobby/cloudflare version
npm view @flarelobby/client version
npm view @flarelobby/testing version
```

基準日の確認結果は次のとおりです。

- リポジトリ内の 4 package の版はすべて `0.1.0` です。
- npm registry では 4 package とも `404 Not Found`（未公開）でした。
- git タグと GitHub Release はありません。
- npm 初回公開と registry からの独立導入検証は Issue #100 が所有者です。
  本ページは文書と検証だけを扱い、公開日や発売予定を約束しません。

## 公開版と `main` の区別

| package                  | リポジトリの版 | npm registry（基準日） | 状態                                |
| ------------------------ | -------------- | ---------------------- | ----------------------------------- |
| `@flarelobby/core`       | `0.1.0`        | 未公開（`404`）        | 公開準備中。`main` の追加分は未公開 |
| `@flarelobby/cloudflare` | `0.1.0`        | 未公開（`404`）        | 公開準備中。`main` の追加分は未公開 |
| `@flarelobby/client`     | `0.1.0`        | 未公開（`404`）        | 公開準備中。`main` の追加分は未公開 |
| `@flarelobby/testing`    | `0.1.0`        | 未公開（`404`）        | 公開準備中。`main` の追加分は未公開 |

公開前の検証は、本体リポジトリで `pnpm pack` した tarball を一時コピーへ導入する
経路を使ってください。詳細は [導入とローカルサンプル](../getting-started.md) の
npm 利用者向け手順を参照してください。

## `main` のみの機能（未公開）

次の変更は `main` にあり、npm 公開版には含まれていません。
版の確定と公開は Changesets の解決と所有者の承認後に行います。

| 分類                   | 内容                                                                                                                                                                                                                                                   | 対応する Issue・参照                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| パーティーとチーム編成 | ADR-0005、N 人チケット対応の候補探索、Party / PartyMembership Durable Object、Match Pool のパーティー単位チケット、Gateway の `/v1/parties` と `partyId`、D1 `0004_team_rating.sql` と `registerTeamMatchResult()`、パーティー操作の Client SDK        | #62〜#65                                                            |
| レーティング           | Strategy 化と Glicko-2（`rating.algorithm: "glicko-2"`、既定 `"elo"` で後方互換）、D1 `0005_rating_algorithm.sql`（`algorithm`、`rating_deviation`、`rating_volatility` 列）。既存行は ELO として扱う                                                  | #66                                                                 |
| 配布と設定             | D1 Migration の package 同梱（公開分は `0001`、`0002`、`0004`、`0005`）、CORS 許可 Origin とプリフライト、必須 Binding・Secret 検証の完全化（`FLARE_LOBBY_RATE_LIMITS` を含む）                                                                        | #79、#80、#81                                                       |
| 導入と検証             | 配布物検査の固定版解消と CI 検証項目の統一、Standalone テンプレート、npm 利用者向け導入手順の整合、配布 tarball の独立 E2E                                                                                                                             | #82〜#85                                                            |
| Client 改善            | HTTP・WebSocket・コマンドのタイムアウト（安定エラー `TIMEOUT`）、HTTP エラーの `httpStatus`・`retryAfterSeconds` 保持、`dispose()` 時の待機終了、MatchPool・Party の WebSocket サブプロトコル統一、`after` クエリの `400` 正規化、Party Gateway の修正 | #78、#86、#87 と関連修正                                            |
| 文書の入口             | 英語 README・Quick Start・VitePress 言語切替、Client SDK と Party の英語説明                                                                                                                                                                           | #103                                                                |
| 進行中の利用拡大       | Supabase 認証接続済みスターター、公開じゃんけんデモ（招待リンク）                                                                                                                                                                                      | #101、#102（進行中。`main` の範囲で参照し、公開予定として扱わない） |

`v0.1.0` で対象外だった項目のうち、パーティー、チーム編成、Glicko-2 は現行の
`main` で対応済みです。当時の制限は現行版全体の制限と混同せず、
[v0.1.0 Release Note](./v0.1.0.md) を歴史記録として参照してください。

## 契約版（package 版とは別）

| 契約           | 現行値               | 定義                                                                                     | 扱い                                             |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 通信プロトコル | `protocolVersion: 1` | `packages/core/src/protocol.ts` の `PROTOCOL_VERSION`                                    | 値が変わる変更は破壊的変更として移行手順を付ける |
| 観測スキーマ   | `schemaVersion: 1`   | `packages/cloudflare/src/observability.ts` の `FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION` | 値が変わる変更は破壊的変更として移行手順を付ける |

package の版が上がっても、これらの契約版が変わらない変更は互換の範囲です。
詳しい方針は [バージョン方針](../versioning.md) を参照してください。

## 検証済み環境（基準日）

本体開発では次を固定しています。

- Node.js `24.19.0`（[mise.toml](https://github.com/katsu996/FlareLobby/blob/main/mise.toml)）
- pnpm `11.21.0`
- Wrangler `4.120.0`（ルート開発依存関係）
- TypeScript `7.0.2`

npm 利用者側の必要条件はテンプレートの `engines` に従います。

- Node.js `>=22.12.0`、`pnpm@11.21.0`
- Wrangler `4.120.0`、`vite 8.2.2`（テンプレート開発依存関係）

ブラウザの検証範囲は次のとおりです。

- Playwright Chromium による独立 E2E（作成・参加・マッチング・復帰・cancel/dispose・CORS）を実施しています。
- Firefox と WebKit は実行していないため未検証とします。
- OS・ブラウザ・版の対応保証やサポート期限は約束しません。

新旧の対応関係と更新の順序は [更新手順](../upgrading.md) を参照してください。

## 参照リリース

| リリース                 | 種別          | 文書                                                                                      |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------- |
| `v0.1.0`（`2026-08-12`） | 歴史記録      | [v0.1.0 Release Note](./v0.1.0.md)                                                        |
| `Unreleased`             | 現行の `main` | [変更履歴](https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md) の `Unreleased` |

GitHub Release とタグの作成自体は Issue #100 または別の所有者承認操作です。
本ページと変更履歴は文書と検証を担当し、公開操作の記録ではありません。

## リリースノートの項目（雛形）

各リリースノートは次の項目を揃えます。書けない項目は「未定」ではなく
「該当なし」か「未検証」と明記します。

- 対象 package と版
- 追加・変更・修正
- 破壊的変更
- Migration（D1 と Durable Object を分けて記載）
- 既知の制限
- 検証済み環境
- 更新手順（[更新手順](../upgrading.md) への参照を含む）
