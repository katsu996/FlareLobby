import { FlareLobbyError } from "@flarelobby/core";
import type { RoomStatus, Timestamp, RoomSnapshot } from "@flarelobby/core";
import {
  ROOM_RETENTION_OPERATION_ID,
  type RoomStateTransitionOptions,
  type RoomRow,
} from "../room.js";

/**
 * Room 状態遷移の純粋ロジックをまとめたモジュール。
 *
 * Durable Object のストレージ操作から分離することで、状態遷移ルールを
 * 独立してテスト可能にする。
 */

/** 許可される状態遷移: waiting → preparing → in_progress → finished、および waiting → finished */
export function isAllowedTransition(
  current: RoomStatus,
  next: RoomStatus,
): boolean {
  return (
    (current === "waiting" && (next === "preparing" || next === "finished")) ||
    (current === "preparing" && next === "in_progress") ||
    (current === "in_progress" && next === "finished")
  );
}

/** 文字列が有効な RoomStatus か判定 */
export function isRoomStatus(value: unknown): value is RoomStatus {
  return (
    value === "waiting" ||
    value === "preparing" ||
    value === "in_progress" ||
    value === "finished"
  );
}

/** 状態遷移入力を正規化 */
export function normalizeTransition(
  target: RoomStatus | RoomStateTransitionOptions,
  occurredAt?: Timestamp,
): RoomStateTransitionOptions & { readonly at: Timestamp } {
  const status = typeof target === "string" ? target : target?.status;
  const at =
    typeof target === "string" ? occurredAt : (target?.at ?? occurredAt);

  if (!isRoomStatus(status)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const normalizedAt = at ?? new Date().toISOString();

  if (!isValidTimestamp(normalizedAt)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "状態変更時刻は有効な Timestamp で指定してください。",
    });
  }

  return { status, at: normalizedAt };
}

/** Timestamp 文字列の妥当性検証 */
function isValidTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * Room 状態を遷移させるコアロジック。
 * ストレージ操作はコールバック経由で行うことで、DO への依存を分離。
 */
export interface TransitionContext {
  /** 現在の RoomRow を読み取る */
  readRoomRow(): RoomRow | undefined;
  /** SQLite 更新を実行する */
  exec(sql: string, ...args: unknown[]): void;
  /** Alarm を同期する */
  synchronizeAlarm(): Promise<void>;
  /** スナップショットを読み取る */
  readSnapshot(): RoomSnapshot | null;
  /** スナップショットをブロードキャストする */
  broadcastRoomSnapshot(snapshot: RoomSnapshot): void;
  /** カスタムルームインデックス同期をキューイングする */
  enqueueCustomRoomIndexSync(): Promise<void>;
  /** finishedRoomRetentionMs を取得する */
  getFinishedRoomRetentionMs(): number;
}

/** 遷移実行結果 */
export interface TransitionResult {
  readonly snapshot: RoomSnapshot;
  readonly retentionDueAt: number | null;
}

/**
 * Room 状態遷移を実行します。
 * 実際のストレージ操作は context コールバック経由で行われます。
 */
export async function executeTransition(
  context: TransitionContext,
  target: RoomStatus | RoomStateTransitionOptions,
  occurredAt?: Timestamp,
): Promise<TransitionResult> {
  const transition = normalizeTransition(target, occurredAt);
  const room = context.readRoomRow();

  if (room === undefined) {
    throw new FlareLobbyError("CONFLICT", {
      message: "初期化されていない Room は状態変更できません。",
    });
  }

  if (room.state === "finished") {
    throw new FlareLobbyError("ROOM_FINISHED");
  }

  if (room.state === transition.status) {
    await context.synchronizeAlarm();

    const snapshot = context.readSnapshot();
    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }
    return { snapshot, retentionDueAt: null };
  }

  if (!isAllowedTransition(room.state, transition.status)) {
    throw new FlareLobbyError("CONFLICT", {
      message: `Room の状態を ${room.state} から ${transition.status} へ変更できません。`,
    });
  }

  let retentionDueAt: number | null = null;

  if (transition.status === "finished") {
    const at = Date.parse(transition.at);
    const dueAt = at + context.getFinishedRoomRetentionMs();

    if (!Number.isSafeInteger(dueAt)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "終了時刻と保持期間から安全な期限を計算できません。",
      });
    }

    retentionDueAt = dueAt;
  }

  const nextRevision = room.revision + 1;
  const stateStartedAt = transition.status === "waiting" ? null : transition.at;

  context.exec(
    `UPDATE flarelobby_rooms
     SET state = ?,
         state_started_at = ?,
         revision = ?
     WHERE singleton_id = 1`,
    transition.status,
    stateStartedAt,
    nextRevision,
  );

  if (retentionDueAt !== null) {
    context.exec(
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
  }

  await context.synchronizeAlarm();

  const snapshot = context.readSnapshot();
  if (snapshot === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  context.broadcastRoomSnapshot(snapshot);
  await context.enqueueCustomRoomIndexSync();

  return { snapshot, retentionDueAt };
}
