import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { MatchmakingPool } from "@flarelobby/core";
import {
  createGatewayPrincipalEnvelope,
  createMatchmakingPoolKey,
  defineFlareLobby,
  ensureRatingSchema,
  getMatchHistory,
  getRating,
  registerMatchResult,
  registerTeamMatchResult,
} from "../src/index.js";
import { FlareLobbyError } from "@flarelobby/core";
import type { GatewayPrincipalEnvelope } from "../src/index.js";

function createPool(label = crypto.randomUUID()): MatchmakingPool {
  return {
    id: `rating-pool-${label}`,
    gameId: `rating-game-${label}`,
    seasonId: "season-1",
    mode: "ranked-1v1",
    region: "jp",
  };
}

function createResultInput(
  matchId: string,
  resultId: string,
  result: 0 | 0.5 | 1 = 1,
) {
  return {
    matchId,
    resultId,
    playerAId: "player-a",
    playerBId: "player-b",
    result,
  } as const;
}

async function readStoredRating(
  pool: MatchmakingPool,
  playerId: string,
): Promise<{ readonly value: number; readonly version: number } | null> {
  return env.FLARE_LOBBY_DB.prepare(
    `SELECT rating_value AS value, version
       FROM flarelobby_ratings
       WHERE player_id = ? AND game_id = ? AND season_id = ?
         AND pool_id = ? AND mode = ? AND region = ?`,
  )
    .bind(playerId, pool.gameId, pool.seasonId, pool.id, pool.mode, pool.region)
    .first<{ value: number; version: number }>();
}

function createGatewayWorker(pool: MatchmakingPool, authorizeResult: boolean) {
  return defineFlareLobby({
    customRooms: {
      maxPlayers: 4,
      defaultSettings: {},
    },
    matchmakingPools: [
      {
        ...pool,
        rating: { initialRating: 1_700, kFactor: 32 },
      },
    ],
    authenticate: (request) => {
      const principalId = request.headers.get("x-test-principal");
      return principalId === null
        ? null
        : { id: principalId, playerId: `${principalId}-player` };
    },
    authorization: {
      authorizeMatchResult: () => authorizeResult,
    },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
  }).createGatewayWorker<Env>();
}

