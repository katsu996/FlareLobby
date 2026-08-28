import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshot } from "@flarelobby/core";
import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor,
} from "../src/index.js";

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static autoOpen = true;

  public readonly sent: string[] = [];
  public readyState = 0;

  private readonly listeners = new Map<string, Set<EventListener>>();

  public constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) {
      queueMicrotask(() => this.open());
    }
  }

  public addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error("socket is not open");
    }
    this.sent.push(data);
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === 3) {
      return;
    }

    this.readyState = 3;
    this.emit(
      "close",
      new CloseEvent("close", {
        code: code ?? 1000,
        reason: reason ?? "",
      }),
    );
  }

  public receive(value: unknown): void {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }

  public open(): void {
    if (this.readyState === 1) {
      return;
    }

    this.emit("open", new Event("open"));
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }

    if (type === "open") {
      this.readyState = 1;
    }
  }
}

const webSocket = FakeWebSocket as unknown as WebSocketConstructor;

function createSnapshot(
  revision: number,
  options: {
    readonly roomId?: string;
    readonly participantId?: string;
    readonly hostParticipantId?: string;
    readonly status?: string;
  } = {},
): RoomSnapshot {
  const roomId = options.roomId ?? "room-1";
  const participantId = options.participantId ?? "participant-owner";
  const hostParticipantId = options.hostParticipantId ?? participantId;

  return {
    revision,
    state: { status: options.status ?? "waiting" } as RoomSnapshot["state"],
    room: {
      id: roomId,
      kind: "custom",
      invitationCode: "ABC123",
      visibility: "public",
      settings: { map: "forest" },
      metadata: { name: "練習ルーム" },
    },
    host: {
      participantId: hostParticipantId,
      playerId: "owner-player",
    },
    participants: [
      {
        kind: "player",
        id: participantId,
        player: { id: "owner-player" },
        teamId: null,
        ready: false,
      },
      {
        kind: "player",
        id: "participant-guest",
        player: { id: "guest-player" },
        teamId: null,
        ready: false,
      },
    ],
    teams: [{ id: "red" }, { id: "blue" }],
  } as RoomSnapshot;
}

function creationResponse(snapshot = createSnapshot(1)): Response {
  return Response.json({
    roomId: snapshot.room.id,
    participantId: "participant-owner",
    role: "player",
    joinMethod: "invitation",
    invitationCode: "ABC123",
    joinToken: "join-token-owner",
    websocketUrl: `wss://example.test/v1/custom-rooms/${snapshot.room.id}/ws`,
    snapshot,
  });
}

function joinResponse(
  role: "player" | "spectator",
  snapshot = createSnapshot(2, {
    participantId:
      role === "spectator" ? "participant-spectator" : "participant-guest",
    hostParticipantId: "participant-owner",
  }),
): Response {
  return Response.json({
    roomId: snapshot.room.id,
    participantId:
      role === "spectator" ? "participant-spectator" : "participant-guest",
    role,
    joinToken: `join-token-${role}`,
    websocketUrl: `wss://example.test/v1/custom-rooms/${snapshot.room.id}/ws`,
    snapshot,
  });
}

function createClient(fetch: FetchImplementation) {
  let requestNumber = 0;
  return createFlareLobbyClient({
    endpoint: "https://example.test",
    getAccessToken: () => "access-token",
    fetch,
    webSocket,
    requestIdFactory: () => `request-${++requestNumber}`,
  });
}

