import { DurableObject } from "cloudflare:workers";
import {
  FlareLobbyError
} from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  CustomRoom,
  FlareLobbyApp,
  Host,
  JsonObject,
  JsonValue,
  MatchRoom,
  MatchmakingPool,
  Participant,
  Room,
  RoomSnapshot,
  RoomState,
  RoomStatus,
  Team,
  Timestamp
} from "@flarelobby/core";
import {
  verifyGatewayPrincipalEnvelope
} from "./security.js";
import type {
  FlareLobbyRoomParticipantRole,
  GatewayPrincipalEnvelope
} from "./security.js";
import { DEFAULT_FINISHED_ROOM_RETENTION_MS } from "./room-constants.js";
export { DEFAULT_FINISHED_ROOM_RETENTION_MS } from "./room-constants.js";

/** カスタムルームで選択できる参加方式です。 */
export type RoomJoinMethod = "public" | "invitation" | "password";

/** Room 内で参加者へ割り当てる役割です。 */
export type RoomParticipantRole = FlareLobbyRoomParticipantRole;

const ROOM_RETENTION_OPERATION_ID = "__flarelobby_room_retention__";

/** Room Durable Object を初期化するための永続化対象です。 */
export interface RoomInitializationOptions<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  /** `env.FLARE_LOBBY_ROOMS.getByName(room.id)` と同じ Room 識別子です。 */
  readonly room: Room<TApp>;
  /** カスタムルームのホストです。対戦ルームでは使用しません。 */
  readonly host?: Host;
  /** 初期状態で登録する参加者です。 */
  readonly participants?: readonly Participant[];
  /** ルームで利用可能なチームです。 */
  readonly teams?: readonly Team[];
  /** 後続の参加処理で利用するプレイヤー定員です。 */
  readonly maxPlayers?: number;
  /** 後続の参加処理で利用する観戦者定員です。 */
  readonly maxSpectators?: number;
  /** カスタムルームの参加方式です。 */
  readonly joinMethod?: RoomJoinMethod;
  /** パスワード方式でのみ使用する参加パスワードです。永続化しません。 */
  readonly password?: string;
  /** 終了済み状態を保持する期間です。0 の場合は即時削除対象になります。 */
  readonly finishedRoomRetentionMs?: number;
}

/** Room Durable Object へ参加を要求する入力です。 */
export interface RoomParticipantJoinOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly role: RoomParticipantRole;
  readonly invitationCode?: string;
  readonly password?: string;
}

/** Room Durable Object の参加結果です。 */
export interface RoomParticipantJoinResult {
  readonly participantId: string;
  readonly role: RoomParticipantRole;
  readonly snapshot: RoomSnapshot;
}

/** Room Durable Object から退出を要求する入力です。 */
export interface RoomParticipantLeaveOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly participantId: string;
  readonly role?: RoomParticipantRole;
  /** Gateway 側の要求重複排除を Room 内でも原子的に行う識別子です。 */
  readonly requestId?: string;
  readonly requestPayload?: JsonValue;
}

/** Room Durable Object の退出結果です。 */
export interface RoomParticipantLeaveResult {
  readonly participantId: string;
  readonly role: RoomParticipantRole;
  readonly snapshot: RoomSnapshot;
}

/** 通信切断時に参加状態を維持するための入力です。 */
export interface RoomParticipantDisconnectOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly participantId: string;
  readonly role?: RoomParticipantRole;
}

/** 後続実装が利用しやすい説明的な別名です。 */
export type RoomJoinOptions = RoomParticipantJoinOptions;
export type RoomJoinResult = RoomParticipantJoinResult;
export type RoomLeaveOptions = RoomParticipantLeaveOptions;
export type RoomLeaveResult = RoomParticipantLeaveResult;

/** Room の状態遷移を要求する入力です。 */
export interface RoomStateTransitionOptions {
  readonly status: RoomStatus;
  /** 状態変更時刻。省略時は Durable Object の現在時刻を使用します。 */
  readonly at?: Timestamp;
}

/** Room 内で単一 Alarm により処理する期限処理の種別です。 */
export type RoomScheduledOperationKind = "noop" | "room_retention";

/** 期限処理を登録する入力です。 */
export interface RoomScheduledOperationOptions {
  readonly id: string;
  readonly dueAt: number;
  readonly kind?: RoomScheduledOperationKind;
  readonly payload?: JsonValue;
}

/** 永続化された期限処理です。 */
export interface RoomScheduledOperation {
  readonly id: string;
  readonly dueAt: number;
  readonly kind: RoomScheduledOperationKind;
  readonly payload: JsonValue;
}

/** 処理済みコマンドを保存する入力です。 */
export interface RoomProcessedCommandOptions {
  readonly requestId: string;
  readonly command: string;
  readonly payload: JsonValue;
  readonly result: JsonValue;
  readonly createdAt?: number;
}

/** 永続化された処理済みコマンドです。 */
export interface RoomProcessedCommand {
  readonly requestId: string;
  readonly command: string;
  readonly payload: JsonValue;
  readonly result: JsonValue;
  readonly createdAt: number;
}

interface SchemaMigrationRow extends Record<string, SqlStorageValue> {
  version: number;
}

interface RoomRow extends Record<string, SqlStorageValue> {
  roomId: string;
  kind: "custom" | "match";
  invitationCode: string | null;
  visibility: "public" | "unlisted" | null;
  matchId: string | null;
  poolJson: string | null;
  settingsJson: string;
  metadataJson: string;
  state: RoomStatus;
  stateStartedAt: string | null;
  revision: number;
  hostParticipantId: string | null;
  hostPlayerId: string | null;
  maxPlayers: number | null;
  maxSpectators: number | null;
  joinMethod: RoomJoinMethod | null;
  joinPasswordSalt: string | null;
  joinPasswordHash: string | null;
  finishedRoomRetentionMs: number;
}

