import { DurableObject } from "cloudflare:workers";
import {
  FlareLobbyError,
  PROTOCOL_VERSION,
  getMatchmakingSearchWidth,
  getNextMatchmakingSearchAt,
  isFlareLobbyErrorCode,
  normalizeMatchmakingSearchPolicy,
  selectMatchCandidates
} from "@flarelobby/core";
import type {
  FlareLobbyErrorCode,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MatchRoom,
  MatchmakingCandidateEvaluation,
  MatchCandidate,
  MatchmakingPool,
  MatchmakingSearchPolicy,
  MatchmakingSearchTicket,
  MatchmakingTicketStatus,
  NormalizedMatchmakingSearchPolicy,
  Participant,
  Principal,
  Rating,
  RoomSnapshot,
  Team,
  Timestamp
} from "@flarelobby/core";

import { createErrorResponse, verifyGatewayPrincipalEnvelope } from "./security.js";
import type { GatewayPrincipalEnvelope } from "./security.js";
import type { RoomInitializationOptions } from "./room.js";
import {
  createObservabilityContext,
  createObservabilitySink,
  observeOperation,
  recordQualityMetric
} from "./observability.js";
import type { FlareLobbyObservabilityContext } from "./observability.js";

/** チケットの既定の待機期限です。設定がない場合は 1 分後に期限切れにします。 */
export const DEFAULT_MATCHMAKING_TICKET_TTL_MS = 60_000;

/** 成立処理の一時的な RPC 失敗に対する初回再試行待ち時間です。 */
export const DEFAULT_MATCHMAKING_MATCH_RETRY_DELAY_MS = 1_000;

/** 成立処理の再試行待ち時間の上限です。 */
export const DEFAULT_MATCHMAKING_MATCH_MAX_RETRY_DELAY_MS = 60_000;

/** 回復不能な成立失敗と判定する最大試行回数です。 */
export const DEFAULT_MATCHMAKING_MATCH_MAX_ATTEMPTS = 8;

/** 1 対 1 対戦ルームへ割り当てる既定チームです。 */
export const DEFAULT_MATCHMAKING_MATCH_TEAM_IDS = Object.freeze([
  "blue",
  "red"
] as const);

/** Match Pool の決定的な識別子に使う区切り文字です。 */
export const MATCHMAKING_POOL_KEY_SEPARATOR = ":";

/** `MatchmakingPool` のうち決定的な識別子を構成する項目です。 */
export type MatchmakingPoolKeyInput = Pick<
  MatchmakingPool,
  "gameId" | "seasonId" | "mode" | "region"
>;

