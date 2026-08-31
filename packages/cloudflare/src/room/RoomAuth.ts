import { FlareLobbyError } from "@flarelobby/core";
import type { Principal, RoomSnapshot } from "@flarelobby/core";
import type { GatewayPrincipalEnvelope } from "../security.js";
import type {
  RoomParticipantOperationOptions,
  RoomHostOperationOptions,
  RoomParticipantRole,
} from "../room.js";
import type { RoomRow, ParticipantRow } from "../room.js";
import { verifyGatewayPrincipalEnvelope } from "../security.js";

/**
 * Room 認証・認可ロジックをまとめたモジュール。
 * Durable Object から分離することでテスタビリティを向上。
 */

export interface AuthenticatedRoomActor {
  readonly principal: Principal;
  readonly room: RoomRow;
  readonly participant: ParticipantRow;
}

/** Room 単位の入力ゲートで使用するトークン署名用シークレット */
export interface RoomAuthConfig {
  readonly tokenSecret: string;
}

/**
 * Gateway プリンシパルを検証し、主体情報を解決する。
 */
export async function resolveGatewayPrincipal(
  config: RoomAuthConfig,
  gatewayPrincipal: GatewayPrincipalEnvelope,
): Promise<Principal | null> {
  return verifyGatewayPrincipalEnvelope(config.tokenSecret, gatewayPrincipal);
}

/**
 * 参加者操作の認証を行う。
 * - トークン検証
 * - Room 存在確認
 * - 参加者存在確認
 * - プレイヤーID 一致確認
 */
export async function authenticateParticipant(
  config: RoomAuthConfig,
  readRoomRow: () => RoomRow | undefined,
  readParticipantById: (participantId: string) => ParticipantRow | undefined,
  options: RoomParticipantOperationOptions,
): Promise<AuthenticatedRoomActor> {
  const principal = await resolveGatewayPrincipal(
    config,
    options.gatewayPrincipal,
  );

  if (principal === null) {
    throw new FlareLobbyError("UNAUTHENTICATED");
  }

  const room = readRoomRow();

  if (room === undefined) {
    throw new FlareLobbyError("CONFLICT", {
      message: "初期化されていない Room は操作できません。",
    });
  }

  const participant = readParticipantById(options.participantId);

  if (
    participant === undefined ||
    participant.playerId !== principal.playerId
  ) {
    throw new FlareLobbyError("FORBIDDEN");
  }

  return { principal, room, participant };
}

/**
 * ホスト操作の認証を行う。
 * 参加者認証に加えて:
 * - カスタムルームであること
 * - ホスト情報が設定されていること
 * - 参加者がプレイヤーであること
 * - 参加者がホストであること
 */
export async function authenticateHost(
  config: RoomAuthConfig,
  readRoomRow: () => RoomRow | undefined,
  readParticipantById: (participantId: string) => ParticipantRow | undefined,
  options: RoomHostOperationOptions,
): Promise<AuthenticatedRoomActor> {
  const actor = await authenticateParticipant(
    config,
    readRoomRow,
    readParticipantById,
    options,
  );

  if (
    actor.room.kind !== "custom" ||
    actor.room.hostParticipantId === null ||
    actor.room.hostPlayerId === null ||
    actor.participant.kind !== "player" ||
    actor.room.hostParticipantId !== actor.participant.participantId ||
    actor.room.hostPlayerId !== actor.participant.playerId
  ) {
    throw new FlareLobbyError("FORBIDDEN");
  }

  return actor;
}

/**
 * Room が初期化済みかつアクティブ（非 finished）であることを確認
 */
export function assertActiveRoom(room: RoomRow): void {
  if (room.state === "finished") {
    throw new FlareLobbyError("ROOM_FINISHED");
  }
}

/**
 * Room が待機状態であることを確認
 */
export function assertWaitingRoom(room: RoomRow): void {
  if (room.state !== "waiting") {
    throw new FlareLobbyError("CONFLICT", {
      message: "待機状態の Room でのみ実行できます。",
    });
  }
}

/**
 * Room が初期化済みであることを確認
 */
export function assertInitializedRoom(room: RoomRow | undefined): void {
  if (room === undefined) {
    throw new FlareLobbyError("CONFLICT", {
      message: "初期化されていない Room は操作できません。",
    });
  }
}

/**
 * スナップショットが存在することを確認して取得
 */
export function readRequiredSnapshot(
  readSnapshot: () => RoomSnapshot | null,
): RoomSnapshot {
  const snapshot = readSnapshot();
  if (snapshot === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
  return snapshot;
}

/**
 * 参加者の役割を検証
 */
export function assertPlayerRole(role: RoomParticipantRole): void {
  if (role !== "player") {
    throw new FlareLobbyError("FORBIDDEN");
  }
}
