# FlareLobby Supabase スターターテンプレート

Supabase Auth のメール・パスワード認証と FlareLobby のカスタムルーム、準備同期、1v1 マッチングを接続した配布用テンプレートです。本体リポジトリを clone せず、別リポジトリへコピーして使えます。

Supabase の service-role key、JWT secret、秘密 API key は使いません。ブラウザには publishable key だけを置き、Worker は Supabase の固定 JWKS URL で access token を検証します。

## 前提

- Node.js >= 22.12.0、pnpm 11
- Supabase プロジェクトと、Supabase 側で作成したテスト用ユーザー 2 件
- 公開パッケージ `@flarelobby/cloudflare`、`@flarelobby/client`、`@flarelobby/core`（`0.1.0`）
- Worker（`http://localhost:8787`）とブラウザ（`http://localhost:5173`）を別オリジンで起動

## 初期化と設定

```sh
pnpm install
cp .dev.vars.example .dev.vars
cp .env.example .env
```

`.dev.vars` に Supabase プロジェクトの URL と、ローカル用の十分に長い `FLARE_LOBBY_TOKEN_SECRET` を設定します。

```dotenv
SUPABASE_URL=https://your-project.supabase.co
FLARE_LOBBY_TOKEN_SECRET=replace-with-a-random-local-secret
```

`.env` には Supabase のブラウザ用 URL、publishable key、Worker URL を設定します。

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_FLARE_LOBBY_ENDPOINT=http://localhost:8787
```

ローカルでは `.dev.vars` が `wrangler.jsonc` のダミー `SUPABASE_URL` を上書きします。本番または staging では、デプロイ対象の Wrangler environment の `vars.SUPABASE_URL` を実際のプロジェクト URL に置き換えてください。

`service_role` key、legacy `anon` key、Supabase JWT secret、`FLARE_LOBBY_TOKEN_SECRET` はブラウザ変数へ設定せず、コミットやログへ出さないでください。

## Supabase 側の準備

Supabase Dashboard の Authentication でメール・パスワードを有効にし、テスト用ユーザーを 2 件作成します。一般公開のユーザー登録画面はこの例に含めません。確認用アカウントのパスワードはこのリポジトリやログへ保存しないでください。

Worker は次の固定 URL だけを JWKS として使います。

```text
https://<project>.supabase.co/auth/v1/.well-known/jwks.json
```

受信 JWT の署名（ES256 または RS256）、issuer、audience `authenticated`、`role`、必須 `exp` / `sub`、`nbf` を検証します。HS256、未署名 JWT、別プロジェクト、鍵取得失敗、改ざん、期限切れは拒否します。JWT の `jku` などから鍵取得先を決めません。JWKS resolver は同じ Worker isolate 内で再利用しますが、ユーザーの token や session は保存しません。

認証の実装は `src/auth.ts`、Worker の環境値との接続は `src/index.ts` にあります。認証済み主体は `{ id: sub, playerId: sub }` へ固定します。

## 型検査・テスト・build

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm deploy:dry-run
```

`pnpm test` は実際の `src/auth.ts` を呼び、署名改ざん、期限切れ、issuer / audience 不一致、`exp` / `sub` 欠落、role / alg 不正、JWKS 障害、攻撃者指定の鍵 URL を拒否することを確認します。

## ローカル起動

```sh
pnpm db:apply:local
pnpm dev:worker
```

別ターミナルでブラウザを起動します。

```sh
pnpm dev:browser
```

ブラウザで次を確認できます。

1. 1 件目のアカウントでログインし、招待ルームを作成する。
2. 表示された招待コードを 2 件目のアカウントで入力して参加する。
3. 両方の画面で準備状態が同期することを確認する。
4. 2 件のブラウザで 1v1 キューへ参加し、対戦ルームが成立することを確認する。
5. 待機中の取消、ルーム退出、ログアウトを確認する。

ログアウトではキュー取消とルーム退出を試行し、購読解除・Client dispose を行った後に Supabase session を破棄します。取消または退出に失敗しても session の破棄は続行します。token、join token、secret は画面ログへ出しません。

## Worker 設定

`wrangler.jsonc` は standalone と同じ 5 種類の Durable Object、D1、Migration v1〜v3 を定義します。D1 Migration はインストール済み `@flarelobby/cloudflare/migrations` を参照します。

`SUPABASE_URL` は Worker の非秘密変数です。`FLARE_LOBBY_TOKEN_SECRET` は Wrangler Secret として設定し、ローテーション時は既存の参加・再開トークンが無効になることに注意してください。

認証済み利用者には join、spectate、host 操作の入口を許可します。Room Durable Object が所属・役割・host・定員を最終検証し、試合結果登録は `false` で拒否します。ブラウザからの結果登録を実装していません。

本番では `src/index.ts` の `cors.allowedOrigins` を実際のブラウザ Origin の完全一致へ変更してください。認証無効化スイッチ、任意 Bearer 認証、全認証 provider 対応、SNS ログイン、React UI はこの例の対象外です。

## ローカル D1 と dry-run

```sh
pnpm db:apply:local
pnpm deploy:dry-run
```

`deploy:dry-run` はアップロードせず、実デプロイや本番リソースの自動作成も行いません。公開前の実サービス確認は、課金・権限・本番認証情報の取り扱いを確認したうえで別途実施してください。
