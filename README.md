# FlareLobby

Cloudflare Workers と Durable Objects を利用するゲーム向けロビー機能のための TypeScript モノレポです。

この変更では、今後の機能実装に共通して使う開発基盤、`@flarelobby/core` の公開ドメイン型、Cloudflare 向けの型付き設定、Room Durable Object の永続状態基盤と Gateway Worker の最小構成を用意しています。カスタムルームの作成・参加・退出・観戦の実装方針は [カスタムルームの参加・退出・観戦](./docs/custom-room-participation.md) を、公開ルームの検索と一覧の一貫性は [公開カスタムルーム一覧](./docs/custom-room-list.md) を、ブラウザ向けクライアントの利用方法は [クライアントSDK](./docs/client.md) を参照してください。

公開ドメイン型の用語、状態、型指定方法は [公開ドメイン型](./docs/domain-model.md) を、1 対 1 ELO の契約・計算式・丸め規則は [レーティングエンジン](./docs/rating.md) を、HTTP と WebSocket で共通に使う通信契約は [JSON 通信プロトコル v1](./docs/protocol.md) を、認証・認可・入力検証・利用制限の安全上の前提は [セキュリティ基盤](./docs/security.md) を、構造化ログ・品質メトリクス・秘匿方針は [観測基盤](./docs/observability.md) を、Cloudflare の Binding・環境・設定例は [Cloudflare 設定](./docs/cloudflare-configuration.md) を参照してください。

## パッケージ構成

| パス | パッケージ | 役割 |
| --- | --- | --- |
| `packages/core` | `@flarelobby/core` | プラットフォームに依存しないドメインロジック |
| `packages/cloudflare` | `@flarelobby/cloudflare` | Worker、Durable Objects、D1 との接続層 |
| `packages/client` | `@flarelobby/client` | ブラウザ向け TypeScript クライアント |
| `packages/testing` | `@flarelobby/testing` | 仮想時計、固定乱数、シミュレーターなどのテスト補助 |
| `examples` | — | 最小サンプルを配置する場所 |

すべてのパッケージは ES Modules です。公開 API は後続の設計・実装 Issue で追加します。

## 必要な環境

- Node.js `24.19.0`（[`.node-version`](./.node-version) で固定）
- pnpm `11.21.0`（`packageManager` フィールドで固定）

Node.js に同梱された Corepack を有効にしてください。

```sh
corepack enable
pnpm install --frozen-lockfile
```

`engine-strict=true` を設定しているため、異なる Node.js または pnpm のバージョンではインストールを停止します。

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | すべてのパッケージを strict 設定で型検査する |
| `pnpm test:unit` | core、client、testing の単体テストを実行する |
| `pnpm test:integration` | Workers 実行環境で Cloudflare パッケージの統合テストを実行する |
| `pnpm test` | 単体テストと統合テストを順番に実行する |
| `pnpm build` | すべてのパッケージを `dist/` へビルドする |
| `pnpm check:esm` | Node.js で読み込める ESM 成果物を確認する（Worker エントリーポイントは統合テストで確認） |
| `pnpm dev:worker` | Cloudflare Worker をローカルで起動する |

## Cloudflare Workers

Worker の設定は [`packages/cloudflare/wrangler.jsonc`](./packages/cloudflare/wrangler.jsonc) にあります。互換日付は設定ファイルで明示し、Cloudflare 実行対象のソースコードでは Node.js 専用 API を利用しません。

設定またはバインディングを変更したら、次を実行して生成済みの環境型を更新してください。

```sh
pnpm generate:worker-types
```

生成先は `packages/cloudflare/worker-configuration.d.ts` です。このファイルはコミット対象です。CI などで差分のみを検査する場合は、次を使います。

```sh
pnpm check:worker-types
```

## Changesets

パッケージの変更履歴と将来のリリース準備には Changesets を使用します。

```sh
pnpm changeset
pnpm version-packages
```

このリポジトリ基盤は公開・デプロイを実行しません。
