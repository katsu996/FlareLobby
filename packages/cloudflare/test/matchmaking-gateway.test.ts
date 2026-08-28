import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createGatewayPrincipalEnvelope,
  defineFlareLobby,
  getMatchmakingTicketWebSocketRoute,
} from "../src/index.js";
import type { MatchmakingTicketRecord } from "../src/index.js";
import type { MatchmakingPool } from "@flarelobby/core";

const pool: MatchmakingPool = {
  id: "gateway-ranked-test",
  gameId: "gateway-game",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp",
};

const testLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    defaultSettings: {},
  },
  matchmakingPools: [pool],
  authenticate: (request) => {
    const principalId = request.headers.get("x-test-principal");
    if (principalId !== null && principalId.length > 0) {
      return { id: principalId, playerId: `${principalId}-player` };
    }

    return null;
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10,
  },
});

const testWorker = testLobby.createGatewayWorker<Env>();

interface TicketResponse {
  readonly ticket: MatchmakingTicketRecord;
}

async function fetchWorker(
  path: string,
  principalId: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-test-principal", principalId);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return testWorker.fetch(
    new Request(`https://example.test${path}`, {
      ...init,
      headers,
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );
}

async function createTicket(
  principalId: string,
  rating = 1_500,
): Promise<TicketResponse> {
  const response = await fetchWorker(
    `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`,
    principalId,
    {
      method: "POST",
      body: JSON.stringify({
        requestId: `request-${principalId}`,
        rating,
      }),
    },
  );

  expect(response.status).toBe(201);
  return response.json<TicketResponse>();
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

describe("Matchmaking Gateway API", () => {
  it("チケット作成、永続イベント、成立 Room 接続、キャンセルを公開する", async () => {
    const first = await createTicket(`gateway-first-${crypto.randomUUID()}`);
    expect(first.ticket.status).toBe("waiting");

    const eventsPath = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/${encodeURIComponent(first.ticket.id)}/events`;
    const waitingEventsResponse = await fetchWorker(
      eventsPath,
      first.ticket.player.id.replace(/-player$/u, ""),
    );
    expect(waitingEventsResponse.status).toBe(200);
    const waitingEvents = await waitingEventsResponse.json<{
      readonly events: readonly {
        readonly type: string;
        readonly searchWidth: number;
      }[];
    }>();
    expect(waitingEvents.events.map((event) => event.type)).toEqual([
      "creating",
      "waiting",
    ]);
    expect(
      waitingEvents.events.every((event) => event.searchWidth === 75),
    ).toBe(true);

    const second = await createTicket(`gateway-second-${crypto.randomUUID()}`);
    expect(second.ticket.status).toBe("matched");
    if (second.ticket.status !== "matched") {
      throw new Error("成立済みチケットを期待しました。");
    }

    const connectionResponse = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/${encodeURIComponent(second.ticket.id)}/connection`,
      second.ticket.player.id.replace(/-player$/u, ""),
    );
    expect(connectionResponse.status).toBe(200);
    const connectionBody = await connectionResponse.json<{
      readonly ticket: MatchmakingTicketRecord;
      readonly connection: {
        readonly roomId: string;
        readonly participantId: string;
        readonly role: "player";
        readonly joinToken: string;
        readonly websocketUrl: string;
      };
    }>();
    expect(connectionBody.ticket.status).toBe("matched");
    expect(connectionBody.connection.role).toBe("player");
    expect(connectionBody.connection.joinToken).toBeTruthy();
    expect(connectionBody.connection.participantId).toContain(
      `participant_${second.ticket.result.matchId}_`,
    );

    const cancelledPrincipal = `gateway-cancel-${crypto.randomUUID()}`;
    const cancellable = await createTicket(cancelledPrincipal, 2_000);
    const cancelPath = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/${encodeURIComponent(cancellable.ticket.id)}/cancel`;
    const cancelBody = {
      requestId: `cancel-${cancelledPrincipal}`,
      ticketId: cancellable.ticket.id,
    };
    const cancelledResponse = await fetchWorker(
      cancelPath,
      cancelledPrincipal,
      {
        method: "POST",
        body: JSON.stringify(cancelBody),
      },
    );
    const cancelled = await cancelledResponse.json<TicketResponse>();
    expect(cancelledResponse.status).toBe(200);
    expect(cancelled.ticket.status).toBe("cancelled");

    const retriedResponse = await fetchWorker(cancelPath, cancelledPrincipal, {
      method: "POST",
      body: JSON.stringify(cancelBody),
    });
    await expect(retriedResponse.json<TicketResponse>()).resolves.toEqual(
      cancelled,
    );
  });

  it("マッチングイベント WebSocket の Pool/Ticket ルートを厳密に判定する", () => {
    expect(
      getMatchmakingTicketWebSocketRoute(
        "/v1/matchmaking/pools/gateway-ranked-test/tickets/ticket-1/events/ws",
      ),
    ).toEqual({ poolId: pool.id, ticketId: "ticket-1" });
    expect(
      getMatchmakingTicketWebSocketRoute(
        "/v1/matchmaking/pools/gateway-ranked-test/tickets/ticket-1/events",
      ),
    ).toBeNull();
  });

  it("マッチングイベント WebSocket が署名済み Gateway 主体で履歴を返す", async () => {
    const principalId = `gateway-ws-${crypto.randomUUID()}`;
    const created = await createTicket(principalId);
    const path = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/${encodeURIComponent(created.ticket.id)}/events/ws`;
    const response = await testWorker.fetch(
      new Request(`https://example.test${path}`, {
        method: "GET",
        headers: {
          Upgrade: "websocket",
          "x-test-principal": principalId,
          "Sec-WebSocket-Protocol": `flarelobby.v1, flarelobby.auth.${encodeWebSocketToken("test-token")}`,
        },
      }) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(101);
    if (response.webSocket === null) {
      throw new Error("マッチングイベント WebSocket が返されませんでした。");
    }

    const message = new Promise<string>((resolve) => {
      response.webSocket!.addEventListener("message", (event) => {
        resolve((event as MessageEvent).data as string);
      });
    });
    response.webSocket.accept();
    const payload = JSON.parse(await message) as {
      readonly event: string;
      readonly payload: { readonly ticket: { readonly id: string } };
    };

    expect(payload.event).toBe("matchmaking.ticket");
    expect(payload.payload.ticket.id).toBe(created.ticket.id);
    response.webSocket.close();
  });
});

describe("Matchmaking Gateway API のエラー系", () => {
  it("未知の Pool と存在しないチケットへの要求を拒否する", async () => {
    const principalId = `gateway-error-${crypto.randomUUID()}`;

    const unknownPoolResponse = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent("gateway-unknown-pool")}/tickets`,
      principalId,
      {
        method: "POST",
        body: JSON.stringify({ requestId: "request-unknown", rating: 1_500 }),
      },
    );
    expect(unknownPoolResponse.status).toBe(400);
    await expect(
      unknownPoolResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });

    const missingTicketResponse = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/gateway-missing-ticket`,
      principalId,
    );
    expect(missingTicketResponse.status).toBe(400);
    await expect(
      missingTicketResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("許可されていないメソッドと状態の組み合わせを拒否する", async () => {
    const principalId = `gateway-method-${crypto.randomUUID()}`;
    // 他テストの残留待機チケットと成立しないよう、離れたレートで作成する。
    const created = await createTicket(principalId, 3_000);
    const base = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}`;

    const createGet = await fetchWorker(`${base}/tickets`, principalId);
    expect(createGet.status).toBe(404);

    const ratingPost = await fetchWorker(`${base}/rating`, principalId, {
      method: "POST",
      body: "{}",
    });
    expect(ratingPost.status).toBe(404);

    const resultGet = await fetchWorker(
      `${base}/matches/gateway-method-match/result`,
      principalId,
    );
    expect(resultGet.status).toBe(404);

    const ticketBase = `${base}/tickets/${encodeURIComponent(created.ticket.id)}`;
    const getPost = await fetchWorker(ticketBase, principalId, {
      method: "POST",
      body: "{}",
    });
    expect(getPost.status).toBe(404);

    const cancelGet = await fetchWorker(`${ticketBase}/cancel`, principalId);
    expect(cancelGet.status).toBe(404);

    const eventsPost = await fetchWorker(`${ticketBase}/events`, principalId, {
      method: "POST",
      body: "{}",
    });
    expect(eventsPost.status).toBe(404);

    const connectionOnWaiting = await fetchWorker(
      `${ticketBase}/connection`,
      principalId,
    );
    expect(connectionOnWaiting.status).toBe(400);
    await expect(
      connectionOnWaiting.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });

    const matchedPrincipal = `gateway-method-matched-${crypto.randomUUID()}`;
    const matched = await createTicket(matchedPrincipal);
    const connectionPost = await fetchWorker(
      `${base}/tickets/${encodeURIComponent(matched.ticket.id)}/connection`,
      matchedPrincipal,
      { method: "POST", body: "{}" },
    );
    expect(connectionPost.status).toBe(404);
  });

  it("所有者以外のチケット操作を拒否する", async () => {
    const owner = `gateway-owner-${crypto.randomUUID()}`;
    const created = await createTicket(owner);
    const attacker = `gateway-attacker-${crypto.randomUUID()}`;

    const response = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/${encodeURIComponent(created.ticket.id)}`,
      attacker,
    );
    expect(response.status).toBe(403);
    await expect(response.json<{ code: string }>()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("チケット作成リクエストの検証エラーを拒否する", async () => {
    const principalId = `gateway-validation-${crypto.randomUUID()}`;
    const post = (
      body: unknown,
      headers: Record<string, string> = {},
    ): Promise<Response> =>
      fetchWorker(
        `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`,
        principalId,
        {
          method: "POST",
          headers,
          body: typeof body === "string" ? body : JSON.stringify(body),
        },
      );

    const cases: readonly {
      readonly body: unknown;
      readonly headers?: Record<string, string>;
      readonly code: string;
    }[] = [
      { body: "{not-json", code: "INVALID_MESSAGE" },
      { body: {}, code: "INVALID_PAYLOAD" },
      {
        body: { requestId: "request-body", rating: 1_500 },
        headers: { "Idempotency-Key": "request-header" },
        code: "CONFLICT",
      },
      {
        body: {
          requestId: "request-pool-mismatch",
          rating: 1_500,
          pool: {
            id: "other-pool",
            gameId: "other-game",
            seasonId: "season-1",
            mode: "ranked-1v1",
            region: "jp",
          },
        },
        code: "CONFLICT",
      },
      {
        body: { requestId: "request-region", rating: 1_500, region: 42 },
        code: "INVALID_PAYLOAD",
      },
      {
        body: { requestId: "request-ttl", rating: 1_500, ttlMs: "60000" },
        code: "INVALID_PAYLOAD",
      },
      {
        body: {
          requestId: "request-expiry",
          rating: 1_500,
          expiresAt: { at: 1 },
        },
        code: "INVALID_PAYLOAD",
      },
      {
        body: {
          requestId: "request-attrs",
          rating: 1_500,
          searchAttributes: ["web"],
        },
        code: "INVALID_PAYLOAD",
      },
      {
        body: { requestId: "request-rating", rating: "high" },
        code: "INVALID_PAYLOAD",
      },
    ];
    for (const testCase of cases) {
      const response = await post(testCase.body, testCase.headers);
      expect(response.status).toBe(400);
      await expect(response.json<{ code: string }>()).resolves.toMatchObject({
        code: testCase.code,
      });
    }

    const objectRating = await post({
      requestId: `request-object-rating-${crypto.randomUUID()}`,
      rating: { value: 1_600 },
    });
    expect(objectRating.status).toBe(201);
    const created = await objectRating.json<TicketResponse>();
    expect(created.ticket.rating.value).toBe(1_600);
  });

  it("パーティー参照の作成要求でリーダー以外を拒否する", async () => {
    const leaderHeader = `gateway-party-leader-${crypto.randomUUID()}`;
    const leaderPlayerId = `${leaderHeader}-player`;
    const memberHeader = `gateway-party-member-${crypto.randomUUID()}`;
    const memberPlayerId = `${memberHeader}-player`;
    const partyId = `party_${crypto.randomUUID()}`;
    const partyStub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leaderEnvelope = await createGatewayPrincipalEnvelope(
      env.FLARE_LOBBY_TOKEN_SECRET,
      { id: leaderHeader, playerId: leaderPlayerId },
    );
    const memberEnvelope = await createGatewayPrincipalEnvelope(
      env.FLARE_LOBBY_TOKEN_SECRET,
      { id: memberHeader, playerId: memberPlayerId },
    );
    if (!leaderEnvelope.ok || !memberEnvelope.ok) {
      throw new Error("Gateway 主体証明を作成できません。");
    }

    await partyStub.createParty({
      gatewayPrincipal: leaderEnvelope.value,
      requestId: `request-${crypto.randomUUID()}`,
    });
    const invite = await partyStub.inviteMember({
      gatewayPrincipal: leaderEnvelope.value,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: memberPlayerId,
    });
    await partyStub.acceptInvite({
      gatewayPrincipal: memberEnvelope.value,
      requestId: `request-${crypto.randomUUID()}`,
      token: invite.token,
    });

    const base = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`;
    const unknownPartyResponse = await fetchWorker(base, leaderHeader, {
      method: "POST",
      body: JSON.stringify({
        requestId: `request-${crypto.randomUUID()}`,
        rating: 1_500,
        partyId: "party_gateway-missing-party",
      }),
    });
    expect(unknownPartyResponse.status).toBe(403);
    await expect(
      unknownPartyResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const notLeaderResponse = await fetchWorker(base, memberHeader, {
      method: "POST",
      body: JSON.stringify({
        requestId: `request-${crypto.randomUUID()}`,
        rating: 1_500,
        partyId,
      }),
    });
    expect(notLeaderResponse.status).toBe(403);
    await expect(
      notLeaderResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("マッチングイベント WebSocket のアップグレード拒否", () => {
  const wsUrl = (path: string): string => `https://example.test${path}`;

  const fetchWebSocket = async (
    path: string,
    headers: Record<string, string>,
  ): Promise<Response> =>
    testWorker.fetch(
      new Request(wsUrl(path), {
        method: "GET",
        headers,
      }) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

  it("WebSocket アップグレード以外の要求を拒否する", async () => {
    const principalId = `gateway-ws-plain-${crypto.randomUUID()}`;
    const path = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/gateway-ws-ticket/events/ws`;
    const plainResponse = await fetchWebSocket(path, {
      "x-test-principal": principalId,
    });
    expect(plainResponse.status).toBe(400);
    await expect(plainResponse.json<{ code: string }>()).resolves.toMatchObject(
      {
        code: "INVALID_MESSAGE",
      },
    );
  });

  it("認証サブプロトコルがない要求を拒否する", async () => {
    const principalId = `gateway-ws-noproto-${crypto.randomUUID()}`;
    const path = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/gateway-ws-ticket/events/ws`;
    const response = await fetchWebSocket(path, {
      Upgrade: "websocket",
      "x-test-principal": principalId,
    });
    expect(response.status).toBe(401);
    await expect(response.json<{ code: string }>()).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("トークンがあっても認証されない要求を拒否する", async () => {
    const path = `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/gateway-ws-ticket/events/ws`;
    const response = await fetchWebSocket(path, {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `flarelobby.v1, flarelobby.auth.${encodeWebSocketToken("test-token")}`,
    });
    expect(response.status).toBe(401);
    await expect(response.json<{ code: string }>()).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("未知 Pool・存在しないチケット・他者のチケットを拒否する", async () => {
    const protocol = `flarelobby.v1, flarelobby.auth.${encodeWebSocketToken("test-token")}`;
    const eventsWsPath = (poolId: string, ticketId: string): string =>
      `/v1/matchmaking/pools/${encodeURIComponent(poolId)}/tickets/${encodeURIComponent(ticketId)}/events/ws`;

    const unknownPoolResponse = await fetchWebSocket(
      eventsWsPath("gateway-unknown-ws-pool", "gateway-ws-ticket"),
      {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": protocol,
        "x-test-principal": `gateway-ws-pool-${crypto.randomUUID()}`,
      },
    );
    expect(unknownPoolResponse.status).toBe(400);
    await expect(
      unknownPoolResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });

    const principalId = `gateway-ws-ticket-${crypto.randomUUID()}`;
    const missingTicketResponse = await fetchWebSocket(
      eventsWsPath(pool.id, "gateway-missing-ws-ticket"),
      {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": protocol,
        "x-test-principal": principalId,
      },
    );
    expect(missingTicketResponse.status).toBe(400);
    await expect(
      missingTicketResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });

    const owner = `gateway-ws-owner-${crypto.randomUUID()}`;
    const created = await createTicket(owner);
    const attacker = `gateway-ws-attacker-${crypto.randomUUID()}`;
    const forbiddenResponse = await fetchWebSocket(
      eventsWsPath(pool.id, created.ticket.id),
      {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": protocol,
        "x-test-principal": attacker,
      },
    );
    expect(forbiddenResponse.status).toBe(403);
    await expect(
      forbiddenResponse.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("マッチングチケット入力の検証", () => {
  // 結果登録経路は既定で拒否されるため、認可を許可した Worker を用意します。
  const authorizingWorker = defineFlareLobby({
    customRooms: { maxPlayers: 4, defaultSettings: {} },
    matchmakingPools: [pool],
    authenticate: (request) => {
      const principalId = request.headers.get("x-test-principal");
      if (principalId !== null && principalId.length > 0) {
        return { id: principalId, playerId: `${principalId}-player` };
      }
      return null;
    },
    authorization: { authorizeMatchResult: () => true },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
  }).createGatewayWorker<Env & typeof env>();

  async function fetchAuthorizingWorker(
    path: string,
    principalId: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-test-principal", principalId);
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    return authorizingWorker.fetch(
      new Request(`https://example.test${path}`, {
        ...init,
        headers,
      }) as unknown as Parameters<typeof authorizingWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
  }

  it("チケット作成の requestId・pool・属性を検証する", async () => {
    const principalId = `gateway-validation-${crypto.randomUUID()}`;

    // requestId 省略は INVALID_PAYLOAD です。
    const missingRequest = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`,
      principalId,
      { method: "POST", body: JSON.stringify({ rating: 1_500 }) },
    );
    expect(missingRequest.status).toBe(400);
    await expect(
      missingRequest.json<{ code: string }>(),
    ).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });

    // 文字列以外の requestId も INVALID_PAYLOAD です。
    const nonStringRequest = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`,
      principalId,
      { method: "POST", body: JSON.stringify({ requestId: 123 }) },
    );
    expect(nonStringRequest.status).toBe(400);
    await expect(
      nonStringRequest.json<{ code: string }>(),
    ).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });

    // 経路と異なる pool 指定は CONFLICT です。
    const poolMismatch = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`,
      principalId,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `request-${crypto.randomUUID()}`,
          pool: { ...pool, id: "other-pool" },
        }),
      },
    );
    expect(poolMismatch.status).toBe(400);
    await expect(poolMismatch.json<{ code: string }>()).resolves.toMatchObject({
      code: "CONFLICT",
    });

    // 数値でない rating・ttlMs・expiresAt・searchAttributes は INVALID_PAYLOAD です。
    const invalidFields: readonly Record<string, unknown>[] = [
      { requestId: `request-${crypto.randomUUID()}`, rating: "high" },
      { requestId: `request-${crypto.randomUUID()}`, ttlMs: "soon" },
      { requestId: `request-${crypto.randomUUID()}`, expiresAt: true },
      {
        requestId: `request-${crypto.randomUUID()}`,
        searchAttributes: ["fast"],
      },
    ];
    for (const body of invalidFields) {
      const response = await fetchWorker(
        `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets`,
        principalId,
        { method: "POST", body: JSON.stringify(body) },
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
      await expect(
        response.json<{ code: string }>(),
        JSON.stringify(body),
      ).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("キャンセルと結果登録の不正な本文を拒否する", async () => {
    const principalId = `gateway-invalid-body-${crypto.randomUUID()}`;
    const created = await createTicket(principalId);

    const invalidCancel = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/${encodeURIComponent(created.ticket.id)}/cancel`,
      principalId,
      { method: "POST", body: "not-json" },
    );
    expect(invalidCancel.status).toBe(400);
    await expect(invalidCancel.json<{ code: string }>()).resolves.toMatchObject(
      { code: "INVALID_MESSAGE" },
    );

    const invalidResult = await fetchAuthorizingWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/matches/match-gateway-invalid/result`,
      principalId,
      { method: "POST", body: "not-json" },
    );
    expect(invalidResult.status).toBe(400);
    await expect(invalidResult.json<{ code: string }>()).resolves.toMatchObject(
      { code: "INVALID_MESSAGE" },
    );
  });

  it("未知のマッチング経路は 404 として扱う", async () => {
    const principalId = `gateway-unknown-route-${crypto.randomUUID()}`;

    // Pool 直下の GET は経路として解釈されません。
    const poolBase = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}`,
      principalId,
    );
    expect(poolBase.status).toBe(404);

    // チケット配下の未知アクションも 404 です。
    const unknownAction = await fetchWorker(
      `/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/tickets/ticket-x/unknown`,
      principalId,
    );
    expect(unknownAction.status).toBe(404);

    // 不正なパーセントエンコーディングも 404 です。
    const invalidEncoding = await fetchWorker(
      "/v1/matchmaking/pools/%zz/tickets/ticket-x",
      principalId,
    );
    expect(invalidEncoding.status).toBe(404);
  });
});
