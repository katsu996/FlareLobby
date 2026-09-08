# FlareLobby Standalone テンプレート

本体ソースを clone せず、別リポジトリへコピーして導入できる最小テンプレートです。
`examples/local-demo` の workspace 依存を使わず、公開パッケージ名とバージョンだけで解決します。
パッケージマネージャーは pnpm を標準とします。

## 前提

- Node.js >= 22、pnpm >= 11
- 公開パッケージ `@flarelobby/cloudflare`、`@flarelobby/client`、`@flarelobby/core`（`0.1.0`）
- ブラウザは最小の TypeScript + HTML です。Vite を開発/build 用途に使用し、UI フレームワークは追加していません。
- Worker（`http://localhost:8787`）とブラウザ（`http://localhost:5173`）は別オリジンで起動します。

## 初期化

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

`.dev.vars` の `FLARE_LOBBY_TOKEN_SECRET` を推測困難な値に置き換えてください。秘密を含まない設定例は `.dev.vars.example` を参照してください。
`wrangler.jsonc` の `database_id` は未設定です。実在の共有環境 ID を埋め込まないでください。

## 型生成

```sh
pnpm generate:types
pnpm typecheck
```

`wrangler types` が `worker-configuration.d.ts` を生成します。Worker の型は公開パッケージの型で確認し、`skipLibCheck` に依存しません。

## 起動

```sh
pnpm db:apply:local
pnpm dev:worker
```

別ターミナルでブラウザ開発サーバーを起動します。

```sh
pnpm dev:browser
```

- Worker: `http://localhost:8787`
- ブラウザ: `http://localhost:5173`

接続前でも build・型検査・起動は可能ですが、保護 API は拒否されます。

## 停止

Worker とブラウザの各ターミナルで `Ctrl+C` を押してください。ルーム退出はブラウザの「退出」ボタンを使います。

## browser build

```sh
pnpm build
```

`dist/` に出力されます。

## deploy dry-run

```sh
pnpm deploy:dry-run
```

アップロードは行いません。実デプロイ、本番リソース自動作成はこのテンプレートの対象外です。

## D1 Migration

同梱 Migration は公開パッケージの `node_modules/@flarelobby/cloudflare/migrations` を参照します。

```sh
pnpm db:apply:local
```

適用されるのは `0001`、`0002`、`0004`、`0005` の4本です。デモ専用テーブル（`0003_local_demo_rps.sql`）は同梱・要求しません。

## 認証の接続箇所

初期の `authenticate` は未接続のため `null` を返し、`authorization` を省略して保護 API を拒否します。
利用者が検証済み Principal を返す認証を接続する箇所は `src/index.ts` の `verifyApplicationToken()` です。
実際の認証サービスによる検証へ置き換え、検証済みの主体だけ `{ id, playerId }` として返してください。
任意 Bearer 文字列を本人確認に使う実装を標準 Worker へ含めないでください。

ブラウザ側でログイン済みトークンの取得関数を差し込む箇所は `src/browser.ts` の `getAccessToken()` です。

テスト用認証は E2E harness の差し替え entry でのみ注入してください。テンプレートの配布 Worker に認証バイパスフラグを実装しないでください。

## CORS

`src/index.ts` の `cors.allowedOrigins` は localhost のブラウザ開発 Origin（`http://localhost:5173`）だけを許可します。
本番の許可 Origin へ変更する箇所は同配列です。本番 Origin に置き換えてください。

## 例で示す操作

- カスタムルーム作成・参加・終了（退出は参加者、終了はホスト）
- 1v1 キュー参加・取消・対戦成立（`solo-1v1` プール）

じゃんけんゲーム本体やデモ専用 DB は含みません。
