import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  MATCHMAKING_POOL_KEY_SEPARATOR,
  MatchPoolDurableObject,
  authenticateGatewayRequest,
  createMatchmakingMatchId,
  createMatchmakingPoolKey,
  createMatchmakingRoomId,
} from "../src/index.js";
import type {
  JsonObject,
  JsonValue,
  MatchCandidate,
  MatchmakingPool,
} from "@flarelobby/core";
import type {
  GatewayPrincipalEnvelope,
  MatchmakingMatchResult,
  MatchmakingSearchPolicy,
  MatchmakingTicketCreationOptions,
  MatchmakingTicketEventQueryOptions,
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

// 明示的な undefined 上書き（例: 既定 expiresAt の解除）を許す。
type TicketOptionOverrides = {
  [K in keyof MatchmakingTicketCreationOptions]?:
    | MatchmakingTicketCreationOptions[K]
    | undefined;
};

function createTicketOptions(
  gatewayPrincipal: GatewayPrincipalEnvelope,
  overrides: TicketOptionOverrides = {},
): MatchmakingTicketCreationOptions {
  const base: MatchmakingTicketCreationOptions = {
    gatewayPrincipal,
    requestId: `request-${crypto.randomUUID()}`,
    rating: 1_500,
    inputMethod: "keyboard_mouse",
    searchAttributes: { platform: "web", role: "duelist" },
    expiresAt: Date.now() + 60_000,
  };
  // overrides が明示的に undefined を指定した項目は既定値を解除する。
  return { ...base, ...overrides } as MatchmakingTicketCreationOptions;
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

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = error.code;
    if (typeof code === "string") {
      return code;
    }
  }
  return undefined;
}

function errorCodeOf(procedure: () => unknown): string | undefined {
  try {
    procedure();
    return undefined;
  } catch (error) {
    return extractErrorCode(error);
  }
}

