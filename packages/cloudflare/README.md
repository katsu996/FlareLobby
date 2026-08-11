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

ライセンスは [MIT](./LICENSE) です。
