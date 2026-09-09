# 導入とローカルサンプル

このページは、npm 利用者向けの導入手順を正本とします。本体リポジトリを
clone せずに導入できます。公式の導入例は
[Standalone テンプレート](../templates/standalone/README.md) です。
リポジトリ開発者向けの手順は後半の「リポジトリ開発者向け」に分けています。

現行機能（パーティー、チーム単位のマッチング、ELO/Glicko-2）の詳細は
[API リファレンス](./api-reference.md)、
[マッチメイキング利用ガイド](./matchmaking-guide.md)、
[レーティング](./rating.md)、
[クライアント SDK](./client.md) を参照してください。
v0.1.0 時点の範囲と制限は歴史記録として
[v0.1.0 Release Note](./releases/v0.1.0.md) に残し、現行仕様に書き換えません。

## npm 利用者向け導入

依存導入から dry-run までの順序は次のとおりです。

1. 依存導入
2. 独自 Worker と 5 種類の Durable Object export
3. 5 種類の Binding と DO Migration（`v1`〜`v3`）
4. D1 Migration
5. Secret
6. 認証・認可
7. 型生成
8. ローカル起動
9. dry-run

テンプレートの手順を上から実行し、記載したコマンドが成功することを確認します。

### 1. 依存導入

利用者側の必要条件はテンプレートの `engines` に従います。
Node.js `>=22.12.0` と `pnpm@11.21.0` を用意してください。
本体開発環境（Node.js `24.19.0`、pnpm `11.21.0`、mise）は別の条件であり、
未検証のランタイム互換性は断言しません。

パッケージの公開状態は作業時に registry で確認してください。2026-09-08 時点では
`@flarelobby/*` は npm registry で未公開（`404 Not Found`）のため、`pnpm add`
で取得できると断言しません。

公開後は次の指定で導入します。

```sh
pnpm add @flarelobby/cloudflare @flarelobby/core @flarelobby/client
pnpm add -D wrangler vite typescript @types/node
```

公開前の検証は、本体リポジトリで生成した tarball を一時コピーへ導入する経路を
使います。配布テンプレートへローカル絶対パスや `workspace:` を残しません。

```sh
pnpm --filter @flarelobby/core pack
pnpm --filter @flarelobby/cloudflare pack
pnpm --filter @flarelobby/client pack
mkdir /tmp/flarelobby-template-check
cp -r templates/standalone/. /tmp/flarelobby-template-check/
```

一時コピー側で生成 tarball を `file:` 指定に置き換えて `pnpm install` します。
`@flarelobby/cloudflare` と `@flarelobby/client` が依存する `@flarelobby/core`
は推移的に registry 解決されるため、一時コピー側の `pnpm-workspace.yaml` の
`overrides` でも生成 tarball を指定します。
元のテンプレートは公開パッケージ名とバージョン指定のままにします。

テンプレートの初期化は次のとおりです。

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

`.dev.vars` の `FLARE_LOBBY_TOKEN_SECRET` を推測困難な値に置き換えてください。
`wrangler.jsonc` の `database_id` は未設定のままにし、実在の共有環境 ID を
埋め込まないでください。

### 2. 独自 Worker と 5 種類の Durable Object export

独自 Worker は `defineFlareLobby()` と `createGatewayWorker()` で作ります。
型検査対象の定義例は
[`docs/examples/npm-standalone-worker.ts`](./examples/npm-standalone-worker.ts)、
公式の導入例はテンプレートの `src/index.ts` です。

5 種類の Durable Objects を公開パッケージから export します。

```ts
export {
  MatchPoolDurableObject,
  PartyDurableObject,
  PartyMembershipDurableObject,
  RateLimitDurableObject,
  RoomDurableObject,
} from "@flarelobby/cloudflare";
```

### 3. 5 種類の Binding と DO Migration（`v1`〜`v3`）

全必須 Binding は次の 7 件です。任意は `FLARE_LOBBY_ANALYTICS` のみです。
詳細は [Cloudflare 設定](./cloudflare-configuration.md) を参照してください。

