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
| `0004_team_rating.sql`       | チーム対応の試合結果テーブルと索引               |
| `0005_rating_algorithm.sql`  | レーティング方式と RD・ボラティリティの列追加    |

`0003_local_demo_rps.sql` はモノレポのローカルデモ用にリポジトリへ残しますが、
`@flarelobby/cloudflare` の公開 package には含めません。公開 package の Migration は
`0001`、`0002`、`0004`、`0005` の4本です。既存データベースの
`d1_migrations` に `0003_local_demo_rps.sql` がある場合は、履歴とテーブルを削除せず
そのまま保持します。

### 公開 package を利用するプロジェクト

公開 package をモノレポ外で利用する場合は、Migration を手作業でコピーせず、利用者側の
Wrangler 設定からインストール済み package のディレクトリを直接指定します。`migrations_dir`
は Wrangler 設定ファイルからの相対パスです。

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

新規環境では、Worker を起動・デプロイする前に Migration を適用します。

```sh
pnpm add @flarelobby/cloudflare @flarelobby/core
pnpm add -D wrangler
pnpm wrangler d1 migrations apply my-flarelobby --local
pnpm wrangler dev
```

モノレポ内のローカルデモは `../../packages/cloudflare/migrations` を参照するため、
デモ用の `0003_local_demo_rps.sql` も引き続き適用されます。

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

### 実行時初期化済みデータベースの引き継ぎ

過去のバージョンでは、Worker の `ensureRatingSchema` が D1 のテーブル・列を先に
作成していても、Wrangler の `d1_migrations` に履歴がない場合があります。この状態で
`0005_rating_algorithm.sql` を無条件に実行すると、既存列への重複 `ALTER TABLE` になります。
既存環境では、Migration 適用前にスキーマと履歴の差を読み取ってください。
`d1_migrations` テーブル自体がない場合は、Wrangler の履歴がない状態として扱います。

```sql
SELECT type, name, tbl_name
FROM sqlite_master
WHERE type IN ('table', 'index')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;

PRAGMA table_info(flarelobby_rating_seasons);
PRAGMA table_info(flarelobby_ratings);
```

`d1_migrations` テーブルが存在する場合だけ、次の履歴確認用の `SELECT` を実行します。
テーブルが存在しない場合はこの `SELECT` を実行せず、そのまま次の履歴補正の手順へ進んでください。

```sql
SELECT id, name, applied_at
FROM d1_migrations
ORDER BY id;
```

次の対応関係を確認し、テーブル・索引・列がすべて実在する Migration だけを「適用済み」
として履歴へ補正します。既存の行、履歴、`0003` のデモテーブルを削除したり、DBを
作り直したりしないでください。

| 実行時に確認する内容                                    | 対応する履歴                 |
| ------------------------------------------------------- | ---------------------------- |
| カスタムルーム一覧テーブルと2つの索引                   | `0001_custom_room_index.sql` |
| 単体レーティングの4テーブルと索引                       | `0002_rating.sql`            |
| チームレーティングの2テーブルと索引                     | `0004_team_rating.sql`       |
| `algorithm`、`rating_deviation`、`rating_volatility` 列 | `0005_rating_algorithm.sql`  |

例えば、実行時初期化で `0002`、`0004`、`0005` の内容がすべて揃っていると確認できた
場合の補正例は次のとおりです。実際の状態にない名前は追加しません。

```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO d1_migrations (name)
SELECT '0002_rating.sql'
WHERE NOT EXISTS (
  SELECT 1 FROM d1_migrations WHERE name = '0002_rating.sql'
);
INSERT INTO d1_migrations (name)
SELECT '0004_team_rating.sql'
WHERE NOT EXISTS (
  SELECT 1 FROM d1_migrations WHERE name = '0004_team_rating.sql'
);
INSERT INTO d1_migrations (name)
SELECT '0005_rating_algorithm.sql'
WHERE NOT EXISTS (
  SELECT 1 FROM d1_migrations WHERE name = '0005_rating_algorithm.sql'
);
```

履歴を補正した後に、通常の `d1 migrations apply` を実行します。新たに存在しない
`0001` だけが適用され、既存列へ `0005` の `ALTER` が重ねて実行されることはありません。
履歴補正後も Worker 起動時の `ensureRatingSchema` は列を再確認するため、冪等に動作します。

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

公開 package の tarball、外部プロジェクトからの `migrations_dir` 解決、空DBへの初回適用、
同じ Migration の再適用、旧スキーマのデータ保持、実行時初期化済みDBの履歴補正は
`pnpm check:packages` でローカル D1 を使って検証します。

## アプリケーション設定との関係

`defineFlareLobby()` に渡す設定（カスタムルームの定員、マッチングプール、
入力上限など）はコード側で検証されます。Binding の不備や設定エラーは
`FlareLobbyConfigurationError` として報告されます。設定項目の詳細は
[`packages/cloudflare/src/config.ts`](../packages/cloudflare/src/config.ts)
の doc コメントを参照してください。
