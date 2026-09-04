import type {
  RoomInitializationOptions,
  RoomParticipantJoinOptions,
  RoomParticipantJoinResult,
  RoomParticipantLeaveOptions,
  RoomParticipantLeaveResult,
  RoomParticipantDisconnectOptions,
  RoomSetReadyOptions,
  RoomSelectTeamOptions,
  RoomUpdateSettingsOptions,
  RoomTransferHostOptions,
  RoomKickOptions,
  RoomStartMatchOptions,
  RoomCloseOptions,
  RoomStateTransitionOptions,
  RoomScheduledOperation,
  RoomScheduledOperationOptions,
  RoomOperationResult,
  RoomWebSocketAttachment,
  RoomProcessedCommandOptions,
  RoomProcessedCommand,
  RoomRow,
  ParticipantRow,
} from "../room.js";
import type {
  GatewayPrincipalEnvelope,
  FlareLobbyRoomParticipantRole,
} from "../security.js";
import type { FlareLobbyObservabilityContext } from "../observability.js";
import type {
  Principal,
  Timestamp,
  RoomStatus,
  RoomSnapshot,
} from "@flarelobby/core";

/**
 * Room Durable Object の公開インターフェース。
 *
 * 外部コード（テスト、設定、ブートストラップ）はこのインターフェース経由で
 * Room 機能を利用し、実装クラス `RoomDurableObject` の詳細を知る必要はありません。
 *
 * 実装クラスは `DurableObject<Env>` を継承し、このインターフェースを実装します。
 */
export interface IRoomDurableObject {
  /** WebSocket Upgrade ハンドラ（Hibernation API エントリーポイント） */
  fetch(request: Request): Promise<Response>;

  /** WebSocket メッセージ受信ハンドラ */
  webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void>;

  /** WebSocket 切断ハンドラ */
  webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void>;

  /** WebSocket エラーハンドラ */
  webSocketError(webSocket: WebSocket, error: unknown): Promise<void>;

  /** Alarm ハンドラ（期限処理の実行） */
  alarm(): void | Promise<void>;

  /**
   * ルームを初期化します。
   * 既に初期化済みの場合は現在のスナップショットを返します。
   */
  initialize(options: RoomInitializationOptions): Promise<RoomSnapshot>;

  /** 現在のルームスナップショットを取得します */
  getSnapshot(): Promise<RoomSnapshot | null>;

  /** getSnapshot のエイリアス */
  getRoomSnapshot(): Promise<RoomSnapshot | null>;

  /** 参加者をルームに参加させます */
  join(options: RoomParticipantJoinOptions): Promise<RoomParticipantJoinResult>;

  /** join() の意味を明示する別名 */
  joinParticipant(
    options: RoomParticipantJoinOptions,
  ): Promise<RoomParticipantJoinResult>;

  /** 参加者をルームから退出させます */
  leave(
    options: RoomParticipantLeaveOptions,
  ): Promise<RoomParticipantLeaveResult>;

  /** leave() の意味を明示する別名 */
  leaveParticipant(
    options: RoomParticipantLeaveOptions,
  ): Promise<RoomParticipantLeaveResult>;

  /** 参加者の通信切断を処理します（猶予期間内は参加状態を維持） */
  disconnect(options: RoomParticipantDisconnectOptions): Promise<RoomSnapshot>;

  /** 自身の準備状態を変更します */
  setReady(options: RoomSetReadyOptions): Promise<RoomOperationResult>;

  /** 自身のチームを選択します */
  selectTeam(options: RoomSelectTeamOptions): Promise<RoomOperationResult>;

  /** ルーム設定を更新します（ホスト専用） */
  updateSettings(
    options: RoomUpdateSettingsOptions,
  ): Promise<RoomOperationResult>;

  /** ホスト権限を移譲します（ホスト専用） */
  transferHost(options: RoomTransferHostOptions): Promise<RoomOperationResult>;

  /** 参加者を強制退出させます（ホスト専用） */
  kick(options: RoomKickOptions): Promise<RoomOperationResult>;

  /** 対戦を開始します（ホスト専用） */
  startMatch(options: RoomStartMatchOptions): Promise<RoomOperationResult>;

  /** ルームを閉鎖します（ホスト専用） */
  close(options: RoomCloseOptions): Promise<RoomOperationResult>;

  /** close() の説明的な別名 */
  closeRoom(options: RoomCloseOptions): Promise<RoomOperationResult>;

  /** ルーム状態を遷移させます（内部用・テスト用） */
  transition(
    target: RoomStatus | RoomStateTransitionOptions,
    occurredAt?: Timestamp,
  ): Promise<RoomSnapshot>;

  /** transition() の別名 */
  transitionState(
    target: RoomStatus | RoomStateTransitionOptions,
    occurredAt?: Timestamp,
  ): Promise<RoomSnapshot>;

  /** 期限処理を登録します */
  scheduleOperation(
    options: RoomScheduledOperationOptions,
  ): Promise<RoomScheduledOperation>;

  /** scheduleOperation() の意味を明示する別名 */
  scheduleDeadline(
    options: RoomScheduledOperationOptions,
  ): Promise<RoomScheduledOperation>;

  /** 期限処理をキャンセルします */
  cancelScheduledOperation(operationId: string): Promise<boolean>;

  /** 登録済み期限処理を一覧します */
  listScheduledOperations(): Promise<readonly RoomScheduledOperation[]>;

  /** 次回 Alarm 実行時刻を取得します */
  getNextAlarm(): Promise<number | null>;

  /** 処理済みコマンドを記録します（冪等性用） */
  recordProcessedCommand(
    options: RoomProcessedCommandOptions,
  ): Promise<RoomProcessedCommand>;

  /** 処理済みコマンド結果を取得します */
  getProcessedCommand(requestId: string): Promise<RoomProcessedCommand | null>;

  /** Gateway プリンシパルを解決します（内部用） */
  resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope,
  ): Promise<Principal | null>;

  /** 内部メソッド（テスト用の直接呼び出し） */
  internalJoinParticipant(
    room: RoomRow,
    participant: ParticipantRow,
    role: FlareLobbyRoomParticipantRole,
    attachment: RoomWebSocketAttachment,
    isResume: boolean,
    context: FlareLobbyObservabilityContext,
  ): Promise<RoomSnapshot>;

  internalLeaveParticipant(
    room: RoomRow,
    participantId: string,
    options: RoomParticipantLeaveOptions,
  ): Promise<RoomSnapshot>;

  // 型参照用
  readonly [Symbol.toStringTag]?: "IRoomDurableObject";
}
