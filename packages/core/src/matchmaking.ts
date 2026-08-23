import type {
  JsonObject,
  MatchCandidate,
  MatchmakingPool,
  MatchmakingTicketId,
  Player,
  PlayerId,
  Rating,
  Timestamp,
} from "./index.js";

/** 検索幅を切り替える時刻と、その時点で許容するレート差です。 */
export interface MatchmakingSearchWidthStage {
  /** 待機開始からの経過時間（ミリ秒）です。 */
  readonly afterMs: number;
  /** この段階で許容する最大レート差です。 */
  readonly maxRatingDifference: number;
}

/** 候補探索の設定です。未指定の項目は既定値を使用します。 */
export interface MatchmakingSearchPolicy {
  /** 待機時間順に並べた検索幅の段階です。最初の段階は `afterMs: 0` にします。 */
  readonly stages?: readonly MatchmakingSearchWidthStage[];
  /** `stages` の説明的な別名です。両方を指定する場合は同じ値にします。 */
  readonly searchWidthStages?: readonly MatchmakingSearchWidthStage[];
  /** すべての段階へ適用するレート差の上限です。 */
  readonly maxRatingDifference?: number;
  /** `maxRatingDifference` の説明的な別名です。 */
  readonly maxSearchWidth?: number;
  /** 1 回の探索で読み込む待機チケット数の上限です。 */
  readonly maxTicketsPerSearch?: number;
  /** `maxTicketsPerSearch` の説明的な別名です。 */
  readonly maxSearchTickets?: number;
  /** 1 回の探索で評価する候補組数の上限です。 */
  readonly maxCandidatesPerSearch?: number;
  /** `maxCandidatesPerSearch` の説明的な別名です。 */
  readonly maxSearchCandidates?: number;
  /** 1 回の探索で確保する候補数の上限です。 */
  readonly maxMatchesPerSearch?: number;
  /** `maxMatchesPerSearch` の説明的な別名です。 */
  readonly maxSearchMatches?: number;
}

/** 正規化済みの候補探索設定です。 */
export interface NormalizedMatchmakingSearchPolicy {
  readonly stages: readonly MatchmakingSearchWidthStage[];
  readonly maxRatingDifference: number;
  readonly maxTicketsPerSearch: number;
  readonly maxCandidatesPerSearch: number;
  readonly maxMatchesPerSearch: number;
}

/** 候補探索の既定段階です。75 → 150 → 400 の順に拡大します。 */
export const DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES: readonly MatchmakingSearchWidthStage[] =
  Object.freeze([
    Object.freeze({ afterMs: 0, maxRatingDifference: 75 }),
    Object.freeze({ afterMs: 20_000, maxRatingDifference: 150 }),
    Object.freeze({ afterMs: 60_000, maxRatingDifference: 400 }),
  ]);

/** 1 回の探索で読む待機チケット数の既定上限です。 */
export const DEFAULT_MATCHMAKING_MAX_TICKETS_PER_SEARCH = 256;

/** 1 回の探索で評価する候補組数の既定上限です。 */
export const DEFAULT_MATCHMAKING_MAX_CANDIDATES_PER_SEARCH = 8_192;

/** 1 回の探索で確保する候補数の既定上限です。 */
export const DEFAULT_MATCHMAKING_MAX_MATCHES_PER_SEARCH = 32;

/**
 * 候補評価に使う、待機中チケットの最小情報です。
 *
 * チケットは参加者集合を 1 単位として扱います。1 人チケットでは `players` を
 * 省略でき、その場合は `player` と `rating` からなる構成員 1 人として扱います。
 */
export interface MatchmakingSearchTicket {
  readonly id: MatchmakingTicketId;
  readonly pool: MatchmakingPool;
  readonly player: Player;
  readonly rating: Rating;
  /**
   * パーティー構成員(リーダーを含む)の一覧です。省略時は
   * `player` と `rating` からなる 1 人構成として扱います。
   */
  readonly players?: readonly MatchmakingSearchTicketPlayer[];
  readonly queuedAt: Timestamp;
  readonly region: string;
  readonly inputMethod: string;
  readonly searchAttributes?: JsonObject;
}

