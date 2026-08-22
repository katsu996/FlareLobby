import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
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
