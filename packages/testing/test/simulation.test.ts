import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIMULATION_POOL,
  SeededRandom,
  VirtualClock,
  compareSearchPolicies,
  generateSimulationPlayers,
  replaySimulation,
  serializeSimulationResult,
  simulateMatchmaking,
  summarizeSimulation,
} from "../src/index.js";
import type {
  MatchmakingSimulationConfig,
  SimulationPlayer,
} from "../src/index.js";
import {
  elo,
  evaluateMatchCandidate,
  getMatchmakingSearchWidth,
} from "@flarelobby/core";
import type {
  MatchmakingPool,
  MatchmakingSearchTicket,
} from "@flarelobby/core";

const NOW = Date.parse("2026-08-11T00:00:00.000Z");
const pool: MatchmakingPool = DEFAULT_SIMULATION_POOL;

function player(
  id: string,
  rating: number,
  joinedAtMs = NOW,
  overrides: Partial<Pick<SimulationPlayer, "region" | "inputMethod">> = {},
): SimulationPlayer {
  return {
    id,
    player: { id },
    rating,
    joinedAt: new Date(joinedAtMs).toISOString(),
    region: overrides.region ?? pool.region,
    inputMethod: overrides.inputMethod ?? "keyboard_mouse",
  };
}

function searchTicket(
  id: string,
  rating: number,
  queuedAtMs = NOW,
): MatchmakingSearchTicket {
  return {
    id,
    pool,
    player: { id: `player-${id}` },
    rating: {
      playerId: `player-${id}`,
      poolId: pool.id,
      value: rating,
    },
    queuedAt: new Date(queuedAtMs).toISOString(),
    region: pool.region,
    inputMethod: "keyboard_mouse",
  };
}

