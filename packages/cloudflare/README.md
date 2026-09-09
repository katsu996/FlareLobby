# `@flarelobby/cloudflare`

FlareLobby の Gateway Worker、Durable Objects、D1、認証・認可境界を提供する
Cloudflare Workers 向け ES Modules パッケージです。5 種類の Durable Objects
（Room、MatchPool、Party、PartyMembership、RateLimit）と `v1`〜`v3` の
Migration を含みます。

```sh
pnpm add @flarelobby/cloudflare @flarelobby/core
```

上記は公開後の指定です。公開前の検証は
[導入とローカルサンプル](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md) の
npm 利用者向け手順の tarball 経路を使ってください。

Binding、Migration、環境型生成、デプロイの手順は
[Cloudflare 設定](https://github.com/katsu996/FlareLobby/blob/main/docs/cloudflare-configuration.md)
と
[導入とローカルサンプル](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md) の
npm 利用者向け手順を参照してください。本体リポジトリの clone は不要で、公式の
導入例は
[Standalone テンプレート](https://github.com/katsu996/FlareLobby/blob/main/templates/standalone/README.md)
です。ローカルサンプルの簡易認証を本番へ流用せず、利用者側の認証
サービスを `authenticate` Hook へ接続し、`authorization` Hook で操作可否を
判定してください。未接続の初期状態は保護 API を拒否します。標準 Gateway の
ヘルスチェックは `GET /` であり、`/health` はローカルデモ独自です。

公開 package には本体用の D1 Migration（`0001`、`0002`、`0004`、`0005`）が
`migrations/` として含まれます。利用者側の `wrangler.jsonc` では、Migration をコピーせず
`migrations_dir: "node_modules/@flarelobby/cloudflare/migrations"` を指定してください。
ローカルデモ専用の `0003_local_demo_rps.sql` は公開 package には含まれません。

ライセンスは [MIT](./LICENSE) です。
