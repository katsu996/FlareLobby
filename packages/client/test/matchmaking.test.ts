import { describe, expect, it, vi } from "vitest";

import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor
} from "../src/index.js";
import type {
  MatchmakingPool,
  MatchmakingTicket as CoreMatchmakingTicket,
  RoomSnapshot
} from "@flarelobby/core";

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static autoOpen = true;

  public readonly url: string;
  public readonly protocols: string | string[] | undefined;
  public readonly sent: string[] = [];
  public readyState = 0;

  private readonly listeners = new Map<string, Set<EventListener>>();

  public constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
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

  public close(code = 1000, reason = ""): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.emit("close", new CloseEvent("close", { code, reason }));
  }

  public open(): void {
    this.readyState = 1;
    this.emit("open", new Event("open"));
  }

  public drop(code = 1006): void {
    this.readyState = 3;
    this.emit("close", new CloseEvent("close", { code }));
  }

  public receive(data: string): void {
    this.emit("message", new MessageEvent("message", { data }));
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const webSocket = FakeWebSocket as unknown as WebSocketConstructor;

const pool: MatchmakingPool = {
  id: "ranked-1v1",
  gameId: "game-1",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp"
};

function waitingTicket(): CoreMatchmakingTicket {
  return {
    id: "ticket-1",
    pool,
    player: { id: "player-1" },
    rating: { playerId: "player-1", poolId: pool.id, value: 1_500 },
    createdAt: "2026-08-11T00:00:00.000Z",
    status: "waiting",
    queuedAt: "2026-08-11T00:00:00.000Z",
    region: pool.region,
    inputMethod: "keyboard_mouse",
    searchAttributes: {},
    expiresAt: "2026-08-11T00:01:00.000Z"
  } as CoreMatchmakingTicket;
}

function matchedTicket(): CoreMatchmakingTicket {
  return {
    ...waitingTicket(),
    status: "matched",
    matchedAt: "2026-08-11T00:00:05.000Z",
    result: {
      matchId: "match-1",
      candidate: {
        id: "candidate-1",
        pool,
        ticketIds: ["ticket-1", "ticket-2"],
        createdAt: "2026-08-11T00:00:05.000Z"
      },
      room: {
        id: "room_match-1",
        kind: "match",
        matchId: "match-1",
        pool,
        settings: {},
        metadata: {}
      },
      createdAt: "2026-08-11T00:00:05.000Z"
    }
  } as CoreMatchmakingTicket;
}

function matchRoomSnapshot(): RoomSnapshot {
  return {
    revision: 0,
    state: { status: "waiting" },
    participants: [
      {
        kind: "player",
        id: "participant_match-1_1",
        player: { id: "player-1" },
        teamId: "blue",
        ready: false
      }
    ],
    teams: [{ id: "blue" }, { id: "red" }],
    room: {
      id: "room_match-1",
      kind: "match",
      matchId: "match-1",
      pool,
      settings: {},
      metadata: {}
    }
  };
}

function createFetch(): {
  readonly fetch: FetchImplementation;
  readonly state: { ticket: CoreMatchmakingTicket };
} {
  const state = { ticket: waitingTicket() };
  const fetch: FetchImplementation = vi.fn(async (input, init) => {
    const url = input.toString();
    if (url.endsWith("/tickets")) {
      return Response.json({ ticket: state.ticket });
    }
    if (url.endsWith("/cancel")) {
      state.ticket = {
        ...waitingTicket(),
        status: "cancelled",
        cancelledAt: "2026-08-11T00:00:01.000Z"
      } as CoreMatchmakingTicket;
      return Response.json({ ticket: state.ticket });
    }
    if (url.endsWith("/connection")) {
      return Response.json({
        ticket: state.ticket,
        connection: {
          roomId: "room_match-1",
          participantId: "participant_match-1_1",
          role: "player",
          joinToken: "join-token",
          websocketUrl: "wss://example.test/v1/custom-rooms/room_match-1/ws",
          snapshot: matchRoomSnapshot()
        }
      });
    }
    if (url.endsWith("/rating")) {
      return Response.json({
        rating: { playerId: "player-1", poolId: pool.id, value: 1_500 }
      });
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  return { fetch, state };
}

function event(
  ticket: CoreMatchmakingTicket,
  sequence: number
): string {
  return JSON.stringify({
    protocolVersion: 1,
    kind: "event",
    event: "matchmaking.ticket",
    revision: sequence,
    payload: {
      ticket,
      waitingCount: ticket.status === "waiting" ? 1 : 0,
      activeCount: ticket.status === "waiting" ? 1 : 0,
      sequence,
      occurredAt: "2026-08-11T00:00:05.000Z",
      searchWidth: 75
    }
  });
}

describe("@flarelobby/client matchmaking", () => {
  it("作成直後の状態を公開し、進捗購読を受け取る", async () => {
    FakeWebSocket.instances = [];
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-create"
    });

    const ticket = await client.joinMatchmaking("ranked-1v1", {
      rating: 1_500
    });
    expect(ticket.id).toBe("ticket-1");
    expect(ticket.status).toBe("waiting");
    expect(ticket.searchRange).toBe(400);

    const listener = vi.fn();
    ticket.on("progress", listener);
    FakeWebSocket.instances[0]?.receive(event(state.ticket, 1));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        waitingCount: 1,
        searchWidth: 75,
        ticket: expect.objectContaining({ status: "waiting" })
      })
    );
  });

  it("getRating を Pool 単位の接続口として公開する", async () => {
    FakeWebSocket.instances = [];
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-rating"
    });

    await expect(client.getRating(pool)).resolves.toEqual({
      playerId: "player-1",
      poolId: pool.id,
      value: 1_500
    });
  });

  it("成立イベント後、接続済みの対戦 Room を waitForMatch から返す", async () => {
    FakeWebSocket.instances = [];
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-match"
    });
    const ticket = await client.joinMatchmaking(pool, { rating: 1_500 });
    const wait = ticket.waitForMatch();
    state.ticket = matchedTicket();

    FakeWebSocket.instances[0]?.receive(event(state.ticket, 1));
    const room = await wait;

    expect(room.id).toBe("room_match-1");
    expect(room.snapshot.room.kind).toBe("match");
    expect(room.closed).toBe(false);
  });

  it("findMatch だけでチケット作成から対戦 Room 接続まで完了する", async () => {
    FakeWebSocket.instances = [];
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-find"
    });

    const find = client.findMatch(pool);
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.ticket = matchedTicket();
    FakeWebSocket.instances[0]?.receive(event(state.ticket, 1));

    const room = await find;
    expect(room.id).toBe("room_match-1");
    expect(room.snapshot.room.kind).toBe("match");
  });

  it("waitForMatch の AbortSignal でサーバー側キャンセルを要求する", async () => {
    FakeWebSocket.instances = [];
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-abort"
    });
    const ticket = await client.joinMatchmaking(pool);
    const controller = new AbortController();
    const wait = ticket.waitForMatch({ signal: controller.signal });
    controller.abort();

    await expect(wait).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      vi.mocked(fetch).mock.calls.some(
        ([input, init]) =>
          input.toString().endsWith(
            "/v1/matchmaking/pools/ranked-1v1/tickets/ticket-1/cancel"
          ) && init?.method === "POST"
      )
    ).toBe(true);
    expect(ticket.status).toBe("cancelled");
  });

  it("手動 cancel はサーバー応答後に一度だけ終端通知し、再呼出しも冪等に扱う", async () => {
    FakeWebSocket.instances = [];
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-cancel"
    });
    const ticket = await client.joinMatchmaking(pool);
    const listener = vi.fn();
    ticket.on("progress", listener);

    await ticket.cancel({ requestId: "cancel-request" });
    await ticket.cancel({ requestId: "cancel-request" });

    expect(ticket.status).toBe("cancelled");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: expect.objectContaining({ status: "cancelled" }) })
    );
  });

  it("成立終端を重複イベントで二重通知せず、一時切断後に再接続する", async () => {
    FakeWebSocket.instances = [];
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => `request-${FakeWebSocket.instances.length}`
    });
    const ticket = await client.joinMatchmaking(pool, {
      reconnect: {
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0
      }
    });
    const listener = vi.fn();
    ticket.on("progress", listener);
    FakeWebSocket.instances[0]?.receive(event(state.ticket, 1));
    FakeWebSocket.instances[0]?.drop();
    await new Promise((resolve) => setTimeout(resolve, 1));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]?.url).toContain("after=1");

    state.ticket = matchedTicket();
    // sequence は Pool 全体で採番され、他チケットのイベントが間に入るため
    // 1 から 3 への飛び番は正常です。
    FakeWebSocket.instances[1]?.receive(event(state.ticket, 3));
    FakeWebSocket.instances[1]?.receive(event(state.ticket, 3));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(ticket.status).toBe("matched");
  });
});
