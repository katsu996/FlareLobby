import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshot } from "@flarelobby/core";
import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor,
} from "../src/index.js";

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];

  public readonly sent: string[] = [];
  public readyState = 0;

  private readonly listeners = new Map<string, Set<EventListener>>();

  public constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", new Event("open")));
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

describe("@flarelobby/client custom room API", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
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
});