/** N 人チケット候補評価に使う構成員の最小情報です。 */
export interface MatchmakingSearchTicketPlayer {
  readonly id: PlayerId;
  /** キュー投入時にスナップショットした構成員のレートです。 */
  readonly ratingValue: number;
}

/** 成立可能な候補の品質説明です。数値が小さいほどレート品質が高くなります。 */
export interface MatchmakingCandidateQuality {
  /** 2 チケットの参照レート(構成員レートの算術平均)の絶対差です。 */
  readonly ratingDifference: number;
  /** 候補のチケット順に対応する待機時間（ミリ秒）です。 */
  readonly waitingTimeMs: readonly [number, number];
  /** 2 チケットのうち、より長く待っている時間です。 */
  readonly oldestWaitingTimeMs: number;
  /** 2 チケットのうち、より短い待機時間です。 */
  readonly newestWaitingTimeMs: number;
  /** 候補のチケット順に対応する検索幅です。 */
  readonly searchWidth: readonly [number, number];
  /** リージョンが一致するかです。異なる場合は成立不可です。 */
  readonly regionMatch: boolean;
  /**
   * 平均が近くても偏った編成を避けるための、チケット内最大構成員偏差です。
   * 2 チケットのうち大きい方の値を丸め前の実数で持ちます。
   */
  readonly maxMemberDeviation: number;
  /** 入力方式が一致するかです。一致しない場合も成立できますが品質説明へ含めます。 */
  readonly inputMethodMatch: boolean;
  /** レート差を主指標にした比較用の品質値です。 */
  readonly score: number;
}

/** 候補と、その候補が成立可能である理由です。 */
export interface MatchmakingCandidateEvaluation {
  readonly candidate: MatchCandidate;
  readonly quality: MatchmakingCandidateQuality;
}

/** 候補探索に必要な時刻と設定です。 */
export interface MatchmakingCandidateSearchOptions {
  /** Unix epoch milliseconds または ISO 8601 形式の現在時刻です。 */
  readonly now: number | Timestamp;
  readonly policy?: MatchmakingSearchPolicy;
  /** 呼び出し単位で確保する候補数をさらに減らす上限です。 */
  readonly maxMatches?: number;
}

/** 候補評価単体に必要な時刻と設定です。 */
export interface MatchmakingCandidateEvaluationOptions {
  readonly now: number | Timestamp;
  readonly policy?: MatchmakingSearchPolicy;
}

/** 候補探索設定を既定値込みで正規化します。 */
export function normalizeMatchmakingSearchPolicy(
  input: unknown = {},
): NormalizedMatchmakingSearchPolicy {
  if (!isRecord(input)) {
    throw new TypeError("候補探索設定はオブジェクトで指定してください。");
  }

  const stages = normalizeStages(input["stages"], input["searchWidthStages"]);
  const maxRatingDifference = readAliasedNonNegativeSafeInteger(
    input["maxRatingDifference"],
    input["maxSearchWidth"],
    "maxRatingDifference",
    stages[stages.length - 1]!.maxRatingDifference,
  );
  const maxTicketsPerSearch = readAliasedPositiveSafeInteger(
    input["maxTicketsPerSearch"],
    input["maxSearchTickets"],
    "maxTicketsPerSearch",
    DEFAULT_MATCHMAKING_MAX_TICKETS_PER_SEARCH,
  );
  const maxCandidatesPerSearch = readAliasedPositiveSafeInteger(
    input["maxCandidatesPerSearch"],
    input["maxSearchCandidates"],
    "maxCandidatesPerSearch",
    DEFAULT_MATCHMAKING_MAX_CANDIDATES_PER_SEARCH,
  );
  const maxMatchesPerSearch = readAliasedPositiveSafeInteger(
    input["maxMatchesPerSearch"],
    input["maxSearchMatches"],
    "maxMatchesPerSearch",
    DEFAULT_MATCHMAKING_MAX_MATCHES_PER_SEARCH,
  );

  if (stages.some((stage) => stage.maxRatingDifference > maxRatingDifference)) {
    throw new RangeError(
      "検索幅の段階は maxRatingDifference 以下で指定してください。",
    );
  }

  return Object.freeze({
    stages,
    maxRatingDifference,
    maxTicketsPerSearch,
    maxCandidatesPerSearch,
    maxMatchesPerSearch,
  });
}

