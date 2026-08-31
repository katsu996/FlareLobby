import { FlareLobbyError } from "@flarelobby/core";
import type {
  MatchCandidate,
  MatchmakingPool,
  MatchmakingTicketId,
} from "@flarelobby/core";
import type {
  MatchmakingMatchResult,
  MatchmakingTicketRecord,
  MatchmakingTicketCreationOptions,
  MatchmakingTicketCancellationOptions,
  MatchmakingTicketReservationOptions,
  MatchmakingTicketMatchOptions,
  MatchmakingTicketEvent,
  MatchmakingTicketEventQueryOptions,
  MatchmakingTicketMember,
  NormalizedCancellation,
  NormalizedCreation,
  ProcessedCommandRow,
} from "../match-pool.js";
import type { GatewayPrincipalEnvelope } from "../security.js";
import type { Principal } from "@flarelobby/core";
import type { FlareLobbyObservabilityContext } from "../observability.js";

/**
 * MatchPool ticket queue management logic.
 * Handles ticket creation, retrieval, cancellation, expiry, reservation, and matching.
 */

export interface TicketQueueConfig {
  readonly pool: MatchmakingPool;
  readonly poolKey: string;
  readonly tokenSecret: string;
  readonly partyQueueStub: PartyQueueStub;
}

export interface PartyQueueStub {
  beginQueueTicket(options: {
    readonly gatewayPrincipal: GatewayPrincipalEnvelope;
    readonly ticketId: string;
    readonly poolKey: string;
  }): Promise<PartyQueueStartResult>;
  endQueueTicket(options: { readonly ticketId: string }): Promise<void>;
}

export interface PartyQueueStartResult {
  readonly leaderPlayerId: string;
  readonly partyRevision: number;
  readonly memberIds: readonly string[];
}

export interface StorageAdapter {
  exec(sql: string, ...args: unknown[]): void;
  query<T>(sql: string, ...args: unknown[]): T | undefined;
  queryAll<T>(sql: string, ...args: unknown[]): readonly T[];
  setAlarm(timestamp: number): Promise<void>;
  getAlarm(): Promise<number | null>;
}

export interface TicketRow {
  ticket_id: string;
  pool_id: string;
  player_id: string;
  rating_value: number;
  created_at: string;
  queued_at: string | null;
  region: string | null;
  input_method: "solo" | "party" | "team";
  search_attributes_json: string;
  status:
    | "creating"
    | "waiting"
    | "reserved"
    | "matched"
    | "cancelled"
    | "expired";
  expires_at_ms: number;
  reserved_candidate_json: string | null;
  reserved_at: string | null;
  match_result_json: string | null;
  matched_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
  owner_player_id: string;
  members_json: string | null;
  party_id: string | null;
  party_revision: number | null;
}

interface InFlightCreateRequest {
  readonly playerId: string;
  readonly payloadJson: string;
  readonly promise: Promise<MatchmakingTicketRecord>;
}

/**
 * Ticket queue management class.
 * SQLite operations go through StorageAdapter for testability.
 */
export class TicketQueueDO {
  private readonly config: TicketQueueConfig;
  private readonly storage: StorageAdapter;
  private readonly inFlightCreateRequests = new Map<
    string,
    InFlightCreateRequest
  >();

  constructor(config: TicketQueueConfig, storage: StorageAdapter) {
    this.config = config;
    this.storage = storage;
  }

  /**
   * Create a ticket and transition to waiting state.
   * Idempotency: same requestId + same input returns existing ticket.
   */
  async createTicket(
    options: MatchmakingTicketCreationOptions,
    _observability: FlareLobbyObservabilityContext,
  ): Promise<MatchmakingTicketRecord> {
    const principal = await this.requireGatewayPrincipal(
      options.gatewayPrincipal,
    );
    const normalized = normalizeCreation(options, this.config.pool, principal);
    const existingCommand = this.readProcessedCommand(normalized.requestId);

    if (existingCommand !== undefined) {
      if (
        existingCommand.command !== "matchmaking.create" ||
        existingCommand.playerId !== principal.playerId ||
        existingCommand.payloadJson !== normalized.requestPayloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "Same requestId with different matchmaking conditions.",
        });
      }

