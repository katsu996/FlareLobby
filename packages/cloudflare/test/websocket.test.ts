import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  createGatewayPrincipalEnvelope,
  defineFlareLobby,
  getRoomWebSocketTag,
  issueJoinToken,
  RoomDurableObject,
} from "../src/index.js";
import type {
  GatewayPrincipalEnvelope,
  RoomInitializationOptions,
  RoomScheduledOperation,
} from "../src/index.js";
import type { Participant } from "@flarelobby/core";

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 2,
    defaultSettings: { map: "forest", mode: "casual" },
  },
  matchmakingPools: [],
  authenticate: (request) => {
    const id = request.headers.get("x-test-principal") ?? "principal-test";

    return { id, playerId: `${id}-player` };
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

interface RoomResult {
  readonly roomId: string;
  readonly joinToken: string;
  readonly participantId: string;
}

interface WebSocketEvent {
  readonly protocolVersion: number;
  readonly kind: string;
  readonly event?: string;
  readonly revision?: number;
  readonly payload?: any;
  readonly requestId?: string | null;
  readonly error?: { readonly code: string; readonly message: string };
}

interface SocketInbox {
  readonly next: (timeoutMs?: number) => Promise<WebSocketEvent>;
}

const socketInboxes = new WeakMap<WebSocket, SocketInbox>();

async function createRoom(
  principalId = `principal-${crypto.randomUUID()}`,
): Promise<RoomResult> {
  const response = await testWorker.fetch(
    new Request("https://example.test/v1/custom-rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-principal": principalId,
      },
      body: JSON.stringify({ requestId: `request-${crypto.randomUUID()}` }),
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );

  expect(response.status).toBe(201);
  return response.json<RoomResult>();
}

async function joinRoom(
  roomId: string,
  principalId = `principal-${crypto.randomUUID()}`,
  role: "player" | "spectator" = "player",
): Promise<RoomResult> {
  const response = await testWorker.fetch(
    new Request("https://example.test/v1/custom-rooms/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-principal": principalId,
      },
      body: JSON.stringify({
        requestId: `request-${crypto.randomUUID()}`,
        roomId,
        role,
      }),
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );

  expect(response.status).toBe(200);
  return response.json<RoomResult>();
}

function encodeWebSocketToken(token: string): string {
  const bytes = new TextEncoder().encode(token);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function createWebSocketRequest(
  roomId: string,
  token: string,
  protocol = "flarelobby.v1",
  lastRevision?: number,
): Request {
  const query =
    lastRevision === undefined ? "" : `?lastRevision=${lastRevision}`;

  return new Request(
    `https://example.test/v1/custom-rooms/${encodeURIComponent(roomId)}/ws${query}`,
    {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `${protocol}, flarelobby.auth.${encodeWebSocketToken(token)}`,
      },
    },
  );
}

async function connect(room: RoomResult): Promise<WebSocket> {
  return connectWithToken(room.roomId, room.joinToken);
}

function registerSocketInbox(socket: WebSocket): WebSocket {
  const messages: WebSocketEvent[] = [];
  const waiters: Array<{
    readonly resolve: (message: WebSocketEvent) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  let socketError: Error | null = null;

  socket.addEventListener("message", (event: Event) => {
    const message = JSON.parse(
      (event as MessageEvent).data as string,
    ) as WebSocketEvent;
    const waiter = waiters.shift();

    if (waiter) {
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  socket.addEventListener("error", () => {
    socketError = new Error(
      "WebSocket のメッセージ待機中にエラーが発生しました。",
    );

    for (const waiter of waiters.splice(0)) {
      waiter.reject(socketError);
    }
  });

  socketInboxes.set(socket, {
    next: (timeoutMs = 5_000) => {
      if (messages.length > 0) {
        return Promise.resolve(messages.shift() as WebSocketEvent);
      }

      if (socketError !== null) {
        return Promise.reject(socketError);
      }

      return new Promise<WebSocketEvent>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const waiter = {
          resolve: (message: WebSocketEvent): void => {
            if (timeout !== undefined) {
              clearTimeout(timeout);
            }
            resolve(message);
          },
          reject: (error: Error): void => {
            if (timeout !== undefined) {
              clearTimeout(timeout);
            }
            reject(error);
          },
        };

        waiters.push(waiter);
        timeout = setTimeout(() => {
          const index = waiters.indexOf(waiter);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error("WebSocket メッセージがタイムアウトしました。"));
        }, timeoutMs);
      });
    },
  });

  socket.accept();
  return socket;
}

async function connectWithToken(
  roomId: string,
  token: string,
  lastRevision?: number,
): Promise<WebSocket> {
  const response = await testWorker.fetch(
    createWebSocketRequest(
      roomId,
      token,
      "flarelobby.v1",
      lastRevision,
    ) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );

  expect(response.status).toBe(101);

  if (response.webSocket === null) {
    throw new Error("WebSocket が Upgrade 応答に含まれていません。");
  }

  return registerSocketInbox(response.webSocket);
}

function waitForMessage(
  webSocket: WebSocket,
  timeoutMs?: number,
): Promise<WebSocketEvent> {
  const inbox = socketInboxes.get(webSocket);

  if (inbox === undefined) {
    throw new Error("テスト用 WebSocket の受信キューが登録されていません。");
  }

  return inbox.next(timeoutMs);
}

async function waitForDisconnectedConnections(
  roomId: string,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const count = await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(roomId),
      (_instance: RoomDurableObject, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_room_connections WHERE room_id = ? AND disconnected_at IS NOT NULL",
            roomId,
          )
          .one().count,
    );

    if (count >= expectedCount) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("WebSocket の切断状態が永続化されませんでした。");
}

function sendCommand(
  webSocket: WebSocket,
  command: string,
  payload: unknown,
  requestId = `request-${crypto.randomUUID()}`,
): void {
  webSocket.send(
    JSON.stringify({
      protocolVersion: 1,
      kind: "command",
      requestId,
      command,
      payload,
    }),
  );
}

async function closeSocket(webSocket: WebSocket): Promise<void> {
  webSocket.close(1000, "test");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("Room Hibernation WebSocket", () => {
  it("参加済み接続へ状態変更を配信し、別 Room へ漏らさず、主体を復元する", async () => {
    const owner = await createRoom();
    const player = await joinRoom(owner.roomId);
    const otherRoom = await createRoom();
    const ownerSocket = await connect(owner);
    const playerSocket = await connect(player);
    const otherSocket = await connect(otherRoom);

    await expect(waitForMessage(ownerSocket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      payload: { room: { id: owner.roomId } },
    });
    const playerInitialEvent = await waitForMessage(playerSocket);
    expect(playerInitialEvent).toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });
    await expect(waitForMessage(otherSocket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      (_instance: RoomDurableObject, state) => {
        const sockets = state.getWebSockets(getRoomWebSocketTag(owner.roomId));
        expect(sockets).toHaveLength(2);
        expect(sockets[0]?.deserializeAttachment()).toMatchObject({
          roomId: owner.roomId,
          participantId: expect.any(String),
          role: "player",
          connectedAt: expect.any(String),
          resumeId: expect.any(String),
          principal: {
            id: expect.any(String),
            playerId: expect.any(String),
          },
        });
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM flarelobby_room_connections WHERE room_id = ? AND disconnected_at IS NULL",
              owner.roomId,
            )
            .one().count,
        ).toBe(2);
      },
    );

    sendCommand(playerSocket, "room.set_ready", { ready: true });
    const ownerEvent = await waitForMessage(ownerSocket);
    const playerEvent = await waitForMessage(playerSocket);
    const playerResponse = await waitForMessage(playerSocket);

    expect(ownerEvent).toMatchObject({
      kind: "event",
      event: "room.snapshot",
      payload: {
        room: { id: owner.roomId },
        participants: expect.arrayContaining([
          expect.objectContaining({ id: player.participantId, ready: true }),
        ]),
      },
    });
    expect(playerEvent).toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });
    expect(playerResponse).toMatchObject({
      kind: "success",
      requestId: expect.any(String),
    });

    await expect(waitForMessage(otherSocket, 50)).rejects.toThrow(
      "WebSocket メッセージがタイムアウトしました。",
    );

    await closeSocket(ownerSocket);
    await closeSocket(playerSocket);
    await closeSocket(otherSocket);

    await waitForDisconnectedConnections(owner.roomId, 2);
    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      (_instance: RoomDurableObject, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM flarelobby_room_participants WHERE participant_id = ?",
              player.participantId,
            )
            .one().count,
        ).toBe(1);
      },
    );
  });

  it("参加用トークン、プロトコル、Payload、役割権限を個別に拒否する", async () => {
    const owner = await createRoom();
    const spectator = await joinRoom(owner.roomId, undefined, "spectator");
    const invalidTokenResponse = await testWorker.fetch(
      createWebSocketRequest(
        owner.roomId,
        "invalid-token",
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(invalidTokenResponse.status).toBe(401);

    const invalidProtocolResponse = await testWorker.fetch(
      createWebSocketRequest(
        owner.roomId,
        owner.joinToken,
        "flarelobby.v2",
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(invalidProtocolResponse.status).toBe(400);
    await expect(invalidProtocolResponse.json()).resolves.toMatchObject({
      code: "INVALID_MESSAGE",
    });

    const spectatorSocket = await connect(spectator);
    await waitForMessage(spectatorSocket);

    sendCommand(spectatorSocket, "room.set_ready", { ready: true });
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "FORBIDDEN" },
    });

    sendCommand(spectatorSocket, "game.chat", { text: "閲覧者からの送信" });
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "FORBIDDEN" },
    });

    sendCommand(spectatorSocket, "room.set_ready", { ready: "yes" });
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "INVALID_PAYLOAD" },
    });

    const unsupportedVersion = JSON.stringify({
      protocolVersion: 99,
      kind: "command",
      requestId: `request-${crypto.randomUUID()}`,
      command: "room.set_ready",
      payload: { ready: true },
    });
    spectatorSocket.send(unsupportedVersion);
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "UNSUPPORTED_PROTOCOL_VERSION" },
    });

    await closeSocket(spectatorSocket);
  });

  it("1接続の送信失敗が他の接続への配信を中断しない", async () => {
    const owner = await createRoom();
    const player = await joinRoom(owner.roomId);
    const ownerSocket = await connect(owner);
    const playerSocket = await connect(player);

    await Promise.all([
      waitForMessage(ownerSocket),
      waitForMessage(playerSocket),
    ]);

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      (_instance: RoomDurableObject, state) => {
        const ownerServerSocket = state
          .getWebSockets(getRoomWebSocketTag(owner.roomId))
          .find((webSocket) => {
            const attachment = webSocket.deserializeAttachment() as {
              readonly participantId?: string;
            } | null;

            return attachment?.participantId === owner.participantId;
          });

        if (ownerServerSocket === undefined) {
          throw new Error("送信失敗を注入する接続が見つかりません。");
        }

        vi.spyOn(ownerServerSocket, "send").mockImplementation(() => {
          throw new Error("意図的な送信失敗");
        });
      },
    );

    sendCommand(playerSocket, "room.set_ready", { ready: true });
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      payload: {
        participants: expect.arrayContaining([
          expect.objectContaining({ id: player.participantId, ready: true }),
        ]),
      },
    });
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "success",
    });

    await Promise.all([closeSocket(ownerSocket), closeSocket(playerSocket)]);
  });

  it("プレイヤーのゲームメッセージを検証して同じ Room へだけ配信する", async () => {
    const owner = await createRoom();
    const player = await joinRoom(owner.roomId);
    const otherRoom = await createRoom();
    const ownerSocket = await connect(owner);
    const playerSocket = await connect(player);
    const otherSocket = await connect(otherRoom);

    await Promise.all([
      waitForMessage(ownerSocket),
      waitForMessage(playerSocket),
      waitForMessage(otherSocket),
    ]);

    sendCommand(playerSocket, "game.chat", { text: "こんにちは" });
    const ownerEvent = await waitForMessage(ownerSocket);
    const playerEvent = await waitForMessage(playerSocket);
    const playerResponse = await waitForMessage(playerSocket);

    expect(ownerEvent).toMatchObject({
      kind: "event",
      event: "game.message",
      payload: {
        name: "game.chat",
        payload: { text: "こんにちは" },
        sender: { participantId: player.participantId, role: "player" },
      },
    });
    expect(playerEvent).toMatchObject({
      kind: "event",
      event: "game.message",
    });
    expect(playerResponse).toMatchObject({ kind: "success" });

    await expect(waitForMessage(otherSocket, 50)).rejects.toThrow(
      "WebSocket メッセージがタイムアウトしました。",
    );

    await Promise.all([
      closeSocket(ownerSocket),
      closeSocket(playerSocket),
      closeSocket(otherSocket),
    ]);
  });

  it("猶予期間内の再接続で参加状態を引き継ぎ、欠落イベントを順序どおり再送する", async () => {
    const owner = await createRoom(`principal-resume-${crypto.randomUUID()}`);
    const socket = await connect(owner);
    const initial = await waitForMessage(socket);
    const resumeToken = initial.payload?.resumeToken;

    expect(initial).toMatchObject({
      kind: "event",
      event: "room.snapshot",
      revision: 0,
      payload: {
        room: { id: owner.roomId },
        resume: {
          participantId: owner.participantId,
          role: "player",
          resumed: false,
        },
        resumeToken: expect.any(String),
        resumeTokenExpiresAt: expect.any(Number),
      },
    });
    expect(typeof resumeToken).toBe("string");

    for (const ready of [true, false, true]) {
      sendCommand(socket, "room.set_ready", { ready });
      await expect(waitForMessage(socket)).resolves.toMatchObject({
        kind: "event",
        event: "room.snapshot",
        revision: expect.any(Number),
      });
      await expect(waitForMessage(socket)).resolves.toMatchObject({
        kind: "success",
      });
    }

    await closeSocket(socket);
    await waitForDisconnectedConnections(owner.roomId, 1);

    const multipleMissing = await connectWithToken(
      owner.roomId,
      resumeToken as string,
      0,
    );
    const multipleMessages = [
      await waitForMessage(multipleMissing),
      await waitForMessage(multipleMissing),
      await waitForMessage(multipleMissing),
      await waitForMessage(multipleMissing),
    ];

    expect(multipleMessages.map((message) => message.revision)).toEqual([
      1, 2, 3, 3,
    ]);
    expect(multipleMessages[0]).toMatchObject({
      kind: "event",
      event: "room.snapshot",
      payload: { participants: expect.any(Array) },
    });
    expect(multipleMessages[3]).toMatchObject({
      kind: "event",
      event: "room.snapshot",
      payload: {
        participants: expect.arrayContaining([
          expect.objectContaining({ id: owner.participantId, ready: true }),
        ]),
        resume: {
          participantId: owner.participantId,
          resumed: true,
        },
      },
    });

    await closeSocket(multipleMissing);
    await waitForDisconnectedConnections(owner.roomId, 1);

    const oneMissing = await connectWithToken(
      owner.roomId,
      resumeToken as string,
      2,
    );
    await expect(waitForMessage(oneMissing)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      revision: 3,
    });
    await expect(waitForMessage(oneMissing)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      revision: 3,
      payload: { resume: { resumed: true } },
    });

    await closeSocket(oneMissing);
    await waitForDisconnectedConnections(owner.roomId, 1);

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      (_instance: RoomDurableObject, state) => {
        state.storage.sql.exec(
          "DELETE FROM flarelobby_room_events WHERE revision = ?",
          1,
        );
      },
    );

    const insufficientHistory = await connectWithToken(
      owner.roomId,
      resumeToken as string,
      0,
    );
    await expect(waitForMessage(insufficientHistory)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      revision: 3,
      payload: { resume: { resumed: true } },
    });
    await expect(waitForMessage(insufficientHistory, 50)).rejects.toThrow(
      "WebSocket メッセージがタイムアウトしました。",
    );
    await closeSocket(insufficientHistory);

    await waitForDisconnectedConnections(owner.roomId, 1);
    const outOfRange = await connectWithToken(
      owner.roomId,
      resumeToken as string,
      999,
    );
    await expect(waitForMessage(outOfRange)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      revision: 3,
      payload: { resume: { resumed: true } },
    });
    await expect(waitForMessage(outOfRange, 50)).rejects.toThrow(
      "WebSocket メッセージがタイムアウトしました。",
    );
    await closeSocket(outOfRange);
  });

  it("明示退出後の古い再開トークンと改ざんトークンを拒否する", async () => {
    const principalId = `principal-resume-leave-${crypto.randomUUID()}`;
    const owner = await createRoom(principalId);
    await joinRoom(owner.roomId);
    const socket = await connect(owner);
    const initial = await waitForMessage(socket);
    const resumeToken = initial.payload?.resumeToken;

    expect(typeof resumeToken).toBe("string");

    const leaveResponse = await testWorker.fetch(
      new Request("https://example.test/v1/custom-rooms/leave", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-principal": principalId,
        },
        body: JSON.stringify({
          requestId: `leave-${crypto.randomUUID()}`,
          roomId: owner.roomId,
          joinToken: owner.joinToken,
          participantId: owner.participantId,
          role: "player",
        }),
      }) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

    expect(leaveResponse.status).toBe(200);

    const oldTokenResponse = await testWorker.fetch(
      createWebSocketRequest(
        owner.roomId,
        resumeToken as string,
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(oldTokenResponse.status).toBe(403);

    const tamperedToken = `${(resumeToken as string).slice(0, -1)}${
      (resumeToken as string).endsWith("A") ? "B" : "A"
    }`;
    const tamperedResponse = await testWorker.fetch(
      createWebSocketRequest(
        owner.roomId,
        tamperedToken,
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(tamperedResponse.status).toBe(401);

    await closeSocket(socket);
  });
});

function createDirectUpgradeRequest(
  roomId: string,
  token: string | undefined,
  options: DirectUpgradeOptions = {},
): Request {
  const path =
    options.rawPath ?? `/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`;
  const protocols = options.protocols ?? [
    "flarelobby.v1",
    ...(token === undefined
      ? []
      : [`flarelobby.auth.${encodeWebSocketToken(token)}`]),
  ];

  return new Request(`https://example.test${path}${options.query ?? ""}`, {
    method: "GET",
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": protocols.join(", "),
      ...options.extraHeaders,
    },
  });
}

