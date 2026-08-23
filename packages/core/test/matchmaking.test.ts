import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES,
  compareMatchCandidateQuality,
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

function partyTicket(
  id: string,
  ratings: readonly number[],
  queuedAtMs = NOW,
  overrides: Partial<
    Pick<MatchmakingSearchTicket, "region" | "inputMethod" | "pool">
  > = {},
): MatchmakingSearchTicket {
  return {
    id,
    pool: overrides.pool ?? pool,
    player: { id: `player-${id}` },
    rating: {
      playerId: `player-${id}`,
      poolId: (overrides.pool ?? pool).id,
      value: ratings[0]!,
    },
    players: ratings.map((ratingValue, index) => ({
      id: index === 0 ? `player-${id}` : `player-${id}-${index}`,
      ratingValue,
    })),
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

describe("パーティーチケットの候補探索", () => {
  const duoPool: MatchmakingPool = { ...pool, teamSize: 2, maxPartySize: 2 };

  it("パーティー平均レートで成立可否を判定する", () => {
    const first = partyTicket("a", [1500, 1600], NOW, { pool: duoPool });
    const second = partyTicket("b", [1540, 1560], NOW, { pool: duoPool });
    const evaluation = evaluateMatchCandidate(first, second, { now: NOW });

    expect(evaluation).not.toBeNull();
    expect(evaluation?.quality.ratingDifference).toBe(0);
    // 構成員レートが大きく離れても、平均差が検索幅内なら成立する。
    const spreadFirst = partyTicket("c", [1470, 1580], NOW, {
      pool: duoPool,
    });

    expect(
      evaluateMatchCandidate(spreadFirst, second, { now: NOW }),
    ).not.toBeNull();
    // 平均差が検索幅を超える組は成立しない。
    const highAverage = partyTicket("d", [1620, 1640], NOW, { pool: duoPool });

    expect(evaluateMatchCandidate(first, highAverage, { now: NOW })).toBeNull();
  });

  it("構成人員が異なるチケット同士と teamSize 外のチケットを拒否する", () => {
    const duo = partyTicket("a", [1500, 1550]);
    const otherDuo = partyTicket("b", [1500, 1550]);
    const trioPool: MatchmakingPool = { ...pool, teamSize: 3 };
    const trio = partyTicket("c", [1500, 1525, 1550], NOW, {
      pool: trioPool,
    });

    // 既定 Pool の teamSize は 1 なので、2 人チケット同士も成立しない。
    expect(evaluateMatchCandidate(duo, otherDuo, { now: NOW })).toBeNull();
    expect(evaluateMatchCandidate(duo, trio, { now: NOW })).toBeNull();
    expect(
      evaluateMatchCandidate(trio, partyTicket("d", [1500, 1525, 1550]), {
        now: NOW,
      }),
    ).toBeNull();
  });

  it("同一構成員を含むパーティー同士を拒否する", () => {
    const first = partyTicket("a", [1500, 1600], NOW, { pool: duoPool });
    const overlapping: MatchmakingSearchTicket = {
      ...partyTicket("b", [1500, 1550], NOW, { pool: duoPool }),
      players: [
        { id: "player-b", ratingValue: 1500 },
        { id: "player-a-1", ratingValue: 1550 },
      ],
    };

    expect(evaluateMatchCandidate(first, overlapping, { now: NOW })).toBeNull();
    // 構成員が重複しなければ、リーダー ID が違うだけで成立判定に影響しない。
    const disjoint = partyTicket("b", [1500, 1550], NOW, { pool: duoPool });

    expect(
      evaluateMatchCandidate(first, disjoint, { now: NOW }),
    ).not.toBeNull();
  });

  it("品質比較で最大構成員偏差が小さい候補を優先する", () => {
    const evenFirst = partyTicket("a", [1500, 1500], NOW - 10_000, {
      pool: duoPool,
    });
    const evenSecond = partyTicket("b", [1510, 1510], NOW - 10_000, {
      pool: duoPool,
    });
    const skewedFirst = partyTicket("c", [1490, 1510], NOW - 10_000, {
      pool: duoPool,
    });
    const skewedSecond = partyTicket("d", [1505, 1515], NOW - 10_000, {
      pool: duoPool,
    });
    const evenPair = evaluateMatchCandidate(evenFirst, evenSecond, {
      now: NOW,
    });
    const skewedPair = evaluateMatchCandidate(skewedFirst, skewedSecond, {
      now: NOW,
    });

    expect(evenPair).not.toBeNull();
    expect(skewedPair).not.toBeNull();
    // 平均レート差は両候補とも 10 だが、偏差が小さい候補を先に返す。
    expect(evenPair!.quality.ratingDifference).toBe(10);
    expect(skewedPair!.quality.ratingDifference).toBe(10);
    expect(evenPair!.quality.maxMemberDeviation).toBe(0);
    expect(skewedPair!.quality.maxMemberDeviation).toBeCloseTo(10);
    expect(compareMatchCandidateQuality(evenPair!, skewedPair!)).toBeLessThan(
      0,
    );
    expect(
      compareMatchCandidateQuality(skewedPair!, evenPair!),
    ).toBeGreaterThan(0);
  });

  it("構成員数が pool.maxPartySize を超えるチケットを検証で拒否する", () => {
    const limitedPool: MatchmakingPool = { ...pool, maxPartySize: 2 };
    const oversized = partyTicket("a", [1500, 1525, 1550], NOW, {
      pool: limitedPool,
    });

    expect(() =>
      evaluateMatchCandidate(oversized, partyTicket("b", [1500]), {
        now: NOW,
      }),
    ).toThrow(RangeError);
  });

  it("players を省略したチケットは従来どおり 1 人チケットとして扱う", () => {
    const solo = ticket("a", 1500);
    const explicitSolo: MatchmakingSearchTicket = {
      ...ticket("a", 1500),
      players: [{ id: "player-a", ratingValue: 1500 }],
    };
    const opponent = ticket("b", 1550);

    expect(
      evaluateMatchCandidate(explicitSolo, opponent, { now: NOW }),
    ).toEqual(evaluateMatchCandidate(solo, opponent, { now: NOW }));
  });
});
