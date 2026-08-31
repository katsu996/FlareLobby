import { FlareLobbyError } from "@flarelobby/core";
import type {
  CustomRoom,
  JsonValue,
  MatchRoom,
  ProtocolMessage,
  RoomSnapshot,
  RoomStatus,
  ServerEventEnvelope,
  Timestamp,
} from "@flarelobby/core";
import type {
  RoomRow,
  ParticipantRow,
  RoomConnectionRow,
  RoomEventRow,
  TeamRow,
  RoomScheduledOperation,
  RoomScheduledOperationKind,
  RoomProcessedCommand,
  ScheduledOperationRow,
  ProcessedCommandRow,
  NextAlarmRow,
  SchemaMigrationRow,
  RoomWebSocketAttachment,
  NormalizedOperationRequest,
} from "../room.js";
import {
  createRoomState,
  parseMatchmakingPool,
  parseJsonObject,
  parseJsonValue,
  deepFreeze as deepFreezeUtil,
} from "../room.js";
/**
 * Room 永続化操作の依存インターフェース。
 * Durable Object のストレージアクセスを抽象化し、テスタビリティを確保。
 */
export interface RoomPersistenceDependencies {
  /** SQLite ストレージ */
  readonly storage: {
    readonly sql: SqlStorage;
    readonly getAlarm: () => Promise<number | null>;
    readonly setAlarm: (timestamp: number) => Promise<void>;
    readonly deleteAlarm: () => Promise<void>;
  };
  /** 現在時刻取得（テスト用） */
  readonly now: () => number;
}

/**
 * Room 永続化モジュール。
 * SQLite への読み書き、スナップショット構築、スキーママイグレーションを一元管理。
 */
export class RoomPersistence {
  constructor(private readonly deps: RoomPersistenceDependencies) {}

  // ==================== Room 行操作 ====================

  /** Room 行を読み取る */
  public readRoomRow(): RoomRow | undefined {
    return this.deps.storage.sql
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
          minimum_players AS minimumPlayers,
          require_all_players_ready AS requireAllPlayersReady,
          join_method AS joinMethod,
          join_password_salt AS joinPasswordSalt,
          join_password_hash AS joinPasswordHash,
          finished_room_retention_ms AS finishedRoomRetentionMs,
          created_at AS createdAt,
          resume_token_ttl_ms AS resumeTokenTtlMs,
          disconnect_grace_period_ms AS disconnectGracePeriodMs,
          event_history_limit AS eventHistoryLimit,
          processed_command_retention_ms AS processedCommandRetentionMs
         FROM flarelobby_rooms
         WHERE singleton_id = 1`,
      )
      .toArray()[0];
  }

  /** Room 初期化（スキーママイグレーション込み） */
  public async initializeRoomSchema(): Promise<void> {
    await this.deps.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS flarelobby_room_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    const currentVersion = this.deps.storage.sql
      .exec<SchemaMigrationRow>(
        `SELECT COALESCE(MAX(version), 0) AS version
         FROM flarelobby_room_schema_migrations`,
      )
      .one().version;

    if (currentVersion < 1) {
      this.deps.storage.sql.exec(`
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
          max_spectators INTEGER,
          minimum_players INTEGER NOT NULL,
          require_all_players_ready INTEGER NOT NULL,
          join_method TEXT,
          join_password_salt TEXT,
          join_password_hash TEXT,
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

        CREATE TABLE IF NOT EXISTS flarelobby_room_events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          revision INTEGER NOT NULL,
          event_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS flarelobby_room_connections (
          resume_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          participant_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('player', 'spectator')),
          connected_at TEXT NOT NULL,
          disconnected_at TEXT,
          connection_generation TEXT NOT NULL,
          resume_token_expires_at INTEGER NOT NULL,
          invalidated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS flarelobby_room_scheduled_operations (
          operation_id TEXT PRIMARY KEY,
          due_at INTEGER NOT NULL,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS flarelobby_room_processed_commands (
          request_id TEXT PRIMARY KEY,
          command TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      this.deps.storage.sql.exec(
        `INSERT INTO flarelobby_room_schema_migrations (version, applied_at) VALUES (1, ?)`,
        this.deps.now(),
      );
    }
  }

  // ==================== 参加者操作 ====================

  /** 参加者行を読み取る */
  public readParticipantById(
    participantId: string,
  ): ParticipantRow | undefined {
    return this.deps.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         WHERE participant_id = ?`,
        participantId,
      )
      .toArray()[0];
  }

  /** プレイヤーID で参加者行を読み取る */
  public readParticipantByPlayerId(
    playerId: string,
  ): ParticipantRow | undefined {
    return this.deps.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         WHERE player_id = ?`,
        playerId,
      )
      .toArray()[0];
  }

