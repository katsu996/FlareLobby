import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createGatewayPrincipalEnvelope,
  defineFlareLobby,
} from "../src/index.js";
import type { RoomDurableObject } from "../src/index.js";

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 4,
    defaultSettings: { mode: "casual", region: "asia" },
    finishedRoomRetentionMs: 60_000
  },
  matchmakingPools: [],
  authenticate: (request) => {
    const id = request.headers.get("x-test-principal");

    return id === null ? null : { id, playerId: `${id}-player` };
  },
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 20
  }
});

const testWorker = testLobby.createGatewayWorker<Env>();

function createRequest(
  body: unknown,
  principalId: string
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
  principalId = `principal-${crypto.randomUUID()}`
): Promise<{
  readonly roomId: string;
  readonly participantId: string;
}> {
  const response = await testWorker.fetch(
    createRequest(body, principalId) as unknown as Parameters<
      typeof testWorker.fetch
    >[0],
    env,
    {} as ExecutionContext
  );
  expect(response.status).toBe(201);
  return response.json();
}

async function joinRoom(
  roomId: string,
  principalId: string
): Promise<Response> {
  return testWorker.fetch(
    new Request("https://example.test/v1/custom-rooms/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-principal": principalId
      },
      body: JSON.stringify({ roomId, requestId: crypto.randomUUID() })
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext
  );
}

async function listRooms(query = ""): Promise<{
  readonly rooms: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
}> {
  const response = await testWorker.fetch(
    new Request(`https://example.test/v1/custom-rooms${query}`) as unknown as Parameters<
      typeof testWorker.fetch
    >[0],
    env,
    {} as ExecutionContext
  );

  expect(response.status).toBe(200);
  return response.json();
}

async function gatewayPrincipal(principalId: string): Promise<{ readonly token: string }> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId: `${principalId}-player` }
  );

  if (!result.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }

  return result.value;
}

