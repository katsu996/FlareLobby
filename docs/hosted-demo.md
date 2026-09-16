# 公開じゃんけんデモ（hosted-demo）

招待URLから遊べる公開用のじゃんけんデモです。`examples/hosted-demo` が
公開専用の Worker entry / ブラウザ / wrangler 設定を持ちます。ローカル専用
の `examples/local-demo` とは認証方式と利用環境が異なります。

- トップページの「デモを試す」→ゲストとして開始→招待リンクを友人に共有→
  双方準備→対戦→ランク戦の結果確認まで進めます。
- 相手がいない場合は、別ウィンドウで2人目を開いて体験できます。
  Bot 対戦は作りません。
- 公開 URL は所有者承認後にこの文書と README へ掲載します（未承認のため未掲載）。

## 構成と境界

- `examples/hosted-demo/src/index.ts` が公開専用 entry です。local-demo の
  ローカル専用認証（任意 Bearer / `x-demo-player`）は import しません。
- RPS の判定・参加者検証・結果確定は local-demo の `rps-game.ts` / `rps.ts`
  と同じ方針で、この例専用に複製しています（`src/rps-game.ts` / `src/rps.ts`）。
  ゲームエンジンや新しい公開 package は作っていません。
- ブラウザは Supabase 匿名ログインでサーバー発行の主体を取得します。
  プレイヤー名や URL パラメータを本人確認に使いません。
- 招待リンクは自サイトの `/#invite=<code>` です。認証 token / joinToken /
  resumeToken を URL へ載せません。
- 一般利用者の `authorizeMatchResult` は `false` です。RPS の手だけを
  受け付け、成立済み Match のチケットから参加者を復元してサーバーが勝敗を
  決め、既存 `registerMatchResult` で冪等反映します。

## 環境作成

専用 staging と demo 本番の D1 / Durable Objects / Secret を使い、既存
ユーザー環境とは共有しません。

```sh
# D1（staging / 本番で別名にする）
wrangler d1 create flarelobby-hosted-demo-staging
wrangler d1 create flarelobby-hosted-demo
```

`wrangler.jsonc` の要点（初期値）は次のとおりです。

| 設定                        | 値                                   | 備考                                             |
| --------------------------- | ------------------------------------ | ------------------------------------------------ |
| `SUPABASE_URL`              | 信頼する単一プロジェクトの https URL | Secret ではなく vars。ダミーのまま deploy しない |
| `FLARE_LOBBY_TOKEN_SECRET`  | 参加・再開トークン署名用 secret      | `wrangler secret put` で設定                     |
| `maxPlayers`                | 4 / ルーム                           | カスタムルーム上限                               |
| `maxRoomCreationsPerMinute` | 3 / 主体                             | ルーム作成上限                                   |
| `maxMessagesPerMinute`      | 60 / 主体                            | メッセージ上限                                   |
| チケット TTL・切断猶予      | 既存設定を利用                       | 新規値は設けない                                 |

利用者単位の制限は全体費用上限ではありません。匿名主体の増殖への対応は
CAPTCHA・予算通知・停止手順で行います（後述）。

## 認証（Supabase 匿名ログイン＋CAPTCHA）

1. Supabase プロジェクトで Anonymous sign-ins を有効にします。
2. 本番 CAPTCHA（例: Turnstile）を Supabase の CAPTCHA protection に接続し、
   ブラウザの `VITE_TURNSTILE_SITEKEY` に site key を設定します。
3. Supabase の公開設定（site URL・redirect URL）と rate limit を確認し、
   結果をこの文書の検証記録へ記載します。
4. ブラウザは `signInAnonymously({ options: { captchaToken } })` で開始し、
   要求直前の session から token を取得します。Worker は固定プロジェクトの
   JWKS（`SUPABASE_URL + /auth/v1/.well-known/jwks.json`）だけで検証します。
   匿名でも有効な JWT を検証し、ES256 / RS256、issuer 完全一致、audience
   `authenticated`、必須 exp・sub、role `authenticated` を確認します。
   HS256 と未署名 JWT は非対応です。

ブラウザ build 時の環境変数は次のとおりです。

| 変数                            | 用途                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `VITE_FLARE_LOBBY_ENDPOINT`     | 接続先 Worker URL（未設定なら同一 origin）               |
| `VITE_SUPABASE_URL`             | ブラウザ用 Supabase URL                                  |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ブラウザ利用が認められた publishable key                 |
| `VITE_TURNSTILE_SITEKEY`        | Turnstile site key（未設定なら widget を出さない検証用） |

