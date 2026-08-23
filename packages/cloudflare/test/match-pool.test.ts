import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  MatchPoolDurableObject,
  authenticateGatewayRequest,
  createMatchmakingPoolKey,
} from "../src/index.js";
import type { MatchmakingPool } from "@flarelobby/core";
import type {
  GatewayPrincipalEnvelope,
  MatchmakingSearchPolicy,
  MatchmakingTicketCreationOptions,
} from "../src/index.js";

const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;

function createPool(suffix = crypto.randomUUID()): MatchmakingPool {
  return {
    id: `ranked-${suffix}`,
    gameId: `test-game-${suffix}`,
    seasonId: "season-1",
    mode: "ranked-1v1",
    region: "jp",
  };
}

async function createGatewayPrincipal(
  principalId: string,
): Promise<GatewayPrincipalEnvelope> {
  const result = await authenticateGatewayRequest(
    new Request("https://example.test/matchmaking", { method: "POST" }),
    () => ({ id: principalId, playerId: `${principalId}-player` }),
    TOKEN_SECRET,
  );

  if (!result.ok) {
    throw result.error;
  }

  return result.value.gatewayPrincipal;
}

async function createInitializedPool(pool = createPool()): Promise<{
  readonly pool: MatchmakingPool;
  readonly stub: DurableObjectStub<MatchPoolDurableObject>;
}> {
  const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
    createMatchmakingPoolKey(pool),
  );
  await stub.initialize({ pool });
  return { pool, stub };
}

