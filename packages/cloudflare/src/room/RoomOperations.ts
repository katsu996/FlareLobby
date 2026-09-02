import { FlareLobbyError } from "@flarelobby/core";
import type {
  RoomRow,
  ParticipantRow,
  RoomOperationResult,
  RoomSetReadyOptions,
  RoomSelectTeamOptions,
  RoomUpdateSettingsOptions,
  RoomTransferHostOptions,
  RoomKickOptions,
  RoomStartMatchOptions,
  RoomCloseOptions,
  RoomParticipantOperationOptions,
  RoomHostOperationOptions,
} from "../room.js";
import type { RoomSnapshot } from "@flarelobby/core";
import {
  normalizeSetReadyOptions,
  normalizeSelectTeamOptions,
  normalizeUpdateSettingsOptions,
  normalizeTransferHostOptions,
  normalizeKickOptions,
  normalizeStartMatchOptions,
  normalizeCloseOptions,
  normalizeOperationRequest,
  parseJsonObject,
  serializeJsonObject,
  assertWaitingRoom,
} from "../room.js";
import {
  ROOM_SET_READY_COMMAND,
  ROOM_SELECT_TEAM_COMMAND,
  ROOM_UPDATE_SETTINGS_COMMAND,
  ROOM_TRANSFER_HOST_COMMAND,
  ROOM_KICK_COMMAND,
  ROOM_START_MATCH_COMMAND,
  ROOM_CLOSE_COMMAND,
  ROOM_RETENTION_OPERATION_ID,
} from "../room.js";

/**
 * Room 操作の依存インターフェース。
 * Durable Object から必要な機能を抽象化し、テスタビリティを確保。
 */
export interface RoomOperationsDependencies {
  /** Room 行を読み取る */
  readRoomRow(): RoomRow | undefined;
  /** 参加者行を読み取る */
  readParticipantById(participantId: string): ParticipantRow | undefined;
  /** プレイヤーID で参加者行を読み取る */
  readParticipantByPlayerId(playerId: string): ParticipantRow | undefined;
  /** プレイヤー数を読み取る */
  readPlayerCounts(): { readonly total: number; readonly ready: number };
  /** スナップショットを読み取る */
  readSnapshot(): RoomSnapshot | null;
  /** 必須スナップショットを読み取る */
  readRequiredSnapshot(): RoomSnapshot;
  /** 参加者認証 */
  authenticateParticipant(options: RoomParticipantOperationOptions): Promise<{
    readonly principal: import("@flarelobby/core").Principal;
    readonly room: RoomRow;
    readonly participant: ParticipantRow;
  }>;
  /** ホスト認証 */
  authenticateHost(options: RoomHostOperationOptions): Promise<{
    readonly principal: import("@flarelobby/core").Principal;
    readonly room: RoomRow;
    readonly participant: ParticipantRow;
  }>;
  /** SQL 実行 */
  exec(sql: string, ...args: unknown[]): void;
  /** リビジョンを増加 */
  incrementRevision(revision: number): void;
  /** チーム存在確認 */
  teamExists(teamId: string): boolean;
  /** ホスト設定 */
  setHost(participant: ParticipantRow): void;
  /** 再開セッション無効化 */
  invalidateResumeSessions(participantId: string): void;
  /** 切断操作キャンセル */
  cancelDisconnectOperation(participantId: string): void;
  /** Alarm 同期 */
  synchronizeAlarm(): Promise<void>;
  /** スナップショットをブロードキャスト */
  broadcastRoomSnapshot(snapshot: RoomSnapshot): void;
  /** 処理済みコマンド復元 */
  restoreOperationResult(
    request: import("../room.js").NormalizedOperationRequest,
    command: string,
  ): RoomSnapshot | null;
  /** 操作結果を保存 */
  storeOperationResult(
    request: import("../room.js").NormalizedOperationRequest,
    command: string,
    result: RoomSnapshot,
  ): Promise<RoomSnapshot>;
  /** カスタムルームインデックス同期をキューイング */
  enqueueCustomRoomIndexSync(): Promise<void>;
  /** 最小プレイヤー数を取得 */
  getMinimumPlayers(): number;
  /** 全プレイヤー準備完了要求を取得 */
  getRequireAllPlayersReady(): number;
}

/**
 * Room 操作モジュール。
 * 参加者・ホスト操作（準備・チーム・設定・ホスト移譲・キック・開始・閉鎖）をまとめる。
 */
export class RoomOperations {
  constructor(private readonly deps: RoomOperationsDependencies) {}

