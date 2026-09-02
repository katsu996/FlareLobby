import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor,
} from "../src/index.js";
import { FlareLobbyError } from "@flarelobby/core";
import type {
  MatchmakingPool,
  MatchmakingTicket as CoreMatchmakingTicket,
  RoomSnapshot,
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
  region: "jp",
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
    expiresAt: "2026-08-11T00:01:00.000Z",
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
        createdAt: "2026-08-11T00:00:05.000Z",
      },
      room: {
        id: "room_match-1",
        kind: "match",
        matchId: "match-1",
        pool,
        settings: {},
        metadata: {},
      },
      createdAt: "2026-08-11T00:00:05.000Z",
    },
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
        ready: false,
      },
    ],
    teams: [{ id: "blue" }, { id: "red" }],
    room: {
      id: "room_match-1",
      kind: "match",
      matchId: "match-1",
      pool,
      settings: {},
      metadata: {},
    },
  };
}

function createFetch(): {
  readonly fetch: FetchImplementation;
  readonly state: { ticket: CoreMatchmakingTicket };
} {
  const state = { ticket: waitingTicket() };
  const fetch: FetchImplementation = vi.fn(async (input, init) => {
    const url = input.toString();
    if (/\/tickets\/[^/]+$/.test(url)) {
      return Response.json({ ticket: state.ticket });
    }
    if (url.endsWith("/tickets")) {
      return Response.json({ ticket: state.ticket });
    }
    if (url.endsWith("/cancel")) {
      state.ticket = {
        ...waitingTicket(),
        status: "cancelled",
        cancelledAt: "2026-08-11T00:00:01.000Z",
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
          snapshot: matchRoomSnapshot(),
        },
      });
    }
    if (url.endsWith("/rating")) {
      return Response.json({
        rating: { playerId: "player-1", poolId: pool.id, value: 1_500 },
      });
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  return { fetch, state };
}

function event(ticket: CoreMatchmakingTicket, sequence: number): string {
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
      searchWidth: 75,
    },
  });
}

