import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { MatchmakingPool } from "@flarelobby/core";
import {
  createGatewayPrincipalEnvelope,
  createMatchmakingPoolKey,
  defineFlareLobby,
  getMatchHistory,
  getRating,
  registerMatchResult
} from "../src/index.js";
import type { GatewayPrincipalEnvelope } from "../src/index.js";

function createPool(label = crypto.randomUUID()): MatchmakingPool {
  return {
    id: `rating-pool-${label}`,
    gameId: `rating-game-${label}`,
    seasonId: "season-1",
    mode: "ranked-1v1",
    region: "jp"
  };
}

function createResultInput(
  matchId: string,
  resultId: string,
  result: 0 | 0.5 | 1 = 1
) {
  return {
    matchId,
    resultId,
    playerAId: "player-a",
    playerBId: "player-b",
    result
  } as const;
}

async function readStoredRating(
  pool: MatchmakingPool,
  playerId: string
): Promise<{ readonly value: number; readonly version: number } | null> {
  return env.FLARE_LOBBY_DB
    .prepare(
      `SELECT rating_value AS value, version
       FROM flarelobby_ratings
       WHERE player_id = ? AND game_id = ? AND season_id = ?
         AND pool_id = ? AND mode = ? AND region = ?`
    )
    .bind(
      playerId,
      pool.gameId,
      pool.seasonId,
      pool.id,
      pool.mode,
      pool.region
    )
    .first<{ value: number; version: number }>();
}

function createGatewayWorker(
  pool: MatchmakingPool,
  authorizeResult: boolean
) {
  return defineFlareLobby({
    customRooms: {
      maxPlayers: 4,
      defaultSettings: {}
    },
    matchmakingPools: [
      {
        ...pool,
        rating: { initialRating: 1_700, kFactor: 32 }
      }
    ],
    authenticate: (request) => {
      const principalId = request.headers.get("x-test-principal");
      return principalId === null
        ? null
        : { id: principalId, playerId: `${principalId}-player` };
    },
    authorization: {
      authorizeMatchResult: () => authorizeResult
    },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10
    }
  }).createGatewayWorker<Env>();
}

async function createGatewayPrincipal(
  principalId: string,
  playerId: string
): Promise<GatewayPrincipalEnvelope> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId }
  );
  if (!result.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }
  return result.value;
}