/** Match Pool の `getByName()` へ渡す決定的な識別子を作ります。 */
export function createMatchmakingPoolKey(
  pool: MatchmakingPoolKeyInput
): string {
  if (!isRecord(pool)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const fields = [pool.gameId, pool.seasonId, pool.mode, pool.region];

  if (!fields.every(isNonEmptyString)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return fields.map((field) => encodeURIComponent(field)).join(
    MATCHMAKING_POOL_KEY_SEPARATOR
  );
}

/** 既存コードで意味が明確になる別名です。 */
export const getMatchmakingPoolKey = createMatchmakingPoolKey;
export const createMatchPoolKey = createMatchmakingPoolKey;
export const getMatchPoolName = createMatchmakingPoolKey;

/** 候補 ID から再試行で変わらない `matchId` を作ります。 */
export function createMatchmakingMatchId(candidateId: string): string {
  if (!isNonEmptyString(candidateId) || candidateId.length > 2_048) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return `match_${candidateId}`;
}

/** `matchId` から再試行で変わらない対戦 Room ID を作ります。 */
export function createMatchmakingRoomId(matchId: string): string {
  if (!isNonEmptyString(matchId) || matchId.length > 2_048) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return `room_${matchId}`;
}

/** Match Pool Durable Object を初期化する入力です。 */
export interface MatchPoolInitializationOptions {
  readonly pool: MatchmakingPool;
  /** 省略時は 75 → 150 → 400 の既定検索幅を使用します。 */
  readonly searchPolicy?: MatchmakingSearchPolicy;
  /** 成立時に生成する対戦ルームの初期設定です。 */
  readonly matchRoom?: MatchmakingMatchRoomOptions;
  /** Gateway から引き継ぐ観測相関情報です。永続化しません。 */
  readonly observability?: FlareLobbyObservabilityContext;
}

/** RPC 境界で使う、JSON 直列化可能な対戦ルーム情報です。 */
export type MatchmakingAttributeObject = Readonly<
  Record<string, JsonPrimitive>
>;

/** 成立時に生成する対戦ルームの初期設定です。 */
export interface MatchmakingMatchRoomOptions {
  readonly settings?: JsonObject;
  readonly metadata?: JsonObject;
  /** 2 件のプレイヤーへ順番に割り当てるチーム識別子です。 */
  readonly teamIds?: readonly string[];
  /** `teamIds` の説明的な別名です。 */
  readonly teams?: readonly string[];
  readonly maxPlayers?: number;
  readonly minimumPlayers?: number;
  readonly requireAllPlayersReady?: boolean;
  /** 回復不能と判定するまでの成立 RPC 試行回数です。 */
  readonly maxAttempts?: number;
}

/** RPC 境界で使う、JSON 直列化可能な対戦ルーム情報です。 */
export interface MatchmakingMatchRoomRecord {
  readonly id: string;
  readonly kind: "match";
  readonly matchId: string;
  readonly pool: MatchmakingPool;
  readonly settings: MatchmakingAttributeObject;
  readonly metadata: MatchmakingAttributeObject;
}

/** RPC 境界で使う、JSON 直列化可能な成立結果です。 */
export interface MatchmakingMatchResult {
  readonly matchId: string;
  readonly candidate: MatchCandidate;
  readonly room: MatchmakingMatchRoomRecord;
  readonly createdAt: Timestamp;
}

/** 成立意図の永続状態です。 */
export type MatchmakingMatchIntentStatus =
  | "pending"
  | "initializing"
  | "matched"
  | "failed";

/** 成立意図と Room 初期化の再試行状態です。 */
export interface MatchmakingMatchIntent {
  readonly matchId: string;
  readonly candidate: MatchCandidate;
  readonly room: MatchmakingMatchRoomRecord;
  readonly status: MatchmakingMatchIntentStatus;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: number | null;
  readonly lastErrorCode: FlareLobbyErrorCode | null;
  readonly result: MatchmakingMatchResult | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly completedAt: Timestamp | null;
}

/** 成立処理を明示的に進めるときの入力です。 */
export interface MatchmakingMatchProcessingOptions {
  readonly now?: number;
  readonly maxMatches?: number;
  readonly observability?: FlareLobbyObservabilityContext;
}

interface MatchmakingTicketRecordBase {
  readonly id: string;
  readonly pool: MatchmakingPool;
  readonly player: { readonly id: string };
  readonly rating: Rating;
  readonly createdAt: Timestamp;
  /** 作成要求時に保存したリージョンです。Pool のリージョンと一致します。 */
  readonly region: string;
  /** クライアントが選択した入力方式です。 */
  readonly inputMethod: string;
  /** 候補探索が利用する JSON 検索属性です。 */
  readonly searchAttributes: MatchmakingAttributeObject;
  /** 利用者向けの ISO 8601 期限です。 */
  readonly expiresAt: Timestamp;
  /** Alarm と比較する Unix epoch milliseconds です。 */
  readonly expiresAtMs: number;
}

/** SQLite から復元した、検索属性と期限を含む JSON 直列化可能なチケットです。 */
export type MatchmakingTicketRecord =
  | (MatchmakingTicketRecordBase & { readonly status: "creating" })
  | (MatchmakingTicketRecordBase & {
      readonly status: "waiting";
      readonly queuedAt: Timestamp;
    })
  | (MatchmakingTicketRecordBase & {
      readonly status: "reserved";
      readonly candidate: MatchCandidate;
      readonly reservedAt: Timestamp;
    })
  | (MatchmakingTicketRecordBase & {
      readonly status: "matched";
      readonly result: MatchmakingMatchResult;
      readonly matchedAt: Timestamp;
    })
  | (MatchmakingTicketRecordBase & {
      readonly status: "cancelled";
      readonly cancelledAt: Timestamp;
    })
  | (MatchmakingTicketRecordBase & {
      readonly status: "expired";
      readonly expiredAt: Timestamp;
    });

/** マッチングチケットを作成する入力です。 */
export interface MatchmakingTicketCreationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly requestId: string;
  /** 数値、または `Rating` 形式の `{ value }` です。主体と Pool はサーバー側で補います。 */
  readonly rating: number | Partial<Rating>;
  /** 省略時は初期化済み Pool のリージョンを保存します。 */
  readonly region?: string;
  /** 省略時は `unknown` を保存します。 */
  readonly inputMethod?: string;
  /** `inputMethod` の説明的な別名です。 */
  readonly inputMode?: string;
  readonly searchAttributes?: JsonObject;
  /** Unix epoch milliseconds または ISO 8601 形式です。 */
  readonly expiresAt?: number | Timestamp;
  /** `expiresAt` を省略した場合に利用する待機時間です。 */
  readonly ttlMs?: number;
  /** 指定時は DO が初期化済みの Pool と一致することを検証します。 */
  readonly pool?: MatchmakingPool;
  /** クライアント申告値は認証主体と一致する場合だけ受け付けます。 */
  readonly playerId?: string;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** チケットのキャンセルを要求する入力です。 */
export interface MatchmakingTicketCancellationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly ticketId: string;
  readonly requestId?: string;
  readonly requestPayload?: JsonValue;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** 候補確保の入力です。候補探索そのものは本 Issue の対象外です。 */
export interface MatchmakingTicketReservationOptions {
  readonly candidate: MatchCandidate;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** 成立処理の入力です。対戦ルーム生成は呼び出し側が行い結果を渡します。 */
export interface MatchmakingTicketMatchOptions {
  readonly result: MatchmakingMatchResult;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** チケットイベントを取得する入力です。 */
export interface MatchmakingTicketEventQueryOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly ticketId: string;
  readonly afterSequence?: number;
}

/** 待機状態と候補探索の進捗を通知する永続イベントです。 */
export interface MatchmakingTicketEvent {
  readonly sequence: number;
  readonly poolRevision: number;
  readonly type: MatchmakingTicketStatus;
  readonly ticketId: string;
  readonly ticket: MatchmakingTicketRecord;
  readonly waitingCount: number;
  readonly activeCount: number;
  /** イベント発生時点でチケットへ適用される検索幅です。 */
  readonly searchWidth: number;
  readonly occurredAt: Timestamp;
}

/** Match Pool の現在の待機状況です。 */
export interface MatchPoolSnapshot {
  readonly pool: MatchmakingPool;
  readonly searchPolicy: NormalizedMatchmakingSearchPolicy;
  readonly revision: number;
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly ticketCount: number;
}

/** Match Pool の候補探索を診断・テストする入力です。 */
export interface MatchmakingSearchOptions {
  /** 省略時は Durable Object の現在時刻を使用します。 */
  readonly now?: number | Timestamp;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** 候補探索の評価結果です。`searchCandidates()` は状態を変更しません。 */
export interface MatchmakingSearchResult {
  readonly pool: MatchmakingPool;
  readonly searchPolicy: NormalizedMatchmakingSearchPolicy;
  readonly searchedAt: Timestamp;
  readonly candidates: readonly MatchmakingCandidateEvaluation[];
  readonly inspectedTicketCount: number;
  readonly nextSearchAt: Timestamp | null;
}

interface SchemaMigrationRow extends Record<string, SqlStorageValue> {
  version: number;
}

interface PoolRow extends Record<string, SqlStorageValue> {
  poolId: string;
  poolKey: string;
  gameId: string;
  seasonId: string;
  mode: string;
  region: string;
  searchPolicyJson: string;
  matchRoomJson: string;
  revision: number;
}

interface TicketRow extends Record<string, SqlStorageValue> {
  ticketId: string;
  poolId: string;
  playerId: string;
  ratingValue: number;
  createdAt: string;
  queuedAt: string | null;
  region: string;
  inputMethod: string;
  searchAttributesJson: string;
  status: MatchmakingTicketStatus;
  expiresAtMs: number;
  reservedCandidateJson: string | null;
  reservedAt: string | null;
  matchResultJson: string | null;
  matchedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
}

interface ProcessedCommandRow extends Record<string, SqlStorageValue> {
  requestId: string;
  command: string;
  playerId: string;
  payloadJson: string;
  resultJson: string;
  createdAt: number;
}

interface EventRow extends Record<string, SqlStorageValue> {
  sequence: number;
  poolRevision: number;
  ticketId: string;
  type: MatchmakingTicketStatus;
  ticketJson: string;
  waitingCount: number;
  activeCount: number;
  occurredAt: string;
}

interface MatchIntentRow extends Record<string, SqlStorageValue> {
  matchId: string;
  candidateId: string;
  poolId: string;
  roomId: string;
  candidateJson: string;
  initializationJson: string;
  status: MatchmakingMatchIntentStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number | null;
  lastErrorCode: FlareLobbyErrorCode | null;
  resultJson: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface ProgressRow extends Record<string, SqlStorageValue> {
  waitingCount: number;
  activeCount: number;
  ticketCount: number;
}

interface NormalizedCreation {
  readonly requestId: string;
  readonly requestPayloadJson: string;
  readonly ratingValue: number;
  readonly region: string;
  readonly inputMethod: string;
  readonly searchAttributesJson: string;
  readonly expiresAtMs: number;
  readonly createdAtMs: number;
}

interface NormalizedMatchRoomOptions {
  readonly settingsJson: string;
  readonly metadataJson: string;
  readonly teamIds: readonly string[];
  readonly maxPlayers: number;
  readonly minimumPlayers: number;
  readonly requireAllPlayersReady: boolean;
  readonly maxAttempts: number;
}

interface MatchRoomGatewayStub {
  initialize(options: RoomInitializationOptions): Promise<RoomSnapshot>;
  getSnapshot(): Promise<RoomSnapshot | null>;
}

interface InFlightCreateRequest {
  readonly playerId: string;
  readonly payloadJson: string;
  readonly promise: Promise<MatchmakingTicketRecord>;
}

interface NormalizedCancellation {
  readonly ticketId: string;
  readonly requestId: string | null;
  readonly requestPayloadJson: string;
}

/**
 * 1 マッチングプールを 1 Durable Object として扱う SQLite-backed Durable Object です。
 *
 * 候補評価は純粋関数へ委譲し、候補探索の起動、確保、成立意図、対戦 Room の
 * 初期化、チケットの状態遷移、冪等性、期限処理、状態通知を強整合に管理します。
 */
export class MatchPoolDurableObject extends DurableObject<Env> {
  private readonly inFlightCreateRequests = new Map<
    string,
    InFlightCreateRequest
  >();

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.blockConcurrencyWhile(async () => {
      migrateMatchPoolSchema(this.ctx.storage.sql);
    });
  }

  /** Gateway の署名済み主体だけを受け入れます。 */
  public async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope
  ): Promise<Principal | null> {
    return verifyGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      gatewayPrincipal
    );
  }

  /** Pool の識別情報を一度だけ保存します。 */
  public async initialize(
    input: MatchPoolInitializationOptions | MatchmakingPool
  ): Promise<MatchmakingPool> {
    const context =
      "observability" in input && input.observability !== undefined
        ? input.observability
        : createObservabilityContext(undefined);
    const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);

    return observeOperation(
      sink,
      context,
      "matchmaking.pool.initialize",
      async () => {
        const normalized = normalizePoolInput(input);
    const existing = this.readPoolRow();

    if (existing !== undefined) {
      if (!samePool(existing, normalized)) {
        throw new FlareLobbyError("CONFLICT", {
          message: "Match Pool Durable Object の識別子が既存状態と一致しません。"
        });
      }

      if (
        normalized.searchPolicyProvided &&
        existing.searchPolicyJson !== normalized.searchPolicyJson
      ) {
        this.ctx.storage.sql.exec(
          `UPDATE flarelobby_matchmaking_pools
           SET search_policy_json = ?, revision = revision + 1
           WHERE singleton_id = 1`,
          normalized.searchPolicyJson
        );
        this.searchAndReserveCandidatesAt(Date.now());
        await this.processPendingMatches({ observability: context });
        await this.synchronizeAlarm();
      }

      if (
        normalized.matchRoomProvided &&
        existing.matchRoomJson !== normalized.matchRoomJson
      ) {
        const pendingIntentCount = this.ctx.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count
             FROM flarelobby_matchmaking_match_intents
             WHERE status IN ('pending', 'initializing')`
          )
          .one().count;

        if (pendingIntentCount > 0) {
          throw new FlareLobbyError("CONFLICT", {
            message: "成立処理中の Match Pool の Room 設定は変更できません。"
          });
        }

        this.ctx.storage.sql.exec(
          `UPDATE flarelobby_matchmaking_pools
           SET match_room_json = ?, revision = revision + 1
           WHERE singleton_id = 1`,
          normalized.matchRoomJson
        );
      }

      return toPool(existing);
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_matchmaking_pools (
        singleton_id,
        pool_id,
        pool_key,
        game_id,
        season_id,
        mode,
        region,
        search_policy_json,
        match_room_json,
        revision,
        created_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      normalized.pool.id,
      normalized.poolKey,
      normalized.pool.gameId,
      normalized.pool.seasonId,
      normalized.pool.mode,
      normalized.pool.region,
      normalized.searchPolicyJson,
      normalized.matchRoomJson,
      Date.now()
    );

    const stored = this.readPoolRow();

    if (stored === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

        return toPool(stored);
      }
    );
  }

  /** `initialize()` の意味を明示する別名です。 */
  public async initializePool(
    input: MatchPoolInitializationOptions | MatchmakingPool
  ): Promise<MatchmakingPool> {
    return this.initialize(input);
  }

  /** 永続化された Pool を返します。 */
  public async getPool(): Promise<MatchmakingPool | null> {
    const pool = this.readPoolRow();
    return pool === undefined ? null : toPool(pool);
  }

  /** 現在の候補探索設定を返します。 */
  public async getSearchPolicy(): Promise<NormalizedMatchmakingSearchPolicy | null> {
    const pool = this.readPoolRow();
    return pool === undefined ? null : parseSearchPolicy(pool.searchPolicyJson);
  }

  /** 候補探索設定を永続化し、変更後の検索を直ちに起動します。 */
  public async configureSearchPolicy(
    searchPolicy: MatchmakingSearchPolicy
  ): Promise<NormalizedMatchmakingSearchPolicy> {
    this.requirePool();
    const normalized = normalizeMatchmakingSearchPolicy(searchPolicy);
    const searchPolicyJson = JSON.stringify(normalized);
    const current = this.readPoolRow();

    if (current === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Match Pool は設定できません。"
      });
    }

    if (current.searchPolicyJson !== searchPolicyJson) {
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_pools
         SET search_policy_json = ?, revision = revision + 1
         WHERE singleton_id = 1`,
        searchPolicyJson
      );
      this.searchAndReserveCandidatesAt(Date.now());
      await this.processPendingMatches();
    }

    await this.synchronizeAlarm();
    return parseSearchPolicy(searchPolicyJson);
  }

  /** `configureSearchPolicy()` の意味を明示する別名です。 */
  public async configureMatchmakingSearch(
    searchPolicy: MatchmakingSearchPolicy
  ): Promise<NormalizedMatchmakingSearchPolicy> {
    return this.configureSearchPolicy(searchPolicy);
  }

  /** 待機数と有効チケット数を返します。 */
  public async getSnapshot(): Promise<MatchPoolSnapshot | null> {
    const pool = this.readPoolRow();

    if (pool === undefined) {
      return null;
    }

    const progress = this.readProgress();

    return deepFreeze({
      pool: toPool(pool),
      searchPolicy: parseSearchPolicy(pool.searchPolicyJson),
      revision: pool.revision,
      waitingCount: progress.waitingCount,
      activeCount: progress.activeCount,
      ticketCount: progress.ticketCount
    });
  }

  /** 待機チケットの候補と品質説明を返します。状態は変更しません。 */
  public async searchCandidates(
    options: MatchmakingSearchOptions = {}
  ): Promise<MatchmakingSearchResult> {
    const result = this.searchCandidatesAt(normalizeSearchNow(options?.now));
    await this.synchronizeAlarm();
    return result;
  }

  /** 候補を決定論的に選び、選択済みチケットを原子的に `reserved` へ進めます。 */
  public async searchAndReserveCandidates(
    options: MatchmakingSearchOptions = {}
  ): Promise<MatchmakingSearchResult> {
    const result = this.searchAndReserveCandidatesAt(
      normalizeSearchNow(options?.now)
    );
    await this.processPendingMatches({
      ...(options?.now === undefined
        ? {}
        : { now: normalizeSearchNow(options.now) }),
      ...(options.observability === undefined
        ? {}
        : { observability: options.observability })
    });
    await this.synchronizeAlarm();
    return result;
  }

  /** `searchCandidates()` の意味を明示する別名です。 */
  public async findCandidates(
    options: MatchmakingSearchOptions = {}
  ): Promise<MatchmakingSearchResult> {
    return this.searchCandidates(options);
  }

  /** `searchAndReserveCandidates()` の意味を明示する別名です。 */
  public async findAndReserveCandidates(
    options: MatchmakingSearchOptions = {}
  ): Promise<MatchmakingSearchResult> {
    return this.searchAndReserveCandidates(options);
  }

  /** 成立意図を取得します。`matchId` または候補 ID を指定できます。 */
  public async getMatchIntent(
    matchIdOrCandidateId:
      | string
      | { readonly matchId?: string; readonly candidateId?: string }
  ): Promise<MatchmakingMatchIntent | null> {
    const identifier = normalizeMatchIntentIdentifier(matchIdOrCandidateId);
    const row =
      identifier.kind === "match"
        ? this.readMatchIntentByMatchId(identifier.value)
        : this.readMatchIntentByCandidateId(identifier.value);
    return row === undefined ? null : this.toMatchIntent(row);
  }

  /** 未完了の成立意図を、Room 初期化とチケット確定まで進めます。 */
  public async processPendingMatches(
    options: MatchmakingMatchProcessingOptions = {}
  ): Promise<readonly MatchmakingMatchIntent[]> {
    const context =
      options.observability ?? createObservabilityContext(undefined);
    const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);

    return observeOperation(
      sink,
      context,
      "matchmaking.settle",
      async () => {
        const now = normalizeNow(options?.now);
    const maxMatches =
      options?.maxMatches === undefined
        ? 32
        : normalizePositiveSafeInteger(options.maxMatches, "maxMatches");

    // マイグレーション前に予約された候補や、インスタンス再生成直後の
    // `reserved` 行からも成立意図を復元できるようにします。
    this.ensureMatchIntentsForReservedTickets(now);

    const rows = this.ctx.storage.sql
      .exec<MatchIntentRow>(
        `SELECT
          match_id AS matchId,
          candidate_id AS candidateId,
          pool_id AS poolId,
          room_id AS roomId,
          candidate_json AS candidateJson,
          initialization_json AS initializationJson,
          status,
          attempt_count AS attemptCount,
          max_attempts AS maxAttempts,
          next_attempt_at AS nextAttemptAt,
          last_error_code AS lastErrorCode,
          result_json AS resultJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
         FROM flarelobby_matchmaking_match_intents
         WHERE status IN ('pending', 'initializing')
           AND next_attempt_at IS NOT NULL
           AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC, match_id ASC
         LIMIT ?`,
        now,
        maxMatches
      )
      .toArray();
    const processed: MatchmakingMatchIntent[] = [];

    for (const row of rows) {
      const claimed = this.claimMatchIntent(row.matchId, now);

      if (!claimed) {
        continue;
      }

      await this.processClaimedMatchIntent(claimed, context);
      const updated = this.readMatchIntentByMatchId(row.matchId);

      if (updated !== undefined) {
        processed.push(this.toMatchIntent(updated));
      }
    }

    await this.synchronizeAlarm();
        return Object.freeze(processed);
      }
    );
  }

  /** `processPendingMatches()` の説明的な別名です。 */
  public async settleMatches(
    options: MatchmakingMatchProcessingOptions = {}
  ): Promise<readonly MatchmakingMatchIntent[]> {
    return this.processPendingMatches(options);
  }

  /** `processPendingMatches()` の説明的な別名です。 */
  public async processMatchmaking(
    options: MatchmakingMatchProcessingOptions = {}
  ): Promise<readonly MatchmakingMatchIntent[]> {
    return this.processPendingMatches(options);
  }

  /** マッチングチケットを作成し、待機状態へ遷移させます。 */
  public async createTicket(
    options: MatchmakingTicketCreationOptions
  ): Promise<MatchmakingTicketRecord> {
    const observability =
      options.observability ?? createObservabilityContext(undefined);
    const principal = await this.requireGatewayPrincipal(options);
    const pool = this.requirePool();
    const normalized = normalizeCreation(options, pool, principal);
    const existingCommand = this.readProcessedCommand(normalized.requestId);

    if (existingCommand !== undefined) {
      if (
        existingCommand.command !== "matchmaking.create" ||
        existingCommand.playerId !== principal.playerId ||
        existingCommand.payloadJson !== normalized.requestPayloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるマッチング条件を指定できません。"
        });
      }

      const storedTicket = parseStoredTicketResult(existingCommand.resultJson);
      await this.processPendingMatches({ observability });
      const currentTicket = this.readTicket(storedTicket.id);
      await this.synchronizeAlarm();
      return currentTicket ?? storedTicket;
    }

    const inFlight = this.inFlightCreateRequests.get(normalized.requestId);

    if (inFlight !== undefined) {
      if (
        inFlight.playerId !== principal.playerId ||
        inFlight.payloadJson !== normalized.requestPayloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるマッチング条件を指定できません。"
        });
      }

      return inFlight.promise;
    }

    let resolveInFlight!: (ticket: MatchmakingTicketRecord) => void;
    let rejectInFlight!: (error: unknown) => void;
    const inFlightPromise = new Promise<MatchmakingTicketRecord>(
      (resolve, reject) => {
        resolveInFlight = resolve;
        rejectInFlight = reject;
      }
    );
    inFlightPromise.catch(() => undefined);
    this.inFlightCreateRequests.set(normalized.requestId, {
      playerId: principal.playerId,
      payloadJson: normalized.requestPayloadJson,
      promise: inFlightPromise
    });

    try {
      const active = this.readActiveTicketByPlayer(principal.playerId);

      if (active !== undefined) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じマッチングプールで有効なチケットが既に存在します。"
        });
      }

      const ticketId = `ticket_${crypto.randomUUID()}`;
      const createdAt = new Date(normalized.createdAtMs).toISOString();
      const searchAttributesJson = normalized.searchAttributesJson;

      try {
        this.ctx.storage.sql.exec(
          `INSERT INTO flarelobby_matchmaking_tickets (
            ticket_id,
            pool_id,
            player_id,
            rating_value,
            created_at,
            queued_at,
            region,
            input_method,
            search_attributes_json,
            status,
            expires_at_ms,
            reserved_candidate_json,
            reserved_at,
            match_result_json,
            matched_at,
            cancelled_at,
            expired_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
          ticketId,
          pool.poolId,
          principal.playerId,
          normalized.ratingValue,
          createdAt,
          null,
          normalized.region,
          normalized.inputMethod,
          searchAttributesJson,
          normalized.expiresAtMs
        );
      } catch {
        if (this.readActiveTicketByPlayer(principal.playerId) !== undefined) {
          throw new FlareLobbyError("CONFLICT", {
            message: "同じマッチングプールで有効なチケットが既に存在します。"
          });
        }

        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      this.incrementPoolRevision();
      this.appendTicketEvent(ticketId, "creating", normalized.createdAtMs);

      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'waiting', queued_at = ?
         WHERE ticket_id = ?`,
        createdAt,
        ticketId
      );
      this.incrementPoolRevision();
      this.appendTicketEvent(ticketId, "waiting", normalized.createdAtMs);

      // チケット追加時は待機中の全体から決定論的な候補を探索します。
      // この処理は await を挟まず SQLite 状態変更まで完了するため、候補の
      // 重複確保が同じ Durable Object の入力ゲート内で起こりません。
      this.searchAndReserveCandidatesAt(Date.now());
      await this.processPendingMatches({ observability });

      const ticket = this.readTicket(ticketId);

      if (ticket === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "matchmaking.create",
        playerId: principal.playerId,
        payloadJson: normalized.requestPayloadJson,
        resultJson: JSON.stringify(ticket),
        createdAt: normalized.createdAtMs
      });
      await this.synchronizeAlarm();

      resolveInFlight(ticket);
      return ticket;
    } catch (error) {
      rejectInFlight(error);
      throw error;
    } finally {
      if (
        this.inFlightCreateRequests.get(normalized.requestId)?.promise ===
        inFlightPromise
      ) {
        this.inFlightCreateRequests.delete(normalized.requestId);
      }
    }
  }

  /** `createTicket()` の意味を明示する別名です。 */
  public async createMatchmakingTicket(
    options: MatchmakingTicketCreationOptions
  ): Promise<MatchmakingTicketRecord> {
    return this.createTicket(options);
  }

  /** Ticket ID から SQLite の現在状態を復元します。 */
  public async getTicket(
    ticketIdOrOptions: string | { readonly ticketId: string }
  ): Promise<MatchmakingTicketRecord | null> {
    const ticketId = normalizeTicketId(
      typeof ticketIdOrOptions === "string"
        ? ticketIdOrOptions
        : ticketIdOrOptions?.ticketId
    );
    return this.readTicket(ticketId);
  }

  /** `getTicket()` の意味を明示する別名です。 */
  public async getMatchmakingTicket(
    ticketIdOrOptions: string | { readonly ticketId: string }
  ): Promise<MatchmakingTicketRecord | null> {
    return this.getTicket(ticketIdOrOptions);
  }

  /** 認証済み主体自身の有効チケットを返します。 */
  public async getTicketForPrincipal(options: {
    readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  }): Promise<MatchmakingTicketRecord | null> {
    const principal = await this.requireGatewayPrincipal(options);
    const ticket = this.readActiveTicketByPlayer(principal.playerId);
    return ticket === undefined ? null : this.toTicket(ticket);
  }

  /** `getTicketForPrincipal()` の意味を明示する別名です。 */
  public async getActiveTicket(
    options: {
      readonly gatewayPrincipal: GatewayPrincipalEnvelope;
    }
  ): Promise<MatchmakingTicketRecord | null> {
    return this.getTicketForPrincipal(options);
  }

  /** 待機中チケットをキャンセルします。 */
  public async cancelTicket(
    options: MatchmakingTicketCancellationOptions
  ): Promise<MatchmakingTicketRecord> {
    const observability =
      options.observability ?? createObservabilityContext(undefined);
    const principal = await this.requireGatewayPrincipal(options);
    const normalized = normalizeCancellation(options);
    const existingCommand =
      normalized.requestId === null
        ? null
        : this.readProcessedCommand(normalized.requestId);

    if (existingCommand !== null && existingCommand !== undefined) {
      if (
        existingCommand.command !== "matchmaking.cancel" ||
        existingCommand.playerId !== principal.playerId ||
        existingCommand.payloadJson !== normalized.requestPayloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるキャンセル条件を指定できません。"
        });
      }

      await this.synchronizeAlarm();
      return parseStoredTicketResult(existingCommand.resultJson);
    }

    const row = this.readTicketRow(normalized.ticketId);

    if (row === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "存在しないマッチングチケットはキャンセルできません。"
      });
    }

    if (row.playerId !== principal.playerId) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    let ticket: MatchmakingTicketRecord;
    let cancelledNow = false;

    if (row.status === "cancelled" || row.status === "expired") {
      ticket = this.toTicket(row);
    } else if (row.status === "creating" || row.status === "waiting") {
      const cancelledAtMs = Date.now();
      const cancelledAt = new Date(cancelledAtMs).toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'cancelled', cancelled_at = ?
         WHERE ticket_id = ? AND status IN ('creating', 'waiting')`,
        cancelledAt,
        normalized.ticketId
      );
      this.incrementPoolRevision();
      this.appendTicketEvent(normalized.ticketId, "cancelled", cancelledAtMs);
      cancelledNow = true;
      ticket = this.readTicket(normalized.ticketId) ??
        (() => {
          throw new FlareLobbyError("CONNECTION_FAILED");
        })();
    } else {
      throw new FlareLobbyError("CONFLICT", {
        message: "候補確保後または成立後のチケットはキャンセルできません。"
      });
    }

    if (normalized.requestId !== null) {
      this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "matchmaking.cancel",
        playerId: principal.playerId,
        payloadJson: normalized.requestPayloadJson,
        resultJson: JSON.stringify(ticket),
        createdAt: Date.now()
      });
    }
    await this.synchronizeAlarm();

    if (cancelledNow) {
      const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);
      recordQualityMetric(sink, {
        context: observability,
        name: "match_cancelled",
        value: 1,
        operation: "matchmaking.cancel",
        result: "success",
        attributes: { cancelled: true }
      });
      recordQualityMetric(sink, {
        context: observability,
        name: "match_outcome",
        value: 1,
        operation: "matchmaking.cancel",
        result: "success",
        attributes: { status: "cancelled" }
      });
    }

    return ticket;
  }

  /** `cancelTicket()` の意味を明示する別名です。 */
  public async cancelMatchmakingTicket(
    options: MatchmakingTicketCancellationOptions
  ): Promise<MatchmakingTicketRecord> {
    return this.cancelTicket(options);
  }

  /**
   * 2 件の待機チケットを候補として原子的に確保します。
   *
   * 候補探索はここでは行いません。呼び出し側が選んだ候補の両方が待機中の
   * 場合だけ、同じ入力ゲート内で両方を `reserved` へ進めます。
   */
  public async reserveCandidate(
    options: MatchmakingTicketReservationOptions
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    const pool = this.requirePool();
    const candidate = normalizeCandidate(options?.candidate, pool);
    const firstId = candidate.ticketIds[0];
    const secondId = candidate.ticketIds[1];
    const first = this.readTicketRow(firstId);
    const second = this.readTicketRow(secondId);

    if (first === undefined || second === undefined || firstId === secondId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "候補に指定されたチケットが存在しません。"
      });
    }

    if (
      first.status === "reserved" &&
      second.status === "reserved" &&
      first.reservedCandidateJson !== null &&
      second.reservedCandidateJson !== null &&
      parseCandidate(first.reservedCandidateJson).id === candidate.id &&
      parseCandidate(second.reservedCandidateJson).id === candidate.id
    ) {
      await this.processPendingMatches({
        ...(options.observability === undefined
          ? {}
          : { observability: options.observability })
      });
      const retriedFirst = this.readTicket(firstId);
      const retriedSecond = this.readTicket(secondId);

      if (retriedFirst === null || retriedSecond === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return [retriedFirst, retriedSecond];
    }

    if (first.status !== "waiting" || second.status !== "waiting") {
      throw new FlareLobbyError("CONFLICT", {
        message: "待機中ではないチケットを候補として確保できません。"
      });
    }

    if (!this.reserveCandidateRows(candidate, Date.now())) {
      throw new FlareLobbyError("CONFLICT", {
        message: "待機中ではないチケットを候補として確保できません。"
      });
    }

    await this.processPendingMatches({
      ...(options.observability === undefined
        ? {}
        : { observability: options.observability })
    });
    await this.synchronizeAlarm();

    const reservedFirst = this.readTicket(firstId);
    const reservedSecond = this.readTicket(secondId);

    if (reservedFirst === null || reservedSecond === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return [reservedFirst, reservedSecond];
  }

  /** `reserveCandidate()` の意味を明示する別名です。 */
  public async reserveTickets(
    options: MatchmakingTicketReservationOptions
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    return this.reserveCandidate(options);
  }

  /** 単一チケットを対象にした候補確保の別名です。候補の 1 件目を返します。 */
  public async reserveTicket(
    options: MatchmakingTicketReservationOptions
  ): Promise<MatchmakingTicketRecord> {
    const tickets = await this.reserveCandidate(options);
    const ticketId = options.candidate.ticketIds[0];
    const ticket = tickets.find((candidate) => candidate.id === ticketId);

    if (ticket === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return ticket;
  }

  /** 予約済みの候補へ、呼び出し側が生成した成立結果を適用します。 */
  public async matchCandidate(
    options: MatchmakingTicketMatchOptions
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    const pool = this.requirePool();
    const result = normalizeMatchResult(options?.result, pool);
    return this.applyMatchResult(result, pool, true, options.observability);
  }

  private async applyMatchResult(
    result: MatchmakingMatchResult,
    pool: PoolRow,
    verifyRoom: boolean,
    observability?: FlareLobbyObservabilityContext
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    const firstId = result.candidate.ticketIds[0];
    const secondId = result.candidate.ticketIds[1];
    const readRows = (): readonly [TicketRow, TicketRow] => {
      const first = this.readTicketRow(firstId);
      const second = this.readTicketRow(secondId);

      if (first === undefined || second === undefined || firstId === secondId) {
        throw new FlareLobbyError("CONFLICT", {
          message: "成立結果に指定されたチケットが存在しません。"
        });
      }

      return [first, second];
    };

    let [first, second] = readRows();

    if (first.status === "matched" && second.status === "matched") {
      if (
        first.matchResultJson === JSON.stringify(result) &&
        second.matchResultJson === JSON.stringify(result)
      ) {
        this.completeMatchIntent(result);
        return [this.toTicket(first), this.toTicket(second)];
      }

      throw new FlareLobbyError("CONFLICT", {
        message: "成立済みチケットへ異なる結果を適用できません。"
      });
    }

    if (
      first.status !== "reserved" ||
      second.status !== "reserved" ||
      first.reservedCandidateJson === null ||
      second.reservedCandidateJson === null ||
      parseCandidate(first.reservedCandidateJson).id !== result.candidate.id ||
      parseCandidate(second.reservedCandidateJson).id !== result.candidate.id
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "予約済みではない候補を成立させることはできません。"
      });
    }

    if (verifyRoom) {
      await this.verifyMatchRoomInitialized(result, pool);
      [first, second] = readRows();

      if (first.status === "matched" && second.status === "matched") {
        if (
          first.matchResultJson === JSON.stringify(result) &&
          second.matchResultJson === JSON.stringify(result)
        ) {
          this.completeMatchIntent(result);
          return [this.toTicket(first), this.toTicket(second)];
        }

        throw new FlareLobbyError("CONFLICT", {
          message: "成立済みチケットへ異なる結果を適用できません。"
        });
      }

      if (
        first.status !== "reserved" ||
        second.status !== "reserved" ||
        first.reservedCandidateJson === null ||
        second.reservedCandidateJson === null ||
        parseCandidate(first.reservedCandidateJson).id !== result.candidate.id ||
        parseCandidate(second.reservedCandidateJson).id !== result.candidate.id
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "予約済みではない候補を成立させることはできません。"
        });
      }
    }

    const matchedAtMs = Date.now();
    const matchedAt = new Date(matchedAtMs).toISOString();
    const resultJson = JSON.stringify(result);
    const searchPolicy = parseSearchPolicy(pool.searchPolicyJson);
    const firstQueuedAtMs = Date.parse(first.queuedAt ?? first.createdAt);
    const secondQueuedAtMs = Date.parse(second.queuedAt ?? second.createdAt);
    const firstWaitTimeMs = Number.isFinite(firstQueuedAtMs)
      ? Math.max(0, matchedAtMs - firstQueuedAtMs)
      : 0;
    const secondWaitTimeMs = Number.isFinite(secondQueuedAtMs)
      ? Math.max(0, matchedAtMs - secondQueuedAtMs)
      : 0;
    const waitTimeMs = Math.max(firstWaitTimeMs, secondWaitTimeMs);
    const ratingDifference = Math.abs(first.ratingValue - second.ratingValue);
    const searchWidth = Math.max(
      getMatchmakingSearchWidth(searchPolicy, firstWaitTimeMs),
      getMatchmakingSearchWidth(searchPolicy, secondWaitTimeMs)
    );

    for (const ticketId of [firstId, secondId]) {
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'matched', match_result_json = ?, matched_at = ?
         WHERE ticket_id = ? AND status = 'reserved'`,
        resultJson,
        matchedAt,
        ticketId
      );
      this.incrementPoolRevision();
      this.appendTicketEvent(ticketId, "matched", matchedAtMs);
    }

    this.completeMatchIntent(result);

    await this.synchronizeAlarm();

    const matchedFirst = this.readTicket(firstId);
    const matchedSecond = this.readTicket(secondId);

    if (matchedFirst === null || matchedSecond === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);
    const context = observability ?? createObservabilityContext(undefined);
    recordQualityMetric(sink, {
      context,
      name: "match_wait_time_ms",
      value: waitTimeMs,
      operation: "matchmaking.match",
      result: "success",
      attributes: { waitTimeMs }
    });
    recordQualityMetric(sink, {
      context,
      name: "match_rating_difference",
      value: ratingDifference,
      operation: "matchmaking.match",
      result: "success",
      attributes: { ratingDifference }
    });
    recordQualityMetric(sink, {
      context,
      name: "match_search_width",
      value: searchWidth,
      operation: "matchmaking.match",
      result: "success",
      attributes: { searchWidth }
    });
    recordQualityMetric(sink, {
      context,
      name: "match_succeeded",
      value: 1,
      operation: "matchmaking.match",
      result: "success",
      attributes: { matched: true }
    });
    recordQualityMetric(sink, {
      context,
      name: "match_outcome",
      value: 1,
      operation: "matchmaking.match",
      result: "success",
      attributes: { status: "matched" }
    });

    return [matchedFirst, matchedSecond];
  }

  private async verifyMatchRoomInitialized(
    result: MatchmakingMatchResult,
    pool: PoolRow
  ): Promise<void> {
    const room = this.env.FLARE_LOBBY_ROOMS.getByName(
      result.room.id
    ) as unknown as MatchRoomGatewayStub;
    const snapshot = await room.getSnapshot();

    if (
      snapshot === null ||
      snapshot.room.kind !== "match" ||
      snapshot.room.id !== result.room.id ||
      snapshot.room.matchId !== result.matchId
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "対戦 Room の初期化が完了していません。"
      });
    }

    normalizeMatchRoom(snapshot.room, pool);
  }

  /** `matchCandidate()` の意味を明示する別名です。 */
  public async matchTickets(
    options: MatchmakingTicketMatchOptions
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    return this.matchCandidate(options);
  }

  /** 期限到達済みの待機チケットを 1 件期限切れへ遷移させます。 */
  public async expireTicket(options: {
    readonly ticketId: string;
    readonly now?: number;
  }): Promise<MatchmakingTicketRecord> {
    const ticketId = normalizeTicketId(options?.ticketId);
    const row = this.readTicketRow(ticketId);

    if (row === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "存在しないマッチングチケットは期限切れにできません。"
      });
    }

    if (row.status === "expired" || row.status === "cancelled") {
      return this.toTicket(row);
    }

    if (row.status !== "creating" && row.status !== "waiting") {
      throw new FlareLobbyError("CONFLICT", {
        message: "候補確保後または成立後のチケットは期限切れにできません。"
      });
    }

    const now = normalizeNow(options?.now);

    if (row.expiresAtMs > now) {
      throw new FlareLobbyError("CONFLICT", {
        message: "チケットの期限がまだ到達していません。"
      });
    }

    const expiredAt = new Date(now).toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_matchmaking_tickets
       SET status = 'expired', expired_at = ?
       WHERE ticket_id = ? AND status IN ('creating', 'waiting')`,
      expiredAt,
      ticketId
    );
    this.incrementPoolRevision();
    this.appendTicketEvent(ticketId, "expired", now);
    await this.synchronizeAlarm();

    const ticket = this.readTicket(ticketId);

    if (ticket === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return ticket;
  }

  /** 期限処理をまとめて実行します。Alarm とテストから再利用します。 */
  public async expireDueTickets(now = Date.now()): Promise<readonly MatchmakingTicketRecord[]> {
    const normalizedNow = normalizeNow(now);
    const expired = this.expireDueTicketsAt(normalizedNow);
    await this.synchronizeAlarm();
    return Object.freeze(expired);
  }

  /** Alarm を確認するテスト・運用診断用 RPC です。 */
  public async getNextAlarm(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  /** チケット状態イベントを取得します。主体は対象チケットの所有者に限ります。 */
  public async getTicketEvents(
    options: MatchmakingTicketEventQueryOptions
  ): Promise<readonly MatchmakingTicketEvent[]> {
    const principal = await this.requireGatewayPrincipal(options);
    const normalized = normalizeEventQuery(options);
    const ticket = this.readTicketRow(normalized.ticketId);

    if (ticket === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "存在しないマッチングチケットのイベントは取得できません。"
      });
    }

    if (ticket.playerId !== principal.playerId) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    return this.readTicketEvents(normalized.ticketId, normalized.afterSequence);
  }

  /** `getTicketEvents()` の意味を明示する別名です。 */
  public async listTicketEvents(
    options: MatchmakingTicketEventQueryOptions
  ): Promise<readonly MatchmakingTicketEvent[]> {
    return this.getTicketEvents(options);
  }

  /** Alarm は期限、検索幅拡大、次回 Alarm を同じ Pool の整合性境界で処理します。 */
  public override async alarm(): Promise<void> {
    const now = Date.now();
    this.expireDueTicketsAt(now);
    this.searchAndReserveCandidatesAt(now);
    await this.processPendingMatches({ now });
    await this.synchronizeAlarm();
  }

  /** チケット状態通知の WebSocket 接続口です。 */
  public override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parsedPath = parseTicketEventPath(url.pathname);

    if (parsedPath === null) {
      return new Response("Not Found", { status: 404 });
    }

    const token = readGatewayToken(request);

    if (token === null) {
      return createErrorResponse(new FlareLobbyError("UNAUTHENTICATED"));
    }

    const principal = await this.resolveGatewayPrincipal({ token });

    if (principal === null) {
      return createErrorResponse(new FlareLobbyError("UNAUTHENTICATED"));
    }

    const ticket = this.readTicketRow(parsedPath.ticketId);

    if (ticket === undefined) {
      return createErrorResponse(
        new FlareLobbyError("CONFLICT", {
          message: "存在しないマッチングチケットです。"
        })
      );
    }

    if (ticket.playerId !== principal.playerId) {
      return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
    }

    const afterSequence = parseAfterSequence(url.searchParams.get("after"));

    if (afterSequence === null) {
      return createErrorResponse(new FlareLobbyError("INVALID_PAYLOAD"));
    }

    const events = this.readTicketEvents(parsedPath.ticketId, afterSequence);
    const wantsWebSocket =
      request.headers.get("upgrade")?.toLowerCase() === "websocket";

    if (!wantsWebSocket) {
      const currentTicket = this.toTicket(ticket);
      return Response.json({ ticket: currentTicket, events });
    }

    const pair = new WebSocketPair();
    const tag = ticketEventTag(parsedPath.ticketId);
    this.ctx.acceptWebSocket(pair[1], [tag]);

    for (const event of events) {
      sendTicketEvent(pair[1], event);
    }

    return new Response(null, {
      status: 101,
      webSocket: pair[0]
    });
  }

  /** WebSocket クライアントからの再同期要求を処理します。 */
  public override async webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const ticketId = this.ctx
      .getTags(webSocket)
      .find((tag) => tag.startsWith("ticket:"))
      ?.slice("ticket:".length);

    if (ticketId === undefined) {
      return;
    }

    const afterSequence = parseAfterSequenceFromMessage(message);

    if (afterSequence === null) {
      webSocket.send(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          kind: "failure",
          requestId: null,
          error: new FlareLobbyError("INVALID_MESSAGE").toJSON()
        })
      );
      return;
    }

    for (const event of this.readTicketEvents(ticketId, afterSequence)) {
      sendTicketEvent(webSocket, event);
    }
  }

  private searchCandidatesAt(
    nowMs: number
  ): MatchmakingSearchResult {
    const pool = this.requirePool();
    const policy = parseSearchPolicy(pool.searchPolicyJson);
    const rows = this.readWaitingTicketRows(policy.maxTicketsPerSearch, nowMs);
    const candidates = selectMatchCandidates(
      rows.map((row) => this.toSearchTicket(row)),
      { now: nowMs, policy }
    );

    return this.createSearchResult(
      pool,
      policy,
      nowMs,
      candidates,
      rows.length
    );
  }

  private searchAndReserveCandidatesAt(
    nowMs: number
  ): MatchmakingSearchResult {
    const pool = this.requirePool();
    const policy = parseSearchPolicy(pool.searchPolicyJson);
    const rows = this.readWaitingTicketRows(policy.maxTicketsPerSearch, nowMs);
    const selected = selectMatchCandidates(
      rows.map((row) => this.toSearchTicket(row)),
      { now: nowMs, policy }
    );
    const reserved: MatchmakingCandidateEvaluation[] = [];

    for (const evaluation of selected) {
      if (this.reserveCandidateRows(evaluation.candidate, nowMs)) {
        reserved.push(evaluation);
      }
    }

    return this.createSearchResult(
      pool,
      policy,
      nowMs,
      reserved,
      rows.length
    );
  }

  private createSearchResult(
    pool: PoolRow,
    policy: NormalizedMatchmakingSearchPolicy,
    nowMs: number,
    candidates: readonly MatchmakingCandidateEvaluation[],
    inspectedTicketCount: number
  ): MatchmakingSearchResult {
    const nextSearchAt = this.getNextSearchAtForWaitingTickets(nowMs, policy);

    return deepFreeze({
      pool: toPool(pool),
      searchPolicy: policy,
      searchedAt: new Date(nowMs).toISOString(),
      candidates,
      inspectedTicketCount,
      nextSearchAt:
        nextSearchAt === null ? null : new Date(nextSearchAt).toISOString()
    });
  }

  private getNextSearchAtForWaitingTickets(
    nowMs: number,
    policy: NormalizedMatchmakingSearchPolicy
  ): number | null {
    const rows = this.readWaitingTicketRows(policy.maxTicketsPerSearch, nowMs);
    let nextSearchAt: number | null = null;

    for (const row of rows) {
      if (row.queuedAt === null) {
        continue;
      }

      const candidate = getNextMatchmakingSearchAt(
        policy,
        row.queuedAt,
        nowMs
      );

      if (
        candidate !== null &&
        (nextSearchAt === null || candidate < nextSearchAt)
      ) {
        nextSearchAt = candidate;
      }
    }

    return nextSearchAt;
  }

  private reserveCandidateRows(
    candidate: MatchCandidate,
    reservedAtMs: number
  ): boolean {
    const firstId = candidate.ticketIds[0];
    const secondId = candidate.ticketIds[1];
    const first = this.readTicketRow(firstId);
    const second = this.readTicketRow(secondId);

    if (
      first === undefined ||
      second === undefined ||
      firstId === secondId ||
      first.status !== "waiting" ||
      second.status !== "waiting"
    ) {
      return false;
    }

    const reservedAt = new Date(reservedAtMs).toISOString();
    const candidateJson = JSON.stringify(candidate);

    for (const ticketId of [firstId, secondId]) {
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'reserved',
             reserved_candidate_json = ?,
             reserved_at = ?
         WHERE ticket_id = ? AND status = 'waiting'`,
        candidateJson,
        reservedAt,
        ticketId
      );
      this.incrementPoolRevision();
      this.appendTicketEvent(ticketId, "reserved", reservedAtMs);
    }

    this.ensureMatchIntent(candidate, reservedAtMs);

    return true;
  }

  private expireDueTicketsAt(
    normalizedNow: number
  ): MatchmakingTicketRecord[] {
    const due = this.ctx.storage.sql
      .exec<TicketRow>(
        `SELECT
          ticket_id AS ticketId,
          pool_id AS poolId,
          player_id AS playerId,
          rating_value AS ratingValue,
          created_at AS createdAt,
          queued_at AS queuedAt,
          region,
          input_method AS inputMethod,
          search_attributes_json AS searchAttributesJson,
          status,
          expires_at_ms AS expiresAtMs,
          reserved_candidate_json AS reservedCandidateJson,
          reserved_at AS reservedAt,
          match_result_json AS matchResultJson,
          matched_at AS matchedAt,
          cancelled_at AS cancelledAt,
          expired_at AS expiredAt
         FROM flarelobby_matchmaking_tickets
         WHERE status IN ('creating', 'waiting') AND expires_at_ms <= ?
         ORDER BY expires_at_ms ASC, ticket_id ASC`,
        normalizedNow
      )
      .toArray();
    const expired: MatchmakingTicketRecord[] = [];

    for (const row of due) {
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'expired', expired_at = ?
         WHERE ticket_id = ? AND status IN ('creating', 'waiting')`,
        new Date(normalizedNow).toISOString(),
        row.ticketId
      );
      this.incrementPoolRevision();
      this.appendTicketEvent(row.ticketId, "expired", normalizedNow);
      const ticket = this.readTicket(row.ticketId);

      if (ticket !== null) {
        expired.push(ticket);
      }
    }

    return expired;
  }

  private ensureMatchIntentsForReservedTickets(nowMs: number): void {
    const candidates = this.ctx.storage.sql
      .exec<{ candidateJson: string }>(
        `SELECT DISTINCT reserved_candidate_json AS candidateJson
         FROM flarelobby_matchmaking_tickets
         WHERE status = 'reserved' AND reserved_candidate_json IS NOT NULL`
      )
      .toArray();

    for (const row of candidates) {
      this.ensureMatchIntent(parseCandidate(row.candidateJson), nowMs);
    }
  }

  private ensureMatchIntent(
    candidate: MatchCandidate,
    createdAtMs: number
  ): MatchIntentRow {
    const existing = this.readMatchIntentByCandidateId(candidate.id);

    if (existing !== undefined) {
      return existing;
    }

    const pool = this.requirePool();
    const first = this.readTicketRow(candidate.ticketIds[0]);
    const second = this.readTicketRow(candidate.ticketIds[1]);

    if (
      first === undefined ||
      second === undefined ||
      first.status !== "reserved" ||
      second.status !== "reserved"
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "成立意図を作成するには、2 件のチケットが予約済みである必要があります。"
      });
    }

    const matchRoom = parseMatchRoomOptions(pool.matchRoomJson);
    const matchId = createMatchmakingMatchId(candidate.id);
    const room = createMatchRoomRecord(
      matchId,
      candidate,
      toPool(pool),
      matchRoom
    );
    const initialization = createMatchRoomInitialization(
      matchId,
      room,
      first,
      second,
      matchRoom
    );
    const initializationJson = JSON.stringify(initialization);
    const roomId = room.id;

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_matchmaking_match_intents (
        match_id,
        candidate_id,
        pool_id,
        room_id,
        candidate_json,
        initialization_json,
        status,
        attempt_count,
        max_attempts,
        next_attempt_at,
        last_error_code,
        result_json,
        created_at,
        updated_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, NULL, ?, ?, NULL)
      ON CONFLICT(candidate_id) DO NOTHING`,
      matchId,
      candidate.id,
      pool.poolId,
      roomId,
      JSON.stringify(candidate),
      initializationJson,
      matchRoom.maxAttempts,
      createdAtMs,
      createdAtMs,
      createdAtMs
    );

    const stored = this.readMatchIntentByCandidateId(candidate.id);

    if (stored === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return stored;
  }

  private readMatchIntentByMatchId(matchId: string): MatchIntentRow | undefined {
    return this.ctx.storage.sql
      .exec<MatchIntentRow>(
        `SELECT
          match_id AS matchId,
          candidate_id AS candidateId,
          pool_id AS poolId,
          room_id AS roomId,
          candidate_json AS candidateJson,
          initialization_json AS initializationJson,
          status,
          attempt_count AS attemptCount,
          max_attempts AS maxAttempts,
          next_attempt_at AS nextAttemptAt,
          last_error_code AS lastErrorCode,
          result_json AS resultJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
         FROM flarelobby_matchmaking_match_intents
         WHERE match_id = ?`,
        matchId
      )
      .toArray()[0];
  }

  private readMatchIntentByCandidateId(
    candidateId: string
  ): MatchIntentRow | undefined {
    return this.ctx.storage.sql
      .exec<MatchIntentRow>(
        `SELECT
          match_id AS matchId,
          candidate_id AS candidateId,
          pool_id AS poolId,
          room_id AS roomId,
          candidate_json AS candidateJson,
          initialization_json AS initializationJson,
          status,
          attempt_count AS attemptCount,
          max_attempts AS maxAttempts,
          next_attempt_at AS nextAttemptAt,
          last_error_code AS lastErrorCode,
          result_json AS resultJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
         FROM flarelobby_matchmaking_match_intents
         WHERE candidate_id = ?`,
        candidateId
      )
      .toArray()[0];
  }

  private claimMatchIntent(
    matchId: string,
    nowMs: number
  ): MatchIntentRow | undefined {
    const retryAt = nowMs + DEFAULT_MATCHMAKING_MATCH_RETRY_DELAY_MS;
    const updated = this.ctx.storage.sql
      .exec<MatchIntentRow>(
        `UPDATE flarelobby_matchmaking_match_intents
         SET status = 'initializing',
             attempt_count = attempt_count + 1,
             next_attempt_at = ?,
             updated_at = ?
         WHERE match_id = ?
           AND status IN ('pending', 'initializing')
           AND next_attempt_at IS NOT NULL
           AND next_attempt_at <= ?
         RETURNING
           match_id AS matchId,
           candidate_id AS candidateId,
           pool_id AS poolId,
           room_id AS roomId,
           candidate_json AS candidateJson,
           initialization_json AS initializationJson,
           status,
           attempt_count AS attemptCount,
           max_attempts AS maxAttempts,
           next_attempt_at AS nextAttemptAt,
           last_error_code AS lastErrorCode,
           result_json AS resultJson,
           created_at AS createdAt,
           updated_at AS updatedAt,
           completed_at AS completedAt`,
        retryAt,
        nowMs,
        matchId,
        nowMs
      )
      .toArray()[0];

    return updated;
  }

  private async processClaimedMatchIntent(
    intent: MatchIntentRow,
    observability?: FlareLobbyObservabilityContext
  ): Promise<void> {
    const current = this.readMatchIntentByMatchId(intent.matchId);

    if (current === undefined || current.status !== "initializing") {
      return;
    }

    try {
      const initialization = parseStoredRoomInitialization(
        current.initializationJson
      );
      const room = this.env.FLARE_LOBBY_ROOMS.getByName(
        current.roomId
      ) as unknown as MatchRoomGatewayStub;
      const snapshot = await room.initialize({
        ...initialization,
        ...(observability === undefined ? {} : { observability })
      });
      const result = this.createMatchResultFromSnapshot(current, snapshot);

      // Room の初期化が成功した後にだけチケットを matched へ進めます。
      await this.applyMatchResult(result, this.requirePool(), false, observability);
    } catch (error) {
      const code = getMatchSettlementErrorCode(error);
      const latest = this.readMatchIntentByMatchId(intent.matchId);

      if (latest === undefined || latest.status === "matched") {
        return;
      }

      if (
        !isRetryableMatchSettlementError(code) ||
        latest.attemptCount >= latest.maxAttempts
      ) {
        this.failMatchIntent(latest, code);
        return;
      }

      const nowMs = Date.now();
      const nextAttemptAt =
        nowMs + getMatchSettlementRetryDelay(latest.attemptCount);
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_match_intents
         SET status = 'pending',
             next_attempt_at = ?,
             last_error_code = ?,
             updated_at = ?
         WHERE match_id = ? AND status = 'initializing'`,
        nextAttemptAt,
        code,
        nowMs,
        latest.matchId
      );
    }
  }

  private createMatchResultFromSnapshot(
    intent: MatchIntentRow,
    snapshot: RoomSnapshot
  ): MatchmakingMatchResult {
    const pool = this.requirePool();

    if (
      snapshot.room.kind !== "match" ||
      snapshot.room.id !== intent.roomId ||
      snapshot.room.matchId !== intent.matchId
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化された Room が成立意図と一致しません。"
      });
    }

    const room = normalizeMatchRoom(snapshot.room, pool);

    if (room.id !== intent.roomId || room.matchId !== intent.matchId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化された Room の識別子が成立意図と一致しません。"
      });
    }

    return deepFreeze({
      matchId: intent.matchId,
      candidate: parseCandidate(intent.candidateJson),
      room,
      createdAt: new Date().toISOString()
    });
  }

  private completeMatchIntent(result: MatchmakingMatchResult): void {
    const nowMs = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_matchmaking_match_intents
       SET status = 'matched',
           next_attempt_at = NULL,
           last_error_code = NULL,
           result_json = ?,
           updated_at = ?,
           completed_at = ?
       WHERE candidate_id = ?
         AND status <> 'failed'`,
      JSON.stringify(result),
      nowMs,
      nowMs,
      result.candidate.id
    );
  }

  private failMatchIntent(
    intent: MatchIntentRow,
    code: FlareLobbyErrorCode
  ): void {
    const nowMs = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_matchmaking_match_intents
       SET status = 'failed',
           next_attempt_at = NULL,
           last_error_code = ?,
           updated_at = ?
       WHERE match_id = ? AND status <> 'matched'`,
      code,
      nowMs,
      intent.matchId
    );

    this.releaseReservedCandidate(parseCandidate(intent.candidateJson), nowMs);
  }

  private releaseReservedCandidate(
    candidate: MatchCandidate,
    cancelledAtMs: number
  ): void {
    const cancelledAt = new Date(cancelledAtMs).toISOString();

    for (const ticketId of candidate.ticketIds) {
      const row = this.readTicketRow(ticketId);

      if (
        row === undefined ||
        row.status !== "reserved" ||
        row.reservedCandidateJson === null ||
        parseCandidate(row.reservedCandidateJson).id !== candidate.id
      ) {
        continue;
      }

      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'cancelled', cancelled_at = ?
         WHERE ticket_id = ? AND status = 'reserved'`,
        cancelledAt,
        ticketId
      );
      this.incrementPoolRevision();
      this.appendTicketEvent(ticketId, "cancelled", cancelledAtMs);
    }
  }

  private toMatchIntent(row: MatchIntentRow): MatchmakingMatchIntent {
    const pool = this.requirePool();
    const initialization = parseStoredRoomInitialization(row.initializationJson);
    const candidate = parseCandidate(row.candidateJson);
    const room = normalizeMatchRoom(initialization.room, pool);
    const result =
      row.resultJson === null ? null : parseMatchResult(row.resultJson);
    const lastErrorCode = isFlareLobbyErrorCode(row.lastErrorCode)
      ? row.lastErrorCode
      : null;

    return deepFreeze({
      matchId: row.matchId,
      candidate,
      room,
      status: row.status,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt,
      lastErrorCode,
      result,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      completedAt:
        row.completedAt === null
          ? null
          : new Date(row.completedAt).toISOString()
    });
  }

  private async requireGatewayPrincipal(
    options: { readonly gatewayPrincipal?: GatewayPrincipalEnvelope }
  ): Promise<Principal> {
    if (!isGatewayPrincipalEnvelope(options?.gatewayPrincipal)) {
      throw new FlareLobbyError("UNAUTHENTICATED");
    }

    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal
    );

    if (principal === null) {
      throw new FlareLobbyError("UNAUTHENTICATED");
    }

    return principal;
  }

  private requirePool(): PoolRow {
    const pool = this.readPoolRow();

    if (pool === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Match Pool は操作できません。"
      });
    }

    return pool;
  }

  private readPoolRow(): PoolRow | undefined {
    return this.ctx.storage.sql
      .exec<PoolRow>(
        `SELECT
          pool_id AS poolId,
          pool_key AS poolKey,
          game_id AS gameId,
          season_id AS seasonId,
          mode,
          region,
          search_policy_json AS searchPolicyJson,
          match_room_json AS matchRoomJson,
          revision
         FROM flarelobby_matchmaking_pools
         WHERE singleton_id = 1`
      )
      .toArray()[0];
  }

  private readTicketRow(ticketId: string): TicketRow | undefined {
    return this.ctx.storage.sql
      .exec<TicketRow>(
        `SELECT
          ticket_id AS ticketId,
          pool_id AS poolId,
          player_id AS playerId,
          rating_value AS ratingValue,
          created_at AS createdAt,
          queued_at AS queuedAt,
          region,
          input_method AS inputMethod,
          search_attributes_json AS searchAttributesJson,
          status,
          expires_at_ms AS expiresAtMs,
          reserved_candidate_json AS reservedCandidateJson,
          reserved_at AS reservedAt,
          match_result_json AS matchResultJson,
          matched_at AS matchedAt,
          cancelled_at AS cancelledAt,
          expired_at AS expiredAt
         FROM flarelobby_matchmaking_tickets
         WHERE ticket_id = ?`,
        ticketId
      )
      .toArray()[0];
  }

  private readWaitingTicketRows(
    limit: number,
    nowMs: number
  ): readonly TicketRow[] {
    return this.ctx.storage.sql
      .exec<TicketRow>(
        `SELECT
          ticket_id AS ticketId,
          pool_id AS poolId,
          player_id AS playerId,
          rating_value AS ratingValue,
          created_at AS createdAt,
          queued_at AS queuedAt,
          region,
          input_method AS inputMethod,
          search_attributes_json AS searchAttributesJson,
          status,
          expires_at_ms AS expiresAtMs,
          reserved_candidate_json AS reservedCandidateJson,
          reserved_at AS reservedAt,
          match_result_json AS matchResultJson,
          matched_at AS matchedAt,
          cancelled_at AS cancelledAt,
          expired_at AS expiredAt
         FROM flarelobby_matchmaking_tickets
         WHERE status = 'waiting'
           AND queued_at IS NOT NULL
           AND expires_at_ms > ?
         ORDER BY queued_at ASC, ticket_id ASC
         LIMIT ?`,
        nowMs,
        limit
      )
      .toArray();
  }

  private readActiveTicketByPlayer(playerId: string): TicketRow | undefined {
    return this.ctx.storage.sql
      .exec<TicketRow>(
        `SELECT
          ticket_id AS ticketId,
          pool_id AS poolId,
          player_id AS playerId,
          rating_value AS ratingValue,
          created_at AS createdAt,
          queued_at AS queuedAt,
          region,
          input_method AS inputMethod,
          search_attributes_json AS searchAttributesJson,
          status,
          expires_at_ms AS expiresAtMs,
          reserved_candidate_json AS reservedCandidateJson,
          reserved_at AS reservedAt,
          match_result_json AS matchResultJson,
          matched_at AS matchedAt,
          cancelled_at AS cancelledAt,
          expired_at AS expiredAt
         FROM flarelobby_matchmaking_tickets
         WHERE player_id = ? AND status IN ('creating', 'waiting', 'reserved')
         ORDER BY created_at ASC, ticket_id ASC
         LIMIT 1`,
        playerId
      )
      .toArray()[0];
  }

  private readTicket(ticketId: string): MatchmakingTicketRecord | null {
    const row = this.readTicketRow(ticketId);
    return row === undefined ? null : this.toTicket(row);
  }

  private toTicket(row: TicketRow): MatchmakingTicketRecord {
    const pool = this.readPoolRow();

    if (pool === undefined || row.poolId !== pool.poolId) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const common = {
      id: row.ticketId,
      pool: toPool(pool),
      player: { id: row.playerId },
      rating: {
        playerId: row.playerId,
        poolId: pool.poolId,
        value: row.ratingValue
      },
      createdAt: row.createdAt,
      region: row.region,
      inputMethod: row.inputMethod,
      searchAttributes: toMatchmakingAttributeObject(
        parseJsonObject(row.searchAttributesJson)
      ),
      expiresAt: new Date(row.expiresAtMs).toISOString(),
      expiresAtMs: row.expiresAtMs
    } as const;

    switch (row.status) {
      case "creating":
        return deepFreeze({ ...common, status: "creating" });
      case "waiting":
        if (row.queuedAt === null) {
          throw new FlareLobbyError("CONNECTION_FAILED");
        }
        return deepFreeze({ ...common, status: "waiting", queuedAt: row.queuedAt });
      case "reserved":
        if (row.reservedCandidateJson === null || row.reservedAt === null) {
          throw new FlareLobbyError("CONNECTION_FAILED");
        }
        return deepFreeze({
          ...common,
          status: "reserved",
          candidate: parseCandidate(row.reservedCandidateJson),
          reservedAt: row.reservedAt
        });
      case "matched":
        if (row.matchResultJson === null || row.matchedAt === null) {
          throw new FlareLobbyError("CONNECTION_FAILED");
        }
        return deepFreeze({
          ...common,
          status: "matched",
          result: parseMatchResult(row.matchResultJson),
          matchedAt: row.matchedAt
        });
      case "cancelled":
        if (row.cancelledAt === null) {
          throw new FlareLobbyError("CONNECTION_FAILED");
        }
        return deepFreeze({
          ...common,
          status: "cancelled",
          cancelledAt: row.cancelledAt
        });
      case "expired":
        if (row.expiredAt === null) {
          throw new FlareLobbyError("CONNECTION_FAILED");
        }
        return deepFreeze({ ...common, status: "expired", expiredAt: row.expiredAt });
      default:
        throw new FlareLobbyError("CONNECTION_FAILED");
    }
  }

  private toSearchTicket(row: TicketRow): MatchmakingSearchTicket {
    const pool = this.readPoolRow();

    if (pool === undefined || row.poolId !== pool.poolId || row.queuedAt === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return {
      id: row.ticketId,
      pool: toPool(pool),
      player: { id: row.playerId },
      rating: {
        playerId: row.playerId,
        poolId: pool.poolId,
        value: row.ratingValue
      },
      queuedAt: row.queuedAt,
      region: row.region,
      inputMethod: row.inputMethod,
      searchAttributes: parseJsonObject(row.searchAttributesJson)
    };
  }

  private incrementPoolRevision(): number {
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_matchmaking_pools
       SET revision = revision + 1
       WHERE singleton_id = 1`
    );
    return this.readPoolRow()?.revision ?? 0;
  }

  private appendTicketEvent(
    ticketId: string,
    type: MatchmakingTicketStatus,
    occurredAtMs: number
  ): MatchmakingTicketEvent {
    const ticket = this.readTicket(ticketId);
    const pool = this.readPoolRow();

    if (ticket === null || pool === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const progress = this.readProgress();
    const occurredAt = new Date(occurredAtMs).toISOString();
    const searchPolicy = parseSearchPolicy(pool.searchPolicyJson);
    const searchWidth = getTicketSearchWidth(ticket, searchPolicy, occurredAtMs);
    const sequence = this.ctx.storage.sql
      .exec<{ sequence: number }>(
        `INSERT INTO flarelobby_matchmaking_events (
          ticket_id,
          type,
          ticket_json,
          pool_revision,
          waiting_count,
          active_count,
          occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING event_id AS sequence`,
        ticketId,
        type,
        JSON.stringify(ticket),
        pool.revision,
        progress.waitingCount,
        progress.activeCount,
        occurredAt
      )
      .one().sequence;

    const event = deepFreeze({
      sequence,
      poolRevision: pool.revision,
      type,
      ticketId,
      ticket,
      waitingCount: progress.waitingCount,
      activeCount: progress.activeCount,
      searchWidth,
      occurredAt
    });

    this.notifyTicketEvent(event);
    return event;
  }

  private readProgress(): ProgressRow {
    return this.ctx.storage.sql
      .exec<ProgressRow>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END), 0) AS waitingCount,
          COALESCE(SUM(CASE WHEN status IN ('creating', 'waiting', 'reserved') THEN 1 ELSE 0 END), 0) AS activeCount,
          COUNT(*) AS ticketCount
         FROM flarelobby_matchmaking_tickets`
      )
      .one();
  }

  private notifyTicketEvent(event: MatchmakingTicketEvent): void {
    const message = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      event: "matchmaking.ticket",
      revision: event.poolRevision,
        payload: {
          ticket: event.ticket,
          waitingCount: event.waitingCount,
          activeCount: event.activeCount,
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          searchWidth: event.searchWidth
        }
    });

    for (const webSocket of this.ctx.getWebSockets(ticketEventTag(event.ticketId))) {
      try {
        webSocket.send(message);
      } catch {
        try {
          webSocket.close(1011, "通知の送信に失敗しました。");
        } catch {
          // 既に閉じた接続は次回の Hibernation 復帰時に破棄されます。
        }
      }
    }
  }

  private readTicketEvents(
    ticketId: string,
    afterSequence: number
  ): readonly MatchmakingTicketEvent[] {
    return this.ctx.storage.sql
      .exec<EventRow>(
        `SELECT
          event_id AS sequence,
          pool_revision AS poolRevision,
          ticket_id AS ticketId,
          type,
          ticket_json AS ticketJson,
          waiting_count AS waitingCount,
          active_count AS activeCount,
          occurred_at AS occurredAt
         FROM flarelobby_matchmaking_events
         WHERE ticket_id = ? AND event_id > ?
         ORDER BY event_id ASC`,
        ticketId,
        afterSequence
      )
      .toArray()
      .map((row) =>
        deepFreeze({
          ...(() => {
            const ticket = parseStoredTicketResult(row.ticketJson);
            const pool = this.readPoolRow();
            if (pool === undefined) {
              throw new FlareLobbyError("CONNECTION_FAILED");
            }
            return {
              ticket,
              searchWidth: getTicketSearchWidth(
                ticket,
                parseSearchPolicy(pool.searchPolicyJson),
                Date.parse(row.occurredAt)
              )
            };
          })(),
          sequence: row.sequence,
          poolRevision: row.poolRevision,
          type: row.type,
          ticketId: row.ticketId,
          waitingCount: row.waitingCount,
          activeCount: row.activeCount,
          occurredAt: row.occurredAt
        })
      );
  }

  private readProcessedCommand(
    requestId: string
  ): ProcessedCommandRow | undefined {
    return this.ctx.storage.sql
      .exec<ProcessedCommandRow>(
        `SELECT
          request_id AS requestId,
          command,
          player_id AS playerId,
          payload_json AS payloadJson,
          result_json AS resultJson,
          created_at AS createdAt
         FROM flarelobby_matchmaking_processed_commands
         WHERE request_id = ?`,
        requestId
      )
      .toArray()[0];
  }

  private recordProcessedCommand(command: ProcessedCommandRow): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_matchmaking_processed_commands (
        request_id,
        command,
        player_id,
        payload_json,
        result_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      command.requestId,
      command.command,
      command.playerId,
      command.payloadJson,
      command.resultJson,
      command.createdAt
    );
  }

  private async synchronizeAlarm(): Promise<void> {
    const nextExpiry = this.ctx.storage.sql
      .exec<{ nextExpiresAt: number | null }>(
        `SELECT MIN(expires_at_ms) AS nextExpiresAt
         FROM flarelobby_matchmaking_tickets
         WHERE status IN ('creating', 'waiting')`
      )
      .one().nextExpiresAt;
    const pool = this.readPoolRow();
    const nextSearchAt =
      pool === undefined
        ? null
        : this.getNextSearchAtForWaitingTickets(
            Date.now(),
            parseSearchPolicy(pool.searchPolicyJson)
          );
    const nextMatchAttemptAt = this.ctx.storage.sql
      .exec<{ nextAttemptAt: number | null }>(
        `SELECT MIN(next_attempt_at) AS nextAttemptAt
         FROM flarelobby_matchmaking_match_intents
         WHERE status IN ('pending', 'initializing')
           AND next_attempt_at IS NOT NULL`
      )
      .one().nextAttemptAt;
    const nextValues = [nextExpiry, nextSearchAt, nextMatchAttemptAt].filter(
      (value): value is number => value !== null
    );
    const current = await this.ctx.storage.getAlarm();

    if (nextValues.length === 0) {
      if (current !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }

    const next = Math.min(...nextValues);

    if (current === null || current !== next) {
      await this.ctx.storage.setAlarm(next);
    }
  }
}

function migrateMatchPoolSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS flarelobby_matchmaking_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const currentVersion = sql
    .exec<SchemaMigrationRow>(
      `SELECT COALESCE(MAX(version), 0) AS version
       FROM flarelobby_matchmaking_schema_migrations`
    )
    .one().version;

  if (currentVersion < 1) {
    sql.exec(
      `
      CREATE TABLE IF NOT EXISTS flarelobby_matchmaking_pools (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        pool_id TEXT NOT NULL UNIQUE,
        pool_key TEXT NOT NULL UNIQUE,
        game_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        region TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flarelobby_matchmaking_tickets (
        ticket_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        rating_value REAL NOT NULL,
        created_at TEXT NOT NULL,
        queued_at TEXT,
        region TEXT NOT NULL,
        input_method TEXT NOT NULL,
        search_attributes_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('creating', 'waiting', 'reserved', 'matched', 'cancelled', 'expired')),
        expires_at_ms INTEGER NOT NULL,
        reserved_candidate_json TEXT,
        reserved_at TEXT,
        match_result_json TEXT,
        matched_at TEXT,
        cancelled_at TEXT,
        expired_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_flarelobby_matchmaking_active_player
        ON flarelobby_matchmaking_tickets (player_id)
        WHERE status IN ('creating', 'waiting', 'reserved');

      CREATE INDEX IF NOT EXISTS
        idx_flarelobby_matchmaking_ticket_expiry
        ON flarelobby_matchmaking_tickets (status, expires_at_ms, ticket_id);

      CREATE TABLE IF NOT EXISTS flarelobby_matchmaking_processed_commands (
        request_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        player_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flarelobby_matchmaking_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('creating', 'waiting', 'reserved', 'matched', 'cancelled', 'expired')),
        ticket_json TEXT NOT NULL,
        pool_revision INTEGER NOT NULL,
        waiting_count INTEGER NOT NULL,
        active_count INTEGER NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS
        idx_flarelobby_matchmaking_events_ticket
        ON flarelobby_matchmaking_events (ticket_id, event_id);

      INSERT INTO flarelobby_matchmaking_schema_migrations (version, applied_at)
      VALUES (1, ?)
    `,
      Date.now()
    );
  }

  if (currentVersion < 2) {
    sql.exec(
      `ALTER TABLE flarelobby_matchmaking_pools
       ADD COLUMN search_policy_json TEXT`
    );
    sql.exec(
      `UPDATE flarelobby_matchmaking_pools
       SET search_policy_json = ?
       WHERE search_policy_json IS NULL`,
      JSON.stringify(normalizeMatchmakingSearchPolicy())
    );
    sql.exec(
      `INSERT INTO flarelobby_matchmaking_schema_migrations (version, applied_at)
       VALUES (2, ?)`,
      Date.now()
    );
  }

  if (currentVersion < 3) {
    sql.exec(
      `ALTER TABLE flarelobby_matchmaking_pools
       ADD COLUMN match_room_json TEXT`
    );
    sql.exec(
      `UPDATE flarelobby_matchmaking_pools
       SET match_room_json = ?
       WHERE match_room_json IS NULL`,
      JSON.stringify(normalizeMatchmakingMatchRoomOptions())
    );
    sql.exec(`
      CREATE TABLE IF NOT EXISTS flarelobby_matchmaking_match_intents (
        match_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE,
        pool_id TEXT NOT NULL,
        room_id TEXT NOT NULL UNIQUE,
        candidate_json TEXT NOT NULL,
        initialization_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'initializing', 'matched', 'failed')),
        attempt_count INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_attempt_at INTEGER,
        last_error_code TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS
        idx_flarelobby_matchmaking_match_intents_retry
        ON flarelobby_matchmaking_match_intents (status, next_attempt_at, match_id);

      INSERT INTO flarelobby_matchmaking_schema_migrations (version, applied_at)
      VALUES (3, ?)
    `, Date.now());
  }
}

