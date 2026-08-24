import { FlareLobbyError, elo } from "@flarelobby/core";
import type {
  EloOptions,
  MatchmakingPool,
  Rating,
  RatingResult,
} from "@flarelobby/core";

/** D1 へ保存するレーティングの設定です。省略時は ELO の既定値を使います。 */
export interface RatingConfiguration extends EloOptions {}

/** サーバー側で認可された試合結果の登録入力です。result は A 側の得点です。 */
export interface MatchResultRegistrationInput {
  readonly resultId: string;
  readonly matchId: string;
  readonly playerAId: string;
  readonly playerBId: string;
  readonly result: RatingResult;
}

/** 試合に参加したプレイヤーのレーティング履歴です。 */
export interface RatingMatchParticipant {
  readonly slot: "A" | "B";
  readonly playerId: string;
  readonly score: RatingResult;
  readonly ratingBefore: number;
  readonly delta: number;
  readonly ratingAfter: number;
  readonly versionBefore: number;
  readonly versionAfter: number;
}

/** D1 へ確定したレーティング試合履歴です。 */
export interface RatingMatchRecord {
  readonly matchId: string;
  readonly resultId: string;
  readonly pool: MatchmakingPool;
  readonly result: RatingResult;
  readonly participants: readonly [
    RatingMatchParticipant,
    RatingMatchParticipant,
  ];
  readonly createdAt: string;
  readonly appliedAt: string;
}

/** 試合結果登録の戻り値です。重複再送時は applied が false になります。 */
export interface MatchResultRegistration {
  readonly match: RatingMatchRecord;
  readonly applied: boolean;
}

/** チーム対応の試合結果登録入力です。result は A 側チームの得点です。 */
export interface TeamMatchResultRegistrationInput {
  readonly resultId: string;
  readonly matchId: string;
  /** スロット A 側のチームと構成員です。 */
  readonly teamAId: string;
  readonly playerAIds: readonly string[];
  /** スロット B 側のチームと構成員です。 */
  readonly teamBId: string;
  readonly playerBIds: readonly string[];
  readonly result: RatingResult;
}

/** チーム対応の試合に参加したプレイヤーのレーティング履歴です。 */
export interface TeamRatingMatchParticipant {
  readonly slot: "A" | "B";
  readonly playerId: string;
  readonly teamId: string;
  readonly score: RatingResult;
  readonly ratingBefore: number;
  readonly delta: number;
  readonly ratingAfter: number;
  readonly versionBefore: number;
  readonly versionAfter: number;
}

/** D1 へ確定したチーム対応の試合履歴です。 */
export interface TeamRatingMatchRecord {
  readonly matchId: string;
  readonly resultId: string;
  readonly pool: MatchmakingPool;
  readonly result: RatingResult;
  readonly teamIds: readonly [string, string];
  readonly participants: readonly TeamRatingMatchParticipant[];
  readonly createdAt: string;
  readonly appliedAt: string;
}

/** チーム対応の試合結果登録の戻り値です。重複再送時は applied が false になります。 */
export interface TeamMatchResultRegistration {
  readonly match: TeamRatingMatchRecord;
  readonly applied: boolean;
}

/** 内部の試合履歴取得条件です。結果は新しい順に返します。 */
export interface MatchHistoryQuery {
  readonly pool: MatchmakingPool;
  readonly playerId?: string;
  readonly cursor?: string;
  readonly limit?: number;
  /** `limit` の説明的な別名です。 */
  readonly pageSize?: number;
}

/** 内部の試合履歴ページです。 */
export interface MatchHistoryPage {
  readonly matches: readonly RatingMatchRecord[];
  readonly nextCursor: string | null;
}

/** レーティング処理で版競合が続いた場合の最大再試行回数です。 */
export const DEFAULT_RATING_CONFLICT_RETRY_COUNT = 3;

const DEFAULT_MATCH_HISTORY_PAGE_SIZE = 20;
const MAX_MATCH_HISTORY_PAGE_SIZE = 100;