async function captureErrorCode(
  stub: DurableObjectStub<MatchPoolDurableObject>,
  operation: (instance: MatchPoolDurableObject) => Promise<unknown>,
): Promise<string | undefined> {
  return runInDurableObject(stub, async (instance: MatchPoolDurableObject) => {
    try {
      await operation(instance);
    } catch (error) {
      return extractErrorCode(error);
    }
    return undefined;
  });
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

  it("プール識別子と成立 ID の生成ヘルパーは不正な入力を INVALID_PAYLOAD で拒否する", () => {
    const pool = createPool();

    expect(createMatchmakingPoolKey(pool)).toBe(
      [
        encodeURIComponent(pool.gameId),
        encodeURIComponent(pool.seasonId),
        encodeURIComponent(pool.mode),
        encodeURIComponent(pool.region),
      ].join(MATCHMAKING_POOL_KEY_SEPARATOR),
    );
    // 意図的に型違反の入力を渡して実行時検証を確認する
    const invalidPoolInput = null as unknown as MatchmakingPool;
    expect(errorCodeOf(() => createMatchmakingPoolKey(invalidPoolInput))).toBe(
      "INVALID_PAYLOAD",
    );
    expect(
      errorCodeOf(() => createMatchmakingPoolKey({ ...pool, gameId: " " })),
    ).toBe("INVALID_PAYLOAD");

    expect(createMatchmakingMatchId("candidate-1")).toBe("match_candidate-1");
    expect(createMatchmakingRoomId("match_candidate-1")).toBe(
      "room_match_candidate-1",
    );
    expect(errorCodeOf(() => createMatchmakingMatchId(""))).toBe(
      "INVALID_PAYLOAD",
    );
    expect(errorCodeOf(() => createMatchmakingRoomId(""))).toBe(
      "INVALID_PAYLOAD",
    );
    expect(errorCodeOf(() => createMatchmakingMatchId("x".repeat(2_049)))).toBe(
      "INVALID_PAYLOAD",
    );
    expect(errorCodeOf(() => createMatchmakingRoomId("x".repeat(2_049)))).toBe(
      "INVALID_PAYLOAD",
    );
  });

  it("未初期化の Match Pool は参照が null、操作は CONFLICT で拒否される", async () => {
    const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(createPool()),
    );
    const policy: MatchmakingSearchPolicy = {
      stages: [{ afterMs: 0, maxRatingDifference: 20 }],
      maxRatingDifference: 20,
      maxTicketsPerSearch: 16,
      maxCandidatesPerSearch: 64,
      maxMatchesPerSearch: 4,
    };
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );

    await expect(stub.getPool()).resolves.toBeNull();
    await expect(stub.getSearchPolicy()).resolves.toBeNull();
    await expect(stub.getSnapshot()).resolves.toBeNull();
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.configureSearchPolicy(policy),
      ),
    ).resolves.toBe("CONFLICT");
    await expect(
      captureErrorCode(stub, (instance) => instance.searchCandidates()),
    ).resolves.toBe("CONFLICT");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(createTicketOptions(principal)),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("再初期化は同一設定を冪等に返し、不正や不一致は拒否され、設定変更は反映される", async () => {
    const pool = createPool();
    const { stub } = await createInitializedPool(pool);
    const policy: MatchmakingSearchPolicy = {
      stages: [{ afterMs: 0, maxRatingDifference: 20 }],
      maxRatingDifference: 20,
      maxTicketsPerSearch: 16,
      maxCandidatesPerSearch: 64,
      maxMatchesPerSearch: 4,
    };

    await expect(stub.initializePool({ pool })).resolves.toEqual(pool);
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: { ...pool, seasonId: "" } }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: { ...pool, region: "us" } }),
      ),
    ).resolves.toBe("CONFLICT");

    const revisionBefore = (await stub.getSnapshot())?.revision ?? 0;
    await expect(stub.configureSearchPolicy(policy)).resolves.toMatchObject({
      maxRatingDifference: 20,
    });
    await expect(
      stub.initialize({ pool, matchRoom: { teamIds: ["red", "blue"] } }),
    ).resolves.toEqual(pool);

    expect((await stub.getSnapshot())?.revision).toBeGreaterThan(
      revisionBefore,
    );
    await expect(stub.getSearchPolicy()).resolves.toMatchObject({
      maxRatingDifference: 20,
    });
  });

  it("チケット作成は主体と request ID を検証する", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    // 意図的に gatewayPrincipal を欠いた要求
    const unauthenticatedOptions = {} as MatchmakingTicketCreationOptions;

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(unauthenticatedOptions),
      ),
    ).resolves.toBe("UNAUTHENTICATED");

    const tamperedPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket({
          ...createTicketOptions(principal),
          gatewayPrincipal: { token: `${tamperedPrincipal.token}-broken` },
        }),
      ),
    ).resolves.toBe("UNAUTHENTICATED");

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(
          createTicketOptions(principal, { playerId: "someone-else" }),
        ),
      ),
    ).resolves.toBe("FORBIDDEN");

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(
          createTicketOptions(principal, { requestId: "" }),
        ),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
  });

  it("チケット作成の属性指定は不正値を対応するエラーコードで拒否する", async () => {
    const { pool, stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    // 配列は JSON オブジェクトとして妥当でない検索属性
    const arraySearchAttributes = [
      ["platform", "web"],
    ] as unknown as MatchmakingTicketCreationOptions["searchAttributes"];
    const cases: readonly {
      readonly name: string;
      readonly overrides: TicketOptionOverrides;
      readonly code: string;
    }[] = [
      {
        name: "非整数のレート",
        overrides: { rating: 1_500.5 },
        code: "INVALID_PAYLOAD",
      },
      {
        name: "主体不一致のレート",
        overrides: { rating: { value: 1_500, playerId: "other-player" } },
        code: "CONFLICT",
      },
      {
        name: "Pool 不一致のレート",
        overrides: { rating: { value: 1_500, poolId: "other-pool" } },
        code: "CONFLICT",
      },
      {
        name: "リージョン不一致",
        overrides: { region: "us" },
        code: "CONFLICT",
      },
      {
        name: "空リージョン",
        overrides: { region: "" },
        code: "INVALID_PAYLOAD",
      },
      {
        name: "入力方法の不整合",
        overrides: { inputMethod: "controller", inputMode: "keyboard_mouse" },
        code: "CONFLICT",
      },
      {
        name: "長すぎる入力方法",
        overrides: { inputMethod: "x".repeat(129) },
        code: "INVALID_PAYLOAD",
      },
      {
        name: "expiresAt と ttlMs の併用",
        overrides: { expiresAt: Date.now() + 1_000, ttlMs: 1_000 },
        code: "CONFLICT",
      },
      {
        name: "解析できない expiresAt",
        overrides: { expiresAt: "yesterday" },
        code: "INVALID_PAYLOAD",
      },
      {
        name: "負の ttlMs",
        overrides: { expiresAt: undefined, ttlMs: -1 },
        code: "INVALID_PAYLOAD",
      },
      {
        name: "配列の検索属性",
        overrides: {
          searchAttributes: arraySearchAttributes as JsonObject,
        },
        code: "INVALID_PAYLOAD",
      },
      {
        name: "Pool 不一致の作成要求",
        overrides: { pool: { ...pool, mode: "casual-4v4" } },
        code: "CONFLICT",
      },
    ];

    for (const testCase of cases) {
      await expect(
        captureErrorCode(stub, (instance) =>
          instance.createTicket(
            createTicketOptions(principal, testCase.overrides),
          ),
        ),
      ).resolves.toBe(testCase.code);
    }
  });

  it("チケット作成は別形式の指定と省略時既定を受け付ける", async () => {
    const { pool, stub } = await createInitializedPool();

    const ttlPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ttlTicket = await stub.createTicket(
      createTicketOptions(ttlPrincipal, {
        ttlMs: 120_000,
        expiresAt: undefined,
      }),
    );
    expect(Date.parse(ttlTicket.expiresAt)).toBeGreaterThan(
      Date.now() + 60_000,
    );

    const isoExpiresAt = new Date(Date.now() + 90_000).toISOString();
    const isoPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const isoTicket = await stub.createTicket(
      createTicketOptions(isoPrincipal, {
        rating: { value: 900 },
        inputMethod: undefined,
        inputMode: "gamepad",
        expiresAt: isoExpiresAt,
      }),
    );
    expect(isoTicket.rating.value).toBe(900);
    expect(isoTicket.inputMethod).toBe("gamepad");
    expect(isoTicket.region).toBe(pool.region);
    expect(isoTicket.expiresAtMs).toBe(Date.parse(isoExpiresAt));

    await expect(
      stub.getTicket({ ticketId: isoTicket.id }),
    ).resolves.toMatchObject({ id: isoTicket.id });
    await expect(
      stub.getMatchmakingTicket(isoTicket.id),
    ).resolves.toMatchObject({
      id: isoTicket.id,
    });
    await expect(
      stub.getActiveTicket({ gatewayPrincipal: isoPrincipal }),
    ).resolves.toMatchObject({ id: isoTicket.id });

    const idlePrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await expect(
      stub.getTicketForPrincipal({ gatewayPrincipal: idlePrincipal }),
    ).resolves.toBeNull();
  });

  it("同じ requestId の作成再送は記録済み結果へ収束し、条件変更は CONFLICT で拒否される", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const options = createTicketOptions(principal, {
      requestId: `request-${crypto.randomUUID()}`,
    });

    const created = await stub.createTicket(options);
    await expect(stub.createTicket(options)).resolves.toMatchObject({
      id: created.id,
    });

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket({ ...options, rating: 1_234 }),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("キャンセルは状態遷移の境界で拒否され、終端状態はそのまま返す", async () => {
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
    await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_575 }),
    );

    // 成立済みチケットはキャンセルできない
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.cancelTicket({
          gatewayPrincipal: firstPrincipal,
          ticketId: first.id,
        }),
      ),
    ).resolves.toBe("CONFLICT");

    // 存在しないチケット
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.cancelTicket({
          gatewayPrincipal: firstPrincipal,
          ticketId: "ticket_missing",
        }),
      ),
    ).resolves.toBe("CONFLICT");

    // 他人のチケット
    const thirdPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const third = await stub.createTicket(
      createTicketOptions(thirdPrincipal, { rating: 300 }),
    );
    const stranger = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.cancelTicket({
          gatewayPrincipal: stranger,
          ticketId: third.id,
        }),
      ),
    ).resolves.toBe("FORBIDDEN");

    // 同一 requestId でも条件が異なる再生は拒否する
    const replayPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const replayTicket = await stub.createTicket(
      createTicketOptions(replayPrincipal, { rating: 700 }),
    );
    const replayRequestId = `cancel-${crypto.randomUUID()}`;
    await stub.cancelTicket({
      gatewayPrincipal: replayPrincipal,
      ticketId: replayTicket.id,
      requestId: replayRequestId,
    });
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.cancelTicket({
          gatewayPrincipal: replayPrincipal,
          ticketId: replayTicket.id,
          requestId: replayRequestId,
          requestPayload: { ticketId: replayTicket.id, reason: "retry" },
        }),
      ),
    ).resolves.toBe("CONFLICT");

    // 期限切れチケットはそのまま返る
    const expiringPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const expiring = await stub.createTicket(
      createTicketOptions(expiringPrincipal, {
        rating: 1_100,
        expiresAt: Date.now() - 1,
      }),
    );
    await runInDurableObject(stub, async (instance: MatchPoolDurableObject) => {
      await instance.expireDueTickets(Date.now());
    });
    await expect(
      stub.cancelTicket({
        gatewayPrincipal: expiringPrincipal,
        ticketId: expiring.id,
      }),
    ).resolves.toMatchObject({ status: "expired" });

    // requestId 無しでもキャンセルできる
    await expect(
      stub.cancelTicket({
        gatewayPrincipal: thirdPrincipal,
        ticketId: third.id,
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("expireTicket は期限と状態の境界を検査する", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(createTicketOptions(principal));

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.expireTicket({ ticketId: "ticket_missing" }),
      ),
    ).resolves.toBe("CONFLICT");

    // 期限未到達のチケットは期限切れにできない
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.expireTicket({ ticketId: ticket.id }),
      ),
    ).resolves.toBe("CONFLICT");

    const expired = await stub.expireTicket({
      ticketId: ticket.id,
      now: ticket.expiresAtMs + 1,
    });
    expect(expired.status).toBe("expired");
    await expect(stub.expireTicket({ ticketId: ticket.id })).resolves.toEqual(
      expired,
    );
    await expect(stub.expireDueTickets()).resolves.toEqual([]);

    // 成立済みチケットは期限切れにできない
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(
      createTicketOptions(firstPrincipal, { rating: 1_500 }),
    );
    await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_575 }),
    );
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.expireTicket({ ticketId: first.id }),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("チケットイベントは所有者だけが参照でき、afterSequence で続きを読める", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(createTicketOptions(principal));

    const events = await stub.getTicketEvents({
      gatewayPrincipal: principal,
      ticketId: ticket.id,
    });
    expect(events.map((event) => event.type)).toEqual(["creating", "waiting"]);

    const restEvents = await stub.listTicketEvents({
      gatewayPrincipal: principal,
      ticketId: ticket.id,
      afterSequence: events[0]?.sequence ?? 0,
    });
    expect(restEvents.map((event) => event.type)).toEqual(["waiting"]);

    const stranger = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.getTicketEvents({
          gatewayPrincipal: stranger,
          ticketId: ticket.id,
        }),
      ),
    ).resolves.toBe("FORBIDDEN");

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.getTicketEvents({
          gatewayPrincipal: principal,
          ticketId: "ticket_missing",
        }),
      ),
    ).resolves.toBe("CONFLICT");

    // 意図的に ticketId を欠いた照会
    const queryWithoutTicketId = {
      gatewayPrincipal: principal,
    } as unknown as MatchmakingTicketEventQueryOptions;
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.getTicketEvents(queryWithoutTicketId),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
  });

  it("チケットイベントの HTTP 端点は認証と経路を検証する", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const base = "https://match-pool.test";
    const authHeaders = { "x-flarelobby-gateway-token": principal.token };
    interface TicketEventsResponse {
      readonly ticket: { readonly id: string };
      readonly events: readonly {
        readonly sequence: number;
        readonly type: string;
      }[];
    }

    expect((await stub.fetch(new Request(`${base}/unrelated`))).status).toBe(
      404,
    );
    expect((await stub.fetch(new Request(`${base}/events`))).status).toBe(404);
    expect(
      (await stub.fetch(new Request(`${base}/tickets/ticket_missing/events`)))
        .status,
    ).toBe(401);
    expect(
      (
        await stub.fetch(
          new Request(`${base}/tickets/ticket_missing/events`, {
            headers: { "x-flarelobby-gateway-token": "broken-token" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await stub.fetch(
          new Request(`${base}/tickets/ticket_missing/events`, {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);

    const ticket = await stub.createTicket(createTicketOptions(principal));

    const stranger = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    expect(
      (
        await stub.fetch(
          new Request(`${base}/tickets/${ticket.id}/events`, {
            headers: { "x-flarelobby-gateway-token": stranger.token },
          }),
        )
      ).status,
    ).toBe(403);
    // 不正な after クエリは INVALID_PAYLOAD の 400 応答へ正規化される
    const badAfter = await stub.fetch(
      new Request(`${base}/tickets/${ticket.id}/events?after=abc`, {
        headers: authHeaders,
      }),
    );
    expect(badAfter.status).toBe(400);
    expect(((await badAfter.json()) as { readonly code: string }).code).toBe(
      "INVALID_PAYLOAD",
    );

    const response = await stub.fetch(
      new Request(`${base}/tickets/${ticket.id}/events`, {
        headers: authHeaders,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as TicketEventsResponse;
    expect(body.ticket.id).toBe(ticket.id);
    expect(body.events.map((event) => event.type)).toEqual([
      "creating",
      "waiting",
    ]);

    const resumedResponse = await stub.fetch(
      new Request(
        `${base}/tickets/${ticket.id}/events?after=${body.events[0]?.sequence ?? 0}`,
        { headers: authHeaders },
      ),
    );
    const resumedBody = (await resumedResponse.json()) as TicketEventsResponse;
    expect(resumedBody.events.map((event) => event.type)).toEqual(["waiting"]);
  });

  it("チケットイベントの WebSocket 接続は以降の状態遷移を通知する", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(createTicketOptions(principal));

    const upgraded = await stub.fetch(
      new Request(`https://match-pool.test/tickets/${ticket.id}/events`, {
        headers: {
          "x-flarelobby-gateway-token": principal.token,
          upgrade: "websocket",
        },
      }),
    );
    expect(upgraded.status).toBe(101);

    const socket = upgraded.webSocket;
    if (socket === undefined || socket === null) {
      throw new Error("WebSocket ハンドシェイクに失敗しました");
    }
    socket.accept();

    type TicketEventMessage = {
      kind: string;
      payload: { ticket: { id: string; status: string }; sequence: number };
    };
    const buffered: TicketEventMessage[] = [];
    const waiters: ((message: TicketEventMessage) => void)[] = [];
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(
        String((event as MessageEvent).data),
      ) as TicketEventMessage;
      const resolver = waiters.shift();
      if (resolver !== undefined) {
        resolver(parsed);
      } else {
        buffered.push(parsed);
      }
    });
    const receiveEvent = () =>
      new Promise<TicketEventMessage>((resolve) => {
        const queued = buffered.shift();
        if (queued !== undefined) {
          resolve(queued);
        } else {
          waiters.push(resolve);
        }
      });

    // 接続時にバックログの creating / waiting が再生される
    expect((await receiveEvent()).payload.ticket.status).toBe("creating");
    expect((await receiveEvent()).payload.ticket.status).toBe("waiting");

    const cancelled = await stub.cancelTicket({
      gatewayPrincipal: principal,
      ticketId: ticket.id,
    });
    const notification = await receiveEvent();
    expect(notification.kind).toBe("event");
    expect(notification.payload.ticket).toMatchObject({
      id: ticket.id,
      status: "cancelled",
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("候補探索と成立意図の取得は入力を検証し、意図は識別子の種類ごとに読める", async () => {
    const { pool, stub } = await createInitializedPool();
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
    const thirdPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await stub.createTicket(
      createTicketOptions(thirdPrincipal, { rating: 300 }),
    );

    const immediate = await stub.findCandidates({
      now: new Date().toISOString(),
    });
    expect(immediate.candidates).toHaveLength(0);
    expect(immediate.inspectedTicketCount).toBe(3);

    const queuedAt = Math.max(
      Date.parse(getQueuedAt(first)),
      Date.parse(getQueuedAt(second)),
    );
    const atBoundary = await stub.searchCandidates({ now: queuedAt + 20_000 });
    expect(atBoundary.candidates).toHaveLength(1);

    const reserved = await stub.findAndReserveCandidates({
      now: queuedAt + 20_000,
    });
    expect(reserved.candidates).toHaveLength(1);

    // 遠い未来の now では待機行がすべて対象外になる
    const future = await stub.searchAndReserveCandidates({
      now: Date.now() + 10 * 60_000,
    });
    expect(future.candidates).toHaveLength(0);
    expect(future.inspectedTicketCount).toBe(0);
    expect(future.nextSearchAt).toBeNull();

    const matched = await stub.getTicket(first.id);
    if (matched === null || matched.status !== "matched") {
      throw new Error("候補が自動成立していません");
    }
    const result = matched.result;
    await expect(stub.getMatchIntent(result.matchId)).resolves.toMatchObject({
      matchId: result.matchId,
      status: "matched",
    });
    await expect(
      stub.getMatchIntent(result.candidate.id),
    ).resolves.toMatchObject({
      candidate: result.candidate,
      status: "matched",
    });
    await expect(
      stub.getMatchIntent({ matchId: result.matchId }),
    ).resolves.toMatchObject({ status: "matched" });
    await expect(
      stub.getMatchIntent({ candidateId: result.candidate.id }),
    ).resolves.toMatchObject({ status: "matched" });
    await expect(
      stub.getMatchIntent(`candidate-${crypto.randomUUID()}`),
    ).resolves.toBeNull();

    await expect(
      captureErrorCode(stub, (instance) => instance.getMatchIntent({})),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.processPendingMatches({ maxMatches: 0 }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.processPendingMatches({ now: -1 }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.searchCandidates({ now: "not-a-timestamp" }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");

    await expect(stub.settleMatches()).resolves.toEqual([]);
    await expect(stub.processMatchmaking()).resolves.toEqual([]);

    await expect(stub.getSnapshot()).resolves.toMatchObject({
      pool,
      waitingCount: 1,
      activeCount: 1,
      ticketCount: 3,
    });
  });

  it("matchCandidate は成立済み結果の再適用を冪等に返し、不整合な適用を CONFLICT で拒否する", async () => {
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
    await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_575 }),
    );

    const matched = await stub.getTicket(first.id);
    if (matched === null || matched.status !== "matched") {
      throw new Error("候補が自動成立していません");
    }

    // RPC 境界で ticketIds が配列へ広げて見えるため、契約型へ戻す。
    const result = matched.result as MatchmakingMatchResult;
    await runInDurableObject(stub, async (instance: MatchPoolDurableObject) => {
      const [appliedFirst, appliedSecond] = await instance.matchCandidate({
        result,
      });
      expect(appliedFirst.status).toBe("matched");
      expect(appliedSecond.status).toBe("matched");
    });

    // 同一チケットへ異なる結果は適用できない
    const altered = {
      ...result,
      createdAt: new Date(Date.parse(result.createdAt) + 1).toISOString(),
    };
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.matchCandidate({ result: altered }),
      ),
    ).resolves.toBe("CONFLICT");

    // 正常系の型を持つが対象チケットが存在しない成立結果
    const fabricatedMatchId = createMatchmakingMatchId("candidate-fabricated");
    const fabricated = {
      matchId: fabricatedMatchId,
      candidate: {
        id: "candidate-fabricated",
        pool: matched.pool,
        ticketIds: ["ticket_left", "ticket_right"],
        createdAt: new Date().toISOString(),
      },
      room: {
        id: createMatchmakingRoomId(fabricatedMatchId),
        kind: "match",
        matchId: fabricatedMatchId,
        pool: matched.pool,
        settings: {},
        metadata: {},
      },
      createdAt: new Date().toISOString(),
    } as MatchmakingMatchResult;
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.matchCandidate({ result: fabricated }),
      ),
    ).resolves.toBe("CONFLICT");

    // 待機中チケットと成立済みチケットの混在は予約済み候補として扱えない
    const thirdPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const third = await stub.createTicket(
      createTicketOptions(thirdPrincipal, { rating: 300 }),
    );
    const mixed = {
      ...fabricated,
      candidate: {
        ...fabricated.candidate,
        id: "candidate-mixed",
        ticketIds: [first.id, third.id] as const,
      },
    };
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.matchTickets({
          result: mixed as MatchmakingMatchResult,
        }),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("searchPolicy を変えて再初期化すると待機チケットの再検索が走る", async () => {
    const pool = createPool();
    const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool),
    );
    await stub.initialize({
      pool,
      searchPolicy: { stages: [{ afterMs: 0, maxRatingDifference: 10 }] },
    });

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
    await stub.createTicket(
      createTicketOptions(secondPrincipal, {
        rating: 1_600,
        expiresAt: Date.now() + 300_000,
      }),
    );
    expect((await stub.getTicket(first.id))?.status).toBe("waiting");

    const updated = await stub.initialize({
      pool,
      searchPolicy: { stages: [{ afterMs: 0, maxRatingDifference: 200 }] },
    });
    expect(updated.id).toBe(pool.id);
    await expect(stub.getSearchPolicy()).resolves.toMatchObject({
      stages: [{ maxRatingDifference: 200 }],
    });
    // 幅拡大後の再検索で待機していた 2 件が自動成立する
    expect((await stub.getTicket(first.id))?.status).toBe("matched");
  });

  it("初期化の Pool 定員と Room 設定は不正値を対応するエラーコードで拒否する", async () => {
    const base = createPool();
    const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(base),
    );

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: { ...base, maxPartySize: 0 } }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: { ...base, teamSize: 1.5 } }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: base, matchRoom: "ranked" as never }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({
          pool: base,
          matchRoom: { teamIds: ["alpha"], teams: ["bravo", "charlie"] },
        }),
      ),
    ).resolves.toBe("CONFLICT");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: base, matchRoom: { teamIds: ["alpha"] } }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({
          pool: base,
          matchRoom: { teamIds: ["alpha", "alpha"] },
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({ pool: base, matchRoom: { maxPlayers: 1 } }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({
          pool: base,
          matchRoom: { maxPlayers: 2, minimumPlayers: 3 },
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");

    // 拒否された初期化は状態を残さないため、正しい設定なら初期化できる
    await expect(stub.initialize({ pool: base })).resolves.toMatchObject({
      id: base.id,
    });
  });

  it("成立処理中の Match Pool は Room 設定を変更できない", async () => {
    const pool = createPool();
    const { stub } = await createInitializedPool(pool);
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    await stub.createTicket(
      createTicketOptions(firstPrincipal, { rating: 1_500 }),
    );
    await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 2_500 }),
    );

    // 障害復旧の途中で pending の成立意図が残った状態を再現する
    await runInDurableObject(
      stub,
      (_instance: MatchPoolDurableObject, state) => {
        const now = Date.now();
        state.storage.sql.exec(
          `INSERT INTO flarelobby_matchmaking_match_intents (
             match_id, candidate_id, pool_id, room_id, candidate_json,
             initialization_json, status, attempt_count, max_attempts,
             next_attempt_at, created_at, updated_at
           ) VALUES ('match_seed', 'candidate_seed', ?, 'room_seed', '{}', '{}',
             'pending', 0, 8, ?, ?, ?)`,
          pool.id,
          now + 3_600_000,
          now,
          now,
        );
      },
    );

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.initialize({
          pool,
          matchRoom: { teamIds: ["alpha", "bravo"] },
        }),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("別名の作成・キャンセル RPC は requestPayload の JSON 性を検証する", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );

    const ticket = await stub.createMatchmakingTicket(
      createTicketOptions(principal),
    );
    expect(ticket.status).toBe("waiting");

    // 循環参照を含む requestPayload は JSON 化できないため拒否する
    const cyclic: Record<string, unknown> = { ticketId: ticket.id };
    cyclic["self"] = cyclic;
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.cancelTicket({
          gatewayPrincipal: principal,
          ticketId: ticket.id,
          requestPayload: cyclic as unknown as JsonValue,
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");

    // JSON 値にできない構成員は拒否する
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.cancelTicket({
          gatewayPrincipal: principal,
          ticketId: ticket.id,
          requestPayload: { reason: undefined } as unknown as JsonValue,
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");

    // 配列や数値など正当な JSON 値はそのまま記録される
    const arrayCancelled = await stub.cancelTicket({
      gatewayPrincipal: principal,
      ticketId: ticket.id,
      requestPayload: ["user", 1.5],
    });
    expect(arrayCancelled.status).toBe("cancelled");

    const numberCancelled = await stub.cancelTicket({
      gatewayPrincipal: principal,
      ticketId: (await stub.createTicket(createTicketOptions(principal))).id,
      requestPayload: { reason: "user", weight: 1.5 },
    });
    expect(numberCancelled.status).toBe("cancelled");
  });

  it("同じ requestId の同時作成は進行中の要求へ収束し、条件が違えば CONFLICT になる", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const requestId = `request-${crypto.randomUUID()}`;
    const expiresAt = Date.now() + 300_000;

    const [left, right] = await Promise.all([
      stub.createTicket(
        createTicketOptions(principal, { requestId, expiresAt }),
      ),
      stub.createTicket(
        createTicketOptions(principal, { requestId, expiresAt }),
      ),
    ]);
    expect(right.id).toBe(left.id);

    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const conflictRequestId = `request-${crypto.randomUUID()}`;
    const [win, lose] = await Promise.allSettled([
      stub.createTicket(
        createTicketOptions(secondPrincipal, {
          requestId: conflictRequestId,
          expiresAt,
        }),
      ),
      stub.createTicket(
        createTicketOptions(secondPrincipal, {
          requestId: conflictRequestId,
          expiresAt,
          rating: 1_700,
        }),
      ),
    ]);
    const outcomes = [win, lose].map((outcome) => outcome.status);
    expect(outcomes).toContain("fulfilled");
    const rejected = [win, lose].find(
      (outcome) => outcome.status === "rejected",
    );
    if (rejected === undefined || rejected.status !== "rejected") {
      throw new Error("条件違いの同時作成が拒否されていません");
    }
    expect(extractErrorCode(rejected.reason)).toBe("CONFLICT");
  });

  it("reserveCandidate は候補の形状と Pool 一致を検証する", async () => {
    const { pool, stub } = await createInitializedPool();
    const asCandidate = (value: unknown): MatchCandidate =>
      value as MatchCandidate;

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.reserveCandidate({ candidate: asCandidate(null) }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.reserveCandidate({
          candidate: asCandidate({
            id: `candidate-${crypto.randomUUID()}`,
            pool,
            ticketIds: ["ticket_only"],
            createdAt: new Date().toISOString(),
          }),
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.reserveCandidate({
          candidate: asCandidate({
            id: `candidate-${crypto.randomUUID()}`,
            pool,
            ticketIds: ["ticket_same", "ticket_same"],
            createdAt: new Date().toISOString(),
          }),
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.reserveCandidate({
          candidate: asCandidate({
            id: `candidate-${crypto.randomUUID()}`,
            pool: { ...pool, id: `other-${pool.id}` },
            ticketIds: ["ticket_left", "ticket_right"],
            createdAt: new Date().toISOString(),
          }),
        }),
      ),
    ).resolves.toBe("CONFLICT");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.reserveCandidate({
          candidate: asCandidate({
            id: `candidate-${crypto.randomUUID()}`,
            pool,
            ticketIds: ["ticket_left", "ticket_right"],
            createdAt: new Date().toISOString(),
          }),
        }),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("検索幅外の 2 件でも reserveTicket / reserveTickets で確保し成立できる", async () => {
    const { pool, stub } = await createInitializedPool();
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
        rating: 2_500,
        expiresAt: Date.now() + 300_000,
      }),
    );

    const single = await stub.reserveTicket({
      candidate: {
        id: `candidate-${crypto.randomUUID()}`,
        pool,
        ticketIds: [first.id, second.id],
        createdAt: new Date().toISOString(),
      },
    });
    expect(single.id).toBe(first.id);
    // 確保後は直ちに成立処理が進むため matched へ到達する
    expect(single.status).toBe("matched");

    const thirdPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const fourthPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const third = await stub.createTicket(
      createTicketOptions(thirdPrincipal, {
        rating: 1_300,
        expiresAt: Date.now() + 300_000,
      }),
    );
    const fourth = await stub.createTicket(
      createTicketOptions(fourthPrincipal, {
        rating: 2_300,
        expiresAt: Date.now() + 300_000,
      }),
    );
    const [pairedFirst, pairedSecond] = await stub.reserveTickets({
      candidate: {
        id: `candidate-${crypto.randomUUID()}`,
        pool,
        ticketIds: [third.id, fourth.id],
        createdAt: new Date().toISOString(),
      },
    });
    expect(pairedFirst?.status).toBe("matched");
    expect(pairedSecond?.status).toBe("matched");
  });

  it("matchCandidate は成立結果の Room 形状と Pool 一致を検証する", async () => {
    const { pool, stub } = await createInitializedPool();
    const matchId = createMatchmakingMatchId(
      `candidate-${crypto.randomUUID()}`,
    );
    const base = {
      matchId,
      candidate: {
        id: `candidate-${crypto.randomUUID()}`,
        pool,
        ticketIds: ["ticket_left", "ticket_right"] as const,
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };
    const room = {
      id: createMatchmakingRoomId(matchId),
      kind: "match",
      matchId,
      pool,
      settings: {},
      metadata: {},
    } as const;

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.matchCandidate({ result: null as never }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.matchCandidate({
          result: {
            ...base,
            room: { ...room, kind: "duel" },
          } as never,
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.matchCandidate({
          result: {
            ...base,
            room: { ...room, pool: { ...pool, id: `other-${pool.id}` } },
          } as never,
        }),
      ),
    ).resolves.toBe("CONFLICT");
  });

  it("expiresAt / ttlMs の境界値は INVALID_PAYLOAD で拒否される", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(
          createTicketOptions(principal, {
            requestId: `request-${crypto.randomUUID()}`,
            expiresAt: -1,
          }),
        ),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(
          createTicketOptions(principal, {
            requestId: `request-${crypto.randomUUID()}`,
            expiresAt: "+999999-12-31T23:59:59.999Z",
          }),
        ),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(
          createTicketOptions(principal, {
            requestId: `request-${crypto.randomUUID()}`,
            expiresAt: undefined as unknown as string,
            ttlMs: Number.MAX_SAFE_INTEGER,
          }),
        ),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket(
          createTicketOptions(principal, {
            requestId: `request-${crypto.randomUUID()}`,
            expiresAt: undefined,
            ttlMs: -1,
          }),
        ),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
  });

  it("searchAttributes は JSON オブジェクトだけを受け付ける", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );

    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket({
          ...createTicketOptions(principal, {
            requestId: `request-${crypto.randomUUID()}`,
          }),
          searchAttributes: { platform: undefined } as unknown as JsonObject,
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
    await expect(
      captureErrorCode(stub, (instance) =>
        instance.createTicket({
          ...createTicketOptions(principal, {
            requestId: `request-${crypto.randomUUID()}`,
          }),
          searchAttributes: ["web", "mobile"] as never,
        }),
      ),
    ).resolves.toBe("INVALID_PAYLOAD");
  });

  it("WebSocket の再同期メッセージは afterSequence を解釈し、不正入力は failure を返す", async () => {
    const { stub } = await createInitializedPool();
    const principal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const ticket = await stub.createTicket(createTicketOptions(principal));

    const upgraded = await stub.fetch(
      new Request(`https://match-pool.test/tickets/${ticket.id}/events`, {
        headers: {
          "x-flarelobby-gateway-token": principal.token,
          upgrade: "websocket",
        },
      }),
    );
    expect(upgraded.status).toBe(101);
    const socket = upgraded.webSocket;
    if (socket === undefined || socket === null) {
      throw new Error("WebSocket ハンドシェイクに失敗しました");
    }
    socket.accept();

    type TicketEventMessage = {
      kind: string;
      payload?: { ticket: { id: string; status: string }; sequence: number };
    };
    const buffered: TicketEventMessage[] = [];
    const waiters: ((message: TicketEventMessage) => void)[] = [];
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(
        String((event as MessageEvent).data),
      ) as TicketEventMessage;
      const resolver = waiters.shift();
      if (resolver !== undefined) {
        resolver(parsed);
      } else {
        buffered.push(parsed);
      }
    });
    const receiveEvent = () =>
      new Promise<TicketEventMessage>((resolve) => {
        const queued = buffered.shift();
        if (queued !== undefined) {
          resolve(queued);
        } else {
          waiters.push(resolve);
        }
      });

    // 接続時のバックログ再生
    expect((await receiveEvent()).payload?.ticket.status).toBe("creating");
    expect((await receiveEvent()).payload?.ticket.status).toBe("waiting");

    // JSON として解釈できないメッセージは failure 応答になる
    socket.send("not-json");
    const failure = await receiveEvent();
    expect(failure.kind).toBe("failure");

    // オブジェクト形式の afterSequence で全件再生
    socket.send(JSON.stringify({ afterSequence: 0 }));
    expect((await receiveEvent()).payload?.ticket.status).toBe("creating");
    expect((await receiveEvent()).payload?.ticket.status).toBe("waiting");

    // 文字列の afterSequence でも続きから再生できる
    socket.send(JSON.stringify({ afterSequence: "1" }));
    expect((await receiveEvent()).payload?.ticket.status).toBe("waiting");

    // バイナリメッセージも解釈する
    socket.send(new TextEncoder().encode(JSON.stringify({ afterSequence: 2 })));

    // 非オブジェクトの JSON 値はそのまま afterSequence として扱われる
    socket.send("0");
    expect((await receiveEvent()).payload?.ticket.status).toBe("creating");
    expect((await receiveEvent()).payload?.ticket.status).toBe("waiting");
    // バイナリの after=2 はイベント 2 件より後のため空再生だった
    expect(buffered).toHaveLength(0);
  });

  it("チケットイベント経路の不正なパーセントエンコーディングは 404 になる", async () => {
    const { stub } = await createInitializedPool();
    const response = await stub.fetch(
      new Request("https://match-pool.test/tickets/%/events"),
    );
    expect(response.status).toBe(404);
  });
});