| Binding                         | 種別                     | 必須 |
| ------------------------------- | ------------------------ | ---- |
| `FLARE_LOBBY_ROOMS`             | Durable Object Namespace | 必須 |
| `FLARE_LOBBY_MATCH_POOLS`       | Durable Object Namespace | 必須 |
| `FLARE_LOBBY_PARTIES`           | Durable Object Namespace | 必須 |
| `FLARE_LOBBY_PARTY_MEMBERSHIPS` | Durable Object Namespace | 必須 |
| `FLARE_LOBBY_RATE_LIMITS`       | Durable Object Namespace | 必須 |
| `FLARE_LOBBY_DB`                | D1 Database              | 必須 |
| `FLARE_LOBBY_TOKEN_SECRET`      | Secret（文字列）         | 必須 |

DO Migration は `v1`〜`v3` の 3 タグです。

- `v1`: `RoomDurableObject`、`MatchPoolDurableObject`
- `v2`: `RateLimitDurableObject`
- `v3`: `PartyDurableObject`、`PartyMembershipDurableObject`

Migration のタグを変更せず、既存環境へ新しいタグを追加してください。
テンプレートの `wrangler.jsonc` がこの構成の正例です。

### 4. D1 Migration

利用者側の `wrangler.jsonc` では Migration をコピーせず、インストール済み
package のディレクトリを直接指定します。

```jsonc
{
  "d1_databases": [
    {
      "binding": "FLARE_LOBBY_DB",
      "database_name": "my-flarelobby",
      "migrations_dir": "node_modules/@flarelobby/cloudflare/migrations",
    },
  ],
}
```

適用されるのは公開 package の `0001`、`0002`、`0004`、`0005` の 4 本です。
デモ専用テーブル（`0003_local_demo_rps.sql`）は同梱・要求しません。

```sh
pnpm db:apply:local
```

### 5. Secret

トークン署名用の `FLARE_LOBBY_TOKEN_SECRET` は必須です。ローカル開発では
`.dev.vars`（gitignore 済み）に記載し、値は推測困難な十分に長いランダム文字列を
環境ごとに発行してください。ローテーションすると既存の再開トークンが無効に
なります。

### 6. 認証・認可

認証サービスは固定しません。利用者が検証済み Principal を返す `authenticate`
と明示的な `authorization` Hook を接続する責任を持ちます。

- `authenticate` が `null` を返す要求は未認証として扱います。
- `authorization` を省略した場合や `false`・例外を返す場合は保護対象の操作を
  既定で拒否します。
- テンプレートの配布 Worker は未接続のため常に `null` を返し、保護 API を拒否
  します。接続前でも build・型検査・起動は可能ですが、保護 API は拒否されます。
- 利用者が検証済み Principal を返す認証を接続する箇所はテンプレートの
  `src/index.ts` の `verifyApplicationToken()` です。任意 Bearer 文字列を
  本人確認に使う実装を標準 Worker へ含めないでください。
- ブラウザ側でログイン済みトークンの取得関数を差し込む箇所はテンプレートの
  `src/browser.ts` の `getAccessToken()` です。
- テスト用認証は E2E harness の差し替え entry でのみ注入してください。
  テンプレートの配布 Worker に認証バイパスフラグを実装しないでください。
- ローカルデモの `x-demo-player` 認証はローカル確認専用であり、本番例にしません。

型検査対象の接続例は
[`docs/examples/cloudflare-config.ts`](./examples/cloudflare-config.ts) と
[`docs/examples/npm-standalone-worker.ts`](./examples/npm-standalone-worker.ts) を
参照してください。

### 7. 型生成

```sh
pnpm generate:types
pnpm typecheck
```

`wrangler types` が `worker-configuration.d.ts` を生成します。Worker の型は
公開パッケージの型で確認し、`skipLibCheck` に依存しません。

### 8. ローカル起動

Worker とブラウザは別オリジンで起動します。別オリジンのブラウザから利用する
場合は `cors.allowedOrigins` にブラウザの Origin を指定します。指定なしは同一
オリジン向け挙動を維持します。テンプレートは localhost のブラウザ開発 Origin
（`http://localhost:5173`）だけを許可し、本番では同配列を本番 Origin に
置き換えます。CORS はサーバー側認可の代替ではありません。

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