/** 待機時間に対応する現在の検索幅を返します。境界時刻は新しい段階を使用します。 */
export function getMatchmakingSearchWidth(
  policy:
    | MatchmakingSearchPolicy
    | NormalizedMatchmakingSearchPolicy
    | undefined,
  waitingTimeMs: number,
): number {
  return getNormalizedMatchmakingSearchWidth(
    normalizeMatchmakingSearchPolicy(policy),
    waitingTimeMs,
  );
}

/** 正規化済み設定と検証済みの待機時間から、現在の検索幅を返します。 */
function getNormalizedMatchmakingSearchWidth(
  policy: NormalizedMatchmakingSearchPolicy,
  waitingTimeMs: number,
): number {
  if (!isNonNegativeSafeInteger(waitingTimeMs)) {
    throw new RangeError("待機時間は 0 以上の安全な整数で指定してください。");
  }

  let width = policy.stages[0]!.maxRatingDifference;

  for (const stage of policy.stages) {
    if (stage.afterMs > waitingTimeMs) {
      break;
    }
    width = stage.maxRatingDifference;
  }

  return Math.min(width, policy.maxRatingDifference);
}

/** 次の検索幅へ切り替える時刻を返します。最終段階の後は `null` です。 */
export function getNextMatchmakingSearchAt(
  policy:
    | MatchmakingSearchPolicy
    | NormalizedMatchmakingSearchPolicy
    | undefined,
  queuedAt: number | Timestamp,
  now: number,
): number | null {
  const normalized = normalizeMatchmakingSearchPolicy(policy);
  const queuedAtMs = normalizeTimestampMs(queuedAt, "queuedAt");
  const nowMs = normalizeNow(now);

  for (const stage of normalized.stages) {
    const next = queuedAtMs + stage.afterMs;

    // 待機開始時の stage はチケット追加処理で直ちに探索するため、
    // ここでは未来の切り替え時刻だけを返します。
    if (stage.afterMs > 0 && next > nowMs) {
      return next;
    }
  }

  return null;
}

/** 2 件のチケットが検索幅内で成立可能かを評価します。 */
export function evaluateMatchCandidate(
  firstTicket: MatchmakingSearchTicket,
  secondTicket: MatchmakingSearchTicket,
  options: MatchmakingCandidateEvaluationOptions,
): MatchmakingCandidateEvaluation | null {
  // 引数は左から順に評価されるため、公開 API と同じ検証順序を保ちます。
  return evaluateNormalizedMatchCandidate(
    normalizeNow(options.now),
    normalizeMatchmakingSearchPolicy(options.policy),
    normalizeSearchTicket(firstTicket),
    normalizeSearchTicket(secondTicket),
  );
}

