# 導入とローカルサンプル

このページは、リポジトリを取得した開発者がローカルの Worker を起動し、カスタム
ルームの作成・参加と 1 対 1 マッチングを確認するための手順です。Cloudflare の
共有リソースへ接続する手順は後半の「staging/production」へ分けています。

## 1. 依存関係を揃える

Node.js `24.19.0` と pnpm `11.21.0` を用意します。mise を使う場合は、リポジトリ
ルートで次を実行してください。

```sh
mise install
corepack enable
pnpm install --frozen-lockfile
```

依存関係を更新するときも、CI と同じく `pnpm install --frozen-lockfile` が成功する
状態を保ちます。

## 2. ビルドと文書例の型検査

```sh
pnpm build
pnpm check:docs
```

`check:docs` は `docs/examples/` とローカルサンプルを TypeScript で検査します。
そのため、README やガイドのコード例を API の型から切り離して管理しません。

## 3. ブラウザサンプルを起動する

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

## 4. ヘルスチェックとカスタムルーム

別のターミナルで実行します。

```sh
export FLARE_LOBBY_URL=http://localhost:8787

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
してください。画面の導線、ランク戦の結果確定、デプロイ時の注意は
[ローカルじゃんけんサンプル](./local-demo.md) にまとめています。

## 5. ローカル Migration

サンプルの `wrangler.jsonc` は `packages/cloudflare/migrations/` を参照します。
Migration を明示的に適用する場合は次を使います。`wrangler dev` の起動時に未適用の
ローカル Migration が適用される環境でも、CI や初期化スクリプトでは明示実行を推奨
します。

```sh
pnpm --filter @flarelobby/example-local-demo exec wrangler d1 migrations apply FLARE_LOBBY_DB --local --config wrangler.jsonc
```

Durable Objects の SQLite Migration は、同じ `wrangler.jsonc` の `migrations` に
クラス名を登録します。Migration のタグを変更せず、既存環境へ新しいタグを追加して
ください。

## 6. ローカル検証

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
6. 公開 URL の `GET /health` が `{ "status": "ready" }` を返すこと、認証 Hook が実際の主体を返すことを確認する。

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