describe("@flarelobby/client matchmaking", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("作成直後の状態を公開し、進捗購読を受け取る", async () => {
    const { fetch, state } = createFetch();
    // queuedAt (00:00:00) から 5 分経過した時刻に固定し、検索幅を最終段階の 400 にします。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:05:00.000Z"));
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-create",
    });

    const ticket = await client.joinMatchmaking("ranked-1v1", {
      rating: 1_500,
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
        ticket: expect.objectContaining({ status: "waiting" }),
      }),
    );
  });

  it("getRating を Pool 単位の接続口として公開する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-rating",
    });

    await expect(client.getRating(pool)).resolves.toEqual({
      playerId: "player-1",
      poolId: pool.id,
      value: 1_500,
    });
  });

  it("成立イベント後、接続済みの対戦 Room を waitForMatch から返す", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-match",
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
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-find",
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
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-abort",
    });
    const ticket = await client.joinMatchmaking(pool);
    const controller = new AbortController();
    const wait = ticket.waitForMatch({ signal: controller.signal });
    controller.abort();

    await expect(wait).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([input, init]) =>
            input
              .toString()
              .endsWith(
                "/v1/matchmaking/pools/ranked-1v1/tickets/ticket-1/cancel",
              ) && init?.method === "POST",
        ),
    ).toBe(true);
    expect(ticket.status).toBe("cancelled");
  });

  it("手動 cancel はサーバー応答後に一度だけ終端通知し、再呼出しも冪等に扱う", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-cancel",
    });
    const ticket = await client.joinMatchmaking(pool);
    const listener = vi.fn();
    ticket.on("progress", listener);

    await ticket.cancel({ requestId: "cancel-request" });
    await ticket.cancel({ requestId: "cancel-request" });

    expect(ticket.status).toBe("cancelled");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: expect.objectContaining({ status: "cancelled" }),
      }),
    );
  });

  it("成立終端を重複イベントで二重通知せず、一時切断後に再接続する", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => `request-${FakeWebSocket.instances.length}`,
    });
    const ticket = await client.joinMatchmaking(pool, {
      reconnect: {
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
      },
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

  it("チケット作成要求の中断後に同じ requestId で結果を再取得してからキャンセルする", async () => {
    const controller = new AbortController();
    const requestBodies: string[] = [];
    let createAttempts = 0;
    let cancelCalls = 0;
    const fetch: FetchImplementation = vi.fn(async (input, init) => {
      const url = input.toString();
      if (/\/tickets\/[^/]+\/cancel$/.test(url)) {
        cancelCalls += 1;
        return Response.json({
          ticket: {
            ...waitingTicket(),
            status: "cancelled",
            cancelledAt: "2026-08-11T00:00:01.000Z",
          },
        });
      }
      if (!url.endsWith("/tickets")) {
        throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
      }
      const rawBody = init?.body;
      requestBodies.push(
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
      );
      createAttempts += 1;
      if (createAttempts === 1) {
        controller.abort();
        throw new FlareLobbyError("CANCELLED");
      }
      return Response.json({ ticket: waitingTicket() });
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-abort-retry",
    });

    await expect(
      client.joinMatchmaking("ranked-1v1", {
        rating: 1_500,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(createAttempts).toBe(2);
    expect(cancelCalls).toBe(1);
    expect(
      requestBodies.map((body) => JSON.parse(body).requestId as unknown),
    ).toEqual(["request-abort-retry", "request-abort-retry"]);
  });

  it("中断後の再取得も失敗した場合は CANCELLED で拒否する", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const fetch: FetchImplementation = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        controller.abort();
        throw new FlareLobbyError("CANCELLED");
      }
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      throw abortError;
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-abort-giveup",
    });

    await expect(
      client.joinMatchmaking("ranked-1v1", {
        rating: 1_500,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(attempts).toBe(2);
  });

  it("イベント接続の開始に失敗したら CONNECTION_FAILED で拒否する", async () => {
    const { fetch } = createFetch();
    const failingWebSocket = class {
      public constructor() {
        throw new Error("socket unavailable");
      }
    } as unknown as WebSocketConstructor;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket: failingWebSocket,
      requestIdFactory: () => "request-connect-failure",
    });

    await expect(client.joinMatchmaking(pool)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("既に中断された AbortSignal では要求せず CANCELLED で拒否する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-pre-abort",
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.joinMatchmaking(pool, {
        rating: 1_500,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("不正な Pool 参照は INVALID_PAYLOAD で拒否する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-invalid-pool",
    });

    await expect(client.joinMatchmaking("")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(
      client.joinMatchmaking({ ...pool, gameId: "" } as MatchmakingPool),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("要求識別子を生成できない場合は CONNECTION_FAILED で拒否する", async () => {
    const emptyIdClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch: createFetch().fetch,
      webSocket,
      requestIdFactory: () => "",
    });
    const throwingClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch: createFetch().fetch,
      webSocket,
      requestIdFactory: () => {
        throw new Error("id unavailable");
      },
    });

    await expect(emptyIdClient.joinMatchmaking(pool)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    await expect(throwingClient.joinMatchmaking(pool)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("チケット応答が不正な形式なら CONNECTION_FAILED で拒否する", async () => {
    const cases: unknown[] = [
      null,
      { unexpected: true },
      {
        ticket: {
          ...waitingTicket(),
          status: "waiting",
          queuedAt: undefined,
        },
      },
      {
        ticket: {
          ...waitingTicket(),
          rating: { playerId: "other-player", poolId: pool.id, value: 1_000 },
        },
      },
    ];

    for (const payload of cases) {
      const fetch: FetchImplementation = vi.fn(async () =>
        Response.json(payload),
      );
      const client = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "access-token",
        fetch,
        webSocket,
        requestIdFactory: () => "request-bad-ticket",
      });

      await expect(client.joinMatchmaking(pool)).rejects.toMatchObject({
        code: "CONNECTION_FAILED",
      });
    }
  });

  it("getRating は envelope なしの応答も受け入れ、不正な応答は CONNECTION_FAILED で拒否する", async () => {
    const rawRating = { playerId: "player-1", poolId: pool.id, value: 1_250 };
    let payload: unknown = rawRating;
    const fetch: FetchImplementation = vi.fn(async (input) => {
      if (!input.toString().endsWith("/rating")) {
        throw new Error(`unexpected request: ${input.toString()}`);
      }
      return Response.json(payload);
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-rating-shapes",
    });

    await expect(client.getRating(pool.id)).resolves.toEqual(rawRating);

    payload = {};
    await expect(client.getRating(pool)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });

    payload = { playerId: "player-1", poolId: "other-pool", value: 100 };
    await expect(client.getRating(pool)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("古い sequence の進捗は無視し、未知のチケットイベントでは接続を張り直す", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-stale-sequence",
    });
    const ticket = await client.joinMatchmaking(pool, {
      reconnect: { maxAttempts: 0, jitterRatio: 0 },
    });
    FakeWebSocket.instances[0]?.receive(event(state.ticket, 5));

    const listener = vi.fn();
    const off = ticket.on("progress", listener);
    FakeWebSocket.instances[0]?.receive(event(state.ticket, 4));
    expect(listener).not.toHaveBeenCalled();
    off();
    // 関係ないイベント種別は無視する。
    FakeWebSocket.instances[0]?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "event",
        event: "custom.room",
        revision: 9,
        payload: {},
      }),
    );

    const otherTicket = {
      ...waitingTicket(),
      id: "ticket-other",
    } as CoreMatchmakingTicket;
    FakeWebSocket.instances[0]?.receive(event(otherTicket, 6));
    expect(FakeWebSocket.instances[0]?.readyState).toBe(3);
  });

  it("解析できない進捗ペイロードでも接続を張り直す", async () => {
    vi.useFakeTimers();
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => `request-${FakeWebSocket.instances.length}`,
    });
    await client.joinMatchmaking(pool, {
      reconnect: { jitterRatio: 0 },
    });

    const malformedEvent = (payloadValue: unknown): string =>
      JSON.stringify({
        protocolVersion: 1,
        kind: "event",
        event: "matchmaking.ticket",
        revision: 1,
        payload: payloadValue,
      });
    FakeWebSocket.instances[0]?.receive(malformedEvent(null));
    expect(FakeWebSocket.instances[0]?.readyState).toBe(3);

    // 再同期のために再接続された接続でも同じ扱いになる。
    await vi.advanceTimersByTimeAsync(250);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]?.receive(malformedEvent({ broken: true }));
    expect(FakeWebSocket.instances[1]?.readyState).toBe(3);
  });

  it("refresh で expired を取得すると終端通知の後に CONFLICT で拒否する", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-expired",
    });
    const ticket = await client.joinMatchmaking(pool);
    const listener = vi.fn();
    ticket.on("progress", listener);

    state.ticket = {
      ...waitingTicket(),
      status: "expired",
      expiredAt: "2026-08-11T00:01:00.000Z",
    } as CoreMatchmakingTicket;
    const snapshot = await ticket.refresh();

    expect(snapshot.status).toBe("expired");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        waitingCount: 0,
        activeCount: 0,
        ticket: expect.objectContaining({ status: "expired" }),
      }),
    );
    await expect(ticket.waitForMatch()).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("成立済みチケットを refresh した後の waitForMatch でも対戦 Room を取得できる", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-refresh-matched",
    });
    const ticket = await client.joinMatchmaking(pool);
    state.ticket = matchedTicket();
    await ticket.refresh();

    const [room1, room2] = await Promise.all([
      ticket.waitForMatch(),
      ticket.waitForMatch(),
    ]);
    expect(room1.id).toBe("room_match-1");
    expect(room2.id).toBe("room_match-1");
    expect(room1.snapshot.room.kind).toBe("match");
    // 並行した待機は対戦 Room 接続の取得を共有する。
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) =>
          input.toString().endsWith("/connection"),
        ),
    ).toHaveLength(1);
  });

  it("成立イベントに接続情報が含まれる場合は再取得せず Room を返す", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-inline-connection",
    });
    const ticket = await client.joinMatchmaking(pool);
    state.ticket = matchedTicket();
    FakeWebSocket.instances[0]?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "event",
        event: "matchmaking.ticket",
        revision: 1,
        payload: {
          ticket: state.ticket,
          waitingCount: 0,
          activeCount: 0,
          sequence: 1,
          occurredAt: "2026-08-11T00:00:05.000Z",
          connection: {
            roomId: "room_match-1",
            participantId: "participant_match-1_1",
            joinToken: "join-token",
            websocketUrl: "wss://example.test/v1/custom-rooms/room_match-1/ws",
            snapshot: matchRoomSnapshot(),
          },
        },
      }),
    );

    const room = await ticket.waitForMatch();
    expect(room.id).toBe("room_match-1");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) => input.toString().endsWith("/connection")),
    ).toBe(false);
  });

  it("対戦 Room 接続の取得に失敗しても次の waitForMatch で再試行できる", async () => {
    let connectionAttempts = 0;
    const connection = {
      roomId: "room_match-1",
      participantId: "participant_match-1_1",
      role: "player",
      joinToken: "join-token",
      websocketUrl: "wss://example.test/v1/custom-rooms/room_match-1/ws",
      snapshot: matchRoomSnapshot(),
    };
    const fetch: FetchImplementation = vi.fn(async (input) => {
      const url = input.toString();
      if (url.endsWith("/tickets/ticket-1")) {
        return Response.json({ ticket: matchedTicket() });
      }
      if (url.endsWith("/tickets")) {
        return Response.json({ ticket: waitingTicket() });
      }
      if (url.endsWith("/connection")) {
        connectionAttempts += 1;
        if (connectionAttempts === 1) {
          return Response.json(
            { error: { code: "CONNECTION_FAILED", message: "unavailable" } },
            { status: 500 },
          );
        }
        return Response.json({ ticket: matchedTicket(), connection });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-room-retry",
    });
    const ticket = await client.joinMatchmaking(pool);
    await ticket.refresh();

    await expect(ticket.waitForMatch()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    const room = await ticket.waitForMatch();
    expect(room.id).toBe("room_match-1");
    expect(connectionAttempts).toBe(2);
  });

  it("複数待機者の一部を中断してもサーバー側キャンセルは要求しない", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-multi-waiter",
    });
    const ticket = await client.joinMatchmaking(pool);
    const cancelCalls = (): number =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) => input.toString().endsWith("/cancel"))
        .length;

    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const wait1 = ticket.waitForMatch({ signal: controller1.signal });
    const wait2 = ticket.waitForMatch({ signal: controller2.signal });

    controller1.abort();
    await expect(wait1).rejects.toMatchObject({ code: "CANCELLED" });
    expect(cancelCalls()).toBe(0);
    expect(ticket.status).toBe("waiting");

    controller2.abort();
    await expect(wait2).rejects.toMatchObject({ code: "CANCELLED" });
    expect(cancelCalls()).toBe(1);
  });

  it("cancel 要求が失敗したら CONNECTION_FAILED で拒否し、再試行できる", async () => {
    const fetch: FetchImplementation = vi.fn(async (input, init) => {
      const url = input.toString();
      if (url.endsWith("/cancel")) {
        return Response.json(
          { error: { code: "CONNECTION_FAILED", message: "cancel failed" } },
          { status: 500 },
        );
      }
      if (url.endsWith("/tickets")) {
        return Response.json({ ticket: waitingTicket() });
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-cancel-failure",
    });
    const ticket = await client.joinMatchmaking(pool);

    await expect(ticket.cancel()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    await expect(ticket.cancel()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) => input.toString().endsWith("/cancel")),
    ).toHaveLength(2);
  });

  it("チケット状態と進捗の公開値を検証する", async () => {
    const { fetch, state } = createFetch();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:10.000Z"));
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-getters",
    });

    const ticket = await client.joinMatchmaking(pool, { rating: 1_500 });
    expect(ticket.pool).toEqual(pool);
    expect(ticket.state).toBe("waiting");
    expect(ticket.snapshot).toBe(ticket.snapshot);
    expect(ticket.ticket).toBe(ticket.snapshot);
    expect(ticket.searchRange).toBe(ticket.searchWidth);
    expect(ticket.waitingTimeMs).toBe(10_000);
    expect(ticket.result).toBeUndefined();

    state.ticket = matchedTicket();
    await ticket.refresh();
    expect(ticket.status).toBe("matched");
    expect(ticket.result).toMatchObject({ matchId: "match-1" });
    expect(ticket.waitingTimeMs).toBe(5_000);
  });

  it("queuedAt を持たないチケットは待ち時間と探索幅を既定値で公開する", async () => {
    const creatingTicket = (createdAt?: string): CoreMatchmakingTicket => {
      const { queuedAt: _ignored, ...rest } = waitingTicket() as {
        queuedAt?: unknown;
      } & CoreMatchmakingTicket;
      return {
        ...rest,
        status: "creating",
        ...(createdAt === undefined ? {} : { createdAt }),
      } as CoreMatchmakingTicket;
    };
    const createCreatingFetch = (createdAt?: string): FetchImplementation =>
      vi.fn(async (input, init) => {
        const url = input.toString();
        if (url.endsWith("/tickets")) {
          return Response.json({ ticket: creatingTicket(createdAt) });
        }
        throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
      });
    const invalidClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch: createCreatingFetch("not-a-timestamp"),
      webSocket,
      requestIdFactory: () => "request-creating-invalid",
    });
    const fallbackClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch: createCreatingFetch(),
      webSocket,
      requestIdFactory: () => "request-creating-fallback",
    });

    const invalidTicket = await invalidClient.joinMatchmaking(pool);
    expect(invalidTicket.status).toBe("creating");
    expect(invalidTicket.waitingTimeMs).toBe(0);
    expect(invalidTicket.searchRange).toBe(0);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:10.000Z"));
    const fallbackTicket = await fallbackClient.joinMatchmaking(pool);
    expect(fallbackTicket.waitingTimeMs).toBe(10_000);
  });

  it("on / onStatusChange の不正な購読者は INVALID_PAYLOAD で拒否する", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-listeners",
    });
    const ticket = await client.joinMatchmaking(pool);

    expect(() => ticket.on("progress", null as unknown as () => void)).toThrow(
      FlareLobbyError,
    );
    expect(() =>
      ticket.onStatusChange(null as unknown as (status: string) => void),
    ).toThrow(FlareLobbyError);

    const listener = vi.fn();
    const off = ticket.on("progress", listener);
    off();
    FakeWebSocket.instances[0]?.receive(event(state.ticket, 1));
    expect(listener).not.toHaveBeenCalled();

    const statuses: string[] = [];
    const offStatus = ticket.onStatusChange((status) => {
      statuses.push(status);
    });
    FakeWebSocket.instances[0]?.drop();
    expect(statuses).toContain("disconnected");
    offStatus();
  });

  it("不正な再接続オプションは INVALID_PAYLOAD で拒否する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-reconnect-options",
    });

    await expect(
      client.joinMatchmaking(pool, { reconnect: { baseDelayMs: -1 } }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.joinMatchmaking(pool, { reconnect: { jitterRatio: 1.5 } }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.joinMatchmaking(pool, { reconnect: { maxAttempts: Number.NaN } }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("maxAttempts 0 では再接続せず disconnected を保つ", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-no-reconnect",
    });
    const ticket = await client.joinMatchmaking(pool, {
      reconnect: { maxAttempts: 0, jitterRatio: 0 },
    });
    const statuses: string[] = [];
    ticket.onStatusChange((status) => {
      statuses.push(status);
    });

    FakeWebSocket.instances[0]?.drop();

    expect(ticket.connectionStatus).toBe("disconnected");
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses).toEqual(["disconnected"]);
  });

  it("既に中断された AbortSignal 付きの waitForMatch はサーバー側キャンセルを要求する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-wait-pre-abort",
    });
    const ticket = await client.joinMatchmaking(pool);
    const controller = new AbortController();
    controller.abort();

    await expect(
      ticket.waitForMatch({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([input, init]) =>
            input.toString().endsWith("/cancel") && init?.method === "POST",
        ),
    ).toBe(true);
  });

  it("同時に呼んだ cancel は取り消し要求を共有する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-cancel-shared",
    });
    const ticket = await client.joinMatchmaking(pool);

    const first = ticket.cancel();
    const second = ticket.cancel();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ status: "cancelled" });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) => input.toString().endsWith("/cancel")),
    ).toHaveLength(1);
  });

  it("状態が巻き戻る更新は無視する", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-regression",
    });
    const ticket = await client.joinMatchmaking(pool);

    state.ticket = {
      ...waitingTicket(),
      status: "creating",
      queuedAt: undefined,
    } as unknown as CoreMatchmakingTicket;
    const snapshot = await ticket.refresh();

    expect(snapshot.status).toBe("waiting");
    expect(ticket.status).toBe("waiting");
  });

  it("reserved への遷移は終端として扱わない", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-reserved",
    });
    const ticket = await client.joinMatchmaking(pool);

    state.ticket = {
      ...waitingTicket(),
      status: "reserved",
    } as CoreMatchmakingTicket;
    const snapshot = await ticket.refresh();

    expect(snapshot.status).toBe("reserved");
    expect(ticket.status).toBe("reserved");
  });

  it("待機中に成立しても接続取得が失敗すれば CONNECTION_FAILED で拒否する", async () => {
    const fetch: FetchImplementation = vi.fn(async (input) => {
      const url = input.toString();
      if (/\/tickets\/[^/]+$/.test(url)) {
        return Response.json({ ticket: matchedTicket() });
      }
      if (url.endsWith("/tickets")) {
        return Response.json({ ticket: waitingTicket() });
      }
      if (url.endsWith("/connection")) {
        return Response.json(
          { error: { code: "CONNECTION_FAILED", message: "unavailable" } },
          { status: 500 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-waiter-failure",
    });
    const ticket = await client.joinMatchmaking(pool);
    const wait = ticket.waitForMatch();
    await ticket.refresh();

    await expect(wait).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("接続情報を含まない成立応答は CONNECTION_FAILED で拒否する", async () => {
    const fetch: FetchImplementation = vi.fn(async (input) => {
      const url = input.toString();
      if (/\/tickets\/[^/]+$/.test(url)) {
        return Response.json({ ticket: matchedTicket() });
      }
      if (url.endsWith("/tickets")) {
        return Response.json({ ticket: waitingTicket() });
      }
      if (url.endsWith("/connection")) {
        return Response.json({ ticket: matchedTicket() });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-no-connection",
    });
    const ticket = await client.joinMatchmaking(pool);
    await ticket.refresh();

    await expect(ticket.waitForMatch()).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("再接続の試行が上限に達すると disconnected になる", async () => {
    let socketCount = 0;
    const flakyWebSocket = function (
      this: unknown,
      url: string,
      protocols?: string | string[],
    ) {
      socketCount += 1;
      if (socketCount >= 2) {
        throw new Error("socket unavailable");
      }
      return new FakeWebSocket(url, protocols);
    } as unknown as WebSocketConstructor;
    const { fetch } = createFetch();
    vi.useFakeTimers();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket: flakyWebSocket,
      requestIdFactory: () => "request-retry-exhausted",
    });
    const ticket = await client.joinMatchmaking(pool, {
      reconnect: { maxAttempts: 2, baseDelayMs: 100, jitterRatio: 0 },
    });
    FakeWebSocket.instances[0]?.drop();

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(300);

    expect(socketCount).toBeGreaterThanOrEqual(3);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ticket.connectionStatus).toBe("disconnected");
  });

  it("再接続待ちの中で dispose すると再接続しない", async () => {
    const { fetch } = createFetch();
    vi.useFakeTimers();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => `request-${FakeWebSocket.instances.length}`,
    });
    const ticket = await client.joinMatchmaking(pool, {
      reconnect: { jitterRatio: 0 },
    });
    FakeWebSocket.instances[0]?.drop();
    (ticket as unknown as { dispose(): void }).dispose();

    await vi.advanceTimersByTimeAsync(250);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ticket.connectionStatus).toBe("disconnected");
  });
});