      const storedTicket = parseStoredTicketResult(existingCommand.resultJson);
      const currentTicket = this.readTicket(storedTicket.id);
      return currentTicket ?? storedTicket;
    }

    const inFlight = this.inFlightCreateRequests.get(normalized.requestId);

    if (inFlight !== undefined) {
      if (
        inFlight.playerId !== principal.playerId ||
        inFlight.payloadJson !== normalized.requestPayloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "Same requestId with different matchmaking conditions.",
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
      },
    );
    inFlightPromise.catch(() => undefined);
    this.inFlightCreateRequests.set(normalized.requestId, {
      playerId: principal.playerId,
      payloadJson: normalized.requestPayloadJson,
      promise: inFlightPromise,
    });

    try {
      const ticketId = `ticket_${crypto.randomUUID()}`;
      const createdAt = new Date(normalized.createdAtMs).toISOString();
      const searchAttributesJson = normalized.searchAttributesJson;

      const active = this.readActiveTicketByPlayer(principal.playerId);

      if (active !== undefined) {
        throw new FlareLobbyError("CONFLICT", {
          message: "Active ticket already exists in this pool.",
        });
      }

      let ownerId = principal.playerId;
      let membersJson: string | null = null;
      let ratingValue = normalized.ratingValue;
      let partyId: string | null = null;
      let partyRevision: number | null = null;
      let partyFrozen = false;
      let memberIds: readonly string[] = [principal.playerId];

      try {
        if (
          isRecord(options.party) &&
          isNonEmptyString(options.party["partyId"])
        ) {
          partyId = options.party["partyId"];
          const partyStub = this.config.partyQueueStub;
          const queueStart = await partyStub.beginQueueTicket({
            gatewayPrincipal: options.gatewayPrincipal,
            ticketId,
            poolKey: this.config.poolKey,
          });
          partyFrozen = true;

          const partyMemberIds = queueStart?.memberIds;
          if (!partyMemberIds) {
            throw new FlareLobbyError("INVALID_PAYLOAD", {
              message: "Party member IDs not available.",
            });
          }
          // @ts-expect-error - narrowed by check above
          if (partyMemberIds.length > this.config.pool.maxPartySize) {
            throw new FlareLobbyError("INVALID_PAYLOAD", {
              message: "Party size exceeds pool maxPartySize.",
            });
          }

          ownerId = queueStart.leaderPlayerId;
          partyRevision = queueStart.partyRevision;
          memberIds = partyMemberIds;
          const members = await this.snapshotMemberRatings(memberIds);
          membersJson = JSON.stringify(members);
          ratingValue = roundHalfAwayFromZero(
            members.reduce((sum, member) => sum + member.ratingValue, 0) /
              members.length,
          );
        }

        try {
          this.storage.exec(
            `INSERT INTO flarelobby_matchmaking_tickets (
            ticket_id, pool_id, player_id, rating_value, created_at, queued_at,
            region, input_method, search_attributes_json, status, expires_at_ms,
            reserved_candidate_json, reserved_at, match_result_json, matched_at,
            cancelled_at, expired_at, owner_player_id, members_json, party_id,
            party_revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
            ticketId,
            this.config.pool.id,
            ownerId,
            ratingValue,
            createdAt,
            createdAt,
            normalized.region,
            normalized.inputMethod,
            searchAttributesJson,
            normalized.expiresAtMs,
            ownerId,
            membersJson,
            partyId,
            partyRevision,
          );

          const ticket = this.readTicket(ticketId);
          if (ticket === null) {
            throw new FlareLobbyError("CONNECTION_FAILED");
          }

          // Create member tickets
          for (const memberId of memberIds) {
            if (memberId !== ownerId) {
              const memberTicketId = `ticket_${crypto.randomUUID()}`;
              this.storage.exec(
                `INSERT INTO flarelobby_matchmaking_tickets (
                ticket_id, pool_id, player_id, rating_value, created_at, queued_at,
                region, input_method, search_attributes_json, status, expires_at_ms,
                reserved_candidate_json, reserved_at, match_result_json, matched_at,
                cancelled_at, expired_at, owner_player_id, members_json, party_id,
                party_revision
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
                memberTicketId,
                this.config.pool.id,
                memberId,
                ratingValue,
                createdAt,
                createdAt,
                normalized.region,
                normalized.inputMethod,
                searchAttributesJson,
                normalized.expiresAtMs,
                ownerId,
                membersJson,
                partyId,
                partyRevision,
              );
            }
          }

          // Transition to 'waiting'
          this.storage.exec(
            `UPDATE flarelobby_matchmaking_tickets
             SET status = 'waiting', queued_at = ?
             WHERE ticket_id = ?`,
            createdAt,
            ticketId,
          );

          for (const memberId of memberIds) {
            if (memberId !== ownerId) {
              this.storage.exec(
                `UPDATE flarelobby_matchmaking_tickets
                 SET status = 'waiting', queued_at = ?
                 WHERE owner_player_id = ? AND party_id = ? AND ticket_id != ?`,
                createdAt,
                ownerId,
                partyId,
                ticketId,
              );
            }
          }

          const finalTicket = this.readTicket(ticketId);
          if (finalTicket === null) {
            throw new FlareLobbyError("CONNECTION_FAILED");
          }

          resolveInFlight(finalTicket);
          this.inFlightCreateRequests.delete(normalized.requestId);
          return finalTicket;
        } catch (error) {
          if (partyFrozen && partyId !== null) {
            try {
              await this.config.partyQueueStub.endQueueTicket({ ticketId });
            } catch {
              // Party cleanup failure - log only
            }
          }
          rejectInFlight(error);
          this.inFlightCreateRequests.delete(normalized.requestId);
          throw error;
        }
      } catch (error) {
        rejectInFlight(error);
        this.inFlightCreateRequests.delete(normalized.requestId);
        throw error;
      }
    } catch (error) {
      rejectInFlight(error);
      this.inFlightCreateRequests.delete(normalized.requestId);
      throw error;
    }
  }

  /** Get a ticket by ID */
  public getTicket(
    ticketId: MatchmakingTicketId,
  ): MatchmakingTicketRecord | null {
    return this.readTicket(ticketId);
  }

  /** Get principal's active ticket */
  public async getTicketForPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope,
  ): Promise<MatchmakingTicketRecord | null> {
    const principal = await this.requireGatewayPrincipal(gatewayPrincipal);
    return this.readActiveTicketByPlayer(principal.playerId);
  }

  /** Cancel a ticket */
  public async cancelTicket(
    options: MatchmakingTicketCancellationOptions,
    _observability: FlareLobbyObservabilityContext,
  ): Promise<MatchmakingTicketRecord> {
    const principal = await this.requireGatewayPrincipal(
      options.gatewayPrincipal,
    );
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
          message: "Same requestId with different cancellation conditions.",
        });
      }

      const storedTicket = parseStoredTicketResult(existingCommand.resultJson);
      const currentTicket = this.readTicket(storedTicket.id);
      return currentTicket ?? storedTicket;
    }

    const ticket = this.readActiveTicketByPlayer(principal.playerId);
    if (ticket === null) {
      throw new FlareLobbyError("CONFLICT", {
        message: "No active ticket found to cancel.",
      });
    }

    const cancelledAt = new Date().toISOString();
    this.storage.exec(
      `UPDATE flarelobby_matchmaking_tickets
       SET status = 'cancelled', cancelled_at = ?
       WHERE ticket_id = ?`,
      cancelledAt,
      ticket.id,
    );

    const updatedTicket = this.readTicket(ticket.id);
    if (updatedTicket === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    this.storeOperationResult(
      {
        requestId: normalized.requestId,
        payloadJson: normalized.requestPayloadJson,
      },
      "matchmaking.cancel",
      updatedTicket,
    );

    return updatedTicket;
  }

  /** Reserve candidate atomically */
  public async reserveCandidate(
    options: MatchmakingTicketReservationOptions,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    const candidate = normalizeCandidate(options?.candidate, this.config.pool);
    const firstId = candidate.ticketIds[0];
    const secondId = candidate.ticketIds[1];
    const first = this.readTicketRow(firstId);
    const second = this.readTicketRow(secondId);

    if (first === undefined || second === undefined || firstId === secondId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "Candidate tickets not found.",
      });
    }

    if (
      first.status === "reserved" &&
      second.status === "reserved" &&
      first.reserved_candidate_json !== null &&
      second.reserved_candidate_json !== null &&
      parseCandidate(first.reserved_candidate_json).id === candidate.id &&
      parseCandidate(second.reserved_candidate_json).id === candidate.id
    ) {
      const retriedFirst = this.readTicket(firstId);
      const retriedSecond = this.readTicket(secondId);

      if (retriedFirst === null || retriedSecond === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }
      return [retriedFirst, retriedSecond];
    }

    if (first.status !== "waiting" || second.status !== "waiting") {
      throw new FlareLobbyError("CONFLICT", {
        message: "Cannot reserve non-waiting tickets.",
      });
    }

    if (!this.reserveCandidateRows(candidate, Date.now())) {
      throw new FlareLobbyError("CONFLICT", {
        message: "Cannot reserve non-waiting tickets.",
      });
    }

    const reservedFirst = this.readTicket(firstId);
    const reservedSecond = this.readTicket(secondId);

    if (reservedFirst === null || reservedSecond === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return [reservedFirst, reservedSecond];
  }

  /** Apply match result */
  public async matchCandidate(
    options: MatchmakingTicketMatchOptions,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    const pool = this.config.pool;
    const result = normalizeMatchResult(options?.result, pool);
    return this.applyMatchResult(result, pool, true, options.observability);
  }

  /** Expire a ticket */
  public async expireTicket(
    ticketId: MatchmakingTicketId,
    now: number,
  ): Promise<MatchmakingTicketRecord> {
    const ticket = this.readTicket(ticketId);
    if (ticket === null) {
      throw new FlareLobbyError("CONFLICT", {
        message: "Ticket to expire not found.",
      });
    }

    const expiredAt = new Date(now).toISOString();
    this.storage.exec(
      `UPDATE flarelobby_matchmaking_tickets
       SET status = 'expired', expired_at = ?
       WHERE ticket_id = ?`,
      expiredAt,
      ticketId,
    );

    const updatedTicket = this.readTicket(ticketId);
    if (updatedTicket === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return updatedTicket;
  }

  /** Expire all due tickets */
  public async expireDueTickets(
    now: number,
  ): Promise<readonly MatchmakingTicketRecord[]> {
    const expiredTickets: MatchmakingTicketRecord[] = [];
    const rows = this.storage.queryAll<TicketRow>(
      `SELECT ticket_id FROM flarelobby_matchmaking_tickets
       WHERE status = 'waiting' AND expires_at_ms <= ?`,
      now,
    );

    for (const row of rows) {
      const expiredAt = new Date(now).toISOString();
      this.storage.exec(
        `UPDATE flarelobby_matchmaking_tickets
         SET status = 'expired', expired_at = ?
         WHERE ticket_id = ?`,
        expiredAt,
        row.ticket_id,
      );
      const ticket = this.readTicket(row.ticket_id);
      if (ticket !== null) {
        expiredTickets.push(ticket);
      }
    }

    return Object.freeze(expiredTickets);
  }

  /** Get ticket events */
  public async getTicketEvents(
    gatewayPrincipal: GatewayPrincipalEnvelope,
    options: MatchmakingTicketEventQueryOptions,
  ): Promise<readonly MatchmakingTicketEvent[]> {
    const principal = await this.requireGatewayPrincipal(gatewayPrincipal);
    const normalized = normalizeEventQuery(options);
    const ticket = this.readTicketRow(normalized.ticketId);

    if (ticket === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "Target ticket not found.",
      });
    }

    if (ticket.player_id !== principal.playerId) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    const rows = this.storage.queryAll<{ event_json: string }>(
      `SELECT event_json FROM flarelobby_matchmaking_ticket_events
       WHERE ticket_id = ? AND event_id > ?
       ORDER BY event_id ASC
       LIMIT ?`,
      normalized.ticketId,
      normalized.afterEventId ?? 0,
      normalized.limit ?? 100,
    );

    return rows.map((r) => JSON.parse(r.event_json) as MatchmakingTicketEvent);
  }

  // ==================== Private Helpers (to be implemented by consumer) ====================

  private async requireGatewayPrincipal(
    _envelope: GatewayPrincipalEnvelope,
  ): Promise<Principal> {
    throw new Error("Not implemented - use DO's resolveGatewayPrincipal");
  }

  private readPoolRow(): MatchmakingPool | undefined {
    throw new Error("Not implemented - use DO's readPoolRow");
  }

  private requirePool(): MatchmakingPool {
    const pool = this.readPoolRow();
    if (pool === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "Uninitialized Match Pool cannot be operated.",
      });
    }
    return pool;
  }

  private readTicketRow(ticketId: string): TicketRow | undefined {
    return this.storage.query<TicketRow>(
      `SELECT * FROM flarelobby_matchmaking_tickets WHERE ticket_id = ?`,
      ticketId,
    );
  }

  private readTicket(ticketId: string): MatchmakingTicketRecord | null {
    const row = this.readTicketRow(ticketId);
    return row === undefined ? null : this.toTicket(row);
  }

  private readActiveTicketByPlayer(
    playerId: string,
  ): MatchmakingTicketRecord | null {
    const row = this.storage.query<TicketRow>(
      `SELECT * FROM flarelobby_matchmaking_tickets
       WHERE player_id = ? AND status IN ('creating', 'waiting', 'reserved')
       ORDER BY created_at DESC LIMIT 1`,
      playerId,
    );
    return row === undefined ? null : this.toTicket(row);
  }

  private readProcessedCommand(
    _requestId: string,
  ): ProcessedCommandRow | undefined {
    throw new Error("Not implemented");
  }

  private storeOperationResult(
    _request: {
      readonly requestId: string | null;
      readonly payloadJson: string;
    },
    _command: string,
    _result: MatchmakingTicketRecord,
  ): void {
    throw new Error("Not implemented");
  }

  private toTicket(_row: TicketRow): MatchmakingTicketRecord {
    throw new Error("Not implemented");
  }

  private snapshotMemberRatings(
    _memberIds: readonly string[],
  ): Promise<MatchmakingTicketMember[]> {
    throw new Error("Not implemented");
  }
  private reserveCandidateRows(
    _candidate: MatchCandidate,
    _now: number,
  ): boolean {
    throw new Error("Not implemented");
  }

  private applyMatchResult(
    _result: MatchmakingMatchResult,
    _pool: MatchmakingPool,
    _verifyRoom: boolean,
    _observability?: FlareLobbyObservabilityContext,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]> {
    throw new Error("Not implemented");
  }
}

