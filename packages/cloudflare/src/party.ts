import { DurableObject } from "cloudflare:workers";

import { FlareLobbyError } from "@flarelobby/core";
import type {
  PlayerId,
  Principal,
  Revision,
  Timestamp,
} from "@flarelobby/core";

import {
  createErrorResponse,
  readGatewayToken,
  verifyGatewayPrincipalEnvelope,
} from "./security.js";
import type { GatewayPrincipalEnvelope } from "./security.js";

/** パーティーの既定定員です。リーダーを含めます。 */
export const DEFAULT_PARTY_MAX_SIZE = 5;

/** 招待トークンの既定有効期間（ミリ秒）です。 */
export const DEFAULT_PARTY_INVITE_TTL_MS = 10 * 60 * 1_000;

/** 無活動パーティーを掃除するまでの既定待機時間（ミリ秒）です。 */
export const DEFAULT_PARTY_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;

/** パーティーのメンバー役割です。リーダーは常にちょうど 1 人です。 */
export type PartyMemberRole = "leader" | "member";

/** パーティーのメンバーです。 */
export interface PartyMember {
  readonly playerId: PlayerId;
  readonly role: PartyMemberRole;
  readonly joinedAt: Timestamp;
}

/** パーティーへの未使用招待です。単一用途トークンを持ちます。 */
export interface PartyInvite {
  readonly playerId: PlayerId;
  /** 招待受諾でだけ提示する単一用途トークンです。 */
  readonly token: string;
  readonly expiresAt: Timestamp;
  readonly createdAt: Timestamp;
}

/** パーティーの現在状態です。 */
export interface PartySnapshot {
  readonly partyId: string;
  readonly revision: Revision;
  readonly maxPartySize: number;
  readonly members: readonly PartyMember[];
  readonly invites: readonly PartyInvite[];
  /** 待機中のマッチングチケットによる構成変更の凍結状態です。 */
  readonly queuedTicket: {
    readonly ticketId: string;
    readonly poolKey: string;
  } | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** パーティーの状態変更イベントです。 */
export interface PartyEvent {
  readonly sequence: number;
  readonly partyRevision: Revision;
  readonly type:
    | "created"
    | "member_joined"
    | "member_left"
    | "leader_transferred"
    | "invite_created"
    | "queue_started"
    | "queue_ended"
    | "dissolved";
  readonly snapshot: PartySnapshot;
  readonly occurredAt: Timestamp;
}

/** `createParty()` の入力です。 */
export interface PartyCreationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly requestId: string;
  /** 省略時は `DEFAULT_PARTY_MAX_SIZE` を使います。 */
  readonly maxPartySize?: number;
}

/** `inviteMember()` の入力です。 */
export interface PartyInviteOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly requestId: string;
  readonly playerId: string;
  /** 省略時は `DEFAULT_PARTY_INVITE_TTL_MS` を使います。 */
  readonly ttlMs?: number;
}

/** `acceptInvite()` の入力です。 */
export interface PartyInviteAcceptanceOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly requestId: string;
  readonly token: string;
}

/** `leaveParty()`・`transferLeadership()`・`dissolveParty()` の共通入力です。 */
export interface PartyOperationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly requestId?: string;
}

/** `transferLeadership()` の入力です。 */
export interface PartyLeadershipTransferOptions extends PartyOperationOptions {
  readonly playerId: string;
}

/** Match Pool Durable Object から呼び出す、キュー投入時の凍結要求です。 */
export interface PartyQueueStartOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly ticketId: string;
  readonly poolKey: string;
}

/** キュー投入の凍結結果です。チケットはこの構成と `partyRevision` で凍結されます。 */
export interface PartyQueueStartResult {
  readonly leaderPlayerId: PlayerId;
  readonly memberIds: readonly PlayerId[];
  readonly partyRevision: Revision;
}

