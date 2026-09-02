import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createGatewayPrincipalEnvelope,
  defineFlareLobby,
} from "../src/index.js";
import type { RoomDurableObject } from "../src/index.js";
import {
  deleteCustomRoomIndex,
  ensureCustomRoomIndex,
  queryCustomRoomIndex,
  registerCustomRoomInvitation,
  resolveCustomRoomInvitation,
  upsertCustomRoomIndex,
} from "../src/custom-room-index.js";
import type { CustomRoomIndexRecord } from "../src/custom-room-index.js";

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 4,
    defaultSettings: { mode: "casual", region: "asia" },
    finishedRoomRetentionMs: 60_000,
  },
  matchmakingPools: [],
  authenticate: (request) => {
    const id = request.headers.get("x-test-principal");

    return id === null ? null : { id, playerId: `${id}-player` };
  },
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true,
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 20,
  },
});

const testWorker = testLobby.createGatewayWorker<Env>();

function createRequest(body: unknown, principalId: string): Request {
  return new Request("https://example.test/v1/custom-rooms", {
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
  principalId = `principal-${crypto.randomUUID()}`,
): Promise<{
  readonly roomId: string;
  readonly participantId: string;
}> {
  const response = await testWorker.fetch(
    createRequest(body, principalId) as unknown as Parameters<
      typeof testWorker.fetch
    >[0],
    env,
    {} as ExecutionContext,
  );
  expect(response.status).toBe(201);
  return response.json();
}

async function joinRoom(
  roomId: string,
  principalId: string,
): Promise<Response> {
  return testWorker.fetch(
    new Request("https://example.test/v1/custom-rooms/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-principal": principalId,
      },
      body: JSON.stringify({ roomId, requestId: crypto.randomUUID() }),
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );
}

async function listRooms(query = ""): Promise<{
  readonly rooms: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
}> {
  const response = await testWorker.fetch(
    new Request(
      `https://example.test/v1/custom-rooms${query}`,
    ) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );

  expect(response.status).toBe(200);
  return response.json();
}

async function gatewayPrincipal(
  principalId: string,
): Promise<{ readonly token: string }> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId: `${principalId}-player` },
  );

  if (!result.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }

  return result.value;
}

async function fetchListResponse(query: string): Promise<Response> {
  return testWorker.fetch(
    new Request(
      `https://example.test/v1/custom-rooms${query}`,
    ) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );
}