function normalizePoolInput(
  input: MatchPoolInitializationOptions | MatchmakingPool
): {
  readonly pool: MatchmakingPool;
  readonly poolKey: string;
  readonly searchPolicyJson: string;
  readonly searchPolicyProvided: boolean;
  readonly matchRoomJson: string;
  readonly matchRoomProvided: boolean;
} {
  const candidate =
    isRecord(input) && isRecord(input["pool"]) ? input["pool"] : input;
  const pool = normalizePool(candidate);
  const searchPolicyValue =
    isRecord(input) && Object.prototype.hasOwnProperty.call(input, "searchPolicy")
      ? input["searchPolicy"]
      : undefined;
  const searchPolicy = normalizeMatchmakingSearchPolicy(searchPolicyValue);
  const matchRoomValue =
    isRecord(input) && Object.prototype.hasOwnProperty.call(input, "matchRoom")
      ? input["matchRoom"]
      : undefined;
  const matchRoom = normalizeMatchmakingMatchRoomOptions(matchRoomValue);

  return {
    pool,
    poolKey: createMatchmakingPoolKey(pool),
    searchPolicyJson: JSON.stringify(searchPolicy),
    searchPolicyProvided: searchPolicyValue !== undefined,
    matchRoomJson: JSON.stringify(matchRoom),
    matchRoomProvided: matchRoomValue !== undefined
  };
}