const RATING_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS flarelobby_rating_seasons (
     game_id TEXT NOT NULL,
     season_id TEXT NOT NULL,
     pool_id TEXT NOT NULL,
     initial_rating REAL NOT NULL,
     k_factor REAL NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (game_id, season_id, pool_id)
   )`,
  `CREATE TABLE IF NOT EXISTS flarelobby_ratings (
     player_id TEXT NOT NULL,
     game_id TEXT NOT NULL,
     season_id TEXT NOT NULL,
     pool_id TEXT NOT NULL,
     mode TEXT NOT NULL,
     region TEXT NOT NULL,
     rating_value REAL NOT NULL,
     version INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, game_id, season_id, pool_id, mode, region),
     FOREIGN KEY (game_id, season_id, pool_id)
       REFERENCES flarelobby_rating_seasons (game_id, season_id, pool_id)
   )`,
  `CREATE TABLE IF NOT EXISTS flarelobby_rating_matches (
     match_id TEXT PRIMARY KEY,
     result_id TEXT NOT NULL UNIQUE,
     game_id TEXT NOT NULL,
     season_id TEXT NOT NULL,
     pool_id TEXT NOT NULL,
     mode TEXT NOT NULL,
     region TEXT NOT NULL,
     player_a_id TEXT NOT NULL,
     player_b_id TEXT NOT NULL,
     result REAL NOT NULL CHECK (result IN (0, 0.5, 1)),
     rating_a_before REAL NOT NULL,
     rating_b_before REAL NOT NULL,
     delta_a INTEGER NOT NULL,
     delta_b INTEGER NOT NULL,
     rating_a_after REAL NOT NULL,
     rating_b_after REAL NOT NULL,
     created_at INTEGER NOT NULL,
     applied_at INTEGER NOT NULL,
     FOREIGN KEY (game_id, season_id, pool_id)
       REFERENCES flarelobby_rating_seasons (game_id, season_id, pool_id)
   )`,
  `CREATE TABLE IF NOT EXISTS flarelobby_rating_match_participants (
     match_id TEXT NOT NULL,
     slot TEXT NOT NULL CHECK (slot IN ('A', 'B')),
     player_id TEXT NOT NULL,
     score REAL NOT NULL CHECK (score IN (0, 0.5, 1)),
     rating_before REAL NOT NULL,
     delta INTEGER NOT NULL,
     rating_after REAL NOT NULL,
     version_before INTEGER NOT NULL,
     version_after INTEGER NOT NULL,
     PRIMARY KEY (match_id, slot),
     UNIQUE (match_id, player_id),
     FOREIGN KEY (match_id) REFERENCES flarelobby_rating_matches (match_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_flarelobby_ratings_pool_player
     ON flarelobby_ratings (game_id, season_id, pool_id, player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_flarelobby_rating_matches_pool_time
     ON flarelobby_rating_matches (
       game_id, season_id, pool_id, applied_at DESC, match_id DESC
     )`,
  `CREATE INDEX IF NOT EXISTS idx_flarelobby_rating_matches_player_time
     ON flarelobby_rating_matches (
       game_id, season_id, pool_id, player_a_id, player_b_id,
       applied_at DESC, match_id DESC
     )`,
  `CREATE TABLE IF NOT EXISTS flarelobby_team_rating_matches (
     match_id TEXT PRIMARY KEY,
     result_id TEXT NOT NULL UNIQUE,
     game_id TEXT NOT NULL,
     season_id TEXT NOT NULL,
     pool_id TEXT NOT NULL,
     mode TEXT NOT NULL,
     region TEXT NOT NULL,
     team_a_id TEXT NOT NULL,
     team_b_id TEXT NOT NULL,
     result REAL NOT NULL CHECK (result IN (0, 0.5, 1)),
     created_at INTEGER NOT NULL,
     applied_at INTEGER NOT NULL,
     FOREIGN KEY (game_id, season_id, pool_id)
       REFERENCES flarelobby_rating_seasons (game_id, season_id, pool_id)
   )`,
  `CREATE TABLE IF NOT EXISTS flarelobby_team_rating_match_participants (
     match_id TEXT NOT NULL,
     slot TEXT NOT NULL CHECK (slot IN ('A', 'B')),
     player_id TEXT NOT NULL,
     team_id TEXT NOT NULL,
     score REAL NOT NULL CHECK (score IN (0, 0.5, 1)),
     rating_before REAL NOT NULL,
     delta INTEGER NOT NULL,
     rating_after REAL NOT NULL,
     version_before INTEGER NOT NULL,
     version_after INTEGER NOT NULL,
     PRIMARY KEY (match_id, player_id),
     FOREIGN KEY (match_id)
       REFERENCES flarelobby_team_rating_matches (match_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_flarelobby_team_rating_matches_pool_time
     ON flarelobby_team_rating_matches (
       game_id, season_id, pool_id, applied_at DESC, match_id DESC
     )`,
  `CREATE INDEX IF NOT EXISTS idx_flarelobby_team_rating_match_participants_player
     ON flarelobby_team_rating_match_participants (
       player_id, match_id
     )`,
] as const);

interface SeasonRow extends Record<string, unknown> {
  gameId: string;
  seasonId: string;
  poolId: string;
  initialRating: number;
  kFactor: number;
}

interface RatingRow extends Record<string, unknown> {
  playerId: string;
  gameId: string;
  seasonId: string;
  poolId: string;
  mode: string;
  region: string;
  value: number;
  version: number;
}

interface MatchRow extends Record<string, unknown> {
  matchId: string;
  resultId: string;
  gameId: string;
  seasonId: string;
  poolId: string;
  mode: string;
  region: string;
  playerAId: string;
  playerBId: string;
  result: RatingResult;
  ratingABefore: number;
  ratingBBefore: number;
  deltaA: number;
  deltaB: number;
  ratingAAfter: number;
  ratingBAfter: number;
  createdAt: number;
  appliedAt: number;
}

interface ParticipantRow extends Record<string, unknown> {
  matchId: string;
  slot: "A" | "B";
  playerId: string;
  score: RatingResult;
  ratingBefore: number;
  delta: number;
  ratingAfter: number;
  versionBefore: number;
  versionAfter: number;
}

interface HistoryCursor {
  readonly appliedAt: number;
  readonly matchId: string;
}

const schemaInitialization = new WeakMap<D1Database, Promise<unknown>>();

/** レーティング用の D1 テーブルを Worker 実行ごとに一度だけ作成します。 */
export async function ensureRatingSchema(database: D1Database): Promise<void> {
  const cached = schemaInitialization.get(database);
  if (cached !== undefined) {
    await cached;
    return;
  }

  const initialization = database
    .batch(
      RATING_SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)),
    )
    .catch(() => {
      schemaInitialization.delete(database);
      throw new FlareLobbyError("CONNECTION_FAILED");
    });
  schemaInitialization.set(database, initialization);
  await initialization;
}

/** 初回参照時に設定済み初期値を保存し、現在のレーティングを返します。 */
export async function getRating(
  database: D1Database,
  pool: MatchmakingPool,
  playerId: string,
  configuration: RatingConfiguration = {},
): Promise<Rating> {
  const normalizedPool = normalizePool(pool);
  const normalizedPlayerId = normalizeIdentifier(playerId, "playerId");
  const normalizedConfiguration = normalizeRatingConfiguration(configuration);
  await ensureRatingSchema(database);

  try {
    const now = Date.now();
    await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO flarelobby_rating_seasons (
             game_id, season_id, pool_id, initial_rating, k_factor,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          normalizedPool.gameId,
          normalizedPool.seasonId,
          normalizedPool.id,
          normalizedConfiguration.initialRating,
          normalizedConfiguration.kFactor,
          now,
          now,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO flarelobby_ratings (
             player_id, game_id, season_id, pool_id, mode, region,
             rating_value, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          normalizedPlayerId,
          normalizedPool.gameId,
          normalizedPool.seasonId,
          normalizedPool.id,
          normalizedPool.mode,
          normalizedPool.region,
          normalizedConfiguration.initialRating,
          now,
          now,
        ),
    ]);

    const row = await readRatingRow(
      database,
      normalizedPool,
      normalizedPlayerId,
    );

    if (row === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return toRating(row);
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

/** `getRating()` の説明的な別名です。 */
export const getPlayerRating = getRating;

/**
 * 認可済みの試合結果を D1 へ一度だけ適用します。
 *
 * レーティングの読込、版確認、試合行、両参加者、両レーティング更新は
 * 1 回の D1 batch へまとめます。版が先に進んでいた場合は再読込して
 * 有界回数だけ再計算するため、同時更新で片方の更新を失いません。
 */
export async function registerMatchResult(
  database: D1Database,
  pool: MatchmakingPool,
  input: MatchResultRegistrationInput,
  configuration: RatingConfiguration = {},
  maxRetries = DEFAULT_RATING_CONFLICT_RETRY_COUNT,
): Promise<MatchResultRegistration> {
  const normalizedPool = normalizePool(pool);
  const normalizedInput = normalizeMatchResultInput(input);
  const normalizedConfiguration = normalizeRatingConfiguration(configuration);
  const retryCount = normalizeRetryCount(maxRetries);

  if (normalizedInput.playerAId === normalizedInput.playerBId) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  await ensureRatingSchema(database);
  await ensureRatingRows(
    database,
    normalizedPool,
    normalizedInput.playerAId,
    normalizedInput.playerBId,
    normalizedConfiguration,
  );

  let existing = await findExistingMatch(
    database,
    normalizedInput.matchId,
    normalizedInput.resultId,
  );

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    if (existing !== null) {
      return resolveExistingMatch(
        existing,
        normalizedPool,
        normalizedInput,
        database,
      );
    }

    const [season, ratingA, ratingB] = await readRatingState(
      database,
      normalizedPool,
      normalizedInput.playerAId,
      normalizedInput.playerBId,
    );

    if (season === null || ratingA === null || ratingB === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const calculation = elo({
      initialRating: season.initialRating,
      kFactor: season.kFactor,
    }).calculate({
      ratingA: ratingA.value,
      ratingB: ratingB.value,
      result: normalizedInput.result,
    });
    const now = Date.now();

    try {
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO flarelobby_rating_matches (
               match_id, result_id, game_id, season_id, pool_id, mode, region,
               player_a_id, player_b_id, result,
               rating_a_before, rating_b_before, delta_a, delta_b,
               rating_a_after, rating_b_after, created_at, applied_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM flarelobby_ratings
               WHERE player_id = ? AND game_id = ? AND season_id = ?
                 AND pool_id = ? AND mode = ? AND region = ? AND version = ?
             )
             AND EXISTS (
               SELECT 1 FROM flarelobby_ratings
               WHERE player_id = ? AND game_id = ? AND season_id = ?
                 AND pool_id = ? AND mode = ? AND region = ? AND version = ?
             )`,
          )
          .bind(
            normalizedInput.matchId,
            normalizedInput.resultId,
            normalizedPool.gameId,
            normalizedPool.seasonId,
            normalizedPool.id,
            normalizedPool.mode,
            normalizedPool.region,
            normalizedInput.playerAId,
            normalizedInput.playerBId,
            normalizedInput.result,
            ratingA.value,
            ratingB.value,
            calculation.deltaA,
            calculation.deltaB,
            calculation.updatedRatingA,
            calculation.updatedRatingB,
            now,
            now,
            normalizedInput.playerAId,
            normalizedPool.gameId,
            normalizedPool.seasonId,
            normalizedPool.id,
            normalizedPool.mode,
            normalizedPool.region,
            ratingA.version,
            normalizedInput.playerBId,
            normalizedPool.gameId,
            normalizedPool.seasonId,
            normalizedPool.id,
            normalizedPool.mode,
            normalizedPool.region,
            ratingB.version,
          ),
        database
          .prepare(
            `UPDATE flarelobby_ratings
             SET rating_value = ?, version = version + 1, updated_at = ?
             WHERE player_id = ? AND game_id = ? AND season_id = ?
               AND pool_id = ? AND mode = ? AND region = ? AND version = ?
               AND EXISTS (
                 SELECT 1 FROM flarelobby_rating_matches
                 WHERE match_id = ?
               )`,
          )
          .bind(
            calculation.updatedRatingA,
            now,
            normalizedInput.playerAId,
            normalizedPool.gameId,
            normalizedPool.seasonId,
            normalizedPool.id,
            normalizedPool.mode,
            normalizedPool.region,
            ratingA.version,
            normalizedInput.matchId,
          ),
        database
          .prepare(
            `UPDATE flarelobby_ratings
             SET rating_value = ?, version = version + 1, updated_at = ?
             WHERE player_id = ? AND game_id = ? AND season_id = ?
               AND pool_id = ? AND mode = ? AND region = ? AND version = ?
               AND EXISTS (
                 SELECT 1 FROM flarelobby_rating_matches
                 WHERE match_id = ?
               )`,
          )
          .bind(
            calculation.updatedRatingB,
            now,
            normalizedInput.playerBId,
            normalizedPool.gameId,
            normalizedPool.seasonId,
            normalizedPool.id,
            normalizedPool.mode,
            normalizedPool.region,
            ratingB.version,
            normalizedInput.matchId,
          ),
        database
          .prepare(
            `INSERT INTO flarelobby_rating_match_participants (
               match_id, slot, player_id, score, rating_before, delta,
               rating_after, version_before, version_after
             )
             SELECT ?, 'A', ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM flarelobby_rating_matches WHERE match_id = ?
             )`,
          )
          .bind(
            normalizedInput.matchId,
            normalizedInput.playerAId,
            calculation.scoreA,
            ratingA.value,
            calculation.deltaA,
            calculation.updatedRatingA,
            ratingA.version,
            ratingA.version + 1,
            normalizedInput.matchId,
          ),
        database
          .prepare(
            `INSERT INTO flarelobby_rating_match_participants (
               match_id, slot, player_id, score, rating_before, delta,
               rating_after, version_before, version_after
             )
             SELECT ?, 'B', ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM flarelobby_rating_matches WHERE match_id = ?
             )`,
          )
          .bind(
            normalizedInput.matchId,
            normalizedInput.playerBId,
            calculation.scoreB,
            ratingB.value,
            calculation.deltaB,
            calculation.updatedRatingB,
            ratingB.version,
            ratingB.version + 1,
            normalizedInput.matchId,
          ),
      ]);

      if (
        resultChanges(results[0]) === 0 ||
        resultChanges(results[1]) !== 1 ||
        resultChanges(results[2]) !== 1 ||
        resultChanges(results[3]) !== 1 ||
        resultChanges(results[4]) !== 1
      ) {
        if (attempt < retryCount) {
          continue;
        }

        throw new FlareLobbyError("CONFLICT", {
          message: "レーティングの版競合を解決できませんでした。",
        });
      }

      const stored = await readMatchRecord(database, normalizedInput.matchId);
      if (stored === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return Object.freeze({ match: stored, applied: true });
    } catch (error) {
      const raced = await findExistingMatch(
        database,
        normalizedInput.matchId,
        normalizedInput.resultId,
      );
      existing = raced;

      if (raced !== null) {
        return resolveExistingMatch(
          raced,
          normalizedPool,
          normalizedInput,
          database,
        );
      }

      throw normalizeRatingError(error);
    }
  }

  throw new FlareLobbyError("CONFLICT", {
    message: "レーティングの版競合を解決できませんでした。",
  });
}