describe("D1 レーティング永続化", () => {
  it("初回参照時に設定済み初期値を保存し、既存値を保持する", async () => {
    const pool = createPool();

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        initialRating: 1_200,
        kFactor: 40
      })
    ).resolves.toEqual({
      playerId: "player-a",
      poolId: pool.id,
      value: 1_200
    });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        initialRating: 1_800,
        kFactor: 10
      })
    ).resolves.toEqual({
      playerId: "player-a",
      poolId: pool.id,
      value: 1_200
    });
  });

  it("通常勝利で双方を同じ確定処理へ適用し、重複結果を一度だけ処理する", async () => {
    const pool = createPool();
    const input = createResultInput("match-win", "result-win");

    const first = await registerMatchResult(env.FLARE_LOBBY_DB, pool, input);
    expect(first.applied).toBe(true);
    expect(first.match.result).toBe(1);
    expect(first.match.participants.map((participant) => participant.delta)).toEqual([
      12,
      -12
    ]);
    expect(first.match.participants.map((participant) => participant.versionAfter)).toEqual([
      1,
      1
    ]);

    const duplicate = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      input
    );
    expect(duplicate.applied).toBe(false);
    expect(duplicate.match.matchId).toBe(input.matchId);
    expect(await readStoredRating(pool, "player-a")).toMatchObject({
      value: 1_512,
      version: 1
    });
    expect(await readStoredRating(pool, "player-b")).toMatchObject({
      value: 1_488,
      version: 1
    });

    const count = await env.FLARE_LOBBY_DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM flarelobby_rating_matches
         WHERE match_id = ? OR result_id = ?`
      )
      .bind(input.matchId, input.resultId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("引き分けを処理し、Pool と Season ごとに初期値を分離する", async () => {
    const label = crypto.randomUUID();
    const pool = createPool(label);
    const seasonTwo = { ...pool, seasonId: "season-2" };
    const otherPool = { ...pool, id: `${pool.id}-other` };

    const draw = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      createResultInput("match-draw", "result-draw", 0.5)
    );
    expect(draw.match.participants.map((participant) => participant.delta)).toEqual([
      0,
      0
    ]);

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", { initialRating: 1_100 })
    ).resolves.toMatchObject({ value: 1_500 });
    await expect(
      getRating(env.FLARE_LOBBY_DB, seasonTwo, "player-a", {
        initialRating: 1_600
      })
    ).resolves.toMatchObject({ value: 1_600 });
    await expect(
      getRating(env.FLARE_LOBBY_DB, otherPool, "player-a", {
        initialRating: 1_900
      })
    ).resolves.toMatchObject({ value: 1_900 });
  });

  it("同じ2人への同時結果を版付き更新で失わない", async () => {
    const pool = createPool();
    const registrations = await Promise.all([
      registerMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        createResultInput("match-concurrent-a", "result-concurrent-a"),
        {},
        5
      ),
      registerMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        createResultInput("match-concurrent-b", "result-concurrent-b"),
        {},
        5
      )
    ]);

    expect(registrations.every((registration) => registration.applied)).toBe(true);
    expect(await readStoredRating(pool, "player-a")).toMatchObject({
      version: 2
    });
    expect(await readStoredRating(pool, "player-b")).toMatchObject({
      version: 2
    });

    const history = await getMatchHistory(env.FLARE_LOBBY_DB, {
      pool,
      limit: 10
    });
    expect(history.matches).toHaveLength(2);
    expect(
      history.matches.flatMap((match) =>
        match.participants.map((participant) => participant.versionAfter)
      )
    ).toEqual(expect.arrayContaining([1, 2]));
  });

  it("試合履歴を新しい順にページングする", async () => {
    const pool = createPool();
    for (const suffix of ["one", "two", "three"]) {
      await registerMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        createResultInput(`match-history-${suffix}`, `result-history-${suffix}`)
      );
    }

    const firstPage = await getMatchHistory(env.FLARE_LOBBY_DB, {
      pool,
      limit: 2
    });
    expect(firstPage.matches).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await getMatchHistory(env.FLARE_LOBBY_DB, {
      pool,
      ...(firstPage.nextCursor === null
        ? {}
        : { cursor: firstPage.nextCursor }),
      pageSize: 2
    });
    expect(secondPage.matches).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set([
        ...firstPage.matches.map((match) => match.matchId),
        ...secondPage.matches.map((match) => match.matchId)
      ]).size
    ).toBe(3);
  });
});

describe("レーティング Gateway", () => {
  it("認証主体の現在値を返し、認可されない試合結果を拒否する", async () => {
    const pool = createPool();
    const worker = createGatewayWorker(pool, false);
    const headers = { "x-test-principal": "principal-rating" };

    const ratingResponse = await worker.fetch(
      new Request(
        `https://example.test/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/rating`,
        { headers }
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext
    );
    expect(ratingResponse.status).toBe(200);
    await expect(ratingResponse.json()).resolves.toEqual({
      rating: {
        playerId: "principal-rating-player",
        poolId: pool.id,
        value: 1_700
      }
    });

    const resultResponse = await worker.fetch(
      new Request(
        `https://example.test/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/matches/match-unauthorized/result`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            resultId: "result-unauthorized",
            playerAId: "client-controlled-a",
            playerBId: "client-controlled-b",
            result: 1
          })
        }
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext
    );
    expect(resultResponse.status).toBe(403);
    await expect(resultResponse.json()).resolves.toMatchObject({
      code: "FORBIDDEN"
    });
  });

  it("成立済みMatch Poolから参加者を復元して結果を適用する", async () => {
    const pool = createPool();
    const matchPool = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool)
    );
    await matchPool.initialize({ pool });

    const firstPrincipal = await createGatewayPrincipal(
      `match-result-a-${crypto.randomUUID()}`,
      "server-player-a"
    );
    const secondPrincipal = await createGatewayPrincipal(
      `match-result-b-${crypto.randomUUID()}`,
      "server-player-b"
    );
    const firstTicket = await matchPool.createTicket({
      gatewayPrincipal: firstPrincipal,
      requestId: `request-a-${crypto.randomUUID()}`,
      rating: 1_500
    });
    const secondTicket = await matchPool.createTicket({
      gatewayPrincipal: secondPrincipal,
      requestId: `request-b-${crypto.randomUUID()}`,
      rating: 1_500
    });
    expect(secondTicket.status).toBe("matched");
    if (secondTicket.status !== "matched") {
      throw new Error("成立済みチケットを期待しました。");
    }

    const worker = createGatewayWorker(pool, true);
    const response = await worker.fetch(
      new Request(
        `https://example.test/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/matches/${encodeURIComponent(secondTicket.result.matchId)}/result`,
        {
          method: "POST",
          headers: {
            "x-test-principal": "result-authority",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            resultId: `result-${crypto.randomUUID()}`,
            playerAId: "client-controlled-player-a",
            playerBId: "client-controlled-player-b",
            result: 1
          })
        }
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    const payload = await response.json<{
      readonly match: {
        readonly matchId: string;
        readonly participants: readonly { readonly playerId: string }[];
      };
      readonly applied: boolean;
    }>();
    expect(payload.applied).toBe(true);
    expect(payload.match.matchId).toBe(secondTicket.result.matchId);
    expect(
      new Set(payload.match.participants.map((participant) => participant.playerId))
    ).toEqual(new Set([firstTicket.player.id, secondTicket.player.id]));
  });
});
