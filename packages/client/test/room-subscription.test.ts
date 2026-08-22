import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshot } from "@flarelobby/core";
import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor,
} from "../src/index.js";

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static failOpenCount = 0;

  public readonly sent: string[] = [];
  public readyState = 0;

  public constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (FakeWebSocket.failOpenCount > 0) {
        FakeWebSocket.failOpenCount -= 1;
        this.close(1006, "temporary failure");
        return;
      }
      this.emit("open", new Event("open"));
    });
  }

  private readonly listeners = new Map<string, Set<EventListener>>();

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

function createSnapshot(revision: number): RoomSnapshot {
  return {
    revision,
    state: { status: "waiting" },
    room: {
      id: "room-1",
      kind: "custom",
      invitationCode: "ABC123",
      visibility: "public",
      settings: { map: "forest" },
      metadata: { name: "練習ルーム" },
    },
    host: {
      participantId: "participant-owner",
      playerId: "owner-player",
    },
    participants: [
      {
        kind: "player",
        id: "participant-owner",
        player: { id: "owner-player" },
        teamId: null,
        ready: false,
      },
    ],
    teams: [{ id: "red" }, { id: "blue" }],
  } as RoomSnapshot;
}

function creationResponse(): Response {
  return Response.json({
    roomId: "room-1",
    participantId: "participant-owner",
    role: "player",
    joinMethod: "invitation",
    invitationCode: "ABC123",
    joinToken: "join-token-owner",
    websocketUrl: "wss://example.test/v1/custom-rooms/room-1/ws",
    snapshot: createSnapshot(0),
  });
}

function createClient(fetchImplementation: FetchImplementation) {
  return createFlareLobbyClient({
    endpoint: "https://example.test",
    getAccessToken: () => "access-token",
    fetch: fetchImplementation,
    webSocket,
    reconnect: {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 250,
      jitterRatio: 0,
    },
  });
}

function snapshotEvent(
  revision: number,
  options: { readonly resumeToken?: string } = {},
) {
  return {
    protocolVersion: 1,
    kind: "event",
    event: "room.snapshot",
    revision,
    payload: {
      ...createSnapshot(revision),
      ...(options.resumeToken === undefined
        ? {}
        : {
            resumeToken: options.resumeToken,
            resumeTokenExpiresAt: Date.now() + 60_000,
            resume: {
              participantId: "participant-owner",
              role: "player",
              resumed: true,
            },
          }),
    },
  };
}

