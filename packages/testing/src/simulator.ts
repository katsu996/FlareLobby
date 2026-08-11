import {
  normalizeMatchmakingSearchPolicy,
  selectMatchCandidates
} from "@flarelobby/core";
import type {
  MatchCandidate,
  MatchmakingCandidateQuality,
  MatchmakingPool,
  MatchmakingSearchPolicy,
  MatchmakingSearchTicket,
  NormalizedMatchmakingSearchPolicy,
  Timestamp
} from "@flarelobby/core";

import {
  addMilliseconds,
  createVirtualClock,
  toEpochMilliseconds
} from "./clock.js";
import {
  generateSimulationPlayers,
  normalizeNumericDistribution,
  normalizePlayerGenerationOptions,
  normalizeSimulationPlayers,
  sampleNumericDistribution
} from "./distributions.js";
import type {
  NormalizedPlayerGenerationOptions,
  NumericDistribution,
  PlayerGenerationOptions,
  SimulationPlayer
} from "./distributions.js";
import { SEEDED_RANDOM_ALGORITHM, SeededRandom } from "./random.js";
import type { RandomSeed, RandomSource } from "./random.js";
import type { AdvancingClock } from "./clock.js";

/** シミュレーションの既定実行時間です。 */
export const DEFAULT_SIMULATION_DURATION_MS = 60_000;

/** シミュレーションの既定イベント確認間隔です。 */
export const DEFAULT_SIMULATION_TICK_MS = 1_000;

/** シミュレーションで利用する既定 Pool です。 */
export const DEFAULT_SIMULATION_POOL: MatchmakingPool = Object.freeze({
  id: "simulation-pool",
  gameId: "simulation",
  seasonId: "simulation",
  mode: "ranked-1v1",
  region: "jp"
});

/** シミュレーションのイベント処理上限です。異常に細かい設定を早期に検出します。 */
export const MAX_SIMULATION_EVENT_COUNT = 1_000_000;

/** シミュレーション中のチケット状態です。 */
export type SimulationTicketStatus =
  | "not_joined"
  | "waiting"
  | "matched"
  | "cancelled"
  | "expired";

/** キャンセルを確率的に生成する設定です。 */
export interface SimulationCancellationPolicy {
  /** 各プレイヤーがキャンセルする確率です。 */
  readonly probability: number;
  /** 参加時刻からキャンセルまでの時間です。 */
  readonly afterMs: number | NumericDistribution;
}

/** シミュレーションへ注入できる時計と乱数源です。 */
export interface SimulationDependencies {
  readonly clock?: AdvancingClock;
  readonly random?: RandomSource;
}

/** 決定論的なマッチングシミュレーションの入力です。 */
export interface MatchmakingSimulationConfig {
  readonly seed: RandomSeed;
  /** 省略時は 0 人の生成設定を使用します。 */
  readonly playerGeneration?: PlayerGenerationOptions;
  /** 固定シナリオを使う場合は `playerGeneration` と同時に指定しません。 */
  readonly players?: readonly SimulationPlayer[];
  /** 省略時は Unix epoch 0 から開始します。 */
  readonly startAt?: number | Timestamp;
  /** 省略時は 60 秒です。0 も指定できます。 */
  readonly durationMs?: number;
  /** 省略時は 1 秒です。 */
  readonly tickMs?: number;
  /** 省略時は期限なしです。0 は参加直後の期限切れを表します。 */
  readonly ticketTtlMs?: number;
  readonly pool?: MatchmakingPool;
  readonly searchPolicy?: MatchmakingSearchPolicy;
  readonly cancellation?: SimulationCancellationPolicy;
}

/** 既定値を適用したキャンセル設定です。 */
export interface NormalizedSimulationCancellationPolicy {
  readonly probability: number;
  readonly afterMs: number | NumericDistribution;
}

/** 後から同じシミュレーションを再実行するための正規化設定です。 */
export interface MatchmakingSimulationReplayConfig {
  readonly pool: MatchmakingPool;
  readonly searchPolicy: NormalizedMatchmakingSearchPolicy;
  readonly startAt: Timestamp;
  readonly durationMs: number;
  readonly tickMs: number;
  readonly ticketTtlMs: number | null;
  readonly cancellation: NormalizedSimulationCancellationPolicy | null;
  readonly playerGeneration: NormalizedPlayerGenerationOptions | null;
  readonly players: readonly SimulationPlayer[] | null;
}

