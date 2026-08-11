# Cloudflare 設定

`@flarelobby/cloudflare` は、1 つの `defineFlareLobby()` 設定から Gateway Worker を作成します。Room、Match Pool、利用制限はそれぞれ別の Durable Object Namespace を使い、D1 とトークン秘密値は必須、Analytics Engine は任意です。

## 最小設定

`Env` は手書きせず、Wrangler で生成します。次の例は `packages/cloudflare/test/configuration.type-test.ts` と同じ構成で型検査しています。

```ts
import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";

type GameApp = FlareLobbyApp<
  { maxPlayers: number; map: "forest" | "desert" },
  { title: string },
  {}
>;

const flarelobby = defineFlareLobby<GameApp>({
  customRooms: {
    maxPlayers: 4,
    defaultSettings: {
      maxPlayers: 4,
      map: "forest"
    }
  },
  matchmakingPools: [],
  authenticate: async (request) => {
    const account = await verifyApplicationAccessToken(
      request.headers.get("authorization")
    );

    return account === null
      ? null
      : { id: account.subjectId, playerId: account.gamePlayerId };
  },
  authorization: {
    authorizeJoin: ({ principal, roomId }) =>
      principal.id.startsWith("player-") &&
      roomId !== undefined &&
      roomId.length > 0,
    authorizeSpectate: () => true,
    authorizeHostOperation: () => false,
    authorizeMatchResult: () => false
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
});

export default flarelobby.createGatewayWorker<Env>();
export {
  RoomDurableObject,
  MatchPoolDurableObject,
  RateLimitDurableObject
} from "@flarelobby/cloudflare";
```

`matchmakingPools` にプールを追加する場合は、`id`、`gameId`、`seasonId`、`mode`、`region` をすべて空でない文字列にし、`id` を重複させないでください。候補探索の `searchPolicy` は任意で、未指定時は待機開始時 `75`、20 秒後 `150`、60 秒後 `400` の検索幅を使用します。

## Wrangler 設定

Room、Match Pool、利用制限の公開クラスは Wrangler から静的に解決する必要があります。新規 Durable Object は SQLite-backed とし、`migrations` へ同じクラス名を登録します。

```jsonc
{
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "FLARE_LOBBY_ROOMS", "class_name": "RoomDurableObject" },
      { "name": "FLARE_LOBBY_MATCH_POOLS", "class_name": "MatchPoolDurableObject" },
      { "name": "FLARE_LOBBY_RATE_LIMITS", "class_name": "RateLimitDurableObject" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RoomDurableObject", "MatchPoolDurableObject"]
    },
    {
      "tag": "v2",
      "new_sqlite_classes": ["RateLimitDurableObject"]
    }
  ],
  "d1_databases": [
    {
      "binding": "FLARE_LOBBY_DB",
      "database_name": "your-flarelobby-database",
      "database_id": "D1 の UUID"
    }
  ]
}
```

`FLARE_LOBBY_DB`、`FLARE_LOBBY_ROOMS`、`FLARE_LOBBY_MATCH_POOLS`、`FLARE_LOBBY_RATE_LIMITS`、`FLARE_LOBBY_TOKEN_SECRET` は必須です。`wrangler types` が生成する `Env` を `createGatewayWorker<Env>()` に渡すことで、これらの Binding を型検査時に要求します。既存の設定検証で返す安定したコードは次のとおりです。

| 不足・不正 | コード |
| --- | --- |
| D1 Binding | `D1_BINDING_MISSING` |
| Room Durable Object Binding | `ROOM_DURABLE_OBJECT_BINDING_MISSING` |
| Match Pool Durable Object Binding | `MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING` |
| カスタムルーム設定 | `INVALID_CUSTOM_ROOM_CONFIGURATION` |
| マッチングプール設定 | `INVALID_MATCHMAKING_POOL` |
| 入力制限 | `INVALID_INPUT_LIMITS` |
| 認証 Hook | `INVALID_AUTHENTICATION_HOOK` |

`customRooms.finishedRoomRetentionMs` を指定すると、終了済み Room を SQLite から削除するまでの保持期間（ミリ秒）を変更できます。省略時は `DEFAULT_FINISHED_ROOM_RETENTION_MS`（24 時間）です。0 を指定した Room は終了後すぐに削除対象となります。

再接続を使う場合は、次の `customRooms` 設定で保持期間と履歴容量を調整できます。省略時は、再開トークン 30 分、切断猶予 30 秒、状態イベント履歴 128 件、処理済みコマンド結果 10 分です。

