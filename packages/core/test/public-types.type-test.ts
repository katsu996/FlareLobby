import type {
  ClientCommandEnvelope,
  FlareLobbyApp,
  FlareLobbyErrorCode,
  GameMessage,
  InferFlareLobbyApp,
  MatchmakingPool,
  MatchmakingTicket,
  RoomSnapshot,
  RoomState,
  RoomStatus,
  ServerEventEnvelope,
  ServerFailureEnvelope,
} from "../src/index.js";

type Equal<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <
    TValue,
  >() => TValue extends TRight ? 1 : 2
    ? true
    : false;

type Expect<TCondition extends true> = TCondition;

type ExampleSettings = {
  maxPlayers: number;
  map: "forest" | "desert";
};

type ExampleMetadata = {
  title: string;
};

type ExampleMessages = {
  move: {
    direction: "north" | "south";
  };
  emote: {
    value: "wave" | "cheer";
  };
};

type ExampleApp = FlareLobbyApp<
  ExampleSettings,
  ExampleMetadata,
  ExampleMessages
>;

const pool = {
  id: "ranked-1v1-jp",
  gameId: "example-game",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp",
} satisfies MatchmakingPool;

const snapshot: RoomSnapshot<ExampleApp> = {
  room: {
    id: "room-1",
    kind: "custom",
    invitationCode: "4F9K2D",
    visibility: "public",
    settings: {
      maxPlayers: 2,
      map: "forest",
    },
    metadata: {
      title: "練習部屋",
    },
  },
  revision: 3,
  state: {
    status: "waiting",
  },
  participants: [
    {
      kind: "player",
      id: "participant-1",
      player: {
        id: "player-1",
      },
      teamId: "blue",
      ready: false,
    },
  ],
  teams: [
    {
      id: "blue",
    },
  ],
  host: {
    participantId: "participant-1",
    playerId: "player-1",
  },
};

const matchedTicket: MatchmakingTicket<ExampleApp> = {
  id: "ticket-1",
  pool,
  player: {
    id: "player-1",
  },
  rating: {
    playerId: "player-1",
    poolId: "ranked-1v1-jp",
    value: 1500,
  },
  createdAt: "2026-08-10T00:00:00.000Z",
  status: "matched",
  matchedAt: "2026-08-10T00:01:00.000Z",
  result: {
    matchId: "match-1",
    candidate: {
      id: "candidate-1",
      pool,
      ticketIds: ["ticket-1", "ticket-2"],
      createdAt: "2026-08-10T00:00:30.000Z",
    },
    room: {
      id: "room-2",
      kind: "match",
      matchId: "match-1",
      pool,
      settings: {
        maxPlayers: 2,
        map: "forest",
      },
      metadata: {
        title: "ランク戦",
      },
    },
    createdAt: "2026-08-10T00:01:00.000Z",
  },
};

const message: GameMessage<ExampleApp> = {
  name: "move",
  payload: {
    direction: "north",
  },
};

type _appCanBeInferredFromSnapshot = Expect<
  Equal<InferFlareLobbyApp<typeof snapshot>, ExampleApp>
>;

type _appCanBeInferredFromTicket = Expect<
  Equal<InferFlareLobbyApp<typeof matchedTicket>, ExampleApp>
>;

type _appCanBeInferredFromMessage = Expect<
  Equal<InferFlareLobbyApp<typeof message>, ExampleApp>
>;

declare const readonlySnapshot: RoomSnapshot<ExampleApp>;

// @ts-expect-error スナップショットの配列は読み取り専用です。
readonlySnapshot.participants.push({
  kind: "spectator",
  id: "participant-2",
  player: {
    id: "player-2",
  },
});

// @ts-expect-error ルーム設定は読み取り専用です。
readonlySnapshot.room.settings.map = "desert";

// @ts-expect-error 終了済み状態には finishedAt が必要です。
const _invalidFinishedState: RoomState = {
  status: "finished",
};

// @ts-expect-error ルーム状態には存在しない値です。
const _invalidRoomStatus: RoomStatus = "cancelled";

// @ts-expect-error 成立済みチケットには結果が必要です。
const invalidMatchedTicket: MatchmakingTicket<ExampleApp> = {
  id: "ticket-1",
  pool,
  player: {
    id: "player-1",
  },
  rating: {
    playerId: "player-1",
    poolId: "ranked-1v1-jp",
    value: 1500,
  },
  createdAt: "2026-08-10T00:00:00.000Z",
  status: "matched",
  matchedAt: "2026-08-10T00:01:00.000Z",
};

const invalidMessageName: GameMessage<ExampleApp> = {
  // @ts-expect-error 定義されていないゲーム固有メッセージです。
  name: "teleport",
  payload: {
    direction: "north",
  },
};

const invalidMessagePayload: GameMessage<ExampleApp> = {
  name: "move",
  payload: {
    // @ts-expect-error move の Payload に数値の direction は指定できません。
    direction: 1,
  },
};

const protocolCommand: ClientCommandEnvelope<
  "room.set_ready",
  { ready: boolean }
> = {
  protocolVersion: 1,
  kind: "command",
  requestId: "request-1",
  command: "room.set_ready",
  payload: {
    ready: true,
  },
};

const protocolEvent: ServerEventEnvelope<"room.snapshot", { roomId: string }> =
  {
    protocolVersion: 1,
    kind: "event",
    event: "room.snapshot",
    revision: 4,
    payload: {
      roomId: "room-1",
    },
  };

const protocolFailure: ServerFailureEnvelope = {
  protocolVersion: 1,
  kind: "failure",
  requestId: "request-1",
  error: {
    code: "ROOM_FULL",
    message: "ルームは満員です。",
  },
};

const knownErrorCode: FlareLobbyErrorCode = "CANCELLED";

// @ts-expect-error イベントには状態変化後の revision が必要です。
const invalidProtocolEvent: ServerEventEnvelope = {
  protocolVersion: 1,
  kind: "event",
  event: "room.snapshot",
  payload: null,
};

// @ts-expect-error 公開エラーコード以外は指定できません。
const invalidErrorCode: FlareLobbyErrorCode = "INTERNAL_ERROR";

void message;
void invalidMatchedTicket;
void invalidMessageName;
void invalidMessagePayload;
void protocolCommand;
void protocolEvent;
void protocolFailure;
void knownErrorCode;
void invalidProtocolEvent;
void invalidErrorCode;