interface ParticipantRow extends Record<string, SqlStorageValue> {
  participantId: string;
  kind: "player" | "spectator";
  playerId: string;
  teamId: string | null;
  ready: number;
}

interface TeamRow extends Record<string, SqlStorageValue> {
  teamId: string;
}

interface ProcessedCommandRow extends Record<string, SqlStorageValue> {
  requestId: string;
  command: string;
  payloadJson: string;
  resultJson: string;
  createdAt: number;
}

interface ScheduledOperationRow extends Record<string, SqlStorageValue> {
  operationId: string;
  dueAt: number;
  kind: RoomScheduledOperationKind;
  payloadJson: string;
}

interface NextAlarmRow extends Record<string, SqlStorageValue> {
  nextDueAt: number | null;
}

interface NormalizedParticipant {
  readonly participantId: string;
  readonly kind: "player" | "spectator";
  readonly playerId: string;
  readonly teamId: string | null;
  readonly ready: boolean;
}

interface NormalizedInitialization {
  readonly roomId: string;
  readonly kind: "custom" | "match";
  readonly invitationCode: string | null;
  readonly visibility: "public" | "unlisted" | null;
  readonly matchId: string | null;
  readonly poolJson: string | null;
  readonly settingsJson: string;
  readonly metadataJson: string;
  readonly hostParticipantId: string | null;
  readonly hostPlayerId: string | null;
  readonly maxPlayers: number | null;
  readonly maxSpectators: number | null;
  readonly joinMethod: RoomJoinMethod | null;
  readonly joinPasswordSalt: string | null;
  readonly joinPasswordHash: string | null;
  readonly finishedRoomRetentionMs: number;
  readonly participants: readonly NormalizedParticipant[];
  readonly teams: readonly string[];
}

/**
 * 1 ルームを 1 Durable Object として扱う、SQLite-backed Durable Object です。
 *
 * 重要な状態はすべて SQLite に保存し、クラスプロパティには保持しません。
 * そのため、休眠やインスタンス再生成後も同じスナップショットを復元できます。
 */