function normalizePool(value: unknown): MatchmakingPool {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["id"]) ||
    !isNonEmptyString(value["gameId"]) ||
    !isNonEmptyString(value["seasonId"]) ||
    !isNonEmptyString(value["mode"]) ||
    !isNonEmptyString(value["region"])
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return Object.freeze({
    id: value["id"],
    gameId: value["gameId"],
    seasonId: value["seasonId"],
    mode: value["mode"],
    region: value["region"]
  });
}

function samePool(
  row: PoolRow,
  normalized: { readonly pool: MatchmakingPool; readonly poolKey: string }
): boolean {
  return (
    row.poolId === normalized.pool.id &&
    row.poolKey === normalized.poolKey &&
    row.gameId === normalized.pool.gameId &&
    row.seasonId === normalized.pool.seasonId &&
    row.mode === normalized.pool.mode &&
    row.region === normalized.pool.region
  );
}

function toPool(row: PoolRow): MatchmakingPool {
  return Object.freeze({
    id: row.poolId,
    gameId: row.gameId,
    seasonId: row.seasonId,
    mode: row.mode,
    region: row.region
  });
}

function parseSearchPolicy(value: string): NormalizedMatchmakingSearchPolicy {
  try {
    return normalizeMatchmakingSearchPolicy(JSON.parse(value));
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function normalizeMatchmakingMatchRoomOptions(
  input: unknown = {}
): NormalizedMatchRoomOptions {
  if (!isRecord(input)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const settings =
    input["settings"] === undefined
      ? {}
      : normalizeJsonObject(input["settings"]);
  const metadata =
    input["metadata"] === undefined
      ? {}
      : normalizeJsonObject(input["metadata"]);
  const firstTeamIds = input["teamIds"];
  const secondTeamIds = input["teams"];

  if (
    firstTeamIds !== undefined &&
    secondTeamIds !== undefined &&
    JSON.stringify(firstTeamIds) !== JSON.stringify(secondTeamIds)
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "teamIds と teams に異なるチームを指定できません。"
    });
  }

  const teamIdsValue =
    firstTeamIds ?? secondTeamIds ?? DEFAULT_MATCHMAKING_MATCH_TEAM_IDS;

  if (
    !Array.isArray(teamIdsValue) ||
    teamIdsValue.length !== 2 ||
    !teamIdsValue.every(isNonEmptyString)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "対戦ルームのチームは異なる 2 件の識別子で指定してください。"
    });
  }

  const teamIds = teamIdsValue.map((teamId) => teamId.trim());

  if (
    teamIds[0] === teamIds[1] ||
    teamIds.some((teamId) => teamId.length > 128)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "対戦ルームのチーム識別子が正しくありません。"
    });
  }

  const maxPlayers =
    input["maxPlayers"] === undefined
      ? 2
      : normalizePositiveSafeInteger(input["maxPlayers"], "maxPlayers");
  const minimumPlayers =
    input["minimumPlayers"] === undefined
      ? 2
      : normalizePositiveSafeInteger(
          input["minimumPlayers"],
          "minimumPlayers"
        );
  const requireAllPlayersReady = input["requireAllPlayersReady"] ?? false;

  if (
    typeof requireAllPlayersReady !== "boolean" ||
    maxPlayers < 2 ||
    minimumPlayers < 2 ||
    minimumPlayers > maxPlayers
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "対戦ルームのプレイヤー数設定が正しくありません。"
    });
  }

  const maxAttempts =
    input["maxAttempts"] === undefined
      ? DEFAULT_MATCHMAKING_MATCH_MAX_ATTEMPTS
      : normalizePositiveSafeInteger(input["maxAttempts"], "maxAttempts");

  return {
    settingsJson: JSON.stringify(settings),
    metadataJson: JSON.stringify(metadata),
    teamIds: Object.freeze(teamIds),
    maxPlayers,
    minimumPlayers,
    requireAllPlayersReady,
    maxAttempts
  };
}