```ts
customRooms: {
  maxPlayers: 4,
  defaultSettings: { maxPlayers: 4, map: "forest" },
  resumeTokenTtlMs: 30 * 60 * 1_000,
  disconnectGracePeriodMs: 30 * 1_000,
  eventHistoryLimit: 128,
  processedCommandRetentionMs: 10 * 60 * 1_000
}
```

## Room Durable Object の永続状態

`FLARE_LOBBY_ROOMS.getByName(room.id)` は同じ `room.id` に対して常に同じ Room Durable Object を返します。`initialize()` は Room 本体、参加者、チームを SQLite へ一度だけ保存し、同じ初期化要求を再実行した場合は保存済みの `RoomSnapshot` を返します。

```ts
const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
const snapshot = await room.initialize({
  room: {
    id: roomId,
    kind: "custom",
    invitationCode: "4F9K2D",
    visibility: "unlisted",
    settings: { map: "forest" },
    metadata: { title: "練習ルーム" }
  },
  host: {
    participantId: "participant-1",
    playerId: "player-1"
  },
  participants: [
    {
      kind: "player",
      id: "participant-1",
      player: { id: "player-1" },
      teamId: null,
      ready: false
    }
  ],
  minimumPlayers: 2,
  requireAllPlayersReady: true,
  finishedRoomRetentionMs: 24 * 60 * 60 * 1_000
});

await room.transition({ status: "preparing" });
await room.transition({ status: "in_progress" });
await room.transition({ status: "finished" });
```

状態は `waiting → preparing → in_progress → finished`、または `waiting → finished` のみを許可します。`RoomSnapshot.revision` は成功した状態変更ごとに増加し、終了済み Room は別状態へ戻せません。期限処理は SQLite に保存され、Room ごとに最も近い期限を単一 Alarm へ設定して順に処理します。

`minimumPlayers` の既定値は `maxPlayers`、`requireAllPlayersReady` の既定値は `true` です。Gateway が発行した `gatewayPrincipal` を添えて Room RPC を呼ぶと、参加者本人の `setReady()`、`selectTeam()` と、ホスト専用の `updateSettings()`、`transferHost()`、`kick()`、`startMatch()`、`close()` を利用できます。各成功操作は最新の `RoomSnapshot` を返し、`requestId` を指定した再送は保存済み結果へ収束します。ホストの明示的な `leave()` は参加時刻が最も古いプレイヤーへ移譲され、移譲先がない場合は Room を閉鎖します。通信切断だけでは退出やホスト移譲を発生させません。

Analytics Engine は `FLARE_LOBBY_ANALYTICS` という任意 Binding です。設定しない最小構成でも Worker は起動します。設定する場合だけ、次を環境の `wrangler.jsonc` へ追加してください。

```jsonc
{
  "analytics_engine_datasets": [
    {
      "binding": "FLARE_LOBBY_ANALYTICS",
      "dataset": "flarelobby-production"
    }
  ]
}
```

## トークン秘密値

`FLARE_LOBBY_TOKEN_SECRET` は参加用、再開用、および Gateway から Durable Object へ渡す内部主体証明の HMAC 署名にだけ使います。値は `wrangler.jsonc`、ソースコード、Pull Request に書かず、各環境へ Wrangler Secret として登録してください。

```sh
pnpm --filter @flarelobby/cloudflare exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET
pnpm --filter @flarelobby/cloudflare exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET --env staging
pnpm --filter @flarelobby/cloudflare exec wrangler secret put FLARE_LOBBY_TOKEN_SECRET --env production
```

このリポジトリの `wrangler.jsonc` は `secrets.required` に名前だけを宣言しており、`wrangler types` が生成する `Env` に `string` Binding を反映します。ローカル開発では、コミットしない `packages/cloudflare/.dev.vars` へ同名の値を設定してください。

## ローカル・検証・本番

このリポジトリの `packages/cloudflare/wrangler.jsonc` は、既定環境をローカル、`env.staging` を検証、`env.production` を本番として分離しています。D1、Durable Object Binding、`secrets.required` は Wrangler の名前付き環境で継承されないため、各環境に明示的に記載しています。本番だけ Analytics Engine を有効にしています。

本番・検証の D1 は、実リソースを作成した後に `database_id` を各環境の実際の UUID へ設定してください。この Issue では実リソースの作成・デプロイは行いません。

```sh
pnpm generate:worker-types
pnpm check:worker-types
pnpm test:integration
```

環境を指定して型を生成する場合は、`packages/cloudflare` で `wrangler types worker-configuration.d.ts --config wrangler.jsonc --env staging` のように実行します。
