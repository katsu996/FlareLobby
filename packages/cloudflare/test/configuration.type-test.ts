import type { FlareLobbyApp } from "@flarelobby/core";

import { defineFlareLobby } from "../src/index.js";
import type { FlareLobbyBindings } from "../src/index.js";

type Equal<TLeft, TRight> = (<TValue>() => TValue extends TLeft ? 1 : 2) extends <
  TValue,
>() => TValue extends TRight ? 1 : 2
  ? true
  : false;

type Expect<TCondition extends true> = TCondition;

type ExampleApp = FlareLobbyApp<
  {
    maxPlayers: number;
    map: "forest" | "desert";
  },
  {
    title: string;
  },
  {}
>;

const minimumConfiguration = defineFlareLobby<ExampleApp>({
  customRooms: {
    maxPlayers: 2,
    defaultSettings: {
      maxPlayers: 2,
      map: "forest"
    }
  },
  matchmakingPools: [],
  authenticate: () => null,
  inputLimits: {
    maxHttpRequestBytes: 4 * 1024,
    maxWebSocketMessageBytes: 2 * 1024,
    maxMessagesPerMinute: 30,
    maxRoomCreationsPerMinute: 5
  }
});

const fullConfiguration = defineFlareLobby<ExampleApp>({
  customRooms: {
    maxPlayers: 4,
    defaultSettings: {
      maxPlayers: 4,
      map: "desert"
    }
  },
  matchmakingPools: [
    {
      id: "ranked-1v1-jp",
      gameId: "example-game",
      seasonId: "season-1",
      mode: "ranked-1v1",
      region: "jp"
    }
  ],
  authenticate: async () => ({
    id: "principal-1",
    playerId: "player-1"
  }),
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
});

const minimalWorker = minimumConfiguration.createGatewayWorker<Env>();
const fullWorker = fullConfiguration.createGatewayWorker<Env>();

type _generatedEnvSatisfiesBindingContract = Expect<
  Equal<Env extends FlareLobbyBindings ? true : false, true>
>;

type EnvWithoutD1 = Omit<Env, "FLARE_LOBBY_DB">;

// @ts-expect-error D1 Binding を持たない Env では Gateway Worker を生成できません。
minimumConfiguration.createGatewayWorker<EnvWithoutD1>();

const invalidSettings = defineFlareLobby<ExampleApp>({
  customRooms: {
    maxPlayers: 2,
    defaultSettings: {
      maxPlayers: 2,
      // @ts-expect-error アプリケーション定義にない map 値です。
      map: "ocean"
    }
  },
  matchmakingPools: [],
  authenticate: () => null,
  inputLimits: {
    maxHttpRequestBytes: 4 * 1024,
    maxWebSocketMessageBytes: 2 * 1024,
    maxMessagesPerMinute: 30,
    maxRoomCreationsPerMinute: 5
  }
});

void minimalWorker;
void fullWorker;
void invalidSettings;