/** シミュレーション結果を再現するための最小情報です。 */
export interface SimulationReplay {
  readonly seed: RandomSeed;
  readonly randomAlgorithm: string;
  readonly config: MatchmakingSimulationReplayConfig;
}

/** シミュレーションで発生したイベント種別です。 */
export type SimulationEventType =
  | "joined"
  | "cancelled"
  | "expired"
  | "matched";

/** シミュレーションの時系列イベントです。 */
export interface SimulationEvent {
  readonly sequence: number;
  readonly at: Timestamp;
  readonly type: SimulationEventType;
  readonly ticketIds: readonly string[];
  readonly playerIds: readonly string[];
  readonly candidateId: string | null;
}

/** シミュレーション中のチケット最終状態です。 */
export interface SimulationTicketResult {
  readonly id: string;
  readonly playerId: string;
  readonly rating: number;
  readonly queuedAt: Timestamp;
  readonly status: SimulationTicketStatus;
  readonly cancelledAt: Timestamp | null;
  readonly expiredAt: Timestamp | null;
  readonly matchedAt: Timestamp | null;
  readonly waitTimeMs: number | null;
  readonly candidateId: string | null;
  readonly opponentTicketId: string | null;
  readonly opponentPlayerId: string | null;
  readonly ratingDifference: number | null;
}

/** 成立した対戦のシミュレーション結果です。 */
export interface SimulationMatchResult {
  readonly matchId: string;
  readonly candidate: MatchCandidate;
  readonly quality: MatchmakingCandidateQuality;
  readonly ticketIds: readonly [string, string];
  readonly playerIds: readonly [string, string];
  readonly matchedAt: Timestamp;
}