// カーソルの署名形式を再現し、検証の拒否経路を作り込むためのヘルパー。
function encodeBase64UrlForTest(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function craftSignedCursor(encodedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.FLARE_LOBBY_TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`flarelobby-room-list-v1:${encodedPayload}`),
  );

  return `${encodedPayload}.${encodeBase64UrlForTest(new Uint8Array(signature))}`;
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
        settings: { mode: "ranked", region: "jp" },
      },
      publicOwnerId,
    );
    await createRoom(
      {
        requestId: crypto.randomUUID(),
        name: "非表示",
        visibility: "unlisted",
        settings: { mode: "ranked", region: "jp" },
      },
      `owner-unlisted-${crypto.randomUUID()}`,
    );
    await createRoom(
      {
        requestId: crypto.randomUUID(),
        name: "パスワード公開",
        visibility: "public",
        joinMethod: "password",
        password: "secret-password",
        settings: { mode: "ranked", region: "jp" },
      },
      `owner-password-${crypto.randomUUID()}`,
    );

    const page = await listRooms("?mode=ranked&region=jp");
    const listedIds = page.rooms.map((room) => room["roomId"]);

    expect(listedIds).toContain(publicRoom.roomId);
    expect(page.rooms).toHaveLength(2);
    expect(page.rooms.every((room) => room["visibility"] === "public")).toBe(
      true,
    );

    const publicSummary = page.rooms.find(
      (room) => room["roomId"] === publicRoom.roomId,
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
      availableSlots: 1,
    });

    const passwordSummary = page.rooms.find(
      (room) => room["name"] === "パスワード公開",
    );
    expect(passwordSummary).toMatchObject({
      joinMethod: "password",
      requiresPassword: true,
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
      requestId: crypto.randomUUID(),
    });
    const updated = await listRooms("?mode=updated&region=us");
    expect(updated.rooms[0]).toMatchObject({
      roomId: publicRoom.roomId,
      mode: "updated",
      region: "us",
    });
  });

  it("mode、region、空き枠と署名付きカーソルで安定してページングする", async () => {
    for (const name of ["ページA", "ページB", "ページC"]) {
      await createRoom({
        requestId: crypto.randomUUID(),
        name,
        maxPlayers: 2,
        settings: { mode: "page-test", region: "us" },
      });
    }
    await createRoom({
      requestId: crypto.randomUUID(),
      name: "別モード",
      maxPlayers: 2,
      settings: { mode: "other", region: "us" },
    });

    const first = await listRooms(
      "?mode=page-test&region=us&status=waiting&status=in_progress&available=true&availableSlots=1&limit=2",
    );
    expect(first.rooms).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listRooms(
      `?mode=page-test&region=us&status=in_progress&status=waiting&available=true&availableSlots=1&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.rooms).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([
        ...first.rooms.map((room) => room["roomId"]),
        ...second.rooms.map((room) => room["roomId"]),
      ]).size,
    ).toBe(3);

    const wrongFilter = await testWorker.fetch(
      new Request(
        `https://example.test/v1/custom-rooms?mode=other&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(wrongFilter.status).toBe(400);
    await expect(wrongFilter.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
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
        settings: { mode: "stale", region: "jp" },
      },
      ownerId,
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
      availableSlots: 0,
    });

    const principal = await gatewayPrincipal(ownerId);
    const secondPrincipal = await gatewayPrincipal(secondId);
    const room = env.FLARE_LOBBY_ROOMS.getByName(created.roomId);
    await room.setReady({
      gatewayPrincipal: principal,
      participantId: created.participantId,
      ready: true,
      requestId: crypto.randomUUID(),
    });
    await room.setReady({
      gatewayPrincipal: secondPrincipal,
      participantId: secondJoin.participantId,
      ready: true,
      requestId: crypto.randomUUID(),
    });
    await room.startMatch({
      gatewayPrincipal: principal,
      participantId: created.participantId,
      requestId: crypto.randomUUID(),
      at: "2026-08-11T00:02:00.000Z",
    });

    const started = await listRooms("?mode=stale&region=jp&state=in_progress");
    expect(started.rooms[0]?.["state"]).toBe("in_progress");

    await room.close({
      gatewayPrincipal: principal,
      participantId: created.participantId,
      requestId: crypto.randomUUID(),
      at: "2026-08-11T00:03:00.000Z",
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
        metadata: { name: "再試行" },
      },
      host: {
        participantId: "participant-retry",
        playerId: "player-retry",
      },
      participants: [
        {
          kind: "player",
          id: "participant-retry",
          player: { id: "player-retry" },
          teamId: null,
          ready: false,
        },
      ],
      maxPlayers: 2,
    });

    const dueAt = Date.now() - 1;
    await runInDurableObject(room, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'custom_room_index_upsert', ?)`,
        "retry-index-operation",
        dueAt,
        JSON.stringify({ roomId }),
      );
    });

    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const operations = await runInDurableObject(
      room,
      (instance: RoomDurableObject) => instance.listScheduledOperations(),
    );
    const pending = operations.find(
      (operation) => operation.id === "retry-index-operation",
    );
    expect(pending).toMatchObject({
      id: "retry-index-operation",
      kind: "custom_room_index_upsert",
    });
    expect(pending?.dueAt).toBeGreaterThan(dueAt);
  });
  it("検索条件の境界値と矛盾を安定した公開エラーへ変換する", async () => {
    const cases: readonly {
      readonly query: string;
      readonly status: number;
      readonly code: string;
    }[] = [
      { query: "?limit=abc", status: 400, code: "INVALID_PAYLOAD" },
      {
        query: "?limit=99999999999999999999",
        status: 400,
        code: "INVALID_PAYLOAD",
      },
      { query: "?limit=0", status: 400, code: "INVALID_PAYLOAD" },
      { query: "?limit=101", status: 400, code: "INVALID_PAYLOAD" },
      { query: "?limit=5&pageSize=6", status: 400, code: "CONFLICT" },
      {
        query: `?cursor=${"x".repeat(513)}`,
        status: 400,
        code: "INVALID_PAYLOAD",
      },
      { query: "?available=maybe", status: 400, code: "INVALID_PAYLOAD" },
      {
        query: "?availableSlots=2&minAvailableSlots=3",
        status: 400,
        code: "CONFLICT",
      },
      {
        query: `?mode=${"m".repeat(65)}`,
        status: 400,
        code: "INVALID_PAYLOAD",
      },
      { query: "?state=bogus", status: 400, code: "INVALID_PAYLOAD" },
      {
        query: "?state=waiting&status=in_progress",
        status: 400,
        code: "CONFLICT",
      },
      {
        query: "?state=waiting&status=waiting&status=in_progress",
        status: 400,
        code: "CONFLICT",
      },
    ];

    for (const testCase of cases) {
      const response = await fetchListResponse(testCase.query);
      expect(response.status, testCase.query).toBe(testCase.status);
      await expect(response.json(), testCase.query).resolves.toMatchObject({
        code: testCase.code,
      });
    }

    // available=false は条件なしの通常一覧として成功します。
    expect((await fetchListResponse("?available=false")).status).toBe(200);
  });

  it("カーソルは空・形式・署名・ペイロードの各経路で拒否される", async () => {
    // 空の cursor はクライアント入力不正として INVALID_PAYLOAD になります。
    const empty = await fetchListResponse("?cursor=");
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    // ドット区切りでない値。
    const malformed = await fetchListResponse("?cursor=garbage");
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    // 署名セグメントが base64url として不正 / atob できない長さ。
    for (const cursor of ["cGF5bG9hZA.!!!", "cGF5bG9hZA.A"]) {
      const response = await fetchListResponse(
        `?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status, cursor).toBe(400);
      await expect(response.json(), cursor).resolves.toMatchObject({
        code: "INVALID_PAYLOAD",
      });
    }

    // 実際のカーソルを改竄すると署名不一致で拒否されます。
    for (const name of ["カーソルA", "カーソルB", "カーソルC"]) {
      await createRoom({
        requestId: crypto.randomUUID(),
        name,
        maxPlayers: 2,
        settings: { mode: "cursor-negation", region: "jp" },
      });
    }
    const page = await listRooms("?mode=cursor-negation&region=jp&limit=2");
    expect(page.nextCursor).not.toBeNull();
    const [payload, signature] = page.nextCursor!.split(".");
    const tampered = `${`${payload!.slice(0, -1)}${payload!.endsWith("A") ? "B" : "A"}`}.${signature}`;
    const tamperedResponse = await fetchListResponse(
      `?mode=cursor-negation&region=jp&limit=2&cursor=${encodeURIComponent(tampered)}`,
    );
    expect(tamperedResponse.status).toBe(400);
    await expect(tamperedResponse.json()).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    // 正しい署名でも、payload が JSON / オブジェクトでなければ拒否します。
    for (const encodedPayload of [
      encodeBase64UrlForTest(Uint8Array.of(0xff)),
      encodeBase64UrlForTest(new TextEncoder().encode("123")),
    ]) {
      const craftedCursor = await craftSignedCursor(encodedPayload);
      const response = await fetchListResponse(
        `?mode=cursor-negation&region=jp&limit=2&cursor=${encodeURIComponent(craftedCursor)}`,
      );
      expect(response.status, encodedPayload).toBe(400);
      await expect(response.json(), encodedPayload).resolves.toMatchObject({
        code: "INVALID_PAYLOAD",
      });
    }
  });
});