interface StateRow extends Record<string, SqlStorageValue> {
  partyId: string;
  revision: number;
  maxPartySize: number;
  queuedTicketId: string | null;
  queuedPoolKey: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MemberRow extends Record<string, SqlStorageValue> {
  playerId: string;
  role: PartyMemberRole;
  joinedAt: string;
}

interface InviteRow extends Record<string, SqlStorageValue> {
  playerId: string;
  token: string;
  expiresAtMs: number;
  usedAtMs: number | null;
  createdAt: number;
}

interface EventRow extends Record<string, SqlStorageValue> {
  sequence: number;
  type: PartyEvent["type"];
  snapshotJson: string;
  partyRevision: number;
  occurredAt: string;
}

interface ProcessedCommandRow extends Record<string, SqlStorageValue> {
  requestId: string;
  command: string;
  playerId: string;
  payloadJson: string;
  resultJson: string;
  createdAt: number;
}

/** Match Pool チケットのキャンセルに必要な最小のスタブ契約です。 */
interface MatchPoolCancellationStub {
  cancelTicket(options: {
    gatewayPrincipal: GatewayPrincipalEnvelope;
    ticketId: string;
  }): Promise<unknown>;
}

/**
 * 1 パーティーを 1 Durable Object として扱う SQLite-backed Durable Object です。
 *
 * 識別単位は `partyId` であり、Match Pool から独立した正本を持ちます
 * (ADR-0005)。すべての状態変更はパーティー単位の単調な `revision` を進め、
 * `requestId` 再生セマンティクスを Match Pool と同じ規則で持ちます。
 */
export class PartyDurableObject extends DurableObject<Env> {
  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      migratePartySchema(this.ctx.storage.sql);
    });
  }

  /** Gateway の署名済み主体だけを受け入れます。 */
  public async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope,
  ): Promise<Principal | null> {
    return verifyGatewayPrincipal(gatewayPrincipal, this.env);
  }

  /** パーティーを作成し、呼び出し主体をリーダーへ登録します。 */
  public async createParty(
    options: PartyCreationOptions,
  ): Promise<PartySnapshot> {
    const principal = await requireGatewayPrincipal(options, this.env);
    const normalized = normalizeCreation(options);

    const replayed = this.readProcessedCommand(normalized.requestId);
    if (replayed !== undefined) {
      if (
        !sameProcessedCommand(replayed, "party.create", principal, normalized)
      ) {
        return rejectProcessedCommandConflict();
      }
      return JSON.parse(replayed.resultJson) as PartySnapshot;
    }

    if (this.readStateRow() !== undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "この識別子のパーティーは既に存在します。",
      });
    }

    await this.claimMembership(principal.playerId, this.partyName);

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_party_state (
         singleton_id, party_id, revision, max_party_size,
         queued_ticket_id, queued_pool_key, created_at, updated_at
       ) VALUES (1, ?, 1, ?, NULL, NULL, ?, ?)`,
      this.partyName,
      normalized.maxPartySize,
      now,
      now,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_party_members (party_id, player_id, role, joined_at)
       VALUES (?, ?, 'leader', ?)`,
      this.partyName,
      principal.playerId,
      new Date(now).toISOString(),
    );

    const snapshot = this.requireSnapshot();
    this.appendEvent("created", now);
    this.recordProcessedCommand({
      requestId: normalized.requestId,
      command: "party.create",
      playerId: principal.playerId,
      payloadJson: normalized.payloadJson,
      resultJson: JSON.stringify(snapshot),
      createdAt: now,
    });
    await this.synchronizeAlarm();
    return snapshot;
  }

  /** リーダーが新しいメンバーへ単一用途トークン付きの招待を発行します。 */
  public async inviteMember(options: PartyInviteOptions): Promise<PartyInvite> {
    const principal = await requireGatewayPrincipal(options, this.env);
    const normalized = normalizeInvite(options);

    const replayed = this.readProcessedCommand(normalized.requestId);
    if (replayed !== undefined) {
      if (
        !sameProcessedCommand(replayed, "party.invite", principal, normalized)
      ) {
        return rejectProcessedCommandConflict();
      }
      return JSON.parse(replayed.resultJson) as PartyInvite;
    }

    this.requireLeader(principal.playerId);
    if (
      this.readMemberRows().some(
        (row) => row.playerId === normalized.invitedPlayerId,
      )
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "既にメンバーである主体へ招待を発行できません。",
      });
    }

    // 未使用かつ期限内の招待は上書きせず再利用します (ADR-0005)。
    const existingInvite = this.readActiveInvite(normalized.invitedPlayerId);
    if (existingInvite !== null) {
      this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "party.invite",
        playerId: principal.playerId,
        payloadJson: normalized.payloadJson,
        resultJson: JSON.stringify(existingInvite),
        createdAt: Date.now(),
      });
      return existingInvite;
    }

    const now = Date.now();
    const expiresAtMs = now + (normalized.ttlMs ?? DEFAULT_PARTY_INVITE_TTL_MS);
    const invite: PartyInvite = Object.freeze({
      playerId: normalized.invitedPlayerId,
      token: crypto.randomUUID(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      createdAt: new Date(now).toISOString(),
    });
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_party_invites (
         party_id, player_id, token, expires_at_ms, used_at_ms, created_at
       ) VALUES (?, ?, ?, ?, NULL, ?)`,
      this.partyName,
      invite.playerId,
      invite.token,
      expiresAtMs,
      now,
    );
    this.appendEvent("invite_created", now);
    this.recordProcessedCommand({
      requestId: normalized.requestId,
      command: "party.invite",
      playerId: principal.playerId,
      payloadJson: normalized.payloadJson,
      resultJson: JSON.stringify(invite),
      createdAt: now,
    });
    await this.synchronizeAlarm();
    return invite;
  }

  /** 有効な招待トークンを提示した主体がパーティーへ参加します。 */
  public async acceptInvite(
    options: PartyInviteAcceptanceOptions,
  ): Promise<PartySnapshot> {
    const principal = await requireGatewayPrincipal(options, this.env);
    const normalized = normalizeInviteAcceptance(options);

    const replayed = this.readProcessedCommand(normalized.requestId);
    if (replayed !== undefined) {
      if (
        !sameProcessedCommand(replayed, "party.accept", principal, normalized)
      ) {
        return rejectProcessedCommandConflict();
      }
      return JSON.parse(replayed.resultJson) as PartySnapshot;
    }

    const state = this.requireState();
    if (state.queuedTicketId !== null) {
      throw new FlareLobbyError("CONFLICT", {
        message: "マッチング待機中のパーティーへ参加できません。",
      });
    }

    const invite = this.readInviteByToken(normalized.token);
    if (
      invite === undefined ||
      invite.usedAtMs !== null ||
      invite.playerId !== principal.playerId ||
      invite.expiresAtMs <= Date.now()
    ) {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "招待トークンが無効または期限切れです。",
      });
    }

    const memberRows = this.readMemberRows();
    if (memberRows.some((row) => row.playerId === principal.playerId)) {
      throw new FlareLobbyError("CONFLICT", {
        message: "既にこのパーティーのメンバーです。",
      });
    }
    if (memberRows.length >= state.maxPartySize) {
      throw new FlareLobbyError("ROOM_FULL", {
        message: "パーティーが満員です。",
      });
    }

    await this.claimMembership(principal.playerId, this.partyName);

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_party_invites SET used_at_ms = ?
       WHERE party_id = ? AND player_id = ? AND token = ?`,
      now,
      this.partyName,
      principal.playerId,
      normalized.token,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_party_members (party_id, player_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`,
      this.partyName,
      principal.playerId,
      new Date(now).toISOString(),
    );
    this.bumpRevision(now);
    const snapshot = this.requireSnapshot();
    this.appendEvent("member_joined", now);
    this.recordProcessedCommand({
      requestId: normalized.requestId,
      command: "party.accept",
      playerId: principal.playerId,
      payloadJson: normalized.payloadJson,
      resultJson: JSON.stringify(snapshot),
      createdAt: now,
    });
    await this.synchronizeAlarm();
    return snapshot;
  }

  /**
   * 呼び出し主体がパーティーから退出します。
   *
   * リーダーの退出では解散せず、残存メンバーの中で最古参のメンバーへ権限が
   * 移ります。メンバー数が 2 未満になった時点で自動解散します (ADR-0005)。
   * マッチング待機中は構成変更を拒否します。
   */
  public async leaveParty(
    options: PartyOperationOptions,
  ): Promise<PartySnapshot | null> {
    const principal = await requireGatewayPrincipal(options, this.env);
    const normalized = normalizeOptionalRequestIdOperation(options);

    if (normalized.requestId !== null) {
      const replayed = this.readProcessedCommand(normalized.requestId);
      if (replayed !== undefined) {
        if (
          !sameProcessedCommand(replayed, "party.leave", principal, normalized)
        ) {
          return rejectProcessedCommandConflict();
        }
        return parseReplayLeaveResult(replayed.resultJson);
      }
    }

    const state = this.requireState();
    if (state.queuedTicketId !== null) {
      throw new FlareLobbyError("CONFLICT", {
        message:
          "マッチング待機中は退出できません。先にチケットをキャンセルしてください。",
      });
    }

    const memberRows = this.readMemberRows();
    if (!memberRows.some((row) => row.playerId === principal.playerId)) {
      throw new FlareLobbyError("CONFLICT", {
        message: "このパーティーのメンバーではありません。",
      });
    }

    const leavingPlayerId = principal.playerId;
    const wasLeader =
      memberRows.find((row) => row.playerId === leavingPlayerId)?.role ===
      "leader";
    const remaining = await this.removeMembers([leavingPlayerId]);

    if (wasLeader && remaining >= 2) {
      // リーダーの自発的退出では解散せず、最古参メンバーへ権限を移譲します
      // (ADR-0005)。readMemberRows() は参加時刻の昇順で返します。
      const nextLeader = this.readMemberRows()[0];
      if (nextLeader !== undefined) {
        this.ctx.storage.sql.exec(
          `UPDATE flarelobby_party_members SET role = 'leader'
           WHERE party_id = ? AND player_id = ?`,
          this.partyName,
          nextLeader.playerId,
        );
        this.bumpRevision(Date.now());
      }
    }

    if (normalized.requestId !== null) {
      this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "party.leave",
        playerId: leavingPlayerId,
        payloadJson: normalized.payloadJson,
        resultJson: JSON.stringify(
          remaining < 2 ? { dissolved: true } : this.requireSnapshot(),
        ),
        createdAt: Date.now(),
      });
    }
    await this.synchronizeAlarm();

    if (remaining < 2) {
      await this.dissolveInternal("member_left");
      return null;
    }

    return this.requireSnapshot();
  }

  /** リーダー権限を別のメンバーへ移譲します。 */
  public async transferLeadership(
    options: PartyLeadershipTransferOptions,
  ): Promise<PartySnapshot> {
    const principal = await requireGatewayPrincipal(options, this.env);
    const normalized = normalizeLeadershipTransfer(options);

    const replayed = this.readProcessedCommand(normalized.requestId);
    if (replayed !== undefined) {
      if (
        !sameProcessedCommand(replayed, "party.transfer", principal, normalized)
      ) {
        return rejectProcessedCommandConflict();
      }
      return JSON.parse(replayed.resultJson) as PartySnapshot;
    }

    this.requireLeader(principal.playerId);
    const target = this.readMemberRows().find(
      (row) => row.playerId === normalized.targetPlayerId,
    );
    if (target === undefined || target.role === "leader") {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "移譲先はリーダー以外のメンバーで指定してください。",
      });
    }

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_party_members SET role = 'member'
       WHERE party_id = ? AND role = 'leader'`,
      this.partyName,
    );
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_party_members SET role = 'leader'
       WHERE party_id = ? AND player_id = ?`,
      this.partyName,
      normalized.targetPlayerId,
    );
    this.bumpRevision(now);
    const snapshot = this.requireSnapshot();
    this.appendEvent("leader_transferred", now);
    this.recordProcessedCommand({
      requestId: normalized.requestId,
      command: "party.transfer",
      playerId: principal.playerId,
      payloadJson: normalized.payloadJson,
      resultJson: JSON.stringify(snapshot),
      createdAt: now,
    });
    await this.synchronizeAlarm();
    return snapshot;
  }

  /**
   * リーダーがパーティーを解散します。
   *
   * 待機チケットがある場合は、同じ主体の署名でチケットをキャンセルしてから
   * 解散します (ADR-0005)。解散後のスナップショットを返します。
   */
  public async dissolveParty(
    options: PartyOperationOptions,
  ): Promise<PartySnapshot> {
    const principal = await requireGatewayPrincipal(options, this.env);
    const normalized = normalizeOptionalRequestIdOperation(options);

    if (normalized.requestId !== null) {
      const replayed = this.readProcessedCommand(normalized.requestId);
      if (replayed !== undefined) {
        if (
          !sameProcessedCommand(
            replayed,
            "party.dissolve",
            principal,
            normalized,
          )
        ) {
          return rejectProcessedCommandConflict();
        }
        return parseReplayDissolveResult(replayed.resultJson);
      }
    }

    this.requireLeader(principal.playerId);
    const state = this.requireState();

    if (state.queuedTicketId !== null && state.queuedPoolKey !== null) {
      const poolStub = this.env.FLARE_LOBBY_MATCH_POOLS.getByName(
        state.queuedPoolKey,
      ) as unknown as MatchPoolCancellationStub;
      try {
        await poolStub.cancelTicket({
          gatewayPrincipal: options.gatewayPrincipal,
          ticketId: state.queuedTicketId,
        });
      } catch {
        // チケットが既に終端状態ならキャンセル不要です。凍結解除だけ進めます。
      }
      await this.endQueueTicket({ ticketId: state.queuedTicketId });
    }

    const snapshot = await this.dissolveInternal("dissolved");

    if (normalized.requestId !== null) {
      this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "party.dissolve",
        playerId: principal.playerId,
        payloadJson: normalized.payloadJson,
        resultJson: JSON.stringify(snapshot),
        createdAt: Date.now(),
      });
    }
    await this.synchronizeAlarm();
    return snapshot;
  }

  /** 現在のパーティースナップショットを返します。存在しない場合は `null` です。 */
  public async getSnapshot(options: {
    readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  }): Promise<PartySnapshot | null> {
    const principal = await requireGatewayPrincipal(options, this.env);
    if (this.readStateRow() === undefined) {
      return null;
    }
    if (!this.isMember(principal.playerId)) {
      throw new FlareLobbyError("FORBIDDEN");
    }
    return this.requireSnapshot();
  }

  /** イベント履歴を返します。メンバー全員が自分の主体で取得できます。 */
  public async getEvents(options: {
    readonly gatewayPrincipal: GatewayPrincipalEnvelope;
    readonly afterSequence?: number;
  }): Promise<readonly PartyEvent[]> {
    const principal = await requireGatewayPrincipal(options, this.env);
    if (!this.isMember(principal.playerId)) {
      throw new FlareLobbyError("FORBIDDEN");
    }
    const afterSequence =
      options.afterSequence === undefined
        ? 0
        : normalizeNonNegativeSafeInteger(
            options.afterSequence,
            "afterSequence",
          );
    return this.readEvents(afterSequence);
  }

  /**
   * Match Pool からのキュー投入を受け付け、構成変更を凍結します。
   *
   * リーダーだけがキュー投入でき、現在の `revision` を返します。以降、
   * チケットが終端状態になるまで参加・退出・招待受諾を拒否します (ADR-0005)。
   */
  public async beginQueueTicket(
    options: PartyQueueStartOptions,
  ): Promise<PartyQueueStartResult> {
    const principal = await requireGatewayPrincipal(options, this.env);
    if (
      !isNonEmptyString(options.ticketId) ||
      !isNonEmptyString(options.poolKey)
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const memberRows = this.readMemberRows();
    const self = memberRows.find((row) => row.playerId === principal.playerId);
    if (self === undefined || self.role !== "leader") {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "パーティーのキュー投入はリーダーだけが行えます。",
      });
    }

    const queued = this.readStateRow()?.queuedTicketId ?? null;
    if (queued !== null) {
      if (queued !== options.ticketId) {
        throw new FlareLobbyError("CONFLICT", {
          message: "このパーティーは既にマッチング待機中です。",
        });
      }
      return {
        leaderPlayerId: principal.playerId,
        memberIds: sortedMemberIds(memberRows),
        partyRevision: this.requireState().revision,
      };
    }

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_party_state
       SET queued_ticket_id = ?, queued_pool_key = ?, updated_at = ?
       WHERE singleton_id = 1`,
      options.ticketId,
      options.poolKey,
      now,
    );
    this.bumpRevision(now);
    const snapshot = this.requireSnapshot();
    this.appendEvent("queue_started", now);
    await this.synchronizeAlarm();

    return {
      leaderPlayerId: principal.playerId,
      memberIds: snapshot.members.map((member) => member.playerId),
      partyRevision: snapshot.revision,
    };
  }

  /** チケットの終端状態を受けて凍結を解除します。冪等です。 */
  public async endQueueTicket(options: {
    readonly ticketId: string;
  }): Promise<void> {
    if (!isNonEmptyString(options?.ticketId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }
    const state = this.readStateRow();
    if (state === undefined || state.queuedTicketId !== options.ticketId) {
      return;
    }
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_party_state
       SET queued_ticket_id = NULL, queued_pool_key = NULL, updated_at = ?
       WHERE singleton_id = 1`,
      now,
    );
    this.bumpRevision(now);
    this.appendEvent("queue_ended", now);
    await this.synchronizeAlarm();
  }

  /** Alarm は期限切れ招待の掃除と無活動パーティーの削除を行います。 */
  public override async alarm(): Promise<void> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `DELETE FROM flarelobby_party_invites
       WHERE party_id = ? AND (used_at_ms IS NOT NULL OR expires_at_ms <= ?)`,
      this.partyName,
      now,
    );
    const state = this.readStateRow();
    if (
      state !== undefined &&
      state.updatedAt + DEFAULT_PARTY_IDLE_TTL_MS <= now
    ) {
      await this.dissolveInternal("dissolved");
    }
    await this.synchronizeAlarm();
  }

  /** パーティーイベント接続の WebSocket 受け口です。メンバー全員が開けます。 */
  public override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = readGatewayToken(request);
    if (token === null) {
      return createErrorResponse(new FlareLobbyError("UNAUTHENTICATED"));
    }
    const principal = await this.resolveGatewayPrincipal({ token });
    if (principal === null) {
      return createErrorResponse(new FlareLobbyError("UNAUTHENTICATED"));
    }
    if (!this.isMember(principal.playerId)) {
      return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
    }
    const afterSequence = parseAfterQueryValue(url.searchParams.get("after"));
    if (afterSequence === null) {
      return createErrorResponse(new FlareLobbyError("INVALID_PAYLOAD"));
    }
    const events = this.readEvents(afterSequence);
    const wantsWebSocket =
      request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (!wantsWebSocket) {
      return Response.json({ events });
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["party"]);
    for (const event of events) {
      pair[1].send(JSON.stringify(event));
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private get partyName(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  private async claimMembership(
    playerId: string,
    nextPartyId: string,
  ): Promise<void> {
    const registry = this.env.FLARE_LOBBY_PARTY_MEMBERSHIPS.getByName(playerId);
    const claimed = await registry.claim(playerId, null, nextPartyId);
    if (!claimed) {
      throw new FlareLobbyError("CONFLICT", {
        message: "この主体は既に別のパーティーに所属しています。",
      });
    }
  }

  private async releaseMembership(playerId: string): Promise<void> {
    const registry = this.env.FLARE_LOBBY_PARTY_MEMBERSHIPS.getByName(playerId);
    await registry.release(playerId, this.partyName);
  }

  private isMember(playerId: string): boolean {
    return this.readMemberRows().some((row) => row.playerId === playerId);
  }

  /** 指定主体がリーダーであることを要求します。 */
  private requireLeader(playerId: string): void {
    const self = this.readMemberRows().find((row) => row.playerId === playerId);
    if (self === undefined || self.role !== "leader") {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "この操作はリーダーだけが行えます。",
      });
    }
  }

  /** メンバー行を削除し、残存人数を返します。 */
  private async removeMembers(playerIds: readonly string[]): Promise<number> {
    let remaining = this.readMemberRows().length;
    for (const playerId of playerIds) {
      this.ctx.storage.sql.exec(
        `DELETE FROM flarelobby_party_members
         WHERE party_id = ? AND player_id = ?`,
        this.partyName,
        playerId,
      );
      await this.releaseMembership(playerId);
      remaining -= 1;
    }
    if (playerIds.length > 0) {
      const now = Date.now();
      this.bumpRevision(now);
      if (this.readStateRow() !== undefined) {
        this.appendEvent("member_left", now);
      }
    }
    return remaining;
  }

  private async dissolveInternal(
    reason: PartyEvent["type"],
  ): Promise<PartySnapshot> {
    const memberRows = this.readMemberRows();
    for (const row of memberRows) {
      this.ctx.storage.sql.exec(
        `DELETE FROM flarelobby_party_members
         WHERE party_id = ? AND player_id = ?`,
        this.partyName,
        row.playerId,
      );
      await this.releaseMembership(row.playerId);
    }
    const now = Date.now();
    const before = this.readLastEventSnapshot() ?? this.readSnapshot();
    const dissolved: PartySnapshot = Object.freeze({
      ...(before ?? this.emptySnapshot()),
      members: [],
      invites: [],
      queuedTicket: null,
    });
    this.appendEventWithSnapshot(reason, dissolved, now);
    // 解散済みパーティーは識別単位ごと削除し、以降の参照は存在しない扱いにします。
    this.ctx.storage.sql.exec(
      `DELETE FROM flarelobby_party_invites WHERE party_id = ?`,
      this.partyName,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM flarelobby_party_state WHERE singleton_id = 1`,
    );
    return dissolved;
  }

  private emptySnapshot(): PartySnapshot {
    return Object.freeze({
      partyId: this.partyName,
      revision: this.readStateRow()?.revision ?? 0,
      maxPartySize: this.readStateRow()?.maxPartySize ?? 0,
      members: [],
      invites: [],
      queuedTicket: null,
      createdAt: new Date(this.readStateRow()?.createdAt ?? 0).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
    });
  }

  private appendEvent(
    type: PartyEvent["type"],
    occurredAtMs: number,
  ): PartyEvent {
    return this.appendEventWithSnapshot(
      type,
      this.requireSnapshot(),
      occurredAtMs,
    );
  }

  private appendEventWithSnapshot(
    type: PartyEvent["type"],
    snapshot: PartySnapshot,
    occurredAtMs: number,
  ): PartyEvent {
    const occurredAt = new Date(occurredAtMs).toISOString();
    const sequence = this.ctx.storage.sql
      .exec<{ sequence: number }>(
        `INSERT INTO flarelobby_party_events (
           type, snapshot_json, party_revision, occurred_at
         ) VALUES (?, ?, ?, ?)
         RETURNING event_id AS sequence`,
        type,
        JSON.stringify(snapshot),
        snapshot.revision,
        occurredAt,
      )
      .one().sequence;

    const event: PartyEvent = Object.freeze({
      sequence,
      partyRevision: snapshot.revision,
      type,
      snapshot,
      occurredAt,
    });
    this.notifyPartyEvent(event);
    return event;
  }

  private notifyPartyEvent(event: PartyEvent): void {
    const message = JSON.stringify(event);
    for (const webSocket of this.ctx.getWebSockets("party")) {
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

  private readEvents(afterSequence: number): readonly PartyEvent[] {
    return this.ctx.storage.sql
      .exec<EventRow>(
        `SELECT event_id AS sequence, type, snapshot_json AS snapshotJson,
                party_revision AS partyRevision, occurred_at AS occurredAt
         FROM flarelobby_party_events
         WHERE event_id > ?
         ORDER BY event_id ASC`,
        afterSequence,
      )
      .toArray()
      .map((row) =>
        Object.freeze({
          sequence: row.sequence,
          partyRevision: row.partyRevision,
          type: row.type,
          snapshot: JSON.parse(row.snapshotJson) as PartySnapshot,
          occurredAt: row.occurredAt,
        }),
      );
  }

  private readLastEventSnapshot(): PartySnapshot | null {
    const row = this.ctx.storage.sql
      .exec<Pick<EventRow, "snapshotJson">>(
        `SELECT snapshot_json AS snapshotJson
         FROM flarelobby_party_events
         ORDER BY event_id DESC LIMIT 1`,
      )
      .toArray()[0];
    return row === undefined
      ? null
      : (JSON.parse(row.snapshotJson) as PartySnapshot);
  }

  private bumpRevision(now: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_party_state SET revision = revision + 1, updated_at = ?
       WHERE singleton_id = 1`,
      now,
    );
  }

  private readStateRow(): StateRow | undefined {
    return this.ctx.storage.sql
      .exec<StateRow>(
        `SELECT party_id AS partyId, revision, max_party_size AS maxPartySize,
                queued_ticket_id AS queuedTicketId, queued_pool_key AS queuedPoolKey,
                created_at AS createdAt, updated_at AS updatedAt
         FROM flarelobby_party_state WHERE singleton_id = 1`,
      )
      .toArray()[0];
  }

  private requireState(): StateRow {
    const state = this.readStateRow();
    if (state === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "存在しないパーティーです。",
      });
    }
    return state;
  }

  private readMemberRows(): readonly MemberRow[] {
    return this.ctx.storage.sql
      .exec<MemberRow>(
        `SELECT player_id AS playerId, role, joined_at AS joinedAt
         FROM flarelobby_party_members
         WHERE party_id = ?
         ORDER BY joined_at ASC, player_id ASC`,
        this.partyName,
      )
      .toArray();
  }

  private readSnapshot(): PartySnapshot | null {
    const state = this.readStateRow();
    if (state === undefined) {
      return null;
    }
    const members = this.readMemberRows().map((row) =>
      Object.freeze({
        playerId: row.playerId,
        role: row.role,
        joinedAt: row.joinedAt,
      }),
    );
    const invites = this.ctx.storage.sql
      .exec<InviteRow>(
        `SELECT player_id AS playerId, token, expires_at_ms AS expiresAtMs,
                created_at AS createdAt
         FROM flarelobby_party_invites
         WHERE party_id = ? AND used_at_ms IS NULL AND expires_at_ms > ?
         ORDER BY created_at ASC, player_id ASC`,
        this.partyName,
        Date.now(),
      )
      .toArray()
      .map((row) =>
        Object.freeze({
          playerId: row.playerId,
          token: row.token,
          expiresAt: new Date(row.expiresAtMs).toISOString(),
          createdAt: new Date(row.createdAt).toISOString(),
        }),
      );
    return Object.freeze({
      partyId: state.partyId,
      revision: state.revision,
      maxPartySize: state.maxPartySize,
      members,
      invites,
      queuedTicket:
        state.queuedTicketId === null || state.queuedPoolKey === null
          ? null
          : Object.freeze({
              ticketId: state.queuedTicketId,
              poolKey: state.queuedPoolKey,
            }),
      createdAt: new Date(state.createdAt).toISOString(),
      updatedAt: new Date(state.updatedAt).toISOString(),
    });
  }

  private requireSnapshot(): PartySnapshot {
    const snapshot = this.readSnapshot();
    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }
    return snapshot;
  }

  private readActiveInvite(playerId: string): PartyInvite | null {
    const row = this.ctx.storage.sql
      .exec<InviteRow>(
        `SELECT player_id AS playerId, token, expires_at_ms AS expiresAtMs,
                created_at AS createdAt
         FROM flarelobby_party_invites
         WHERE party_id = ? AND player_id = ? AND used_at_ms IS NULL
           AND expires_at_ms > ?
         ORDER BY created_at ASC LIMIT 1`,
        this.partyName,
        playerId,
        Date.now(),
      )
      .toArray()[0];
    if (row === undefined) {
      return null;
    }
    return Object.freeze({
      playerId: row.playerId,
      token: row.token,
      expiresAt: new Date(row.expiresAtMs).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
    });
  }

  private readInviteByToken(token: string): InviteRow | undefined {
    return this.ctx.storage.sql
      .exec<InviteRow>(
        `SELECT player_id AS playerId, token, expires_at_ms AS expiresAtMs,
                used_at_ms AS usedAtMs, created_at AS createdAt
         FROM flarelobby_party_invites
         WHERE party_id = ? AND token = ?`,
        this.partyName,
        token,
      )
      .toArray()[0];
  }

  private readProcessedCommand(
    requestId: string,
  ): ProcessedCommandRow | undefined {
    return this.ctx.storage.sql
      .exec<ProcessedCommandRow>(
        `SELECT request_id AS requestId, command, player_id AS playerId,
                payload_json AS payloadJson, result_json AS resultJson,
                created_at AS createdAt
         FROM flarelobby_party_processed_commands
         WHERE request_id = ?`,
        requestId,
      )
      .toArray()[0];
  }

  private recordProcessedCommand(command: ProcessedCommandRow): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_party_processed_commands (
         request_id, command, player_id, payload_json, result_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      command.requestId,
      command.command,
      command.playerId,
      command.payloadJson,
      command.resultJson,
      command.createdAt,
    );
  }

  private async synchronizeAlarm(): Promise<void> {
    const nextInviteExpiry = this.ctx.storage.sql
      .exec<{ nextExpiresAt: number | null }>(
        `SELECT MIN(expires_at_ms) AS nextExpiresAt
         FROM flarelobby_party_invites
         WHERE party_id = ? AND used_at_ms IS NULL`,
        this.partyName,
      )
      .one().nextExpiresAt;
    const state = this.readStateRow();
    const idleCleanupAt =
      state === undefined ? null : state.updatedAt + DEFAULT_PARTY_IDLE_TTL_MS;
    const candidates = [nextInviteExpiry, idleCleanupAt].filter(
      (value): value is number => value !== null,
    );
    const current = await this.ctx.storage.getAlarm();
    if (candidates.length === 0) {
      if (current !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }
    const next = Math.min(...candidates);
    if (current === null || current !== next) {
      await this.ctx.storage.setAlarm(next);
    }
  }
}

/**
 * 認証主体ごとの現在のパーティー所属を保持するレジストリ DO です。
 *
 * 各主体は同時に 1 つのパーティーへしか所属できない不変条件 (ADR-0005) を、
 * 主体 ID を分割キーとする単一 writer で原子的に検査します。
 */
export class PartyMembershipDurableObject extends DurableObject<Env> {
  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS flarelobby_party_memberships (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          player_id TEXT NOT NULL,
          party_id TEXT NOT NULL
        )
      `);
    });
  }

  /** 所属がない場合だけ `nextPartyId` へ進めます。既存なら `false` を返します。 */
  public async claim(
    playerId: string,
    expectedPartyId: string | null,
    nextPartyId: string,
  ): Promise<boolean> {
    const current = this.readCurrentPartyId();
    if ((current ?? null) !== expectedPartyId) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_party_memberships (singleton_id, player_id, party_id)
       VALUES (1, ?, ?)
       ON CONFLICT(singleton_id) DO UPDATE SET party_id = excluded.party_id`,
      playerId,
      nextPartyId,
    );
    return true;
  }

  /** `partyId` が現在値と一致する場合だけ所属を解除します。 */
  public async release(_playerId: string, partyId: string): Promise<boolean> {
    const current = this.readCurrentPartyId();
    if (current !== partyId) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `DELETE FROM flarelobby_party_memberships WHERE singleton_id = 1`,
    );
    return true;
  }

  private readCurrentPartyId(): string | null {
    const row = this.ctx.storage.sql
      .exec<{ partyId: string }>(
        `SELECT party_id AS partyId FROM flarelobby_party_memberships
         WHERE singleton_id = 1`,
      )
      .toArray()[0];
    return row?.partyId ?? null;
  }
}

function verifyGatewayPrincipal(
  gatewayPrincipal: GatewayPrincipalEnvelope,
  env: Env,
): Promise<Principal | null> {
  return verifyGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    gatewayPrincipal,
  );
}

async function requireGatewayPrincipal(
  options: { readonly gatewayPrincipal?: GatewayPrincipalEnvelope },
  env: Env,
): Promise<Principal> {
  if (typeof options?.gatewayPrincipal?.token !== "string") {
    throw new FlareLobbyError("UNAUTHENTICATED");
  }
  const principal = await verifyGatewayPrincipal(options.gatewayPrincipal, env);
  if (principal === null) {
    throw new FlareLobbyError("UNAUTHENTICATED");
  }
  return principal;
}

function migratePartySchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS flarelobby_party_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flarelobby_party_state (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      party_id TEXT NOT NULL UNIQUE,
      revision INTEGER NOT NULL,
      max_party_size INTEGER NOT NULL,
      queued_ticket_id TEXT,
      queued_pool_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flarelobby_party_members (
      party_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('leader', 'member')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (party_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS flarelobby_party_invites (
      party_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at_ms INTEGER NOT NULL,
      used_at_ms INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (party_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS flarelobby_party_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN (
        'created', 'member_joined', 'member_left', 'leader_transferred',
        'invite_created', 'queue_started', 'queue_ended', 'dissolved'
      )),
      snapshot_json TEXT NOT NULL,
      party_revision INTEGER NOT NULL,
      occurred_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_flarelobby_party_events_event
      ON flarelobby_party_events (event_id);

    CREATE TABLE IF NOT EXISTS flarelobby_party_processed_commands (
      request_id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      player_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function normalizeCreation(options: PartyCreationOptions): {
  readonly requestId: string;
  readonly maxPartySize: number;
  readonly payloadJson: string;
} {
  const requestId = normalizeRequestId(options?.requestId);
  const rawMaxPartySize = options.maxPartySize;
  const maxPartySize =
    rawMaxPartySize === undefined
      ? DEFAULT_PARTY_MAX_SIZE
      : normalizePositiveSafeInteger(rawMaxPartySize, "maxPartySize");
  if (maxPartySize < 2 || maxPartySize > 64) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "maxPartySize は 2 以上 64 以下で指定してください。",
    });
  }
  return {
    requestId,
    maxPartySize,
    payloadJson: JSON.stringify({ maxPartySize }),
  };
}

function normalizeInvite(options: PartyInviteOptions): {
  readonly requestId: string;
  readonly invitedPlayerId: string;
  readonly ttlMs: number | undefined;
  readonly payloadJson: string;
} {
  const requestId = normalizeRequestId(options?.requestId);
  const invitedPlayerId = normalizeIdentifier(options?.playerId, "playerId");
  const ttlMs =
    options.ttlMs === undefined
      ? undefined
      : normalizePositiveSafeInteger(options.ttlMs, "ttlMs");
  return {
    requestId,
    invitedPlayerId,
    ttlMs,
    payloadJson: JSON.stringify({
      playerId: invitedPlayerId,
      ttlMs: ttlMs ?? null,
    }),
  };
}

function normalizeInviteAcceptance(options: PartyInviteAcceptanceOptions): {
  readonly requestId: string;
  readonly token: string;
  readonly payloadJson: string;
} {
  const requestId = normalizeRequestId(options?.requestId);
  const token = normalizeIdentifier(options?.token, "token", 128);
  return {
    requestId,
    token,
    payloadJson: JSON.stringify({ token }),
  };
}

function normalizeOptionalRequestIdOperation(options: PartyOperationOptions): {
  readonly requestId: string | null;
  readonly payloadJson: string;
} {
  return {
    requestId:
      options?.requestId === undefined
        ? null
        : normalizeRequestId(options.requestId),
    payloadJson: "{}",
  };
}

function normalizeLeadershipTransfer(options: PartyLeadershipTransferOptions): {
  readonly requestId: string;
  readonly targetPlayerId: string;
  readonly payloadJson: string;
} {
  const requestId = normalizeRequestId(options?.requestId);
  const targetPlayerId = normalizeIdentifier(options?.playerId, "playerId");
  return {
    requestId,
    targetPlayerId,
    payloadJson: JSON.stringify({ playerId: targetPlayerId }),
  };
}

function sameProcessedCommand(
  replayed: ProcessedCommandRow,
  command: string,
  principal: Principal,
  normalized: { readonly payloadJson: string },
): boolean {
  return (
    replayed.command === command &&
    replayed.playerId === principal.playerId &&
    replayed.payloadJson === normalized.payloadJson
  );
}

function rejectProcessedCommandConflict(): never {
  throw new FlareLobbyError("CONFLICT", {
    message: "同じ requestId に異なる操作内容を指定できません。",
  });
}
function parseReplayLeaveResult(resultJson: string): PartySnapshot | null {
  const parsed: unknown = JSON.parse(resultJson);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    "dissolved" in parsed &&
    parsed.dissolved === true
  ) {
    return null;
  }
  return parsed as PartySnapshot;
}

function parseReplayDissolveResult(resultJson: string): PartySnapshot {
  const parsed: unknown = JSON.parse(resultJson);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rejectProcessedCommandConflict();
  }
  return parsed as PartySnapshot;
}

function parseAfterQueryValue(value: string | null): number | null {
  if (value === null || value === "") {
    return 0;
  }
  if (!/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizePositiveSafeInteger(
  value: unknown,
  fieldName: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 1 以上の安全な整数で指定してください。`,
    });
  }
  return value;
}

function normalizeRequestId(value: unknown): string {
  return normalizeIdentifier(value, "requestId", 512);
}

function normalizeIdentifier(
  value: unknown,
  fieldName: string,
  maxLength = 512,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 1 文字以上 ${maxLength} 文字以下の文字列で指定してください。`,
    });
  }
  return value;
}

function sortedMemberIds(rows: readonly MemberRow[]): readonly PlayerId[] {
  return rows.map((row) => row.playerId).sort(compareStrings);
}

function normalizeNonNegativeSafeInteger(
  value: number,
  fieldName: string,
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 0 以上の安全な整数で指定してください。`,
    });
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
