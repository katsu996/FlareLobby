---
theme: default
title: FlareLobby ドキュメント
titleTemplate: "%s"
info: Cloudflare Workers 向けゲームロビーライブラリの日本語ガイド
routerMode: hash
presenter: false
download: false
wakeLock: false
fonts:
  sans: sans-serif
  mono: monospace
  provider: none
htmlAttrs:
  lang: ja
themeConfig:
  primary: "#ea580c"
---

# FlareLobby

Cloudflare Workers と Durable Objects で作るゲームロビー

カスタムルーム・パーティー・マッチメイキング・レーティング

[導入ガイド](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md) ·
[API リファレンス](https://github.com/katsu996/FlareLobby/blob/main/docs/api-reference.md) ·
[GitHub](https://github.com/katsu996/FlareLobby)

矢印キーでページ移動。左下のメニューから一覧表示できます。

---

# できること

- 公開・招待コード・パスワードによるルーム参加と観戦
- 準備、チーム選択、ホスト移譲、対戦開始
- パーティーの作成・招待と、1 対 1 / チーム単位のマッチング
- WebSocket の状態通知と、切断後のスナップショット復元
- シーズン別の ELO / Glicko-2 と試合履歴

ゲーム本体の権威同期、物理演算、ボイス・映像通信は対象外です。

[対象範囲を読む](https://github.com/katsu996/FlareLobby#含まれるもの)

---

# パッケージと役割

| パッケージ               | 役割                                                   |
| ------------------------ | ------------------------------------------------------ |
| `@flarelobby/core`       | 型・プロトコル・マッチング・レーティングの純粋ロジック |
| `@flarelobby/cloudflare` | Gateway Worker・Durable Objects・D1・認証境界          |
| `@flarelobby/client`     | ブラウザ向け HTTP / WebSocket SDK                      |
| `@flarelobby/testing`    | 仮想時計・固定乱数・マッチングシミュレーター           |

すべて ES Modules。API の識別子は英語、ガイドは日本語です。

[アーキテクチャ](https://github.com/katsu996/FlareLobby/blob/main/docs/architecture.md)

---

# 導入の入口

アプリケーションへの導入は **Standalone テンプレート** から始めます。

1. 依存関係を導入し、独自 Worker を定義する
2. Durable Object Binding と D1 Migration を設定する
3. Secret と認証・認可 Hook を接続する
4. 型生成 → ローカル起動 → デプロイの dry-run

npm の公開状態を確認してから導入してください。公開前の tarball 検証手順も
導入ガイドに記載しています。

[導入ガイド](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md) ·
[Standalone テンプレート](https://github.com/katsu996/FlareLobby/tree/main/templates/standalone)

---

# ローカルで試す

本体リポジトリの開発環境：Node.js `24.19.0` / pnpm `11.21.0`

```sh
git clone https://github.com/katsu996/FlareLobby.git
cd FlareLobby
pnpm install --frozen-lockfile
pnpm build
cp examples/local-demo/.dev.vars.example examples/local-demo/.dev.vars
pnpm --filter @flarelobby/example-local-demo dev
```

`.dev.vars` の Secret を設定し、`http://localhost:8787` を開きます。
デモ認証はローカル専用です。

[初期化・Migration の詳細](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md#リポジトリ開発者向け) ·
[じゃんけんデモ](https://github.com/katsu996/FlareLobby/blob/main/docs/local-demo.md)

---

# Client SDK の初期化

```ts
import { createFlareLobbyClient } from "@flarelobby/client";

const lobby = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
});
```

`auth.getAccessToken()` はアプリケーションの認証基盤へ接続します。

`createCustomRoom()` / `joinCustomRoom()` は WebSocket 接続と初期同期を
完了した Room を返します。

[Client SDK](https://github.com/katsu996/FlareLobby/blob/main/docs/client.md) ·
[型検査済みのコード例](https://github.com/katsu996/FlareLobby/blob/main/docs/examples/client-api.ts)

---

# カスタムルーム

```ts
const host = await lobby.createCustomRoom({
  name: "週末の練習",
  visibility: "unlisted",
  joinMethod: "invitation",
  maxPlayers: 4,
});
const stop = host.subscribe((snapshot) => render(snapshot));
await host.setReady(true);
// 画面を閉じるとき
stop();
await host.leave();
```

Room Durable Object が定員・権限・状態の最終判定を行います。

[作成・参加・観戦・ホスト操作](https://github.com/katsu996/FlareLobby/blob/main/docs/custom-room-guide.md)

---

# マッチメイキングとパーティー

```ts
const ticket = await lobby.joinMatchmaking("ranked-jp");
const room = await ticket.waitForMatch();
// 待機を取り消す場合は ticket.cancel()
```

- Gateway 側で Pool・リージョン・検索幅・対戦ルームを設定する
- 待機時間に応じて検索幅を広げ、1 対 1 またはチーム単位で成立させる
- `waitForMatch()` は接続・初期同期済みの `PlayerRoom` を返す
- パーティーの招待・所属管理とチーム編成にも対応

[マッチング設定・キャンセル](https://github.com/katsu996/FlareLobby/blob/main/docs/matchmaking-guide.md) ·
[パーティー API](https://github.com/katsu996/FlareLobby/blob/main/docs/client.md)

---

# 切断からの復帰とレーティング

**再接続**

一時切断中は参加者情報を猶予期間内で保持します。再開トークンと `revision` で
差分または完全スナップショットを復元します。明示退出後は自動再接続しません。

**レーティング**

ELO / Glicko-2 を選択でき、シーズン別に D1 へ保存します。
試合結果は信頼できるサーバー側から登録し、重複登録を防ぎます。

[再接続の仕組み](https://github.com/katsu996/FlareLobby/blob/main/docs/adr/0002-reconnect-and-revision.md) ·
[レーティング](https://github.com/katsu996/FlareLobby/blob/main/docs/rating.md) ·
[結果登録の信頼境界](https://github.com/katsu996/FlareLobby/blob/main/docs/adr/0004-match-result-trust-boundary.md)

---

# 本番環境の準備

- 5 種類の Durable Objects と Migration `v1`〜`v3` を設定する
- D1 の環境別 ID と Migration、`FLARE_LOBBY_TOKEN_SECRET` を設定する
- `authenticate` と `authorization` を接続する（未接続では保護 API を拒否）
- 別オリジンのブラウザには `cors.allowedOrigins` を設定する
- ローカルデモ用の認証を本番環境へ持ち込まない

[Cloudflare 設定](https://github.com/katsu996/FlareLobby/blob/main/docs/cloudflare-configuration.md) ·
[セキュリティ](https://github.com/katsu996/FlareLobby/blob/main/docs/security.md) ·
[観測基盤](https://github.com/katsu996/FlareLobby/blob/main/docs/observability.md)

---

# 詳細ドキュメント

| 目的                 | ガイド                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 導入する             | [導入手順](https://github.com/katsu996/FlareLobby/blob/main/docs/getting-started.md)                                                                                       |
| API を調べる         | [引数・戻り値・イベント・エラー](https://github.com/katsu996/FlareLobby/blob/main/docs/api-reference.md)                                                                   |
| 通信と状態を理解する | [プロトコル](https://github.com/katsu996/FlareLobby/blob/main/docs/protocol.md) / [ドメインモデル](https://github.com/katsu996/FlareLobby/blob/main/docs/domain-model.md)  |
| 検証する             | [テスト・シミュレーション・文書検証](https://github.com/katsu996/FlareLobby/blob/main/docs/testing.md)                                                                     |
| 変更履歴を見る       | [CHANGELOG](https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md) / [v0.1.0 の歴史記録](https://github.com/katsu996/FlareLobby/blob/main/docs/releases/v0.1.0.md) |

[不具合報告・機能提案](https://github.com/katsu996/FlareLobby/issues) ·
[MIT License](https://github.com/katsu996/FlareLobby/blob/main/LICENSE)