`.env` の例にダミー値だけを置き、service-role key は配布物・ブラウザへ
置きません。

## マイグレーション

`examples/hosted-demo/migrations/` が専用ディレクトリです。配布4本に加え、
既存デモ専用 RPS schema の適用順を明記しています。

| 順序 | ファイル                          | 元ファイル                                                  |
| ---- | --------------------------------- | ----------------------------------------------------------- |
| 1    | `0001_base_custom_room_index.sql` | `packages/cloudflare/migrations/0001_custom_room_index.sql` |
| 2    | `0002_base_rating.sql`            | `packages/cloudflare/migrations/0002_rating.sql`            |
| 3    | `0003_base_team_rating.sql`       | `packages/cloudflare/migrations/0004_team_rating.sql`       |
| 4    | `0004_base_rating_algorithm.sql`  | `packages/cloudflare/migrations/0005_rating_algorithm.sql`  |
| 5    | `0005_hosted_demo_rps.sql`        | `packages/cloudflare/migrations/0003_local_demo_rps.sql`    |

SQL 本文は元ファイルと同一です（`pnpm verify:migrations` が照合します）。
package の配布 migration へデモ table を混入させていません。

```sh
cd examples/hosted-demo
pnpm run db:apply:local   # ローカル確認用
wrangler d1 migrations apply flarelobby-hosted-demo-staging --config wrangler.jsonc
wrangler d1 migrations apply flarelobby-hosted-demo --config wrangler.jsonc
```

## dry-run と deploy

```sh
cd examples/hosted-demo
pnpm typecheck
pnpm build:browser
pnpm test:unit
pnpm test:integration
pnpm deploy:dry-run
wrangler deploy --config wrangler.jsonc   # 所有者承認後に実行
```

## 確認手順

1. 2つのブラウザ context（または別ウィンドウ）で公開 URL を開きます。
2. 双方がゲストとして開始します。
3. A が招待ルームを作り、招待リンク（`/#invite=<code>`）を B へ共有します。
4. B はリンクを開き、ログイン完了後の「ルームへ参加」を押します。
5. 双方が準備し、ホストが開始してじゃんけんします。
6. ランク戦では 1v1 の結果と ELO を確認します。
7. 一時切断から復帰し、旧 revision の巻戻し・結果二重反映がないことを
   確認します。
8. 拒否系（第三者の match 参照・操作、勝敗直送、改ざん JWT、CAPTCHA 失敗、
   無効・期限切れ・満員・終了済みの招待）を確認します。

E2E の UX 部分は認証情報なしで実行できます。

```sh
cd examples/hosted-demo
HOSTED_DEMO_ORIGIN=http://localhost:8787 pnpm test:e2e
```

実 Supabase での完全な導線は staging で `HOSTED_DEMO_E2E_AUTH=1` を付けて
実行します。

## 保存データと削除（初期方針：最大7日）

保存するデモデータと期間を画面（ゲスト開始パネル）に表示しています。
初期方針はプレイ履歴・rating を最大7日とし、専用環境の運用手順により
削除します。実装できない保存期限を画面で保証しません。新しい汎用削除
API は作りません。

削除の対象・依存順・実行方法は次のとおりです。

1. D1（`flarelobby-hosted-demo[-staging]`）：`applied_at` が7日より古い
   `flarelobby_demo_rps_matches` / `flarelobby_rating_matches` 系の行を削除。
2. Durable Objects：D1 削除後に staging / 本番の DO を再作成または停止。
3. Supabase 匿名ユーザー：Auth 管理画面または API で匿名ユーザーを削除。
   D1 / DO の削除が先に終わっていることを確認してから行います。

## 停止手順・費用対策

- 匿名主体の増殖に備え、Turnstile と Supabase rate limit を有効にします。
- Cloudflare と Supabase の予算通知（billing alerts）を設定し、通知先と
  閾値を運用メモへ記録します。
- 緊急停止は Worker のルート無効化または deploy の取り消しで行います。
  手順は staging で検証してから本番手順書へ反映します。

## 検証記録

- ローカル検証（`typecheck` / `build:browser` / `test:unit` /
  `test:integration` / `verify:migrations` / `deploy --dry-run` /
  `pnpm docs:build`）：PR 作成時に実施し、結果を PR に記載します。
- CI のローカル JWKS 検証と実 Supabase / CAPTCHA の staging smoke は別に
  結果を記載します。
- 公開 URL・検証日時・30〜60秒の実操作動画または GIF とテキスト手順は、
  所有者承認後にこの文書へ追記し、`docs/index.md` / README から開ける
  ようにします（現時点では未承認のため未掲載）。