// Utility functions
function normalizeCreation(
  _options: MatchmakingTicketCreationOptions,
  _pool: MatchmakingPool,
  _principal: Principal,
): NormalizedCreation {
  throw new Error("Not implemented");
}

function normalizeCancellation(
  _options: MatchmakingTicketCancellationOptions,
): NormalizedCancellation {
  throw new Error("Not implemented");
}

function normalizeCandidate(
  _candidate: unknown,
  _pool: MatchmakingPool,
): MatchCandidate {
  throw new Error("Not implemented");
}

function normalizeMatchResult(
  _result: unknown,
  _pool: MatchmakingPool,
): MatchmakingMatchResult {
  throw new Error("Not implemented");
}

function normalizeEventQuery(_options: MatchmakingTicketEventQueryOptions): {
  readonly ticketId: string;
  readonly afterEventId?: number;
  readonly limit?: number;
} {
  throw new Error("Not implemented");
}

function parseCandidate(_candidateJson: string): MatchCandidate {
  throw new Error("Not implemented");
}

function parseStoredTicketResult(_resultJson: string): MatchmakingTicketRecord {
  throw new Error("Not implemented");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function roundHalfAwayFromZero(value: number): number {
  const rounded = value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
  return Object.is(rounded, -0) ? 0 : rounded;
}