/** 待機時間またはレート差の分布統計です。 */
export interface DistributionStatistics {
  readonly count: number;
  readonly average: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

/** シミュレーション全体の集計値です。 */
export interface SimulationStatistics {
  readonly generatedPlayerCount: number;
  readonly joinedTicketCount: number;
  readonly matchedTicketCount: number;
  readonly matchCount: number;
  readonly cancelledTicketCount: number;
  readonly expiredTicketCount: number;
  readonly waitingTicketCount: number;
  readonly notJoinedPlayerCount: number;
  readonly unmatchedTicketCount: number;
  /** `unmatchedTicketCount / joinedTicketCount`。分母が 0 の場合は 0 です。 */
  readonly unmatchedRate: number;
  readonly waitTimeMs: DistributionStatistics;
  readonly ratingDifference: DistributionStatistics;
}

/** 決定論的マッチングシミュレーションの完全な結果です。 */
export interface MatchmakingSimulationResult {
  readonly seed: RandomSeed;
  readonly randomAlgorithm: string;
  readonly replay: SimulationReplay;
  readonly config: MatchmakingSimulationReplayConfig;
  readonly startAt: Timestamp;
  readonly endAt: Timestamp;
  readonly players: readonly SimulationPlayer[];
  readonly tickets: readonly SimulationTicketResult[];
  readonly matches: readonly SimulationMatchResult[];
  readonly unmatchedTickets: readonly SimulationTicketResult[];
  readonly events: readonly SimulationEvent[];
  readonly statistics: SimulationStatistics;
}

/** 比較する検索幅設定です。 */
export interface SimulationPolicyDefinition {
  readonly name: string;
  readonly policy: MatchmakingSearchPolicy;
}

/** 検索幅設定ごとの実行結果です。 */
export interface SimulationPolicyRun {
  readonly name: string;
  readonly result: MatchmakingSimulationResult;
}

/** 2 つの検索幅設定を同じシードで比較した結果です。 */
export interface SimulationPolicyComparison {
  readonly first: SimulationPolicyRun;
  readonly second: SimulationPolicyRun;
  /** 差分は `second - first` です。 */
  readonly delta: {
    readonly matchedTicketCount: number;
    readonly unmatchedRate: number;
    readonly averageWaitTimeMs: number | null;
    readonly p95WaitTimeMs: number | null;
    readonly averageRatingDifference: number | null;
  };
}

interface WorkingTicket {
  readonly id: string;
  readonly player: SimulationPlayer;
  readonly joinedAtMs: number;
  readonly cancellationAtMs: number | null;
  readonly expiresAtMs: number | null;
  status: SimulationTicketStatus;
  cancelledAtMs: number | null;
  expiredAtMs: number | null;
  matchedAtMs: number | null;
  waitTimeMs: number | null;
  candidateId: string | null;
  opponentTicketId: string | null;
  opponentPlayerId: string | null;
  ratingDifference: number | null;
}

interface WorkingMatch {
  readonly evaluation: {
    readonly candidate: MatchCandidate;
    readonly quality: MatchmakingCandidateQuality;
  };
  readonly matchedAtMs: number;
}

interface WorkingEvent {
  readonly sequence: number;
  readonly atMs: number;
  readonly type: SimulationEventType;
  readonly ticketIds: readonly string[];
  readonly playerIds: readonly string[];
  readonly candidateId: string | null;
}

/**
 * 仮想時計上でチケット参加、時間経過、キャンセル、期限切れ、成立を処理します。
 * 候補の評価と選択は本番の `@flarelobby/core` 関数へ委譲します。
 */
export function simulateMatchmaking(
  input: MatchmakingSimulationConfig,
  dependencies: SimulationDependencies = {}
): MatchmakingSimulationResult {
  assertRecord(input, "シミュレーション設定");

  const random = dependencies.random ?? new SeededRandom(input.seed);
  const startMs = toEpochMilliseconds(input.startAt ?? 0);
  const durationMs = normalizeDuration(
    input.durationMs ?? DEFAULT_SIMULATION_DURATION_MS,
    "durationMs"
  );
  const tickMs = normalizePositiveDuration(
    input.tickMs ?? DEFAULT_SIMULATION_TICK_MS,
    "tickMs"
  );
  const endMs = addMilliseconds(startMs, durationMs);
  const pool = normalizePool(input.pool ?? DEFAULT_SIMULATION_POOL);
  const searchPolicy = normalizeMatchmakingSearchPolicy(input.searchPolicy);
  const ticketTtlMs =
    input.ticketTtlMs === undefined
      ? null
      : normalizeDuration(input.ticketTtlMs, "ticketTtlMs");
  const cancellation = normalizeCancellationPolicy(input.cancellation);

  if (input.players !== undefined && input.playerGeneration !== undefined) {
    throw new TypeError(
      "固定プレイヤーとプレイヤー生成設定は同時に指定できません。"
    );
  }

  const players =
    input.players === undefined
      ? generateSimulationPlayers(input.playerGeneration, random)
      : normalizeSimulationPlayers(input.players);
  const clock = dependencies.clock ?? createVirtualClock(startMs);

  if (clock.now() > startMs) {
    throw new RangeError("注入した仮想時計はシミュレーション開始時刻より後です。");
  }
  clock.advanceTo(startMs);

  const records = createWorkingTickets(
    players,
    random,
    cancellation,
    ticketTtlMs
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const eventTimes = createEventTimes(
    records,
    searchPolicy,
    startMs,
    endMs,
    tickMs
  );
  const events: WorkingEvent[] = [];
  const matches: WorkingMatch[] = [];
  let sequence = 0;

  for (const timeMs of eventTimes) {
    clock.advanceTo(timeMs);

    for (const record of records) {
      if (record.status === "not_joined" && record.joinedAtMs <= timeMs) {
        record.status = "waiting";
        sequence += 1;
        events.push({
          sequence,
          atMs: timeMs,
          type: "joined",
          ticketIds: [record.id],
          playerIds: [record.player.id],
          candidateId: null
        });
      }
    }

    for (const record of records) {
      if (record.status !== "waiting") {
        continue;
      }

      if (record.cancellationAtMs !== null && record.cancellationAtMs <= timeMs) {
        record.status = "cancelled";
        record.cancelledAtMs = timeMs;
        sequence += 1;
        events.push({
          sequence,
          atMs: timeMs,
          type: "cancelled",
          ticketIds: [record.id],
          playerIds: [record.player.id],
          candidateId: null
        });
        continue;
      }

      if (record.expiresAtMs !== null && record.expiresAtMs <= timeMs) {
        record.status = "expired";
        record.expiredAtMs = timeMs;
        sequence += 1;
        events.push({
          sequence,
          atMs: timeMs,
          type: "expired",
          ticketIds: [record.id],
          playerIds: [record.player.id],
          candidateId: null
        });
      }
    }

    const waitingTickets = records
      .filter((record) => record.status === "waiting")
      .sort(compareWorkingTickets)
      .slice(0, searchPolicy.maxTicketsPerSearch)
      .map((record) => toSearchTicket(record, pool));
    const selected = selectMatchCandidates(waitingTickets, {
      now: timeMs,
      policy: searchPolicy
    });

    for (const evaluation of selected) {
      const first = recordsById.get(evaluation.candidate.ticketIds[0]);
      const second = recordsById.get(evaluation.candidate.ticketIds[1]);

      if (
        first === undefined ||
        second === undefined ||
        first.status !== "waiting" ||
        second.status !== "waiting"
      ) {
        continue;
      }

      first.status = "matched";
      second.status = "matched";
      first.matchedAtMs = timeMs;
      second.matchedAtMs = timeMs;
      first.waitTimeMs = Math.max(0, timeMs - first.joinedAtMs);
      second.waitTimeMs = Math.max(0, timeMs - second.joinedAtMs);
      first.candidateId = evaluation.candidate.id;
      second.candidateId = evaluation.candidate.id;
      first.opponentTicketId = second.id;
      second.opponentTicketId = first.id;
      first.opponentPlayerId = second.player.id;
      second.opponentPlayerId = first.player.id;
      first.ratingDifference = evaluation.quality.ratingDifference;
      second.ratingDifference = evaluation.quality.ratingDifference;
      matches.push({ evaluation, matchedAtMs: timeMs });
      sequence += 1;
      events.push({
        sequence,
        atMs: timeMs,
        type: "matched",
        ticketIds: evaluation.candidate.ticketIds,
        playerIds: [first.player.id, second.player.id],
        candidateId: evaluation.candidate.id
      });
    }
  }

  const ticketResults = records.map(toTicketResult);
  const matchResults = matches.map((match) => toMatchResult(match, recordsById));
  const unmatchedTickets = ticketResults.filter(
    (ticket) => ticket.status !== "matched" && ticket.status !== "not_joined"
  );
  const config = createReplayConfig({
    pool,
    searchPolicy,
    startMs,
    durationMs,
    tickMs,
    ticketTtlMs,
    cancellation,
    generatedPlayers: input.players === undefined,
    playerGeneration:
      input.players === undefined
        ? normalizePlayerGenerationOptions(input.playerGeneration)
        : null,
    players: input.players === undefined ? null : players
  });
  const statistics = createStatistics(records, matchResults);
  const result: MatchmakingSimulationResult = {
    seed: input.seed,
    randomAlgorithm: random.algorithm,
    replay: {
      seed: input.seed,
      randomAlgorithm: random.algorithm,
      config
    },
    config,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    players,
    tickets: ticketResults,
    matches: matchResults,
    unmatchedTickets,
    events: events.map(toEvent),
    statistics
  };

  return deepFreeze(result);
}

/** 結果へ含まれるリプレイ情報から同じシミュレーションを再実行します。 */
export function replaySimulation(
  replay: SimulationReplay
): MatchmakingSimulationResult {
  if (replay.randomAlgorithm !== SEEDED_RANDOM_ALGORITHM) {
    throw new RangeError(
      `対応していない乱数アルゴリズムです: ${replay.randomAlgorithm}`
    );
  }

  const replayConfig = replay.config;
  const config: MatchmakingSimulationConfig = {
    seed: replay.seed,
    pool: replayConfig.pool,
    searchPolicy: replayConfig.searchPolicy,
    startAt: replayConfig.startAt,
    durationMs: replayConfig.durationMs,
    tickMs: replayConfig.tickMs,
    ...(replayConfig.ticketTtlMs === null
      ? {}
      : { ticketTtlMs: replayConfig.ticketTtlMs }),
    ...(replayConfig.cancellation === null
      ? {}
      : { cancellation: replayConfig.cancellation }),
    ...(replayConfig.playerGeneration === null
      ? {}
      : { playerGeneration: replayConfig.playerGeneration }),
    ...(replayConfig.players === null ? {} : { players: replayConfig.players })
  };

  return simulateMatchmaking(config);
}

/** 2 つの検索幅設定を同じプレイヤー列・乱数種で比較します。 */
export function compareSearchPolicies(
  config: MatchmakingSimulationConfig,
  first: SimulationPolicyDefinition,
  second: SimulationPolicyDefinition
): SimulationPolicyComparison {
  assertNonEmptyString(first.name, "比較対象の名前");
  assertNonEmptyString(second.name, "比較対象の名前");

  const firstResult = simulateMatchmaking({
    ...config,
    searchPolicy: first.policy
  });
  const secondResult = simulateMatchmaking({
    ...config,
    searchPolicy: second.policy
  });

  return deepFreeze({
    first: { name: first.name, result: firstResult },
    second: { name: second.name, result: secondResult },
    delta: {
      matchedTicketCount:
        secondResult.statistics.matchedTicketCount -
        firstResult.statistics.matchedTicketCount,
      unmatchedRate: roundRate(
        secondResult.statistics.unmatchedRate -
          firstResult.statistics.unmatchedRate
      ),
      averageWaitTimeMs: subtractNullableMetric(
        secondResult.statistics.waitTimeMs.average,
        firstResult.statistics.waitTimeMs.average
      ),
      p95WaitTimeMs: subtractNullableMetric(
        secondResult.statistics.waitTimeMs.p95,
        firstResult.statistics.waitTimeMs.p95
      ),
      averageRatingDifference: subtractNullableMetric(
        secondResult.statistics.ratingDifference.average,
        firstResult.statistics.ratingDifference.average
      )
    }
  });
}

function createWorkingTickets(
  players: readonly SimulationPlayer[],
  random: RandomSource,
  cancellation: NormalizedSimulationCancellationPolicy | null,
  ticketTtlMs: number | null
): WorkingTicket[] {
  const records = players.map((player) => {
    const joinedAtMs = toEpochMilliseconds(player.joinedAt);
    const cancellationAtMs =
      cancellation !== null && random.chance(cancellation.probability)
        ? addMilliseconds(
            joinedAtMs,
            normalizeDuration(
              typeof cancellation.afterMs === "number"
                ? cancellation.afterMs
                : Math.round(sampleNumericDistribution(cancellation.afterMs, random)),
              "cancellation.afterMs"
            )
          )
        : null;
    const expiresAtMs =
      ticketTtlMs === null
        ? null
        : addMilliseconds(joinedAtMs, ticketTtlMs);

    return {
      id: `ticket:${encodeURIComponent(player.id)}`,
      player,
      joinedAtMs,
      cancellationAtMs,
      expiresAtMs,
      status: "not_joined" as const,
      cancelledAtMs: null,
      expiredAtMs: null,
      matchedAtMs: null,
      waitTimeMs: null,
      candidateId: null,
      opponentTicketId: null,
      opponentPlayerId: null,
      ratingDifference: null
    };
  });

  records.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  return records;
}

function createEventTimes(
  records: readonly WorkingTicket[],
  searchPolicy: NormalizedMatchmakingSearchPolicy,
  startMs: number,
  endMs: number,
  tickMs: number
): readonly number[] {
  const times = new Set<number>([startMs, endMs]);
  const addIfInRange = (value: number): void => {
    if (value >= startMs && value <= endMs) {
      times.add(value);
    }
  };

  for (const record of records) {
    addIfInRange(record.joinedAtMs);
    if (record.cancellationAtMs !== null) {
      addIfInRange(record.cancellationAtMs);
    }
    if (record.expiresAtMs !== null) {
      addIfInRange(record.expiresAtMs);
    }
    for (const stage of searchPolicy.stages) {
      if (stage.afterMs > 0) {
        addIfInRange(addMilliseconds(record.joinedAtMs, stage.afterMs));
      }
    }
  }

  let tick = addMilliseconds(startMs, tickMs);
  while (tick < endMs) {
    times.add(tick);
    if (times.size > MAX_SIMULATION_EVENT_COUNT) {
      throw new RangeError(
        `シミュレーションイベント数が上限 ${MAX_SIMULATION_EVENT_COUNT} 件を超えました。`
      );
    }
    tick = addMilliseconds(tick, tickMs);
  }

  if (times.size > MAX_SIMULATION_EVENT_COUNT) {
    throw new RangeError(
      `シミュレーションイベント数が上限 ${MAX_SIMULATION_EVENT_COUNT} 件を超えました。`
    );
  }

  return Object.freeze([...times].sort((left, right) => left - right));
}

function toSearchTicket(
  record: WorkingTicket,
  pool: MatchmakingPool
): MatchmakingSearchTicket {
  return {
    id: record.id,
    pool,
    player: record.player.player,
    rating: {
      playerId: record.player.id,
      poolId: pool.id,
      value: record.player.rating
    },
    queuedAt: record.player.joinedAt,
    region: record.player.region,
    inputMethod: record.player.inputMethod
  };
}

function compareWorkingTickets(
  left: WorkingTicket,
  right: WorkingTicket
): number {
  if (left.joinedAtMs !== right.joinedAtMs) {
    return left.joinedAtMs - right.joinedAtMs;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function toTicketResult(record: WorkingTicket): SimulationTicketResult {
  return Object.freeze({
    id: record.id,
    playerId: record.player.id,
    rating: record.player.rating,
    queuedAt: record.player.joinedAt,
    status: record.status,
    cancelledAt: toOptionalTimestamp(record.cancelledAtMs),
    expiredAt: toOptionalTimestamp(record.expiredAtMs),
    matchedAt: toOptionalTimestamp(record.matchedAtMs),
    waitTimeMs: record.waitTimeMs,
    candidateId: record.candidateId,
    opponentTicketId: record.opponentTicketId,
    opponentPlayerId: record.opponentPlayerId,
    ratingDifference: record.ratingDifference
  });
}

function toMatchResult(
  match: WorkingMatch,
  recordsById: ReadonlyMap<string, WorkingTicket>
): SimulationMatchResult {
  const first = recordsById.get(match.evaluation.candidate.ticketIds[0]);
  const second = recordsById.get(match.evaluation.candidate.ticketIds[1]);
  if (first === undefined || second === undefined) {
    throw new Error("成立した候補のチケットが見つかりません。");
  }

  return Object.freeze({
    matchId: `match:${encodeURIComponent(match.evaluation.candidate.id)}`,
    candidate: match.evaluation.candidate,
    quality: match.evaluation.quality,
    ticketIds: match.evaluation.candidate.ticketIds,
    playerIds: [first.player.id, second.player.id] as [string, string],
    matchedAt: new Date(match.matchedAtMs).toISOString()
  });
}

function createStatistics(
  records: readonly WorkingTicket[],
  matches: readonly SimulationMatchResult[]
): SimulationStatistics {
  const joined = records.filter((record) => record.status !== "not_joined");
  const matched = records.filter((record) => record.status === "matched");
  const unmatched = joined.length - matched.length;
  const waits = matched.flatMap((record) =>
    record.waitTimeMs === null ? [] : [record.waitTimeMs]
  );
  const ratingDifferences = matches.map(
    (match) => match.quality.ratingDifference
  );

  return Object.freeze({
    generatedPlayerCount: records.length,
    joinedTicketCount: joined.length,
    matchedTicketCount: matched.length,
    matchCount: matches.length,
    cancelledTicketCount: records.filter(
      (record) => record.status === "cancelled"
    ).length,
    expiredTicketCount: records.filter((record) => record.status === "expired")
      .length,
    waitingTicketCount: records.filter((record) => record.status === "waiting")
      .length,
    notJoinedPlayerCount: records.filter(
      (record) => record.status === "not_joined"
    ).length,
    unmatchedTicketCount: unmatched,
    unmatchedRate: roundRate(joined.length === 0 ? 0 : unmatched / joined.length),
    waitTimeMs: createDistributionStatistics(waits),
    ratingDifference: createDistributionStatistics(ratingDifferences)
  });
}

function createDistributionStatistics(
  values: readonly number[]
): DistributionStatistics {
  if (values.length === 0) {
    return Object.freeze({
      count: 0,
      average: null,
      p50: null,
      p95: null,
      p99: null,
      min: null,
      max: null
    });
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    count: sorted.length,
    average: roundMetric(total / sorted.length),
    p50: roundMetric(interpolatePercentile(sorted, 0.5)),
    p95: roundMetric(interpolatePercentile(sorted, 0.95)),
    p99: roundMetric(interpolatePercentile(sorted, 0.99)),
    min: roundMetric(sorted[0]!),
    max: roundMetric(sorted[sorted.length - 1]!)
  });
}

function interpolatePercentile(sorted: readonly number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function createReplayConfig(input: {
  readonly pool: MatchmakingPool;
  readonly searchPolicy: NormalizedMatchmakingSearchPolicy;
  readonly startMs: number;
  readonly durationMs: number;
  readonly tickMs: number;
  readonly ticketTtlMs: number | null;
  readonly cancellation: NormalizedSimulationCancellationPolicy | null;
  readonly generatedPlayers: boolean;
  readonly playerGeneration: NormalizedPlayerGenerationOptions | null;
  readonly players: readonly SimulationPlayer[] | null;
}): MatchmakingSimulationReplayConfig {
  return deepFreeze({
    pool: input.pool,
    searchPolicy: input.searchPolicy,
    startAt: new Date(input.startMs).toISOString(),
    durationMs: input.durationMs,
    tickMs: input.tickMs,
    ticketTtlMs: input.ticketTtlMs,
    cancellation: input.cancellation,
    playerGeneration: input.generatedPlayers ? input.playerGeneration : null,
    players: input.generatedPlayers ? null : input.players
  });
}

function normalizePool(input: MatchmakingPool): MatchmakingPool {
  if (
    !isRecord(input) ||
    !isNonEmptyString(input.id) ||
    !isNonEmptyString(input.gameId) ||
    !isNonEmptyString(input.seasonId) ||
    !isNonEmptyString(input.mode) ||
    !isNonEmptyString(input.region)
  ) {
    throw new TypeError("シミュレーション Pool の形式が不正です。");
  }

  return Object.freeze({
    id: input.id,
    gameId: input.gameId,
    seasonId: input.seasonId,
    mode: input.mode,
    region: input.region
  });
}

function normalizeCancellationPolicy(
  input: SimulationCancellationPolicy | undefined
): NormalizedSimulationCancellationPolicy | null {
  if (input === undefined) {
    return null;
  }
  assertRecord(input, "キャンセル設定");
  if (
    typeof input.probability !== "number" ||
    !Number.isFinite(input.probability) ||
    input.probability < 0 ||
    input.probability > 1
  ) {
    throw new RangeError("キャンセル確率は 0 以上 1 以下で指定してください。");
  }

  const afterMs =
    typeof input.afterMs === "number"
      ? normalizeDuration(input.afterMs, "cancellation.afterMs")
      : normalizeNumericDistribution(input.afterMs);
  return Object.freeze({ probability: input.probability, afterMs });
}

function normalizeDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の安全な整数で指定してください。`);
  }
  return value;
}

function normalizePositiveDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} は 1 以上の安全な整数で指定してください。`);
  }
  return value;
}

function toOptionalTimestamp(value: number | null): Timestamp | null {
  return value === null ? null : new Date(value).toISOString();
}

function subtractNullableMetric(
  right: number | null,
  left: number | null
): number | null {
  return right === null || left === null ? null : roundMetric(right - left);
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toEvent(event: WorkingEvent): SimulationEvent {
  return Object.freeze({
    sequence: event.sequence,
    at: new Date(event.atMs).toISOString(),
    type: event.type,
    ticketIds: event.ticketIds,
    playerIds: event.playerIds,
    candidateId: event.candidateId
  });
}

function assertRecord(
  value: unknown,
  name: string
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name}はオブジェクトで指定してください。`);
  }
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name}は空でない文字列で指定してください。`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
