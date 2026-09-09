# `@flarelobby/core`

FlareLobby のプラットフォーム非依存な公開型、プロトコル、1 対 1 および
パーティー/チーム単位のマッチング、ELO/Glicko-2 レーティングを提供する
ES Modules パッケージです。

```sh
pnpm add @flarelobby/core
```

上記は公開後の指定です。公開前の検証は
[導入とローカルサンプル](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md) の
npm 利用者向け手順の tarball 経路を使ってください。

利用方法と全公開 Export は、リポジトリの
[API リファレンス](https://github.com/katsu996/FlareLobby/blob/main/docs/api-reference.md)
を参照してください。現行のマッチングとレーティングの使い分けは
[マッチメイキング利用ガイド](https://github.com/katsu996/FlareLobby/blob/main/docs/matchmaking-guide.md) と
[レーティング](https://github.com/katsu996/FlareLobby/blob/main/docs/rating.md)、
Cloudflare Workers 実装は `@flarelobby/cloudflare`、ブラウザ
向け Client SDK は `@flarelobby/client` です。npm からの導入全体は
[導入とローカルサンプル](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md) の
npm 利用者向け手順を参照してください。本体リポジトリの clone は不要です。

ライセンスは [MIT](./LICENSE) です。
