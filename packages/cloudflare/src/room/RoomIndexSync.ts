import { FlareLobbyError } from "@flarelobby/core";
import type { RoomRow, ScheduledOperationRow } from "../room.js";
import type { JsonValue } from "@flarelobby/core";
import type { CustomRoomIndexRecord } from "../custom-room-index.js";
import {
  CUSTOM_ROOM_INDEX_RETRY_DELAY_MS,
  CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID,
  ROOM_INDEX_UPSERT_OPERATION_KIND,
  ROOM_INDEX_DELETE_OPERATION_KIND,
} from "../room.js";
import {
  upsertCustomRoomIndex,
  deleteCustomRoomIndex,
} from "../custom-room-index.js";
import {
  parseCustomRoomIndexRecord,
  parseJsonValue,
  parseJsonObject,
  readIndexString,
  isJsonObject,
  isNonEmptyString,
} from "../room.js";

/**
 * カスタムルームインデックス同期の依存インターフェース。
 */
export interface RoomIndexSyncDependencies {
  /** Room 行を読み取る */
  readRoomRow(): RoomRow | undefined;
  /** 参加者数を読み取る */
  readParticipantCounts(): {
    readonly total: number;
    readonly players: number;
    readonly spectators: number;
  };
  /** SQLite 実行 */
  exec(sql: string, ...args: unknown[]): void;
  /** Alarm 同期 */
  synchronizeAlarm(): Promise<void>;
  /** D1 データベース */
  readonly FLARE_LOBBY_DB: D1Database;
}

/**
 * カスタムルームインデックス同期ハンドラ。
 * 公開カスタムルームの派生一覧を D1 に反映し、失敗時は Room 内の Alarm へ残す。
 */
export class RoomIndexSync {
  constructor(private readonly deps: RoomIndexSyncDependencies) {}

  /**
   * 公開ルームの派生一覧を D1 へ反映し、失敗時は Room 内の Alarm へ残す。
   * Room の強整合な状態より弱い派生データのため、同期失敗で Room 操作を失敗させない。
   */
  public async enqueueCustomRoomIndexSync(): Promise<void> {
    try {
      const room = this.deps.readRoomRow();

      if (
        room === undefined ||
        room.kind !== "custom" ||
        room.visibility !== "public"
      ) {
        return;
      }

      const record = this.createCustomRoomIndexRecord(room);

      if (record === null) {
        return;
      }

      const kind = ROOM_INDEX_UPSERT_OPERATION_KIND;
      const payload: JsonValue = record;
      const payloadJson = JSON.stringify(payload);
      const now = Date.now();

      this.deps.exec(
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
        CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID,
        now,
        kind,
        payloadJson,
      );

      await this.processCustomRoomIndexOperation({
        operationId: CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID,
        dueAt: now,
        kind,
        payloadJson,
      });
      await this.deps.synchronizeAlarm();
    } catch {
      // 一覧は Room の強整合な状態より弱い派生データです。同期失敗で
      // Room 操作を失敗させず、保存済みの期限処理を次回 Alarm へ残します。
      try {
        await this.deps.synchronizeAlarm();
      } catch {
        // Alarm の設定失敗も次回の Room 入力時に再同期を試みます。
      }
    }
  }

  /**
   * 保存済み一覧同期を一度試し、失敗時は再試行時刻を更新します。
   */
  public async processCustomRoomIndexOperation(
    operation: ScheduledOperationRow,
  ): Promise<boolean> {
    try {
      if (operation.kind === ROOM_INDEX_UPSERT_OPERATION_KIND) {
        const record = parseCustomRoomIndexRecord(
          parseJsonValue(operation.payloadJson),
        );
        await upsertCustomRoomIndex(this.deps.FLARE_LOBBY_DB, record);
      } else if (operation.kind === ROOM_INDEX_DELETE_OPERATION_KIND) {
        const payload = parseJsonValue(operation.payloadJson);

        if (!isJsonObject(payload) || !isNonEmptyString(payload["roomId"])) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        await deleteCustomRoomIndex(
          this.deps.FLARE_LOBBY_DB,
          payload["roomId"],
        );
      } else {
        return false;
      }

      this.deps.exec(
        `DELETE FROM flarelobby_room_scheduled_operations
         WHERE operation_id = ?
           AND due_at = ?
           AND kind = ?
           AND payload_json = ?`,
        operation.operationId,
        operation.dueAt,
        operation.kind,
        operation.payloadJson,
      );
      return true;
    } catch {
      this.rescheduleCustomRoomIndexOperation(operation);
      return false;
    }
  }