/** `registerMatchResult()` の説明的な別名です。 */
export const recordMatchResult = registerMatchResult;

/** `registerMatchResult()` の説明的な別名です。 */
export const applyMatchResult = registerMatchResult;

/**
 * 認可済みのチーム対応試合結果を D1 へ一度だけ適用します。
 *
 * 参照レートは各チームの構成員レートの算術平均とし、各構成員の ELO 更新は
 * 自分のレートと相手チーム平均から計算します (ADR-0005)。丸めは 1 対 1 と
 * 同じ「0.5 はゼロから遠い方向」規則を使います。試合行、全構成員の参加者履歴、
 * 全構成員のレーティング更新は 1 回の D1 batch へまとめ、楽観的版ガードで
 * 同時更新を防ぎます。`matchId` または `resultId` が既存なら再計算せず
 * `applied: false` を返します。
 */
export async function registerTeamMatchResult(
  database: D1Database,
  pool: MatchmakingPool,
  input: TeamMatchResultRegistrationInput,
  configuration: RatingConfiguration = {},
  maxRetries = DEFAULT_RATING_CONFLICT_RETRY_COUNT,
): Promise<TeamMatchResultRegistration> {
  const normalizedPool = normalizePool(pool);
  const normalizedInput = normalizeTeamMatchResultInput(input);
  const normalizedConfiguration = normalizeRatingConfiguration(configuration);
  const retryCount = normalizeRetryCount(maxRetries);

  await ensureRatingSchema(database);
  await ensureTeamRatingRows(
    database,
    normalizedPool,
    [...normalizedInput.playerAIds, ...normalizedInput.playerBIds],
    normalizedConfiguration,
  );

  let existing = await findExistingTeamMatch(
    database,
    normalizedInput.matchId,
    normalizedInput.resultId,
  );

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    if (existing !== null) {
      return resolveExistingTeamMatch(
        existing,
        normalizedPool,
        normalizedInput,
        database,
      );
    }

    const [season, ratings] = await readTeamRatingState(
      database,
      normalizedPool,
      [...normalizedInput.playerAIds, ...normalizedInput.playerBIds],
    );

    if (season === null || ratings === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const ratingByPlayer = new Map(ratings.map((row) => [row.playerId, row]));
    const teamAAverage =
      normalizedInput.playerAIds.reduce(
        (sum, playerId) => sum + (ratingByPlayer.get(playerId)?.value ?? 0),
        0,
      ) / normalizedInput.playerAIds.length;
    const teamBAverage =
      normalizedInput.playerBIds.reduce(
        (sum, playerId) => sum + (ratingByPlayer.get(playerId)?.value ?? 0),
        0,
      ) / normalizedInput.playerBIds.length;
    const kFactor = season.kFactor;

    const participants = [
      ...normalizedInput.playerAIds.map((playerId) => {
        const rating = requireRatingRow(ratingByPlayer.get(playerId));
        const rawDelta =
          kFactor *
          (normalizedInput.result -
            calculateExpectedScore(teamBAverage, rating.value));
        return {
          slot: "A" as const,
          playerId,
          teamId: normalizedInput.teamAId,
          score: normalizedInput.result,
          ratingBefore: rating.value,
          versionBefore: rating.version,
          delta: roundHalfAwayFromZero(rawDelta),
        };
      }),
      ...normalizedInput.playerBIds.map((playerId) => {
        const rating = requireRatingRow(ratingByPlayer.get(playerId));
        const rawDelta =
          kFactor *
          (1 -
            normalizedInput.result -
            calculateExpectedScore(teamAAverage, rating.value));
        return {
          slot: "B" as const,
          playerId,
          teamId: normalizedInput.teamBId,
          score: toRatingResult(1 - normalizedInput.result),
          ratingBefore: rating.value,
          versionBefore: rating.version,
          delta: roundHalfAwayFromZero(rawDelta),
        };
      }),
    ];
    const now = Date.now();

    try {
      const statements: D1PreparedStatement[] = [
        database
          .prepare(
            `INSERT INTO flarelobby_team_rating_matches (
               match_id, result_id, game_id, season_id, pool_id, mode, region,
               team_a_id, team_b_id, result, created_at, applied_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE
             ${participants
               .map(
                 () => `EXISTS (
               SELECT 1 FROM flarelobby_ratings
               WHERE player_id = ? AND game_id = ? AND season_id = ?
                 AND pool_id = ? AND mode = ? AND region = ?
                 AND version = ?
             )`,
               )
               .join("\n             AND ")}`,
          )
          .bind(
            normalizedInput.matchId,
            normalizedInput.resultId,
            normalizedPool.gameId,
            normalizedPool.seasonId,
            normalizedPool.id,
            normalizedPool.mode,
            normalizedPool.region,
            normalizedInput.teamAId,
            normalizedInput.teamBId,
            normalizedInput.result,
            now,
            now,
            ...participants.flatMap((participant) => [
              participant.playerId,
              normalizedPool.gameId,
              normalizedPool.seasonId,
              normalizedPool.id,
              normalizedPool.mode,
              normalizedPool.region,
              participant.versionBefore,
            ]),
          ),
      ];

      for (const participant of participants) {
        statements.push(
          database
            .prepare(
              `UPDATE flarelobby_ratings
               SET rating_value = ?, version = version + 1, updated_at = ?
               WHERE player_id = ? AND game_id = ? AND season_id = ?
                 AND pool_id = ? AND mode = ? AND region = ? AND version = ?
                 AND EXISTS (
                   SELECT 1 FROM flarelobby_team_rating_matches
                   WHERE match_id = ?
                 )`,
            )
            .bind(
              participant.ratingBefore + participant.delta,
              now,
              participant.playerId,
              normalizedPool.gameId,
              normalizedPool.seasonId,
              normalizedPool.id,
              normalizedPool.mode,
              normalizedPool.region,
              participant.versionBefore,
              normalizedInput.matchId,
            ),
        );
      }

      for (const participant of participants) {
        statements.push(
          database
            .prepare(
              `INSERT INTO flarelobby_team_rating_match_participants (
                 match_id, slot, player_id, team_id, score, rating_before,
                 delta, rating_after, version_before, version_after
               )
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM flarelobby_team_rating_matches WHERE match_id = ?
               )`,
            )
            .bind(
              normalizedInput.matchId,
              participant.slot,
              participant.playerId,
              participant.teamId,
              participant.score,
              participant.ratingBefore,
              participant.delta,
              participant.ratingBefore + participant.delta,
              participant.versionBefore,
              participant.versionBefore + 1,
              normalizedInput.matchId,
            ),
        );
      }

      const results = await database.batch(statements);

      if (
        resultChanges(results[0]) === 0 ||
        results.slice(1).some((result) => resultChanges(result) !== 1)
      ) {
        if (attempt < retryCount) {
          continue;
        }

        throw new FlareLobbyError("CONFLICT", {
          message: "レーティングの版競合を解決できませんでした。",
        });
      }

      const stored = await readTeamMatchRecord(
        database,
        normalizedInput.matchId,
      );
      if (stored === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return Object.freeze({ match: stored, applied: true });
    } catch (error) {
      const raced = await findExistingTeamMatch(
        database,
        normalizedInput.matchId,
        normalizedInput.resultId,
      );
      existing = raced;

      if (raced !== null) {
        return resolveExistingTeamMatch(
          raced,
          normalizedPool,
          normalizedInput,
          database,
        );
      }

      throw normalizeRatingError(error);
    }
  }

  throw new FlareLobbyError("CONFLICT", {
    message: "レーティングの版競合を解決できませんでした。",
  });
}

/** `registerTeamMatchResult()` の説明的な別名です。 */
export const recordTeamMatchResult = registerTeamMatchResult;

/** 試合履歴をページング取得します。履歴は D1 の確定時刻で安定ソートします。 */
export async function listMatchHistory(
  database: D1Database,
  query: MatchHistoryQuery,
): Promise<MatchHistoryPage> {
  const pool = normalizePool(query?.pool);
  const playerId =
    query?.playerId === undefined
      ? undefined
      : normalizeIdentifier(query.playerId, "playerId");
  const limit = normalizeHistoryLimit(query?.limit ?? query?.pageSize);
  const cursor =
    query?.cursor === undefined ? null : parseHistoryCursor(query.cursor);
  await ensureRatingSchema(database);

  try {
    const where = [
      "game_id = ?",
      "season_id = ?",
      "pool_id = ?",
      "mode = ?",
      "region = ?",
    ];
    const values: unknown[] = [
      pool.gameId,
      pool.seasonId,
      pool.id,
      pool.mode,
      pool.region,
    ];

    if (playerId !== undefined) {
      where.push("(player_a_id = ? OR player_b_id = ?)");
      values.push(playerId, playerId);
    }

    if (cursor !== null) {
      where.push("(applied_at < ? OR (applied_at = ? AND match_id < ?))");
      values.push(cursor.appliedAt, cursor.appliedAt, cursor.matchId);
    }

    values.push(limit + 1);
    const rows = await database
      .prepare(
        `SELECT
           match_id AS matchId,
           result_id AS resultId,
           game_id AS gameId,
           season_id AS seasonId,
           pool_id AS poolId,
           mode,
           region,
           player_a_id AS playerAId,
           player_b_id AS playerBId,
           result,
           rating_a_before AS ratingABefore,
           rating_b_before AS ratingBBefore,
           delta_a AS deltaA,
           delta_b AS deltaB,
           rating_a_after AS ratingAAfter,
           rating_b_after AS ratingBAfter,
           created_at AS createdAt,
           applied_at AS appliedAt
         FROM flarelobby_rating_matches
         WHERE ${where.join(" AND ")}
         ORDER BY applied_at DESC, match_id DESC
         LIMIT ?`,
      )
      .bind(...values)
      .all<MatchRow>();

    const hasNext = rows.results.length > limit;
    const matchRows = hasNext ? rows.results.slice(0, limit) : rows.results;
    const records = await readMatchRecords(database, matchRows);
    const last = matchRows[matchRows.length - 1];

    return Object.freeze({
      matches: Object.freeze(records),
      nextCursor:
        hasNext && last !== undefined
          ? encodeHistoryCursor({
              appliedAt: last.appliedAt,
              matchId: last.matchId,
            })
          : null,
    });
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

/** `listMatchHistory()` の説明的な別名です。 */
export const getMatchHistory = listMatchHistory;

function normalizeTeamMatchResultInput(
  input: TeamMatchResultRegistrationInput,
): TeamMatchResultRegistrationInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const resultId = normalizeIdentifier(input.resultId, "resultId");
  const matchId = normalizeIdentifier(input.matchId, "matchId");
  const teamAId = normalizeIdentifier(input.teamAId, "teamAId");
  const teamBId = normalizeIdentifier(input.teamBId, "teamBId");
  const playerAIds = normalizePlayerIdList(input.playerAIds, "playerAIds");
  const playerBIds = normalizePlayerIdList(input.playerBIds, "playerBIds");

  for (const playerId of playerAIds) {
    if (playerBIds.includes(playerId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "同じ構成員を両チームへ含められません。",
      });
    }
  }

  if (!isRatingResult(input.result)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return Object.freeze({
    resultId,
    matchId,
    teamAId,
    playerAIds,
    teamBId,
    playerBIds,
    result: input.result,
  });
}

function normalizePlayerIdList(
  value: unknown,
  fieldName: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (playerId) => typeof playerId !== "string" || playerId.length === 0,
    )
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 1 人以上のプレイヤー ID の配列で指定してください。`,
    });
  }
  const unique = Object.freeze(
    [...new Set(value as string[])].sort(compareStrings),
  );
  if (unique.length !== value.length) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} に重複したプレイヤー ID を指定できません。`,
    });
  }
  return unique;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function ensureTeamRatingRows(
  database: D1Database,
  pool: MatchmakingPool,
  playerIds: readonly string[],
  configuration: NormalizedRatingConfiguration,
): Promise<void> {
  const now = Date.now();

  try {
    await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO flarelobby_rating_seasons (
             game_id, season_id, pool_id, initial_rating, k_factor,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          pool.gameId,
          pool.seasonId,
          pool.id,
          configuration.initialRating,
          configuration.kFactor,
          now,
          now,
        ),
      ...playerIds.map((playerId) =>
        createRatingInsert(database, pool, playerId, configuration, now),
      ),
    ]);
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

