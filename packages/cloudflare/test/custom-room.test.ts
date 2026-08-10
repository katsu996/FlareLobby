import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  defineFlareLobby,
  RoomDurableObject
} from "../src/index.js";

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 8,
    defaultSettings: { map: "forest", mode: "casual" },
    finishedRoomRetentionMs: 60_000
  },
  matchmakingPools: [],
  authenticate: (request) => {
    const id = request.headers.get("x-test-principal") ?? "principal-create";

    return {
      id,
      playerId: `${id}-player`
    };
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
});

const testWorker = testLobby.createGatewayWorker<Env>();

function createRequest(
  body: unknown,
  principalId = `principal-${crypto.randomUUID()}`
): Request {
  return new Request("https://example.test/v1/custom-rooms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-principal": principalId
    },
    body: JSON.stringify(body)
  });
}

async function createRoom(
  body: unknown,
  principalId?: string,
  customEnv: Env = env
): Promise<Response> {
  const request = createRequest(
    body,
    principalId
  ) as unknown as Parameters<typeof testWorker.fetch>[0];

  return testWorker.fetch(
    request,
    customEnv,
    {} as ExecutionContext
  );
}

describe("カスタムルーム作成 Gateway", () => {
  it("未認証要求を作成処理へ到達させない", async () => {
    const response = await SELF.fetch(
      "https://example.test/v1/custom-rooms",
      {
        method: "POST",
        body: JSON.stringify({ requestId: crypto.randomUUID() })
      }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
      message: "認証が必要です。"
    });
  });

  it("既定値で作成し、認証主体をホスト兼プレイヤーとして返す", async () => {
    const principalId = `principal-default-${crypto.randomUUID()}`;
    const response = await createRoom(
      { requestId: `request-default-${crypto.randomUUID()}` },
      principalId
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
      `wss://example.test/v1/custom-rooms/${encodeURIComponent(result.roomId)}/ws`
    );
    expect(result.snapshot.room).toMatchObject({
      kind: "custom",
      metadata: { name: "ルーム" },
      settings: { map: "forest", mode: "casual" }
    });
    expect(result.snapshot.host).toEqual({
      participantId: `participant-${result.roomId}`,
      playerId: `${principalId}-player`
    });
    expect(result.snapshot.participants).toEqual([
      {
        kind: "player",
        id: `participant-${result.roomId}`,
        player: { id: `${principalId}-player` },
        teamId: null,
        ready: false
      }
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
      settings: { map: "desert", rules: { friendlyFire: false } }
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
      metadata: { name: "招待ルーム" }
    });

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(result.roomId),
      (_instance: RoomDurableObject, state) => {
        const row = state.storage.sql
          .exec<{
            maxSpectators: number;
            joinMethod: string;
          }>(
            "SELECT max_spectators AS maxSpectators, join_method AS joinMethod FROM flarelobby_rooms"
          )
          .one();

        expect(row).toEqual({ maxSpectators: 3, joinMethod: "invitation" });
      }
    );
  });

  it("同じ requestId の同時再送を1ルーム1結果へ収束させる", async () => {
    const principalId = `principal-concurrent-${crypto.randomUUID()}`;
    const body = {
      requestId: `request-concurrent-${crypto.randomUUID()}`,
      name: "同時作成",
      maxPlayers: 2,
      maxSpectators: 1,
      settings: { map: "forest" }
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => createRoom(body, principalId))
    );
    const results = await Promise.all(
      responses.map((response) => response.json<{ roomId: string; joinToken: string }>())
    );

    expect(responses.map((response) => response.status)).toEqual([
      201,
      201,
      201,
      201
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
            "SELECT COUNT(*) AS count FROM flarelobby_rooms"
          )
          .one().count;
        const participantCount = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_room_participants"
          )
          .one().count;
        const commandCount = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_processed_commands"
          )
          .one().count;

        expect(roomCount).toBe(1);
        expect(participantCount).toBe(1);
        expect(commandCount).toBe(1);
      }
    );
  });

  it("同じ requestId の異なる作成条件を競合として拒否する", async () => {
    const principalId = `principal-conflict-${crypto.randomUUID()}`;
    const requestId = `request-conflict-${crypto.randomUUID()}`;

    await expect(
      createRoom({ requestId, name: "最初のルーム" }, principalId).then(
        (response) => response.status
      )
    ).resolves.toBe(201);

    const response = await createRoom(
      { requestId, name: "別のルーム" },
      principalId
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONFLICT"
    });
  });

  it.each([
    ["maxPlayersが0", { maxPlayers: 0 }],
    ["maxPlayersが上限超過", { maxPlayers: 5 }],
    ["maxSpectatorsが負数", { maxSpectators: -1 }],
    ["visibilityが不正", { visibility: "private" }],
    ["joinMethodが不正", { joinMethod: "password" }],
    ["settingsが配列", { settings: [] }]
  ])("%sを明確なPayloadエラーで拒否する", async (_label, overrides) => {
    const response = await createRoom({
      requestId: `request-invalid-${crypto.randomUUID()}`,
      ...overrides
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD"
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
        }
      })
    } as unknown as Env["FLARE_LOBBY_ROOMS"];
    const failingEnv = {
      ...env,
      FLARE_LOBBY_ROOMS: failingRooms
    } as Env;

    const response = await createRoom(
      { requestId: `request-failure-${crypto.randomUUID()}` },
      `principal-failure-${crypto.randomUUID()}`,
      failingEnv
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_FAILED",
      message: "通信接続に失敗しました。"
    });
  });
});