interface DirectUpgradeOptions {
  rawPath?: string;
  query?: string;
  protocols?: string[];
  extraHeaders?: Record<string, string>;
}

async function fetchUpgrade(
  roomId: string,
  token: string | undefined,
  options: DirectUpgradeOptions = {},
): Promise<Response> {
  return env.FLARE_LOBBY_ROOMS.getByName(roomId).fetch(
    createDirectUpgradeRequest(roomId, token, options),
  );
}

async function connectViaStub(
  roomId: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<WebSocket> {
  const response = await fetchUpgrade(roomId, token, { extraHeaders });

  expect(response.status).toBe(101);

  if (response.webSocket === null) {
    throw new Error("WebSocket が Upgrade 応答に含まれていません。");
  }

  return registerSocketInbox(response.webSocket);
}

async function createPrincipalEnvelope(
  principalId: string,
  playerId: string,
): Promise<GatewayPrincipalEnvelope> {
  const envelope = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId },
  );

  if (!envelope.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }

  return envelope.value;
}

async function issuePlayerJoinToken(options: {
  roomId: string;
  participantId: string;
  playerId: string;
  principalId: string;
}): Promise<string> {
  const issued = await issueJoinToken(env.FLARE_LOBBY_TOKEN_SECRET, {
    principal: { id: options.principalId, playerId: options.playerId },
    roomId: options.roomId,
    role: "player",
    participantId: options.participantId,
    expiresAt: Date.now() + 60_000,
  });

  if (!issued.ok) {
    throw new Error("参加用トークンを発行できません。");
  }

  return issued.value;
}

