import { DurableObject } from "cloudflare:workers";
import {
  FlareLobbyError,
  PROTOCOL_VERSION
} from "@flarelobby/core";
import type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MatchCandidate,
  MatchmakingPool,
  MatchmakingTicketStatus,
  Principal,
  Rating,
  Timestamp
} from "@flarelobby/core";

import { createErrorResponse, verifyGatewayPrincipalEnvelope } from "./security.js";
import type { GatewayPrincipalEnvelope } from "./security.js";

/** チケットの既定の待機期限です。設定がない場合は 1 分後に期限切れにします。 */
export const DEFAULT_MATCHMAKING_TICKET_TTL_MS = 60_000;

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

/** Match Pool Durable Object を初期化する入力です。 */
export interface MatchPoolInitializationOptions {
  readonly pool: MatchmakingPool;
}

/** RPC 境界で使う、JSON 直列化可能な対戦ルーム情報です。 */
export type MatchmakingAttributeObject = Readonly<
  Record<string, JsonPrimitive>
>;

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
}

/** チケットのキャンセルを要求する入力です。 */
export interface MatchmakingTicketCancellationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly ticketId: string;
  readonly requestId?: string;
  readonly requestPayload?: JsonValue;
}

/** 候補確保の入力です。候補探索そのものは本 Issue の対象外です。 */
export interface MatchmakingTicketReservationOptions {
  readonly candidate: MatchCandidate;
}

/** 成立処理の入力です。対戦ルーム生成は呼び出し側が行い結果を渡します。 */
export interface MatchmakingTicketMatchOptions {
  readonly result: MatchmakingMatchResult;
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
  readonly occurredAt: Timestamp;
}

/** Match Pool の現在の待機状況です。 */
export interface MatchPoolSnapshot {
  readonly pool: MatchmakingPool;
  readonly revision: number;
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly ticketCount: number;
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

interface NormalizedCancellation {
  readonly ticketId: string;
  readonly requestId: string | null;
  readonly requestPayloadJson: string;
}

/**
 * 1 マッチングプールを 1 Durable Object として扱う SQLite-backed Durable Object です。
 *
 * 候補探索と対戦ルーム生成はこのクラスへ持ち込まず、チケットの状態遷移、
 * 冪等性、期限処理、状態通知だけを強整合に管理します。
 */
export class MatchPoolDurableObject extends DurableObject<Env> {
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
    const normalized = normalizePoolInput(input);
    const existing = this.readPoolRow();

    if (existing !== undefined) {
      if (!samePool(existing, normalized)) {
        throw new FlareLobbyError("CONFLICT", {
          message: "Match Pool Durable Object の識別子が既存状態と一致しません。"
        });
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
        revision,
        created_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, 0, ?)`,
      normalized.pool.id,
      normalized.poolKey,
      normalized.pool.gameId,
      normalized.pool.seasonId,
      normalized.pool.mode,
      normalized.pool.region,
      Date.now()
    );

    const stored = this.readPoolRow();

    if (stored === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return toPool(stored);
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

  /** 待機数と有効チケット数を返します。 */
  public async getSnapshot(): Promise<MatchPoolSnapshot | null> {
    const pool = this.readPoolRow();

    if (pool === undefined) {
      return null;
    }

    const progress = this.readProgress();

    return deepFreeze({
      pool: toPool(pool),
      revision: pool.revision,
      waitingCount: progress.waitingCount,
      activeCount: progress.activeCount,
      ticketCount: progress.ticketCount
    });
  }

  /** マッチングチケットを作成し、待機状態へ遷移させます。 */
  public async createTicket(
    options: MatchmakingTicketCreationOptions
  ): Promise<MatchmakingTicketRecord> {
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

      await this.synchronizeAlarm();
      return parseStoredTicketResult(existingCommand.resultJson);
    }

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

    return ticket;
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
      return [this.toTicket(first), this.toTicket(second)];
    }

    if (first.status !== "waiting" || second.status !== "waiting") {
      throw new FlareLobbyError("CONFLICT", {
        message: "待機中ではないチケットを候補として確保できません。"
      });
    }

    const reservedAtMs = Date.now();
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
    const firstId = result.candidate.ticketIds[0];
    const secondId = result.candidate.ticketIds[1];
    const first = this.readTicketRow(firstId);
    const second = this.readTicketRow(secondId);

    if (first === undefined || second === undefined || firstId === secondId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "成立結果に指定されたチケットが存在しません。"
      });
    }

    if (first.status === "matched" && second.status === "matched") {
      if (
        first.matchResultJson === JSON.stringify(result) &&
        second.matchResultJson === JSON.stringify(result)
      ) {
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

    const matchedAtMs = Date.now();
    const matchedAt = new Date(matchedAtMs).toISOString();
    const resultJson = JSON.stringify(result);

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

    await this.synchronizeAlarm();

    const matchedFirst = this.readTicket(firstId);
    const matchedSecond = this.readTicket(secondId);

    if (matchedFirst === null || matchedSecond === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return [matchedFirst, matchedSecond];
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

  /** Alarm は期限切れ遷移を永続化してから、最も近い期限へ再設定します。 */
  public override async alarm(): Promise<void> {
    await this.expireDueTickets(Date.now());
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
        activeCount: event.activeCount
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
          sequence: row.sequence,
          poolRevision: row.poolRevision,
          type: row.type,
          ticketId: row.ticketId,
          ticket: parseStoredTicketResult(row.ticketJson),
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
    const next = this.ctx.storage.sql
      .exec<{ nextExpiresAt: number | null }>(
        `SELECT MIN(expires_at_ms) AS nextExpiresAt
         FROM flarelobby_matchmaking_tickets
         WHERE status IN ('creating', 'waiting')`
      )
      .one().nextExpiresAt;
    const current = await this.ctx.storage.getAlarm();

    if (next === null) {
      if (current !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }

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
}

function normalizePoolInput(
  input: MatchPoolInitializationOptions | MatchmakingPool
): { readonly pool: MatchmakingPool; readonly poolKey: string } {
  const candidate =
    isRecord(input) && isRecord(input["pool"]) ? input["pool"] : input;
  const pool = normalizePool(candidate);
  return { pool, poolKey: createMatchmakingPoolKey(pool) };
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

  if (!samePool(pool, { pool: roomPool, poolKey: createMatchmakingPoolKey(roomPool) })) {
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
        activeCount: event.activeCount
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