async function readTeamRatingState(
  database: D1Database,
  pool: MatchmakingPool,
  playerIds: readonly string[],
): Promise<readonly [SeasonRow | null, readonly RatingRow[] | null]> {
  const seasonStatement = database
    .prepare(
      `SELECT
         game_id AS gameId,
         season_id AS seasonId,
         pool_id AS poolId,
         initial_rating AS initialRating,
         k_factor AS kFactor
       FROM flarelobby_rating_seasons
       WHERE game_id = ? AND season_id = ? AND pool_id = ?`,
    )
    .bind(pool.gameId, pool.seasonId, pool.id);
  const ratingStatement = database.prepare(
    `SELECT
       player_id AS playerId,
       game_id AS gameId,
       season_id AS seasonId,
       pool_id AS poolId,
       mode,
       region,
       rating_value AS value,
       version
     FROM flarelobby_ratings
     WHERE game_id = ? AND season_id = ? AND pool_id = ?
       AND mode = ? AND region = ?
       AND player_id IN (${playerIds.map(() => "?").join(", ")})`,
  );

  try {
    const results = await database.batch([
      seasonStatement,
      ratingStatement.bind(
        pool.gameId,
        pool.seasonId,
        pool.id,
        pool.mode,
        pool.region,
        ...playerIds,
      ),
    ]);
    const season = toSeasonRow(firstResultRow(results[0]));
    const ratings = (results[1]?.results ?? [])
      .map((row) => toRatingRow(asRecord(row)))
      .filter((row): row is RatingRow => row !== null);

    if (season === null || ratings.length !== playerIds.length) {
      return [season, null];
    }

    return [season, ratings];
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

function requireRatingRow(row: RatingRow | undefined): RatingRow {
  if (row === undefined) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
  return row;
}

async function findExistingTeamMatch(
  database: D1Database,
  matchId: string,
  resultId: string,
): Promise<TeamMatchRow | null> {
  try {
    const matchStatement = database
      .prepare(`${TEAM_MATCH_SELECT} WHERE match_id = ?`)
      .bind(matchId);
    const resultStatement = database
      .prepare(`${TEAM_MATCH_SELECT} WHERE result_id = ?`)
      .bind(resultId);
    const results = await database.batch([matchStatement, resultStatement]);
    return (
      toTeamMatchRow(firstResultRow(results[0])) ??
      toTeamMatchRow(firstResultRow(results[1]))
    );
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

async function resolveExistingTeamMatch(
  existing: TeamMatchRow,
  pool: MatchmakingPool,
  input: TeamMatchResultRegistrationInput,
  database: D1Database,
): Promise<TeamMatchResultRegistration> {
  if (
    existing.matchId !== input.matchId ||
    existing.resultId !== input.resultId ||
    existing.gameId !== pool.gameId ||
    existing.seasonId !== pool.seasonId ||
    existing.poolId !== pool.id ||
    existing.mode !== pool.mode ||
    existing.region !== pool.region ||
    existing.teamAId !== input.teamAId ||
    existing.teamBId !== input.teamBId ||
    existing.result !== input.result
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "同じ試合または結果識別子へ異なる結果を適用できません。",
    });
  }

  const record = await readTeamMatchRecord(database, existing.matchId);
  if (record === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return Object.freeze({ match: record, applied: false });
}

async function readTeamMatchRecord(
  database: D1Database,
  matchId: string,
): Promise<TeamRatingMatchRecord | null> {
  try {
    const match = await database
      .prepare(`${TEAM_MATCH_SELECT} WHERE match_id = ?`)
      .bind(matchId)
      .first<Record<string, unknown>>();

    if (match === null) {
      return null;
    }

    const participants = await database
      .prepare(
        `${TEAM_PARTICIPANT_SELECT}
         WHERE match_id = ?
         ORDER BY slot ASC, player_id ASC`,
      )
      .bind(matchId)
      .all<Record<string, unknown>>();

    return toTeamMatchRecord(
      requireTeamMatchRow(toTeamMatchRow(match)),
      participants.results.map((row) =>
        requireTeamParticipantRow(toTeamParticipantRow(row)),
      ),
    );
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

const TEAM_MATCH_SELECT = `SELECT
  match_id AS matchId,
  result_id AS resultId,
  game_id AS gameId,
  season_id AS seasonId,
  pool_id AS poolId,
  mode,
  region,
  team_a_id AS teamAId,
  team_b_id AS teamBId,
  result,
  created_at AS createdAt,
  applied_at AS appliedAt
FROM flarelobby_team_rating_matches`;

const TEAM_PARTICIPANT_SELECT = `SELECT
  match_id AS matchId,
  slot,
  player_id AS playerId,
  team_id AS teamId,
  score,
  rating_before AS ratingBefore,
  delta,
  rating_after AS ratingAfter,
  version_before AS versionBefore,
  version_after AS versionAfter
FROM flarelobby_team_rating_match_participants`;

interface TeamMatchRow {
  readonly matchId: string;
  readonly resultId: string;
  readonly gameId: string;
  readonly seasonId: string;
  readonly poolId: string;
  readonly mode: string;
  readonly region: string;
  readonly teamAId: string;
  readonly teamBId: string;
  readonly result: RatingResult;
  readonly createdAt: number;
  readonly appliedAt: number;
}

interface TeamParticipantRow {
  readonly matchId: string;
  readonly slot: "A" | "B";
  readonly playerId: string;
  readonly teamId: string;
  readonly score: RatingResult;
  readonly ratingBefore: number;
  readonly delta: number;
  readonly ratingAfter: number;
  readonly versionBefore: number;
  readonly versionAfter: number;
}

function toTeamMatchRow(
  row: Record<string, unknown> | null,
): TeamMatchRow | null {
  if (
    row === null ||
    !isNonEmptyString(row["matchId"]) ||
    !isNonEmptyString(row["resultId"]) ||
    !isNonEmptyString(row["gameId"]) ||
    !isNonEmptyString(row["seasonId"]) ||
    !isNonEmptyString(row["poolId"]) ||
    !isNonEmptyString(row["mode"]) ||
    !isNonEmptyString(row["region"]) ||
    !isNonEmptyString(row["teamAId"]) ||
    !isNonEmptyString(row["teamBId"]) ||
    !isRatingResult(row["result"]) ||
    !isSafeInteger(row["createdAt"]) ||
    !isSafeInteger(row["appliedAt"])
  ) {
    return null;
  }

  return {
    matchId: row["matchId"],
    resultId: row["resultId"],
    gameId: row["gameId"],
    seasonId: row["seasonId"],
    poolId: row["poolId"],
    mode: row["mode"],
    region: row["region"],
    teamAId: row["teamAId"],
    teamBId: row["teamBId"],
    result: row["result"],
    createdAt: row["createdAt"],
    appliedAt: row["appliedAt"],
  };
}

function toTeamParticipantRow(
  row: Record<string, unknown> | null,
): TeamParticipantRow | null {
  if (
    row === null ||
    !isNonEmptyString(row["matchId"]) ||
    (row["slot"] !== "A" && row["slot"] !== "B") ||
    !isNonEmptyString(row["playerId"]) ||
    !isNonEmptyString(row["teamId"]) ||
    !isRatingResult(row["score"]) ||
    !isFiniteNumber(row["ratingBefore"]) ||
    !isSafeIntegerValue(row["delta"]) ||
    !isFiniteNumber(row["ratingAfter"]) ||
    !isSafeInteger(row["versionBefore"]) ||
    !isSafeInteger(row["versionAfter"])
  ) {
    return null;
  }

  return {
    matchId: row["matchId"],
    slot: row["slot"],
    playerId: row["playerId"],
    teamId: row["teamId"],
    score: row["score"],
    ratingBefore: row["ratingBefore"],
    delta: row["delta"],
    ratingAfter: row["ratingAfter"],
    versionBefore: row["versionBefore"],
    versionAfter: row["versionAfter"],
  };
}

function toTeamMatchRecord(
  row: TeamMatchRow,
  participantRows: readonly TeamParticipantRow[],
): TeamRatingMatchRecord {
  return Object.freeze({
    matchId: row.matchId,
    resultId: row.resultId,
    pool: Object.freeze({
      id: row.poolId,
      gameId: row.gameId,
      seasonId: row.seasonId,
      mode: row.mode,
      region: row.region,
    }),
    result: row.result,
    teamIds: Object.freeze([row.teamAId, row.teamBId]) as readonly [
      string,
      string,
    ],
    participants: Object.freeze(participantRows.map(toTeamParticipantRecord)),
    createdAt: new Date(row.createdAt).toISOString(),
    appliedAt: new Date(row.appliedAt).toISOString(),
  });
}

function toTeamParticipantRecord(
  row: TeamParticipantRow,
): TeamRatingMatchParticipant {
  return Object.freeze({
    slot: row.slot,
    playerId: row.playerId,
    teamId: row.teamId,
    score: row.score,
    ratingBefore: row.ratingBefore,
    delta: row.delta,
    ratingAfter: row.ratingAfter,
    versionBefore: row.versionBefore,
    versionAfter: row.versionAfter,
  });
}

function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/** ELO の丸め規則と同じ「0.5 はゼロから遠い方向」で整数化します。 */
function roundHalfAwayFromZero(rawDelta: number): number {
  const rounded =
    rawDelta < 0 ? Math.ceil(rawDelta - 0.5) : Math.floor(rawDelta + 0.5);

  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError("ELO の更新差分が安全な整数になりません。");
  }

  return Object.is(rounded, -0) ? 0 : rounded;
}

function toRatingResult(value: number): RatingResult {
  if (!isRatingResult(value)) {
    throw new Error("ELO の内部計算結果が不正です。");
  }

  return value;
}

function requireTeamMatchRow(row: TeamMatchRow | null): TeamMatchRow {
  if (row === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
  return row;
}

function requireTeamParticipantRow(
  row: TeamParticipantRow | null,
): TeamParticipantRow {
  if (row === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
  return row;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSafeIntegerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

async function ensureRatingRows(
  database: D1Database,
  pool: MatchmakingPool,
  playerAId: string,
  playerBId: string,
  configuration: NormalizedRatingConfiguration,
): Promise<void> {
  const now = Date.now();

  try {
    await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO flarelobby_rating_seasons (
             game_id, season_id, pool_id, initial_rating, k_factor,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          pool.gameId,
          pool.seasonId,
          pool.id,
          configuration.initialRating,
          configuration.kFactor,
          now,
          now,
        ),
      createRatingInsert(database, pool, playerAId, configuration, now),
      createRatingInsert(database, pool, playerBId, configuration, now),
    ]);
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

function createRatingInsert(
  database: D1Database,
  pool: MatchmakingPool,
  playerId: string,
  configuration: NormalizedRatingConfiguration,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO flarelobby_ratings (
         player_id, game_id, season_id, pool_id, mode, region,
         rating_value, version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      playerId,
      pool.gameId,
      pool.seasonId,
      pool.id,
      pool.mode,
      pool.region,
      configuration.initialRating,
      now,
      now,
    );
}

async function readRatingState(
  database: D1Database,
  pool: MatchmakingPool,
  playerAId: string,
  playerBId: string,
): Promise<readonly [SeasonRow | null, RatingRow | null, RatingRow | null]> {
  const seasonStatement = database
    .prepare(
      `SELECT
         game_id AS gameId,
         season_id AS seasonId,
         pool_id AS poolId,
         initial_rating AS initialRating,
         k_factor AS kFactor
       FROM flarelobby_rating_seasons
       WHERE game_id = ? AND season_id = ? AND pool_id = ?`,
    )
    .bind(pool.gameId, pool.seasonId, pool.id);
  const ratingStatement = database.prepare(
    `SELECT
       player_id AS playerId,
       game_id AS gameId,
       season_id AS seasonId,
       pool_id AS poolId,
       mode,
       region,
       rating_value AS value,
       version
     FROM flarelobby_ratings
     WHERE player_id = ? AND game_id = ? AND season_id = ?
       AND pool_id = ? AND mode = ? AND region = ?`,
  );

  try {
    const results = await database.batch([
      seasonStatement,
      ratingStatement.bind(
        playerAId,
        pool.gameId,
        pool.seasonId,
        pool.id,
        pool.mode,
        pool.region,
      ),
      ratingStatement.bind(
        playerBId,
        pool.gameId,
        pool.seasonId,
        pool.id,
        pool.mode,
        pool.region,
      ),
    ]);

    return [
      toSeasonRow(firstResultRow(results[0])),
      toRatingRow(firstResultRow(results[1])),
      toRatingRow(firstResultRow(results[2])),
    ];
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

async function readRatingRow(
  database: D1Database,
  pool: MatchmakingPool,
  playerId: string,
): Promise<RatingRow | null> {
  try {
    return await database
      .prepare(
        `SELECT
           player_id AS playerId,
           game_id AS gameId,
           season_id AS seasonId,
           pool_id AS poolId,
           mode,
           region,
           rating_value AS value,
           version
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
      .first<RatingRow>();
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

async function findExistingMatch(
  database: D1Database,
  matchId: string,
  resultId: string,
): Promise<MatchRow | null> {
  try {
    const matchStatement = database
      .prepare(`${MATCH_SELECT} WHERE match_id = ?`)
      .bind(matchId);
    const resultStatement = database
      .prepare(`${MATCH_SELECT} WHERE result_id = ?`)
      .bind(resultId);
    const results = await database.batch([matchStatement, resultStatement]);
    return (
      toMatchRow(firstResultRow(results[0])) ??
      toMatchRow(firstResultRow(results[1]))
    );
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

async function resolveExistingMatch(
  existing: MatchRow,
  pool: MatchmakingPool,
  input: MatchResultRegistrationInput,
  database: D1Database,
): Promise<MatchResultRegistration> {
  if (
    existing.matchId !== input.matchId ||
    existing.resultId !== input.resultId ||
    existing.gameId !== pool.gameId ||
    existing.seasonId !== pool.seasonId ||
    existing.poolId !== pool.id ||
    existing.mode !== pool.mode ||
    existing.region !== pool.region ||
    existing.playerAId !== input.playerAId ||
    existing.playerBId !== input.playerBId ||
    existing.result !== input.result
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "同じ試合または結果識別子へ異なる結果を適用できません。",
    });
  }

  const record = await readMatchRecord(database, existing.matchId);
  if (record === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return Object.freeze({ match: record, applied: false });
}

async function readMatchRecord(
  database: D1Database,
  matchId: string,
): Promise<RatingMatchRecord | null> {
  try {
    const match = await database
      .prepare(`${MATCH_SELECT} WHERE match_id = ?`)
      .bind(matchId)
      .first<MatchRow>();

    if (match === null) {
      return null;
    }

    const participants = await database
      .prepare(
        `${PARTICIPANT_SELECT}
         WHERE match_id = ?
         ORDER BY slot ASC`,
      )
      .bind(matchId)
      .all<ParticipantRow>();

    return toMatchRecord(match, participants.results);
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

async function readMatchRecords(
  database: D1Database,
  matches: readonly MatchRow[],
): Promise<readonly RatingMatchRecord[]> {
  if (matches.length === 0) {
    return [];
  }

  const placeholders = matches.map(() => "?").join(", ");
  try {
    const participants = await database
      .prepare(
        `${PARTICIPANT_SELECT}
         WHERE match_id IN (${placeholders})
         ORDER BY match_id ASC, slot ASC`,
      )
      .bind(...matches.map((match) => match.matchId))
      .all<ParticipantRow>();
    const byMatch = new Map<string, ParticipantRow[]>();

    for (const participant of participants.results) {
      const rows = byMatch.get(participant.matchId) ?? [];
      rows.push(participant);
      byMatch.set(participant.matchId, rows);
    }

    return matches.map((match) =>
      toMatchRecord(match, byMatch.get(match.matchId) ?? []),
    );
  } catch (error) {
    throw normalizeRatingError(error);
  }
}

const MATCH_SELECT = `SELECT
  match_id AS matchId,
  result_id AS resultId,
  game_id AS gameId,
  season_id AS seasonId,
  pool_id AS poolId,
  mode,
  region,
  player_a_id AS playerAId,
  player_b_id AS playerBId,
  result,
  rating_a_before AS ratingABefore,
  rating_b_before AS ratingBBefore,
  delta_a AS deltaA,
  delta_b AS deltaB,
  rating_a_after AS ratingAAfter,
  rating_b_after AS ratingBAfter,
  created_at AS createdAt,
  applied_at AS appliedAt
FROM flarelobby_rating_matches`;

const PARTICIPANT_SELECT = `SELECT
  match_id AS matchId,
  slot,
  player_id AS playerId,
  score,
  rating_before AS ratingBefore,
  delta,
  rating_after AS ratingAfter,
  version_before AS versionBefore,
  version_after AS versionAfter
FROM flarelobby_rating_match_participants`;

function toRating(row: RatingRow): Rating {
  return Object.freeze({
    playerId: row.playerId,
    poolId: row.poolId,
    value: row.value,
  });
}

function toMatchRecord(
  row: MatchRow,
  participantRows: readonly ParticipantRow[],
): RatingMatchRecord {
  const participants = participantRows
    .slice()
    .sort((left, right) => left.slot.localeCompare(right.slot));

  if (
    participants.length !== 2 ||
    participants[0]?.slot !== "A" ||
    participants[1]?.slot !== "B"
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return Object.freeze({
    matchId: row.matchId,
    resultId: row.resultId,
    pool: Object.freeze({
      id: row.poolId,
      gameId: row.gameId,
      seasonId: row.seasonId,
      mode: row.mode,
      region: row.region,
    }),
    result: row.result,
    participants: Object.freeze([
      toParticipantRecord(participants[0]),
      toParticipantRecord(participants[1]),
    ]) as readonly [RatingMatchParticipant, RatingMatchParticipant],
    createdAt: new Date(row.createdAt).toISOString(),
    appliedAt: new Date(row.appliedAt).toISOString(),
  });
}

function toParticipantRecord(row: ParticipantRow): RatingMatchParticipant {
  return Object.freeze({
    slot: row.slot,
    playerId: row.playerId,
    score: row.score,
    ratingBefore: row.ratingBefore,
    delta: row.delta,
    ratingAfter: row.ratingAfter,
    versionBefore: row.versionBefore,
    versionAfter: row.versionAfter,
  });
}

function toSeasonRow(row: Record<string, unknown> | null): SeasonRow | null {
  if (
    row === null ||
    !isNonEmptyString(row["gameId"]) ||
    !isNonEmptyString(row["seasonId"]) ||
    !isNonEmptyString(row["poolId"]) ||
    !isFiniteNumber(row["initialRating"]) ||
    !isFiniteNumber(row["kFactor"])
  ) {
    return null;
  }

  return {
    gameId: row["gameId"],
    seasonId: row["seasonId"],
    poolId: row["poolId"],
    initialRating: row["initialRating"],
    kFactor: row["kFactor"],
  };
}

function toRatingRow(row: Record<string, unknown> | null): RatingRow | null {
  if (
    row === null ||
    !isNonEmptyString(row["playerId"]) ||
    !isNonEmptyString(row["gameId"]) ||
    !isNonEmptyString(row["seasonId"]) ||
    !isNonEmptyString(row["poolId"]) ||
    !isNonEmptyString(row["mode"]) ||
    !isNonEmptyString(row["region"]) ||
    !isFiniteNumber(row["value"]) ||
    !isNonNegativeSafeInteger(row["version"])
  ) {
    return null;
  }

  return {
    playerId: row["playerId"],
    gameId: row["gameId"],
    seasonId: row["seasonId"],
    poolId: row["poolId"],
    mode: row["mode"],
    region: row["region"],
    value: row["value"],
    version: row["version"],
  };
}

function toMatchRow(row: Record<string, unknown> | null): MatchRow | null {
  if (
    row === null ||
    !isNonEmptyString(row["matchId"]) ||
    !isNonEmptyString(row["resultId"]) ||
    !isNonEmptyString(row["gameId"]) ||
    !isNonEmptyString(row["seasonId"]) ||
    !isNonEmptyString(row["poolId"]) ||
    !isNonEmptyString(row["mode"]) ||
    !isNonEmptyString(row["region"]) ||
    !isNonEmptyString(row["playerAId"]) ||
    !isNonEmptyString(row["playerBId"]) ||
    !isRatingResult(row["result"]) ||
    !isFiniteNumber(row["ratingABefore"]) ||
    !isFiniteNumber(row["ratingBBefore"]) ||
    !isSafeIntegerValue(row["deltaA"]) ||
    !isSafeIntegerValue(row["deltaB"]) ||
    !isFiniteNumber(row["ratingAAfter"]) ||
    !isFiniteNumber(row["ratingBAfter"]) ||
    !isNonNegativeSafeInteger(row["createdAt"]) ||
    !isNonNegativeSafeInteger(row["appliedAt"])
  ) {
    return null;
  }

  return {
    matchId: row["matchId"],
    resultId: row["resultId"],
    gameId: row["gameId"],
    seasonId: row["seasonId"],
    poolId: row["poolId"],
    mode: row["mode"],
    region: row["region"],
    playerAId: row["playerAId"],
    playerBId: row["playerBId"],
    result: row["result"],
    ratingABefore: row["ratingABefore"],
    ratingBBefore: row["ratingBBefore"],
    deltaA: row["deltaA"],
    deltaB: row["deltaB"],
    ratingAAfter: row["ratingAAfter"],
    ratingBAfter: row["ratingBAfter"],
    createdAt: row["createdAt"],
    appliedAt: row["appliedAt"],
  };
}

interface NormalizedRatingConfiguration {
  readonly initialRating: number;
  readonly kFactor: number;
}

function normalizeRatingConfiguration(
  configuration: RatingConfiguration,
): NormalizedRatingConfiguration {
  const engine = elo(configuration);
  return Object.freeze({
    initialRating: engine.initialRating,
    kFactor: engine.kFactor,
  });
}

function normalizeMatchResultInput(
  input: MatchResultRegistrationInput,
): MatchResultRegistrationInput {
  if (!isRecord(input)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const resultId = normalizeIdentifier(input.resultId, "resultId");
  const matchId = normalizeIdentifier(input.matchId, "matchId");
  const playerAId = normalizeIdentifier(input.playerAId, "playerAId");
  const playerBId = normalizeIdentifier(input.playerBId, "playerBId");

  if (!isRatingResult(input.result)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return Object.freeze({
    resultId,
    matchId,
    playerAId,
    playerBId,
    result: input.result,
  });
}

function normalizePool(pool: MatchmakingPool): MatchmakingPool {
  if (!isRecord(pool)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const fields = ["id", "gameId", "seasonId", "mode", "region"] as const;
  if (!fields.every((field) => isNonEmptyString(pool[field]))) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return Object.freeze({
    id: pool.id,
    gameId: pool.gameId,
    seasonId: pool.seasonId,
    mode: pool.mode,
    region: pool.region,
  });
}

function normalizeIdentifier(value: unknown, _fieldName: string): string {
  if (!isNonEmptyString(value) || value.length > 512) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value;
}

function normalizeRetryCount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 8
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value as number;
}

function normalizeHistoryLimit(value: unknown): number {
  const limit = value ?? DEFAULT_MATCH_HISTORY_PAGE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > MAX_MATCH_HISTORY_PAGE_SIZE
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return limit as number;
}

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

function parseHistoryCursor(value: unknown): HistoryCursor {
  if (!isNonEmptyString(value) || value.length > 1_024) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (
      !isRecord(parsed) ||
      !isSafeInteger(parsed["appliedAt"]) ||
      !isNonEmptyString(parsed["matchId"])
    ) {
      throw new Error("invalid cursor");
    }

    return Object.freeze({
      appliedAt: parsed["appliedAt"],
      matchId: parsed["matchId"],
    });
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
}

function firstResultRow(
  result: D1Result<unknown> | undefined,
): Record<string, unknown> | null {
  const row = result?.results[0];
  return isRecord(row) ? row : null;
}

function resultChanges(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

function normalizeRatingError(error: unknown): FlareLobbyError {
  return error instanceof FlareLobbyError
    ? error
    : new FlareLobbyError("CONNECTION_FAILED");
}

function isRatingResult(value: unknown): value is RatingResult {
  return value === 0 || value === 0.5 || value === 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value);
}