/** 正規化済みの入力を受け取り、2 件のチケットが検索幅内で成立可能かを評価します。 */
function evaluateNormalizedMatchCandidate(
  nowMs: number,
  policy: NormalizedMatchmakingSearchPolicy,
  first: MatchmakingSearchTicket,
  second: MatchmakingSearchTicket,
): MatchmakingCandidateEvaluation | null {
  const firstPlayers = getSearchTicketPlayers(first);
  const secondPlayers = getSearchTicketPlayers(second);

  if (
    first.id === second.id ||
    sharesPlayer(firstPlayers, secondPlayers) ||
    !samePool(first.pool, second.pool) ||
    first.region !== second.region
  ) {
    return null;
  }

  // ADR-0005: 構成人員が異なるチケット同士の組、および Pool の teamSize と
  // 一致しないチケットは、この評価段階で成立不可とする。
  const firstTeamSize = first.pool.teamSize ?? 1;
  const secondTeamSize = second.pool.teamSize ?? 1;

  if (
    firstPlayers.length !== secondPlayers.length ||
    firstPlayers.length !== firstTeamSize ||
    firstTeamSize !== secondTeamSize
  ) {
    return null;
  }

  const ordered =
    first.id <= second.id
      ? ([first, second] as const)
      : ([second, first] as const);
  const firstWaitingTimeMs = getWaitingTimeMs(ordered[0]!.queuedAt, nowMs);
  const secondWaitingTimeMs = getWaitingTimeMs(ordered[1]!.queuedAt, nowMs);
  const firstSearchWidth = getNormalizedMatchmakingSearchWidth(
    policy,
    firstWaitingTimeMs,
  );
  const secondSearchWidth = getNormalizedMatchmakingSearchWidth(
    policy,
    secondWaitingTimeMs,
  );
  const firstAverageRating = averageMemberRating(firstPlayers);
  const secondAverageRating = averageMemberRating(secondPlayers);
  const ratingDifference = Math.abs(firstAverageRating - secondAverageRating);

  if (
    !Number.isFinite(ratingDifference) ||
    ratingDifference > firstSearchWidth ||
    ratingDifference > secondSearchWidth
  ) {
    return null;
  }

  const candidate = Object.freeze({
    id: createMatchCandidateId(ordered[0]!.id, ordered[1]!.id),
    pool: ordered[0]!.pool,
    ticketIds: [ordered[0]!.id, ordered[1]!.id] as const,
    createdAt: new Date(nowMs).toISOString(),
  });
  const quality = Object.freeze({
    ratingDifference,
    waitingTimeMs: [firstWaitingTimeMs, secondWaitingTimeMs] as const,
    oldestWaitingTimeMs: Math.max(firstWaitingTimeMs, secondWaitingTimeMs),
    newestWaitingTimeMs: Math.min(firstWaitingTimeMs, secondWaitingTimeMs),
    searchWidth: [firstSearchWidth, secondSearchWidth] as const,
    regionMatch: ordered[0]!.region === ordered[1]!.region,
    maxMemberDeviation: Math.max(
      maxMemberRatingDeviation(firstPlayers, firstAverageRating),
      maxMemberRatingDeviation(secondPlayers, secondAverageRating),
    ),
    inputMethodMatch: ordered[0]!.inputMethod === ordered[1]!.inputMethod,
    score: ratingDifference,
  });

  return Object.freeze({ candidate, quality });
}

/** 待機チケットから、決定論的に最適な候補を複数選びます。 */
export function selectMatchCandidates(
  tickets: readonly MatchmakingSearchTicket[],
  options: MatchmakingCandidateSearchOptions,
): readonly MatchmakingCandidateEvaluation[] {
  const nowMs = normalizeNow(options.now);
  const policy = normalizeMatchmakingSearchPolicy(options.policy);
  const maxMatches =
    options.maxMatches === undefined
      ? policy.maxMatchesPerSearch
      : normalizePositiveSafeInteger(options.maxMatches, "maxMatches");
  const orderedTickets = tickets
    .map(normalizeSearchTicket)
    .sort(compareSearchTickets);
  const selected: MatchmakingCandidateEvaluation[] = [];
  const selectedTicketIds = new Set<string>();
  let evaluatedCount = 0;

  while (selected.length < Math.min(maxMatches, policy.maxMatchesPerSearch)) {
    let best: MatchmakingCandidateEvaluation | null = null;

    outer: for (
      let firstIndex = 0;
      firstIndex < orderedTickets.length;
      firstIndex += 1
    ) {
      const first = orderedTickets[firstIndex]!;

      if (selectedTicketIds.has(first.id)) {
        continue;
      }

      for (
        let secondIndex = firstIndex + 1;
        secondIndex < orderedTickets.length;
        secondIndex += 1
      ) {
        if (evaluatedCount >= policy.maxCandidatesPerSearch) {
          break outer;
        }

        const second = orderedTickets[secondIndex]!;

        if (selectedTicketIds.has(second.id)) {
          continue;
        }

        evaluatedCount += 1;
        const evaluation = evaluateNormalizedMatchCandidate(
          nowMs,
          policy,
          first,
          second,
        );

        if (
          evaluation !== null &&
          (best === null || compareMatchCandidateQuality(evaluation, best) < 0)
        ) {
          best = evaluation;
        }
      }
    }

    if (best === null) {
      break;
    }

    selected.push(best);
    selectedTicketIds.add(best.candidate.ticketIds[0]);
    selectedTicketIds.add(best.candidate.ticketIds[1]);

    if (evaluatedCount >= policy.maxCandidatesPerSearch) {
      break;
    }
  }

  return Object.freeze(selected);
}