標準 Gateway のヘルスチェックは `GET /`（`{ "status": "ready" }`）です。
`GET /health` はローカルデモ独自のエンドポイントであり、標準 Gateway には
追加しません。今回新たな health API は作りません。`ready` は必須設定検証の
結果であり、DB 疎通・Migration 適用済み・外部認証サービスの正常性の保証では
ありません。

停止は Worker とブラウザの各ターミナルで `Ctrl+C` を押します。ルーム退出は
ブラウザの「退出」ボタンを使います。

### 9. dry-run

```sh
pnpm build
pnpm deploy:dry-run
```

`dist/` への browser build と `wrangler deploy --dry-run` を確認します。
アップロードは行いません。実デプロイ、本番リソース自動作成はテンプレートの
対象外です。

## リポジトリ開発者向け

この節は本体リポジトリを取得した開発者向けです。npm 利用者は上記手順と
テンプレートを使ってください。

### 1. 依存関係を揃える

Node.js `24.19.0` と pnpm `11.21.0` を用意します。mise を使う場合は、リポジトリ
ルートで次を実行してください。

```sh
mise install
corepack enable
pnpm install --frozen-lockfile
```

依存関係を更新するときも、CI と同じく `pnpm install --frozen-lockfile` が成功する
状態を保ちます。

### 2. ビルドと文書例の型検査

```sh
pnpm build
pnpm check:docs
```

`check:docs` は `docs/examples/` とローカルサンプルを TypeScript で検査します。
そのため、README やガイドのコード例を API の型から切り離して管理しません。

### 3. ブラウザサンプルを起動する

```sh
cp examples/local-demo/.dev.vars.example examples/local-demo/.dev.vars
pnpm --filter @flarelobby/example-local-demo typecheck
pnpm --filter @flarelobby/example-local-demo exec wrangler d1 migrations apply FLARE_LOBBY_DB --local --config wrangler.jsonc
pnpm --filter @flarelobby/example-local-demo dev
```

既定の URL は `http://localhost:8787` です。トップページに最小じゃんけんゲームが表示され、
招待ルームとランク戦の導線をブラウザから確認できます。サンプルはローカル専用の認証として、
次のどちらかを受け付けます。

- `x-demo-player: alice`
- `Authorization: Bearer alice`

サンプルの `authenticate` Hook は入力値をそのまま本番の認証に使うためのものでは
ありません。Cloudflare へデプロイする設定へ持ち込まず、利用者の認証サービスで
検証した主体 ID を返す Hook へ置き換えてください。

### 4. ヘルスチェックとカスタムルーム

標準 Gateway のヘルスチェックは `GET /` です。`GET /health` はローカルデモ独自の
エンドポイントであり、標準 Gateway には追加しません。

別のターミナルで実行します。

```sh
export FLARE_LOBBY_URL=http://localhost:8787

curl "$FLARE_LOBBY_URL/"
curl "$FLARE_LOBBY_URL/health"
curl -X POST "$FLARE_LOBBY_URL/v1/custom-rooms" \
  -H 'content-type: application/json' \
  -H 'x-demo-player: alice' \
  -d '{"requestId":"create-alice","name":"練習ルーム","visibility":"public","joinMethod":"public","maxPlayers":2,"settings":{"map":"forest"}}'
```

作成レスポンスの `roomId`、`joinToken`、`websocketUrl` はそれぞれルーム識別子、
作成者の参加用トークン、WebSocket 接続先です。別の主体をプレイヤーとして参加
させるには、作成レスポンスの `roomId` を使います。

```sh
curl -X POST "$FLARE_LOBBY_URL/v1/custom-rooms/join" \
  -H 'content-type: application/json' \
  -H 'x-demo-player: bob' \
  -d '{"requestId":"join-bob","roomId":"<作成レスポンスのroomId>","role":"player"}'
```

公開一覧は認証なしで読めます。パスワードや招待コード、参加用トークンは一覧へ
含まれません。

```sh
curl "$FLARE_LOBBY_URL/v1/custom-rooms?available=true&limit=20"
```

