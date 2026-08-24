import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor,
} from "../src/index.js";
import type {
  MatchmakingPool,
  MatchmakingTicket as CoreMatchmakingTicket,
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
  id: "ranked-2v2",
  gameId: "game-1",
  seasonId: "season-1",
  mode: "ranked-2v2",
  region: "jp",
};

const CREATED_AT = "2026-08-25T00:00:00.000Z";

function baseSnapshot(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    partyId: "party-1",
    revision: 1,
    maxPartySize: 5,
    members: [
      {
        playerId: "player-1",
        role: "leader",
        joinedAt: CREATED_AT,
      },
    ],
    invites: [],
    queuedTicket: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function joinedSnapshot(): Record<string, unknown> {
  return baseSnapshot({
    revision: 2,
    updatedAt: "2026-08-25T00:00:05.000Z",
    members: [
      {
        playerId: "player-1",
        role: "leader",
        joinedAt: CREATED_AT,
      },
      {
        playerId: "player-2",
        role: "member",
        joinedAt: "2026-08-25T00:00:05.000Z",
      },
    ],
  });
}

function dissolvedSnapshot(): Record<string, unknown> {
  return baseSnapshot({
    revision: 9,
    updatedAt: "2026-08-25T00:01:00.000Z",
    members: [],
  });
}

function waitingTicket(): CoreMatchmakingTicket {
  return {
    id: "ticket-1",
    pool,
    player: { id: "player-1" },
    rating: { playerId: "player-1", poolId: pool.id, value: 1_500 },
    createdAt: CREATED_AT,
    status: "waiting",
    queuedAt: CREATED_AT,
    region: pool.region,
    inputMethod: "keyboard_mouse",
    searchAttributes: {},
    expiresAt: "2026-08-25T00:01:00.000Z",
  } as CoreMatchmakingTicket;
}

function cancelledTicket(): CoreMatchmakingTicket {
  return {
    ...waitingTicket(),
    status: "cancelled",
    cancelledAt: "2026-08-25T00:00:10.000Z",
  } as CoreMatchmakingTicket;
}

function createFetch(): {
  readonly fetch: FetchImplementation;
  readonly state: {
    snapshot: Record<string, unknown> | null;
    ticket: CoreMatchmakingTicket;
  };
} {
  const state = {
    snapshot: baseSnapshot(),
    ticket: waitingTicket(),
  };
  const fetch: FetchImplementation = vi.fn(async (input, init) => {
    const url = input.toString();
    const method = init?.method ?? "GET";
    if (
      (url.endsWith("/v1/parties") || url.includes("/v1/parties?")) &&
      method === "POST"
    ) {
      return Response.json({ party: state.snapshot });
    }
    if (url === "https://example.test/v1/parties/party-1" && method === "GET") {
      return Response.json({ party: state.snapshot });
    }
    if (url.endsWith("/parties/party-1/invites") && method === "POST") {
      return Response.json({
        invite: {
          playerId: "player-2",
          token: "invite-token",
          expiresAt: "2026-08-25T00:10:00.000Z",
          createdAt: CREATED_AT,
        },
      });
    }
    if (url.endsWith("/parties/party-1/members") && method === "POST") {
      state.snapshot = joinedSnapshot();
      return Response.json({ party: state.snapshot });
    }
    if (url.endsWith("/parties/party-1/leave") && method === "POST") {
      return Response.json({ dissolved: false });
    }
    if (
      url.endsWith("/parties/party-1/transfer-leadership") &&
      method === "POST"
    ) {
      return Response.json({ party: baseSnapshot({ revision: 3 }) });
    }
    if (url.endsWith("/parties/party-1/dissolve") && method === "POST") {
      state.snapshot = dissolvedSnapshot();
      return Response.json({ party: state.snapshot });
    }
    if (url.endsWith("/tickets") && method === "POST") {
      return Response.json({ ticket: state.ticket });
    }
    if (url.endsWith("/cancel") && method === "POST") {
      state.ticket = cancelledTicket();
      return Response.json({ ticket: state.ticket });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  return { fetch, state };
}

function partyEvent(
  sequence: number,
  type: string,
  snapshot: Record<string, unknown>,
): string {
  return JSON.stringify({
    sequence,
    partyRevision: snapshot["revision"],
    type,
    snapshot,
    occurredAt: "2026-08-25T00:00:05.000Z",
  });
}

const reconnectOptions = {
  maxAttempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
};

async function flushAsync(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("@flarelobby/client party", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("createParty が作成要求を送り、イベント接続済みのハンドルを返す", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-create",
    });

    const party = await client.createParty({ maxPartySize: 4 });

    expect(party.id).toBe("party-1");
    expect(party.revision).toBe(1);
    expect(Object.isFrozen(party.snapshot)).toBe(true);
    expect(
      vi.mocked(fetch).mock.calls.some(([input, init]) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return (
          input.toString().endsWith("/v1/parties") &&
          init?.method === "POST" &&
          body["requestId"] === "request-create" &&
          body["maxPartySize"] === 4
        );
      }),
    ).toBe(true);
    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://example.test/v1/parties/party-1/events/ws",
    );
  });

  it("invite / transferLeadership / dissolve が対応するエンドポイントを呼ぶ", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-op",
    });
    const party = await client.createParty();

    const invite = await party.invite("player-2", { ttlMs: 60_000 });
    expect(invite.token).toBe("invite-token");

    const transferred = await party.transferLeadership("player-2");
    expect(transferred.revision).toBe(3);

    const dissolved = await party.dissolve();
    expect(dissolved.members).toHaveLength(0);
    expect(party.dissolved).toBe(true);

    const calls = vi.mocked(fetch).mock.calls.map(([input, init]) => ({
      url: input.toString(),
      method: init?.method ?? "GET",
    }));
    expect(calls).toContainEqual({
      url: "https://example.test/v1/parties/party-1/invites",
      method: "POST",
    });
    expect(calls).toContainEqual({
      url: "https://example.test/v1/parties/party-1/transfer-leadership",
      method: "POST",
    });
    expect(calls).toContainEqual({
      url: "https://example.test/v1/parties/party-1/dissolve",
      method: "POST",
    });
  });

  it("joinParty が単一用途トークンで参加し、イベント購読を開始する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-join",
    });

    const party = await client.joinParty({
      partyId: "party-1",
      token: "invite-token",
    });

    expect(party.snapshot.members).toHaveLength(2);
    expect(
      vi.mocked(fetch).mock.calls.some(([input, init]) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return (
          input.toString().endsWith("/v1/parties/party-1/members") &&
          init?.method === "POST" &&
          body["token"] === "invite-token"
        );
      }),
    ).toBe(true);
  });

  it("getParty は非所属や不在を FORBIDDEN へ正規化する", async () => {
    const { fetch, state } = createFetch();
    state.snapshot = null;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
    });

    await expect(client.getParty("party-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("イベントで Snapshot を単調に進め、古いイベントは無視する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
    });
    const party = await client.createParty();
    const listener = vi.fn();
    party.on("update", listener);

    FakeWebSocket.instances[0]?.receive(
      partyEvent(1, "member_joined", joinedSnapshot()),
    );
    // 古い sequence と後退する revision のイベントは破棄します。
    FakeWebSocket.instances[0]?.receive(
      partyEvent(1, "member_joined", joinedSnapshot()),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(party.snapshot.members).toHaveLength(2);
    expect(party.snapshot.invites).toHaveLength(0);
  });

  it("一時切断後に after を付けて再接続し、履歴で状態を復元する", async () => {
    const { fetch, state } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      reconnect: reconnectOptions,
    });
    const party = await client.createParty({ reconnect: reconnectOptions });
    FakeWebSocket.instances[0]?.receive(
      partyEvent(1, "member_joined", joinedSnapshot()),
    );
    expect(party.snapshot.members).toHaveLength(2);

    FakeWebSocket.instances[0]?.drop();
    await flushAsync();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]?.url).toContain(
      "/v1/parties/party-1/events/ws?after=1",
    );

    // 再接続後にサーバーが履歴を再生してくるため、状態は復元済みのままです。
    state.snapshot = baseSnapshot({
      revision: 5,
      updatedAt: "2026-08-25T00:02:00.000Z",
      queuedTicket: { ticketId: "ticket-1", poolKey: "game-1:season-1" },
    });
    FakeWebSocket.instances[1]?.receive(
      partyEvent(2, "queue_started", state.snapshot),
    );
    expect(party.revision).toBe(5);
    expect(party.snapshot.queuedTicket).toEqual({
      ticketId: "ticket-1",
      poolKey: "game-1:season-1",
    });
    expect(party.connectionStatus).toBe("connected");
  });

  it("dissolved イベントで購読を終了し、以降の操作を拒否する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
    });
    const party = await client.createParty();

    FakeWebSocket.instances[0]?.receive(
      partyEvent(1, "dissolved", dissolvedSnapshot()),
    );

    expect(party.dissolved).toBe(true);
    expect(party.connectionStatus).toBe("disconnected");
    await expect(party.joinRankedQueue(pool)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("leave は退出要求の結果を返し、購読を終了する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-leave",
    });
    const party = await client.createParty();

    await expect(party.leave()).resolves.toEqual({ dissolved: false });
    expect(party.connectionStatus).toBe("disconnected");
    const [, init] = vi
      .mocked(fetch)
      .mock.calls.find(([input]) =>
        input.toString().endsWith("/v1/parties/party-1/leave"),
      )!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requestId: "request-leave",
    });
  });

  it("joinRankedQueue が partyId を添えたチケット作成を行い、cancelQueue で停止する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
      requestIdFactory: () => "request-queue",
    });
    const party = await client.createParty();

    const ticket = await party.joinRankedQueue(pool, { rating: 1_500 });
    expect(ticket.status).toBe("waiting");
    expect(
      vi.mocked(fetch).mock.calls.some(([input, init]) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return (
          input
            .toString()
            .endsWith("/v1/matchmaking/pools/ranked-2v2/tickets") &&
          init?.method === "POST" &&
          body["partyId"] === "party-1"
        );
      }),
    ).toBe(true);

    await party.cancelQueue({ requestId: "cancel-request" });
    expect(ticket.status).toBe("cancelled");
  });

  it("待機チケットがない状態の cancelQueue は CONFLICT になる", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
    });
    const party = await client.createParty();

    await expect(party.cancelQueue()).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("dispose はイベント接続と操作を解放する", async () => {
    const { fetch } = createFetch();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "access-token",
      fetch,
      webSocket,
    });
    const party = await client.createParty();
    party.dispose();
    expect(party.connectionStatus).toBe("disconnected");

    // クライアント全体の dispose 後は HTTP 操作も CANCELLED へ正規化されます。
    client.dispose();
    await expect(party.refresh()).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
});