  /** 最古のプレイヤー参加者を取得 */
  public readOldestPlayerParticipant(
    excludedParticipantId: string,
  ): ParticipantRow | undefined {
    return this.deps.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         WHERE kind = 'player' AND participant_id <> ?
         ORDER BY joined_at ASC, participant_id ASC
         LIMIT 1`,
        excludedParticipantId,
      )
      .toArray()[0];
  }

  // ==================== スナップショット構築 ====================

  /** 現在のスナップショットを構築 */
  public readSnapshot(): RoomSnapshot | null {
    const room = this.readRoomRow();

    if (room === undefined) {
      return null;
    }

    const participants = this.deps.storage.sql
      .exec<ParticipantRow>(
        `SELECT
          participant_id AS participantId,
          kind,
          player_id AS playerId,
          team_id AS teamId,
          ready
         FROM flarelobby_room_participants
         ORDER BY joined_at ASC, participant_id ASC`,
      )
      .toArray()
      .map((participant) =>
        participant.kind === "player"
          ? Object.freeze({
              kind: "player" as const,
              id: participant.participantId,
              player: Object.freeze({ id: participant.playerId }),
              teamId: participant.teamId,
              ready: participant.ready === 1,
            })
          : Object.freeze({
              kind: "spectator" as const,
              id: participant.participantId,
              player: Object.freeze({ id: participant.playerId }),
            }),
      );

    const teams = this.deps.storage.sql
      .exec<TeamRow>(
        "SELECT team_id AS teamId FROM flarelobby_room_teams ORDER BY team_id ASC",
      )
      .toArray()
      .map((team) => Object.freeze({ id: team.teamId }));

    const state = createRoomState(room.state, room.stateStartedAt);
    const settings = deepFreezeUtil(parseJsonObject(room.settingsJson));
    const metadata = deepFreezeUtil(parseJsonObject(room.metadataJson));

    const baseRoom = {
      id: room.roomId,
      settings,
      metadata,
    };

    const snapshotBase = {
      revision: room.revision,
      state,
      participants: Object.freeze(participants),
      teams: Object.freeze(teams),
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

      const customRoom: CustomRoom = deepFreezeUtil({
        ...baseRoom,
        kind: "custom" as const,
        invitationCode: room.invitationCode,
        visibility: room.visibility,
      });

      return deepFreezeUtil({
        ...snapshotBase,
        room: customRoom,
        host: deepFreezeUtil({
          participantId: room.hostParticipantId,
          playerId: room.hostPlayerId,
        }),
      }) as RoomSnapshot;
    }

    if (room.matchId === null || room.poolJson === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const matchRoom: MatchRoom = deepFreezeUtil({
      ...baseRoom,
      kind: "match" as const,
      matchId: room.matchId,
      pool: deepFreezeUtil(
        parseMatchmakingPool(parseJsonObject(room.poolJson)),
      ),
    });

    return deepFreezeUtil({
      ...snapshotBase,
      room: matchRoom,
    }) as RoomSnapshot;
  }

  /** 必須スナップショットを読み取る（存在しない場合は例外） */
  public readRequiredSnapshot(): RoomSnapshot {
    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return snapshot;
  }

  /** プレイヤー数を読み取る */
  public readPlayerCounts(): {
    readonly total: number;
    readonly ready: number;
  } {
    const row = this.deps.storage.sql
      .exec<{ total: number; ready: number }>(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(ready), 0) AS ready
         FROM flarelobby_room_participants
         WHERE kind = 'player'`,
      )
      .one();

