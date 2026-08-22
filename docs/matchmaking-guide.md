# マッチメイキング利用ガイド

FlareLobby の v0.1.0 マッチングは、同じ Pool の 2 枚のチケットを 1 対 1 で成立
させ、対戦 Room への接続情報を返します。候補探索は `@flarelobby/core` の純粋
関数、永続状態と競合制御は Match Pool Durable Object が担当します。

## Pool を設定する

Gateway の設定で、`id`、`gameId`、`seasonId`、`mode`、`region` がすべて一致する
Pool を定義します。`id` は Client SDK が参照する公開識別子です。

```ts
import { defineFlareLobby } from "@flarelobby/cloudflare";

const lobby = defineFlareLobby({
  customRooms: { maxPlayers: 4, defaultSettings: { map: "forest" } },
  matchmakingPools: [
    {
      id: "ranked-jp",
      gameId: "example-game",
      seasonId: "season-1",
      mode: "ranked-1v1",
      region: "jp",
      searchPolicy: {
        stages: [
          { afterMs: 0, maxRatingDifference: 75 },
          { afterMs: 20_000, maxRatingDifference: 150 },
          { afterMs: 60_000, maxRatingDifference: 400 },
        ],
      },
      matchRoom: {
        settings: { map: "forest" },
        metadata: { playlist: "ranked" },
        teamIds: ["blue", "red"],
        maxPlayers: 2,
        minimumPlayers: 2,
        requireAllPlayersReady: false,
      },
      rating: { initialRating: 1_500, kFactor: 24 },
    },
  ],
  authenticate,
  inputLimits,
});
```

検索幅の既定値は待機開始時 `75`、20 秒後 `150`、60 秒後 `400` です。候補は
同じ Pool・リージョン、別プレイヤー、両チケットの検索幅以内のレート差である
必要があります。入力方式の違いは候補品質へ記録されますが、成立不可条件では
ありません。

## チケットを待つ

```ts
const ticket = await client.joinMatchmaking("ranked-jp", {
  // 省略すると D1 のこの主体の最新値を使用します。
  rating: 1_500,
  region: "jp",
  inputMethod: "keyboard_mouse",
  ttlMs: 60_000,
});

const stop = ticket.on("progress", (progress) => {
  renderQueue({
    status: progress.ticket.status,
    waitingTimeMs: progress.waitingTimeMs,
    searchWidth: progress.searchWidth,
    waitingCount: progress.waitingCount,
  });
});

const room = await ticket.waitForMatch();
stop();
```

チケットの状態は `creating → waiting → reserved → matched`、または
`waiting → cancelled/expired` です。`matched` になると `ticket.result` に
`matchId`、候補、対戦 Room が入り、`waitForMatch()` は参加・WebSocket 接続・初期
同期済みの `PlayerRoom` を返します。

チケットの公開状態は `snapshot`、`status`、`waitingTimeMs`、`searchWidth` から
読み取れます。`refresh()` は D1 やローカルキャッシュではなく、Match Pool の
現在状態を確認します。

## 短縮 API、キャンセル、再接続

```ts
const room = await client.findMatch("ranked-jp", {
  signal: abortController.signal,
  reconnect: { maxAttempts: 5 },
});

const ticket = await client.joinMatchmaking("ranked-jp");
await ticket.cancel({ requestId: "cancel-1" });
```

`findMatch()` はチケット作成から成立待機までをまとめた API です。`cancel()` は
サーバー側の終端状態を確認してからローカル状態を更新し、成立との競合でも終端
通知を二重に行いません。`AbortSignal` による待機取消もサーバー側キャンセルへ
連動します。通信が一時切断しても、最後のイベント sequence から既存チケットを
再取得します。明示的なキャンセル後は再接続しません。

## ELO と試合結果

現在の Pool/Season のレーティングは Client SDK から取得できます。

```ts
const rating = await client.getRating("ranked-jp");
console.log(rating.value);
```

標準 ELO は初期値 `1500`、K 係数 `24`、期待勝率
`1 / (1 + 10 ** ((ratingB - ratingA) / 400))` を使います。A 側の `result` は
勝利 `1`、引き分け `0.5`、敗北 `0` です。差分は最近整数へ丸め、B 側へ正負反対
の差分を適用します。詳細は [レーティングエンジン](./rating.md) を参照して
ください。

試合結果登録は一般プレイヤーが任意に呼ぶ操作ではありません。サーバー側の認可
Hook が許可した処理だけが次の API を通過します。

```http
POST /v1/matchmaking/pools/ranked-jp/matches/<matchId>/result
Content-Type: application/json

{"resultId":"server-result-1","result":1}
```

本文に `playerAId` や `playerBId` を含めても採用されません。Gateway は成立済み
Match Pool のチケットから参加者を復元し、`matchId`、`resultId`、A 側結果を使って
認可済みの試合だけを D1 へ登録します。応答の `applied` が `false` の場合は同じ
結果の再送で、レーティングを再計算していません。

## イベント接続

チケットイベントは Client SDK が管理します。低レベル接続が必要なときは次の
エンドポイントを使います。

```text
GET /v1/matchmaking/pools/{poolId}/tickets/{ticketId}/events
GET /v1/matchmaking/pools/{poolId}/tickets/{ticketId}/events/ws
GET /v1/matchmaking/pools/{poolId}/tickets/{ticketId}/connection
```

イベントの `sequence` は Pool 全体で採番されます。チケット単位で読み取ると数値
が飛ぶことがあります。接続用 URL は `matched` 状態のチケットだけに返され、返却
された `joinToken` を WebSocket の認証用 subprotocol へ渡します。

## 期限と整合性

Pool Durable Object は期限または次の検索幅切り替え時刻だけを、Pool ごとの単一
Alarm に登録します。SQLite が状態の正本なので、Durable Object の休眠・再生成後も
未完了チケットと成立意図を復元できます。同じチケットを複数の候補へ確保せず、
成立 Room の初期化が完了してから `matched` を通知します。

## 関連文書

- [マッチングプール、候補探索、チケット](./match-pool.md)
- [レーティングエンジン](./rating.md)
- [JSON 通信プロトコル v1](./protocol.md)
- [アーキテクチャ](./architecture.md)