async function createGatewayPrincipal(
  principalId: string,
  playerId: string,
): Promise<GatewayPrincipalEnvelope> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId },
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
        kFactor: 40,
      }),
    ).resolves.toEqual({
      playerId: "player-a",
      poolId: pool.id,
      value: 1_200,
    });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        initialRating: 1_800,
        kFactor: 10,
      }),
    ).resolves.toEqual({
      playerId: "player-a",
      poolId: pool.id,
      value: 1_200,
    });
  });

  it("通常勝利で双方を同じ確定処理へ適用し、重複結果を一度だけ処理する", async () => {
    const pool = createPool();
    const input = createResultInput("match-win", "result-win");

    const first = await registerMatchResult(env.FLARE_LOBBY_DB, pool, input);
    expect(first.applied).toBe(true);
    expect(first.match.result).toBe(1);
    expect(
      first.match.participants.map((participant) => participant.delta),
    ).toEqual([12, -12]);
    expect(
      first.match.participants.map((participant) => participant.versionAfter),
    ).toEqual([1, 1]);

    const duplicate = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      input,
    );
    expect(duplicate.applied).toBe(false);
    expect(duplicate.match.matchId).toBe(input.matchId);
    expect(await readStoredRating(pool, "player-a")).toMatchObject({
      value: 1_512,
      version: 1,
    });
    expect(await readStoredRating(pool, "player-b")).toMatchObject({
      value: 1_488,
      version: 1,
    });

    const count = await env.FLARE_LOBBY_DB.prepare(
      `SELECT COUNT(*) AS count
         FROM flarelobby_rating_matches
         WHERE match_id = ? OR result_id = ?`,
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
      createResultInput("match-draw", "result-draw", 0.5),
    );
    expect(
      draw.match.participants.map((participant) => participant.delta),
    ).toEqual([0, 0]);

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", { initialRating: 1_100 }),
    ).resolves.toMatchObject({ value: 1_500 });
    await expect(
      getRating(env.FLARE_LOBBY_DB, seasonTwo, "player-a", {
        initialRating: 1_600,
      }),
    ).resolves.toMatchObject({ value: 1_600 });
    await expect(
      getRating(env.FLARE_LOBBY_DB, otherPool, "player-a", {
        initialRating: 1_900,
      }),
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
        5,
      ),
      registerMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        createResultInput("match-concurrent-b", "result-concurrent-b"),
        {},
        5,
      ),
    ]);

    expect(registrations.every((registration) => registration.applied)).toBe(
      true,
    );
    expect(await readStoredRating(pool, "player-a")).toMatchObject({
      version: 2,
    });
    expect(await readStoredRating(pool, "player-b")).toMatchObject({
      version: 2,
    });

    const history = await getMatchHistory(env.FLARE_LOBBY_DB, {
      pool,
      limit: 10,
    });
    expect(history.matches).toHaveLength(2);
    expect(
      history.matches.flatMap((match) =>
        match.participants.map((participant) => participant.versionAfter),
      ),
    ).toEqual(expect.arrayContaining([1, 2]));
  });

  it("試合履歴を新しい順にページングする", async () => {
    const pool = createPool();
    for (const suffix of ["one", "two", "three"]) {
      await registerMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        createResultInput(
          `match-history-${suffix}`,
          `result-history-${suffix}`,
        ),
      );
    }

    const firstPage = await getMatchHistory(env.FLARE_LOBBY_DB, {
      pool,
      limit: 2,
    });
    expect(firstPage.matches).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await getMatchHistory(env.FLARE_LOBBY_DB, {
      pool,
      ...(firstPage.nextCursor === null
        ? {}
        : { cursor: firstPage.nextCursor }),
      pageSize: 2,
    });
    expect(secondPage.matches).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set([
        ...firstPage.matches.map((match) => match.matchId),
        ...secondPage.matches.map((match) => match.matchId),
      ]).size,
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
        { headers },
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(ratingResponse.status).toBe(200);
    await expect(ratingResponse.json()).resolves.toEqual({
      rating: {
        playerId: "principal-rating-player",
        poolId: pool.id,
        value: 1_700,
      },
    });

    const resultResponse = await worker.fetch(
      new Request(
        `https://example.test/v1/matchmaking/pools/${encodeURIComponent(pool.id)}/matches/match-unauthorized/result`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            resultId: "result-unauthorized",
            playerAId: "client-controlled-a",
            playerBId: "client-controlled-b",
            result: 1,
          }),
        },
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(resultResponse.status).toBe(403);
    await expect(resultResponse.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("成立済みMatch Poolから参加者を復元して結果を適用する", async () => {
    const pool = createPool();
    const matchPool = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool),
    );
    await matchPool.initialize({ pool });

    const firstPrincipal = await createGatewayPrincipal(
      `match-result-a-${crypto.randomUUID()}`,
      "server-player-a",
    );
    const secondPrincipal = await createGatewayPrincipal(
      `match-result-b-${crypto.randomUUID()}`,
      "server-player-b",
    );
    const firstTicket = await matchPool.createTicket({
      gatewayPrincipal: firstPrincipal,
      requestId: `request-a-${crypto.randomUUID()}`,
      rating: 1_500,
    });
    const secondTicket = await matchPool.createTicket({
      gatewayPrincipal: secondPrincipal,
      requestId: `request-b-${crypto.randomUUID()}`,
      rating: 1_500,
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
            "content-type": "application/json",
          },
          body: JSON.stringify({
            resultId: `result-${crypto.randomUUID()}`,
            playerAId: "client-controlled-player-a",
            playerBId: "client-controlled-player-b",
            result: 1,
          }),
        },
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
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
      new Set(
        payload.match.participants.map((participant) => participant.playerId),
      ),
    ).toEqual(new Set([firstTicket.player.id, secondTicket.player.id]));
  });
});

