# ローカルじゃんけんサンプル

`examples/local-demo` は、FlareLobby の Client SDK、カスタムルーム、1対1マッチング、
再接続、D1 レーティングを一つのブラウザ画面で確認する最小ゲームです。画面は
フレームワークへ依存せず、`src/browser.ts` を esbuild で `public/app.js` へまとめて
います。

## 起動

リポジトリのルートで次を実行します。

```sh
pnpm install --frozen-lockfile
cp examples/local-demo/.dev.vars.example examples/local-demo/.dev.vars
pnpm --filter @flarelobby/example-local-demo typecheck
pnpm --filter @flarelobby/example-local-demo exec wrangler d1 migrations apply FLARE_LOBBY_DB --local --config wrangler.jsonc
pnpm --filter @flarelobby/example-local-demo dev
```

ブラウザで [http://localhost:8787](http://localhost:8787) を開き、英小文字から始まる
異なるプレイヤー名を入力して2つのブラウザで利用します。

## APIと責務

| 画面の処理       | 利用するAPI                                            | 正本と責務                                                           |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| 招待ルーム作成   | `client.createCustomRoom()`                            | Room Durable Object が参加者、準備、ホスト、状態、接続を管理         |
| 招待コード参加   | `client.joinCustomRoom(code)`                          | Gateway がコードを解決し、Room Durable Object が参加可否を最終判定   |
| 準備・開始・退出 | `room.setReady()`、`room.startMatch()`、`room.leave()` | Room Durable Object の状態遷移と権限検証                             |
| カスタム対戦の手 | `room.send("rps.move", ...)`                           | Room WebSocket のゲームメッセージ。サンプルのカスタム対戦用          |
| ランクキュー参加 | `client.joinMatchmaking()`、`ticket.waitForMatch()`    | Match Pool Durable Object がチケット、候補、対戦Roomを管理           |
| ランク対戦の手   | `POST /v1/demo/rps/matches/:matchId/move`              | Worker が認証済み参加者、成立済みMatch、手の変更不可を検証しD1へ保存 |
| ELO表示          | `client.getRating("ranked-jp")`                        | D1 のレーティング正本から現在値を取得                                |

ランク戦のブラウザは勝敗値を送信しません。各プレイヤーの手だけをWorkerへ送り、
WorkerがMatch Poolの成立結果からA/Bプレイヤーを復元して勝敗を計算します。両者の
手が揃った後に `registerMatchResult()` をサーバー側から呼び、結果識別子を
`demo-rps-result:<matchId>` として固定します。そのため、同じ手や結果を再送しても
`applied: false` となり、ELOは二重更新されません。

## 画面で確認する導線

### 招待ルーム

1. 1つ目のブラウザで「招待ルームを作る」を押す。
2. 表示された6文字の招待コードを2つ目のブラウザへ入力する。
3. 2人が「準備する」を押し、ホストが「ホストとして開始」を押す。
4. 2人がグー、パー、チョキのいずれかを選ぶ。手はRoomの型付きゲームメッセージで同期される。

### ランク戦

1. 2つのブラウザで「ranked-jp キューへ参加」を押す。
2. チケットの状態、待機時間、検索幅を確認する。
3. 成立後、同じMatch IDの対戦Roomへ接続される。
4. 2人が手を選び、Workerの確定結果とELO更新を確認する。
5. 「同じ結果を再送（冪等性を確認）」を押し、ELOが一度だけ変化していることを確認する。

## 切断と再接続

Roomハンドルは接続状態を画面へ表示し、一時的なWebSocket切断を明示的な`leave()`と
区別します。ブラウザの開発者ツールでネットワークを一時的にオフにしてから戻すと、
Client SDKが指数バックオフと再開トークンを使って同じRoomのスナップショットへ復帰
します。再接続中にもう一方のブラウザで準備状態を変更しても、`revision`順で復元されます。

## デプロイ前の確認

このサンプルの認証Hookはローカル確認専用です。本番利用では、`src/index.ts` の
`authenticate` を実際の認証サービスへ置き換え、CloudflareのD1データベースIDと
Secretを環境ごとに設定します。ブラウザへ `FLARE_LOBBY_TOKEN_SECRET` を渡しては
いけません。

```sh
pnpm --filter @flarelobby/example-local-demo typecheck
pnpm --filter @flarelobby/example-local-demo run build:browser
pnpm --filter @flarelobby/example-local-demo exec wrangler d1 migrations apply FLARE_LOBBY_DB --remote --config wrangler.jsonc
pnpm --filter @flarelobby/example-local-demo exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET --config wrangler.jsonc
pnpm --filter @flarelobby/example-local-demo deploy
```

共有環境へ公開する前に、`wrangler.jsonc` のD1設定、認証、認可、入力制限、観測設定を
環境ごとに確認してください。ローカルサンプルのプレイヤー名Bearer認証を本番へ
持ち込まないことが必須です。