describe("Room の状態購読と自動再接続", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.failOpenCount = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("スナップショットを一度だけ通知し、解除後と逆順・重複では通知しない", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) {
      throw new Error("初期 WebSocket がありません。");
    }

    const listener = vi.fn();
    const unsubscribe = room.subscribe(listener);
    socket.receive(snapshotEvent(1, { resumeToken: "resume-token" }));
    socket.receive(snapshotEvent(1));
    socket.receive(snapshotEvent(2));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 2 }),
    );
    expect(room.snapshot.revision).toBe(2);

    unsubscribe();
    socket.receive(snapshotEvent(1));
    expect(listener).toHaveBeenCalledTimes(2);

    socket.receive(snapshotEvent(0));
    expect(room.connectionStatus).toBe("reconnecting");
  });

  it("購読者例外で内部状態と他の購読者を止めず、イベントとメッセージを型付きで通知する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) {
      throw new Error("初期 WebSocket がありません。");
    }

    const snapshots = vi.fn();
    room.subscribe(() => {
      throw new Error("snapshot listener failure");
    });
    room.subscribe(snapshots);

    const systemEvent = vi.fn();
    room.on("room.snapshot", systemEvent);
    const throwingMessageListener = vi.fn(() => {
      throw new Error("message listener failure");
    });
    const messageListener = vi.fn();
    room.onMessage("chat.message", throwingMessageListener);
    room.onMessage("chat.message", messageListener);

    socket.receive(snapshotEvent(1));
    socket.receive({
      protocolVersion: 1,
      kind: "event",
      event: "game.message",
      revision: 1,
      payload: {
        name: "chat.message",
        payload: { text: "こんにちは" },
        sender: { participantId: "participant-owner", role: "player" },
      },
    });

    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(systemEvent).toHaveBeenCalledTimes(1);
    expect(messageListener).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "chat.message",
        payload: { text: "こんにちは" },
        revision: 1,
      }),
    );
    expect(room.snapshot.revision).toBe(1);
  });

  it("切断後に指数バックオフで再接続し、resumeTokenと最終revisionを送る", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const firstSocket = FakeWebSocket.instances[0];
    if (firstSocket === undefined) {
      throw new Error("初期 WebSocket がありません。");
    }

    const statuses: string[] = [];
    room.onStatusChange((status) => statuses.push(status));
    firstSocket.receive(snapshotEvent(0, { resumeToken: "resume-token" }));
    firstSocket.receive(snapshotEvent(1));
    firstSocket.close(1006, "temporary failure");

    expect(room.connectionStatus).toBe("reconnecting");
    expect(statuses).toEqual(["reconnecting"]);
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const reconnectSocket = FakeWebSocket.instances[1];
    expect(reconnectSocket?.url).toBe(
      "wss://example.test/v1/custom-rooms/room-1/ws?lastRevision=1",
    );
    expect(reconnectSocket?.protocols).toContain(
      `flarelobby.auth.${btoa("resume-token")}`,
    );
    expect(room.connectionStatus).toBe("connected");
    expect(statuses).toEqual(["reconnecting", "connected"]);
  });

  it("欠落イベントを再同期し、認証失敗では再試行を停止する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const firstSocket = FakeWebSocket.instances[0];
    if (firstSocket === undefined) {
      throw new Error("初期 WebSocket がありません。");
    }

    const statuses: string[] = [];
    room.onStatusChange((status) => statuses.push(status));
    firstSocket.receive(snapshotEvent(0, { resumeToken: "resume-token" }));
    firstSocket.receive(snapshotEvent(2));
    expect(room.snapshot.revision).toBe(0);
    expect(room.connectionStatus).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(100);
    const reconnectSocket = FakeWebSocket.instances[1];
    if (reconnectSocket === undefined) {
      throw new Error("再接続 WebSocket がありません。");
    }
    reconnectSocket.receive({
      protocolVersion: 1,
      kind: "failure",
      requestId: null,
      error: { code: "UNAUTHENTICATED", message: "認証が必要です。" },
    });

    expect(room.connectionStatus).toBe("disconnected");
    expect(room.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(statuses).toEqual(["reconnecting", "connected", "disconnected"]);
  });

  it("複数回の一時失敗後も上限付きバックオフで復旧する", async () => {
    const client = createClient(vi.fn(async () => creationResponse()));
    const room = await client.createCustomRoom();
    const firstSocket = FakeWebSocket.instances[0];
    if (firstSocket === undefined) {
      throw new Error("初期 WebSocket がありません。");
    }

    firstSocket.receive(snapshotEvent(0, { resumeToken: "resume-token" }));
    FakeWebSocket.failOpenCount = 2;
    firstSocket.close(1006, "temporary failure");

    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(249);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(room.connectionStatus).toBe("connected");
    expect(FakeWebSocket.instances[3]?.protocols).toContain(
      `flarelobby.auth.${btoa("resume-token")}`,
    );
  });

  it("明示退出後は自動再接続せず、接続状態を切断済みにする", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async (input) => {
      if (input.toString().endsWith("/leave")) {
        return Response.json({ snapshot: createSnapshot(1) });
      }
      return creationResponse();
    });
    const client = createClient(fetchImplementation);
    const room = await client.createCustomRoom();
    const statuses: string[] = [];
    room.onStatusChange((status) => statuses.push(status));

    await expect(room.leave()).resolves.toMatchObject({ revision: 1 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(room.closed).toBe(true);
    expect(room.connectionStatus).toBe("disconnected");
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses).toEqual(["disconnected"]);
  });
});