function encodeWebSocketToken(token: string): string {
  return btoa(token)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function lastCommand(socket: FakeWebSocket): {
  readonly requestId: string;
  readonly command: string;
  readonly payload: Record<string, unknown>;
} {
  const value = JSON.parse(socket.sent.at(-1) ?? "{}") as {
    requestId: string;
    command: string;
    payload: Record<string, unknown>;
  };
  return value;
}

// 再接続は setTimeout 経由で再試行されるため、実際のタスクループを
// 数ミリ秒回して完了を待ちます（vi.useFakeTimers() には依存しません）。
async function flushAsync(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("@flarelobby/client custom room API", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
  });

  it("作成・招待参加・観戦参加・一覧取得を公開メソッドから利用できる", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async (input) => {
      const url = input.toString();
      if (url.includes("/v1/custom-rooms?")) {
        return Response.json({
          rooms: [
            {
              id: "room-1",
              kind: "custom",
              visibility: "public",
              state: "waiting",
              playerCount: 1,
              maxPlayers: 4,
            },
          ],
          nextCursor: "next-page",
        });
      }
      if (url.endsWith("/v1/custom-rooms/join")) {
        return joinResponse("spectator");
      }
      return creationResponse();
    });
    const client = createClient(fetchImplementation);

    const host = await client.createCustomRoom({
      maxPlayers: 4,
      name: "練習ルーム",
    });
    const spectator = await client.joinCustomRoom({
      invitationCode: "ABC123",
      role: "spectator",
    });
    const page = await client.listCustomRooms({
      mode: "casual",
      status: ["waiting"],
      available: true,
      cursor: "first",
    });

    expect(host.role).toBe("host");
    expect(host.participantRole).toBe("player");
    expect(FakeWebSocket.instances[0]?.protocols).toContain(
      `flarelobby.auth.${encodeWebSocketToken("join-token-owner")}`,
    );
    expect(spectator.role).toBe("spectator");
    expect(page.nextCursor).toBe("next-page");
    expect(page.rooms[0]?.id).toBe("room-1");

    const createCall = vi.mocked(fetchImplementation).mock.calls[0];
    expect(createCall?.[0].toString()).toBe(
      "https://example.test/v1/custom-rooms",
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      name: "練習ルーム",
      maxPlayers: 4,
    });
    expect(vi.mocked(fetchImplementation).mock.calls[1]?.[0].toString()).toBe(
      "https://example.test/v1/custom-rooms/join",
    );
    expect(
      JSON.parse(
        String(vi.mocked(fetchImplementation).mock.calls[1]?.[1]?.body),
      ),
    ).toEqual({
      invitationCode: "ABC123",
      role: "spectator",
    });
    expect(
      vi.mocked(fetchImplementation).mock.calls[2]?.[0].toString(),
    ).toContain("status=waiting");
    expect(
      vi.mocked(fetchImplementation).mock.calls[2]?.[0].toString(),
    ).toContain("available=true");
  });

  it("スナップショットを凍結し、全操作がサーバー応答後に完了する", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async (input) => {
      if (input.toString().endsWith("/leave")) {
        return Response.json({
          snapshot: createSnapshot(10),
          participantId: "participant-owner",
          role: "player",
        });
      }
      return creationResponse();
    });
    const client = createClient(fetchImplementation);
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];

    if (socket === undefined) {
      throw new Error("Room WebSocket が作成されていません。");
    }

    expect(Object.isFrozen(room.snapshot)).toBe(true);
    expect(Object.isFrozen(room.snapshot.room)).toBe(true);
    expect(() => {
      (
        room.snapshot.room as unknown as { metadata: { name: string } }
      ).metadata.name = "変更";
    }).toThrow();

    socket.receive({
      protocolVersion: 1,
      kind: "event",
      event: "room.snapshot",
      revision: 2,
      payload: createSnapshot(2),
    });
    expect(room.snapshot.revision).toBe(2);

    const operations: Array<{
      readonly call: () => Promise<RoomSnapshot>;
      readonly command: string;
      readonly payload: Record<string, unknown>;
    }> = [
      {
        call: () => room.setReady(true),
        command: "room.set_ready",
        payload: { ready: true },
      },
      {
        call: () => room.selectTeam("red"),
        command: "room.select_team",
        payload: { teamId: "red" },
      },
      {
        call: () => room.updateSettings({ map: "desert" }),
        command: "room.update_settings",
        payload: { settings: { map: "desert" } },
      },
      {
        call: () => room.transferHost("participant-guest"),
        command: "room.transfer_host",
        payload: { targetParticipantId: "participant-guest" },
      },
      {
        call: () => room.kick("participant-guest"),
        command: "room.kick",
        payload: { targetParticipantId: "participant-guest" },
      },
      {
        call: () => room.startMatch({ at: "2026-08-11T00:00:00.000Z" }),
        command: "room.start_match",
        payload: { at: "2026-08-11T00:00:00.000Z" },
      },
    ];

    for (const [index, operation] of operations.entries()) {
      const promise = operation.call();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(lastCommand(socket)).toMatchObject({
        command: operation.command,
        payload: operation.payload,
      });
      socket.receive({
        protocolVersion: 1,
        kind: "success",
        requestId: lastCommand(socket).requestId,
        payload: createSnapshot(index + 2),
      });
      await expect(promise).resolves.toMatchObject({
        revision: index + 2,
      });
    }

    const sendPromise = room.send("chat.message", { text: "こんにちは" });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(lastCommand(socket)).toMatchObject({
      command: "chat.message",
      payload: { text: "こんにちは" },
    });
    socket.receive({
      protocolVersion: 1,
      kind: "success",
      requestId: lastCommand(socket).requestId,
      payload: null,
    });
    await expect(sendPromise).resolves.toBeUndefined();

    const closePromise = room.close();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(lastCommand(socket).command).toBe("room.close");
    socket.receive({
      protocolVersion: 1,
      kind: "success",
      requestId: lastCommand(socket).requestId,
      payload: createSnapshot(9, { status: "finished" }),
    });
    await expect(closePromise).resolves.toMatchObject({ revision: 9 });
    expect(room.closed).toBe(true);
  });

  it("退出を HTTP で完了し、観戦者と非ホストの権限違反を公開エラーにする", async () => {
    let joinCount = 0;
    const fetchImplementation: FetchImplementation = vi.fn(
      async (input, init) => {
        if (input.toString().endsWith("/join")) {
          joinCount += 1;
          return joinResponse(joinCount === 1 ? "spectator" : "player");
        }
        if (input.toString().endsWith("/leave")) {
          expect(String(init?.body)).toContain("join-token-spectator");
          return Response.json({
            snapshot: createSnapshot(3, {
              participantId: "participant-spectator",
            }),
            participantId: "participant-spectator",
            role: "spectator",
          });
        }
        return creationResponse();
      },
    );
    const client = createClient(fetchImplementation);
    const spectator = await client.joinCustomRoom({
      invitationCode: "ABC123",
      role: "spectator",
    });
    const player = await client.joinCustomRoom("ABC123");

    await expect(
      (spectator as unknown as { setReady: () => Promise<unknown> }).setReady(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      (
        player as unknown as {
          updateSettings: (settings: {
            readonly map: string;
          }) => Promise<unknown>;
        }
      ).updateSettings({ map: "desert" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(spectator.leave()).resolves.toMatchObject({ revision: 3 });
    expect(spectator.closed).toBe(true);
  });

  it("WebSocket の失敗応答を FlareLobbyError として通知する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];

    if (socket === undefined) {
      throw new Error("Room WebSocket が作成されていません。");
    }

    const promise = room.setReady(true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    socket.receive({
      protocolVersion: 1,
      kind: "failure",
      requestId: lastCommand(socket).requestId,
      error: { code: "FORBIDDEN", message: "権限がありません。" },
    });
    await expect(promise).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "権限がありません。",
    });
  });

  it("subscribe / on / onMessage で状態・イベント・ゲームメッセージを購読できる", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];

    if (socket === undefined) {
      throw new Error("Room WebSocket が作成されていません。");
    }

    const snapshots: RoomSnapshot[] = [];
    const unsubscribeSnapshot = room.subscribe((snapshot) =>
      snapshots.push(snapshot),
    );
    const envelopes: unknown[] = [];
    const unsubscribeEvent = room.on("game.message", (event) =>
      envelopes.push(event),
    );

    let throwingListenerCalls = 0;
    room.onMessage("chat.message", () => {
      throwingListenerCalls += 1;
      throw new Error("listener failure");
    });
    const messagesAfterFailure: Array<Record<string, unknown>> = [];
    const unsubscribeMessages = room.onMessage("chat.message", (message) => {
      messagesAfterFailure.push({ ...message });
    });

    socket.receive({
      protocolVersion: 1,
      kind: "event",
      event: "room.snapshot",
      revision: 2,
      payload: createSnapshot(2),
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.revision).toBe(2);
    expect(Object.isFrozen(snapshots[0])).toBe(true);

    socket.receive({
      protocolVersion: 1,
      kind: "event",
      event: "game.message",
      revision: 3,
      payload: {
        name: "chat.message",
        payload: { text: "やあ" },
        sender: { participantId: "participant-guest", role: "player" },
      },
    });
    // name を持たない game.message はメッセージ購読者へ配信されません。
    socket.receive({
      protocolVersion: 1,
      kind: "event",
      event: "game.message",
      revision: 4,
      payload: { text: "name なし" },
    });

    expect(throwingListenerCalls).toBe(1);
    expect(messagesAfterFailure).toEqual([
      {
        name: "chat.message",
        payload: { text: "やあ" },
        revision: 3,
        sender: { participantId: "participant-guest", role: "player" },
      },
    ]);
    // 不正なイベントも含めて生の Envelope は汎用購読者へ届きます。
    expect(envelopes).toHaveLength(2);

    unsubscribeSnapshot();
    unsubscribeEvent();
    unsubscribeMessages();
    socket.receive({
      protocolVersion: 1,
      kind: "event",
      event: "game.message",
      revision: 5,
      payload: { name: "chat.message", payload: {} },
    });
    expect(envelopes).toHaveLength(2);
    expect(messagesAfterFailure).toHaveLength(1);

    let invalidEventError: unknown = null;
    try {
      room.on("", () => undefined);
    } catch (error) {
      invalidEventError = error;
    }
    let invalidMessageError: unknown = null;
    try {
      room.onMessage("", () => undefined);
    } catch (error) {
      invalidMessageError = error;
    }
    expect(invalidEventError).toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(invalidMessageError).toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("版の飛びや不一致な room.snapshot は再同期を要求する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom({
      reconnect: {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
      },
    });

    const badEvents: Record<string, unknown>[] = [
      // 現在の版から飛んでいるイベント (gap)
      {
        protocolVersion: 1,
        kind: "event",
        event: "room.snapshot",
        revision: 5,
        payload: createSnapshot(5),
      },
      // Envelope の revision と Snapshot の revision が不一致
      {
        protocolVersion: 1,
        kind: "event",
        event: "room.snapshot",
        revision: 2,
        payload: createSnapshot(7),
      },
      // Snapshot として解釈できない payload
      {
        protocolVersion: 1,
        kind: "event",
        event: "room.snapshot",
        revision: 2,
        payload: { broken: true },
      },
    ];
    for (const [index, badEvent] of badEvents.entries()) {
      const socket = FakeWebSocket.instances[index];
      if (socket === undefined) {
        throw new Error("Room WebSocket が作成されていません。");
      }

      socket.receive(badEvent);
      expect(socket.readyState).toBe(3);
      expect(room.snapshot.revision).toBe(1);
      await flushAsync();
    }

    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(room.connectionStatus).toBe("connected");
  });

  it("resumeToken を保持し、再接続時に lastRevision を添えて再開する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom({
      reconnect: {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
      },
    });

    // サーバーが Snapshot へ拡張フィールド (resumeToken) を添えた応答を再現します。
    const resumeSnapshot = {
      ...createSnapshot(2),
      resumeToken: "resume-token-1",
    } as RoomSnapshot & { readonly resumeToken: string };
    FakeWebSocket.instances[0]?.receive({
      protocolVersion: 1,
      kind: "event",
      event: "room.snapshot",
      revision: 2,
      payload: resumeSnapshot,
    });
    expect(room.snapshot.revision).toBe(2);

    FakeWebSocket.instances[0]?.close(1006);
    await flushAsync();

    const reconnected = FakeWebSocket.instances[1];
    if (reconnected === undefined) {
      throw new Error("再接続用の WebSocket が作成されていません。");
    }
    expect(reconnected.url).toContain("lastRevision=2");
    expect(reconnected.protocols).toContain(
      `flarelobby.auth.${encodeWebSocketToken("resume-token-1")}`,
    );

    reconnected.receive({
      protocolVersion: 1,
      kind: "event",
      event: "room.snapshot",
      revision: 3,
      payload: createSnapshot(3),
    });
    expect(room.snapshot.revision).toBe(3);
    expect(room.connectionStatus).toBe("connected");
  });

  it("再接続に失敗し続けると disconnected になり、以降の操作を拒否する", async () => {
    FakeWebSocket.autoOpen = false;
    const client = createClient(vi.fn(async () => creationResponse()));
    const pending = client.createCustomRoom({
      reconnect: {
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
      },
    });
    await flushAsync();
    FakeWebSocket.instances[0]?.open();
    const room = await pending;

    FakeWebSocket.instances[0]?.close(1006);
    await flushAsync(5);
    FakeWebSocket.instances[1]?.close(1006);
    await flushAsync(5);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(room.connectionStatus).toBe("disconnected");
    expect(room.closed).toBe(true);
    await expect(room.setReady(true)).rejects.toMatchObject({
      code: "CANCELLED",
    });

    let subscribeError: unknown = null;
    try {
      room.subscribe(() => undefined);
    } catch (error) {
      subscribeError = error;
    }
    expect(subscribeError).toMatchObject({ code: "CANCELLED" });
  });

  it("再接続待ちの間は WebSocket 操作を CONNECTION_FAILED で拒否する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom({
      reconnect: {
        maxAttempts: 3,
        baseDelayMs: 60_000,
        maxDelayMs: 60_000,
        jitterRatio: 0,
      },
    });

    FakeWebSocket.instances[0]?.close(1006);
    expect(room.connectionStatus).toBe("reconnecting");
    await expect(room.setReady(true)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    await expect(room.leave()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("非再試行エラーの切断では再接続せず切断状態で停止する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom({
      reconnect: {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
      },
    });
    const statuses: string[] = [];
    room.onStatusChange((status) => statuses.push(status));

    FakeWebSocket.instances[0]?.close(4403);
    await flushAsync();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses).toEqual(["disconnected"]);
    expect(room.closed).toBe(true);
    expect(room.connectionStatus).toBe("disconnected");

    let subscribeError: unknown = null;
    try {
      room.subscribe(() => undefined);
    } catch (error) {
      subscribeError = error;
    }
    expect(subscribeError).toMatchObject({ code: "CANCELLED" });
  });

  it("作成・参加・一覧・退出の不正な応答を CONNECTION_FAILED で公開する", async () => {
    const badCreationClient = createClient(
      vi.fn(async () => Response.json({ roomId: "" })),
    );
    await expect(badCreationClient.createCustomRoom()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });

    const badJoinFetch: FetchImplementation = vi.fn(async (input) =>
      input.toString().endsWith("/join")
        ? Response.json({})
        : creationResponse(),
    );
    const badJoinClient = createClient(badJoinFetch);
    await expect(badJoinClient.joinCustomRoom("ABC123")).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });

    const badListClient = createClient(vi.fn(async () => Response.json(null)));
    await expect(badListClient.listCustomRooms({})).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });

    const badRoomsClient = createClient(
      vi.fn(async () => Response.json({ rooms: "not-an-array" })),
    );
    await expect(badRoomsClient.listCustomRooms({})).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });

    const badLeaveFetch: FetchImplementation = vi.fn(async (input) =>
      input.toString().endsWith("/leave")
        ? Response.json({ snapshot: null })
        : creationResponse(),
    );
    const badLeaveClient = createClient(badLeaveFetch);
    const room = await badLeaveClient.createCustomRoom();
    await expect(room.leave()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    // 応答が不正な間はハンドルが閉じられることはありません。
    expect(room.closed).toBe(false);
  });

  it("invitationCode と code が不一致の参加要求は CONFLICT になる", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));

    await expect(
      client.joinCustomRoom({ invitationCode: "AAA111", code: "BBB222" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("不正な再接続設定は INVALID_PAYLOAD で拒否される", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));

    await expect(
      client.createCustomRoom({ reconnect: { jitterRatio: 2 } }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.createCustomRoom({
        reconnect: { baseDelayMs: Number.MAX_SAFE_INTEGER },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.joinCustomRoom({
        invitationCode: "ABC123",
        reconnect: { maxAttempts: -1 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("kick は対象オブジェクトから payload を組み立てる", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];

    if (socket === undefined) {
      throw new Error("Room WebSocket が作成されていません。");
    }

    const promise = room.kick({
      participantId: "participant-guest",
      playerId: "guest-player",
      reason: "マナー違反",
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(lastCommand(socket)).toMatchObject({
      command: "room.kick",
      payload: {
        targetParticipantId: "participant-guest",
        targetPlayerId: "guest-player",
        reason: "マナー違反",
      },
    });

    socket.receive({
      protocolVersion: 1,
      kind: "success",
      requestId: lastCommand(socket).requestId,
      payload: createSnapshot(2),
    });
    await expect(promise).resolves.toMatchObject({ revision: 2 });
  });

  it("コマンド応答が Snapshot でない場合は CONNECTION_FAILED になる", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];

    if (socket === undefined) {
      throw new Error("Room WebSocket が作成されていません。");
    }

    const promise = room.setReady(true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    socket.receive({
      protocolVersion: 1,
      kind: "success",
      requestId: lastCommand(socket).requestId,
      payload: null,
    });

    await expect(promise).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("custom 以外のルームではホストでも player 権限として扱われる", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    expect(room.role).toBe("host");
    // room.kind を match に差し替えた Snapshot（検証は isRoomSnapshot が担う）。
    const base = createSnapshot(2);
    const matchSnapshot = {
      ...base,
      room: { ...base.room, kind: "match" },
    } as unknown as RoomSnapshot;
    FakeWebSocket.instances[0]?.receive({
      protocolVersion: 1,
      kind: "event",
      event: "room.snapshot",
      revision: 2,
      payload: matchSnapshot,
    });

    expect(room.role).toBe("player");
    await expect(room.updateSettings({ map: "desert" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