    return { total: row.total, ready: row.ready };
  }

  // ==================== 参加者追加・更新 ====================

  /** 参加者を挿入 */
  public insertParticipant(
    participantId: string,
    kind: "player" | "spectator",
    playerId: string,
    teamId: string | null,
    ready: number,
    joinedAt: number,
  ): void {
    this.deps.storage.sql.exec(
      `INSERT INTO flarelobby_room_participants (
        participant_id, kind, player_id, team_id, ready, joined_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      participantId,
      kind,
      playerId,
      teamId,
      ready,
      joinedAt,
    );
  }

  /** 参加者を削除 */
  public deleteParticipant(participantId: string): void {
    this.deps.storage.sql.exec(
      "DELETE FROM flarelobby_room_participants WHERE participant_id = ?",
      participantId,
    );
  }

  /** 参加者の準備状態を更新 */
  public updateParticipantReady(participantId: string, ready: boolean): void {
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_room_participants
       SET ready = ?
       WHERE participant_id = ?`,
      ready ? 1 : 0,
      participantId,
    );
  }

  /** 参加者のチームを更新 */
  public updateParticipantTeam(
    participantId: string,
    teamId: string | null,
  ): void {
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_room_participants
       SET team_id = ?
       WHERE participant_id = ?`,
      teamId,
      participantId,
    );
  }

  /** チーム存在確認 */
  public teamExists(teamId: string): boolean {
    return (
      this.deps.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_room_teams WHERE team_id = ?",
          teamId,
        )
        .one().count > 0
    );
  }

  // ==================== Room 設定・状態 ====================

  /** ホストを設定 */
  public setHost(participant: ParticipantRow): void {
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET host_participant_id = ?, host_player_id = ?
       WHERE singleton_id = 1`,
      participant.participantId,
      participant.playerId,
    );
  }

  /** リビジョンを増加 */
  public incrementRevision(currentRevision: number): void {
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET revision = ?
       WHERE singleton_id = 1`,
      currentRevision + 1,
    );
  }

  /** Room 状態を更新 */
  public updateRoomState(
    state: RoomStatus,
    stateStartedAt: string | null,
    revision: number,
  ): void {
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET state = ?, state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      state,
      stateStartedAt,
      revision,
    );
  }

  /** Room 設定を更新 */
  public updateRoomSettings(settingsJson: string, revision: number): void {
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET settings_json = ?, revision = ?
       WHERE singleton_id = 1`,
      settingsJson,
      revision,
    );
  }

  // ==================== スケジュール操作 ====================

  /** スケジュール操作を登録 */
  public scheduleOperation(
    operationId: string,
    dueAt: number,
    kind: RoomScheduledOperationKind,
    payloadJson: string,
  ): RoomScheduledOperation {
    this.insertScheduledOperation(operationId, dueAt, kind, payloadJson);

    return {
      id: operationId,
      dueAt,
      kind,
      payload: parseJsonValue(payloadJson),
    };
  }

  /** スケジュール操作を登録（DB の kind 列には disconnect 系も格納される） */
  private insertScheduledOperation(
    operationId: string,
    dueAt: number,
    kind: string,
    payloadJson: string,
  ): void {
    this.deps.storage.sql.exec(
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
      operationId,
      dueAt,
      kind,
      payloadJson,
    );
  }

  /** スケジュール操作をキャンセル */
  public async cancelScheduledOperation(operationId: string): Promise<boolean> {
    const before = this.deps.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
        operationId,
      )
      .one().count;

    this.deps.storage.sql.exec(
      "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
      operationId,
    );

    return before > 0;
  }

  /** 登録済み期限処理を一覧 */
  public readScheduledOperations(): readonly RoomScheduledOperation[] {
    return this.deps.storage.sql
      .exec<ScheduledOperationRow>(
        `SELECT
          operation_id AS operationId,
          due_at AS dueAt,
          kind,
          payload_json AS payloadJson
         FROM flarelobby_room_scheduled_operations
         ORDER BY due_at ASC, operation_id ASC`,
      )
      .toArray()
      .map((operation) =>
        Object.freeze({
          id: operation.operationId,
          dueAt: operation.dueAt,
          kind: operation.kind,
          payload: parseJsonValue(operation.payloadJson),
        }),
      );
  }

  /** 次回 Alarm を取得 */
  public async getNextAlarm(): Promise<number | null> {
    return this.deps.storage.getAlarm();
  }

  /** Alarm を同期 */
  public async synchronizeAlarm(): Promise<void> {
    const next = this.deps.storage.sql
      .exec<NextAlarmRow>(
        `SELECT MIN(due_at) AS nextDueAt
         FROM flarelobby_room_scheduled_operations`,
      )
      .one().nextDueAt;
    const current = await this.deps.storage.getAlarm();

    if (next === null) {
      if (current !== null) {
        await this.deps.storage.deleteAlarm();
      }
      return;
    }

    const requested = next;

    if (current === null || requested !== current) {
      await this.deps.storage.setAlarm(requested);
    }
  }

  // ==================== 処理済みコマンド（冪等性） ====================

  /** 処理済みコマンドを保存 */
  public async recordProcessedCommand(
    requestId: string,
    command: string,
    payload: JsonValue,
    result: JsonValue,
  ): Promise<RoomProcessedCommand> {
    const room = this.readRoomRow();
    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room に処理済みコマンドを保存できません。",
      });
    }

    const expiresAtCandidate =
      Math.max(this.deps.now(), Date.now()) + room.processedCommandRetentionMs;

    if (!Number.isSafeInteger(expiresAtCandidate)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "処理済みコマンドの保持期限を安全に計算できません。",
      });
    }
    const expiresAt = expiresAtCandidate;

    this.purgeExpiredProcessedCommands(this.deps.now());

    const existing = this.readProcessedCommand(requestId);

    if (existing !== null) {
      if (
        existing.value.command !== command ||
        existing.payloadJson !== JSON.stringify(payload)
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるコマンドを登録できません。",
        });
      }

      return existing.value;
    }

    const createdAt = this.deps.now();
    const payloadJson = JSON.stringify(payload);
    const resultJson = JSON.stringify(result);

    this.deps.storage.sql.exec(
      `INSERT INTO flarelobby_processed_commands (
        request_id, command, payload_json, result_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        command = excluded.command,
        payload_json = excluded.payload_json,
        result_json = excluded.result_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at`,
      requestId,
      command,
      payloadJson,
      resultJson,
      createdAt,
      expiresAt,
    );

    return Object.freeze({
      requestId,
      command,
      payload: deepFreezeUtil(payload),
      result: deepFreezeUtil(result),
      createdAt,
    });
  }

  /** 処理済みコマンドを読み取る */
  public readProcessedCommand(
    requestId: string,
  ): { value: RoomProcessedCommand; payloadJson: string } | null {
    const row = this.deps.storage.sql
      .exec<ProcessedCommandRow>(
        `SELECT
          request_id AS requestId,
          command,
          payload_json AS payloadJson,
          result_json AS resultJson,
          created_at AS createdAt,
          expires_at AS expiresAt
         FROM flarelobby_processed_commands
         WHERE request_id = ?`,
        requestId,
      )
      .toArray()[0];

    if (row === undefined) {
      return null;
    }

    if (row.expiresAt <= this.deps.now()) {
      this.deps.storage.sql.exec(
        "DELETE FROM flarelobby_processed_commands WHERE request_id = ?",
        requestId,
      );
      return null;
    }

    return {
      payloadJson: row.payloadJson,
      value: Object.freeze({
        requestId: row.requestId,
        command: row.command,
        payload: parseJsonValue(row.payloadJson),
        result: parseJsonValue(row.resultJson),
        createdAt: row.createdAt,
      }),
    };
  }

  /** 期限切れ処理済みコマンドを削除 */
  public purgeExpiredProcessedCommands(now: number): void {
    this.deps.storage.sql.exec(
      "DELETE FROM flarelobby_processed_commands WHERE expires_at <= ?",
      now,
    );
  }

  /** 処理済みコマンドからスナップショットを復元 */
  public restoreOperationResult(
    request: NormalizedOperationRequest,
    command: string,
  ): RoomSnapshot | null {
    if (request.requestId === null) {
      return null;
    }

    const existing = this.readProcessedCommand(request.requestId);

    if (existing === null) {
      return null;
    }

    if (
      existing.value.command !== command ||
      existing.payloadJson !== request.payloadJson
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "同じ requestId に異なる操作条件を指定できません。",
      });
    }

    return deepFreezeUtil(existing.value.result) as unknown as RoomSnapshot;
  }

  // ==================== スナップショット結果パース ====================

  /** スナップショット結果をパース */
  public parseRoomSnapshotResult(resultJson: string): RoomSnapshot {
    const result = parseJsonValue(resultJson);
    return deepFreezeUtil(result) as unknown as RoomSnapshot;
  }

  // ==================== ルームイベント ====================

  /** ルームイベントを記録 */
  public recordRoomEvent(event: ServerEventEnvelope): void {
    const room = this.readRoomRow();
    if (room === undefined) return;

    this.deps.storage.sql.exec(
      `INSERT INTO flarelobby_room_events (
        revision,
        event_json,
        created_at
      ) VALUES (?, ?, ?)`,
      event.revision,
      JSON.stringify(event),
      this.deps.now(),
    );
    this.deps.storage.sql.exec(
      `DELETE FROM flarelobby_room_events
       WHERE event_id NOT IN (
         SELECT event_id
         FROM flarelobby_room_events
         ORDER BY revision DESC, event_id DESC
         LIMIT ?
       )`,
      room.eventHistoryLimit,
    );
  }

  /** 再開イベントを読み取る */
  public readResumeEvents(
    lastRevision: number | null,
    currentRevision: number,
  ): {
    readonly useSnapshot: boolean;
    readonly events: readonly ProtocolMessage[];
  } {
    const room = this.readRoomRow();

    if (
      room === undefined ||
      lastRevision === null ||
      lastRevision < 0 ||
      lastRevision > currentRevision ||
      currentRevision - lastRevision > room.eventHistoryLimit
    ) {
      return { useSnapshot: true, events: [] };
    }

    const rows = this.deps.storage.sql
      .exec<RoomEventRow>(
        `SELECT
          event_id AS eventId,
          revision,
          event_json AS eventJson
         FROM flarelobby_room_events
         WHERE revision > ? AND revision <= ?
         ORDER BY revision ASC, event_id ASC`,
        lastRevision,
        currentRevision,
      )
      .toArray();

    const events = rows.map((row) =>
      Object.freeze(
        parseJsonValue(row.eventJson) as unknown as ProtocolMessage,
      ),
    );

    if (events.length === 0) {
      return { useSnapshot: false, events: [] };
    }

    if (currentRevision - lastRevision > room.eventHistoryLimit) {
      return { useSnapshot: true, events: [] };
    }

    return { useSnapshot: false, events: Object.freeze(events) };
  }

  // ==================== WebSocket 接続管理 ====================

  /** WebSocket 接続を保存 */
  public storeWebSocketConnection(
    attachment: RoomWebSocketAttachment,
    resumeTokenExpiresAt: number,
    isResume: boolean,
  ): void {
    this.deps.storage.sql.exec(
      `INSERT INTO flarelobby_room_connections (
        resume_id,
        room_id,
        principal_id,
        participant_id,
        role,
        connected_at,
        disconnected_at,
        connection_generation,
        resume_token_expires_at,
        invalidated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
      ON CONFLICT(resume_id) DO UPDATE SET
        room_id = excluded.room_id,
        principal_id = excluded.principal_id,
        participant_id = excluded.participant_id,
        role = excluded.role,
        connected_at = excluded.connected_at,
        disconnected_at = NULL,
        connection_generation = excluded.connection_generation,
        resume_token_expires_at = excluded.resume_token_expires_at,
        invalidated_at = CASE
          WHEN ? THEN invalidated_at
          ELSE NULL
        END`,
      attachment.resumeId,
      attachment.roomId,
      attachment.principal.id,
      attachment.participantId,
      attachment.role,
      attachment.connectedAt,
      attachment.connectionGeneration,
      resumeTokenExpiresAt,
      isResume ? 1 : 0,
    );
  }

  /** 切断済みマーク */
  public async markWebSocketDisconnected(
    attachment: RoomWebSocketAttachment,
  ): Promise<void> {
    const current = this.readRoomConnection(attachment.resumeId);

    if (
      current === undefined ||
      current.connectionGeneration !== attachment.connectionGeneration ||
      current.disconnectedAt !== null ||
      current.invalidatedAt !== null
    ) {
      return;
    }

    const disconnectedAt = new Date().toISOString();
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_room_connections
       SET disconnected_at = ?
       WHERE resume_id = ?
         AND connection_generation = ?
         AND disconnected_at IS NULL`,
      disconnectedAt,
      attachment.resumeId,
      attachment.connectionGeneration,
    );
  }

  /** 接続行を読み取る */
  public readRoomConnection(resumeId: string): RoomConnectionRow | undefined {
    return this.deps.storage.sql
      .exec<RoomConnectionRow>(
        `SELECT
          resume_id AS resumeId,
          room_id AS roomId,
          principal_id AS principalId,
          participant_id AS participantId,
          role,
          connected_at AS connectedAt,
          disconnected_at AS disconnectedAt,
          connection_generation AS connectionGeneration,
          resume_token_expires_at AS resumeTokenExpiresAt,
          invalidated_at AS invalidatedAt
         FROM flarelobby_room_connections
         WHERE resume_id = ?`,
        resumeId,
      )
      .toArray()[0];
  }

  /** 再開セッションを無効化 */
  public invalidateResumeSessions(participantId: string): void {
    const now = new Date().toISOString();
    this.deps.storage.sql.exec(
      `UPDATE flarelobby_room_connections
       SET invalidated_at = COALESCE(invalidated_at, ?),
           disconnected_at = COALESCE(disconnected_at, ?)
       WHERE participant_id = ?`,
      now,
      now,
      participantId,
    );
  }

  /** 切断操作をキャンセル */
  public cancelDisconnectOperation(participantId: string): void {
    this.deps.storage.sql.exec(
      `DELETE FROM flarelobby_room_scheduled_operations
       WHERE operation_id = ?`,
      `__flarelobby_disconnect__:${participantId}`,
    );
  }

  /** 参加者切断をスケジュール */
  public async scheduleParticipantDisconnect(
    participantId: string,
    disconnectedAt: Timestamp,
  ): Promise<void> {
    const room = this.readRoomRow();
    if (room === undefined) return;

    const disconnectedAtMs = Date.parse(disconnectedAt);
    const dueAt = disconnectedAtMs + room.disconnectGracePeriodMs;

    if (!Number.isSafeInteger(dueAt)) {
      return;
    }

    const operationId = `__flarelobby_disconnect__:${participantId}`;
    this.insertScheduledOperation(
      operationId,
      dueAt,
      "participant_disconnect",
      JSON.stringify({ participantId }),
    );
    await this.synchronizeAlarm();
  }

  // ==================== カスタムルームインデックス ====================

  /** 参加者数を読み取る */
  public readParticipantCounts(): {
    readonly total: number;
    readonly players: number;
    readonly spectators: number;
  } {
    const row = this.deps.storage.sql
      .exec<{ total: number; players: number; spectators: number }>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN kind = 'player' THEN 1 ELSE 0 END) AS players,
           SUM(CASE WHEN kind = 'spectator' THEN 1 ELSE 0 END) AS spectators
         FROM flarelobby_room_participants`,
      )
      .one();

    return {
      total: row.total,
      players: row.players,
      spectators: row.spectators,
    };
  }
}
