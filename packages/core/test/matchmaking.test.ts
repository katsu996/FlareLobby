import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES,
  compareMatchCandidateQuality,
  evaluateMatchCandidate,
  findBestMatchCandidate,
  getMatchmakingSearchWidth,
  getNextMatchmakingSearchAt,
  normalizeMatchmakingSearchPolicy,
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

describe("検索ポリシーの正規化", () => {
  it("オブジェクト以外の入力は TypeError", () => {
    expect(() => normalizeMatchmakingSearchPolicy("fast")).toThrow(TypeError);
    expect(() => normalizeMatchmakingSearchPolicy(null)).toThrow(TypeError);
  });

  it("stages と searchWidthStages は一致する場合だけ併用できる", () => {
    const stages = [{ afterMs: 0, maxRatingDifference: 75 }];
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages,
        searchWidthStages: [{ afterMs: 0, maxRatingDifference: 150 }],
      }),
    ).toThrow(RangeError);
    expect(
      normalizeMatchmakingSearchPolicy({ stages, searchWidthStages: stages })
        .stages,
    ).toEqual(stages);
  });

  it("段階数と各段階のフィールド形式を検証する", () => {
    expect(() => normalizeMatchmakingSearchPolicy({ stages: [] })).toThrow(
      RangeError,
    );
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages: Array.from({ length: 33 }, (_, index) => ({
          afterMs: index * 10_000,
          maxRatingDifference: 75 + index,
        })),
      }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeMatchmakingSearchPolicy({ stages: ["wide"] }),
    ).toThrow(TypeError);
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages: [{ afterMs: -1, maxRatingDifference: 75 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages: [{ afterMs: 0, maxRatingDifference: Number.NaN }],
      }),
    ).toThrow(RangeError);
  });

  it("段階は afterMs と maxRatingDifference が単調増加するよう要求する", () => {
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages: [{ afterMs: 1_000, maxRatingDifference: 75 }],
      }),
    ).toThrow(/単調増加/u);
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages: [
          { afterMs: 0, maxRatingDifference: 150 },
          { afterMs: 20_000, maxRatingDifference: 75 },
        ],
      }),
    ).toThrow(/単調増加/u);
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        stages: [
          { afterMs: 0, maxRatingDifference: 75 },
          { afterMs: 0, maxRatingDifference: 150 },
        ],
      }),
    ).toThrow(/単調増加/u);
  });

  it("上限値の別名が矛盾するときは拒否し、段階が上限を超えるときも拒否する", () => {
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        maxRatingDifference: 100,
        maxSearchWidth: 200,
      }),
    ).toThrow(/別名/u);
    expect(() =>
      normalizeMatchmakingSearchPolicy({ maxTicketsPerSearch: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeMatchmakingSearchPolicy({ maxMatchesPerSearch: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeMatchmakingSearchPolicy({
        maxRatingDifference: 100,
        stages: DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES,
      }),
    ).toThrow(/maxRatingDifference 以下/u);
  });

  it("既定値と省略時の既定段階を返す", () => {
    const normalized = normalizeMatchmakingSearchPolicy();
    expect(normalized.stages).toEqual(DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES);
    expect(normalized.maxRatingDifference).toBe(400);
    expect(normalized.maxTicketsPerSearch).toBe(256);
    expect(normalized.maxCandidatesPerSearch).toBe(8_192);
    expect(normalized.maxMatchesPerSearch).toBe(32);
  });
});

