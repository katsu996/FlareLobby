# Cloudflare 設定

`@flarelobby/cloudflare` は、1 つの `defineFlareLobby()` 設定から Gateway Worker を作成します。Room と Match Pool はそれぞれ別の Durable Object Namespace を使い、D1 は必須、Analytics Engine は任意です。

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
    const playerId = request.headers.get("x-player-id");

    return playerId === null ? null : { id: playerId, playerId };
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60
  }
});

export default flarelobby.createGatewayWorker<Env>();
export { RoomDurableObject, MatchPoolDurableObject } from "@flarelobby/cloudflare";
```

`matchmakingPools` にプールを追加する場合は、`id`、`gameId`、`seasonId`、`mode`、`region` をすべて空でない文字列にし、`id` を重複させないでください。

## Wrangler 設定

Room と Match Pool の公開クラスは Wrangler から静的に解決する必要があります。新規 Durable Object は SQLite-backed とし、`migrations` へ同じクラス名を登録します。

```jsonc
{
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "FLARE_LOBBY_ROOMS", "class_name": "RoomDurableObject" },
      { "name": "FLARE_LOBBY_MATCH_POOLS", "class_name": "MatchPoolDurableObject" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RoomDurableObject", "MatchPoolDurableObject"]
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

`FLARE_LOBBY_DB`、`FLARE_LOBBY_ROOMS`、`FLARE_LOBBY_MATCH_POOLS` は必須です。型検査時には `createGatewayWorker<Env>()` が不足を拒否し、実行時にも安全な日本語メッセージと次の安定したコードを返します。

| 不足・不正 | コード |
| --- | --- |
| D1 Binding | `D1_BINDING_MISSING` |
| Room Durable Object Binding | `ROOM_DURABLE_OBJECT_BINDING_MISSING` |
| Match Pool Durable Object Binding | `MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING` |
| カスタムルーム設定 | `INVALID_CUSTOM_ROOM_CONFIGURATION` |
| マッチングプール設定 | `INVALID_MATCHMAKING_POOL` |
| 入力制限 | `INVALID_INPUT_LIMITS` |
| 認証 Hook | `INVALID_AUTHENTICATION_HOOK` |

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

## ローカル・検証・本番

このリポジトリの `packages/cloudflare/wrangler.jsonc` は、既定環境をローカル、`env.staging` を検証、`env.production` を本番として分離しています。D1 と Durable Object Binding は Wrangler の名前付き環境で継承されないため、各環境に明示的に記載しています。本番だけ Analytics Engine を有効にしています。

本番・検証の D1 は、実リソースを作成した後に `database_id` を各環境の実際の UUID へ設定してください。この Issue では実リソースの作成・デプロイは行いません。

```sh
pnpm generate:worker-types
pnpm check:worker-types
pnpm test:integration
```

環境を指定して型を生成する場合は、`packages/cloudflare` で `wrangler types worker-configuration.d.ts --config wrangler.jsonc --env staging` のように実行します。