describe("Glicko-2 レーティング永続化", () => {
  async function readStoredRatingState(
    pool: MatchmakingPool,
    playerId: string,
  ): Promise<{
    readonly value: number;
    readonly version: number;
    readonly deviation: number | null;
    readonly volatility: number | null;
  } | null> {
    return env.FLARE_LOBBY_DB.prepare(
      `SELECT rating_value AS value, version,
              rating_deviation AS deviation, rating_volatility AS volatility
       FROM flarelobby_ratings
       WHERE player_id = ? AND game_id = ? AND season_id = ?
         AND pool_id = ? AND mode = ? AND region = ?`,
    )
      .bind(
        playerId,
        pool.gameId,
        pool.seasonId,
        pool.id,
        pool.mode,
        pool.region,
      )
      .first();
  }

  it("Glicko-2 の結果を一度だけ適用し、RD を保存する", async () => {
    const pool = createPool();
    const configuration = { algorithm: "glicko-2" } as const;
    const input = createResultInput("match-glicko-1", "result-glicko-1");

    const first = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      input,
      configuration,
    );
    expect(first.applied).toBe(true);
    expect(first.match.participants.map((p) => p.delta)).toEqual([162, -162]);
    expect(first.match.participants.map((p) => p.versionAfter)).toEqual([1, 1]);

    // 既知値: 同条件の勝者は 1662.31 / RD 290.32、敗者は 1337.69。
    const winner = await readStoredRatingState(pool, "player-a");
    const loser = await readStoredRatingState(pool, "player-b");
    expect(winner).toMatchObject({
      value: 1_662,
      version: 1,
      volatility: expect.closeTo(0.06, 5),
    });
    expect(winner?.deviation).toBeCloseTo(290.319, 3);
    expect(loser?.value).toBe(1_338);
    expect(loser?.deviation).toBeCloseTo(290.319, 3);

    const duplicate = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      input,
      configuration,
    );
    expect(duplicate.applied).toBe(false);
    expect(await readStoredRatingState(pool, "player-a")).toMatchObject({
      value: 1_662,
      version: 1,
    });

    const matchCount = await env.FLARE_LOBBY_DB.prepare(
      `SELECT COUNT(*) AS count FROM flarelobby_rating_matches
       WHERE match_id = ? OR result_id = ?`,
    )
      .bind(input.matchId, input.resultId)
      .first<{ count: number }>();
    expect(matchCount?.count).toBe(1);
  });

  it("連戦で更新後のレートと RD を入力として使う", async () => {
    const pool = createPool();
    const configuration = { algorithm: "glicko-2" } as const;
    await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      {
        ...createResultInput("match-seq-1", "result-seq-1"),
        playerBId: "player-x",
      },
      configuration,
    );
    const second = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      {
        ...createResultInput("match-seq-2", "result-seq-2"),
        playerBId: "player-y",
      },
      configuration,
    );

    expect(second.applied).toBe(true);
    expect(second.match.participants[0]?.ratingBefore).toBe(1_662);
    expect(second.match.participants.map((p) => p.delta)).toEqual([88, -117]);

    const stored = await readStoredRatingState(pool, "player-a");
    expect(stored).toMatchObject({ value: 1_750, version: 2 });
    expect(stored?.deviation).toBeCloseTo(256.335, 3);
  });

  it("Season の方式と一致しない設定を拒否する", async () => {
    const pool = createPool();
    const glickoConfiguration = { algorithm: "glicko-2" } as const;

    await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      {
        ...createResultInput("match-mix-1", "result-mix-1"),
        playerBId: "player-z",
      },
      glickoConfiguration,
    );

    await expect(
      registerMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...createResultInput("match-mix-2", "result-mix-2"),
        playerBId: "player-z",
      }),
    ).rejects.toThrow(FlareLobbyError);
  });

  it("チーム対応の結果登録でも Glicko-2 を適用し、再送を冪等に扱う", async () => {
    const pool = createPool();
    const configuration = { algorithm: "glicko-2" } as const;
    const input = {
      matchId: "match-team-glicko",
      resultId: "result-team-glicko",
      teamAId: "team-a",
      teamBId: "team-b",
      playerAIds: ["team-player-a1", "team-player-a2"],
      playerBIds: ["team-player-b1", "team-player-b2"],
      result: 1,
    } as const;

    const first = await registerTeamMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      input,
      configuration,
    );
    expect(first.applied).toBe(true);
    expect(first.match.participants).toHaveLength(4);
    expect(first.match.participants.map((p) => p.delta)).toEqual([
      162, 162, -162, -162,
    ]);

    const member = await readStoredRatingState(pool, "team-player-a1");
    expect(member?.value).toBe(1_662);
    expect(member?.deviation).toBeCloseTo(290.319, 3);

    const replayed = await registerTeamMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      input,
      configuration,
    );
    expect(replayed.applied).toBe(false);
  });

  it("Glicko-2 の初期 RD・ボラティリティ設定を更新へ反映する", async () => {
    const pool = createPool();
    const configuration = {
      algorithm: "glicko-2",
      initialRating: 1_500,
      initialRatingDeviation: 120,
      volatility: 0.05,
      tau: 0.4,
    } as const;

    const first = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      createResultInput("match-glicko-cfg-1", "result-glicko-cfg-1"),
      configuration,
    );
    expect(first.applied).toBe(true);
    // 既定 RD (350) のときの既知値 162 よりも低 RD では変動が抑えられる。
    const [winnerDelta, loserDelta] = first.match.participants.map(
      (participant) => participant.delta,
    );
    expect(winnerDelta).toBeGreaterThan(0);
    expect(winnerDelta).toBeLessThan(162);
    expect(loserDelta).toBeLessThan(0);
    expect(loserDelta).toBeGreaterThan(-162);

    const winner = await readStoredRatingState(pool, "player-a");
    expect(winner?.deviation).toBeLessThan(120);
    expect(winner?.volatility).toBeGreaterThan(0.03);
    expect(winner?.volatility).toBeLessThan(0.07);
  });

  it("Glicko-2 では有利な勝ちの変動が小さく、不利な勝ちの変動が大きい", async () => {
    const pool = createPool();
    const configuration = { algorithm: "glicko-2" } as const;

    await getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
      initialRating: 1_800,
      algorithm: "glicko-2",
    });
    await getRating(env.FLARE_LOBBY_DB, pool, "player-b", {
      initialRating: 1_200,
      algorithm: "glicko-2",
    });

    const favored = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      createResultInput("match-glicko-cfg-2", "result-glicko-cfg-2"),
      configuration,
    );
    expect(
      favored.match.participants.map((participant) => participant.delta),
    ).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
    // レート差 600 の有利な勝ちは既知値 162 よりも小さい。
    expect(favored.match.participants[0]?.delta).toBeGreaterThan(0);
    expect(favored.match.participants[0]!.delta).toBeLessThan(162);
    expect(favored.match.participants[1]?.delta).toBeLessThan(0);
  });
});