export class RoomDurableObject extends DurableObject<Env> {
  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // スキーマ初期化だけを入力ゲートで保護します。通常の RPC をここへ包まない
    // ことで、Room 単位の直列化と初期化処理の責務を分離します。
    this.ctx.blockConcurrencyWhile(async () => {
      migrateRoomSchema(this.ctx.storage.sql);
    });
  }

  /** Gateway の署名済み主体だけを受け入れます。 */
  public async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope
  ) {
    return verifyGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      gatewayPrincipal
    );
  }

  /**
   * Room の永続状態を一度だけ作成します。
   *
   * 同じ Room ID に対する再実行では INSERT をやり直さず、保存済みのスナップ
   * ショットを返します。SQLite の入力ゲートにより、同時初期化でも二重作成を
   * 起こしません。
   */
  public async initialize(
    options: RoomInitializationOptions
  ): Promise<RoomSnapshot> {
    const normalized = await normalizeInitialization(options);
    const existing = this.readRoomRow();

    if (existing !== undefined) {
      if (existing.roomId !== normalized.roomId) {
        throw new FlareLobbyError("CONFLICT", {
          message: "Room Durable Object の識別子が既存状態と一致しません。"
        });
      }

      const snapshot = this.readSnapshot();

      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return snapshot;
    }

    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO flarelobby_rooms (
          singleton_id,
          room_id,
          kind,
          invitation_code,
          visibility,
          match_id,
          pool_json,
          settings_json,
          metadata_json,
          state,
          state_started_at,
          revision,
          host_participant_id,
          host_player_id,
          max_players,
          max_spectators,
          join_method,
          join_password_salt,
          join_password_hash,
          finished_room_retention_ms,
          created_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.roomId,
        normalized.kind,
        normalized.invitationCode,
        normalized.visibility,
        normalized.matchId,
        normalized.poolJson,
        normalized.settingsJson,
        normalized.metadataJson,
        normalized.hostParticipantId,
        normalized.hostPlayerId,
        normalized.maxPlayers,
        normalized.maxSpectators,
        normalized.joinMethod,
        normalized.joinPasswordSalt,
        normalized.joinPasswordHash,
        normalized.finishedRoomRetentionMs,
        Date.now()
      );

      for (const participant of normalized.participants) {
        this.ctx.storage.sql.exec(
          `INSERT INTO flarelobby_room_participants (
            participant_id,
            kind,
            player_id,
            team_id,
            ready,
            joined_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          participant.participantId,
          participant.kind,
          participant.playerId,
          participant.teamId,
          participant.ready ? 1 : 0,
          Date.now()
        );
      }

      for (const teamId of normalized.teams) {
        this.ctx.storage.sql.exec(
          "INSERT INTO flarelobby_room_teams (team_id) VALUES (?)",
          teamId
        );
      }

      const snapshot = this.readSnapshot();

      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return snapshot;
    } catch (error) {
      // 初期化途中のストレージ失敗で Room 本体だけが残ると、次の再送が
      // 参加者のない半端な Room を成功として返してしまいます。初期化
      // リクエストはこの入力ゲート内で直列化されるため、失敗時に新規
      // 状態をまとめて消去してから同じエラーを返します。
      try {
        deleteRoomState(this.ctx.storage.sql);
        await this.ctx.storage.deleteAlarm();
      } catch {
        // 元の失敗理由を隠さず、公開用の安定したエラーへ正規化します。
      }

      if (error instanceof FlareLobbyError) {
        throw error;
      }

      throw new FlareLobbyError("CONNECTION_FAILED");
    }
  }

  /** 永続化された最新の読み取り専用スナップショットを返します。 */
  public async getSnapshot(): Promise<RoomSnapshot | null> {
    return this.readSnapshot();
  }

  /** 後続の Gateway 実装からも意味が明確になるスナップショット別名です。 */
  public async getRoomSnapshot(): Promise<RoomSnapshot | null> {
    return this.readSnapshot();
  }

  /**
   * 認証済み主体を Room のプレイヤーまたは観戦者として参加させます。
   *
   * Durable Object の入力ゲート内で既存参加者、役割別定員、INSERT を
   * 連続して処理するため、同時要求でも定員を超えません。同じ主体の同じ
   * 役割による再送は既存参加者を返し、参加者を増やしません。
   */
  public async join(
    options: RoomParticipantJoinOptions
  ): Promise<RoomParticipantJoinResult> {
    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal
    );

    if (principal === null) {
      throw new FlareLobbyError("UNAUTHENTICATED");
    }

    const normalized = normalizeParticipantJoinOptions(options);
    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room へ参加できません。"
      });
    }

    if (room.kind !== "custom" || room.joinMethod === null) {
      throw new FlareLobbyError("CONFLICT", {
        message: "カスタムルーム以外へ参加できません。"
      });
    }

    if (room.state === "finished") {
      throw new FlareLobbyError("ROOM_FINISHED");
    }

    if (room.state !== "waiting") {
      throw new FlareLobbyError("CONFLICT", {
        message: "待機中ではない Room へ参加できません。"
      });
    }

    await assertJoinCredentials(room, normalized);

    const existing = this.readParticipantByPlayerId(principal.playerId);

    if (existing !== undefined) {
      if (existing.kind !== normalized.role) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ主体を別の役割で重複参加させることはできません。"
        });
      }

      const snapshot = this.readSnapshot();

      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return {
        participantId: existing.participantId,
        role: existing.kind,
        snapshot
      };
    }

    const limit =
      normalized.role === "player" ? room.maxPlayers : room.maxSpectators;
    const count = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM flarelobby_room_participants WHERE kind = ?",
        normalized.role
      )
      .one().count;

    if (limit === null || count >= limit) {
      throw new FlareLobbyError("ROOM_FULL");
    }

    const participantId = `participant-${crypto.randomUUID()}`;

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_room_participants (
        participant_id,
        kind,
        player_id,
        team_id,
        ready,
        joined_at
      ) VALUES (?, ?, ?, NULL, 0, ?)`,
      participantId,
      normalized.role,
      principal.playerId,
      Date.now()
    );
    this.incrementRevision(room.revision);

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return {
      participantId,
      role: normalized.role,
      snapshot
    };
  }

  /** `join()` の意味を明示する別名です。 */
  public async joinParticipant(
    options: RoomParticipantJoinOptions
  ): Promise<RoomParticipantJoinResult> {
    return this.join(options);
  }

  /**
   * 指定された参加者を明示的に退出させます。
   *
   * 退出では参加者行を削除するため、準備状態とチーム所属も同時に失われます。
   * 通信切断はこの RPC を呼ばない限り退出になりません。ホスト移譲は #10 の
   * 責務なので、現段階ではホストの明示退出を拒否します。
   */
  public async leave(
    options: RoomParticipantLeaveOptions
  ): Promise<RoomParticipantLeaveResult> {
    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal
    );

    if (principal === null) {
      throw new FlareLobbyError("UNAUTHENTICATED");
    }

    const normalized = normalizeParticipantLeaveOptions(options);

    if (normalized.requestId !== null) {
      const existing = this.readProcessedCommand(normalized.requestId);

      if (existing !== null) {
        if (
          existing.value.command !== "custom_room.leave" ||
          existing.payloadJson !== normalized.requestPayloadJson
        ) {
          throw new FlareLobbyError("CONFLICT", {
            message: "同じ requestId に異なる退出条件を指定できません。"
          });
        }

        return parseParticipantLeaveResult(existing.value.result);
      }
    }

    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room から退出できません。"
      });
    }

    const participant = this.readParticipantById(normalized.participantId);

    if (
      participant === undefined ||
      participant.playerId !== principal.playerId ||
      (normalized.role !== null && normalized.role !== participant.kind)
    ) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    if (room.hostParticipantId === participant.participantId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "ホストの退出はホスト移譲後に実行してください。"
      });
    }

    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_participants WHERE participant_id = ?",
      participant.participantId
    );
    this.incrementRevision(room.revision);

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const result: RoomParticipantLeaveResult = {
      participantId: participant.participantId,
      role: participant.kind,
      snapshot
    };

    if (normalized.requestId !== null) {
      await this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "custom_room.leave",
        payload: parseJsonValue(normalized.requestPayloadJson),
        result: result as unknown as JsonValue
      });
    }

    return result;
  }

  /** `leave()` の意味を明示する別名です。 */
  public async leaveParticipant(
    options: RoomParticipantLeaveOptions
  ): Promise<RoomParticipantLeaveResult> {
    return this.leave(options);
  }

  /**
   * 通信切断を参加状態の変更として扱わず、現在のスナップショットを返します。
   * 実際の WebSocket 接続管理は後続 Issue がこの契約を利用します。
   */
  public async disconnect(
    options: RoomParticipantDisconnectOptions
  ): Promise<RoomSnapshot> {
    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal
    );

    if (principal === null) {
      throw new FlareLobbyError("UNAUTHENTICATED");
    }

    const normalized = normalizeParticipantDisconnectOptions(options);
    const participant = this.readParticipantById(normalized.participantId);

    if (
      participant === undefined ||
      participant.playerId !== principal.playerId ||
      (normalized.role !== null && normalized.role !== participant.kind)
    ) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return snapshot;
  }

  /**
   * Room の状態を許可された次の状態へ進めます。
   *
   * `waiting -> preparing -> in_progress -> finished` と、`waiting -> finished`
   * だけを許可します。同じ状態への再送は冪等に現在のスナップショットを返し、
   * 終了済み状態からの変更は常に拒否します。
   */
  public async transition(
    target: RoomStatus | RoomStateTransitionOptions,
    occurredAt?: Timestamp
  ): Promise<RoomSnapshot> {
    const transition = normalizeTransition(target, occurredAt);
    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room は状態変更できません。"
      });
    }

    if (room.state === transition.status) {
      await this.synchronizeAlarm();

      const snapshot = this.readSnapshot();

      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return snapshot;
    }

    if (room.state === "finished") {
      throw new FlareLobbyError("ROOM_FINISHED");
    }

    if (!isAllowedTransition(room.state, transition.status)) {
      throw new FlareLobbyError("CONFLICT", {
        message: `Room の状態を ${room.state} から ${transition.status} へ変更できません。`
      });
    }

    let retentionDueAt: number | undefined;

    if (transition.status === "finished") {
      const at = Date.parse(transition.at);
      const dueAt = at + room.finishedRoomRetentionMs;

      if (!Number.isSafeInteger(dueAt)) {
        throw new FlareLobbyError("INVALID_PAYLOAD", {
          message: "終了時刻と保持期間から安全な期限を計算できません。"
        });
      }

      retentionDueAt = dueAt;
    }

    const nextRevision = room.revision + 1;
    const stateStartedAt =
      transition.status === "waiting" ? null : transition.at;

    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET state = ?,
           state_started_at = ?,
           revision = ?
       WHERE singleton_id = 1`,
      transition.status,
      stateStartedAt,
      nextRevision
    );

    if (retentionDueAt !== undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO flarelobby_room_scheduled_operations (
          operation_id,
          due_at,
          kind,
          payload_json
        ) VALUES (?, ?, 'room_retention', '{}')
        ON CONFLICT(operation_id) DO UPDATE SET
          due_at = excluded.due_at,
          kind = excluded.kind,
          payload_json = excluded.payload_json`,
        ROOM_RETENTION_OPERATION_ID,
        retentionDueAt
      );
    }

    await this.synchronizeAlarm();

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return snapshot;
  }

  /** オブジェクト形式の状態遷移 RPC です。文字列形式も後方互換に受け付けます。 */
  public async transitionState(
    target: RoomStatus | RoomStateTransitionOptions,
    occurredAt?: Timestamp
  ): Promise<RoomSnapshot> {
    return this.transition(target, occurredAt);
  }

  /** Room 単位の期限処理を保存し、最も近い期限を Alarm へ反映します。 */
  public async scheduleOperation(
    options: RoomScheduledOperationOptions
  ): Promise<RoomScheduledOperation> {
    const normalized = normalizeScheduledOperation(options);

    if (this.readRoomRow() === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room に期限処理を登録できません。"
      });
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_room_scheduled_operations (
        operation_id,
        due_at,
        kind,
        payload_json
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        due_at = excluded.due_at,
        kind = excluded.kind,
        payload_json = excluded.payload_json`,
      normalized.id,
      normalized.dueAt,
      normalized.kind,
      normalized.payloadJson
    );

    await this.synchronizeAlarm();

    return {
      id: normalized.id,
      dueAt: normalized.dueAt,
      kind: normalized.kind,
      payload: parseJsonValue(normalized.payloadJson)
    };
  }

  /** `scheduleOperation()` の意味を明示する別名です。 */
  public async scheduleDeadline(
    options: RoomScheduledOperationOptions
  ): Promise<RoomScheduledOperation> {
    return this.scheduleOperation(options);
  }

  /** 期限処理を取り消し、必要なら次の期限へ Alarm を移します。 */
  public async cancelScheduledOperation(operationId: string): Promise<boolean> {
    if (!isNonEmptyString(operationId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const before = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
        operationId
      )
      .one().count;

    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
      operationId
    );
    await this.synchronizeAlarm();

    return before > 0;
  }

  /** 現在保存されている期限処理を確認します。 */
  public async listScheduledOperations(): Promise<
    readonly RoomScheduledOperation[]
  > {
    return this.readScheduledOperations();
  }

  /** テストと運用診断向けに、現在の単一 Alarm の時刻を返します。 */
  public async getNextAlarm(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  /**
   * 処理済みコマンドを保存します。同じ requestId と同じ入力なら既存結果を
   * 返し、入力が異なる再利用は競合として拒否します。
   */
  public async recordProcessedCommand(
    options: RoomProcessedCommandOptions
  ): Promise<RoomProcessedCommand> {
    const normalized = normalizeProcessedCommand(options);
    const existing = this.readProcessedCommand(normalized.requestId);

    if (existing !== null) {
      if (
        existing.value.command !== normalized.command ||
        existing.payloadJson !== normalized.payloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるコマンドを登録できません。"
        });
      }

      return existing.value;
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_processed_commands (
        request_id,
        command,
        payload_json,
        result_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      normalized.requestId,
      normalized.command,
      normalized.payloadJson,
      normalized.resultJson,
      normalized.createdAt
    );

    const stored = this.readProcessedCommand(normalized.requestId);

    if (stored === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return stored.value;
  }

  /** requestId に紐付く処理済みコマンドを返します。 */
  public async getProcessedCommand(
    requestId: string
  ): Promise<RoomProcessedCommand | null> {
    if (!isNonEmptyString(requestId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    return this.readProcessedCommand(requestId)?.value ?? null;
  }

  /** Alarm が期限到来した処理を冪等に実行し、次の期限へ再設定します。 */
  public override async alarm(): Promise<void> {
    const now = Date.now();
    const dueOperations = this.ctx.storage.sql
      .exec<ScheduledOperationRow>(
        `SELECT
          operation_id AS operationId,
          due_at AS dueAt,
          kind,
          payload_json AS payloadJson
         FROM flarelobby_room_scheduled_operations
         WHERE due_at <= ?
         ORDER BY due_at ASC, operation_id ASC`,
        now
      )
      .toArray();

    let roomDeleted = false;
    const room = this.readRoomRow();

    for (const operation of dueOperations) {
      if (operation.kind === "room_retention") {
        if (room?.state === "finished") {
          deleteRoomState(this.ctx.storage.sql);
          roomDeleted = true;
          break;
        }

        // 状態が戻ることは通常ありませんが、古い予約が残っていても
        // アクティブな Room を削除しないように期限だけを破棄します。
        this.ctx.storage.sql.exec(
          "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
          operation.operationId
        );
        continue;
      }

      // marker/noop は実行済みとして削除します。削除を状態変更と同じ
      // ストレージゲート内で行うため、Alarm の再試行でも二重処理になりません。
      this.ctx.storage.sql.exec(
        "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
        operation.operationId
      );
    }

    if (roomDeleted) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.synchronizeAlarm();
  }

  private readRoomRow(): RoomRow | undefined {
    return this.ctx.storage.sql
      .exec<RoomRow>(
        `SELECT
          room_id AS roomId,
          kind,
          invitation_code AS invitationCode,
          visibility,
          match_id AS matchId,
          pool_json AS poolJson,
          settings_json AS settingsJson,
          metadata_json AS metadataJson,
          state,
          state_started_at AS stateStartedAt,
          revision,
          host_participant_id AS hostParticipantId,
          host_player_id AS hostPlayerId,
          max_players AS maxPlayers,
          max_spectators AS maxSpectators,
          join_method AS joinMethod,
          join_password_salt AS joinPasswordSalt,
          join_password_hash AS joinPasswordHash,
          finished_room_retention_ms AS finishedRoomRetentionMs
         FROM flarelobby_rooms
         WHERE singleton_id = 1`
      )
      .toArray()[0];
  }

  private readParticipantById(
    participantId: string
  ): ParticipantRow | undefined {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         WHERE participant_id = ?`,
        participantId
      )
      .toArray()[0];
  }

  private readParticipantByPlayerId(
    playerId: string
  ): ParticipantRow | undefined {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         WHERE player_id = ?`,
        playerId
      )
      .toArray()[0];
  }

  private incrementRevision(currentRevision: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET revision = ?
       WHERE singleton_id = 1`,
      currentRevision + 1
    );
  }

  private readSnapshot(): RoomSnapshot | null {
    const room = this.readRoomRow();

    if (room === undefined) {
      return null;
    }

    const participants = this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         ORDER BY joined_at ASC, participant_id ASC`
      )
      .toArray()
      .map((participant) =>
        participant.kind === "player"
          ? Object.freeze({
              kind: "player" as const,
              id: participant.participantId,
              player: Object.freeze({ id: participant.playerId }),
              teamId: participant.teamId,
              ready: participant.ready === 1
            })
          : Object.freeze({
              kind: "spectator" as const,
              id: participant.participantId,
              player: Object.freeze({ id: participant.playerId })
            })
      );

    const teams = this.ctx.storage.sql
      .exec<TeamRow>(
        "SELECT team_id AS teamId FROM flarelobby_room_teams ORDER BY team_id ASC"
      )
      .toArray()
      .map((team) => Object.freeze({ id: team.teamId }));

    const state = createRoomState(room.state, room.stateStartedAt);
    const settings = deepFreeze(parseJsonObject(room.settingsJson));
    const metadata = deepFreeze(parseJsonObject(room.metadataJson));

    const baseRoom = {
      id: room.roomId,
      settings,
      metadata
    };

    const snapshotBase = {
      revision: room.revision,
      state,
      participants: Object.freeze(participants),
      teams: Object.freeze(teams)
    };

    if (room.kind === "custom") {
      if (
        room.invitationCode === null ||
        room.visibility === null ||
        room.hostParticipantId === null ||
        room.hostPlayerId === null
      ) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      const customRoom: CustomRoom = deepFreeze({
        ...baseRoom,
        kind: "custom" as const,
        invitationCode: room.invitationCode,
        visibility: room.visibility
      });

      return deepFreeze({
        ...snapshotBase,
        room: customRoom,
        host: deepFreeze({
          participantId: room.hostParticipantId,
          playerId: room.hostPlayerId
        })
      }) as RoomSnapshot;
    }

    if (room.matchId === null || room.poolJson === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const matchRoom: MatchRoom = deepFreeze({
      ...baseRoom,
      kind: "match" as const,
      matchId: room.matchId,
      pool: deepFreeze(parseMatchmakingPool(parseJsonObject(room.poolJson)))
    });

    return deepFreeze({
      ...snapshotBase,
      room: matchRoom
    }) as RoomSnapshot;
  }

  private readScheduledOperations(): readonly RoomScheduledOperation[] {
    return this.ctx.storage.sql
      .exec<ScheduledOperationRow>(
        `SELECT
          operation_id AS operationId,
          due_at AS dueAt,
          kind,
          payload_json AS payloadJson
         FROM flarelobby_room_scheduled_operations
         ORDER BY due_at ASC, operation_id ASC`
      )
      .toArray()
      .map((operation) =>
        Object.freeze({
          id: operation.operationId,
          dueAt: operation.dueAt,
          kind: operation.kind,
          payload: parseJsonValue(operation.payloadJson)
        })
      );
  }

  private readProcessedCommand(
    requestId: string
  ): { value: RoomProcessedCommand; payloadJson: string } | null {
    const row = this.ctx.storage.sql
      .exec<ProcessedCommandRow>(
        `SELECT
          request_id AS requestId,
          command,
          payload_json AS payloadJson,
          result_json AS resultJson,
          created_at AS createdAt
         FROM flarelobby_processed_commands
         WHERE request_id = ?`,
        requestId
      )
      .toArray()[0];

    if (row === undefined) {
      return null;
    }

    return {
      payloadJson: row.payloadJson,
      value: Object.freeze({
        requestId: row.requestId,
        command: row.command,
        payload: parseJsonValue(row.payloadJson),
        result: parseJsonValue(row.resultJson),
        createdAt: row.createdAt
      })
    };
  }

  private async synchronizeAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<NextAlarmRow>(
        `SELECT MIN(due_at) AS nextDueAt
         FROM flarelobby_room_scheduled_operations`
      )
      .one().nextDueAt;
    const current = await this.ctx.storage.getAlarm();

    if (next === null) {
      if (current !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }

    const requested = next;

    if (current === null || requested !== current) {
      await this.ctx.storage.setAlarm(requested);
    }
  }
}

function migrateRoomSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS flarelobby_room_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const currentVersion = sql
    .exec<SchemaMigrationRow>(
      `SELECT COALESCE(MAX(version), 0) AS version
       FROM flarelobby_room_schema_migrations`
    )
    .one().version;

  if (currentVersion < 1) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS flarelobby_rooms (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        room_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('custom', 'match')),
        invitation_code TEXT,
        visibility TEXT CHECK (visibility IN ('public', 'unlisted')),
        match_id TEXT,
        pool_json TEXT,
        settings_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('waiting', 'preparing', 'in_progress', 'finished')),
        state_started_at TEXT,
        revision INTEGER NOT NULL,
        host_participant_id TEXT,
        host_player_id TEXT,
        max_players INTEGER,
        finished_room_retention_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flarelobby_room_participants (
        participant_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('player', 'spectator')),
        player_id TEXT NOT NULL,
        team_id TEXT,
        ready INTEGER NOT NULL CHECK (ready IN (0, 1)),
        joined_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flarelobby_room_teams (
        team_id TEXT PRIMARY KEY
      );

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (1, ?)
    `, Date.now());
  }

  if (currentVersion < 2) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS flarelobby_processed_commands (
        request_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flarelobby_room_scheduled_operations (
        operation_id TEXT PRIMARY KEY,
        due_at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('noop', 'room_retention')),
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flarelobby_room_scheduled_operations_due_at
        ON flarelobby_room_scheduled_operations (due_at, operation_id);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (2, ?)
    `, Date.now());
  }

  if (currentVersion < 3) {
    sql.exec(`
      ALTER TABLE flarelobby_rooms
        ADD COLUMN max_spectators INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN join_method TEXT NOT NULL DEFAULT 'public';

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (3, ?)
    `, Date.now());
  }

  if (currentVersion < 4) {
    sql.exec(`
      ALTER TABLE flarelobby_rooms
        ADD COLUMN join_password_salt TEXT;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN join_password_hash TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_flarelobby_room_participants_player_id
        ON flarelobby_room_participants (player_id);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (4, ?)
    `, Date.now());
  }
}

function deleteRoomState(sql: SqlStorage): void {
  sql.exec(`
    DELETE FROM flarelobby_room_scheduled_operations;
    DELETE FROM flarelobby_processed_commands;
    DELETE FROM flarelobby_room_participants;
    DELETE FROM flarelobby_room_teams;
    DELETE FROM flarelobby_rooms
     WHERE singleton_id = 1
  `);
}

async function normalizeInitialization(
  options: RoomInitializationOptions
): Promise<NormalizedInitialization> {
  if (!isRecord(options) || !isRecord(options.room)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const room = options.room;

  if (!isNonEmptyString(room.id)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "Room の id は空でない文字列で指定してください。"
    });
  }

  const settingsJson = serializeJsonObject(room.settings);
  const metadataJson = serializeJsonObject(room.metadata);
  const host = normalizeHost(options.host);
  const participants = normalizeParticipants(options.participants);
  const teams = normalizeTeams(options.teams);
  const password = normalizeOptionalPassword(options.password);
  const maxPlayers = normalizeOptionalPositiveInteger(
    options.maxPlayers,
    "maxPlayers"
  );
  const maxSpectators =
    options.maxSpectators === undefined
      ? 0
      : normalizeNonNegativeInteger(options.maxSpectators, "maxSpectators");
  const finishedRoomRetentionMs =
    options.finishedRoomRetentionMs === undefined
      ? DEFAULT_FINISHED_ROOM_RETENTION_MS
      : normalizeNonNegativeInteger(
          options.finishedRoomRetentionMs,
          "finishedRoomRetentionMs"
        );

  if (room.kind === "custom") {
    if (
      !isNonEmptyString(room.invitationCode) ||
      (room.visibility !== "public" && room.visibility !== "unlisted") ||
      (options.joinMethod !== undefined &&
        options.joinMethod !== "public" &&
        options.joinMethod !== "invitation" &&
        options.joinMethod !== "password") ||
      host === null
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "カスタムルームには招待コード、可視性、ホストが必要です。"
      });
    }

    const joinMethod = options.joinMethod ?? "public";

    if (
      (joinMethod === "password" && password === null) ||
      (joinMethod !== "password" && password !== null)
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "パスワード方式ではパスワードが必要です。"
      });
    }

    const passwordRecord =
      password === null ? null : await hashRoomPassword(password);

    return {
      roomId: room.id,
      kind: "custom",
      invitationCode: room.invitationCode,
      visibility: room.visibility,
      matchId: null,
      poolJson: null,
      settingsJson,
      metadataJson,
      hostParticipantId: host.participantId,
      hostPlayerId: host.playerId,
      maxPlayers,
      maxSpectators,
      joinMethod,
      joinPasswordSalt: passwordRecord?.salt ?? null,
      joinPasswordHash: passwordRecord?.hash ?? null,
      finishedRoomRetentionMs,
      participants,
      teams
    };
  }

  if (
    room.kind !== "match" ||
    !isNonEmptyString(room.matchId) ||
    !isRecord(room.pool)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const poolJson = serializeJsonObject(normalizeMatchmakingPool(room.pool));

  return {
    roomId: room.id,
    kind: "match",
    invitationCode: null,
    visibility: null,
    matchId: room.matchId,
    poolJson,
    settingsJson,
    metadataJson,
    hostParticipantId: null,
    hostPlayerId: null,
    maxPlayers,
    maxSpectators: null,
    joinMethod: null,
    joinPasswordSalt: null,
    joinPasswordHash: null,
    finishedRoomRetentionMs,
    participants,
    teams
  };
}

interface NormalizedParticipantJoin {
  readonly role: RoomParticipantRole;
  readonly invitationCode: string | null;
  readonly password: string | null;
}

interface NormalizedParticipantLeave {
  readonly participantId: string;
  readonly role: RoomParticipantRole | null;
  readonly requestId: string | null;
  readonly requestPayloadJson: string;
}

interface NormalizedParticipantDisconnect {
  readonly participantId: string;
  readonly role: RoomParticipantRole | null;
}

function normalizeParticipantJoinOptions(
  options: RoomParticipantJoinOptions
): NormalizedParticipantJoin {
  if (!isRecord(options)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const role = options.role;

  if (!isRoomParticipantRole(role)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const invitationCode =
    options.invitationCode === undefined
      ? null
      : normalizeInvitationCode(options.invitationCode);
  const password =
    options.password === undefined
      ? null
      : normalizeParticipantPassword(options.password);

  return { role, invitationCode, password };
}

function normalizeParticipantLeaveOptions(
  options: RoomParticipantLeaveOptions
): NormalizedParticipantLeave {
  if (!isRecord(options) || !isNonEmptyString(options.participantId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const role =
    options.role === undefined ? null : normalizeParticipantRole(options.role);
  const requestId =
    options.requestId === undefined
      ? null
      : normalizeRequestIdentifier(options.requestId);
  const requestPayload =
    options.requestPayload === undefined
      ? {
          participantId: options.participantId,
          ...(role === null ? {} : { role })
        }
      : options.requestPayload;

  if (!isJsonValue(requestPayload)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    participantId: options.participantId,
    role,
    requestId,
    requestPayloadJson: JSON.stringify(requestPayload)
  };
}

function normalizeParticipantDisconnectOptions(
  options: RoomParticipantDisconnectOptions
): NormalizedParticipantDisconnect {
  if (!isRecord(options) || !isNonEmptyString(options.participantId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    participantId: options.participantId,
    role:
      options.role === undefined ? null : normalizeParticipantRole(options.role)
  };
}

function normalizeParticipantRole(value: unknown): RoomParticipantRole {
  if (!isRoomParticipantRole(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value;
}

function normalizeRequestIdentifier(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 1_024) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value;
}

function normalizeInvitationCode(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 128) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value.trim().toUpperCase();
}

function normalizeParticipantPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value;
}

function normalizeOptionalPassword(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return normalizeParticipantPassword(value);
}

function isRoomParticipantRole(
  value: unknown
): value is RoomParticipantRole {
  return value === "player" || value === "spectator";
}

async function assertJoinCredentials(
  room: RoomRow,
  options: NormalizedParticipantJoin
): Promise<void> {
  if (room.joinMethod === "invitation") {
    if (
      room.invitationCode === null ||
      options.invitationCode !== room.invitationCode.toUpperCase()
    ) {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "招待コードが正しくありません。"
      });
    }

    return;
  }

  if (room.joinMethod === "password") {
    if (
      options.password === null ||
      room.joinPasswordSalt === null ||
      room.joinPasswordHash === null ||
      !(await verifyRoomPassword(
        options.password,
        room.joinPasswordSalt,
        room.joinPasswordHash
      ))
    ) {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "パスワードが正しくありません。"
      });
    }
  }
}

function parseParticipantLeaveResult(
  value: JsonValue
): RoomParticipantLeaveResult {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value["participantId"]) ||
    !isRoomParticipantRole(value["role"]) ||
    !isJsonObject(value["snapshot"])
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return value as unknown as RoomParticipantLeaveResult;
}

interface RoomPasswordRecord {
  readonly salt: string;
  readonly hash: string;
}

async function hashRoomPassword(password: string): Promise<RoomPasswordRecord> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await digestPassword(password, salt);

  return {
    salt: encodeBase64Url(salt),
    hash: encodeBase64Url(hash)
  };
}

async function verifyRoomPassword(
  password: string,
  encodedSalt: string,
  expectedHash: string
): Promise<boolean> {
  const salt = decodeBase64Url(encodedSalt);
  const hash = decodeBase64Url(expectedHash);

  if (salt === null || hash === null) {
    return false;
  }

  const actual = await digestPassword(password, salt);

  if (actual.byteLength !== hash.byteLength) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < actual.byteLength; index += 1) {
    difference |= actual[index]! ^ hash[index]!;
  }

  return difference === 0;
}

async function digestPassword(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  const input = new Uint8Array(salt.byteLength + passwordBytes.byteLength);
  input.set(salt, 0);
  input.set(passwordBytes, salt.byteLength);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }

  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      const character = binary.codePointAt(index);

      if (character === undefined) {
        return null;
      }

      bytes[index] = character;
    }

    return bytes;
  } catch {
    return null;
  }
}

function normalizeTransition(
  target: RoomStatus | RoomStateTransitionOptions,
  occurredAt?: Timestamp
): RoomStateTransitionOptions & { readonly at: Timestamp } {
  const status = typeof target === "string" ? target : target?.status;
  const at =
    typeof target === "string" ? occurredAt : target?.at ?? occurredAt;

  if (!isRoomStatus(status)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const normalizedAt = at ?? new Date().toISOString();

  if (!isValidTimestamp(normalizedAt)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "状態変更時刻は有効な Timestamp で指定してください。"
    });
  }

  return { status, at: normalizedAt };
}

function normalizeScheduledOperation(
  options: RoomScheduledOperationOptions
): {
  readonly id: string;
  readonly dueAt: number;
  readonly kind: RoomScheduledOperationKind;
  readonly payloadJson: string;
} {
  if (
    !isRecord(options) ||
    !isNonEmptyString(options.id) ||
    !isSafeTimestamp(options.dueAt)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const kind = options.kind ?? "noop";

  if (kind !== "noop" && kind !== "room_retention") {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  if (
    options.id === ROOM_RETENTION_OPERATION_ID &&
    kind !== "room_retention"
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "Room の保持期限で予約する識別子は利用できません。"
    });
  }

  const payload = options.payload ?? null;

  if (!isJsonValue(payload)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    id: options.id,
    dueAt: options.dueAt,
    kind,
    payloadJson: JSON.stringify(payload)
  };
}

function normalizeProcessedCommand(options: RoomProcessedCommandOptions): {
  readonly requestId: string;
  readonly command: string;
  readonly payloadJson: string;
  readonly resultJson: string;
  readonly createdAt: number;
} {
  if (
    !isRecord(options) ||
    !isNonEmptyString(options.requestId) ||
    !isNonEmptyString(options.command) ||
    !isJsonValue(options.payload) ||
    !isJsonValue(options.result)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const createdAt = options.createdAt ?? Date.now();

  if (!isSafeTimestamp(createdAt)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    requestId: options.requestId,
    command: options.command,
    payloadJson: JSON.stringify(options.payload),
    resultJson: JSON.stringify(options.result),
    createdAt
  };
}

function normalizeHost(value: Host | undefined): Host | null {
  if (value === undefined) {
    return null;
  }

  if (
    !isRecord(value) ||
    !isNonEmptyString(value.participantId) ||
    !isNonEmptyString(value.playerId)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    participantId: value.participantId,
    playerId: value.playerId
  };
}

function normalizeParticipants(
  values: readonly Participant[] | undefined
): readonly NormalizedParticipant[] {
  if (values === undefined) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const participantIds = new Set<string>();

  return values.map((value) => {
    const participant = isRecord(value) ? value : undefined;
    const player = isRecord(participant?.["player"])
      ? participant["player"]
      : undefined;

    if (
      participant === undefined ||
      !isNonEmptyString(participant["id"]) ||
      !isRecord(player) ||
      !isNonEmptyString(player["id"]) ||
      participantIds.has(participant["id"])
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "参加者の識別子は一意な空でない文字列で指定してください。"
      });
    }

    const participantId = participant["id"];
    const playerId = player["id"];
    participantIds.add(participantId);

    if (participant["kind"] === "player") {
      if (
        (typeof participant["teamId"] !== "string" &&
          participant["teamId"] !== null) ||
        typeof participant["ready"] !== "boolean"
      ) {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }

      return {
        participantId,
        kind: "player" as const,
        playerId,
        teamId: participant["teamId"],
        ready: participant["ready"]
      };
    }

    if (participant["kind"] === "spectator") {
      return {
        participantId,
        kind: "spectator" as const,
        playerId,
        teamId: null,
        ready: false
      };
    }

    throw new FlareLobbyError("INVALID_PAYLOAD");
  });
}

function normalizeTeams(values: readonly Team[] | undefined): readonly string[] {
  if (values === undefined) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const teamIds = new Set<string>();

  return values.map((value) => {
    const team = isRecord(value) ? value : undefined;
    const teamId = team?.["id"];

    if (team === undefined || !isNonEmptyString(teamId) || teamIds.has(teamId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "チームの識別子は一意な空でない文字列で指定してください。"
      });
    }

    teamIds.add(teamId);
    return teamId;
  });
}

function createRoomState(
  status: RoomStatus,
  startedAt: string | null
): RoomState {
  if (status === "waiting") {
    return Object.freeze({ status: "waiting" });
  }

  if (startedAt === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  if (status === "preparing") {
    return Object.freeze({ status, preparationStartedAt: startedAt });
  }

  if (status === "in_progress") {
    return Object.freeze({ status, startedAt });
  }

  return Object.freeze({ status, finishedAt: startedAt });
}

function isAllowedTransition(
  current: RoomStatus,
  next: RoomStatus
): boolean {
  return (
    (current === "waiting" && (next === "preparing" || next === "finished")) ||
    (current === "preparing" && next === "in_progress") ||
    (current === "in_progress" && next === "finished")
  );
}

function isRoomStatus(value: unknown): value is RoomStatus {
  return (
    value === "waiting" ||
    value === "preparing" ||
    value === "in_progress" ||
    value === "finished"
  );
}

function serializeJsonObject(value: unknown): string {
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return JSON.stringify(value);
}

function parseJsonObject(value: string): JsonObject {
  const parsed = parseJsonValue(value);

  if (!isJsonObject(parsed)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return parsed;
}

function parseMatchmakingPool(value: JsonObject): MatchmakingPool {
  const fields = ["id", "gameId", "seasonId", "mode", "region"] as const;

  if (!fields.every((field) => isNonEmptyString(value[field]))) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return {
    id: value["id"] as string,
    gameId: value["gameId"] as string,
    seasonId: value["seasonId"] as string,
    mode: value["mode"] as string,
    region: value["region"] as string
  };
}

function normalizeMatchmakingPool(value: unknown): MatchmakingPool {
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const fields = ["id", "gameId", "seasonId", "mode", "region"] as const;

  if (!fields.every((field) => isNonEmptyString(value[field]))) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    id: value["id"] as string,
    gameId: value["gameId"] as string,
    seasonId: value["seasonId"] as string,
    mode: value["mode"] as string,
    region: value["region"] as string
  };
}

function parseJsonValue(value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!isJsonValue(parsed)) {
      throw new Error("not-json-value");
    }

    return parsed;
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);

    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }

  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item)
    );
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function normalizeOptionalPositiveInteger(
  value: number | undefined,
  fieldName: string
): number | null {
  if (value === undefined) {
    return null;
  }

  return normalizePositiveInteger(value, fieldName);
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 1 以上の整数で指定してください。`
    });
  }

  return value;
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 0 以上の整数で指定してください。`
    });
  }

  return value;
}
