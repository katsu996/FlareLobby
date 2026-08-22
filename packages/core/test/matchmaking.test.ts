import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES,
  evaluateMatchCandidate,
  findBestMatchCandidate,
  getMatchmakingSearchWidth,
  getNextMatchmakingSearchAt,
  selectMatchCandidates,
} from "../src/index.js";
import type {
  MatchmakingPool,
  MatchmakingSearchPolicy,
  MatchmakingSearchTicket,
} from "../src/index.js";

const NOW = Date.parse("2026-08-11T00:00:00.000Z");

const pool: MatchmakingPool = {
  id: "ranked-1v1-jp",
  gameId: "game",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp",
};

function ticket(
  id: string,
  rating: number,
  queuedAtMs = NOW,
  overrides: Partial<
    Pick<MatchmakingSearchTicket, "region" | "inputMethod">
  > = {},
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
    region: overrides.region ?? pool.region,
    inputMethod: overrides.inputMethod ?? "keyboard_mouse",
  };
}

describe("1 対 1 マッチング候補探索", () => {
  it("検索幅の境界を 75、150、400 として扱う", () => {
    expect(getMatchmakingSearchWidth(undefined, 0)).toBe(75);
    expect(getMatchmakingSearchWidth(undefined, 19_999)).toBe(75);
    expect(getMatchmakingSearchWidth(undefined, 20_000)).toBe(150);
    expect(getMatchmakingSearchWidth(undefined, 59_999)).toBe(150);
    expect(getMatchmakingSearchWidth(undefined, 60_000)).toBe(400);

    const atStart = evaluateMatchCandidate(
      ticket("a", 1_500),
      ticket("b", 1_575),
      {
        now: NOW,
      },
    );
    const outsideStart = evaluateMatchCandidate(
      ticket("a", 1_500),
      ticket("b", 1_576),
      { now: NOW },
    );
    const atTwentySeconds = evaluateMatchCandidate(
      ticket("a", 1_500),
      ticket("b", 1_600),
      { now: NOW + 20_000 },
    );
    const outsideTwentySeconds = evaluateMatchCandidate(
      ticket("a", 1_500),
      ticket("b", 1_651),
      { now: NOW + 20_000 },
    );
    const atSixtySeconds = evaluateMatchCandidate(
      ticket("a", 1_500),
      ticket("b", 1_900),
      { now: NOW + 60_000 },
    );

    expect(atStart).not.toBeNull();
    expect(outsideStart).toBeNull();
    expect(atTwentySeconds).not.toBeNull();
    expect(outsideTwentySeconds).toBeNull();
    expect(atSixtySeconds).not.toBeNull();
  });

  it("次の検索幅切替時刻を返し、最終段階後は Alarm を要求しない", () => {
    expect(getNextMatchmakingSearchAt(undefined, NOW, NOW)).toBe(NOW + 20_000);
    expect(getNextMatchmakingSearchAt(undefined, NOW, NOW + 20_000)).toBe(
      NOW + 60_000,
    );
    expect(getNextMatchmakingSearchAt(undefined, NOW, NOW + 60_000)).toBeNull();
  });

  it("レート差、待機時間、リージョン、入力方式を品質説明へ含める", () => {
    const evaluation = evaluateMatchCandidate(
      ticket("b", 1_560, NOW - 10_000, { inputMethod: "controller" }),
      ticket("a", 1_500, NOW - 30_000),
      { now: NOW },
    );

    expect(evaluation?.candidate.ticketIds).toEqual(["a", "b"]);
    expect(evaluation?.quality).toMatchObject({
      ratingDifference: 60,
      waitingTimeMs: [30_000, 10_000],
      oldestWaitingTimeMs: 30_000,
      newestWaitingTimeMs: 10_000,
      searchWidth: [150, 75],
      regionMatch: true,
      inputMethodMatch: false,
      score: 60,
    });
  });

  it("成立不可条件を品質評価と分離し、リージョン違いと同一プレイヤーを拒否する", () => {
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500),
        ticket("b", 1_500, NOW, { region: "us" }),
        { now: NOW },
      ),
    ).toBeNull();

    const duplicatePlayer = ticket("b", 1_500);
    const samePlayerCandidate = evaluateMatchCandidate(
      ticket("a", 1_500),
      {
        ...duplicatePlayer,
        player: { id: "player-a" },
        rating: { ...duplicatePlayer.rating, playerId: "player-a" },
      },
      { now: NOW },
    );
    expect(samePlayerCandidate).toBeNull();
  });

  it("同品質では早く待機した候補、同時刻ではチケット ID を優先する", () => {
    const candidates = [
      ticket("a", 1_500, NOW - 10_000),
      ticket("b", 1_510, NOW - 10_000),
      ticket("c", 1_600, NOW - 20_000),
      ticket("d", 1_610, NOW - 20_000),
    ];

    const selected = findBestMatchCandidate(candidates, { now: NOW });
    expect(selected?.candidate.ticketIds).toEqual(["c", "d"]);

    const sameTime = selectMatchCandidates(
      [
        ticket("z", 1_600),
        ticket("b", 1_510),
        ticket("a", 1_500),
        ticket("y", 1_610),
      ],
      { now: NOW },
    );
    expect(sameTime[0]?.candidate.ticketIds).toEqual(["a", "b"]);
  });

  it("同じ入力と時刻から同じ候補を返し、選択済みチケットを重複させない", () => {
    const tickets = Array.from({ length: 20 }, (_, index) =>
      ticket(`ticket-${String(index).padStart(2, "0")}`, 1_500 + (index % 4)),
    );
    const options = { now: NOW } as const;

    const first = selectMatchCandidates(tickets, options);
    const second = selectMatchCandidates([...tickets].reverse(), options);
    const selectedTicketIds = second.flatMap(
      (item) => item.candidate.ticketIds,
    );

    expect(second).toEqual(first);
    expect(new Set(selectedTicketIds).size).toBe(selectedTicketIds.length);
  });

  it("プール設定で検索幅と探索上限を変更できる", () => {
    const policy: MatchmakingSearchPolicy = {
      stages: [
        { afterMs: 0, maxRatingDifference: 10 },
        { afterMs: 1_000, maxRatingDifference: 20 },
      ],
      maxRatingDifference: 20,
      maxTicketsPerSearch: 4,
      maxCandidatesPerSearch: 8,
      maxMatchesPerSearch: 1,
    };

    expect(getMatchmakingSearchWidth(policy, 999)).toBe(10);
    expect(getMatchmakingSearchWidth(policy, 1_000)).toBe(20);
    expect(
      DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES[2]?.maxRatingDifference,
    ).toBe(400);
    expect(
      findBestMatchCandidate([ticket("a", 1_500), ticket("b", 1_515)], {
        now: NOW,
        policy,
      }),
    ).toBeNull();
    expect(
      findBestMatchCandidate(
        [ticket("a", 1_500, NOW - 1_000), ticket("b", 1_515, NOW - 1_000)],
        { now: NOW, policy },
      ),
    ).not.toBeNull();
  });
});