/** 待機チケットから、決定論的に最適な 1 件の候補を選びます。 */
export function findBestMatchCandidate(
  tickets: readonly MatchmakingSearchTicket[],
  options: MatchmakingCandidateSearchOptions,
): MatchmakingCandidateEvaluation | null {
  return (
    selectMatchCandidates(tickets, { ...options, maxMatches: 1 })[0] ?? null
  );
}

/** 候補品質の比較関数です。待機開始時刻とチケット ID が安定 Tie Break になります。 */
export function compareMatchCandidateQuality(
  left: MatchmakingCandidateEvaluation,
  right: MatchmakingCandidateEvaluation,
): number {
  const leftQuality = left.quality;
  const rightQuality = right.quality;
  const qualityComparison = compareNumbers(
    leftQuality.ratingDifference,
    rightQuality.ratingDifference,
  );

  if (qualityComparison !== 0) {
    return qualityComparison;
  }

  const inputMethodComparison = compareNumbers(
    leftQuality.inputMethodMatch ? 0 : 1,
    rightQuality.inputMethodMatch ? 0 : 1,
  );

  if (inputMethodComparison !== 0) {
    return inputMethodComparison;
  }

  const memberDeviationComparison = compareNumbers(
    leftQuality.maxMemberDeviation,
    rightQuality.maxMemberDeviation,
  );

  if (memberDeviationComparison !== 0) {
    return memberDeviationComparison;
  }

  const waitingComparison = compareNumbers(
    rightQuality.oldestWaitingTimeMs,
    leftQuality.oldestWaitingTimeMs,
  );

  if (waitingComparison !== 0) {
    return waitingComparison;
  }

  const newestWaitingComparison = compareNumbers(
    rightQuality.newestWaitingTimeMs,
    leftQuality.newestWaitingTimeMs,
  );

  if (newestWaitingComparison !== 0) {
    return newestWaitingComparison;
  }

  return left.candidate.id < right.candidate.id
    ? -1
    : left.candidate.id > right.candidate.id
      ? 1
      : 0;
}

/** `evaluateMatchCandidate()` の名前を明示する別名です。 */
export const evaluateMatchmakingCandidate = evaluateMatchCandidate;

/** `findBestMatchCandidate()` の名前を明示する別名です。 */
export const findBestMatchmakingCandidate = findBestMatchCandidate;

function normalizeStages(
  firstValue: unknown,
  secondValue: unknown,
): readonly MatchmakingSearchWidthStage[] {
  if (
    firstValue !== undefined &&
    secondValue !== undefined &&
    JSON.stringify(firstValue) !== JSON.stringify(secondValue)
  ) {
    throw new RangeError(
      "stages と searchWidthStages に異なる検索幅を指定できません。",
    );
  }

  const value =
    firstValue !== undefined
      ? firstValue
      : secondValue !== undefined
        ? secondValue
        : DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES;

  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new RangeError(
      "検索幅の段階は 1 件以上 32 件以下で指定してください。",
    );
  }

  const stages: MatchmakingSearchWidthStage[] = [];

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw new TypeError("検索幅の段階はオブジェクトで指定してください。");
    }

    const afterMs = item["afterMs"];
    const maxRatingDifference = item["maxRatingDifference"];

    if (!isNonNegativeSafeInteger(afterMs)) {
      throw new RangeError(
        "検索幅の afterMs は 0 以上の安全な整数で指定してください。",
      );
    }

    if (!isNonNegativeSafeInteger(maxRatingDifference)) {
      throw new RangeError(
        "検索幅の maxRatingDifference は 0 以上の安全な整数で指定してください。",
      );
    }

    const previous = stages[index - 1];

    if (
      (index === 0 && afterMs !== 0) ||
      (previous !== undefined &&
        (afterMs <= previous.afterMs ||
          maxRatingDifference < previous.maxRatingDifference))
    ) {
      throw new RangeError(
        "検索幅の段階は afterMs と maxRatingDifference が単調増加するよう指定してください。",
      );
    }

    stages.push(Object.freeze({ afterMs, maxRatingDifference }));
  }

  return Object.freeze(stages);
}