describe("レーティング入力検証", () => {
  it("同一プレイヤー間の試合結果と不正な結果値を拒否する", async () => {
    const pool = createPool();

    await expect(
      registerMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...createResultInput("match-self", "result-self"),
        playerBId: "player-a",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      registerMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...createResultInput("match-bad-result", "result-bad-result"),
        result: 0.7,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      registerMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        "not-an-object" as unknown as Parameters<typeof registerMatchResult>[2],
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("リトライ回数の指定を検証する", async () => {
    const pool = createPool();

    for (const maxRetries of [-1, 9, 1.5]) {
      await expect(
        registerMatchResult(
          env.FLARE_LOBBY_DB,
          pool,
          createResultInput(
            `match-retry-${maxRetries}`,
            `result-retry-${maxRetries}`,
          ),
          {},
          maxRetries,
        ),
      ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("主体と Pool の識別子を検証する", async () => {
    const pool = createPool();

    await expect(getRating(env.FLARE_LOBBY_DB, pool, "")).rejects.toMatchObject(
      { code: "INVALID_PAYLOAD" },
    );

    await expect(
      getRating(
        env.FLARE_LOBBY_DB,
        { id: "", gameId: "g", seasonId: "s", mode: "m", region: "r" },
        "player-a",
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      getRating(
        env.FLARE_LOBBY_DB,
        "not-a-pool" as unknown as MatchmakingPool,
        "player-a",
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("レーティング設定の不明キー・不正値・不正な型を拒否する", async () => {
    const pool = createPool();

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", null as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        algorithm: "trueskill",
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        unknownKey: 1,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        initialRating: "1500",
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        initialRating: Number.NaN,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      getRating(env.FLARE_LOBBY_DB, pool, "player-a", {
        algorithm: "glicko-2",
        initialRatingDeviation: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("チーム入力の重複・欠落・不正結果・不正型を拒否する", async () => {
    const pool = createPool();
    const base = {
      matchId: "match-team-invalid",
      resultId: "result-team-invalid",
      teamAId: "team-a",
      teamBId: "team-b",
      playerAIds: ["shared-player"],
      playerBIds: ["shared-player"],
      result: 1,
    } as const;

    await expect(
      registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, base),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...base,
        matchId: "match-team-result",
        resultId: "result-team-result",
        playerAIds: ["team-a-1"],
        playerBIds: ["team-b-1"],
        result: 0.25,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...base,
        matchId: "match-team-empty",
        resultId: "result-team-empty",
        playerAIds: [],
        playerBIds: ["team-b-1"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...base,
        matchId: "match-team-dup",
        resultId: "result-team-dup",
        playerAIds: ["team-a-1", "team-a-1"],
        playerBIds: ["team-b-1"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(
      registerTeamMatchResult(
        env.FLARE_LOBBY_DB,
        pool,
        42 as unknown as Parameters<typeof registerTeamMatchResult>[2],
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("試合履歴のページング指定を検証し、履歴が無い Pool を空で返す", async () => {
    const pool = createPool();

    await expect(
      getMatchHistory(env.FLARE_LOBBY_DB, { pool, limit: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      getMatchHistory(env.FLARE_LOBBY_DB, { pool, limit: 101 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      getMatchHistory(env.FLARE_LOBBY_DB, {
        pool,
        cursor: "not-a-cursor",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      getMatchHistory(env.FLARE_LOBBY_DB, {
        pool,
        cursor: encodeURIComponent(JSON.stringify({ appliedAt: "x" })),
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const empty = await getMatchHistory(env.FLARE_LOBBY_DB, { pool });
    expect(empty.matches).toEqual([]);
    expect(empty.nextCursor).toBeNull();
  });
});

describe("レーティング版競合", () => {
  /**
   * 試合行の書き込み batch を外部から解放できる D1 プロキシです。
   * 先に別の試合結果を確定させることで、楽観的版ガードの競合を決定的に再現します。
   */
  function createGatedWriteDatabase(matchInsertSql: string): {
    readonly database: D1Database;
    readonly writeGated: Promise<void>;
    readonly openWrite: () => void;
  } {
    const real = env.FLARE_LOBBY_DB;
    const writeGated = Promise.withResolvers<void>();
    const opened = Promise.withResolvers<void>();
    let pendingWriteBatch = false;
    const database = new Proxy(real, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.includes(matchInsertSql)) {
              pendingWriteBatch = true;
            }
            return (
              Reflect.get(target, "prepare", target) as (
                text: string,
              ) => unknown
            ).call(target, sql);
          };
        }
        if (property === "batch") {
          return async (statements: unknown[]) => {
            if (pendingWriteBatch) {
              pendingWriteBatch = false;
              writeGated.resolve();
              await opened.promise;
            }
            return await (
              Reflect.get(target, "batch", target) as (
                ...args: unknown[]
              ) => Promise<D1Result<unknown>[]>
            ).call(target, statements);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as unknown as D1Database;
    return {
      database,
      writeGated: writeGated.promise,
      openWrite: opened.resolve,
    };
  }

  it("単対戦では版競合の再試行が上限に達したとき競合として拒否する", async () => {
    const pool = createPool();
    const { database, writeGated, openWrite } = createGatedWriteDatabase(
      "INSERT INTO flarelobby_rating_matches",
    );

    const gated = registerMatchResult(
      database,
      pool,
      createResultInput("match-gate-single-a", "result-gate-single-a"),
      {},
      0,
    );
    await writeGated;
    await registerMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      createResultInput("match-gate-single-b", "result-gate-single-b"),
    );
    openWrite();

    await expect(gated).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("チーム対戦では版競合を再試行して失わない", async () => {
    const pool = createPool();
    const { database, writeGated, openWrite } = createGatedWriteDatabase(
      "INSERT INTO flarelobby_team_rating_matches",
    );
    const input = {
      matchId: "match-gate-team-a",
      resultId: "result-gate-team-a",
      teamAId: "gate-team-a",
      teamBId: "gate-team-b",
      playerAIds: ["gate-a1", "gate-a2"],
      playerBIds: ["gate-b1", "gate-b2"],
      result: 1,
    } as const;

    const gated = registerTeamMatchResult(database, pool, input, {}, 5);
    await writeGated;
    await registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
      ...input,
      matchId: "match-gate-team-b",
      resultId: "result-gate-team-b",
    });
    openWrite();

    const registration = await gated;
    expect(registration.applied).toBe(true);
    expect(registration.match.matchId).toBe(input.matchId);
    expect(registration.match.participants.map((p) => p.versionAfter)).toEqual([
      2, 2, 2, 2,
    ]);
  });

  it("チーム対戦では版競合の再試行が上限に達したとき競合として拒否する", async () => {
    const pool = createPool();
    const { database, writeGated, openWrite } = createGatedWriteDatabase(
      "INSERT INTO flarelobby_team_rating_matches",
    );
    const input = {
      matchId: "match-gate-team-c",
      resultId: "result-gate-team-c",
      teamAId: "gate-team-c",
      teamBId: "gate-team-d",
      playerAIds: ["gate-a3", "gate-a4"],
      playerBIds: ["gate-b3", "gate-b4"],
      result: 0.5,
    } as const;

    const gated = registerTeamMatchResult(database, pool, input, {}, 0);
    await writeGated;
    await registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
      ...input,
      matchId: "match-gate-team-d",
      resultId: "result-gate-team-d",
    });
    openWrite();

    await expect(gated).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("同一試合・同一チーム試合への異なる結果の再送を競合として拒否する", async () => {
    const pool = createPool();
    const singleInput = createResultInput(
      "match-replay-diff",
      "result-replay-diff",
    );
    await registerMatchResult(env.FLARE_LOBBY_DB, pool, singleInput);

    await expect(
      registerMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...singleInput,
        result: 0.5,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const teamInput = {
      matchId: "match-replay-team",
      resultId: "result-replay-team",
      teamAId: "team-a",
      teamBId: "team-b",
      playerAIds: ["replay-a1"],
      playerBIds: ["replay-b1"],
      result: 1,
    } as const;
    await registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, teamInput);

    await expect(
      registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...teamInput,
        result: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("Season の方式と一致しないチーム結果の適用を拒否する", async () => {
    const pool = createPool();
    const teamInput = {
      matchId: "match-team-alg-1",
      resultId: "result-team-alg-1",
      teamAId: "team-a",
      teamBId: "team-b",
      playerAIds: ["alg-a1"],
      playerBIds: ["alg-b1"],
      result: 1,
    } as const;
    await registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, teamInput, {
      algorithm: "glicko-2",
    });

    await expect(
      registerTeamMatchResult(env.FLARE_LOBBY_DB, pool, {
        ...teamInput,
        matchId: "match-team-alg-2",
        resultId: "result-team-alg-2",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("レーティング D1 障害経路", () => {
  interface FakePreparedStatement {
    readonly text: string;
    bind(): FakePreparedStatement;
    all(): Promise<{ results: readonly { name: string }[] }>;
    first(): Promise<null>;
    run(): Promise<{ meta: { changes: number } }>;
  }

  class FakeSchemaDatabase {
    readonly executedStatements: string[] = [];
    readonly columns = new Set<string>();
    #failBatchWith: Error | null = null;

    failNextBatchWith(error: Error): void {
      this.#failBatchWith = error;
    }

    prepare(text: string): FakePreparedStatement {
      const statement: FakePreparedStatement = {
        text,
        bind: () => statement,
        all: async () => {
          if (/^PRAGMA table_info/iu.test(text)) {
            return {
              results: [...this.columns].map((name) => ({ name })),
            };
          }
          return { results: [] };
        },
        first: async () => null,
        run: async () => ({ meta: { changes: 0 } }),
      };
      return statement;
    }

    async batch(statements: readonly { text: string }[]): Promise<unknown[]> {
      if (this.#failBatchWith !== null) {
        const error = this.#failBatchWith;
        this.#failBatchWith = null;
        throw error;
      }
      for (const statement of statements) {
        this.executedStatements.push(statement.text);
        const addedColumn = /^ALTER TABLE\s+\S+\s+ADD COLUMN\s+(\S+)/iu.exec(
          statement.text,
        );
        if (addedColumn !== null && addedColumn[1] !== undefined) {
          this.columns.add(addedColumn[1].replace(/[^a-z_]/giu, ""));
        }
      }
      return statements.map(() => ({ meta: { changes: 0 } }));
    }
  }

  it("初期化が失敗した D1 では CONNECTION_FAILED を返し、再呼び出しで再試行する", async () => {
    const database = new FakeSchemaDatabase();
    const failure = new Error("d1 unavailable");

    database.failNextBatchWith(failure);
    await expect(
      ensureRatingSchema(database as unknown as D1Database),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    // 失敗した初期化はキャッシュから破棄され、次回呼び出しで再試行されます。
    await expect(
      ensureRatingSchema(database as unknown as D1Database),
    ).resolves.toBeUndefined();
    expect(database.executedStatements.length).toBeGreaterThan(0);
  });

  it("列が欠落した旧スキーマへ不足列を追加する", async () => {
    const database = new FakeSchemaDatabase();

    await expect(
      ensureRatingSchema(database as unknown as D1Database),
    ).resolves.toBeUndefined();
    const alters = database.executedStatements.filter((text) =>
      /^ALTER TABLE/iu.test(text),
    );
    expect(alters.join("\n")).toContain("ADD COLUMN algorithm");
    expect(alters.join("\n")).toContain("ADD COLUMN rating_deviation");
    expect(alters.join("\n")).toContain("ADD COLUMN rating_volatility");
  });

  it("同時実行の duplicate column 競合を無視して続行する", async () => {
    const database = new FakeSchemaDatabase();

    await expect(
      ensureRatingSchema(database as unknown as D1Database),
    ).resolves.toBeUndefined();

    const raced = new FakeSchemaDatabase();
    // 列は追加済みだが ALTER が duplicate column エラーで負けた状況を再現します。
    raced.batch = async function batch(
      statements: readonly { text: string }[],
    ): Promise<unknown[]> {
      const isAlterBatch = statements.some((statement) =>
        /^ALTER TABLE/iu.test(statement.text),
      );
      for (const statement of statements) {
        const addedColumn = /^ALTER TABLE\s+\S+\s+ADD COLUMN\s+(\S+)/iu.exec(
          statement.text,
        );
        if (addedColumn !== null && addedColumn[1] !== undefined) {
          raced.columns.add(addedColumn[1].replace(/[^a-z_]/giu, ""));
        }
      }
      if (isAlterBatch) {
        throw new Error("duplicate column name: rating_deviation");
      }
      return statements.map(() => ({ meta: { changes: 0 } }));
    };
    await expect(
      ensureRatingSchema(raced as unknown as D1Database),
    ).resolves.toBeUndefined();
  });

  it("列の追加後も存在確認が取れない場合は CONNECTION_FAILED", async () => {
    const database = new FakeSchemaDatabase();
    // 列を追加しても PRAGMA の結果を空のままにします。
    database.batch = async function batch(statements) {
      database.executedStatements.push(
        ...statements.map((statement) => statement.text),
      );
      return statements.map(() => ({ meta: { changes: 0 } }));
    };

    await expect(
      ensureRatingSchema(database as unknown as D1Database),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  function withFirstOverride(
    override: (sql: string) => Promise<unknown>,
  ): D1Database {
    const real = env.FLARE_LOBBY_DB;
    const wrapStatement = (statement: unknown, sql: string): unknown =>
      new Proxy(statement as object, {
        get(target, property) {
          if (property === "first") {
            return () => override(sql);
          }
          const value = Reflect.get(target as object, property, target);
          if (property === "bind" && typeof value === "function") {
            return (...args: unknown[]) =>
              wrapStatement(
                (value as (...bindArgs: unknown[]) => unknown).apply(
                  target,
                  args,
                ),
                sql,
              );
          }
          return typeof value === "function"
            ? (value as (...callArgs: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    return new Proxy(real, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) =>
            wrapStatement(
              (
                Reflect.get(target, property, target) as (
                  text: string,
                ) => unknown
              ).call(target, sql),
              sql,
            );
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (value as (...callArgs: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as unknown as D1Database;
  }

  it("初回参照でレーティング行が読み取れない場合は CONNECTION_FAILED", async () => {
    const pool = createPool();
    const database = withFirstOverride(() => Promise.resolve(null));

    await expect(
      getRating(database, pool, `vanish-${crypto.randomUUID()}`),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("D1 の読み取り障害は CONNECTION_FAILED へ正規化する", async () => {
    const pool = createPool();
    const database = withFirstOverride(() =>
      Promise.reject(new Error("storage read failed")),
    );

    await expect(
      getRating(database, pool, `broken-${crypto.randomUUID()}`),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });
});