async function initializeDirectRoom(
  roomId: string,
  overrides: {
    disconnectGracePeriodMs?: number;
    participants?: RoomInitializationOptions["participants"];
  } = {},
): Promise<void> {
  await env.FLARE_LOBBY_ROOMS.getByName(roomId).initialize({
    room: {
      id: roomId,
      kind: "custom",
      invitationCode: "4F9K2D",
      visibility: "unlisted",
      settings: {},
      metadata: {},
    },
    host: {
      participantId: "participant-host",
      playerId: "player-host",
    },
    participants: overrides.participants ?? [
      {
        kind: "player",
        id: "participant-host",
        player: { id: "player-host" },
        teamId: null,
        ready: false,
      },
    ],
    teams: [],
    maxPlayers: 4,
    disconnectGracePeriodMs: overrides.disconnectGracePeriodMs,
    finishedRoomRetentionMs: 60_000,
  });
}

describe("Room Durable Object の WebSocket Upgrade とハンドラ検証", () => {
  it("Upgrade 検証・トークン・lastRevision の異常を個別に拒否する", async () => {
    const owner = await createRoom();

    const notWebSocket = await env.FLARE_LOBBY_ROOMS.getByName(
      owner.roomId,
    ).fetch(
      new Request(
        `https://example.test/v1/custom-rooms/${encodeURIComponent(owner.roomId)}/ws`,
        { method: "POST" },
      ),
    );
    expect(notWebSocket.status).toBe(404);

    for (const [description, request, expectedStatus, expectedCode] of [
      [
        "path に Room 識別子を含まない Upgrade",
        await fetchUpgrade(owner.roomId, owner.joinToken, {
          rawPath: "/v1/custom-rooms/ws",
        }),
        400,
        "INVALID_MESSAGE",
      ],
      [
        "不正なパーセントエンコーディング",
        await fetchUpgrade(owner.roomId, owner.joinToken, {
          rawPath: "/v1/custom-rooms/%zz/ws",
        }),
        400,
        "INVALID_MESSAGE",
      ],
      [
        "認証プロトコルを含まない Upgrade",
        await fetchUpgrade(owner.roomId, undefined),
        401,
        "UNAUTHENTICATED",
      ],
      [
        "検証に失敗するトークン",
        await fetchUpgrade(owner.roomId, "not-a-token"),
        401,
        "UNAUTHENTICATED",
      ],
      [
        "数値でない lastRevision",
        await fetchUpgrade(owner.roomId, owner.joinToken, {
          query: "?lastRevision=abc",
        }),
        400,
        "INVALID_PAYLOAD",
      ],
      [
        "query とヘッダーで不一致の lastRevision",
        await fetchUpgrade(owner.roomId, owner.joinToken, {
          query: "?lastRevision=1",
          extraHeaders: { "x-flarelobby-last-revision": "2" },
        }),
        400,
        "INVALID_PAYLOAD",
      ],
      [
        "安全な整数範囲外の lastRevision",
        await fetchUpgrade(owner.roomId, owner.joinToken, {
          extraHeaders: {
            "x-flarelobby-last-revision": "99999999999999999999",
          },
        }),
        400,
        "INVALID_PAYLOAD",
      ],
    ] as const) {
      expect(request.status, description).toBe(expectedStatus);
      await expect(request.json()).resolves.toMatchObject({
        code: expectedCode,
      });
    }
  });

  it("未初期化 Room と終了済み Room への Upgrade を拒否する", async () => {
    const principalId = `principal-finish-${crypto.randomUUID()}`;
    const owner = await createRoom(principalId);

    const uninitializedId = `room-never-${crypto.randomUUID()}`;
    const uninitialized = await fetchUpgrade(
      uninitializedId,
      await issuePlayerJoinToken({
        roomId: uninitializedId,
        participantId: "participant-host",
        playerId: "player-host",
        principalId: `principal-never-${crypto.randomUUID()}`,
      }),
    );
    expect(uninitialized.status).toBe(403);
    await expect(uninitialized.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const stub = env.FLARE_LOBBY_ROOMS.getByName(owner.roomId);
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.close({
        gatewayPrincipal: await createPrincipalEnvelope(
          principalId,
          `${principalId}-player`,
        ),
        participantId: owner.participantId,
      });
    });

    const finished = await fetchUpgrade(owner.roomId, owner.joinToken);
    expect(finished.status).toBe(400);
    await expect(finished.json()).resolves.toMatchObject({
      code: "ROOM_FINISHED",
    });
  });

  it("メッセージ上限ヘッダーを反映し、超過送信を切断せずに拒否する", async () => {
    const owner = await createRoom();
    const socket = await connectViaStub(owner.roomId, owner.joinToken, {
      "x-flarelobby-websocket-message-limit": "1",
    });

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });

    sendCommand(socket, "room.set_ready", { ready: true }, "rate-limit-1");
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "success",
      requestId: "rate-limit-1",
    });

    sendCommand(socket, "room.set_ready", { ready: false }, "rate-limit-2");
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "failure",
      requestId: "rate-limit-2",
      error: { code: "CONFLICT" },
    });

    await closeSocket(socket);
  });

  it("解釈できないメッセージには requestId のない失敗を返して接続を閉じる", async () => {
    const owner = await createRoom();
    const socket = await connect(owner);
    await waitForMessage(socket);

    socket.send("{{{not-json");
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "failure",
      requestId: null,
    });
    await expect(waitForMessage(socket, 200)).rejects.toThrow();

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      (_instance: RoomDurableObject, state) => {
        expect(
          state.getWebSockets(getRoomWebSocketTag(owner.roomId)),
        ).toHaveLength(0);
      },
    );
  });

  it("attachment を持たない接続へのメッセージを 1008 で閉じる", async () => {
    const owner = await createRoom();

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      async (instance: RoomDurableObject) => {
        const pair = new WebSocketPair();
        const client = pair[0] as WebSocket;
        const server = pair[1] as WebSocket;
        const closeEvents: number[] = [];

        client.addEventListener("close", (event: Event) => {
          closeEvents.push((event as CloseEvent).code);
        });
        client.accept();
        server.accept();
        await instance.webSocketMessage(server as unknown as WebSocket, "ping");

        await vi.waitFor(() => expect(closeEvents).toEqual([1008]));
      },
    );
  });

  it("WebSocket エラー時も切断状態だけを記録する", async () => {
    const owner = await createRoom();
    const socket = await connect(owner);
    await waitForMessage(socket);

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      async (instance: RoomDurableObject, state) => {
        const serverSocket = state.getWebSockets(
          getRoomWebSocketTag(owner.roomId),
        )[0];

        if (serverSocket === undefined) {
          throw new Error("エラーを注入する接続が見つかりません。");
        }

        await instance.webSocketError(
          serverSocket,
          new Error("意図的なエラー"),
        );
      },
    );

    await waitForDisconnectedConnections(owner.roomId, 1);
    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(owner.roomId),
      (_instance: RoomDurableObject, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM flarelobby_room_participants",
            )
            .one().count,
        ).toBe(1);
      },
    );

    await closeSocket(socket);
  });

  it("猶予期間中は切断しても参加者を削除せず、生きた接続があれば維持する", async () => {
    const roomId = `room-ws-grace-live-${crypto.randomUUID()}`;
    const principalId = `principal-grace-live-${crypto.randomUUID()}`;
    await initializeDirectRoom(roomId, { disconnectGracePeriodMs: 0 });
    const joinToken = await issuePlayerJoinToken({
      roomId,
      participantId: "participant-host",
      playerId: "player-host",
      principalId,
    });
    const socket = await connectViaStub(roomId, joinToken);
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });

    const stub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.disconnect({
        gatewayPrincipal: await createPrincipalEnvelope(
          principalId,
          "player-host",
        ),
        participantId: "participant-host",
      });
    });

    // 接続が生きている間は猶予切れの Alarm でも参加者を削除しない。
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });
    expect(
      (await stub.getSnapshot())?.participants.map(
        (participant: Participant) => participant.id,
      ),
    ).toEqual(["participant-host"]);

    await closeSocket(socket);
    await waitForDisconnectedConnections(roomId, 1);
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const finished = await stub.getSnapshot();
    expect(finished?.participants).toEqual([]);
    expect(finished?.state.status).toBe("finished");
  });

  it("猶予期限切れの再開を拒否し、ホスト単独の Room を閉鎖する", async () => {
    const roomId = `room-ws-grace-expired-${crypto.randomUUID()}`;
    const principalId = `principal-grace-expired-${crypto.randomUUID()}`;
    await initializeDirectRoom(roomId, { disconnectGracePeriodMs: 0 });
    const joinToken = await issuePlayerJoinToken({
      roomId,
      participantId: "participant-host",
      playerId: "player-host",
      principalId,
    });
    const socket = await connectViaStub(roomId, joinToken);
    const initial = await waitForMessage(socket);
    const resumeToken = initial.payload?.resumeToken as string;

    expect(typeof resumeToken).toBe("string");
    await closeSocket(socket);
    await waitForDisconnectedConnections(roomId, 1);

    // 猶予 0ms のため切断と同時に猶予は失効する。Cleanup alarm の発火タイミング
    // に依存しないよう、ここで確定的に Alarm を実行してホスト単独の Room を
    // 閉鎖してから再開を検証する。
    const stub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const snapshot = await stub.getSnapshot();
    expect(snapshot?.state.status).toBe("finished");
    expect(snapshot?.participants).toEqual([]);

    // 閉鎖済み Room への再開は ROOM_FINISHED で拒否される。
    const expired = await fetchUpgrade(roomId, resumeToken);
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({
      code: "ROOM_FINISHED",
    });
    expect(
      (await stub.listScheduledOperations()).map(
        (operation: RoomScheduledOperation) => operation.kind,
      ),
    ).toEqual(["room_retention"]);
  });

  it("古い再開トークンは最新の切断時刻を基準に猶予を付け直して拒否する", async () => {
    const roomId = `room-ws-resume-deferred-${crypto.randomUUID()}`;
    const principalId = `principal-resume-deferred-${crypto.randomUUID()}`;
    await initializeDirectRoom(roomId, { disconnectGracePeriodMs: 60_000 });
    const stub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const firstToken = await issuePlayerJoinToken({
      roomId,
      participantId: "participant-host",
      playerId: "player-host",
      principalId,
    });
    const firstSocket = await connectViaStub(roomId, firstToken);
    const initial = await waitForMessage(firstSocket);
    const staleResumeToken = initial.payload?.resumeToken as string;

    await closeSocket(firstSocket);
    await waitForDisconnectedConnections(roomId, 1);

    // 同一参加者が新しい接続（新しい resumeId）を張り、その接続も閉じる。
    const secondToken = await issuePlayerJoinToken({
      roomId,
      participantId: "participant-host",
      playerId: "player-host",
      principalId,
    });
    const secondSocket = await connectViaStub(roomId, secondToken);
    await waitForMessage(secondSocket);
    await closeSocket(secondSocket);
    await waitForDisconnectedConnections(roomId, 2);

    // 古い接続の切断時刻だけを過去へ動かし、猶予は最新の切断時刻基準で
    // まだ残っている状態を作る。
    await runInDurableObject(stub, (_instance: RoomDurableObject, state) => {
      state.storage.sql.exec(
        `UPDATE flarelobby_room_connections
         SET disconnected_at = ?
         WHERE resume_id = (
           SELECT resume_id
           FROM flarelobby_room_connections
           WHERE room_id = ? AND disconnected_at IS NOT NULL
           ORDER BY connected_at ASC, resume_id ASC
           LIMIT 1
         )`,
        "2026-01-01T00:00:00.000Z",
        roomId,
      );
    });
    const deferred = await fetchUpgrade(roomId, staleResumeToken);
    expect(deferred.status).toBe(403);
    await expect(deferred.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const snapshot = await stub.getSnapshot();
    expect(
      snapshot?.participants.map((participant: Participant) => participant.id),
    ).toEqual(["participant-host"]);
    expect(
      (await stub.listScheduledOperations()).some(
        (operation: RoomScheduledOperation) =>
          operation.kind === "noop" && operation.dueAt > Date.now(),
      ),
    ).toBe(true);
  });

  it("WebSocket コマンドの Payload 検証を個別に行う", async () => {
    const owner = await createRoom();
    const player = await joinRoom(owner.roomId);
    const ownerSocket = await connect(owner);
    const playerSocket = await connect(player);

    await Promise.all([
      waitForMessage(ownerSocket),
      waitForMessage(playerSocket),
    ]);

    const invalidPayloads: Array<[string, unknown]> = [
      ["room.select_team", { teamId: 5 }],
      ["room.update_settings", { settings: "desert" }],
      ["room.transfer_host", {}],
      ["room.kick", { reason: 123 }],
      ["room.start_match", { at: 5 }],
      ["room.close", { at: 5 }],
      ["room.unknown_command", {}],
    ];

    for (const [command, payload] of invalidPayloads) {
      const requestId = `invalid-${crypto.randomUUID()}`;
      sendCommand(ownerSocket, command, payload, requestId);
      await expect(waitForMessage(ownerSocket)).resolves.toMatchObject({
        kind: "failure",
        requestId,
        error: { code: "INVALID_PAYLOAD" },
      });
    }

    sendCommand(playerSocket, "game.chat", { text: "1 回目" }, "game-once");
    await expect(waitForMessage(ownerSocket)).resolves.toMatchObject({
      kind: "event",
      event: "game.message",
    });
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "event",
      event: "game.message",
    });
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "success",
      requestId: "game-once",
    });

    // 同一 requestId・同一 payload の再送は結果を再生するだけで再配信しない。
    sendCommand(playerSocket, "game.chat", { text: "1 回目" }, "game-once");
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "success",
      requestId: "game-once",
    });
    await expect(waitForMessage(ownerSocket, 100)).rejects.toThrow();

    // 同一 requestId で異なる payload は競合として拒否する。
    sendCommand(playerSocket, "game.chat", { text: "別の内容" }, "game-once");
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "failure",
      requestId: "game-once",
      error: { code: "CONFLICT" },
    });

    // 長すぎるゲームメッセージ名は拒否する。
    sendCommand(playerSocket, "a".repeat(129), {}, "too-long-name");
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "failure",
      requestId: "too-long-name",
      error: { code: "INVALID_PAYLOAD" },
    });

    await Promise.all([closeSocket(ownerSocket), closeSocket(playerSocket)]);
  });

  it("閉鎖済み Room のゲームメッセージを ROOM_FINISHED で拒否する", async () => {
    const principalId = `principal-closed-game-${crypto.randomUUID()}`;
    const owner = await createRoom(principalId);
    const socket = await connect(owner);
    await waitForMessage(socket);

    const stub = env.FLARE_LOBBY_ROOMS.getByName(owner.roomId);
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.close({
        gatewayPrincipal: await createPrincipalEnvelope(
          principalId,
          `${principalId}-player`,
        ),
        participantId: owner.participantId,
      });
    });

    sendCommand(socket, "game.chat", { text: "閉鎖後" }, "after-close");
    // 閉鎖時の snapshot イベントが先に配信される。
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
    });
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      kind: "failure",
      requestId: "after-close",
      error: { code: "ROOM_FINISHED" },
    });

    await closeSocket(socket);
  });
});
