# Cloudflare 設定

FlareLobby の Gateway Worker を Cloudflare へデプロイするための Binding、
D1 Migration、Secret、環境構成の手順をまとめます。ローカル起動の最小手順は
[README](../README.md) を参照してください。

## 必要な Binding

Worker が要求する Binding 契約は
[`packages/cloudflare/src/config.ts`](../packages/cloudflare/src/config.ts)
の `FlareLobbyBindings` に定義されています。

| Binding                    | 種別                     | 必須 | 役割                                   |
| -------------------------- | ------------------------ | ---- | -------------------------------------- |
| `FLARE_LOBBY_ROOMS`        | Durable Object Namespace | 必須 | Room の正本状態（SQLite）              |
| `FLARE_LOBBY_MATCH_POOLS`  | Durable Object Namespace | 必須 | 1 対 1 マッチングの待ちキュー          |
| `FLARE_LOBBY_RATE_LIMITS`  | Durable Object Namespace | 必須 | 主体ごとの分散レート制限               |
| `FLARE_LOBBY_DB`           | D1 Database              | 必須 | 公開ルーム一覧・レーティング・試合履歴 |
| `FLARE_LOBBY_ANALYTICS`    | Analytics Engine Dataset | 任意 | 構造化ログと品質メトリックの出力先     |
| `FLARE_LOBBY_TOKEN_SECRET` | Secret（文字列）         | 必須 | join / resume トークンの署名鍵         |

Binding 名を変更すると実装と一致しなくなるため、`wrangler.jsonc` 側も
同じ名前を保ってください。

## wrangler.jsonc

共有設定は [`packages/cloudflare/wrangler.jsonc`](../packages/cloudflare/wrangler.jsonc)
にあります。ローカル用の最上位設定に加え、`staging` と `production` の
2 つの env を定義しています。

- `main`: Worker のエントリポイント（ローカル検証用の `src/dev-worker.ts`）
- `compatibility_date`: 動作確認済みの日付に固定
- `durable_objects.bindings`: 3 つの Durable Object Namespace
- `migrations`: Durable Object の SQLite 移行タグ（`v1`、`v2`）
- `d1_databases`: `FLARE_LOBBY_DB` と `migrations_dir: "migrations"`
- `env.production.analytics_engine_datasets`: 任意の `FLARE_LOBBY_ANALYTICS`

各 env ごとに `database_name` を切り替えます
（`flarelobby-local` / `flarelobby-staging` / `flarelobby-production`）。

## D1 Migration

D1 スキーマは [`packages/cloudflare/migrations`](../packages/cloudflare/migrations)
配下の SQL ファイルで管理します。

| ファイル                     | 内容                                             |
| ---------------------------- | ------------------------------------------------ |
| `0001_custom_room_index.sql` | 公開カスタムルーム一覧の検索用テーブルと索引     |
| `0002_rating.sql`            | シーズン、レーティング、試合履歴のテーブルと索引 |
| `0003_local_demo_rps.sql`    | ローカルデモ用のじゃんけん対戦記録テーブル       |

適用は Wrangler の migration コマンドを使います。

```sh
# ローカル（Miniflare の D1 へ適用）
pnpm --filter @flarelobby/cloudflare exec wrangler d1 migrations apply flarelobby-local --local

# リモート（staging / production）
pnpm --filter @flarelobby/cloudflare exec wrangler d1 migrations apply flarelobby-staging --env staging --remote
pnpm --filter @flarelobby/cloudflare exec wrangler d1 migrations apply flarelobby-production --env production --remote
```

`migrations/0002_rating.sql` は `src/rating.ts` の `RATING_SCHEMA_STATEMENTS`
と同じスキーマを宣言しています。両者は
`pnpm check:rating-schema`（`scripts/verify-rating-schema.mjs`）で整合性を
検証するため、片方だけを変更すると検証が失敗します。

公開ルーム一覧と招待コード解決の派生テーブルは、Room Durable Object からの
初回同期時に Worker が冪等に作成します。D1 Migration の適用後に自動で揃うため、
手動で SQL を実行する必要はありません。

## Secret

トークン署名用の秘密値 `FLARE_LOBBY_TOKEN_SECRET` は必須です。
`wrangler.jsonc` の `secrets.required` が未設定のデプロイを検出します。

```sh
pnpm --filter @flarelobby/cloudflare exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET --env staging
pnpm --filter @flarelobby/cloudflare exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET --env production
```

ローカル開発では `.dev.vars`（gitignore 済み）に記載します。

```sh
FLARE_LOBBY_TOKEN_SECRET=local-only-secret
```

値は推測困難な十分に長いランダム文字列を使い、環境ごとに別の値を発行して
ください。ローテーションすると既存の再開トークンが無効になります。

Binding と Secret の不備は起動時に検証されます。`FLARE_LOBBY_TOKEN_SECRET`
が設定されていない Worker は、安定した設定エラーコード
`TOKEN_SECRET_MISSING`（`FlareLobbyConfigurationError`）で報告されます。
その他の設定エラーコードは
[`packages/cloudflare/src/config.ts`](../packages/cloudflare/src/config.ts)
の `FLARE_LOBBY_CONFIGURATION_ERROR_CODES` を参照してください。

## デプロイ

```sh
# ドライラン（アップロードは行わない）
pnpm build
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env staging --dry-run

# staging / production へ反映
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env staging
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env production
```

事前に `d1 migrations apply --remote` でスキーマを適用し、Secret を登録して
おいてください。デプロイ前の一括検証は `pnpm release:check` が
Workers 型、パッケージ公開内容、ドライランを含めて確認します。
Node.js と pnpm のバージョンは [mise.toml](../mise.toml) に固定されています。

## アプリケーション設定との関係

`defineFlareLobby()` に渡す設定（カスタムルームの定員、マッチングプール、
入力上限など）はコード側で検証されます。Binding の不備や設定エラーは
`FlareLobbyConfigurationError` として報告されます。設定項目の詳細は
[`packages/cloudflare/src/config.ts`](../packages/cloudflare/src/config.ts)
の doc コメントを参照してください。