describe("検索幅と候補選択の境界", () => {
  it("待機時間が不正な場合は RangeError、カスタム段階では clamp される", () => {
    const custom = {
      stages: [
        { afterMs: 0, maxRatingDifference: 50 },
        { afterMs: 10_000, maxRatingDifference: 80 },
      ],
    };
    expect(getMatchmakingSearchWidth(custom, 0)).toBe(50);
    expect(getMatchmakingSearchWidth(custom, 9_999)).toBe(50);
    expect(getMatchmakingSearchWidth(custom, 10_000)).toBe(80);
    // maxRatingDifference 未指定なら最終段階が上限になり、clamp は変化しない
    expect(() => getMatchmakingSearchWidth(undefined, -1)).toThrow(RangeError);
    expect(() => getMatchmakingSearchWidth(undefined, 1.5)).toThrow(RangeError);
  });

  it("maxMatches と評価上限で探索を打ち切る", () => {
    const tickets = [
      ticket("a", 1_500),
      ticket("b", 1_500),
      ticket("c", 1_500),
      ticket("d", 1_500),
    ];
    const limited = selectMatchCandidates(tickets, {
      now: NOW,
      maxMatches: 2,
    });
    expect(limited).toHaveLength(2);

    expect(() =>
      selectMatchCandidates(tickets, { now: NOW, maxMatches: 0 }),
    ).toThrow(RangeError);
  });

  it("プレイヤー集合が重なる組や同一チケットを候補から除外する", () => {
    const duo: MatchmakingPool = { ...pool, teamSize: 2 };
    const a = partyTicket("a", [1_500, 1_500], NOW, { pool: duo });
    const b = partyTicket("b", [1_500, 1_500], NOW, { pool: duo });

    // 同一チケット同士、teamSize 不一致はいずれも不成立
    expect(evaluateMatchCandidate(a, a, { now: NOW })).toBeNull();
    expect(
      evaluateMatchCandidate(a, ticket("solo", 1_500), { now: NOW }),
    ).toBeNull();

    const selected = selectMatchCandidates([a, b], { now: NOW });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.candidate.ticketIds).toEqual(["a", "b"]);
  });
});

describe("候補探索の打ち切りと品質比較の分岐", () => {
  it("評価上限で内側の探索と選択後の継続を打ち切る", () => {
    const tickets = [
      ticket("a", 1_500),
      ticket("b", 1_500),
      ticket("c", 1_500),
      ticket("d", 1_500),
    ];

    const selected = selectMatchCandidates(tickets, {
      now: NOW,
      policy: { maxCandidatesPerSearch: 1 },
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]!.candidate.ticketIds).toEqual(["a", "b"]);
  });

  it("入力方式と最新待機時間の一致順で候補を比較する", () => {
    const base = evaluateMatchCandidate(
      ticket("a", 1_500),
      ticket("b", 1_500),
      {
        now: NOW,
      },
    )!;
    const withInputMatch = {
      ...base,
      quality: { ...base.quality, inputMethodMatch: true },
    };
    const withoutInputMatch = {
      ...base,
      quality: { ...base.quality, inputMethodMatch: false },
    };

    expect(
      compareMatchCandidateQuality(withInputMatch, withoutInputMatch),
    ).toBeLessThan(0);
    expect(
      compareMatchCandidateQuality(withoutInputMatch, withInputMatch),
    ).toBeGreaterThan(0);

    const newerWaiting = {
      ...base,
      quality: { ...base.quality, newestWaitingTimeMs: 200 },
    };
    const olderNewestWaiting = {
      ...base,
      quality: { ...base.quality, newestWaitingTimeMs: 100 },
    };

    expect(
      compareMatchCandidateQuality(newerWaiting, olderNewestWaiting),
    ).toBeLessThan(0);
    expect(
      compareMatchCandidateQuality(olderNewestWaiting, newerWaiting),
    ).toBeGreaterThan(0);
  });

  it("検索ポリシーの上限値とチケット検証の異常系を拒否する", () => {
    expect(() =>
      normalizeMatchmakingSearchPolicy({ maxRatingDifference: -1 }),
    ).toThrow("0 以上の安全な整数");

    const malformed = (overrides: Record<string, unknown>) =>
      ({
        ...ticket("a", 1_500),
        ...overrides,
      }) as unknown as MatchmakingSearchTicket;
    const select = (value: MatchmakingSearchTicket) =>
      selectMatchCandidates([value, ticket("b", 1_500)], { now: NOW });

    expect(() => select(malformed({ region: "" }))).toThrow(
      "候補探索チケットの形式が不正",
    );
    expect(() =>
      select(
        malformed({
          pool: { ...pool, teamSize: 0 },
        }),
      ),
    ).toThrow("Pool 設定が不正");
    expect(() => select(malformed({ players: [] }))).toThrow("1 人以上");
    expect(() =>
      select(
        malformed({
          players: [{ id: "player-a", ratingValue: -1 }],
        }),
      ),
    ).toThrow("構成員の形式が不正");
    expect(() =>
      select(
        malformed({
          players: [
            { id: "player-a", ratingValue: 1_500 },
            { id: "player-a", ratingValue: 1_500 },
          ],
        }),
      ),
    ).toThrow("重複しない");
    expect(() =>
      select(
        malformed({
          players: [{ id: "other", ratingValue: 1_500 }],
        }),
      ),
    ).toThrow("リーダーを含めて");
    expect(() =>
      select(
        malformed({
          rating: { playerId: "someone", poolId: pool.id, value: 1_500 },
        }),
      ),
    ).toThrow("主体が一致");
  });

  it("queuedAt の ISO 文字列を受け付け、不正な形式を拒否する", () => {
    expect(
      getNextMatchmakingSearchAt(undefined, "2026-08-11T00:00:00.000Z", NOW),
    ).toBeGreaterThanOrEqual(NOW);
    expect(() =>
      getNextMatchmakingSearchAt(undefined, "not-a-timestamp", NOW),
    ).toThrow("ISO 8601");
    expect(() => getNextMatchmakingSearchAt(undefined, -1, NOW)).toThrow(
      "0 以上の安全な整数",
    );
  });
});

