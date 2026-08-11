# FlareLobby

FlareLobby は、Cloudflare Workers と Durable Objects を利用するゲーム向けの
マッチメイキング、カスタムルーム、リアルタイム状態管理ライブラリです。
TypeScript の Client SDK から、認証済みのルーム作成・参加、1 対 1 ランク
マッチング、再接続、ELO の取得までを利用できます。

このリポジトリは v0.1.0 の最小実用版を実装しています。ゲーム本体の権威同期や
物理演算を提供するものではなく、ロビーと対戦成立後の接続境界を提供します。

## 含まれるもの

- 公開・一覧非表示・招待コード・パスワード方式のカスタムルーム
- プレイヤー参加、観戦、準備、チーム選択、ホスト移譲、強制退出、開始、退出
- Room Durable Object による SQLite 正本、単調な `revision`、冪等なコマンド処理
- Hibernation 対応 WebSocket、再開トークン、差分または完全スナップショット復元
- 公開ルーム一覧の D1 投影と、Room Durable Object による最終的な参加判定
- 1 対 1 マッチング、待機時間に応じた検索幅拡大、チケットのキャンセル・期限切れ
- D1 へのシーズン別 ELO、試合履歴、結果の冪等登録
- ブラウザ向け Client SDK、決定論的なシミュレーター、Workers 統合テスト

## 含まれないもの

権威ゲームサーバー、物理演算やゲーム状態の同期、パーティーマッチング、2 対 2
以上のチーム編成、ボイス・映像・WebRTC 本体、管理画面、汎用チート対策、複数
リージョンをまたぐ高度なキュー統合、他クラウド向けの実行基盤は対象外です。
未実装の将来機能を利用可能と誤認させる API やガイドは掲載していません。

## まず読む文書

| 目的 | 文書 |
| --- | --- |
| 5 分でローカル Worker を起動する | [導入とローカルサンプル](./docs/getting-started.md) |
| Client SDK を使う | [クライアントSDK](./docs/client.md) |
| カスタムルームを作成・参加・操作する | [カスタムルーム利用ガイド](./docs/custom-room-guide.md) |
| ランクマッチと ELO を使う | [マッチメイキング利用ガイド](./docs/matchmaking-guide.md) |
| 引数、戻り値、イベント、HTTP API を調べる | [APIリファレンス](./docs/api-reference.md) |
| Cloudflare Binding、Migration、デプロイを設定する | [Cloudflare 設定](./docs/cloudflare-configuration.md) |
| 設計境界と状態遷移を確認する | [アーキテクチャ](./docs/architecture.md) |
| テスト、シミュレーション、文書検証を実行する | [テストと検証](./docs/testing.md) |

設計の正本は GitHub の [Issue #1](https://github.com/katsu996/FlareLobby/issues/1) です。
公開 API の説明を変更するときは、実装・テスト・このリファレンスを同時に更新します。

## パッケージ構成

| パス | パッケージ | 役割 |
| --- | --- | --- |
| `packages/core` | `@flarelobby/core` | JSON 型、状態モデル、プロトコル、マッチング、ELO |
| `packages/cloudflare` | `@flarelobby/cloudflare` | Gateway Worker、Durable Objects、D1、認証境界 |
| `packages/client` | `@flarelobby/client` | ブラウザ向け HTTP/WebSocket Client SDK |
| `packages/testing` | `@flarelobby/testing` | 仮想時計、固定乱数、マッチングシミュレーター |
| `examples/local-demo` | `@flarelobby/example-local-demo` | ローカル確認用の最小 Worker |

すべてのパッケージは ES Modules です。公開識別子は TypeScript の慣習に従って
英語、説明文とコメントは日本語で記載しています。

## 必要な環境

- Node.js `24.19.0`
- pnpm `11.21.0`
- Wrangler はルートの開発依存関係から利用します

バージョンは [mise.toml](./mise.toml)、パッケージマネージャーの厳格な検査は
[.npmrc](./.npmrc) で固定しています。mise を使う場合は次のように環境を揃えます。

```sh
mise install
corepack enable
pnpm install --frozen-lockfile
```

mise を使わない場合も、上記と同じ Node.js/pnpm のバージョンを用意してください。

## 開発・検証コマンド

```sh
pnpm build
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm check:docs
pnpm check:esm
```

`pnpm test` は単体テストと Workers 統合テストを順に実行します。`check:docs` は
必須文書、公開 Export と API リファレンス、エラーコード、状態名、コード例の
型検査を確認します。

## Cloudflare Worker

共有設定は [`packages/cloudflare/wrangler.jsonc`](./packages/cloudflare/wrangler.jsonc)
にあります。最小のローカル確認は次のコマンドで開始できます。

```sh
pnpm build
pnpm --filter @flarelobby/example-local-demo dev
```

サンプルは `x-demo-player` または `Authorization: Bearer <player>` をローカル
認証として使います。これはローカル専用であり、本番へデプロイしてはいけません。
本番ではアプリケーションの認証基盤を `authenticate` Hook へ接続してください。
Binding、D1 Migration、Secret、staging/production のデプロイ手順は
[導入とローカルサンプル](./docs/getting-started.md) と
[Cloudflare 設定](./docs/cloudflare-configuration.md) にまとめています。

## Changesets

パッケージの変更履歴と将来のリリース準備には Changesets を使用します。

```sh
pnpm changeset
pnpm version-packages
```

このリポジトリの CI は公開やデプロイを自動実行しません。