function readAliasedNonNegativeSafeInteger(
  firstValue: unknown,
  secondValue: unknown,
  name: string,
  defaultValue: number,
): number {
  const aliasedValue = readAliasedValue(firstValue, secondValue, name);
  const value = aliasedValue === undefined ? defaultValue : aliasedValue;

  if (!isNonNegativeSafeInteger(value)) {
    throw new RangeError(`${name} は 0 以上の安全な整数で指定してください。`);
  }

  return value;
}

function readAliasedPositiveSafeInteger(
  firstValue: unknown,
  secondValue: unknown,
  name: string,
  defaultValue: number,
): number {
  const aliasedValue = readAliasedValue(firstValue, secondValue, name);
  const value = aliasedValue === undefined ? defaultValue : aliasedValue;

  if (!isPositiveSafeInteger(value)) {
    throw new RangeError(`${name} は 1 以上の安全な整数で指定してください。`);
  }

  return value;
}

function readAliasedValue(
  firstValue: unknown,
  secondValue: unknown,
  name: string,
): unknown {
  if (
    firstValue !== undefined &&
    secondValue !== undefined &&
    firstValue !== secondValue
  ) {
    throw new RangeError(`${name} の別名へ異なる値を指定できません。`);
  }

  return firstValue !== undefined ? firstValue : secondValue;
}

function normalizeSearchTicket(
  ticket: MatchmakingSearchTicket,
): MatchmakingSearchTicket {
  if (
    !isRecord(ticket) ||
    !isNonEmptyString(ticket["id"]) ||
    !isRecord(ticket["pool"]) ||
    !isNonEmptyString(ticket["pool"]["id"]) ||
    !isNonEmptyString(ticket["pool"]["gameId"]) ||
    !isNonEmptyString(ticket["pool"]["seasonId"]) ||
    !isNonEmptyString(ticket["pool"]["mode"]) ||
    !isNonEmptyString(ticket["pool"]["region"]) ||
    !isRecord(ticket["player"]) ||
    !isNonEmptyString(ticket["player"]["id"]) ||
    !isRecord(ticket["rating"]) ||
    !isNonEmptyString(ticket["rating"]["playerId"]) ||
    !isNonEmptyString(ticket["rating"]["poolId"]) ||
    !isFiniteNonNegativeNumber(ticket["rating"]["value"]) ||
    !isTimestamp(ticket["queuedAt"]) ||
    !isNonEmptyString(ticket["region"]) ||
    !isNonEmptyString(ticket["inputMethod"])
  ) {
    throw new TypeError("候補探索チケットの形式が不正です。");
  }

  const poolTeamSize = ticket["pool"]["teamSize"];

  const poolMaxPartySize = ticket["pool"]["maxPartySize"];

  if (
    (poolTeamSize !== undefined && !isPositiveSafeInteger(poolTeamSize)) ||
    (poolMaxPartySize !== undefined && !isPositiveSafeInteger(poolMaxPartySize))
  ) {
    throw new RangeError("候補探索チケットの Pool 設定が不正です。");
  }

  const players = ticket["players"];

  if (players !== undefined) {
    if (!Array.isArray(players) || players.length === 0) {
      throw new TypeError(
        "候補探索チケットの構成員は 1 人以上の配列で指定してください。",
      );
    }

    const memberIds = new Set<string>();

    for (const player of players) {
      if (
        !isRecord(player) ||
        !isNonEmptyString(player["id"]) ||
        !isFiniteNonNegativeNumber(player["ratingValue"])
      ) {
        throw new TypeError("候補探索チケットの構成員の形式が不正です。");
      }

      if (memberIds.has(player["id"])) {
        throw new TypeError(
          "候補探索チケットの構成員 ID は重複しないように指定してください。",
        );
      }

      memberIds.add(player["id"]);
    }

    if (!memberIds.has(ticket["player"]["id"])) {
      throw new TypeError(
        "候補探索チケットの構成員にはリーダーを含めてください。",
      );
    }
  }

  if (
    ticket["rating"]["playerId"] !== ticket["player"]["id"] ||
    ticket["rating"]["poolId"] !== ticket["pool"]["id"]
  ) {
    throw new TypeError("候補探索チケットのレーティング主体が一致しません。");
  }

  return ticket;
}

