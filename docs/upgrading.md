# 更新手順

このページは、使用中の package 版から更新先を選んだ利用者が、
API・プロトコル・Durable Object Migration・D1 スキーマのどこが変わるか把握し、
データを失わずに更新するための手順です。
版の付け方の考え方は [バージョン方針](./versioning.md)、
現行の公開状態は [現行リリース情報](./releases/current.md) を参照してください。

## 標準の順序

1. バックアップと復元の方針を確認する
2. package を更新する
3. 新しい D1 Migration を適用する
4. Durable Object Migration を追加する（必要な場合）
5. staging で検証する
6. 本番へ反映する

この順序は目安です。実際の変更ごとに順序を検証し、
DB 先行が不可能な変更を無条件に当てはめません。
例えば、Worker コードが新しい列や新しい DO クラスを前提とする場合は、
コードの反映なしに Migration だけを先行させても動作しません。
[変更履歴](https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md) の
`Unreleased` と対象リリースノートの Migration 欄を確認してください。

## 1. バックアップと復元の方針を確認する

- D1 のバックアップ方法と復元手順を、本番データで試す前に確認します。
- Durable Object の SQLite 状態はコードの戻しだけでは戻りません。
  重要なルーム・パーティー状態がある場合は、運用側の退避方法を決めてから進めます。
- backup の確認なしにテーブルや履歴の削除、データベースの作り直しを行いません。

## 2. package を更新する

4 package は独立 version です（[バージョン方針](./versioning.md)）。
一律に同じ版を強制しません。利用する package ごとに更新先を指定します。

```sh
pnpm add @flarelobby/cloudflare@<version> @flarelobby/core@<version> @flarelobby/client@<version>
```

`minor` 更新では破壊的変更と移行手順の有無を確認します。
`protocolVersion` や観測 `schemaVersion` の変更がある場合は、
Client と Worker を組み合わせた検証が必要です。

## 3. 新しい D1 Migration を適用する

公開 package の Migration は `0001`、`0002`、`0004`、`0005` の 4 本です。
デモ専用 `0003_local_demo_rps.sql` は本体データベースに適用しません。
既存データベースに `0003` の履歴とテーブルがある場合は、削除せずそのまま保持します。

新規環境では、Worker の起動・デプロイ前に適用します。

```sh
pnpm wrangler d1 migrations apply <database-name> --local
```

既存環境（staging / production）では、リモート適用の前にスキーマと履歴の差を読み取ります。
実行時初期化済みデータベースでは Wrangler 履歴がない場合があります。
差の読み取りと履歴補正の手順は
[Cloudflare 設定](./cloudflare-configuration.md) の
「実行時初期化済みデータベースの引き継ぎ」を参照してください。

```sh
pnpm --filter @flarelobby/cloudflare exec wrangler d1 migrations apply <database-name> --remote --env staging
```

## 4. Durable Object Migration を追加する

現行タグは `v1`〜`v3` です。

- `v1`：`RoomDurableObject`、`MatchPoolDurableObject`
- `v2`：`RateLimitDurableObject`
- `v3`：`PartyDurableObject`、`PartyMembershipDurableObject`

既存の Migration タグは変更・再利用しません。
新しい Durable Object クラスや SQLite 移行が必要な場合は、新しいタグを追加します。
テンプレートと本体の `wrangler.jsonc` が正例です。

## 5. staging で検証する

```sh
pnpm generate:worker-types
pnpm typecheck
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env staging --dry-run
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env staging
```

公開 URL の `GET /` が `{ "status": "ready" }` を返すこと、
認証 Hook が実際の主体を返すことを確認します。
`ready` は必須設定検証の結果であり、
DB 疎通・Migration 適用済み・外部認証サービスの正常性の保証ではありません。

room 一覧と rating データの保持は、配布 tarball の検証で確認しています。
代表的な確認は次のとおりです。

```sh
node scripts/verify-package-migrations.mjs
node scripts/verify-rating-schema.mjs
```

## 6. 本番へ反映する

staging の検証が成功した後に、同じ順序で本番へ反映します。

```sh
pnpm --filter @flarelobby/cloudflare exec wrangler d1 migrations apply <production-database> --remote --env production
pnpm --filter @flarelobby/cloudflare exec wrangler deploy --env production
```

実 Cloudflare 環境の D1 作成・Migration・Secret・upload は、
所有者の承認後に行います。npm publish と GitHub Release 作成も同様です。

## ロールバック

Worker コードの戻しとデータベースの戻しは分けて考えます。

- Worker コードは前の版へ戻せます（デプロイのやり直し）。
- データベースは自動では戻りません。破壊的スキーマ変更に対する
  自動 down migration は提供しません。
- backup 未確認の削除や作り直しは提案しません。
- 検証済みのデータ保持手順だけを使います。履歴補正が必要な場合は
  [Cloudflare 設定](./cloudflare-configuration.md) の手順を使い、
  実在しない履歴名の追加や既存行の削除を行いません。

Secret のローテーション後は既存の再開トークンが無効になります。
ロールバック時に Secret を変更した場合は、その影響を確認してください。