function parseMatchRoomOptions(value: string): NormalizedMatchRoomOptions {
  try {
    return normalizeMatchmakingMatchRoomOptions(JSON.parse(value));
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }

    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function createMatchRoomRecord(
  matchId: string,
  candidate: MatchCandidate,
  pool: MatchmakingPool,
  options: NormalizedMatchRoomOptions
): MatchmakingMatchRoomRecord {
  const settings = parseJsonObject(options.settingsJson);
  const configuredMetadata = parseJsonObject(options.metadataJson);
  const metadata = {
    ...configuredMetadata,
    candidateId: candidate.id,
    matchId,
    poolId: pool.id,
    gameId: pool.gameId,
    seasonId: pool.seasonId,
    mode: pool.mode,
    region: pool.region
  };

  return deepFreeze({
    id: createMatchmakingRoomId(matchId),
    kind: "match",
    matchId,
    pool,
    settings: toMatchmakingAttributeObject(settings),
    metadata: toMatchmakingAttributeObject(metadata)
  });
}

function createMatchRoomInitialization(
  matchId: string,
  room: MatchmakingMatchRoomRecord,
  first: TicketRow,
  second: TicketRow,
  options: NormalizedMatchRoomOptions
): RoomInitializationOptions {
  const ticketRows = [first, second] as const;
  const participants: readonly Participant[] = ticketRows.map(
    (ticket, index) => ({
      kind: "player" as const,
      id: `participant_${matchId}_${index + 1}`,
      player: { id: ticket.playerId },
      teamId: options.teamIds[index]!,
      ready: false
    })
  );
  const teams: readonly Team[] = options.teamIds.map((id) => ({ id }));

  return {
    room: room as unknown as MatchRoom,
    participants,
    teams,
    maxPlayers: options.maxPlayers,
    minimumPlayers: options.minimumPlayers,
    requireAllPlayersReady: options.requireAllPlayersReady
  };
}

function parseStoredRoomInitialization(
  value: string
): RoomInitializationOptions {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed) || !isRecord(parsed["room"])) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return parsed as unknown as RoomInitializationOptions;
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }

    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function normalizeMatchIntentIdentifier(
  value: string | { readonly matchId?: string; readonly candidateId?: string }
): { readonly kind: "match" | "candidate"; readonly value: string } {
  if (isNonEmptyString(value)) {
    return value.startsWith("match_")
      ? { kind: "match", value }
      : { kind: "candidate", value };
  }

  if (isRecord(value)) {
    if (isNonEmptyString(value["matchId"])) {
      return { kind: "match", value: value["matchId"] };
    }

    if (isNonEmptyString(value["candidateId"])) {
      return { kind: "candidate", value: value["candidateId"] };
    }
  }

  throw new FlareLobbyError("INVALID_PAYLOAD");
}

function normalizePositiveSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 1 以上の安全な整数で指定してください。`
    });
  }

  return value;
}

function getMatchSettlementErrorCode(error: unknown): FlareLobbyErrorCode {
  return error instanceof FlareLobbyError ? error.code : "CONNECTION_FAILED";
}

function isRetryableMatchSettlementError(
  code: FlareLobbyErrorCode
): boolean {
  return ![
    "INVALID_PAYLOAD",
    "INVALID_MESSAGE",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "ROOM_FULL",
    "ROOM_FINISHED",
    "CANCELLED",
    "UNSUPPORTED_PROTOCOL_VERSION",
    "UNKNOWN_EVENT"
  ].includes(code);
}

function getMatchSettlementRetryDelay(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  return Math.min(
    DEFAULT_MATCHMAKING_MATCH_RETRY_DELAY_MS * 2 ** exponent,
    DEFAULT_MATCHMAKING_MATCH_MAX_RETRY_DELAY_MS
  );
}

function normalizeCreation(
  options: MatchmakingTicketCreationOptions,
  pool: PoolRow,
  principal: Principal
): NormalizedCreation {
  if (!isRecord(options)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const requestId = normalizeRequestId(options["requestId"]);
  const configuredPool = options["pool"];

  if (configuredPool !== undefined) {
    const normalizedPool = normalizePool(configuredPool);

    if (!samePool(pool, { pool: normalizedPool, poolKey: createMatchmakingPoolKey(normalizedPool) })) {
      throw new FlareLobbyError("CONFLICT", {
        message: "作成要求の Match Pool が接続先の Pool と一致しません。"
      });
    }
  }

  const playerClaim = options["playerId"];

  if (playerClaim !== undefined && playerClaim !== principal.playerId) {
    throw new FlareLobbyError("FORBIDDEN");
  }

  const rating = normalizeRating(options["rating"], principal.playerId, pool.poolId);
  const region =
    options["region"] === undefined
      ? pool.region
      : normalizeNonEmptyString(options["region"]);

  if (region !== pool.region) {
    throw new FlareLobbyError("CONFLICT", {
      message: "チケットのリージョンが Match Pool と一致しません。"
    });
  }

  const inputMethod = normalizeInputMethod(
    options["inputMethod"],
    options["inputMode"]
  );
  const searchAttributes =
    options["searchAttributes"] === undefined
      ? {}
      : normalizeJsonObject(options["searchAttributes"]);
  const createdAtMs = Date.now();
  const expiresAtProvided =
    options["expiresAt"] !== undefined || options["ttlMs"] !== undefined;
  const expiresAtMs = normalizeExpiresAt(
    options["expiresAt"],
    options["ttlMs"],
    createdAtMs
  );
  const requestPayload: JsonObject = {
    poolKey: createMatchmakingPoolKey(toPool(pool)),
    rating,
    region,
    inputMethod,
    searchAttributes,
    ...(expiresAtProvided ? { expiresAtMs } : {})
  };

  return {
    requestId,
    requestPayloadJson: JSON.stringify(requestPayload),
    ratingValue: rating,
    region,
    inputMethod,
    searchAttributesJson: JSON.stringify(searchAttributes),
    expiresAtMs,
    createdAtMs
  };
}

function normalizeCancellation(
  options: MatchmakingTicketCancellationOptions
): NormalizedCancellation {
  if (!isRecord(options)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const ticketId = normalizeTicketId(options["ticketId"]);
  const requestId =
    options["requestId"] === undefined
      ? null
      : normalizeRequestId(options["requestId"]);
  const requestPayload =
    options["requestPayload"] === undefined
      ? { ticketId }
      : options["requestPayload"];

  if (!isJsonValue(requestPayload)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    ticketId,
    requestId,
    requestPayloadJson: JSON.stringify(requestPayload)
  };
}

function normalizeCandidate(
  value: unknown,
  pool: PoolRow
): MatchCandidate {
  if (!isRecord(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const candidateId = normalizeNonEmptyString(value["id"]);
  const ticketIdsValue = value["ticketIds"];

  if (
    !Array.isArray(ticketIdsValue) ||
    ticketIdsValue.length !== 2 ||
    !ticketIdsValue.every(isNonEmptyString) ||
    ticketIdsValue[0] === ticketIdsValue[1]
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const firstTicketId = ticketIdsValue[0];
  const secondTicketId = ticketIdsValue[1];

  if (!isNonEmptyString(firstTicketId) || !isNonEmptyString(secondTicketId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const candidatePool = normalizePool(value["pool"]);

  if (!samePool(pool, { pool: candidatePool, poolKey: createMatchmakingPoolKey(candidatePool) })) {
    throw new FlareLobbyError("CONFLICT", {
      message: "候補の Match Pool が接続先の Pool と一致しません。"
    });
  }

  const createdAtValue = value["createdAt"];
  const createdAt =
    isTimestamp(createdAtValue)
      ? createdAtValue
      : new Date().toISOString();

  return deepFreeze({
    id: candidateId,
    pool: candidatePool,
    ticketIds: [firstTicketId, secondTicketId] as const,
    createdAt
  });
}

function normalizeMatchResult(
  value: unknown,
  pool: PoolRow
): MatchmakingMatchResult {
  if (!isRecord(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const matchId = normalizeNonEmptyString(value["matchId"]);
  const candidate = normalizeCandidate(value["candidate"], pool);
  const room = normalizeMatchRoom(value["room"], pool);
  const createdAt =
    isTimestamp(value["createdAt"])
      ? value["createdAt"]
      : new Date().toISOString();

  return deepFreeze({ matchId, candidate, room, createdAt });
}

function normalizeMatchRoom(
  value: unknown,
  pool: PoolRow
): MatchmakingMatchRoomRecord {
  if (!isRecord(value) || value["kind"] !== "match") {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const roomPool = normalizePool(value["pool"]);

  if (
    !samePool(pool, {
      pool: roomPool,
      poolKey: createMatchmakingPoolKey(roomPool)
    })
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "成立結果の Room が Match Pool と一致しません。"
    });
  }

  return deepFreeze({
    id: normalizeNonEmptyString(value["id"]),
    kind: "match",
    matchId: normalizeNonEmptyString(value["matchId"]),
    pool: roomPool,
    settings: toMatchmakingAttributeObject(
      normalizeJsonObject(value["settings"])
    ),
    metadata: toMatchmakingAttributeObject(
      normalizeJsonObject(value["metadata"])
    )
  });
}

function normalizeRating(
  value: unknown,
  playerId: string,
  poolId: string
): number {
  const ratingValue =
    typeof value === "number"
      ? value
      : isRecord(value)
        ? value["value"]
        : undefined;

  if (
    typeof ratingValue !== "number" ||
    !Number.isFinite(ratingValue) ||
    !Number.isSafeInteger(ratingValue)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "レーティングは安全な整数で指定してください。"
    });
  }

  if (isRecord(value)) {
    const ratingPlayerId = value["playerId"];
    const ratingPoolId = value["poolId"];

    if (
      (ratingPlayerId !== undefined && ratingPlayerId !== playerId) ||
      (ratingPoolId !== undefined && ratingPoolId !== poolId)
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "レーティングの主体または Pool が一致しません。"
      });
    }
  }

  return ratingValue;
}

function normalizeInputMethod(
  inputMethod: unknown,
  inputMode: unknown
): string {
  if (inputMethod !== undefined && inputMode !== undefined && inputMethod !== inputMode) {
    throw new FlareLobbyError("CONFLICT", {
      message: "inputMethod と inputMode に異なる値を指定できません。"
    });
  }

  const value = inputMethod ?? inputMode ?? "unknown";
  const normalized = normalizeNonEmptyString(value);

  if (normalized.length > 128) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return normalized;
}

function normalizeExpiresAt(
  expiresAt: unknown,
  ttlMs: unknown,
  now: number
): number {
  if (expiresAt !== undefined && ttlMs !== undefined) {
    throw new FlareLobbyError("CONFLICT", {
      message: "expiresAt と ttlMs は同時に指定できません。"
    });
  }

  if (expiresAt !== undefined) {
    if (typeof expiresAt === "number") {
      if (!isSafeTimestamp(expiresAt)) {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }
      return expiresAt;
    }

    if (isTimestamp(expiresAt)) {
      const value = Date.parse(expiresAt);
      if (!isSafeTimestamp(value)) {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }
      return value;
    }

    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  if (ttlMs !== undefined) {
    if (!isSafeTimestamp(ttlMs)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const value = now + ttlMs;
    if (!isSafeTimestamp(value)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }
    return value;
  }

  const defaultExpiry = now + DEFAULT_MATCHMAKING_TICKET_TTL_MS;
  if (!isSafeTimestamp(defaultExpiry)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return defaultExpiry;
}

function normalizeEventQuery(options: MatchmakingTicketEventQueryOptions): {
  readonly ticketId: string;
  readonly afterSequence: number;
} {
  if (!isRecord(options)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    ticketId: normalizeTicketId(options["ticketId"]),
    afterSequence: parseAfterSequence(options["afterSequence"])
  };
}

function normalizeRequestId(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 1_024) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function normalizeTicketId(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 256) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function normalizeNonEmptyString(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 1_024) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function normalizeJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return deepFreeze(value);
}

/**
 * Cloudflare RPC の構造的な直列化型が再帰 JSON 型で深くなりすぎないよう、
 * 公開する境界型へ変換します。保存値と実行時の payload は JsonObject のままです。
 */
function toMatchmakingAttributeObject(
  value: JsonObject
): MatchmakingAttributeObject {
  return value as unknown as MatchmakingAttributeObject;
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    return normalizeJsonObject(parsed);
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function parseStoredTicketResult(value: string): MatchmakingTicketRecord {
  try {
    const parsed: unknown = JSON.parse(value);

    if (
      !isRecord(parsed) ||
      !isNonEmptyString(parsed["id"]) ||
      !isMatchmakingTicketStatus(parsed["status"]) ||
      !isRecord(parsed["pool"]) ||
      !isRecord(parsed["player"]) ||
      !isNonEmptyString(parsed["player"]["id"])
    ) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return deepFreeze(parsed as unknown as MatchmakingTicketRecord);
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function parseCandidate(value: string): MatchCandidate {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed)) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const pool = normalizePool(parsed["pool"]);
    const ticketIds = parsed["ticketIds"];

    if (
      !isNonEmptyString(parsed["id"]) ||
      !Array.isArray(ticketIds) ||
      ticketIds.length !== 2 ||
      !ticketIds.every(isNonEmptyString) ||
      !isTimestamp(parsed["createdAt"])
    ) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const firstTicketId = ticketIds[0];
    const secondTicketId = ticketIds[1];

    if (!isNonEmptyString(firstTicketId) || !isNonEmptyString(secondTicketId)) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return deepFreeze({
      id: parsed["id"],
      pool,
      ticketIds: [firstTicketId, secondTicketId] as const,
      createdAt: parsed["createdAt"]
    });
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function parseMatchResult(value: string): MatchmakingMatchResult {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed)) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const candidate = parseCandidate(JSON.stringify(parsed["candidate"]));
    const roomValue = parsed["room"];

    if (
      !isNonEmptyString(parsed["matchId"]) ||
      !isRecord(roomValue) ||
      roomValue["kind"] !== "match" ||
      !isNonEmptyString(roomValue["id"]) ||
      !isNonEmptyString(roomValue["matchId"]) ||
      !isTimestamp(parsed["createdAt"])
    ) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const roomPool = normalizePool(roomValue["pool"]);
    const room = {
      id: roomValue["id"],
      kind: "match" as const,
      matchId: roomValue["matchId"],
      pool: roomPool,
      settings: toMatchmakingAttributeObject(
        normalizeJsonObject(roomValue["settings"])
      ),
      metadata: toMatchmakingAttributeObject(
        normalizeJsonObject(roomValue["metadata"])
      )
    };

    return deepFreeze({
      matchId: parsed["matchId"],
      candidate,
      room,
      createdAt: parsed["createdAt"]
    });
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function parseAfterSequence(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return isSafeTimestamp(parsed) ? parsed : invalidSequence();
  }

  if (isSafeTimestamp(value)) {
    return value;
  }

  return invalidSequence();
}

function invalidSequence(): never {
  throw new FlareLobbyError("INVALID_PAYLOAD");
}

function parseAfterSequenceFromMessage(message: string | ArrayBuffer): number | null {
  let text: string;

  if (typeof message === "string") {
    text = message;
  } else {
    try {
      text = new TextDecoder().decode(message);
    } catch {
      return null;
    }
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      return parseAfterSequence(parsed["afterSequence"]);
    }
    return parseAfterSequence(parsed);
  } catch {
    return null;
  }
}

function parseTicketEventPath(
  pathname: string
): { readonly ticketId: string } | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const eventSegmentIndex = segments.findIndex(
    (segment) => segment === "events" || segment === "ws"
  );

  if (eventSegmentIndex <= 0) {
    return null;
  }

  try {
    return { ticketId: normalizeTicketId(decodeURIComponent(segments[eventSegmentIndex - 1]!)) };
  } catch {
    return null;
  }
}

function readGatewayToken(request: Request): string | null {
  const direct = request.headers.get("x-flarelobby-gateway-token");
  if (isNonEmptyString(direct)) {
    return direct;
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length);
    return isNonEmptyString(token) ? token : null;
  }

  return null;
}

function ticketEventTag(ticketId: string): string {
  return `ticket:${ticketId}`;
}

function getTicketSearchWidth(
  ticket: MatchmakingTicketRecord,
  policy: NormalizedMatchmakingSearchPolicy,
  atMs: number
): number {
  const queuedAt =
    ticket.status === "waiting" ? ticket.queuedAt : ticket.createdAt;
  const queuedAtMs = Date.parse(queuedAt);

  if (!Number.isFinite(queuedAtMs)) {
    return 0;
  }

  return getMatchmakingSearchWidth(
    policy,
    Math.max(0, atMs - queuedAtMs)
  );
}

function sendTicketEvent(
  webSocket: WebSocket,
  event: MatchmakingTicketEvent
): void {
  webSocket.send(
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      event: "matchmaking.ticket",
      revision: event.poolRevision,
      payload: {
        ticket: event.ticket,
        waitingCount: event.waitingCount,
        activeCount: event.activeCount,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        searchWidth: event.searchWidth
      }
    })
  );
}

function isGatewayPrincipalEnvelope(
  value: unknown
): value is GatewayPrincipalEnvelope {
  return isRecord(value) && isNonEmptyString(value["token"]);
}

function isMatchmakingTicketStatus(value: unknown): value is MatchmakingTicketStatus {
  return (
    value === "creating" ||
    value === "waiting" ||
    value === "reserved" ||
    value === "matched" ||
    value === "cancelled" ||
    value === "expired"
  );
}

function isJsonValue(
  value: unknown,
  ancestors = new Set<object>()
): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") {
    return false;
  }

  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, ancestors));
    }

    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item, ancestors)
    );
  } finally {
    ancestors.delete(value);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => isJsonValue(item));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeNow(value: unknown): number {
  const now = value === undefined ? Date.now() : value;
  if (!isSafeTimestamp(now)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return now;
}

function normalizeSearchNow(value: number | Timestamp | undefined): number {
  if (value === undefined) {
    return Date.now();
  }

  if (typeof value === "number") {
    return normalizeNow(value);
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return normalizeNow(parsed);
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return value;
}