/** チケットの構成員一覧を返します。1 人チケットは `player` と `rating` から合成します。 */
function getSearchTicketPlayers(
  ticket: MatchmakingSearchTicket,
): readonly MatchmakingSearchTicketPlayer[] {
  if (ticket.players !== undefined) {
    return ticket.players;
  }

  return [{ id: ticket.player.id, ratingValue: ticket.rating.value }];
}

/** 2 つのチケットが同じ構成員を共有するかを返します。 */
function sharesPlayer(
  first: readonly MatchmakingSearchTicketPlayer[],
  second: readonly MatchmakingSearchTicketPlayer[],
): boolean {
  const secondIds = new Set(second.map((player) => player.id));

  return first.some((player) => secondIds.has(player.id));
}

/** 構成員レートの算術平均を返します。丸め前の実数値です。 */
function averageMemberRating(
  players: readonly MatchmakingSearchTicketPlayer[],
): number {
  let sum = 0;

  for (const player of players) {
    sum += player.ratingValue;
  }

  return sum / players.length;
}

/** 平均からの構成員偏差の最大値を返します。丸め前の実数値です。 */
function maxMemberRatingDeviation(
  players: readonly MatchmakingSearchTicketPlayer[],
  averageRating: number,
): number {
  let maxDeviation = 0;

  for (const player of players) {
    const deviation = Math.abs(player.ratingValue - averageRating);

    if (deviation > maxDeviation) {
      maxDeviation = deviation;
    }
  }

  return maxDeviation;
}

function createMatchCandidateId(
  firstTicketId: MatchmakingTicketId,
  secondTicketId: MatchmakingTicketId,
): string {
  const first =
    firstTicketId <= secondTicketId ? firstTicketId : secondTicketId;
  const second =
    firstTicketId <= secondTicketId ? secondTicketId : firstTicketId;
  return `candidate:${encodeURIComponent(first)}:${encodeURIComponent(second)}`;
}

function getWaitingTimeMs(queuedAt: Timestamp, nowMs: number): number {
  return Math.max(0, nowMs - normalizeTimestampMs(queuedAt, "queuedAt"));
}

function compareSearchTickets(
  left: MatchmakingSearchTicket,
  right: MatchmakingSearchTicket,
): number {
  const queuedAtComparison = compareNumbers(
    normalizeTimestampMs(left.queuedAt, "queuedAt"),
    normalizeTimestampMs(right.queuedAt, "queuedAt"),
  );

  return queuedAtComparison !== 0
    ? queuedAtComparison
    : left.id < right.id
      ? -1
      : left.id > right.id
        ? 1
        : 0;
}

function samePool(left: MatchmakingPool, right: MatchmakingPool): boolean {
  return (
    left.id === right.id &&
    left.gameId === right.gameId &&
    left.seasonId === right.seasonId &&
    left.mode === right.mode &&
    left.region === right.region
  );
}

function normalizeNow(value: number | Timestamp): number {
  return typeof value === "number"
    ? normalizeSafeTimestamp(value, "now")
    : normalizeTimestampMs(value, "now");
}

function normalizeTimestampMs(value: number | Timestamp, name: string): number {
  if (typeof value === "number") {
    return normalizeSafeTimestamp(value, name);
  }

  if (!isTimestamp(value)) {
    throw new RangeError(`${name} は ISO 8601 形式で指定してください。`);
  }

  return normalizeSafeTimestamp(Date.parse(value), name);
}

function normalizeSafeTimestamp(value: number, name: string): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new RangeError(`${name} は 0 以上の安全な整数で指定してください。`);
  }
  return value;
}

function normalizePositiveSafeInteger(value: number, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new RangeError(`${name} は 1 以上の安全な整数で指定してください。`);
  }
  return value;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
