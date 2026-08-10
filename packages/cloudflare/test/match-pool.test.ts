import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  MatchPoolDurableObject,
  authenticateGatewayRequest,
  createMatchmakingPoolKey
} from "../src/index.js";
import type { MatchmakingPool } from "@flarelobby/core";
import type {
  GatewayPrincipalEnvelope,
  MatchmakingTicketCreationOptions
} from "../src/index.js";

const TOKEN_SECRET = "flarelobby-test-token-secret";

function createPool(suffix = crypto.randomUUID()): MatchmakingPool {
  return {
    id: `ranked-${suffix}`,
    gameId: `test-game-${suffix}`,
    seasonId: "season-1",
    mode: "ranked-1v1",
    region: "jp"
  };
}

async function createGatewayPrincipal(
  principalId: string
): Promise<GatewayPrincipalEnvelope> {
  const result = await authenticateGatewayRequest(
    new Request("https://example.test/matchmaking", { method: "POST" }),
    () => ({ id: principalId, playerId: `${principalId}-player` }),
    TOKEN_SECRET
  );

  if (!result.ok) {
    throw result.error;
  }

  return result.value.gatewayPrincipal;
}

async function createInitializedPool(
  pool = createPool()
): Promise<{
  readonly pool: MatchmakingPool;
  readonly stub: DurableObjectStub<MatchPoolDurableObject>;
}> {
  const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
    createMatchmakingPoolKey(pool)
  );
  await stub.initialize({ pool });
  return { pool, stub };
}

function createTicketOptions(
  gatewayPrincipal: GatewayPrincipalEnvelope,
  overrides: Partial<MatchmakingTicketCreationOptions> = {}
): MatchmakingTicketCreationOptions {
  return {
    gatewayPrincipal,
    requestId: `request-${crypto.randomUUID()}`,
    rating: 1_500,
    inputMethod: "keyboard_mouse",
    searchAttributes: { platform: "web", role: "duelist" },
    expiresAt: Date.now() + 60_000,
    ...overrides
  };
}

describe("Match Pool Durable Object", () => {
  it("プールを決定的に識別し、チケットの検索属性を SQLite へ保存する", async () => {
    const { pool, stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const ticket = await stub.createTicket(
      createTicketOptions(principal, { region: pool.region })
    );

    expect(ticket.status).toBe("waiting");
    expect(ticket.pool).toEqual(pool);
    expect(ticket.rating.value).toBe(1_500);
    expect(ticket.region).toBe("jp");
    expect(ticket.inputMethod).toBe("keyboard_mouse");
    expect(ticket.searchAttributes).toEqual({
      platform: "web",
      role: "duelist"
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
            ticket.id
          )
          .one();

        expect(row).toEqual({
          status: "waiting",
          region: "jp",
          inputMethod: "keyboard_mouse",
          searchAttributes: JSON.stringify({
            platform: "web",
            role: "duelist"
          })
        });
      }
    );
  });

  it("同じ作成要求の同時再送を同じチケットへ収束させる", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const options = createTicketOptions(principal);
    const tickets = await Promise.all(
      Array.from({ length: 4 }, () => stub.createTicket(options))
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
          await instance.createTicket({ ...options, inputMethod: "controller" });
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return undefined;
      }
    );
    expect(duplicateCode).toBe("CONFLICT");
  });

  it("同一 Pool の同一プレイヤーを有効チケットへ重複参加させない", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
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
      }
    );
    expect(duplicateCode).toBe("CONFLICT");
  });

  it("待機中チケットをキャンセルし、同じキャンセル要求を冪等に返す", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const ticket = await stub.createTicket(createTicketOptions(principal));
    const requestId = `cancel-${crypto.randomUUID()}`;
    const options = {
      gatewayPrincipal: principal,
      ticketId: ticket.id,
      requestId
    } as const;

    const cancelled = await stub.cancelTicket(options);
    const retried = await stub.cancelTicket(options);

    expect(cancelled.status).toBe("cancelled");
    expect(retried).toEqual(cancelled);
    await expect(stub.getTicket(ticket.id)).resolves.toMatchObject({
      status: "cancelled"
    });
  });

  it("候補確保後のキャンセル競合は CONFLICT で拒否し、reserved を維持する", async () => {
    const { stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const secondPrincipal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(createTicketOptions(secondPrincipal));
    const candidate = {
      id: `candidate-${crypto.randomUUID()}`,
      pool: first.pool,
      ticketIds: [first.id, second.id] as const,
      createdAt: new Date().toISOString()
    };

    const reserved = await stub.reserveCandidate({ candidate });
    expect(reserved.map((ticket) => ticket.status)).toEqual([
      "reserved",
      "reserved"
    ]);

    const cancelCode = await runInDurableObject(
      stub,
      async (instance: MatchPoolDurableObject) => {
        try {
          await instance.cancelTicket({
            gatewayPrincipal: firstPrincipal,
            ticketId: first.id
          });
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return undefined;
      }
    );
    expect(cancelCode).toBe("CONFLICT");
    await expect(stub.getTicket(first.id)).resolves.toMatchObject({
      status: "reserved"
    });
  });

  it("期限到達時に待機中チケットを expired へ遷移し、Alarm 再試行で重複しない", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const ticket = await stub.createTicket(
      createTicketOptions(principal, { expiresAt: Date.now() - 1 })
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
            ticket.id
          )
          .one().count
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
            ticket.id
          )
          .one().count
    );

    expect(eventCountAfterRetry).toBe(eventCountBeforeRetry);
  });

  it("終端状態を待機状態へ戻さず、異なる Pool のチケットを分離する", async () => {
    const firstSetup = await createInitializedPool();
    const secondSetup = await createInitializedPool(
      createPool(crypto.randomUUID())
    );
    const principal = await createGatewayPrincipal(`principal-${crypto.randomUUID()}`);
    const first = await firstSetup.stub.createTicket(
      createTicketOptions(principal, { expiresAt: Date.now() - 1 })
    );
    const second = await secondSetup.stub.createTicket(
      createTicketOptions(principal, { expiresAt: Date.now() + 60_000 })
    );

    expect(first.pool).not.toEqual(second.pool);
    expect(first.status).toBe("waiting");
    expect(second.status).toBe("waiting");

    await runInDurableObject(
      firstSetup.stub,
      async (instance: MatchPoolDurableObject) => {
        await instance.expireDueTickets(Date.now());
      }
    );

    await expect(firstSetup.stub.getTicket(first.id)).resolves.toMatchObject({
      status: "expired"
    });
    await expect(secondSetup.stub.getTicket(second.id)).resolves.toMatchObject({
      status: "waiting"
    });

    const events = await firstSetup.stub.getTicketEvents({
      gatewayPrincipal: principal,
      ticketId: first.id
    });
    expect(events.map((event) => event.type)).toEqual([
      "creating",
      "waiting",
      "expired"
    ]);
  });
});
