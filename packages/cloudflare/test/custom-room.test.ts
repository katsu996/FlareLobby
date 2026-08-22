import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  authenticateGatewayRequest,
  defineFlareLobby,
  RoomDurableObject,
} from "../src/index.js";

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 8,
    defaultSettings: { map: "forest", mode: "casual" },
    finishedRoomRetentionMs: 60_000,
  },
  matchmakingPools: [],
  authenticate: (request) => {
    const id = request.headers.get("x-test-principal") ?? "principal-create";

    return {
      id,
      playerId: `${id}-player`,
    };
  },
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true,
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10,
  },
});

const testWorker = testLobby.createGatewayWorker<Env>();

function createRequest(
  body: unknown,
  principalId = `principal-${crypto.randomUUID()}`,
): Request {
  return new Request("https://example.test/v1/custom-rooms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-principal": principalId,
    },
    body: JSON.stringify(body),
  });
}

function operationRequest(
  path: string,
  body: unknown,
  principalId: string,
): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-principal": principalId,
    },
    body: JSON.stringify(body),
  });
}

async function createRoom(
  body: unknown,
  principalId?: string,
  customEnv: Env = env,
): Promise<Response> {
  const request = createRequest(body, principalId) as unknown as Parameters<
    typeof testWorker.fetch
  >[0];

  return testWorker.fetch(request, customEnv, {} as ExecutionContext);
}

async function joinRoom(
  body: unknown,
  principalId: string,
  path = "/v1/custom-rooms/join",
): Promise<Response> {
  return testWorker.fetch(
    operationRequest(path, body, principalId) as unknown as Parameters<
      typeof testWorker.fetch
    >[0],
    env,
    {} as ExecutionContext,
  );
}

async function leaveRoom(
  body: unknown,
  principalId: string,
  path = "/v1/custom-rooms/leave",
): Promise<Response> {
  return testWorker.fetch(
    operationRequest(path, body, principalId) as unknown as Parameters<
      typeof testWorker.fetch
    >[0],
    env,
    {} as ExecutionContext,
  );
}