  /** 自身の準備状態を変更します。 */
  public async setReady(
    options: RoomSetReadyOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeSetReadyOptions(options);
    const actor = await this.deps.authenticateParticipant(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, ready: normalized.ready },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_SET_READY_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);

    if (actor.participant.kind !== "player") {
      throw new FlareLobbyError("FORBIDDEN");
    }

    this.deps.exec(
      `UPDATE flarelobby_room_participants
       SET ready = ?
       WHERE participant_id = ?`,
      normalized.ready ? 1 : 0,
      actor.participant.participantId,
    );
    this.deps.incrementRevision(actor.room.revision);

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);

    return this.deps.storeOperationResult(
      request,
      ROOM_SET_READY_COMMAND,
      snapshot,
    );
  }

  /** 自身のチームを選択します。 */
  public async selectTeam(
    options: RoomSelectTeamOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeSelectTeamOptions(options);
    const actor = await this.deps.authenticateParticipant(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, teamId: normalized.teamId },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_SELECT_TEAM_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);

    if (actor.participant.kind !== "player") {
      throw new FlareLobbyError("FORBIDDEN");
    }

    if (
      normalized.teamId !== null &&
      !this.deps.teamExists(normalized.teamId)
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "指定されたチームはこの Room で選択できません。",
      });
    }

    this.deps.exec(
      `UPDATE flarelobby_room_participants
       SET team_id = ?
       WHERE participant_id = ?`,
      normalized.teamId,
      actor.participant.participantId,
    );
    this.deps.incrementRevision(actor.room.revision);

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);

    return this.deps.storeOperationResult(
      request,
      ROOM_SELECT_TEAM_COMMAND,
      snapshot,
    );
  }

  /** ルーム設定を更新します（ホスト専用）。 */
  public async updateSettings(
    options: RoomUpdateSettingsOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeUpdateSettingsOptions(options);
    const actor = await this.deps.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      {
        participantId: normalized.participantId,
        settings: normalized.settings,
      },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_UPDATE_SETTINGS_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const currentSettings = parseJsonObject(actor.room.settingsJson);
    const settingsJson = serializeJsonObject({
      ...currentSettings,
      ...normalized.settings,
    });

    this.deps.exec(
      `UPDATE flarelobby_rooms
       SET settings_json = ?, revision = ?
       WHERE singleton_id = 1`,
      settingsJson,
      actor.room.revision + 1,
    );

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);
    const result = await this.deps.storeOperationResult(
      request,
      ROOM_UPDATE_SETTINGS_COMMAND,
      snapshot,
    );
    await this.deps.enqueueCustomRoomIndexSync();
    return result;
  }

  /** ホスト権限を移譲します（ホスト専用）。 */
  public async transferHost(
    options: RoomTransferHostOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeTransferHostOptions(options);
    const actor = await this.deps.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      {
        participantId: normalized.participantId,
        targetParticipantId: normalized.targetParticipantId,
      },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_TRANSFER_HOST_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const target = this.deps.readParticipantById(
      normalized.targetParticipantId,
    );

    if (target === undefined || target.kind !== "player") {
      throw new FlareLobbyError("CONFLICT", {
        message: "移譲先は同じ Room のプレイヤーで指定してください。",
      });
    }

    if (target.participantId === actor.participant.participantId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "現在のホスト自身へは移譲できません。",
      });
    }

    this.deps.setHost(target);
    this.deps.incrementRevision(actor.room.revision);

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);

    return this.deps.storeOperationResult(
      request,
      ROOM_TRANSFER_HOST_COMMAND,
      snapshot,
    );
  }

  /** 参加者を強制退出させます（ホスト専用）。 */
  public async kick(options: RoomKickOptions): Promise<RoomOperationResult> {
    const normalized = normalizeKickOptions(options);
    const actor = await this.deps.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      {
        participantId: normalized.participantId,
        ...(normalized.targetParticipantId === null
          ? {}
          : { targetParticipantId: normalized.targetParticipantId }),
        ...(normalized.targetPlayerId === null
          ? {}
          : { targetPlayerId: normalized.targetPlayerId }),
        ...(normalized.reason === null ? {} : { reason: normalized.reason }),
      },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_KICK_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const target =
      normalized.targetParticipantId === null
        ? this.deps.readParticipantByPlayerId(normalized.targetPlayerId!)
        : this.deps.readParticipantById(normalized.targetParticipantId);

    if (target === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "強制退出の対象がこの Room に存在しません。",
      });
    }

    if (target.participantId === actor.participant.participantId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "ホスト自身を強制退出させることはできません。",
      });
    }

    this.deps.exec(
      "DELETE FROM flarelobby_room_participants WHERE participant_id = ?",
      target.participantId,
    );
    this.deps.invalidateResumeSessions(target.participantId);
    this.deps.cancelDisconnectOperation(target.participantId);
    this.deps.incrementRevision(actor.room.revision);

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);
    const result = await this.deps.storeOperationResult(
      request,
      ROOM_KICK_COMMAND,
      snapshot,
    );
    await this.deps.enqueueCustomRoomIndexSync();
    return result;
  }

  /** 開始条件を検証し、Room を対戦中へ進めます。 */
  public async startMatch(
    options: RoomStartMatchOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeStartMatchOptions(options);
    const actor = await this.deps.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, at: normalized.at },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_START_MATCH_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const playerCounts = this.deps.readPlayerCounts();

    if (playerCounts.total < this.deps.getMinimumPlayers()) {
      throw new FlareLobbyError("CONFLICT", {
        message: `開始には ${this.deps.getMinimumPlayers()} 人以上のプレイヤーが必要です。`,
      });
    }

    if (
      this.deps.getRequireAllPlayersReady() === 1 &&
      playerCounts.ready !== playerCounts.total
    ) {
      throw new FlareLobbyError("CONFLICT", {
        message: "すべてのプレイヤーが準備完了になるまで開始できません。",
      });
    }

    const preparationRevision = actor.room.revision + 1;
    const startedAt = normalized.at;

    // 公開状態遷移の規約に従い、開始操作の内部で準備中を経由します。
    // 2 つの SQL 更新には await を挟まないため、外部からは一つの原子的な
    // Room 操作として観測されます。
    this.deps.exec(
      `UPDATE flarelobby_rooms
       SET state = 'preparing', state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      startedAt,
      preparationRevision,
    );
    const preparingSnapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(preparingSnapshot);
    this.deps.exec(
      `UPDATE flarelobby_rooms
       SET state = 'in_progress', state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      startedAt,
      preparationRevision + 1,
    );

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);
    const result = await this.deps.storeOperationResult(
      request,
      ROOM_START_MATCH_COMMAND,
      snapshot,
    );
    await this.deps.enqueueCustomRoomIndexSync();
    return result;
  }

  /** ホストが Room を終了済みにします。 */
  public async close(options: RoomCloseOptions): Promise<RoomOperationResult> {
    const normalized = normalizeCloseOptions(options);
    await this.deps.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, at: normalized.at },
    );
    const existing = this.deps.restoreOperationResult(
      request,
      ROOM_CLOSE_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    // RoomOperations では active チェックのみ（RoomAuth で実装）
    const room = this.deps.readRoomRow();
    if (room === undefined || room.state === "finished") {
      throw new FlareLobbyError("ROOM_FINISHED");
    }

    const finishedAt = Date.parse(normalized.at);
    const retentionDueAt = finishedAt + room.finishedRoomRetentionMs;

    if (!Number.isSafeInteger(retentionDueAt)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "終了時刻と保持期間から安全な期限を計算できません。",
      });
    }

    this.deps.exec(
      `UPDATE flarelobby_rooms
       SET state = 'finished', state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      normalized.at,
      room.revision + 1,
    );
    this.deps.exec(
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
      retentionDueAt,
    );

    const snapshot = this.deps.readRequiredSnapshot();
    this.deps.broadcastRoomSnapshot(snapshot);
    const result = await this.deps.storeOperationResult(
      request,
      ROOM_CLOSE_COMMAND,
      snapshot,
    );
    await this.deps.enqueueCustomRoomIndexSync();
    await this.deps.synchronizeAlarm();
    return result;
  }
}

export async function setReady(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomSetReadyOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.setReady(options);
}

export async function selectTeam(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomSelectTeamOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.selectTeam(options);
}

export async function updateSettings(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomUpdateSettingsOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.updateSettings(options);
}

export async function transferHost(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomTransferHostOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.transferHost(options);
}

export async function kick(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomKickOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.kick(options);
}

export async function startMatch(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomStartMatchOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.startMatch(options);
}

export async function close(
  deps: RoomOperationsDependencies,
  options: import("../room.js").RoomCloseOptions,
): Promise<import("../room.js").RoomOperationResult> {
  const handler = new RoomOperations(deps);
  return handler.close(options);
}

// 型参照用
