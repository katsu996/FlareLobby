# FlareLobby

[![Codecov](https://codecov.io/gh/katsu996/FlareLobby/graph/badge.svg)](https://app.codecov.io/gh/katsu996/FlareLobby)

FlareLobby は、Cloudflare Workers と Durable Objects を利用するゲーム向けの
マッチメイキング、カスタムルーム、リアルタイム状態管理ライブラリです。
TypeScript の Client SDK から、認証済みのルーム作成・参加、パーティー作成・招待、
1 対 1 およびパーティー/チーム単位のランクマッチング、再接続、ELO/Glicko-2 の
取得までを利用できます。

このリポジトリは現行機能の利用入口です。v0.1.0 時点の範囲と制限は歴史記録として
[v0.1.0 Release Note](./docs/releases/v0.1.0.md) に残し、現行機能とは分けて参照
してください。ゲーム本体の権威同期や物理演算を提供するものではなく、ロビーと
対戦成立後の接続境界を提供します。

## 含まれるもの

- 公開・一覧非表示・招待コード・パスワード方式のカスタムルーム
- プレイヤー参加、観戦、準備、チーム選択、ホスト移譲、強制退出、開始、退出
- Room Durable Object による SQLite 正本、単調な `revision`、冪等なコマンド処理
- Hibernation 対応 WebSocket、再開トークン、差分または完全スナップショット復元
- 公開ルーム一覧の D1 投影と、Room Durable Object による最終的な参加判定
- パーティー作成・招待・参加・リーダー移譲と、主体ごとの所属不変条件の検査
- 1 対 1 およびパーティー/チーム単位のマッチング、待機時間に応じた検索幅拡大、
  チケットのキャンセル・期限切れ
- D1 へのシーズン別レーティング、試合履歴、結果の冪等登録（ELO/Glicko-2 選択可、
  チーム戦は `registerTeamMatchResult`）
- ブラウザ向け Client SDK、決定論的なシミュレーター、Workers 統合テスト

## 含まれないもの

権威ゲームサーバー、物理演算やゲーム状態の同期、ボイス・映像・WebRTC 本体、
管理画面、汎用チート対策、複数リージョンをまたぐ高度なキュー統合、他クラウド
向けの実行基盤は対象外です。未実装の将来機能を利用可能と誤認させる API や
ガイドは掲載していません。v0.1.0 時点で対象外だった項目のうち、パーティー、
チーム編成、Glicko-2 は現行版で対応済みです。当時の制限は現行版全体の制限と
混同せず、[v0.1.0 Release Note](./docs/releases/v0.1.0.md) を歴史記録として
参照してください。

## まず読む文書

| 目的                                               | 文書                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| npm から導入する（本体 clone 不要）                | [導入とローカルサンプル](./docs/getting-started.md) の npm 利用者向け手順と [Standalone テンプレート](./templates/standalone/README.md) |
| 5 分でローカル Worker を起動する（本体開発者向け） | [導入とローカルサンプル](./docs/getting-started.md) のリポジトリ開発者向け手順                                                          |
| Client SDK を使う（パーティーを含む）              | [クライアントSDK](./docs/client.md)                                                                                                     |
| カスタムルームを作成・参加・操作する               | [カスタムルーム利用ガイド](./docs/custom-room-guide.md)                                                                                 |
| ランクマッチと ELO/Glicko-2 を使う（チーム戦含む） | [マッチメイキング利用ガイド](./docs/matchmaking-guide.md) と [レーティング](./docs/rating.md)                                           |
| 引数、戻り値、イベント、HTTP API を調べる          | [APIリファレンス](./docs/api-reference.md)                                                                                              |
| Cloudflare Binding、Migration、デプロイを設定する  | [Cloudflare 設定](./docs/cloudflare-configuration.md)                                                                                   |
| 設計境界と状態遷移を確認する                       | [アーキテクチャ](./docs/architecture.md)                                                                                                |
| テスト、シミュレーション、文書検証を実行する       | [テストと検証](./docs/testing.md)                                                                                                       |
| v0.1.0 の既知の制限と公開前確認を読む              | [v0.1.0 Release Note](./docs/releases/v0.1.0.md)                                                                                        |

設計の正本は GitHub の [Issue #1](https://github.com/katsu996/FlareLobby/issues/1) です。
公開 API の説明を変更するときは、実装・テスト・このリファレンスを同時に更新します。

## パッケージ構成

| パス                   | パッケージ                         | 役割                                                       |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `packages/core`        | `@flarelobby/core`                 | JSON 型、状態モデル、プロトコル、マッチング、ELO/Glicko-2  |
| `packages/cloudflare`  | `@flarelobby/cloudflare`           | Gateway Worker、Durable Objects、D1、認証境界              |
| `packages/client`      | `@flarelobby/client`               | ブラウザ向け HTTP/WebSocket Client SDK（パーティーを含む） |
| `packages/testing`     | `@flarelobby/testing`              | 仮想時計、固定乱数、マッチングシミュレーター               |
| `examples/local-demo`  | `@flarelobby/example-local-demo`   | ローカル確認用の最小 Worker（リポジトリ開発者向け）        |
| `templates/standalone` | （配布テンプレート、非 workspace） | 別リポジトリ向け最小導入例。公開パッケージ名だけで解決     |

すべてのパッケージは ES Modules です。公開識別子は TypeScript の慣習に従って
英語、説明文とコメントは日本語で記載しています。

## 必要な環境

本体リポジトリを開発する環境と、npm 利用者側の必要条件は分けています。

本体開発では次を固定しています。

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

npm 利用者側の必要条件は [Standalone テンプレート](./templates/standalone/README.md)
と [導入とローカルサンプル](./docs/getting-started.md) の npm 利用者向け手順を
参照してください。テンプレートは `engines` として Node.js `>=22.12.0` と
`pnpm@11.21.0` を宣言しています。未検証のランタイム互換性は断言しません。

## 開発・検証コマンド

```sh
pnpm lint
pnpm lint:fix
pnpm format:check
pnpm format
pnpm build
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm check:docs
pnpm check:esm
pnpm release:check
```

`pnpm lint` は Oxlint による静的解析、`pnpm lint:fix` は安全に自動修正可能な
指摘の修正を行います。`pnpm format:check` は Oxfmt による整形状態を確認し、
`pnpm format` は整形を反映します。`pnpm test` は単体テストと Workers 統合テストを
順に実行します。`check:docs` は必須文書、公開 Export と API リファレンス、
エラーコード、状態名、コード例の型検査を確認します。

`release:check` は Oxlint・Oxfmt の確認を含む全 build・テストに加え、Workers 型、
4 package の npm publish dry-run、サンプル Worker の `wrangler deploy --dry-run`、
MIT License、公開対象ファイルを一括検証します。実際の npm publish や Cloudflare
upload は行いません。

## Cloudflare Worker

共有設定は [`packages/cloudflare/wrangler.jsonc`](./packages/cloudflare/wrangler.jsonc)
にあります。5 種類の Durable Objects（Room、MatchPool、Party、PartyMembership、
RateLimit）と `v1`〜`v3` の Migration、全必須 Binding の詳細は
[Cloudflare 設定](./docs/cloudflare-configuration.md) を参照してください。
npm 利用者は本体リポジトリを clone せず、
[導入とローカルサンプル](./docs/getting-started.md) の npm 利用者向け手順と
[Standalone テンプレート](./templates/standalone/README.md) を起点にしてください。

最小のローカル確認（本体開発者向け）は次のコマンドで開始できます。

```sh
pnpm build
pnpm --filter @flarelobby/example-local-demo dev
```

標準 Gateway のヘルスチェックは `GET /`（`{ "status": "ready" }`）です。
`GET /health` はローカルデモ独自のエンドポイントであり、標準 Gateway には
追加しません。今回新たな health API は作りません。

サンプルは `x-demo-player` または `Authorization: Bearer <player>` をローカル
認証として使います。これはローカル専用であり、本番へデプロイしてはいけません。
本番ではアプリケーションの認証基盤を `authenticate` Hook へ接続し、
`authorization` Hook で操作可否を判定してください。未接続の初期状態は保護 API
を拒否します。Binding、D1 Migration、Secret、staging/production のデプロイ手順は
[導入とローカルサンプル](./docs/getting-started.md) と
[Cloudflare 設定](./docs/cloudflare-configuration.md) にまとめています。

パッケージの公開状態は作業時に registry で確認してください。2026-09-08 時点では
`@flarelobby/*` は npm registry で未公開（`404 Not Found`）のため、`pnpm add`
で取得できると断言しません。公開後はテンプレートの `dependencies` に記載の
バージョン指定で導入し、公開前の検証は `pnpm pack` で生成した tarball を利用する
経路を併記しています。詳細は [導入とローカルサンプル](./docs/getting-started.md)
の npm 利用者向け手順を参照してください。

## Changesets

パッケージの変更履歴と将来のリリース準備には Changesets を使用します。

```sh
pnpm changeset
pnpm version-packages
```

このリポジトリの CI は公開やデプロイを自動実行しません。

## 変更履歴、Release Note、ライセンス

- [CHANGELOG](./CHANGELOG.md)
- [v0.1.0 Release Note](./docs/releases/v0.1.0.md)
- [MIT License](./LICENSE)

npm publish と GitHub Release 作成は、所有者の明示的な最終承認後にのみ実行します。