describe("公開カスタムルーム一覧", () => {
  it("公開ルームだけを秘密情報なしで返し、状態と人数を反映する", async () => {
    const publicOwnerId = `owner-public-${crypto.randomUUID()}`;
    const publicRoom = await createRoom(
      {
        requestId: crypto.randomUUID(),
        name: "公開一覧",
        visibility: "public",
        maxPlayers: 2,
        settings: { mode: "ranked", region: "jp" }
      },
      publicOwnerId
    );
    await createRoom(
      {
        requestId: crypto.randomUUID(),
        name: "非表示",
        visibility: "unlisted",
        settings: { mode: "ranked", region: "jp" }
      },
      `owner-unlisted-${crypto.randomUUID()}`
    );
    await createRoom(
      {
        requestId: crypto.randomUUID(),
        name: "パスワード公開",
        visibility: "public",
        joinMethod: "password",
        password: "secret-password",
        settings: { mode: "ranked", region: "jp" }
      },
      `owner-password-${crypto.randomUUID()}`
    );

    const page = await listRooms("?mode=ranked&region=jp");
    const listedIds = page.rooms.map((room) => room["roomId"]);

    expect(listedIds).toContain(publicRoom.roomId);
    expect(page.rooms).toHaveLength(2);
    expect(page.rooms.every((room) => room["visibility"] === "public")).toBe(
      true
    );

    const publicSummary = page.rooms.find(
      (room) => room["roomId"] === publicRoom.roomId
    );
    expect(publicSummary).toMatchObject({
      id: publicRoom.roomId,
      kind: "custom",
      name: "公開一覧",
      mode: "ranked",
      region: "jp",
      state: "waiting",
      playerCount: 1,
      maxPlayers: 2,
      availableSlots: 1
    });

    const passwordSummary = page.rooms.find(
      (room) => room["name"] === "パスワード公開"
    );
    expect(passwordSummary).toMatchObject({
      joinMethod: "password",
      requiresPassword: true
    });
    expect(JSON.stringify(page)).not.toContain("secret-password");
    expect(JSON.stringify(page)).not.toContain("joinToken");
    expect(JSON.stringify(page)).not.toContain("invitationCode");
    expect(JSON.stringify(page)).not.toContain("durableObjectId");

    const ownerPrincipal = await gatewayPrincipal(publicOwnerId);
    const room = env.FLARE_LOBBY_ROOMS.getByName(publicRoom.roomId);
    await room.updateSettings({
      gatewayPrincipal: ownerPrincipal,
      participantId: publicRoom.participantId,
      settings: { mode: "updated", region: "us" },
      requestId: crypto.randomUUID()
    });
    const updated = await listRooms("?mode=updated&region=us");
    expect(updated.rooms[0]).toMatchObject({
      roomId: publicRoom.roomId,
      mode: "updated",
      region: "us"
    });
  });

  it("mode、region、空き枠と署名付きカーソルで安定してページングする", async () => {
    for (const name of ["ページA", "ページB", "ページC"]) {
      await createRoom({
        requestId: crypto.randomUUID(),
        name,
        maxPlayers: 2,
        settings: { mode: "page-test", region: "us" }
      });
    }
    await createRoom({
      requestId: crypto.randomUUID(),
      name: "別モード",
      maxPlayers: 2,
      settings: { mode: "other", region: "us" }
    });

    const first = await listRooms(
      "?mode=page-test&region=us&status=waiting&status=in_progress&available=true&availableSlots=1&limit=2"
    );
    expect(first.rooms).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listRooms(
      `?mode=page-test&region=us&status=in_progress&status=waiting&available=true&availableSlots=1&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`
    );
    expect(second.rooms).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([
        ...first.rooms.map((room) => room["roomId"]),
        ...second.rooms.map((room) => room["roomId"])
      ]).size
    ).toBe(3);

    const wrongFilter = await testWorker.fetch(
      new Request(
        `https://example.test/v1/custom-rooms?mode=other&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext
    );
    expect(wrongFilter.status).toBe(400);
    await expect(wrongFilter.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD"
    });
  });

  it("一覧が古くても参加時に Room Durable Object が最終判定する", async () => {
    const ownerId = `owner-stale-${crypto.randomUUID()}`;
    const secondId = `second-stale-${crypto.randomUUID()}`;
    const thirdId = `third-stale-${crypto.randomUUID()}`;
    const created = await createRoom(
      {
        requestId: crypto.randomUUID(),
        maxPlayers: 2,
        settings: { mode: "stale", region: "jp" }
      },
      ownerId
    );
    const stale = await listRooms("?mode=stale&region=jp");
    expect(stale.rooms[0]?.["availableSlots"]).toBe(1);

    const second = await joinRoom(created.roomId, secondId);
    expect(second.status).toBe(200);
    const secondJoin = await second.json<{ participantId: string }>();

    const third = await joinRoom(created.roomId, thirdId);
    expect(third.status).toBe(400);
    await expect(third.json()).resolves.toMatchObject({ code: "ROOM_FULL" });

    const current = await listRooms("?mode=stale&region=jp");
    expect(current.rooms[0]).toMatchObject({
      playerCount: 2,
      availableSlots: 0
    });

    const principal = await gatewayPrincipal(ownerId);
    const secondPrincipal = await gatewayPrincipal(secondId);
    const room = env.FLARE_LOBBY_ROOMS.getByName(created.roomId);
    await room.setReady({
      gatewayPrincipal: principal,
      participantId: created.participantId,
      ready: true,
      requestId: crypto.randomUUID()
    });
    await room.setReady({
      gatewayPrincipal: secondPrincipal,
      participantId: secondJoin.participantId,
      ready: true,
      requestId: crypto.randomUUID()
    });
    await room.startMatch({
      gatewayPrincipal: principal,
      participantId: created.participantId,
      requestId: crypto.randomUUID(),
      at: "2026-08-11T00:02:00.000Z"
    });

    const started = await listRooms("?mode=stale&region=jp&state=in_progress");
    expect(started.rooms[0]?.["state"]).toBe("in_progress");

    await room.close({
      gatewayPrincipal: principal,
      participantId: created.participantId,
      requestId: crypto.randomUUID(),
      at: "2026-08-11T00:03:00.000Z"
    });
    const closed = await listRooms("?mode=stale&region=jp&state=finished");
    expect(closed.rooms[0]?.["state"]).toBe("finished");
  });

  it("一覧同期の失敗を再試行可能な Room operation として保持する", async () => {
    const roomId = `room-index-retry-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize({
      room: {
        id: roomId,
        kind: "custom",
        invitationCode: "4F9K2D",
        visibility: "public",
        settings: { mode: "retry", region: "jp" },
        metadata: { name: "再試行" }
      },
      host: {
        participantId: "participant-retry",
        playerId: "player-retry"
      },
      participants: [
        {
          kind: "player",
          id: "participant-retry",
          player: { id: "player-retry" },
          teamId: null,
          ready: false
        }
      ],
      maxPlayers: 2
    });

    const dueAt = Date.now() - 1;
    await runInDurableObject(room, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'custom_room_index_upsert', ?)`,
        "retry-index-operation",
        dueAt,
        JSON.stringify({ roomId })
      );
    });

    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const operations = await runInDurableObject(
      room,
      (instance: RoomDurableObject) => instance.listScheduledOperations()
    );
    const pending = operations.find(
      (operation) => operation.id === "retry-index-operation"
    );
    expect(pending).toMatchObject({
      id: "retry-index-operation",
      kind: "custom_room_index_upsert"
    });
    expect(pending?.dueAt).toBeGreaterThan(dueAt);
  });
});
