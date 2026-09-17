# バージョン方針

このページは、FlareLobby の package 版、通信プロトコル版、観測スキーマ版の
付け方と、更新時に利用者が期待できる互換範囲を定めます。
現行の公開状態は [現行リリース情報](./releases/current.md)、
更新の手順は [更新手順](./upgrading.md) を参照してください。

## 対象

公開 package は次の 4 つです。

- `@flarelobby/core`
- `@flarelobby/cloudflare`
- `@flarelobby/client`
- `@flarelobby/testing`

版の管理には Changesets を使います（[`.changeset/config.json`](https://github.com/katsu996/FlareLobby/blob/main/.changeset/config.json)）。
`fixed` と `linked` は空であり、4 package は独立 version を維持します。
一律に同じ版を強制しません。利用者は更新先の package ごとに版を指定します。

## `1.0` 未満の方針

`1.0` 未満でも、同じ `minor` 内の `patch` 更新では互換を維持します。
次の変更は破壊的変更とし、次 `minor` への版上げと移行手順を必要とします。

- 公開 API の引数・戻り値・イベントの削除や意味の変更
- HTTP API・WebSocket 通信の互換を壊す変更
- D1 スキーマや Durable Object Migration の適用を必須化する変更
- `protocolVersion` や観測 `schemaVersion` の値を変える変更

`patch` 更新では、バグ修正と互換を保つ範囲の改善だけを行います。
`minor` 更新では、機能追加と上記の破壊的変更を扱えます。
更新時は [変更履歴](https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md) の
`Unreleased` と対象 package の Changeset を確認してください。

## `1.0` 以降の方針（将来）

将来 `1.0` 以降は Semantic Versioning に従います。
破壊的変更は `major` の版上げと移行手順を必要とします。
`1.0` の宣言自体は本ページの対象外であり、時期や内容を約束しません。

## Changeset の付け方の目安

| 種別    | 付ける場合の例                                                               |
| ------- | ---------------------------------------------------------------------------- |
| `patch` | 誤字修正に留まらないバグ修正、エラーメッセージの改善、互換を保つ検証の厳密化 |
| `minor` | 新しい公開 API・設定項目の追加、破壊的変更を伴う `0.x` の更新                |

`v0.1.0` の初回公開整備のように、既に明示した版へ追加の bump を行わない場合は
empty Changeset で記録します。版の確定と公開は所有者の承認後に行います。

## package 版とは別の契約

次の版は package 版とは別の契約です。package の版が上がっても、
これらの値が変わらない変更は互換の範囲です。

| 契約           | 現行値               | 定義                                                                                     |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| 通信プロトコル | `protocolVersion: 1` | `packages/core/src/protocol.ts` の `PROTOCOL_VERSION`                                    |
| 観測スキーマ   | `schemaVersion: 1`   | `packages/cloudflare/src/observability.ts` の `FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION` |

これらの値を変える変更は破壊的変更として扱い、
対象 package の `minor`（`1.0` 以降は `major`）上げと移行手順を付けます。
WebSocket のサブプロトコル（`flarelobby.v1`）を変える場合も同様です。

## 互換性の表の読み方

互換性は「開発ツール」「利用者の build 環境」「実行環境」に分けて確認します。
未検証のランタイムは対応済みと表示しません。

- 開発ツール：本体リポジトリを開発する環境（Node.js `24.19.0`、pnpm `11.21.0`、Wrangler `4.120.0`）
- 利用者の build 環境：テンプレートの `engines`（Node.js `>=22.12.0`、`pnpm@11.21.0`）と開発依存関係
- 実行環境：Cloudflare Workers・Durable Objects・D1 と `compatibility_date`、ブラウザの検証範囲

検証済みの組み合わせの snapshot は
[現行リリース情報](./releases/current.md) に置きます。
新たに全環境 CI matrix を追加することは本ページの前提にしません。
