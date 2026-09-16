# hosted-demo 専用マイグレーション

専用の demo 環境（staging / demo 本番）の D1 に適用する順序を明記します。
既存ユーザー環境とは共有しません。

## 適用順と元ファイルの照合

| 順序 | このディレクトリ                  | 元ファイル                                                  | 内容                                     |
| ---- | --------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| 1    | `0001_base_custom_room_index.sql` | `packages/cloudflare/migrations/0001_custom_room_index.sql` | 配布 migration（カスタムルーム一覧）     |
| 2    | `0002_base_rating.sql`            | `packages/cloudflare/migrations/0002_rating.sql`            | 配布 migration（レーティング・試合履歴） |
| 3    | `0003_base_team_rating.sql`       | `packages/cloudflare/migrations/0004_team_rating.sql`       | 配布 migration（チーム戦）               |
| 4    | `0004_base_rating_algorithm.sql`  | `packages/cloudflare/migrations/0005_rating_algorithm.sql`  | 配布 migration（方式列）                 |
| 5    | `0005_hosted_demo_rps.sql`        | `packages/cloudflare/migrations/0003_local_demo_rps.sql`    | デモ専用 RPS schema                      |

- SQL 本文は元ファイルと同一です（`pnpm verify:migrations` が照合します）。
- デモ table（`flarelobby_demo_rps_matches`）を package の配布 migration へ
  混入させていません。デモ専用 schema はこのディレクトリだけに置きます。
- package 側の migration が更新されたら、このディレクトリの対応ファイルも
  同じ内容へ更新し、照合テストを再実行してください。

## 適用手順

```sh
cd examples/hosted-demo
pnpm run db:apply:local   # ローカル確認用
wrangler d1 migrations apply flarelobby-hosted-demo-staging --config wrangler.jsonc
wrangler d1 migrations apply flarelobby-hosted-demo --config wrangler.jsonc
```