describe("カスタムルーム作成 Gateway", () => {
  it("未認証要求を作成処理へ到達させない", async () => {
    const response = await SELF.fetch("https://example.test/v1/custom-rooms", {
      method: "POST",
      body: JSON.stringify({ requestId: crypto.randomUUID() }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
      message: "認証が必要です。",
    });
  });

  it("既定値で作成し、認証主体をホスト兼プレイヤーとして返す", async () => {
    const principalId = `principal-default-${crypto.randomUUID()}`;
    const response = await createRoom(
      { requestId: `request-default-${crypto.randomUUID()}` },
      principalId,
    );
    const result = await response.json<{
      roomId: string;
      invitationCode: string | null;
      joinMethod: string;
      joinToken: string;
      websocketUrl: string;
      snapshot: {
        room: {
          kind: string;
          metadata: { name: string };
          settings: { map: string; mode: string };
        };
        host: { playerId: string };
        participants: readonly { kind: string; player: { id: string } }[];
      };
    }>();

    expect(response.status).toBe(201);
    expect(result.roomId).toMatch(/^room_/u);
    expect(result.invitationCode).toBeNull();
    expect(result.joinMethod).toBe("public");
    expect(result.joinToken).toContain(".");
    expect(result.websocketUrl).toBe(
      `wss://example.test/v1/custom-rooms/${encodeURIComponent(result.roomId)}/ws`,
    );
    expect(result.snapshot.room).toMatchObject({
      kind: "custom",
      metadata: { name: "ルーム" },
      settings: { map: "forest", mode: "casual" },
    });
    expect(result.snapshot.host).toEqual({
      participantId: `participant-${result.roomId}`,
      playerId: `${principalId}-player`,
    });
    expect(result.snapshot.participants).toEqual([
      {
        kind: "player",
        id: `participant-${result.roomId}`,
        player: { id: `${principalId}-player` },
        teamId: null,
        ready: false,
      },
    ]);
  });

  it("全設定を検証し、招待方式では招待コードを返す", async () => {
    const response = await createRoom({
      requestId: `request-invitation-${crypto.randomUUID()}`,
      name: "招待ルーム",
      visibility: "unlisted",
      joinMethod: "invitation",
      maxPlayers: 2,
      maxSpectators: 3,
      settings: { map: "desert", rules: { friendlyFire: false } },
    });
    const result = await response.json<{
      roomId: string;
      invitationCode: string | null;
      joinMethod: string;
      snapshot: {
        room: {
          visibility: string;
          settings: unknown;
          metadata: unknown;
        };
      };
    }>();

    expect(response.status).toBe(201);
    expect(result.joinMethod).toBe("invitation");
    expect(result.invitationCode).toMatch(/^[A-Z2-9]{6}$/u);
    expect(result.snapshot.room).toMatchObject({
      visibility: "unlisted",
      settings: { map: "desert", rules: { friendlyFire: false } },
      metadata: { name: "招待ルーム" },
    });

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(result.roomId),
      (_instance: RoomDurableObject, state) => {
        const row = state.storage.sql
          .exec<{
            maxSpectators: number;
            joinMethod: string;
          }>(
            "SELECT max_spectators AS maxSpectators, join_method AS joinMethod FROM flarelobby_rooms",
          )
          .one();

        expect(row).toEqual({ maxSpectators: 3, joinMethod: "invitation" });
      },
    );
  });

  it("同じ requestId の同時再送を1ルーム1結果へ収束させる", async () => {
    const principalId = `principal-concurrent-${crypto.randomUUID()}`;
    const body = {
      requestId: `request-concurrent-${crypto.randomUUID()}`,
      name: "同時作成",
      maxPlayers: 2,
      maxSpectators: 1,
      settings: { map: "forest" },
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => createRoom(body, principalId)),
    );
    const results = await Promise.all(
      responses.map((response) =>
        response.json<{ roomId: string; joinToken: string }>(),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 201,
    ]);
    expect(new Set(results.map((result) => result.roomId)).size).toBe(1);
    expect(new Set(results.map((result) => result.joinToken)).size).toBe(1);

    const roomId = results[0]?.roomId;

    if (roomId === undefined) {
      throw new Error("Room ID が返されていません。");
    }

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(roomId),
      (_instance: RoomDurableObject, state) => {
        const roomCount = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_rooms",
          )
          .one().count;
        const participantCount = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_room_participants",
          )
          .one().count;
        const commandCount = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_processed_commands",
          )
          .one().count;

        expect(roomCount).toBe(1);
        expect(participantCount).toBe(1);
        expect(commandCount).toBe(1);
      },
    );
  });

  it("同じ requestId の異なる作成条件を競合として拒否する", async () => {
    const principalId = `principal-conflict-${crypto.randomUUID()}`;
    const requestId = `request-conflict-${crypto.randomUUID()}`;

    await expect(
      createRoom({ requestId, name: "最初のルーム" }, principalId).then(
        (response) => response.status,
      ),
    ).resolves.toBe(201);

    const response = await createRoom(
      { requestId, name: "別のルーム" },
      principalId,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("公開参加と観戦参加を別枠で判定する", async () => {
    const ownerId = `principal-capacity-owner-${crypto.randomUUID()}`;
    const createdResponse = await createRoom(
      {
        requestId: `request-capacity-${crypto.randomUUID()}`,
        maxPlayers: 2,
        maxSpectators: 2,
      },
      ownerId,
    );
    const created = await createdResponse.json<{ roomId: string }>();

    const spectatorResponses = await Promise.all([
      joinRoom(
        {
          requestId: `request-spectator-1-${crypto.randomUUID()}`,
          roomId: created.roomId,
          role: "spectator",
        },
        `principal-spectator-1-${crypto.randomUUID()}`,
      ),
      joinRoom(
        {
          requestId: `request-spectator-2-${crypto.randomUUID()}`,
          roomId: created.roomId,
          role: "spectator",
        },
        `principal-spectator-2-${crypto.randomUUID()}`,
      ),
    ]);

    expect(spectatorResponses.map((response) => response.status)).toEqual([
      200, 200,
    ]);

    const playerResponse = await joinRoom(
      {
        requestId: `request-player-${crypto.randomUUID()}`,
        roomId: created.roomId,
        role: "player",
      },
      `principal-player-${crypto.randomUUID()}`,
    );
    expect(playerResponse.status).toBe(200);

    const fullSpectatorResponse = await joinRoom(
      {
        requestId: `request-spectator-full-${crypto.randomUUID()}`,
        roomId: created.roomId,
        role: "spectator",
      },
      `principal-spectator-full-${crypto.randomUUID()}`,
    );
    expect(fullSpectatorResponse.status).toBe(400);
    await expect(fullSpectatorResponse.json()).resolves.toMatchObject({
      code: "ROOM_FULL",
    });

    const fullPlayerResponse = await joinRoom(
      {
        requestId: `request-player-full-${crypto.randomUUID()}`,
        roomId: created.roomId,
        role: "player",
      },
      `principal-player-full-${crypto.randomUUID()}`,
    );
    expect(fullPlayerResponse.status).toBe(400);
    await expect(fullPlayerResponse.json()).resolves.toMatchObject({
      code: "ROOM_FULL",
    });
  });

  it("同時参加でもプレイヤー定員を超えず、同じ参加要求は冪等になる", async () => {
    const createdResponse = await createRoom({
      requestId: `request-concurrent-join-room-${crypto.randomUUID()}`,
      maxPlayers: 3,
    });
    const created = await createdResponse.json<{ roomId: string }>();
    const concurrentResponses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        joinRoom(
          {
            requestId: `request-capacity-${index}-${crypto.randomUUID()}`,
            roomId: created.roomId,
            role: "player",
          },
          `principal-capacity-${index}-${crypto.randomUUID()}`,
        ),
      ),
    );

    expect(
      concurrentResponses.filter((response) => response.status === 200),
    ).toHaveLength(2);
    expect(
      concurrentResponses.filter((response) => response.status === 400),
    ).toHaveLength(2);
    for (const response of concurrentResponses.filter(
      (candidate) => candidate.status === 400,
    )) {
      await expect(response.json()).resolves.toMatchObject({
        code: "ROOM_FULL",
      });
    }

    const duplicateRoomResponse = await createRoom({
      requestId: `request-duplicate-join-room-${crypto.randomUUID()}`,
      maxPlayers: 3,
    });
    const duplicateRoom = await duplicateRoomResponse.json<{
      roomId: string;
    }>();
    const duplicatePrincipal = `principal-duplicate-join-${crypto.randomUUID()}`;
    const duplicateRequestId = `request-duplicate-join-${crypto.randomUUID()}`;
    const duplicateResponses = await Promise.all(
      Array.from({ length: 3 }, () =>
        joinRoom(
          {
            requestId: duplicateRequestId,
            roomId: duplicateRoom.roomId,
            role: "player",
          },
          duplicatePrincipal,
        ),
      ),
    );
    const duplicateResults = await Promise.all(
      duplicateResponses.map((response) =>
        response.json<{ participantId: string; joinToken: string }>(),
      ),
    );

    expect(duplicateResponses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(
      new Set(duplicateResults.map((result) => result.participantId)),
    ).toHaveLength(1);
    expect(
      new Set(duplicateResults.map((result) => result.joinToken)),
    ).toHaveLength(1);

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(created.roomId),
      (_instance: RoomDurableObject, state) => {
        const playerCount = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_room_participants WHERE kind = 'player'",
          )
          .one().count;
        expect(playerCount).toBe(3);
      },
    );
  });

  it("不正な役割を参加処理へ渡さない", async () => {
    const createdResponse = await createRoom({
      requestId: `request-invalid-role-room-${crypto.randomUUID()}`,
    });
    const created = await createdResponse.json<{ roomId: string }>();
    const response = await joinRoom(
      {
        requestId: `request-invalid-role-${crypto.randomUUID()}`,
        roomId: created.roomId,
        role: "admin",
      },
      `principal-invalid-role-${crypto.randomUUID()}`,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("招待コードから解決し、パスワードはハッシュだけを保存して検証する", async () => {
    const invitationResponse = await createRoom({
      requestId: `request-invitation-join-${crypto.randomUUID()}`,
      joinMethod: "invitation",
      maxPlayers: 2,
    });
    const invitationRoom = await invitationResponse.json<{
      roomId: string;
      invitationCode: string;
    }>();

    const invited = await joinRoom(
      {
        requestId: `request-invited-${crypto.randomUUID()}`,
        invitationCode: invitationRoom.invitationCode,
      },
      `principal-invited-${crypto.randomUUID()}`,
    );
    expect(invited.status).toBe(200);

    const invalidInvitation = await joinRoom(
      {
        requestId: `request-invalid-invitation-${crypto.randomUUID()}`,
        invitationCode: "AAAAAA",
      },
      `principal-invalid-invitation-${crypto.randomUUID()}`,
    );
    expect(invalidInvitation.status).toBe(403);

    const password = `pw-${crypto.randomUUID()}`;
    const passwordResponse = await createRoom({
      requestId: `request-password-join-${crypto.randomUUID()}`,
      joinMethod: "password",
      password,
      maxPlayers: 2,
    });
    const passwordRoom = await passwordResponse.json<{ roomId: string }>();

    const wrongPassword = await joinRoom(
      {
        requestId: `request-wrong-password-${crypto.randomUUID()}`,
        roomId: passwordRoom.roomId,
        password: "wrong-password",
      },
      `principal-wrong-password-${crypto.randomUUID()}`,
    );
    expect(wrongPassword.status).toBe(403);

    const correctPassword = await joinRoom(
      {
        requestId: `request-correct-password-${crypto.randomUUID()}`,
        roomId: passwordRoom.roomId,
        password,
      },
      `principal-correct-password-${crypto.randomUUID()}`,
    );
    expect(correctPassword.status).toBe(200);

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(passwordRoom.roomId),
      (_instance: RoomDurableObject, state) => {
        const row = state.storage.sql
          .exec<{
            salt: string | null;
            hash: string | null;
          }>(
            "SELECT join_password_salt AS salt, join_password_hash AS hash FROM flarelobby_rooms",
          )
          .one();
        expect(row.salt).toBeTruthy();
        expect(row.hash).toBeTruthy();
        expect(JSON.stringify(row)).not.toContain(password);
      },
    );
  });

  it("明示退出で準備状態を破棄し、通信切断だけでは参加者を削除しない", async () => {
    const ownerId = `principal-leave-owner-${crypto.randomUUID()}`;
    const guestId = `principal-leave-guest-${crypto.randomUUID()}`;
    const createdResponse = await createRoom(
      {
        requestId: `request-leave-room-${crypto.randomUUID()}`,
        maxPlayers: 3,
      },
      ownerId,
    );
    const created = await createdResponse.json<{ roomId: string }>();
    const joinedResponse = await joinRoom(
      {
        requestId: `request-leave-join-${crypto.randomUUID()}`,
        roomId: created.roomId,
      },
      guestId,
    );
    const joined = await joinedResponse.json<{
      participantId: string;
      role: "player";
      joinToken: string;
      snapshot: { revision: number };
    }>();

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(created.roomId),
      (_instance: RoomDurableObject, state) => {
        state.storage.sql.exec(
          "UPDATE flarelobby_room_participants SET team_id = 'red', ready = 1 WHERE participant_id = ?",
          joined.participantId,
        );
      },
    );

    const authenticated = await authenticateGatewayRequest(
      new Request("https://example.test/rooms"),
      () => ({ id: guestId, playerId: `${guestId}-player` }),
      env.FLARE_LOBBY_TOKEN_SECRET,
    );
    if (!authenticated.ok) {
      throw authenticated.error;
    }
    const disconnected = await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(created.roomId),
      (instance: RoomDurableObject) =>
        instance.disconnect({
          gatewayPrincipal: authenticated.value.gatewayPrincipal,
          participantId: joined.participantId,
          role: "player",
        }),
    );
    expect(
      disconnected.participants.some(
        (participant) => participant.id === joined.participantId,
      ),
    ).toBe(true);

    const leaveBody = {
      requestId: `request-leave-${crypto.randomUUID()}`,
      roomId: created.roomId,
      participantId: joined.participantId,
      role: "player",
      joinToken: joined.joinToken,
    } as const;
    const leaveResponse = await leaveRoom(leaveBody, guestId);
    const left = await leaveResponse.json<{
      participantId: string;
      snapshot: {
        revision: number;
        participants: readonly { id: string }[];
      };
    }>();
    expect(leaveResponse.status).toBe(200);
    expect(left.participantId).toBe(joined.participantId);
    expect(left.snapshot.revision).toBe(joined.snapshot.revision + 1);
    expect(
      left.snapshot.participants.some(
        (participant) => participant.id === joined.participantId,
      ),
    ).toBe(false);

    const duplicateLeaveResponse = await leaveRoom(leaveBody, guestId);
    expect(duplicateLeaveResponse.status).toBe(200);
    await expect(duplicateLeaveResponse.json()).resolves.toEqual(left);

    const rejoinedResponse = await joinRoom(
      {
        requestId: `request-rejoin-${crypto.randomUUID()}`,
        roomId: created.roomId,
      },
      guestId,
    );
    const rejoined = await rejoinedResponse.json<{
      participantId: string;
      snapshot: {
        participants: readonly {
          id: string;
          teamId: string | null;
          ready: boolean;
        }[];
      };
    }>();
    expect(rejoinedResponse.status).toBe(200);
    expect(rejoined.participantId).not.toBe(joined.participantId);
    expect(
      rejoined.snapshot.participants.find(
        (participant) => participant.id === rejoined.participantId,
      ),
    ).toMatchObject({ teamId: null, ready: false });

    const oldTokenResponse = await leaveRoom(
      {
        requestId: `request-old-token-${crypto.randomUUID()}`,
        roomId: created.roomId,
        participantId: joined.participantId,
        role: "player",
        joinToken: joined.joinToken,
      },
      guestId,
    );
    expect(oldTokenResponse.status).toBe(403);
  });

  it.each([
    ["maxPlayersが0", { maxPlayers: 0 }],
    ["maxPlayersが上限超過", { maxPlayers: 5 }],
    ["maxSpectatorsが負数", { maxSpectators: -1 }],
    ["visibilityが不正", { visibility: "private" }],
    ["joinMethodが不正", { joinMethod: "password" }],
    ["settingsが配列", { settings: [] }],
  ])("%sを明確なPayloadエラーで拒否する", async (_label, overrides) => {
    const response = await createRoom({
      requestId: `request-invalid-${crypto.randomUUID()}`,
      ...overrides,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("Room初期化の内部失敗を安全な接続エラーへ正規化する", async () => {
    const failingRooms = {
      getByName: () => ({
        getProcessedCommand: async () => null,
        initialize: async () => {
          throw new Error("内部ストレージエラー");
        },
        recordProcessedCommand: async () => {
          throw new Error("到達しない");
        },
      }),
    } as unknown as Env["FLARE_LOBBY_ROOMS"];
    const failingEnv = {
      ...env,
      FLARE_LOBBY_ROOMS: failingRooms,
    } as Env;

    const response = await createRoom(
      { requestId: `request-failure-${crypto.randomUUID()}` },
      `principal-failure-${crypto.randomUUID()}`,
      failingEnv,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_FAILED",
      message: "通信接続に失敗しました。",
    });
  });
});