describe("境界値の回帰（Issue #114）", () => {
  it("非対称な待機時間では両者の検索幅を満たさないと不成立になる", () => {
    // 片方が 60 秒待機（幅 400）でも、もう片方が参加直後（幅 75）なら
    // レート差 100 は新しい側の幅を超えるため不成立。
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 60_000),
        ticket("b", 1_600, NOW),
        { now: NOW },
      ),
    ).toBeNull();
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 60_000),
        ticket("b", 1_575, NOW),
        { now: NOW },
      ),
    ).not.toBeNull();
    // 両者が 60 秒待機すればレート差 100 は両幅 400 以内で成立する。
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 60_000),
        ticket("b", 1_600, NOW - 60_000),
        { now: NOW },
      ),
    ).not.toBeNull();
  });

  it("レート差上限の境界を固定する（既定 400 とカスタム上限）", () => {
    // 既定段階の最終幅 400：差 400 は成立、401 は不成立。
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 60_000),
        ticket("b", 1_900, NOW - 60_000),
        { now: NOW },
      ),
    ).not.toBeNull();
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 60_000),
        ticket("b", 1_901, NOW - 60_000),
        { now: NOW },
      ),
    ).toBeNull();

    // カスタム上限 100：差 100 は成立、101 は不成立。
    const policy: MatchmakingSearchPolicy = {
      stages: [
        { afterMs: 0, maxRatingDifference: 50 },
        { afterMs: 10_000, maxRatingDifference: 100 },
      ],
      maxRatingDifference: 100,
    };
    expect(getMatchmakingSearchWidth(policy, 20_000)).toBe(100);
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 20_000),
        ticket("b", 1_600, NOW - 20_000),
        { now: NOW, policy },
      ),
    ).not.toBeNull();
    expect(
      evaluateMatchCandidate(
        ticket("a", 1_500, NOW - 20_000),
        ticket("b", 1_601, NOW - 20_000),
        { now: NOW, policy },
      ),
    ).toBeNull();
  });

  it("3 人チケットの最小ケースを平均レートで固定する", () => {
    const trioPool: MatchmakingPool = { ...pool, teamSize: 3, maxPartySize: 3 };
    const trio = (id: string, ratings: readonly number[]) =>
      partyTicket(id, ratings, NOW, { pool: trioPool });

    // 平均 1,520 同士は差 0 で成立し、最大構成員偏差は 20。
    const evaluation = evaluateMatchCandidate(
      trio("a", [1_500, 1_520, 1_540]),
      trio("b", [1_500, 1_520, 1_540]),
      { now: NOW },
    );
    expect(evaluation).not.toBeNull();
    expect(evaluation?.quality.ratingDifference).toBe(0);
    expect(evaluation?.quality.maxMemberDeviation).toBe(20);

    // 平均差 120（1,520 と 1,640）は既定の初期幅 75 を超えて不成立。
    expect(
      evaluateMatchCandidate(
        trio("a", [1_500, 1_520, 1_540]),
        trio("c", [1_620, 1_640, 1_660]),
        { now: NOW },
      ),
    ).toBeNull();
  });

  it("同時刻チケットの選択は入力順によらず決定論的になる", () => {
    const tickets = [
      ticket("c", 1_500),
      ticket("a", 1_500),
      ticket("b", 1_500),
      ticket("d", 1_500),
    ];
    const options = { now: NOW } as const;

    const forward = selectMatchCandidates(tickets, options);
    const reversed = selectMatchCandidates([...tickets].reverse(), options);

    expect(reversed).toEqual(forward);
    expect(forward[0]?.candidate.ticketIds).toEqual(["a", "b"]);
    expect(forward).toHaveLength(2);
  });
});