  /**
   * D1 の一時障害を表す pending 状態を Room SQLite に保持します。
   */
  public rescheduleCustomRoomIndexOperation(
    operation: ScheduledOperationRow,
  ): void {
    const dueAt = Math.max(
      Date.now() + CUSTOM_ROOM_INDEX_RETRY_DELAY_MS,
      operation.dueAt + CUSTOM_ROOM_INDEX_RETRY_DELAY_MS,
    );

    this.deps.exec(
      `UPDATE flarelobby_room_scheduled_operations
       SET due_at = ?
       WHERE operation_id = ?
         AND due_at = ?
         AND kind = ?
         AND payload_json = ?`,
      dueAt,
      operation.operationId,
      operation.dueAt,
      operation.kind,
      operation.payloadJson,
    );
  }

  /**
   * Room SQLite の正本から、公開可能な一覧レコードだけを組み立てます。
   */
  public createCustomRoomIndexRecord(
    room: RoomRow,
  ): CustomRoomIndexRecord | null {
    if (
      room.kind !== "custom" ||
      room.visibility === null ||
      room.joinMethod === null ||
      room.maxPlayers === null
    ) {
      return null;
    }

    const metadata = parseJsonObject(room.metadataJson);
    const settings = parseJsonObject(room.settingsJson);
    const counts = this.deps.readParticipantCounts();
    const maxSpectators = room.maxSpectators ?? 0;

    return {
      roomId: room.roomId,
      name: readIndexString(metadata["name"]) ?? "ルーム",
      mode: readIndexString(settings["mode"]),
      region: readIndexString(settings["region"]),
      state: room.state,
      joinMethod: room.joinMethod,
      maxPlayers: room.maxPlayers,
      playerCount: counts.players,
      availableSlots: Math.max(0, room.maxPlayers - counts.players),
      maxSpectators,
      spectatorCount: counts.spectators,
      availableSpectatorSlots: Math.max(0, maxSpectators - counts.spectators),
      revision: room.revision,
      createdAt: room.createdAt,
      updatedAt: Date.now(),
    };
  }
}

/** 公開ルームの派生一覧を D1 へ反映し、失敗時は Room 内の Alarm へ残す。 */
export async function enqueueCustomRoomIndexSync(
  deps: RoomIndexSyncDependencies,
): Promise<void> {
  const handler = new RoomIndexSync(deps);
  return handler.enqueueCustomRoomIndexSync();
}

/** 保存済み一覧同期を一度試し、失敗時は再試行時刻を更新します。 */
export async function processCustomRoomIndexOperation(
  deps: RoomIndexSyncDependencies,
  operation: ScheduledOperationRow,
): Promise<boolean> {
  const handler = new RoomIndexSync(deps);
  return handler.processCustomRoomIndexOperation(operation);
}

/** D1 の一時障害を表す pending 状態を Room SQLite に保持します。 */
export function rescheduleCustomRoomIndexOperation(
  deps: RoomIndexSyncDependencies,
  operation: ScheduledOperationRow,
): void {
  const handler = new RoomIndexSync(deps);
  handler.rescheduleCustomRoomIndexOperation(operation);
}

/** Room SQLite の正本から、公開可能な一覧レコードだけを組み立てます。 */
export function createCustomRoomIndexRecord(
  deps: RoomIndexSyncDependencies,
  room: RoomRow,
): CustomRoomIndexRecord | null {
  const handler = new RoomIndexSync(deps);
  return handler.createCustomRoomIndexRecord(room);
}
