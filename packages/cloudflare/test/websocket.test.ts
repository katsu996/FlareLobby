import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  defineFlareLobby,
  getRoomWebSocketTag,
  RoomDurableObject
} from "../src/index.js";

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 2,
    defaultSettings: { map: "forest", mode: "casual" }
  },
  matchmakingPools: [],
  authenticate: (request) => {
    const id = request.headers.get("x-test-principal") ?? "principal-test";

    return { id, playerId: `${id}-player` };
  },
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
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
  principalId = `principal-${crypto.randomUUID()}`
): Promise<RoomResult> {
  const response = await testWorker.fetch(
    new Request("https://example.test/v1/custom-rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-principal": principalId
      },
      body: JSON.stringify({ requestId: `request-${crypto.randomUUID()}` })
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext
  );

  expect(response.status).toBe(201);
  return response.json<RoomResult>();
}

async function joinRoom(
  roomId: string,
  principalId = `principal-${crypto.randomUUID()}`,
  role: "player" | "spectator" = "player"
): Promise<RoomResult> {
  const response = await testWorker.fetch(
    new Request("https://example.test/v1/custom-rooms/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-principal": principalId
      },
      body: JSON.stringify({
        requestId: `request-${crypto.randomUUID()}`,
        roomId,
        role
      })
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext
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
  protocol = "flarelobby.v1"
): Request {
  return new Request(
    `https://example.test/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`,
    {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `${protocol}, flarelobby.auth.${encodeWebSocketToken(token)}`
      }
    }
  );
}

async function connect(room: RoomResult): Promise<WebSocket> {
  const response = await testWorker.fetch(
    createWebSocketRequest(room.roomId, room.joinToken) as unknown as Parameters<
      typeof testWorker.fetch
    >[0],
    env,
    {} as ExecutionContext
  );

  expect(response.status).toBe(101);

  if (response.webSocket === null) {
    throw new Error("WebSocket が Upgrade 応答に含まれていません。");
  }

  const socket = response.webSocket;
  const messages: WebSocketEvent[] = [];
  const waiters: Array<{
    readonly resolve: (message: WebSocketEvent) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  let socketError: Error | null = null;

  socket.addEventListener("message", (event: Event) => {
    const message = JSON.parse((event as MessageEvent).data as string) as WebSocketEvent;
    const waiter = waiters.shift();

    if (waiter) {
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  socket.addEventListener("error", () => {
    socketError = new Error("WebSocket のメッセージ待機中にエラーが発生しました。");

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
          }
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
    }
  });

  socket.accept();
  return socket;
}

function waitForMessage(webSocket: WebSocket, timeoutMs?: number): Promise<WebSocketEvent> {
  const inbox = socketInboxes.get(webSocket);

  if (inbox === undefined) {
    throw new Error("テスト用 WebSocket の受信キューが登録されていません。");
  }

  return inbox.next(timeoutMs);
}

async function waitForDisconnectedConnections(
  roomId: string,
  expectedCount: number
): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const count = await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(roomId),
      (_instance: RoomDurableObject, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_room_connections WHERE room_id = ? AND disconnected_at IS NOT NULL",
            roomId
          )
          .one().count
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
  requestId = `request-${crypto.randomUUID()}`
): void {
  webSocket.send(
    JSON.stringify({
      protocolVersion: 1,
      kind: "command",
      requestId,
      command,
      payload
    })
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
      payload: { room: { id: owner.roomId } }
    });
    const playerInitialEvent = await waitForMessage(playerSocket);
    expect(playerInitialEvent).toMatchObject({
      kind: "event",
      event: "room.snapshot"
    });
    await expect(waitForMessage(otherSocket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot"
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
            playerId: expect.any(String)
          }
        });
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM flarelobby_room_connections WHERE room_id = ? AND disconnected_at IS NULL",
              owner.roomId
            )
            .one().count
        ).toBe(2);
      }
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
          expect.objectContaining({ id: player.participantId, ready: true })
        ])
      }
    });
    expect(playerEvent).toMatchObject({
      kind: "event",
      event: "room.snapshot"
    });
    expect(playerResponse).toMatchObject({
      kind: "success",
      requestId: expect.any(String)
    });

    await expect(waitForMessage(otherSocket, 50)).rejects.toThrow(
      "WebSocket メッセージがタイムアウトしました。"
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
              player.participantId
            )
            .one().count
        ).toBe(1);
      }
    );
  });

  it("参加用トークン、プロトコル、Payload、役割権限を個別に拒否する", async () => {
    const owner = await createRoom();
    const spectator = await joinRoom(owner.roomId, undefined, "spectator");
    const invalidTokenResponse = await testWorker.fetch(
      createWebSocketRequest(owner.roomId, "invalid-token") as unknown as Parameters<
        typeof testWorker.fetch
      >[0],
      env,
      {} as ExecutionContext
    );
    expect(invalidTokenResponse.status).toBe(401);

    const invalidProtocolResponse = await testWorker.fetch(
      createWebSocketRequest(owner.roomId, owner.joinToken, "flarelobby.v2") as unknown as Parameters<
        typeof testWorker.fetch
      >[0],
      env,
      {} as ExecutionContext
    );
    expect(invalidProtocolResponse.status).toBe(400);
    await expect(invalidProtocolResponse.json()).resolves.toMatchObject({
      code: "INVALID_MESSAGE"
    });

    const spectatorSocket = await connect(spectator);
    await waitForMessage(spectatorSocket);

    sendCommand(spectatorSocket, "room.set_ready", { ready: true });
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "FORBIDDEN" }
    });

    sendCommand(spectatorSocket, "game.chat", { text: "閲覧者からの送信" });
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "FORBIDDEN" }
    });

    sendCommand(spectatorSocket, "room.set_ready", { ready: "yes" });
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "INVALID_PAYLOAD" }
    });

    const unsupportedVersion = JSON.stringify({
      protocolVersion: 99,
      kind: "command",
      requestId: `request-${crypto.randomUUID()}`,
      command: "room.set_ready",
      payload: { ready: true }
    });
    spectatorSocket.send(unsupportedVersion);
    await expect(waitForMessage(spectatorSocket)).resolves.toMatchObject({
      kind: "failure",
      error: { code: "UNSUPPORTED_PROTOCOL_VERSION" }
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
      waitForMessage(playerSocket)
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
      }
    );

    sendCommand(playerSocket, "room.set_ready", { ready: true });
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "event",
      event: "room.snapshot",
      payload: {
        participants: expect.arrayContaining([
          expect.objectContaining({ id: player.participantId, ready: true })
        ])
      }
    });
    await expect(waitForMessage(playerSocket)).resolves.toMatchObject({
      kind: "success"
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
      waitForMessage(otherSocket)
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
        sender: { participantId: player.participantId, role: "player" }
      }
    });
    expect(playerEvent).toMatchObject({
      kind: "event",
      event: "game.message"
    });
    expect(playerResponse).toMatchObject({ kind: "success" });

    await expect(waitForMessage(otherSocket, 50)).rejects.toThrow(
      "WebSocket メッセージがタイムアウトしました。"
    );

    await Promise.all([
      closeSocket(ownerSocket),
      closeSocket(playerSocket),
      closeSocket(otherSocket)
    ]);
  });
});