function createTicketOptions(
  gatewayPrincipal: GatewayPrincipalEnvelope,
  overrides: Partial<MatchmakingTicketCreationOptions> = {},
): MatchmakingTicketCreationOptions {
  return {
    gatewayPrincipal,
    requestId: `request-${crypto.randomUUID()}`,
    rating: 1_500,
    inputMethod: "keyboard_mouse",
    searchAttributes: { platform: "web", role: "duelist" },
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function getQueuedAt(ticket: {
  readonly status: string;
  readonly createdAt: string;
  readonly queuedAt?: string;
}): string {
  return ticket.status === "waiting" && ticket.queuedAt !== undefined
    ? ticket.queuedAt
    : ticket.createdAt;
}

describe("Match Pool Durable Object", () => {
  it("プールを決定的に識別し、チケットの検索属性を SQLite へ保存する", async () => {
    const { pool, stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(
      createTicketOptions(principal, { region: pool.region }),
    );

    expect(ticket.status).toBe("waiting");
    expect(ticket.pool).toEqual(pool);
    expect(ticket.rating.value).toBe(1_500);
    expect(ticket.region).toBe("jp");
    expect(ticket.inputMethod).toBe("keyboard_mouse");
    expect(ticket.searchAttributes).toEqual({
      platform: "web",
      role: "duelist",
    });

    await runInDurableObject(
      stub,
      (_instance: MatchPoolDurableObject, state) => {
        const row = state.storage.sql
          .exec<{
            status: string;
            region: string;
            inputMethod: string;
            searchAttributes: string;
          }>(
            `SELECT status, region, input_method AS inputMethod,
                    search_attributes_json AS searchAttributes
             FROM flarelobby_matchmaking_tickets
             WHERE ticket_id = ?`,
            ticket.id,
          )
          .one();

        expect(row).toEqual({
          status: "waiting",
          region: "jp",
          inputMethod: "keyboard_mouse",
          searchAttributes: JSON.stringify({
            platform: "web",
            role: "duelist",
          }),
        });
      },
    );
  });

  it("同じ作成要求の同時再送を同じチケットへ収束させる", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const options = createTicketOptions(principal);
    const tickets = await Promise.all(
      Array.from({ length: 4 }, () => stub.createTicket(options)),
    );

    expect(new Set(tickets.map((ticket) => ticket.id)).size).toBe(1);
    expect(tickets.every((ticket) => ticket.status === "waiting")).toBe(true);

    const duplicate = await stub.createTicket(options);
    expect(duplicate.id).toBe(tickets[0]?.id);
    expect(duplicate.inputMethod).toBe("keyboard_mouse");

    const duplicateCode = await runInDurableObject(
      stub,
      async (instance: MatchPoolDurableObject) => {
        try {
          await instance.createTicket({
            ...options,
            inputMethod: "controller",
          });
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return undefined;
      },
    );
    expect(duplicateCode).toBe("CONFLICT");
  });

  it("同一 Pool の同一プレイヤーを有効チケットへ重複参加させない", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await stub.createTicket(createTicketOptions(principal));

    const duplicateCode = await runInDurableObject(
      stub,
      async (instance: MatchPoolDurableObject) => {
        try {
          await instance.createTicket(createTicketOptions(principal));
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return undefined;
      },
    );
    expect(duplicateCode).toBe("CONFLICT");
  });

  it("待機中チケットをキャンセルし、同じキャンセル要求を冪等に返す", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(createTicketOptions(principal));
    const requestId = `cancel-${crypto.randomUUID()}`;
    const options = {
      gatewayPrincipal: principal,
      ticketId: ticket.id,
      requestId,
    } as const;

    const cancelled = await stub.cancelTicket(options);
    const retried = await stub.cancelTicket(options);

    expect(cancelled.status).toBe("cancelled");
    expect(retried).toEqual(cancelled);
    await expect(stub.getTicket(ticket.id)).resolves.toMatchObject({
      status: "cancelled",
    });
  });

  it("成立処理後のキャンセル競合は CONFLICT で拒否し、matched を維持する", async () => {
    const { stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_600 }),
    );
    const candidate = {
      id: `candidate-${crypto.randomUUID()}`,
      pool: first.pool,
      ticketIds: [first.id, second.id] as const,
      createdAt: new Date().toISOString(),
    };

    const reserved = await stub.reserveCandidate({ candidate });
    expect(reserved.map((ticket) => ticket.status)).toEqual([
      "matched",
      "matched",
    ]);

    const cancelCode = await runInDurableObject(
      stub,
      async (instance: MatchPoolDurableObject) => {
        try {
          await instance.cancelTicket({
            gatewayPrincipal: firstPrincipal,
            ticketId: first.id,
          });
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return undefined;
      },
    );
    expect(cancelCode).toBe("CONFLICT");
    await expect(stub.getTicket(first.id)).resolves.toMatchObject({
      status: "matched",
    });
  });

  it("期限到達時に待機中チケットを expired へ遷移し、Alarm 再試行で重複しない", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(
      createTicketOptions(principal, { expiresAt: Date.now() - 1 }),
    );

    await runInDurableObject(stub, async (instance: MatchPoolDurableObject) => {
      await instance.alarm();
    });
    const expired = await stub.getTicket(ticket.id);
    expect(expired?.status).toBe("expired");

    const eventCountBeforeRetry = await runInDurableObject(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_matchmaking_events WHERE ticket_id = ?",
            ticket.id,
          )
          .one().count,
    );
    await runInDurableObject(stub, async (instance: MatchPoolDurableObject) => {
      await instance.alarm();
    });
    const eventCountAfterRetry = await runInDurableObject(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_matchmaking_events WHERE ticket_id = ?",
            ticket.id,
          )
          .one().count,
    );

    expect(eventCountAfterRetry).toBe(eventCountBeforeRetry);
  });

  it("終端状態を待機状態へ戻さず、異なる Pool のチケットを分離する", async () => {
    const firstSetup = await createInitializedPool();
    const secondSetup = await createInitializedPool(
      createPool(crypto.randomUUID()),
    );
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await firstSetup.stub.createTicket(
      createTicketOptions(principal, { expiresAt: Date.now() - 1 }),
    );
    const second = await secondSetup.stub.createTicket(
      createTicketOptions(principal, { expiresAt: Date.now() + 60_000 }),
    );

    expect(first.pool).not.toEqual(second.pool);
    expect(first.status).toBe("waiting");
    expect(second.status).toBe("waiting");

    await runInDurableObject(
      firstSetup.stub,
      async (instance: MatchPoolDurableObject) => {
        await instance.expireDueTickets(Date.now());
      },
    );

    await expect(firstSetup.stub.getTicket(first.id)).resolves.toMatchObject({
      status: "expired",
    });
    await expect(secondSetup.stub.getTicket(second.id)).resolves.toMatchObject({
      status: "waiting",
    });

    const events = await firstSetup.stub.getTicketEvents({
      gatewayPrincipal: principal,
      ticketId: first.id,
    });
    expect(events.map((event) => event.type)).toEqual([
      "creating",
      "waiting",
      "expired",
    ]);
  });

  it("チケット追加時に検索幅内の候補を自動確保し、不要な Alarm を残さない", async () => {
    const { stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(
      createTicketOptions(firstPrincipal, { rating: 1_500 }),
    );
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_575 }),
    );

    expect(first.status).toBe("waiting");
    expect(second.status).toBe("matched");
    await expect(stub.getTicket(first.id)).resolves.toMatchObject({
      status: "matched",
    });
    await expect(stub.getNextAlarm()).resolves.toBeNull();

    const events = await stub.getTicketEvents({
      gatewayPrincipal: secondPrincipal,
      ticketId: second.id,
    });
    expect(events.map((event) => event.type)).toEqual([
      "creating",
      "waiting",
      "reserved",
      "matched",
    ]);
  });

  it("検索幅境界で品質説明を返し、幅拡大後だけ候補を確保する", async () => {
    const { stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(
      createTicketOptions(firstPrincipal, {
        rating: 1_500,
        expiresAt: Date.now() + 300_000,
      }),
    );
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, {
        rating: 1_600,
        expiresAt: Date.now() + 300_000,
      }),
    );
    const latestQueuedAt = Math.max(
      Date.parse(getQueuedAt(first)),
      Date.parse(getQueuedAt(second)),
    );

    const tooEarly = await stub.searchCandidates({
      now: latestQueuedAt + 19_999,
    });
    expect(tooEarly.candidates).toHaveLength(0);

    const atBoundary = await stub.searchCandidates({
      now: latestQueuedAt + 20_000,
    });
    expect(atBoundary.candidates).toHaveLength(1);
    expect(atBoundary.candidates[0]?.quality).toMatchObject({
      ratingDifference: 100,
      regionMatch: true,
      inputMethodMatch: true,
    });
    expect(atBoundary.candidates[0]?.quality.waitingTimeMs).toHaveLength(2);

    const reserved = await stub.searchAndReserveCandidates({
      now: latestQueuedAt + 20_000,
    });
    expect(reserved.candidates).toHaveLength(1);
    expect(new Set(reserved.candidates[0]?.candidate.ticketIds)).toEqual(
      new Set([first.id, second.id]),
    );
    await expect(stub.getNextAlarm()).resolves.toBeNull();
  });

  it("検索幅変更時刻の Alarm で候補探索を起動する", async () => {
    const { stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(
      createTicketOptions(firstPrincipal, {
        rating: 1_500,
        expiresAt: Date.now() + 300_000,
      }),
    );
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, {
        rating: 1_600,
        expiresAt: Date.now() + 300_000,
      }),
    );
    const oldestQueuedAt = Math.min(
      Date.parse(getQueuedAt(first)),
      Date.parse(getQueuedAt(second)),
    );
    const nextAlarm = await stub.getNextAlarm();

    expect(nextAlarm).toBe(oldestQueuedAt + 20_000);

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET queued_at = ?
         WHERE ticket_id IN (?, ?)`,
        new Date(Date.now() - 20_000).toISOString(),
        first.id,
        second.id,
      );
    });
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm();
    });

    await expect(stub.getTicket(first.id)).resolves.toMatchObject({
      status: "matched",
    });
    await expect(stub.getTicket(second.id)).resolves.toMatchObject({
      status: "matched",
    });
    await expect(stub.getNextAlarm()).resolves.toBeNull();
  });

  it("プール設定を永続化し、設定変更時に検索を再実行する", async () => {
    const pool = createPool();
    const policy: MatchmakingSearchPolicy = {
      stages: [{ afterMs: 0, maxRatingDifference: 20 }],
      maxRatingDifference: 20,
      maxTicketsPerSearch: 16,
      maxCandidatesPerSearch: 64,
      maxMatchesPerSearch: 4,
    };
    const { stub } = await createInitializedPool(pool);
    await stub.configureSearchPolicy(policy);

    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(
      createTicketOptions(firstPrincipal, { rating: 1_500 }),
    );
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_530 }),
    );

    expect(first.status).toBe("waiting");
    expect(second.status).toBe("waiting");
    await expect(stub.getSearchPolicy()).resolves.toMatchObject({
      maxRatingDifference: 20,
      stages: [{ afterMs: 0, maxRatingDifference: 20 }],
    });

    const expanded = await stub.configureSearchPolicy({
      ...policy,
      stages: [{ afterMs: 0, maxRatingDifference: 40 }],
      maxRatingDifference: 40,
    });
    expect(expanded.maxRatingDifference).toBe(40);
    await expect(stub.getTicket(first.id)).resolves.toMatchObject({
      status: "matched",
    });
    await expect(stub.getTicket(second.id)).resolves.toMatchObject({
      status: "matched",
    });
  });

  it("大量チケットを評価しても選択済みチケットを重複確保しない", async () => {
    const { pool, stub } = await createInitializedPool();
    const created: { readonly id: string }[] = [];

    for (let index = 0; index < 20; index += 1) {
      const principal = await createGatewayPrincipal(
        `principal-${crypto.randomUUID()}`,
      );
      created.push(
        await stub.createTicket(
          createTicketOptions(principal, {
            rating: 1_500 + (index % 4),
            pool,
          }),
        ),
      );
    }

    const current = await Promise.all(
      created.map((ticket) => stub.getTicket(ticket.id)),
    );
    const matched = current.filter((ticket) => ticket?.status === "matched");
    const matchedIds = current.flatMap((ticket) =>
      ticket?.status === "matched" ? ticket.result.candidate.ticketIds : [],
    );

    expect(matched.length).toBe(20);
    expect(new Set(matchedIds).size).toBe(20);
    expect(
      new Set(
        matched.flatMap((ticket) =>
          ticket.status === "matched" ? ticket.result.matchId : [],
        ),
      ).size,
    ).toBe(10);
    await expect(stub.getSnapshot()).resolves.toMatchObject({
      waitingCount: 0,
      activeCount: 0,
    });
  });
});
