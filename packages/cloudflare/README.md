# `@flarelobby/cloudflare`

FlareLobby の Gateway Worker、Durable Objects、D1、認証・認可境界を提供する
Cloudflare Workers 向け ES Modules パッケージです。

```sh
pnpm add @flarelobby/cloudflare @flarelobby/core
```

Binding、Migration、環境型生成、デプロイの手順は
[Cloudflare 設定](https://github.com/katsu996/FlareLobby/blob/main/docs/cloudflare-configuration.md)
を参照してください。ローカルサンプルの簡易認証を本番へ流用せず、利用者側の認証
サービスを `authenticate` Hook へ接続してください。

公開 package には本体用の D1 Migration（`0001`、`0002`、`0004`、`0005`）が
`migrations/` として含まれます。利用者側の `wrangler.jsonc` では、Migration をコピーせず
`migrations_dir: "node_modules/@flarelobby/cloudflare/migrations"` を指定してください。
ローカルデモ専用の `0003_local_demo_rps.sql` は公開 package には含まれません。

ライセンスは [MIT](./LICENSE) です。