describe("公開ルーム索引の直接操作", () => {
  /** 指定した D1 操作 (`run` / `all` / `first`) を失敗させるスタブです。 */
  function createFailingIndexDatabase(
    failure: "run" | "all" | "first",
  ): D1Database {
    const real = env.FLARE_LOBBY_DB;
    const wrapStatement = (statement: unknown): unknown =>
      new Proxy(statement as object, {
        get(statementTarget, statementProperty) {
          if (statementProperty === failure) {
            return () => Promise.reject(new Error("d1 down"));
          }
          if (statementProperty === "bind") {
            return (...args: unknown[]) =>
              wrapStatement(
                (
                  Reflect.get(
                    statementTarget as object,
                    "bind",
                    statementTarget,
                  ) as (...bindArgs: unknown[]) => unknown
                ).apply(statementTarget, args),
              );
          }
          const value = Reflect.get(
            statementTarget as object,
            statementProperty,
            statementTarget,
          );
          return typeof value === "function"
            ? (value as (...args: unknown[]) => unknown).bind(statementTarget)
            : value;
        },
      });
    return new Proxy(real, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) =>
            wrapStatement(
              (
                Reflect.get(target, "prepare", target) as (
                  text: string,
                ) => unknown
              ).call(target, sql),
            );
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as unknown as D1Database;
  }

  it("索引テーブルの作成に失敗したら CONNECTION_FAILED で再試行できる", async () => {
    const real = env.FLARE_LOBBY_DB;
    let batchCalls = 0;
    const database = new Proxy(real, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: unknown[]) => {
            batchCalls += 1;
            if (batchCalls === 1) {
              throw new Error("d1 down");
            }
            return await (
              Reflect.get(target, "batch", target) as (
                ...args: unknown[]
              ) => Promise<unknown[]>
            ).call(target, statements);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as unknown as D1Database;

    await expect(ensureCustomRoomIndex(database)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    // 失敗した初期化は破棄され、次回呼び出しで DDL が再実行されます。
    await expect(ensureCustomRoomIndex(database)).resolves.toBeUndefined();
    expect(batchCalls).toBe(2);
  });

  it("派生レコードの反映・検索・削除の D1 障害を CONNECTION_FAILED へ正規化する", async () => {
    await expect(
      upsertCustomRoomIndex(
        createFailingIndexDatabase("run"),
        createIndexRecord("index-failure-upsert"),
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    await expect(
      queryCustomRoomIndex(createFailingIndexDatabase("all"), { limit: 10 }),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    await expect(
      deleteCustomRoomIndex(createFailingIndexDatabase("run"), "room_x"),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("削除には空でない Room ID が必要で、古い revision は現状を壊さない", async () => {
    await expect(
      deleteCustomRoomIndex(env.FLARE_LOBBY_DB, "   "),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const roomId = `room_index_revision_${crypto.randomUUID()}`;
    await upsertCustomRoomIndex(
      env.FLARE_LOBBY_DB,
      createIndexRecord(roomId, { revision: 2 }),
    );
    await upsertCustomRoomIndex(
      env.FLARE_LOBBY_DB,
      createIndexRecord(roomId, { revision: 1 }),
    );
    const rows = await queryCustomRoomIndex(env.FLARE_LOBBY_DB, {
      limit: 10,
    });
    const stored = rows.find((row) => row.roomId === roomId);
    expect(stored?.revision).toBe(2);

    await expect(
      deleteCustomRoomIndex(env.FLARE_LOBBY_DB, roomId),
    ).resolves.toBeUndefined();
    const afterDelete = await queryCustomRoomIndex(env.FLARE_LOBBY_DB, {
      limit: 10,
    });
    expect(afterDelete.find((row) => row.roomId === roomId)).toBeUndefined();
  });

  it("招待索引の登録・解決の競合と障害を検証する", async () => {
    const invitationCode = `INV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await expect(
      registerCustomRoomInvitation(
        env.FLARE_LOBBY_DB,
        invitationCode,
        `room_first_${crypto.randomUUID()}`,
      ),
    ).resolves.toBeUndefined();

    await expect(
      registerCustomRoomInvitation(
        env.FLARE_LOBBY_DB,
        invitationCode,
        `room_second_${crypto.randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      registerCustomRoomInvitation(
        createFailingIndexDatabase("run"),
        `INV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        "room_any",
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    await expect(
      resolveCustomRoomInvitation(
        createFailingIndexDatabase("first"),
        "INV-UNKNOWN",
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    await expect(
      resolveCustomRoomInvitation(env.FLARE_LOBBY_DB, invitationCode),
    ).resolves.toMatch(/^room_first_/u);
  });

  function createIndexRecord(
    roomId: string,
    overrides: { readonly revision?: number } = {},
  ): CustomRoomIndexRecord {
    const now = Date.now();
    return {
      roomId,
      name: `索引テスト ${roomId}`,
      mode: "casual",
      region: "jp",
      state: "waiting",
      joinMethod: "public",
      maxPlayers: 4,
      playerCount: 1,
      availableSlots: 3,
      maxSpectators: 0,
      spectatorCount: 0,
      availableSpectatorSlots: 0,
      revision: overrides.revision ?? 1,
      createdAt: now,
      updatedAt: now,
    };
  }
});