Client SDK のブラウザ利用は [カスタムルーム利用ガイド](./custom-room-guide.md)、
WebSocket の再接続と `revision` の扱いは [クライアントSDK](./client.md) を参照
してください。パーティーとチーム単位のマッチングは
[マッチメイキング利用ガイド](./matchmaking-guide.md)、ELO/Glicko-2 の使い分けは
[レーティング](./rating.md)、画面の導線、ランク戦の結果確定、デプロイ時の注意は
[ローカルじゃんけんサンプル](./local-demo.md) にまとめています。

### 5. ローカル Migration

サンプルの `wrangler.jsonc` は `packages/cloudflare/migrations/` を参照します。
Migration を明示的に適用する場合は次を使います。`wrangler dev` の起動時に未適用の
ローカル Migration が適用される環境でも、CI や初期化スクリプトでは明示実行を推奨
します。

```sh
pnpm --filter @flarelobby/example-local-demo exec wrangler d1 migrations apply FLARE_LOBBY_DB --local --config wrangler.jsonc
```

Durable Objects の SQLite Migration は、同じ `wrangler.jsonc` の `migrations` に
クラス名を登録します（現行は 5 種類、`v1`〜`v3`）。Migration のタグを変更せず、
既存環境へ新しいタグを追加してください。

### 6. ローカル検証

```sh
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm check:esm
pnpm check:docs
```

Workers 統合テストは実際の Workers Runtime、Durable Objects、D1 を使います。テスト
対象と完了条件の対応は [テストと検証](./testing.md) にあります。

初回公開とデプロイ前には、クリーンな checkout で全検証、npm package dry-run、
サンプル Worker のデプロイ Bundle 生成をまとめて実行します。

```sh
pnpm install --frozen-lockfile
pnpm release:check
```

このコマンドの `wrangler deploy --dry-run` は設定、Binding、Assets、Worker bundle を
検証して upload 前に終了します。実 Cloudflare 環境の D1 作成、Migration、Secret、
upload は次の staging/production 手順で所有者の承認後に行います。

## staging/production への準備

共有環境へ接続する場合は、次の順序で環境ごとに準備します。

1. D1 データベースを作成し、`packages/cloudflare/wrangler.jsonc` の staging または production の `database_id` を実リソースの UUID へ設定する。
2. `wrangler d1 migrations apply FLARE_LOBBY_DB --remote --env staging`（または `production`）で D1 Migration を適用する。
3. `wrangler secret put FLARE_LOBBY_TOKEN_SECRET --env staging`（または `production`）で環境固有の秘密値を登録する。
4. `pnpm generate:worker-types` を実行し、生成された `Env` と Binding の差分を確認する。
5. `wrangler deploy --env staging`（または `production`）で Worker と Durable Object Migration を公開する。
6. 公開 URL の `GET /` が `{ "status": "ready" }` を返すこと、認証 Hook が実際の主体を返すことを確認する。`ready` は必須設定検証の結果であり、DB 疎通・Migration 適用済み・外部認証サービスの正常性の保証ではない。

```sh
pnpm --filter @flarelobby/cloudflare exec wrangler d1 migrations apply FLARE_LOBBY_DB --remote --env staging
pnpm --filter @flarelobby/cloudflare exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET --env staging
pnpm generate:worker-types
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env staging
```

本番ではローカルサンプルの `x-demo-player` 認証を使いません。認証、認可、入力
制限、Secret のローテーション、観測先の設定は [Cloudflare 設定](./cloudflare-configuration.md)、
[セキュリティ](./security.md)、[観測基盤](./observability.md)を確認してください。

## つまずきやすい点

- `FLARE_LOBBY_TOKEN_SECRET` がない場合、Gateway は保護対象 API を正常に処理できません。
- D1 の `database_id` がない設定はローカル確認用です。remote 適用や本番デプロイの前に実 UUID を設定します。
- 公開一覧は D1 の投影なので一時的に古くなります。満員判定と参加可否は必ず Room Durable Object が決定します。
- WebSocket の参加・再接続トークンを URL、ログ、クライアント側の永続ストレージへ不用意に記録しません。
- 標準 Gateway の `GET /` とローカルデモの `GET /health` を混同しません。新たな health API は追加しません。