describe("@flarelobby/testing の決定論的テスト補助", () => {
  it("仮想時計は単調に進み、実時間へ依存しない", () => {
    const clock = new VirtualClock(NOW);

    expect(clock.now()).toBe(NOW);
    expect(clock.nowTimestamp()).toBe(new Date(NOW).toISOString());
    expect(clock.advanceBy(1_250)).toBe(NOW + 1_250);
    expect(clock.advanceTo(new Date(NOW + 2_000).toISOString())).toBe(
      NOW + 2_000,
    );
    expect(() => clock.advanceTo(NOW + 1_999)).toThrow("過去へ戻す");
  });

  it("固定乱数と分布生成が同じ種で同じプレイヤー列を返す", () => {
    const options = {
      count: 8,
      rating: { kind: "uniform", min: 1_400, max: 1_700 } as const,
      joinedAt: {
        kind: "uniform",
        from: NOW,
        to: NOW + 5_000,
      } as const,
      idPrefix: "bot-",
    };

    const first = generateSimulationPlayers(options, new SeededRandom(42));
    const second = generateSimulationPlayers(options, new SeededRandom(42));
    const different = generateSimulationPlayers(options, new SeededRandom(43));

    expect(second).toEqual(first);
    expect(different).not.toEqual(first);
    expect(first.every((item) => item.id.startsWith("bot-"))).toBe(true);
    expect(
      first.every((item) => item.rating >= 1_400 && item.rating <= 1_700),
    ).toBe(true);
  });

  it("検索幅の境界と ELO の性質を横断して確認できる", () => {
    expect(getMatchmakingSearchWidth(undefined, 19_999)).toBe(75);
    expect(getMatchmakingSearchWidth(undefined, 20_000)).toBe(150);
    expect(getMatchmakingSearchWidth(undefined, 60_000)).toBe(400);

    const atBoundary = evaluateMatchCandidate(
      searchTicket("a", 1_500),
      searchTicket("b", 1_575),
      { now: NOW },
    );
    const outsideBoundary = evaluateMatchCandidate(
      searchTicket("a", 1_500),
      searchTicket("b", 1_576),
      { now: NOW },
    );

    expect(atBoundary).not.toBeNull();
    expect(outsideBoundary).toBeNull();

    const calculation = elo().calculate({
      ratingA: 1_500,
      ratingB: 1_500,
      result: 1,
    });
    expect(calculation.deltaA).toBe(12);
    expect(calculation.deltaB).toBe(-12);
    expect(calculation.deltaA + calculation.deltaB).toBe(0);
  });

  it("待機時間に応じた検索幅拡大、成立、未成立チケットを再現する", () => {
    const clock = new VirtualClock(NOW);
    const result = simulateMatchmaking(
      {
        seed: "fixed-small-scenario",
        players: [player("a", 1_000), player("b", 1_060), player("c", 1_500)],
        startAt: NOW,
        durationMs: 2_000,
        tickMs: 1_000,
        searchPolicy: {
          stages: [
            { afterMs: 0, maxRatingDifference: 50 },
            { afterMs: 1_000, maxRatingDifference: 100 },
          ],
          maxRatingDifference: 100,
        },
      },
      { clock },
    );

    expect(clock.now()).toBe(NOW + 2_000);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.quality).toMatchObject({
      ratingDifference: 60,
      waitingTimeMs: [1_000, 1_000],
      searchWidth: [100, 100],
    });
    expect(result.statistics).toMatchObject({
      generatedPlayerCount: 3,
      joinedTicketCount: 3,
      matchedTicketCount: 2,
      unmatchedTicketCount: 1,
      unmatchedRate: 0.333333,
    });
    expect(result.unmatchedTickets).toHaveLength(1);
    expect(result.unmatchedTickets[0]?.playerId).toBe("c");
    expect(
      result.tickets.find((ticket) => ticket.playerId === "a")?.status,
    ).toBe("matched");
    expect(
      result.tickets.find((ticket) => ticket.playerId === "c")?.status,
    ).toBe("waiting");
  });

  it("同じ設定と乱数種の結果を JSON とリプレイでも完全一致させる", () => {
    const config: MatchmakingSimulationConfig = {
      seed: "replay-seed",
      playerGeneration: {
        count: 24,
        rating: {
          kind: "normal",
          mean: 1_500,
          standardDeviation: 120,
          min: 900,
          max: 2_100,
        },
        joinedAt: {
          kind: "uniform",
          from: NOW,
          to: NOW + 10_000,
        },
      },
      startAt: NOW,
      durationMs: 20_000,
      tickMs: 1_000,
      cancellation: {
        probability: 0.15,
        afterMs: { kind: "uniform", min: 2_000, max: 8_000 },
      },
    };

    const first = simulateMatchmaking(config);
    const second = simulateMatchmaking(config);
    const replay = replaySimulation(first.replay);

    expect(second).toEqual(first);
    expect(replay).toEqual(first);
    expect(serializeSimulationResult(second)).toBe(
      serializeSimulationResult(first),
    );

    const summary = summarizeSimulation(first);
    expect(summary).toContain("待機時間(ms)");
    expect(summary).toContain("成立時レート差");
    expect(summary).toContain("未成立");
  });

  it("検索幅の異なる設定を同じ入力で比較できる", () => {
    const comparison = compareSearchPolicies(
      {
        seed: "width-comparison",
        players: [
          player("a", 1_000),
          player("b", 1_080),
          player("c", 1_160),
          player("d", 1_240),
        ],
        startAt: NOW,
        durationMs: 1_000,
        tickMs: 1_000,
      },
      {
        name: "狭い検索幅",
        policy: {
          stages: [{ afterMs: 0, maxRatingDifference: 50 }],
          maxRatingDifference: 50,
        },
      },
      {
        name: "広い検索幅",
        policy: {
          stages: [{ afterMs: 0, maxRatingDifference: 100 }],
          maxRatingDifference: 100,
        },
      },
    );

    expect(comparison.first.result.statistics.matchCount).toBe(0);
    expect(comparison.second.result.statistics.matchCount).toBe(2);
    expect(comparison.delta.matchedTicketCount).toBe(4);
    expect(comparison.delta.unmatchedRate).toBe(-1);
  });

  it("0人、1人、奇数人数、大きなレート差、キャンセル、期限切れを識別する", () => {
    const empty = simulateMatchmaking({ seed: 1, startAt: NOW, durationMs: 0 });
    expect(empty.statistics.generatedPlayerCount).toBe(0);
    expect(empty.statistics.unmatchedRate).toBe(0);

    const single = simulateMatchmaking({
      seed: 2,
      players: [player("single", 1_500)],
      startAt: NOW,
      durationMs: 1_000,
    });
    expect(single.tickets[0]?.status).toBe("waiting");

    const odd = simulateMatchmaking({
      seed: 3,
      players: [player("a", 1_000), player("b", 1_000), player("c", 1_000)],
      startAt: NOW,
      durationMs: 1_000,
    });
    expect(odd.statistics.matchCount).toBe(1);
    expect(odd.statistics.waitingTicketCount).toBe(1);

    const farApart = simulateMatchmaking({
      seed: 4,
      players: [player("low", 500), player("high", 2_500)],
      startAt: NOW,
      durationMs: 1_000,
    });
    expect(farApart.statistics.matchCount).toBe(0);
    expect(farApart.statistics.unmatchedTicketCount).toBe(2);

    const cancelled = simulateMatchmaking({
      seed: 5,
      players: [player("cancel-a", 1_500), player("cancel-b", 1_500)],
      startAt: NOW,
      durationMs: 1_000,
      cancellation: { probability: 1, afterMs: 0 },
    });
    expect(cancelled.statistics.cancelledTicketCount).toBe(2);
    expect(cancelled.statistics.matchCount).toBe(0);

    const expired = simulateMatchmaking({
      seed: 6,
      players: [player("expire", 1_500)],
      startAt: NOW,
      durationMs: 1_000,
      ticketTtlMs: 0,
    });
    expect(expired.tickets[0]?.status).toBe("expired");
    expect(expired.statistics.expiredTicketCount).toBe(1);
  });
});
