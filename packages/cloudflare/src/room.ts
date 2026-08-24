import { DurableObject } from "cloudflare:workers";
import {
  encodeProtocolMessage,
  FlareLobbyError,
  PROTOCOL_VERSION,
} from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  CustomRoom,
  ClientCommandEnvelope,
  FlareLobbyApp,
  Host,
  JsonObject,
  JsonValue,
  MatchRoom,
  MatchmakingPool,
  Participant,
  Principal,
  Room,
  RoomSnapshot,
  RoomState,
  RoomStatus,
  ProtocolMessage,
  ProtocolResult,
  ServerEventEnvelope,
  ServerFailureEnvelope,
  ServerSuccessEnvelope,
  Team,
  Timestamp,
} from "@flarelobby/core";
import {
  createGatewayPrincipalEnvelope,
  createErrorResponse,
  FLARE_LOBBY_WEBSOCKET_PROTOCOL,
  issueResumeToken,
  readWebSocketJoinToken,
  validateWebSocketCommand,
  verifyWebSocketRoomToken,
  verifyGatewayPrincipalEnvelope,
} from "./security.js";
import type {
  FlareLobbyRoomParticipantRole,
  GatewayPrincipalEnvelope,
} from "./security.js";
import {
  createObservabilityContext,
  createObservabilitySink,
  FLARE_LOBBY_OPERATION_HEADER,
  observeOperation,
  observeHttpOperation,
  readObservabilityContext,
} from "./observability.js";
import type { FlareLobbyObservabilityContext } from "./observability.js";
import {
  CUSTOM_ROOM_INDEX_RETRY_DELAY_MS,
  CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID,
  deleteCustomRoomIndex,
  upsertCustomRoomIndex,
} from "./custom-room-index.js";
import type { CustomRoomIndexRecord } from "./custom-room-index.js";
import {
  DEFAULT_DISCONNECT_GRACE_PERIOD_MS,
  DEFAULT_EVENT_HISTORY_LIMIT,
  DEFAULT_FINISHED_ROOM_RETENTION_MS,
  DEFAULT_PROCESSED_COMMAND_RETENTION_MS,
  DEFAULT_RESUME_TOKEN_TTL_MS,
} from "./room-constants.js";
export {
  DEFAULT_DISCONNECT_GRACE_PERIOD_MS,
  DEFAULT_EVENT_HISTORY_LIMIT,
  DEFAULT_FINISHED_ROOM_RETENTION_MS,
  DEFAULT_PROCESSED_COMMAND_RETENTION_MS,
  DEFAULT_RESUME_TOKEN_TTL_MS,
} from "./room-constants.js";

/** カスタムルームで選択できる参加方式です。 */
export type RoomJoinMethod = "public" | "invitation" | "password";

/** Room 内で参加者へ割り当てる役割です。 */
export type RoomParticipantRole = FlareLobbyRoomParticipantRole;

const ROOM_RETENTION_OPERATION_ID = "__flarelobby_room_retention__";
const ROOM_INDEX_UPSERT_OPERATION_KIND = "custom_room_index_upsert" as const;
const ROOM_INDEX_DELETE_OPERATION_KIND = "custom_room_index_delete" as const;
const ROOM_PROCESSED_COMMAND_CLEANUP_OPERATION_ID =
  "__flarelobby_processed_command_cleanup__";
const ROOM_DISCONNECT_OPERATION_PREFIX = "__flarelobby_disconnect__:";
const ROOM_SET_READY_COMMAND = "room.set_ready";
const ROOM_SELECT_TEAM_COMMAND = "room.select_team";
const ROOM_UPDATE_SETTINGS_COMMAND = "room.update_settings";
const ROOM_TRANSFER_HOST_COMMAND = "room.transfer_host";
const ROOM_KICK_COMMAND = "room.kick";
const ROOM_START_MATCH_COMMAND = "room.start_match";
const ROOM_CLOSE_COMMAND = "room.close";
const ROOM_SNAPSHOT_EVENT = "room.snapshot";
const GAME_MESSAGE_EVENT = "game.message";
const ROOM_WEBSOCKET_ATTACHMENT_VERSION = 1 as const;
const DEFAULT_WEBSOCKET_MESSAGE_BYTES = 8 * 1024;
const DEFAULT_WEBSOCKET_MESSAGE_LIMIT = 60;
const ROOM_WEBSOCKET_MESSAGE_BYTES_HEADER =
  "x-flarelobby-websocket-message-bytes";
const ROOM_WEBSOCKET_MESSAGE_LIMIT_HEADER =
  "x-flarelobby-websocket-message-limit";
const ROOM_WEBSOCKET_TAG_PREFIX = "flarelobby:room:";
const PARTICIPANT_WEBSOCKET_TAG_PREFIX = "flarelobby:participant:";
const PRINCIPAL_WEBSOCKET_TAG_PREFIX = "flarelobby:principal:";
const ROLE_WEBSOCKET_TAG_PREFIX = "flarelobby:role:";
const RESUME_WEBSOCKET_TAG_PREFIX = "flarelobby:resume:";
const MAX_GAME_MESSAGE_NAME_LENGTH = 128;
const ROOM_DISCONNECT_OPERATION_TYPE = "participant_disconnect";
const ROOM_PROCESSED_COMMAND_CLEANUP_OPERATION_TYPE =
  "processed_command_cleanup";

/** ルーム単位の Hibernation WebSocket を検索するタグです。 */
export function getRoomWebSocketTag(roomId: string): string {
  return `${ROOM_WEBSOCKET_TAG_PREFIX}${roomId}`;
}

/** 参加者単位の Hibernation WebSocket を検索するタグです。 */
export function getParticipantWebSocketTag(participantId: string): string {
  return `${PARTICIPANT_WEBSOCKET_TAG_PREFIX}${participantId}`;
}

/** 主体単位の Hibernation WebSocket を検索するタグです。 */
export function getPrincipalWebSocketTag(principalId: string): string {
  return `${PRINCIPAL_WEBSOCKET_TAG_PREFIX}${principalId}`;
}

/** WebSocket の役割単位で接続を検索するタグです。 */
export function getRoleWebSocketTag(role: RoomParticipantRole): string {
  return `${ROLE_WEBSOCKET_TAG_PREFIX}${role}`;
}

/** WebSocket の再開識別子を検索するタグです。 */
export function getResumeWebSocketTag(resumeId: string): string {
  return `${RESUME_WEBSOCKET_TAG_PREFIX}${resumeId}`;
}

function getDisconnectOperationId(participantId: string): string {
  return `${ROOM_DISCONNECT_OPERATION_PREFIX}${participantId}`;
}

/** Hibernation WebSocket の attachment に保存する接続固有情報です。 */
export interface RoomWebSocketAttachment {
  readonly version: typeof ROOM_WEBSOCKET_ATTACHMENT_VERSION;
  readonly roomId: string;
  readonly principal: Principal;
  readonly participantId: string;
  readonly role: RoomParticipantRole;
  readonly connectedAt: Timestamp;
  readonly resumeId: string;
  readonly connectionGeneration: string;
  readonly maxWebSocketMessageBytes: number;
  readonly maxMessagesPerMinute: number;
}

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
  /** 開始に必要なプレイヤー数です。省略時は `maxPlayers` と同じです。 */
  readonly minimumPlayers?: number;
  /** 開始時に全プレイヤーの準備完了を要求するかです。既定値は `true` です。 */
  readonly requireAllPlayersReady?: boolean;
  /** 開始条件をまとめて指定する入力別名です。 */
  readonly startConditions?: RoomStartConditions;
  /** カスタムルームの参加方式です。 */
  readonly joinMethod?: RoomJoinMethod;
  /** パスワード方式でのみ使用する参加パスワードです。永続化しません。 */
  readonly password?: string;
  /** 終了済み状態を保持する期間です。0 の場合は即時削除対象になります。 */
  readonly finishedRoomRetentionMs?: number;
  /** 再開トークンの有効期間です。 */
  readonly resumeTokenTtlMs?: number;
  /** 通信切断後に参加状態を保持する猶予期間です。0 の場合は次の Alarm で処理します。 */
  readonly disconnectGracePeriodMs?: number;
  /** Room に保持する状態変更イベントの最大件数です。 */
  readonly eventHistoryLimit?: number;
  /** 処理済みコマンド結果の保持期間です。 */
  readonly processedCommandRetentionMs?: number;
  /** Gateway から引き継ぐ観測相関情報です。永続化しません。 */
  readonly observability?: FlareLobbyObservabilityContext;
}

/** Room の対戦開始条件です。 */
export interface RoomStartConditions {
  readonly minimumPlayers?: number;
  readonly requireAllPlayersReady?: boolean;
}

/** Room Durable Object へ参加を要求する入力です。 */
export interface RoomParticipantJoinOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly role: RoomParticipantRole;
  readonly invitationCode?: string;
  readonly password?: string;
  readonly observability?: FlareLobbyObservabilityContext;
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
  readonly observability?: FlareLobbyObservabilityContext;
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
  /** 切断時刻。省略時は Durable Object の現在時刻を使用します。 */
  readonly at?: Timestamp;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** 再開情報を含む初回または再接続時の `room.snapshot` Payload 拡張です。 */
export interface RoomResumeHandshake {
  readonly resumeToken: string;
  readonly resumeTokenExpiresAt: number;
  readonly participantId: string;
  readonly role: RoomParticipantRole;
  readonly resumed: boolean;
}

/** 参加者本人が行う Room 操作の共通入力です。 */
export interface RoomParticipantOperationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly participantId: string;
  /** 指定時は同じ要求の再送を同じ結果へ収束させます。 */
  readonly requestId?: string;
  /** 要求の補足値です。実際の操作入力と一緒に冪等性判定へ利用します。 */
  readonly requestPayload?: JsonValue;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** 自身の準備状態を変更する入力です。 */
export interface RoomSetReadyOptions extends RoomParticipantOperationOptions {
  readonly ready: boolean;
}

/** 自身のチームを変更する入力です。`null` は未選択へ戻します。 */
export interface RoomSelectTeamOptions extends RoomParticipantOperationOptions {
  readonly teamId: string | null;
}

/** ホスト専用操作の共通入力です。 */
export interface RoomHostOperationOptions {
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  readonly participantId: string;
  readonly requestId?: string;
  readonly requestPayload?: JsonValue;
  readonly observability?: FlareLobbyObservabilityContext;
}

/** ルーム設定を更新する入力です。指定したキーを既存設定へ浅くマージします。 */
export interface RoomUpdateSettingsOptions extends RoomHostOperationOptions {
  readonly settings: JsonObject;
}

/** ホスト移譲の入力です。 */
export interface RoomTransferHostOptions extends RoomHostOperationOptions {
  readonly targetParticipantId: string;
}

/** 参加者を強制退出させる入力です。 */
export interface RoomKickOptions extends RoomHostOperationOptions {
  readonly targetParticipantId?: string;
  readonly targetPlayerId?: string;
  readonly reason?: string;
}

/** 対戦開始の入力です。 */
export interface RoomStartMatchOptions extends RoomHostOperationOptions {
  /** 省略時は Durable Object の現在時刻を使用します。 */
  readonly at?: Timestamp;
}

/** ルーム閉鎖の入力です。 */
export interface RoomCloseOptions extends RoomHostOperationOptions {
  /** 省略時は Durable Object の現在時刻を使用します。 */
  readonly at?: Timestamp;
}

/** Room の参加者操作が成功したときに返す最新スナップショットです。 */
export type RoomOperationResult = RoomSnapshot;

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
export type RoomScheduledOperationKind =
  | "noop"
  | "room_retention"
  | "custom_room_index_upsert"
  | "custom_room_index_delete";

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
  minimumPlayers: number;
  requireAllPlayersReady: number;
  joinMethod: RoomJoinMethod | null;
  joinPasswordSalt: string | null;
  joinPasswordHash: string | null;
  finishedRoomRetentionMs: number;
  createdAt: number;
  resumeTokenTtlMs: number;
  disconnectGracePeriodMs: number;
  eventHistoryLimit: number;
  processedCommandRetentionMs: number;
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
  expiresAt: number;
}

interface ScheduledOperationRow extends Record<string, SqlStorageValue> {
  operationId: string;
  dueAt: number;
  kind: RoomScheduledOperationKind;
  payloadJson: string;
}

interface RoomConnectionRow extends Record<string, SqlStorageValue> {
  resumeId: string;
  roomId: string;
  principalId: string;
  participantId: string;
  role: RoomParticipantRole;
  connectedAt: string;
  disconnectedAt: string | null;
  connectionGeneration: string;
  resumeTokenExpiresAt: number;
  invalidatedAt: string | null;
}

interface RoomEventRow extends Record<string, SqlStorageValue> {
  eventId: number;
  revision: number;
  eventJson: string;
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
  readonly minimumPlayers: number;
  readonly requireAllPlayersReady: boolean;
  readonly joinMethod: RoomJoinMethod | null;
  readonly joinPasswordSalt: string | null;
  readonly joinPasswordHash: string | null;
  readonly finishedRoomRetentionMs: number;
  readonly resumeTokenTtlMs: number;
  readonly disconnectGracePeriodMs: number;
  readonly eventHistoryLimit: number;
  readonly processedCommandRetentionMs: number;
  readonly participants: readonly NormalizedParticipant[];
  readonly teams: readonly string[];
}

interface AuthenticatedRoomActor {
  readonly principal: Principal;
  readonly room: RoomRow;
  readonly participant: ParticipantRow;
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

  /** Gateway から転送された WebSocket Upgrade を Hibernation API へ渡します。 */
  public override async fetch(request: Request): Promise<Response> {
    const context = readObservabilityContext(request);
    const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);
    const operation =
      request.headers.get(FLARE_LOBBY_OPERATION_HEADER) ?? "room.connect";

    return observeHttpOperation(sink, context, operation, async () => {
      if (
        request.method !== "GET" ||
        request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
      ) {
        return new Response("Not Found", { status: 404 });
      }

      const roomId = getWebSocketRoomId(request);

      if (roomId === null || !hasWebSocketProtocol(request)) {
        return createErrorResponse(new FlareLobbyError("INVALID_MESSAGE"));
      }

      const token = readWebSocketJoinToken(request);

      if (!token.ok) {
        return createErrorResponse(token.error);
      }

      const claims = await verifyWebSocketRoomToken(
        this.env.FLARE_LOBBY_TOKEN_SECRET,
        token.value,
        { roomId },
      );

      if (!claims.ok) {
        return createErrorResponse(claims.error);
      }

      if (claims.value.participantId === undefined) {
        return createErrorResponse(new FlareLobbyError("UNAUTHENTICATED"));
      }

      const lastRevision = readLastRevision(request);

      if (!lastRevision.ok) {
        return createErrorResponse(lastRevision.error);
      }

      let connectionAttachment: RoomWebSocketAttachment | undefined;

      try {
        const room = this.readRoomRow();

        if (room === undefined || room.roomId !== roomId) {
          return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
        }

        if (room.state === "finished") {
          return createErrorResponse(new FlareLobbyError("ROOM_FINISHED"));
        }

        const participant = this.readParticipantById(
          claims.value.participantId,
        );

        if (
          participant === undefined ||
          participant.kind !== claims.value.role
        ) {
          return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
        }

        const isResume = claims.value.purpose === "resume";
        let resumeToken = token.value;
        let resumeTokenExpiresAt = claims.value.expiresAt;
        let resumeId = crypto.randomUUID();

        if (isResume) {
          const connection = this.readRoomConnection(claims.value.nonce);

          if (
            connection === undefined ||
            connection.roomId !== roomId ||
            connection.principalId !== claims.value.principalId ||
            connection.participantId !== participant.participantId ||
            connection.role !== participant.kind ||
            connection.invalidatedAt !== null ||
            connection.resumeTokenExpiresAt <= Date.now() ||
            connection.disconnectedAt === null
          ) {
            return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
          }

          const disconnectedAt = Date.parse(connection.disconnectedAt);

          if (
            !Number.isFinite(disconnectedAt) ||
            disconnectedAt + room.disconnectGracePeriodMs < Date.now()
          ) {
            this.expireDisconnectedParticipant(
              room,
              participant.participantId,
              connection.disconnectedAt,
            );
            await this.synchronizeAlarm();
            return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
          }

          resumeId = connection.resumeId;
          resumeTokenExpiresAt = connection.resumeTokenExpiresAt;
          this.cancelDisconnectOperation(participant.participantId);
        }

        const connectedAt = new Date().toISOString();
        const connectionGeneration = crypto.randomUUID();

        if (!isResume) {
          const resumeTokenNow = Date.now();
          resumeTokenExpiresAt = resumeTokenNow + room.resumeTokenTtlMs;
          const issuedResumeToken = await issueResumeToken(
            this.env.FLARE_LOBBY_TOKEN_SECRET,
            {
              principal: {
                id: claims.value.principalId,
                playerId: participant.playerId,
              },
              roomId,
              role: participant.kind,
              participantId: participant.participantId,
              expiresAt: resumeTokenExpiresAt,
              now: resumeTokenNow,
              nonce: resumeId,
            },
          );

          if (!issuedResumeToken.ok) {
            return createErrorResponse(issuedResumeToken.error);
          }

          resumeToken = issuedResumeToken.value;
        }

        const snapshot = this.readSnapshot();

        if (snapshot === null) {
          return createErrorResponse(new FlareLobbyError("CONNECTION_FAILED"));
        }

        connectionAttachment = Object.freeze({
          version: ROOM_WEBSOCKET_ATTACHMENT_VERSION,
          roomId,
          principal: Object.freeze({
            id: claims.value.principalId,
            playerId: participant.playerId,
          }),
          participantId: participant.participantId,
          role: participant.kind,
          connectedAt,
          resumeId,
          connectionGeneration,
          maxWebSocketMessageBytes: readPositiveHeader(
            request.headers.get(ROOM_WEBSOCKET_MESSAGE_BYTES_HEADER),
            DEFAULT_WEBSOCKET_MESSAGE_BYTES,
          ),
          maxMessagesPerMinute: readPositiveHeader(
            request.headers.get(ROOM_WEBSOCKET_MESSAGE_LIMIT_HEADER),
            DEFAULT_WEBSOCKET_MESSAGE_LIMIT,
          ),
        });
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        server.serializeAttachment(connectionAttachment);
        this.storeWebSocketConnection(
          connectionAttachment,
          resumeTokenExpiresAt,
          claims.value.purpose === "resume",
        );
        this.ctx.acceptWebSocket(
          server,
          createWebSocketTags(connectionAttachment),
        );

        const replay = isResume
          ? this.readResumeEvents(lastRevision.value, snapshot.revision)
          : null;
        const messages =
          replay === null || replay.useSnapshot
            ? [
                createRoomSnapshotEvent(snapshot, {
                  resumeToken,
                  resumeTokenExpiresAt,
                  participantId: participant.participantId,
                  role: participant.kind,
                  resumed: isResume,
                }),
              ]
            : replay.events.length === 0
              ? [
                  createRoomSnapshotEvent(snapshot, {
                    resumeToken,
                    resumeTokenExpiresAt,
                    participantId: participant.participantId,
                    role: participant.kind,
                    resumed: true,
                  }),
                ]
              : [
                  ...replay.events,
                  createRoomSnapshotEvent(snapshot, {
                    resumeToken,
                    resumeTokenExpiresAt,
                    participantId: participant.participantId,
                    role: participant.kind,
                    resumed: true,
                  }),
                ];

        if (
          !messages.every((message) =>
            this.sendProtocolMessage(server, message),
          )
        ) {
          await this.markWebSocketDisconnected(connectionAttachment);
          try {
            server.close(1011, "接続を初期化できませんでした。");
          } catch {
            // すでに閉じた WebSocket の例外は公開しません。
          }
        }

        return new Response(null, {
          status: 101,
          headers: {
            "Sec-WebSocket-Protocol": FLARE_LOBBY_WEBSOCKET_PROTOCOL,
          },
          webSocket: client,
        });
      } catch (error) {
        if (connectionAttachment !== undefined) {
          try {
            await this.markWebSocketDisconnected(connectionAttachment);
          } catch {
            // 接続行の後始末に失敗しても、公開エラーへ内部情報を含めません。
          }
        }

        return createErrorResponse(normalizeWebSocketError(error));
      }
    });
  }

  /** Hibernation 後を含む WebSocket の受信 Handler です。 */
  public override async webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.handleWebSocketMessage(webSocket, message);
    });
  }

  /** 切断時は接続状態だけを更新し、参加者行を削除しません。 */
  public override async webSocketClose(
    webSocket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const attachment = readWebSocketAttachment(webSocket);

      if (attachment !== null) {
        await this.markWebSocketDisconnected(attachment);
      }
    });
  }

  /** WebSocket エラー時も切断済み状態だけを記録します。 */
  public override async webSocketError(
    webSocket: WebSocket,
    _error: unknown,
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const attachment = readWebSocketAttachment(webSocket);

      if (attachment !== null) {
        await this.markWebSocketDisconnected(attachment);
      }
    });
  }

  /** Gateway の署名済み主体だけを受け入れます。 */
  public async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope,
  ) {
    return verifyGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      gatewayPrincipal,
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
    options: RoomInitializationOptions,
  ): Promise<RoomSnapshot> {
    const context =
      options.observability ?? createObservabilityContext(undefined);
    const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);

    return observeOperation(
      sink,
      context,
      options.room.kind === "match"
        ? "room.match.initialize"
        : "room.initialize",
      async () => {
        const normalized = await normalizeInitialization(options);
        const existing = this.readRoomRow();

        if (existing !== undefined) {
          if (existing.roomId !== normalized.roomId) {
            throw new FlareLobbyError("CONFLICT", {
              message: "Room Durable Object の識別子が既存状態と一致しません。",
            });
          }

          const snapshot = this.readSnapshot();

          if (snapshot === null) {
            throw new FlareLobbyError("CONNECTION_FAILED");
          }

          await this.enqueueCustomRoomIndexSync();

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
          minimum_players,
          require_all_players_ready,
          join_method,
          join_password_salt,
          join_password_hash,
          finished_room_retention_ms,
          resume_token_ttl_ms,
          disconnect_grace_period_ms,
          event_history_limit,
          processed_command_retention_ms,
          created_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            normalized.minimumPlayers,
            normalized.requireAllPlayersReady ? 1 : 0,
            normalized.joinMethod,
            normalized.joinPasswordSalt,
            normalized.joinPasswordHash,
            normalized.finishedRoomRetentionMs,
            normalized.resumeTokenTtlMs,
            normalized.disconnectGracePeriodMs,
            normalized.eventHistoryLimit,
            normalized.processedCommandRetentionMs,
            Date.now(),
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
              Date.now(),
            );
          }

          for (const teamId of normalized.teams) {
            this.ctx.storage.sql.exec(
              "INSERT INTO flarelobby_room_teams (team_id) VALUES (?)",
              teamId,
            );
          }

          const snapshot = this.readSnapshot();

          if (snapshot === null) {
            throw new FlareLobbyError("CONNECTION_FAILED");
          }

          await this.enqueueCustomRoomIndexSync();

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
      },
    );
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
    options: RoomParticipantJoinOptions,
  ): Promise<RoomParticipantJoinResult> {
    const context =
      options.observability ?? createObservabilityContext(undefined);
    const sink = createObservabilitySink(this.env.FLARE_LOBBY_ANALYTICS);

    return observeOperation(sink, context, "room.join", async () => {
      const principal = await this.resolveGatewayPrincipal(
        options.gatewayPrincipal,
      );

      if (principal === null) {
        throw new FlareLobbyError("UNAUTHENTICATED");
      }

      const normalized = normalizeParticipantJoinOptions(options);
      const room = this.readRoomRow();

      if (room === undefined) {
        throw new FlareLobbyError("CONFLICT", {
          message: "初期化されていない Room へ参加できません。",
        });
      }

      if (room.kind !== "custom" || room.joinMethod === null) {
        throw new FlareLobbyError("CONFLICT", {
          message: "カスタムルーム以外へ参加できません。",
        });
      }

      if (room.state === "finished") {
        throw new FlareLobbyError("ROOM_FINISHED");
      }

      if (room.state !== "waiting") {
        throw new FlareLobbyError("CONFLICT", {
          message: "待機中ではない Room へ参加できません。",
        });
      }

      await assertJoinCredentials(room, normalized);

      const existing = this.readParticipantByPlayerId(principal.playerId);

      if (existing !== undefined) {
        if (existing.kind !== normalized.role) {
          throw new FlareLobbyError("CONFLICT", {
            message: "同じ主体を別の役割で重複参加させることはできません。",
          });
        }

        const snapshot = this.readSnapshot();

        if (snapshot === null) {
          throw new FlareLobbyError("CONNECTION_FAILED");
        }

        return {
          participantId: existing.participantId,
          role: existing.kind,
          snapshot,
        };
      }

      const limit =
        normalized.role === "player" ? room.maxPlayers : room.maxSpectators;
      const count = this.ctx.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_room_participants WHERE kind = ?",
          normalized.role,
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
        Date.now(),
      );
      this.incrementRevision(room.revision);

      const snapshot = this.readSnapshot();

      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      this.broadcastRoomSnapshot(snapshot);
      await this.enqueueCustomRoomIndexSync();

      return {
        participantId,
        role: normalized.role,
        snapshot,
      };
    });
  }

  /** `join()` の意味を明示する別名です。 */
  public async joinParticipant(
    options: RoomParticipantJoinOptions,
  ): Promise<RoomParticipantJoinResult> {
    return this.join(options);
  }

  /**
   * 指定された参加者を明示的に退出させます。
   *
   * 退出では参加者行を削除するため、準備状態とチーム所属も同時に失われます。
   * 通信切断はこの RPC を呼ばない限り退出になりません。ホストが退出する場合は
   * 参加時刻が最も古いプレイヤーへ自動移譲し、移譲先がなければ Room を閉鎖します。
   */
  public async leave(
    options: RoomParticipantLeaveOptions,
  ): Promise<RoomParticipantLeaveResult> {
    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal,
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
            message: "同じ requestId に異なる退出条件を指定できません。",
          });
        }

        return parseParticipantLeaveResult(existing.value.result);
      }
    }

    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room から退出できません。",
      });
    }

    if (room.state === "finished") {
      throw new FlareLobbyError("ROOM_FINISHED");
    }

    const participant = this.readParticipantById(normalized.participantId);

    if (
      participant === undefined ||
      participant.playerId !== principal.playerId ||
      (normalized.role !== null && normalized.role !== participant.kind)
    ) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    const hostIsLeaving = room.hostParticipantId === participant.participantId;
    const successor = hostIsLeaving
      ? this.readOldestPlayerParticipant(participant.participantId)
      : undefined;

    this.invalidateResumeSessions(participant.participantId);
    this.cancelDisconnectOperation(participant.participantId);

    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_participants WHERE participant_id = ?",
      participant.participantId,
    );

    let shouldSynchronizeAlarm = false;

    if (successor !== undefined) {
      this.setHost(successor);
    } else if (hostIsLeaving) {
      // 移譲先がいない Room は、残った観戦者だけを保持したまま閉鎖します。
      // 退出したホストを履歴上の host として一時的に残すことで、既存の
      // CustomRoomSnapshot 契約（host は必須）を壊さず、保持期限後に削除できます。
      const finishedAt = new Date().toISOString();
      const dueAt = Date.parse(finishedAt) + room.finishedRoomRetentionMs;

      if (!Number.isSafeInteger(dueAt)) {
        throw new FlareLobbyError("INVALID_PAYLOAD", {
          message: "終了時刻と保持期間から安全な期限を計算できません。",
        });
      }

      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_rooms
         SET state = 'finished', state_started_at = ?
         WHERE singleton_id = 1`,
        finishedAt,
      );
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
        dueAt,
      );
      shouldSynchronizeAlarm = true;
    }

    this.incrementRevision(room.revision);

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const result: RoomParticipantLeaveResult = {
      participantId: participant.participantId,
      role: participant.kind,
      snapshot,
    };

    this.broadcastRoomSnapshot(snapshot);

    if (normalized.requestId !== null) {
      await this.recordProcessedCommand({
        requestId: normalized.requestId,
        command: "custom_room.leave",
        payload: parseJsonValue(normalized.requestPayloadJson),
        result: result as unknown as JsonValue,
      });
    }

    await this.enqueueCustomRoomIndexSync();

    if (shouldSynchronizeAlarm) {
      await this.synchronizeAlarm();
    }

    return result;
  }

  /** `leave()` の意味を明示する別名です。 */
  public async leaveParticipant(
    options: RoomParticipantLeaveOptions,
  ): Promise<RoomParticipantLeaveResult> {
    return this.leave(options);
  }

  /** 通信切断を参加猶予へ移し、現在のスナップショットを返します。 */
  public async disconnect(
    options: RoomParticipantDisconnectOptions,
  ): Promise<RoomSnapshot> {
    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal,
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

    await this.scheduleParticipantDisconnect(
      participant.participantId,
      normalized.at,
    );

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return snapshot;
  }

  /** 参加者本人の準備状態を変更します。 */
  public async setReady(
    options: RoomSetReadyOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeSetReadyOptions(options);
    const actor = await this.authenticateParticipant(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, ready: normalized.ready },
    );
    const existing = this.restoreOperationResult(
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

    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_room_participants
       SET ready = ?
       WHERE participant_id = ?`,
      normalized.ready ? 1 : 0,
      actor.participant.participantId,
    );
    this.incrementRevision(actor.room.revision);

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);

    return this.storeOperationResult(request, ROOM_SET_READY_COMMAND, snapshot);
  }

  /** 参加者本人のチーム選択を変更します。 */
  public async selectTeam(
    options: RoomSelectTeamOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeSelectTeamOptions(options);
    const actor = await this.authenticateParticipant(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, teamId: normalized.teamId },
    );
    const existing = this.restoreOperationResult(
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

    if (normalized.teamId !== null && !this.teamExists(normalized.teamId)) {
      throw new FlareLobbyError("CONFLICT", {
        message: "指定されたチームはこの Room で選択できません。",
      });
    }

    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_room_participants
       SET team_id = ?
       WHERE participant_id = ?`,
      normalized.teamId,
      actor.participant.participantId,
    );
    this.incrementRevision(actor.room.revision);

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);

    return this.storeOperationResult(
      request,
      ROOM_SELECT_TEAM_COMMAND,
      snapshot,
    );
  }

  /** ホストがルーム設定を更新します。設定は既存オブジェクトへ浅くマージします。 */
  public async updateSettings(
    options: RoomUpdateSettingsOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeUpdateSettingsOptions(options);
    const actor = await this.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      {
        participantId: normalized.participantId,
        settings: normalized.settings,
      },
    );
    const existing = this.restoreOperationResult(
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

    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET settings_json = ?, revision = ?
       WHERE singleton_id = 1`,
      settingsJson,
      actor.room.revision + 1,
    );

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);
    const result = await this.storeOperationResult(
      request,
      ROOM_UPDATE_SETTINGS_COMMAND,
      snapshot,
    );
    await this.enqueueCustomRoomIndexSync();
    return result;
  }

  /** ホストを別のプレイヤーへ明示的に移譲します。 */
  public async transferHost(
    options: RoomTransferHostOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeTransferHostOptions(options);
    const actor = await this.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      {
        participantId: normalized.participantId,
        targetParticipantId: normalized.targetParticipantId,
      },
    );
    const existing = this.restoreOperationResult(
      request,
      ROOM_TRANSFER_HOST_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const target = this.readParticipantById(normalized.targetParticipantId);

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

    this.setHost(target);
    this.incrementRevision(actor.room.revision);

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);

    return this.storeOperationResult(
      request,
      ROOM_TRANSFER_HOST_COMMAND,
      snapshot,
    );
  }

  /** ホストが参加者を強制退出させます。 */
  public async kick(options: RoomKickOptions): Promise<RoomOperationResult> {
    const normalized = normalizeKickOptions(options);
    const actor = await this.authenticateHost(normalized);
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
    const existing = this.restoreOperationResult(request, ROOM_KICK_COMMAND);

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const target =
      normalized.targetParticipantId === null
        ? this.readParticipantByPlayerId(normalized.targetPlayerId!)
        : this.readParticipantById(normalized.targetParticipantId);

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

    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_participants WHERE participant_id = ?",
      target.participantId,
    );
    this.invalidateResumeSessions(target.participantId);
    this.cancelDisconnectOperation(target.participantId);
    this.incrementRevision(actor.room.revision);

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);
    const result = await this.storeOperationResult(
      request,
      ROOM_KICK_COMMAND,
      snapshot,
    );
    await this.enqueueCustomRoomIndexSync();
    return result;
  }

  /** 開始条件を検証し、Room を対戦中へ進めます。 */
  public async startMatch(
    options: RoomStartMatchOptions,
  ): Promise<RoomOperationResult> {
    const normalized = normalizeStartMatchOptions(options);
    const actor = await this.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, at: normalized.at },
    );
    const existing = this.restoreOperationResult(
      request,
      ROOM_START_MATCH_COMMAND,
    );

    if (existing !== null) {
      return existing;
    }

    assertWaitingRoom(actor.room);
    const playerCounts = this.readPlayerCounts();

    if (playerCounts.total < actor.room.minimumPlayers) {
      throw new FlareLobbyError("CONFLICT", {
        message: `開始には ${actor.room.minimumPlayers} 人以上のプレイヤーが必要です。`,
      });
    }

    if (
      actor.room.requireAllPlayersReady === 1 &&
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
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET state = 'preparing', state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      startedAt,
      preparationRevision,
    );
    const preparingSnapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(preparingSnapshot);
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET state = 'in_progress', state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      startedAt,
      preparationRevision + 1,
    );

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);
    const result = await this.storeOperationResult(
      request,
      ROOM_START_MATCH_COMMAND,
      snapshot,
    );
    await this.enqueueCustomRoomIndexSync();
    return result;
  }

  /** ホストが Room を終了済みにします。 */
  public async close(options: RoomCloseOptions): Promise<RoomOperationResult> {
    const normalized = normalizeCloseOptions(options);
    const actor = await this.authenticateHost(normalized);
    const request = normalizeOperationRequest(
      normalized.requestId,
      normalized.requestPayload,
      { participantId: normalized.participantId, at: normalized.at },
    );
    const existing = this.restoreOperationResult(request, ROOM_CLOSE_COMMAND);

    if (existing !== null) {
      return existing;
    }

    assertActiveRoom(actor.room);
    const finishedAt = Date.parse(normalized.at);
    const retentionDueAt = finishedAt + actor.room.finishedRoomRetentionMs;

    if (!Number.isSafeInteger(retentionDueAt)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "終了時刻と保持期間から安全な期限を計算できません。",
      });
    }

    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET state = 'finished', state_started_at = ?, revision = ?
       WHERE singleton_id = 1`,
      normalized.at,
      actor.room.revision + 1,
    );
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
      retentionDueAt,
    );

    const snapshot = this.readRequiredSnapshot();
    this.broadcastRoomSnapshot(snapshot);
    const result = await this.storeOperationResult(
      request,
      ROOM_CLOSE_COMMAND,
      snapshot,
    );
    await this.enqueueCustomRoomIndexSync();
    await this.synchronizeAlarm();
    return result;
  }

  /** `close()` の説明的な別名です。 */
  public async closeRoom(
    options: RoomCloseOptions,
  ): Promise<RoomOperationResult> {
    return this.close(options);
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
    occurredAt?: Timestamp,
  ): Promise<RoomSnapshot> {
    const transition = normalizeTransition(target, occurredAt);
    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room は状態変更できません。",
      });
    }

    if (room.state === "finished") {
      throw new FlareLobbyError("ROOM_FINISHED");
    }

    if (room.state === transition.status) {
      await this.synchronizeAlarm();

      const snapshot = this.readSnapshot();

      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      return snapshot;
    }

    if (!isAllowedTransition(room.state, transition.status)) {
      throw new FlareLobbyError("CONFLICT", {
        message: `Room の状態を ${room.state} から ${transition.status} へ変更できません。`,
      });
    }

    let retentionDueAt: number | undefined;

    if (transition.status === "finished") {
      const at = Date.parse(transition.at);
      const dueAt = at + room.finishedRoomRetentionMs;

      if (!Number.isSafeInteger(dueAt)) {
        throw new FlareLobbyError("INVALID_PAYLOAD", {
          message: "終了時刻と保持期間から安全な期限を計算できません。",
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
      nextRevision,
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
        retentionDueAt,
      );
    }

    await this.synchronizeAlarm();

    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    this.broadcastRoomSnapshot(snapshot);
    await this.enqueueCustomRoomIndexSync();

    return snapshot;
  }

  /** オブジェクト形式の状態遷移 RPC です。文字列形式も後方互換に受け付けます。 */
  public async transitionState(
    target: RoomStatus | RoomStateTransitionOptions,
    occurredAt?: Timestamp,
  ): Promise<RoomSnapshot> {
    return this.transition(target, occurredAt);
  }

  /** Room 単位の期限処理を保存し、最も近い期限を Alarm へ反映します。 */
  public async scheduleOperation(
    options: RoomScheduledOperationOptions,
  ): Promise<RoomScheduledOperation> {
    const normalized = normalizeScheduledOperation(options);

    if (this.readRoomRow() === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room に期限処理を登録できません。",
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
      normalized.payloadJson,
    );

    await this.synchronizeAlarm();

    return {
      id: normalized.id,
      dueAt: normalized.dueAt,
      kind: normalized.kind,
      payload: parseJsonValue(normalized.payloadJson),
    };
  }

  /** `scheduleOperation()` の意味を明示する別名です。 */
  public async scheduleDeadline(
    options: RoomScheduledOperationOptions,
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
        operationId,
      )
      .one().count;

    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
      operationId,
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
    options: RoomProcessedCommandOptions,
  ): Promise<RoomProcessedCommand> {
    const normalized = normalizeProcessedCommand(options);
    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room に処理済みコマンドを保存できません。",
      });
    }

    const expiresAtCandidate =
      Math.max(Date.now(), normalized.createdAt) +
      room.processedCommandRetentionMs;

    if (!Number.isSafeInteger(expiresAtCandidate)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "処理済みコマンドの保持期限を安全に計算できません。",
      });
    }

    const expiresAt = expiresAtCandidate;

    this.purgeExpiredProcessedCommands(Date.now());
    const existing = this.readProcessedCommand(normalized.requestId);

    if (existing !== null) {
      if (
        existing.value.command !== normalized.command ||
        existing.payloadJson !== normalized.payloadJson
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるコマンドを登録できません。",
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
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      normalized.requestId,
      normalized.command,
      normalized.payloadJson,
      normalized.resultJson,
      normalized.createdAt,
      expiresAt,
    );

    this.scheduleProcessedCommandCleanup(expiresAt);
    await this.synchronizeAlarm();

    const stored = this.readProcessedCommand(normalized.requestId);

    if (stored === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return stored.value;
  }

  /** requestId に紐付く処理済みコマンドを返します。 */
  public async getProcessedCommand(
    requestId: string,
  ): Promise<RoomProcessedCommand | null> {
    if (!isNonEmptyString(requestId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    this.purgeExpiredProcessedCommands(Date.now());
    return this.readProcessedCommand(requestId)?.value ?? null;
  }

  /** 公開ルームの派生一覧を D1 へ反映し、失敗時は Room 内の Alarm へ残します。 */
  private async enqueueCustomRoomIndexSync(): Promise<void> {
    try {
      const room = this.readRoomRow();

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
      await this.synchronizeAlarm();
    } catch {
      // 一覧は Room の強整合な状態より弱い派生データです。同期失敗で
      // Room 操作を失敗させず、保存済みの期限処理を次回 Alarm へ残します。
      try {
        await this.synchronizeAlarm();
      } catch {
        // Alarm の設定失敗も次回の Room 入力時に再同期を試みます。
      }
    }
  }

  /** 保存済み一覧同期を一度試し、失敗時は再試行時刻を更新します。 */
  private async processCustomRoomIndexOperation(
    operation: ScheduledOperationRow,
  ): Promise<boolean> {
    try {
      if (operation.kind === ROOM_INDEX_UPSERT_OPERATION_KIND) {
        const record = parseCustomRoomIndexRecord(
          parseJsonValue(operation.payloadJson),
        );
        await upsertCustomRoomIndex(this.env.FLARE_LOBBY_DB, record);
      } else if (operation.kind === ROOM_INDEX_DELETE_OPERATION_KIND) {
        const payload = parseJsonValue(operation.payloadJson);

        if (!isJsonObject(payload) || !isNonEmptyString(payload["roomId"])) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        await deleteCustomRoomIndex(this.env.FLARE_LOBBY_DB, payload["roomId"]);
      } else {
        return false;
      }

      this.ctx.storage.sql.exec(
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

  /** D1 の一時障害を表す pending 状態を Room SQLite に保持します。 */
  private rescheduleCustomRoomIndexOperation(
    operation: ScheduledOperationRow,
  ): void {
    const dueAt = Math.max(
      Date.now() + CUSTOM_ROOM_INDEX_RETRY_DELAY_MS,
      operation.dueAt + CUSTOM_ROOM_INDEX_RETRY_DELAY_MS,
    );

    this.ctx.storage.sql.exec(
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

  /** Room SQLite の正本から、公開可能な一覧レコードだけを組み立てます。 */
  private createCustomRoomIndexRecord(
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
    const counts = this.readParticipantCounts();
    const maxSpectators = room.maxSpectators ?? 0;

    return {
      roomId: room.roomId,
      name: readIndexString(metadata["name"]) ?? "ルーム",
      mode: readIndexString(settings["mode"]),
      region: readIndexString(settings["region"]),
      state: room.state,
      joinMethod: room.joinMethod,
      maxPlayers: room.maxPlayers,
      playerCount: counts.playerCount,
      availableSlots: Math.max(0, room.maxPlayers - counts.playerCount),
      maxSpectators,
      spectatorCount: counts.spectatorCount,
      availableSpectatorSlots: Math.max(
        0,
        maxSpectators - counts.spectatorCount,
      ),
      revision: room.revision,
      createdAt: room.createdAt,
      updatedAt: Date.now(),
    };
  }

  private readParticipantCounts(): {
    readonly playerCount: number;
    readonly spectatorCount: number;
  } {
    const rows = this.ctx.storage.sql
      .exec<{ kind: RoomParticipantRole; count: number }>(
        `SELECT kind, COUNT(*) AS count
         FROM flarelobby_room_participants
         GROUP BY kind`,
      )
      .toArray();

    return {
      playerCount: rows.find((row) => row.kind === "player")?.count ?? 0,
      spectatorCount: rows.find((row) => row.kind === "spectator")?.count ?? 0,
    };
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
        now,
      )
      .toArray();

    let roomDeleted = false;

    for (const operation of dueOperations) {
      if (
        operation.kind === ROOM_INDEX_UPSERT_OPERATION_KIND ||
        operation.kind === ROOM_INDEX_DELETE_OPERATION_KIND
      ) {
        await this.processCustomRoomIndexOperation(operation);
        continue;
      }

      if (operation.kind === "room_retention") {
        const room = this.readRoomRow();
        if (room?.state === "finished") {
          try {
            if (room.kind === "custom" && room.visibility === "public") {
              await deleteCustomRoomIndex(this.env.FLARE_LOBBY_DB, room.roomId);
            }
            deleteRoomState(this.ctx.storage.sql);
            roomDeleted = true;
            break;
          } catch {
            this.rescheduleCustomRoomIndexOperation(operation);
            continue;
          }
        }

        // 状態が戻ることは通常ありませんが、古い予約が残っていても
        // アクティブな Room を削除しないように期限だけを破棄します。
        this.ctx.storage.sql.exec(
          "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
          operation.operationId,
        );
        continue;
      }

      const payload = parseJsonValue(operation.payloadJson);

      if (
        isJsonObject(payload) &&
        payload["type"] === ROOM_DISCONNECT_OPERATION_TYPE
      ) {
        const participantId = payload["participantId"];
        const disconnectedAt = payload["disconnectedAt"];

        if (
          isNonEmptyString(participantId) &&
          isValidTimestamp(disconnectedAt)
        ) {
          const result = this.expireDisconnectedParticipant(
            this.readRoomRow(),
            participantId,
            disconnectedAt,
          );

          if (result === "deferred") {
            continue;
          }
        }

        this.ctx.storage.sql.exec(
          "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
          operation.operationId,
        );
        continue;
      }

      if (
        isJsonObject(payload) &&
        payload["type"] === ROOM_PROCESSED_COMMAND_CLEANUP_OPERATION_TYPE
      ) {
        this.purgeExpiredProcessedCommands(now);
        const nextExpiry = this.ctx.storage.sql
          .exec<{ nextExpiresAt: number | null }>(
            "SELECT MIN(expires_at) AS nextExpiresAt FROM flarelobby_processed_commands",
          )
          .one().nextExpiresAt;

        if (nextExpiry === null) {
          this.ctx.storage.sql.exec(
            "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
            operation.operationId,
          );
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE flarelobby_room_scheduled_operations
             SET due_at = ?, payload_json = ?
             WHERE operation_id = ?`,
            nextExpiry,
            JSON.stringify({
              type: ROOM_PROCESSED_COMMAND_CLEANUP_OPERATION_TYPE,
            }),
            operation.operationId,
          );
        }
        continue;
      }

      // marker/noop は実行済みとして削除します。削除を状態変更と同じ
      // ストレージゲート内で行うため、Alarm の再試行でも二重処理になりません。
      this.ctx.storage.sql.exec(
        "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
        operation.operationId,
      );
    }

    if (roomDeleted) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.synchronizeAlarm();
  }

  private expireDisconnectedParticipant(
    room: RoomRow | undefined,
    participantId: string,
    disconnectedAt: Timestamp,
  ): "removed" | "deferred" | "noop" {
    if (room === undefined || room.state === "finished") {
      return "noop";
    }

    const participant = this.readParticipantById(participantId);

    if (participant === undefined) {
      return "noop";
    }

    const activeConnections = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM flarelobby_room_connections
         WHERE room_id = ?
           AND participant_id = ?
           AND disconnected_at IS NULL
           AND invalidated_at IS NULL`,
        room.roomId,
        participantId,
      )
      .one().count;

    if (activeConnections > 0) {
      return "noop";
    }

    const latestDisconnectedAt = this.ctx.storage.sql
      .exec<{ disconnectedAt: string | null }>(
        `SELECT MAX(disconnected_at) AS disconnectedAt
         FROM flarelobby_room_connections
         WHERE room_id = ?
           AND participant_id = ?
           AND disconnected_at IS NOT NULL
           AND invalidated_at IS NULL`,
        room.roomId,
        participantId,
      )
      .one().disconnectedAt;
    const effectiveDisconnectedAt = latestDisconnectedAt ?? disconnectedAt;
    const effectiveDisconnectedAtMs = Date.parse(effectiveDisconnectedAt);
    const dueAt = effectiveDisconnectedAtMs + room.disconnectGracePeriodMs;

    if (
      !Number.isFinite(effectiveDisconnectedAtMs) ||
      !Number.isSafeInteger(dueAt)
    ) {
      return "noop";
    }

    if (dueAt > Date.now()) {
      this.writeParticipantDisconnectOperation(
        participantId,
        effectiveDisconnectedAt,
        dueAt,
      );
      return "deferred";
    }

    const successor =
      room.hostParticipantId === participant.participantId
        ? this.readOldestPlayerParticipant(participant.participantId)
        : undefined;
    const hostIsLeaving = room.hostParticipantId === participant.participantId;
    const finishedAt = new Date().toISOString();
    const retentionDueAt =
      hostIsLeaving && successor === undefined
        ? Date.parse(finishedAt) + room.finishedRoomRetentionMs
        : undefined;

    if (retentionDueAt !== undefined && !Number.isSafeInteger(retentionDueAt)) {
      return "noop";
    }

    this.invalidateResumeSessions(participant.participantId);
    this.cancelDisconnectOperation(participant.participantId);
    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_participants WHERE participant_id = ?",
      participant.participantId,
    );

    if (successor !== undefined) {
      this.setHost(successor);
    } else if (hostIsLeaving) {
      this.ctx.storage.sql.exec(
        `UPDATE flarelobby_rooms
         SET state = 'finished', state_started_at = ?, revision = ?
         WHERE singleton_id = 1`,
        finishedAt,
        room.revision + 1,
      );
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
        retentionDueAt,
      );
    } else {
      this.incrementRevision(room.revision);
    }

    if (successor !== undefined) {
      this.incrementRevision(room.revision);
    }

    const snapshot = this.readSnapshot();

    if (snapshot !== null) {
      this.broadcastRoomSnapshot(snapshot);
    }

    return "removed";
  }

  private async handleWebSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = readWebSocketAttachment(webSocket);

    if (attachment === null) {
      closeWebSocketSafely(webSocket, 1008, "接続情報が無効です。");
      return;
    }

    const command = validateWebSocketCommand(
      message,
      attachment.maxWebSocketMessageBytes,
    );

    if (!command.ok) {
      this.sendWebSocketFailure(webSocket, command.error);

      if (command.error.requestId === undefined) {
        closeWebSocketSafely(webSocket, 1002, "メッセージを解釈できません。");
      }

      return;
    }

    const gatewayPrincipal = await createGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      attachment.principal,
    );

    if (!gatewayPrincipal.ok) {
      this.sendWebSocketFailure(
        webSocket,
        new FlareLobbyError("UNAUTHENTICATED", {
          requestId: command.value.requestId,
        }),
      );
      return;
    }

    const rateLimit = await this.consumeWebSocketMessageRateLimit(
      attachment.principal.id,
      gatewayPrincipal.value,
      attachment.maxMessagesPerMinute,
    );

    if (!rateLimit.ok) {
      this.sendWebSocketFailure(
        webSocket,
        new FlareLobbyError(rateLimit.error.code, {
          message: rateLimit.error.message,
          requestId: command.value.requestId,
        }),
      );
      return;
    }

    try {
      const payload = await this.dispatchWebSocketCommand(
        attachment,
        gatewayPrincipal.value,
        command.value,
      );
      const response: ServerSuccessEnvelope = {
        protocolVersion: PROTOCOL_VERSION,
        kind: "success",
        requestId: command.value.requestId,
        payload,
      };

      if (!this.sendProtocolMessage(webSocket, response)) {
        closeWebSocketSafely(webSocket, 1011, "応答を送信できません。");
      }
    } catch (error) {
      this.sendWebSocketFailure(
        webSocket,
        normalizeWebSocketError(error, command.value.requestId),
      );
    }
  }

  private async dispatchWebSocketCommand(
    attachment: RoomWebSocketAttachment,
    gatewayPrincipal: GatewayPrincipalEnvelope,
    command: ClientCommandEnvelope,
  ): Promise<JsonValue> {
    const requestId = scopeWebSocketRequestId(
      attachment.principal.id,
      command.requestId,
    );
    const common = {
      gatewayPrincipal,
      participantId: attachment.participantId,
      requestId,
      requestPayload: command.payload,
    } as const;

    switch (command.command) {
      case ROOM_SET_READY_COMMAND: {
        const payload = requireJsonObject(command.payload);

        if (typeof payload["ready"] !== "boolean") {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.setReady({
          ...common,
          ready: payload["ready"],
        })) as unknown as JsonValue;
      }
      case ROOM_SELECT_TEAM_COMMAND: {
        const payload = requireJsonObject(command.payload);
        const teamId = payload["teamId"];

        if (teamId !== null && !isNonEmptyString(teamId)) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.selectTeam({
          ...common,
          teamId: teamId === null ? null : teamId,
        })) as unknown as JsonValue;
      }
      case ROOM_UPDATE_SETTINGS_COMMAND: {
        const payload = requireJsonObject(command.payload);

        return (await this.updateSettings({
          ...common,
          settings: requireJsonObject(payload["settings"]),
        })) as unknown as JsonValue;
      }
      case ROOM_TRANSFER_HOST_COMMAND: {
        const payload = requireJsonObject(command.payload);

        if (!isNonEmptyString(payload["targetParticipantId"])) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.transferHost({
          ...common,
          targetParticipantId: payload["targetParticipantId"],
        })) as unknown as JsonValue;
      }
      case ROOM_KICK_COMMAND: {
        const payload = requireJsonObject(command.payload);
        const targetParticipantId = optionalString(
          payload["targetParticipantId"],
        );
        const targetPlayerId = optionalString(payload["targetPlayerId"]);
        const reason = optionalString(payload["reason"]);

        return (await this.kick({
          ...common,
          ...(targetParticipantId === undefined ? {} : { targetParticipantId }),
          ...(targetPlayerId === undefined ? {} : { targetPlayerId }),
          ...(reason === undefined ? {} : { reason }),
        })) as unknown as JsonValue;
      }
      case ROOM_START_MATCH_COMMAND: {
        const payload = requireJsonObject(command.payload);
        const at = payload["at"];

        if (at !== undefined && !isNonEmptyString(at)) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.startMatch({
          ...common,
          ...(at === undefined ? {} : { at }),
        })) as unknown as JsonValue;
      }
      case ROOM_CLOSE_COMMAND: {
        const payload = requireJsonObject(command.payload);
        const at = payload["at"];

        if (at !== undefined && !isNonEmptyString(at)) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.close({
          ...common,
          ...(at === undefined ? {} : { at }),
        })) as unknown as JsonValue;
      }
      default:
        return this.dispatchGameMessage(
          attachment,
          gatewayPrincipal,
          command,
          requestId,
        );
    }
  }

  private async dispatchGameMessage(
    attachment: RoomWebSocketAttachment,
    gatewayPrincipal: GatewayPrincipalEnvelope,
    command: ClientCommandEnvelope,
    requestId: string,
  ): Promise<JsonValue> {
    const actor = await this.authenticateParticipant({
      gatewayPrincipal,
      participantId: attachment.participantId,
    });

    if (actor.participant.kind !== attachment.role) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    assertActiveRoom(actor.room);

    if (command.command.startsWith("room.")) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "未知の Room コマンドです。",
      });
    }

    if (actor.participant.kind !== "player") {
      throw new FlareLobbyError("FORBIDDEN");
    }

    if (command.command.length > MAX_GAME_MESSAGE_NAME_LENGTH) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const existing = this.readProcessedCommand(requestId);

    if (existing !== null) {
      if (
        existing.value.command !== command.command ||
        JSON.stringify(existing.value.payload) !==
          JSON.stringify(command.payload)
      ) {
        throw new FlareLobbyError("CONFLICT", {
          message: "同じ requestId に異なるゲームメッセージを指定できません。",
        });
      }

      return existing.value.result;
    }

    await this.recordProcessedCommand({
      requestId,
      command: command.command,
      payload: command.payload,
      result: null,
    });
    this.broadcastGameMessage(attachment, command);
    return null;
  }

  private async consumeWebSocketMessageRateLimit(
    principalId: string,
    gatewayPrincipal: GatewayPrincipalEnvelope,
    limit: number,
  ): Promise<ProtocolResult<void>> {
    try {
      const decision = await this.env.FLARE_LOBBY_RATE_LIMITS.getByName(
        principalId,
      ).consume(gatewayPrincipal, "websocket_message", limit);

      return decision.allowed
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: new FlareLobbyError("CONFLICT", {
              message: "要求が許可された頻度を超えています。",
            }),
          };
    } catch {
      return {
        ok: false,
        error: new FlareLobbyError("CONNECTION_FAILED"),
      };
    }
  }

  private sendWebSocketFailure(
    webSocket: WebSocket,
    error: FlareLobbyError,
  ): void {
    const failure: ServerFailureEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      kind: "failure",
      requestId: error.requestId ?? null,
      error: error.toJSON(),
    };

    if (!this.sendProtocolMessage(webSocket, failure)) {
      closeWebSocketSafely(webSocket, 1011, "失敗応答を送信できません。");
    }
  }

  private sendProtocolMessage(
    webSocket: WebSocket,
    message: ProtocolMessage,
  ): boolean {
    const encoded = encodeProtocolMessage(message);

    if (!encoded.ok) {
      return false;
    }

    try {
      webSocket.send(encoded.value);
      return true;
    } catch {
      return false;
    }
  }

  private broadcastRoomSnapshot(snapshot: RoomSnapshot): void {
    const event = createRoomSnapshotEvent(snapshot);
    this.recordRoomEvent(event);
    this.broadcastProtocolMessage(event);
  }

  private recordRoomEvent(event: ServerEventEnvelope): void {
    const room = this.readRoomRow();

    if (room === undefined) {
      return;
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_room_events (
        revision,
        event_json,
        created_at
      ) VALUES (?, ?, ?)`,
      event.revision,
      JSON.stringify(event),
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM flarelobby_room_events
       WHERE event_id NOT IN (
         SELECT event_id
         FROM flarelobby_room_events
         ORDER BY event_id DESC
         LIMIT ?
       )`,
      room.eventHistoryLimit,
    );
  }

  private readResumeEvents(
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

    const rows = this.ctx.storage.sql
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
    const revisions = new Set(rows.map((row) => row.revision));

    for (
      let revision = lastRevision + 1;
      revision <= currentRevision;
      revision += 1
    ) {
      if (!revisions.has(revision)) {
        return { useSnapshot: true, events: [] };
      }
    }

    try {
      return {
        useSnapshot: false,
        events: rows.map((row) => {
          const event = parseJsonValue(row.eventJson);

          if (!isJsonObject(event) || event["kind"] !== "event") {
            throw new Error("invalid-room-event");
          }

          return event as unknown as ProtocolMessage;
        }),
      };
    } catch {
      return { useSnapshot: true, events: [] };
    }
  }

  private broadcastGameMessage(
    attachment: RoomWebSocketAttachment,
    command: ClientCommandEnvelope,
  ): void {
    const room = this.readRoomRow();

    if (room === undefined) {
      return;
    }

    const message: ServerEventEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      event: GAME_MESSAGE_EVENT,
      revision: room.revision,
      payload: {
        name: command.command,
        payload: command.payload,
        sender: {
          participantId: attachment.participantId,
          role: attachment.role,
        },
      },
    };

    this.broadcastProtocolMessage(message);
  }

  private broadcastProtocolMessage(message: ProtocolMessage): void {
    const encoded = encodeProtocolMessage(message);

    if (!encoded.ok) {
      return;
    }

    const roomId = getRoomWebSocketTag(this.readRoomRow()?.roomId ?? "");

    for (const webSocket of this.ctx.getWebSockets(roomId)) {
      try {
        webSocket.send(encoded.value);
      } catch {
        closeWebSocketSafely(webSocket, 1011, "イベントを送信できません。");
      }
    }
  }

  private storeWebSocketConnection(
    attachment: RoomWebSocketAttachment,
    resumeTokenExpiresAt: number,
    isResume: boolean,
  ): void {
    this.ctx.storage.sql.exec(
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

  private async markWebSocketDisconnected(
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
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_room_connections
       SET disconnected_at = ?
       WHERE resume_id = ?
         AND connection_generation = ?
         AND disconnected_at IS NULL`,
      disconnectedAt,
      attachment.resumeId,
      attachment.connectionGeneration,
    );

    await this.scheduleParticipantDisconnect(
      attachment.participantId,
      disconnectedAt,
    );
  }

  private readRoomConnection(resumeId: string): RoomConnectionRow | undefined {
    return this.ctx.storage.sql
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

  private invalidateResumeSessions(participantId: string): void {
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_room_connections
       SET invalidated_at = COALESCE(invalidated_at, ?),
           disconnected_at = COALESCE(disconnected_at, ?)
       WHERE participant_id = ?`,
      now,
      now,
      participantId,
    );
  }

  private async scheduleParticipantDisconnect(
    participantId: string,
    disconnectedAt: Timestamp,
  ): Promise<void> {
    const room = this.readRoomRow();

    if (room === undefined) {
      return;
    }

    const disconnectedAtMs = Date.parse(disconnectedAt);
    const dueAt = disconnectedAtMs + room.disconnectGracePeriodMs;

    if (!Number.isSafeInteger(dueAt)) {
      return;
    }

    this.writeParticipantDisconnectOperation(
      participantId,
      disconnectedAt,
      dueAt,
    );
    await this.synchronizeAlarm();
  }

  private writeParticipantDisconnectOperation(
    participantId: string,
    disconnectedAt: Timestamp,
    dueAt: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_room_scheduled_operations (
        operation_id,
        due_at,
        kind,
        payload_json
      ) VALUES (?, ?, 'noop', ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        due_at = excluded.due_at,
        kind = excluded.kind,
        payload_json = excluded.payload_json`,
      getDisconnectOperationId(participantId),
      dueAt,
      JSON.stringify({
        type: ROOM_DISCONNECT_OPERATION_TYPE,
        participantId,
        disconnectedAt,
      }),
    );
  }

  private cancelDisconnectOperation(participantId: string): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_room_scheduled_operations WHERE operation_id = ?",
      getDisconnectOperationId(participantId),
    );
  }

  private scheduleProcessedCommandCleanup(expiresAt: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_room_scheduled_operations (
        operation_id,
        due_at,
        kind,
        payload_json
      ) VALUES (?, ?, 'noop', ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        due_at = MIN(due_at, excluded.due_at),
        kind = excluded.kind,
        payload_json = excluded.payload_json`,
      ROOM_PROCESSED_COMMAND_CLEANUP_OPERATION_ID,
      expiresAt,
      JSON.stringify({
        type: ROOM_PROCESSED_COMMAND_CLEANUP_OPERATION_TYPE,
      }),
    );
  }

  private purgeExpiredProcessedCommands(now: number): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM flarelobby_processed_commands WHERE expires_at <= ?",
      now,
    );
  }

  private async authenticateParticipant(
    options: RoomParticipantOperationOptions,
  ): Promise<AuthenticatedRoomActor> {
    const principal = await this.resolveGatewayPrincipal(
      options.gatewayPrincipal,
    );

    if (principal === null) {
      throw new FlareLobbyError("UNAUTHENTICATED");
    }

    const room = this.readRoomRow();

    if (room === undefined) {
      throw new FlareLobbyError("CONFLICT", {
        message: "初期化されていない Room は操作できません。",
      });
    }

    const participant = this.readParticipantById(options.participantId);

    if (
      participant === undefined ||
      participant.playerId !== principal.playerId
    ) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    return { principal, room, participant };
  }

  private async authenticateHost(
    options: RoomHostOperationOptions,
  ): Promise<AuthenticatedRoomActor> {
    const actor = await this.authenticateParticipant(options);

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

  private readRequiredSnapshot(): RoomSnapshot {
    const snapshot = this.readSnapshot();

    if (snapshot === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return snapshot;
  }

  private restoreOperationResult(
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

    return parseRoomSnapshotResult(existing.value.result);
  }

  private async storeOperationResult(
    request: NormalizedOperationRequest,
    command: string,
    snapshot: RoomSnapshot,
  ): Promise<RoomSnapshot> {
    if (request.requestId !== null) {
      const stored = await this.recordProcessedCommand({
        requestId: request.requestId,
        command,
        payload: request.payload,
        result: snapshot as unknown as JsonValue,
      });

      return parseRoomSnapshotResult(stored.result);
    }

    return snapshot;
  }

  private teamExists(teamId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_room_teams WHERE team_id = ?",
          teamId,
        )
        .one().count > 0
    );
  }

  private readPlayerCounts(): {
    readonly total: number;
    readonly ready: number;
  } {
    const row = this.ctx.storage.sql
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

  private setHost(participant: ParticipantRow): void {
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET host_participant_id = ?, host_player_id = ?
       WHERE singleton_id = 1`,
      participant.participantId,
      participant.playerId,
    );
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

  private readParticipantById(
    participantId: string,
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
        participantId,
      )
      .toArray()[0];
  }

  private readParticipantByPlayerId(
    playerId: string,
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
        playerId,
      )
      .toArray()[0];
  }

  private readOldestPlayerParticipant(
    excludedParticipantId: string,
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
         WHERE kind = 'player' AND participant_id <> ?
         ORDER BY joined_at ASC, participant_id ASC
         LIMIT 1`,
        excludedParticipantId,
      )
      .toArray()[0];
  }

  private incrementRevision(currentRevision: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE flarelobby_rooms
       SET revision = ?
       WHERE singleton_id = 1`,
      currentRevision + 1,
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

    const teams = this.ctx.storage.sql
      .exec<TeamRow>(
        "SELECT team_id AS teamId FROM flarelobby_room_teams ORDER BY team_id ASC",
      )
      .toArray()
      .map((team) => Object.freeze({ id: team.teamId }));

    const state = createRoomState(room.state, room.stateStartedAt);
    const settings = deepFreeze(parseJsonObject(room.settingsJson));
    const metadata = deepFreeze(parseJsonObject(room.metadataJson));

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

      const customRoom: CustomRoom = deepFreeze({
        ...baseRoom,
        kind: "custom" as const,
        invitationCode: room.invitationCode,
        visibility: room.visibility,
      });

      return deepFreeze({
        ...snapshotBase,
        room: customRoom,
        host: deepFreeze({
          participantId: room.hostParticipantId,
          playerId: room.hostPlayerId,
        }),
      }) as RoomSnapshot;
    }

    if (room.matchId === null || room.poolJson === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const matchRoom: MatchRoom = deepFreeze({
      ...baseRoom,
      kind: "match" as const,
      matchId: room.matchId,
      pool: deepFreeze(parseMatchmakingPool(parseJsonObject(room.poolJson))),
    });

    return deepFreeze({
      ...snapshotBase,
      room: matchRoom,
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

  private readProcessedCommand(
    requestId: string,
  ): { value: RoomProcessedCommand; payloadJson: string } | null {
    const row = this.ctx.storage.sql
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

    if (row.expiresAt <= Date.now()) {
      this.ctx.storage.sql.exec(
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

  private async synchronizeAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<NextAlarmRow>(
        `SELECT MIN(due_at) AS nextDueAt
         FROM flarelobby_room_scheduled_operations`,
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
       FROM flarelobby_room_schema_migrations`,
    )
    .one().version;

  if (currentVersion < 1) {
    sql.exec(
      `
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
    `,
      Date.now(),
    );
  }

  if (currentVersion < 2) {
    sql.exec(
      `
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
        kind TEXT NOT NULL CHECK (kind IN (
          'noop',
          'room_retention',
          'custom_room_index_upsert',
          'custom_room_index_delete'
        )),
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flarelobby_room_scheduled_operations_due_at
        ON flarelobby_room_scheduled_operations (due_at, operation_id);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (2, ?)
    `,
      Date.now(),
    );
  }

  if (currentVersion < 3) {
    sql.exec(
      `
      ALTER TABLE flarelobby_rooms
        ADD COLUMN max_spectators INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN join_method TEXT NOT NULL DEFAULT 'public';

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (3, ?)
    `,
      Date.now(),
    );
  }

  if (currentVersion < 4) {
    sql.exec(
      `
      ALTER TABLE flarelobby_rooms
        ADD COLUMN join_password_salt TEXT;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN join_password_hash TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_flarelobby_room_participants_player_id
        ON flarelobby_room_participants (player_id);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (4, ?)
    `,
      Date.now(),
    );
  }

  if (currentVersion < 5) {
    sql.exec(
      `
      ALTER TABLE flarelobby_rooms
        ADD COLUMN minimum_players INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN require_all_players_ready INTEGER NOT NULL DEFAULT 1;
      UPDATE flarelobby_rooms
         SET minimum_players = COALESCE(max_players, 1);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (5, ?)
    `,
      Date.now(),
    );
  }

  if (currentVersion < 6) {
    sql.exec(
      `
      CREATE TABLE IF NOT EXISTS flarelobby_room_connections (
        resume_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('player', 'spectator')),
        connected_at TEXT NOT NULL,
        disconnected_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_flarelobby_room_connections_room
        ON flarelobby_room_connections (room_id, disconnected_at);
      CREATE INDEX IF NOT EXISTS idx_flarelobby_room_connections_participant
        ON flarelobby_room_connections (participant_id, disconnected_at);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (6, ?)
    `,
      Date.now(),
    );
  }

  if (currentVersion < 7) {
    sql.exec(
      `
      ALTER TABLE flarelobby_rooms
        ADD COLUMN resume_token_ttl_ms INTEGER NOT NULL DEFAULT 1800000;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN disconnect_grace_period_ms INTEGER NOT NULL DEFAULT 30000;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN event_history_limit INTEGER NOT NULL DEFAULT 128;
      ALTER TABLE flarelobby_rooms
        ADD COLUMN processed_command_retention_ms INTEGER NOT NULL DEFAULT 600000;

      ALTER TABLE flarelobby_processed_commands
        ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE flarelobby_room_connections
        ADD COLUMN connection_generation TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE flarelobby_room_connections
        ADD COLUMN resume_token_expires_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE flarelobby_room_connections
        ADD COLUMN invalidated_at TEXT;

      CREATE TABLE IF NOT EXISTS flarelobby_room_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flarelobby_room_events_revision
        ON flarelobby_room_events (revision, event_id);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (7, ?)
    `,
      Date.now(),
    );
  }

  if (currentVersion < 8) {
    sql.exec(
      `
      ALTER TABLE flarelobby_room_scheduled_operations
        RENAME TO flarelobby_room_scheduled_operations_legacy;

      CREATE TABLE flarelobby_room_scheduled_operations (
        operation_id TEXT PRIMARY KEY,
        due_at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'noop',
          'room_retention',
          'custom_room_index_upsert',
          'custom_room_index_delete'
        )),
        payload_json TEXT NOT NULL
      );

      INSERT INTO flarelobby_room_scheduled_operations
        (operation_id, due_at, kind, payload_json)
      SELECT operation_id, due_at, kind, payload_json
      FROM flarelobby_room_scheduled_operations_legacy;

      DROP TABLE flarelobby_room_scheduled_operations_legacy;

      CREATE INDEX IF NOT EXISTS idx_flarelobby_room_scheduled_operations_due_at
        ON flarelobby_room_scheduled_operations (due_at, operation_id);

      INSERT INTO flarelobby_room_schema_migrations (version, applied_at)
      VALUES (8, ?)
    `,
      Date.now(),
    );
  }
}

function deleteRoomState(sql: SqlStorage): void {
  sql.exec(`
    DELETE FROM flarelobby_room_scheduled_operations;
    DELETE FROM flarelobby_processed_commands;
    DELETE FROM flarelobby_room_connections;
    DELETE FROM flarelobby_room_events;
    DELETE FROM flarelobby_room_participants;
    DELETE FROM flarelobby_room_teams;
    DELETE FROM flarelobby_rooms
     WHERE singleton_id = 1
  `);
}

function getWebSocketRoomId(request: Request): string | null {
  const match = /^\/v1\/custom-rooms\/([^/]+)\/ws$/u.exec(
    new URL(request.url).pathname,
  );

  if (match?.[1] === undefined) {
    return null;
  }

  try {
    const roomId = decodeURIComponent(match[1]);
    return isNonEmptyString(roomId) ? roomId : null;
  } catch {
    return null;
  }
}

function hasWebSocketProtocol(request: Request): boolean {
  return (
    request.headers
      .get("Sec-WebSocket-Protocol")
      ?.split(",")
      .some((protocol) => protocol.trim() === FLARE_LOBBY_WEBSOCKET_PROTOCOL) ??
    false
  );
}

function readPositiveHeader(value: string | null, fallback: number): number {
  if (value === null || !/^\d+$/u.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createWebSocketTags(attachment: RoomWebSocketAttachment): string[] {
  return [
    getRoomWebSocketTag(attachment.roomId),
    getParticipantWebSocketTag(attachment.participantId),
    getPrincipalWebSocketTag(attachment.principal.id),
    getRoleWebSocketTag(attachment.role),
    getResumeWebSocketTag(attachment.resumeId),
  ];
}

function readWebSocketAttachment(
  webSocket: WebSocket,
): RoomWebSocketAttachment | null {
  let value: unknown;

  try {
    value = webSocket.deserializeAttachment();
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    value["version"] !== ROOM_WEBSOCKET_ATTACHMENT_VERSION
  ) {
    return null;
  }

  const principal = value["principal"];
  const roomId = value["roomId"];
  const participantId = value["participantId"];
  const role = value["role"];
  const connectedAt = value["connectedAt"];
  const resumeId = value["resumeId"];
  const connectionGeneration = value["connectionGeneration"];
  const maxWebSocketMessageBytes = value["maxWebSocketMessageBytes"];
  const maxMessagesPerMinute = value["maxMessagesPerMinute"];

  if (
    !isRecord(principal) ||
    !isNonEmptyString(principal["id"]) ||
    !isNonEmptyString(principal["playerId"]) ||
    !isNonEmptyString(roomId) ||
    !isNonEmptyString(participantId) ||
    !isRoomParticipantRole(role) ||
    !isValidTimestamp(connectedAt) ||
    !isNonEmptyString(resumeId) ||
    !isNonEmptyString(connectionGeneration) ||
    !isPositiveSafeInteger(maxWebSocketMessageBytes) ||
    !isPositiveSafeInteger(maxMessagesPerMinute)
  ) {
    return null;
  }

  return Object.freeze({
    version: ROOM_WEBSOCKET_ATTACHMENT_VERSION,
    roomId,
    principal: Object.freeze({
      id: principal["id"],
      playerId: principal["playerId"],
    }),
    participantId,
    role,
    connectedAt,
    resumeId,
    connectionGeneration,
    maxWebSocketMessageBytes,
    maxMessagesPerMinute,
  });
}

function createRoomSnapshotEvent(
  snapshot: RoomSnapshot,
  resume?: RoomResumeHandshake,
): ServerEventEnvelope {
  const payload =
    resume === undefined
      ? snapshot
      : {
          ...snapshot,
          resumeToken: resume.resumeToken,
          resumeTokenExpiresAt: resume.resumeTokenExpiresAt,
          resume,
        };

  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    event: ROOM_SNAPSHOT_EVENT,
    revision: snapshot.revision,
    payload: payload as unknown as JsonValue,
  };
}

function readLastRevision(request: Request): ProtocolResult<number | null> {
  const url = new URL(request.url);
  const queryValue =
    url.searchParams.get("lastRevision") ?? url.searchParams.get("revision");
  const headerValue = request.headers.get("x-flarelobby-last-revision");

  if (
    queryValue !== null &&
    headerValue !== null &&
    queryValue !== headerValue
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("INVALID_PAYLOAD"),
    };
  }

  const value = queryValue ?? headerValue;

  if (value === null) {
    return { ok: true, value: null };
  }

  if (!/^\d+$/u.test(value)) {
    return {
      ok: false,
      error: new FlareLobbyError("INVALID_PAYLOAD"),
    };
  }

  const revision = Number(value);

  if (!Number.isSafeInteger(revision) || revision < 0) {
    return {
      ok: false,
      error: new FlareLobbyError("INVALID_PAYLOAD"),
    };
  }

  return { ok: true, value: revision };
}

function scopeWebSocketRequestId(
  principalId: string,
  requestId: string,
): string {
  return normalizeRequestIdentifier(`websocket:${principalId}:${requestId}`);
}

function requireJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isNonEmptyString(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value;
}

function closeWebSocketSafely(
  webSocket: WebSocket,
  code: number,
  reason: string,
): void {
  try {
    if (webSocket.readyState !== 3) {
      webSocket.close(code, reason);
    }
  } catch {
    // すでに閉じた WebSocket の例外は公開しません。
  }
}

function normalizeWebSocketError(
  error: unknown,
  requestId?: string,
): FlareLobbyError {
  if (error instanceof FlareLobbyError) {
    return error.requestId === undefined && requestId !== undefined
      ? new FlareLobbyError(error.code, {
          message: error.message,
          requestId,
        })
      : error;
  }

  return new FlareLobbyError(
    "CONNECTION_FAILED",
    requestId === undefined ? {} : { requestId },
  );
}

async function normalizeInitialization(
  options: RoomInitializationOptions,
): Promise<NormalizedInitialization> {
  if (!isRecord(options) || !isRecord(options.room)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const room = options.room;

  if (!isNonEmptyString(room.id)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "Room の id は空でない文字列で指定してください。",
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
    "maxPlayers",
  );
  const maxSpectators =
    options.maxSpectators === undefined
      ? 0
      : normalizeNonNegativeInteger(options.maxSpectators, "maxSpectators");
  const startConditions = normalizeStartConditions(options, maxPlayers);
  const finishedRoomRetentionMs =
    options.finishedRoomRetentionMs === undefined
      ? DEFAULT_FINISHED_ROOM_RETENTION_MS
      : normalizeNonNegativeInteger(
          options.finishedRoomRetentionMs,
          "finishedRoomRetentionMs",
        );
  const resumeTokenTtlMs =
    options.resumeTokenTtlMs === undefined
      ? DEFAULT_RESUME_TOKEN_TTL_MS
      : normalizePositiveInteger(options.resumeTokenTtlMs, "resumeTokenTtlMs");
  const disconnectGracePeriodMs =
    options.disconnectGracePeriodMs === undefined
      ? DEFAULT_DISCONNECT_GRACE_PERIOD_MS
      : normalizeNonNegativeInteger(
          options.disconnectGracePeriodMs,
          "disconnectGracePeriodMs",
        );
  const eventHistoryLimit =
    options.eventHistoryLimit === undefined
      ? DEFAULT_EVENT_HISTORY_LIMIT
      : normalizePositiveInteger(
          options.eventHistoryLimit,
          "eventHistoryLimit",
        );
  const processedCommandRetentionMs =
    options.processedCommandRetentionMs === undefined
      ? DEFAULT_PROCESSED_COMMAND_RETENTION_MS
      : normalizePositiveInteger(
          options.processedCommandRetentionMs,
          "processedCommandRetentionMs",
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
        message: "カスタムルームには招待コード、可視性、ホストが必要です。",
      });
    }

    const joinMethod = options.joinMethod ?? "public";

    if (
      (joinMethod === "password" && password === null) ||
      (joinMethod !== "password" && password !== null)
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "パスワード方式ではパスワードが必要です。",
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
      minimumPlayers: startConditions.minimumPlayers,
      requireAllPlayersReady: startConditions.requireAllPlayersReady,
      joinMethod,
      joinPasswordSalt: passwordRecord?.salt ?? null,
      joinPasswordHash: passwordRecord?.hash ?? null,
      finishedRoomRetentionMs,
      resumeTokenTtlMs,
      disconnectGracePeriodMs,
      eventHistoryLimit,
      processedCommandRetentionMs,
      participants,
      teams,
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
    // SQLite の Room スキーマでは観戦者上限を必須値として保持するため、
    // 対戦 Room は観戦不可を 0 として保存します。
    maxSpectators: 0,
    minimumPlayers: startConditions.minimumPlayers,
    requireAllPlayersReady: startConditions.requireAllPlayersReady,
    // Match Room は `join()` の対象外ですが、SQLite の互換スキーマでは
    // join_method が必須のため、未使用の既定値を保存します。
    joinMethod: "public",
    joinPasswordSalt: null,
    joinPasswordHash: null,
    finishedRoomRetentionMs,
    resumeTokenTtlMs,
    disconnectGracePeriodMs,
    eventHistoryLimit,
    processedCommandRetentionMs,
    participants,
    teams,
  };
}

function normalizeStartConditions(
  options: RoomInitializationOptions,
  maxPlayers: number | null,
): {
  readonly minimumPlayers: number;
  readonly requireAllPlayersReady: boolean;
} {
  const nested = options.startConditions;

  if (nested !== undefined && !isRecord(nested)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const minimumPlayers = normalizePositiveInteger(
    options.minimumPlayers ?? nested?.minimumPlayers ?? maxPlayers ?? 1,
    "minimumPlayers",
  );
  const requireAllPlayersReady =
    options.requireAllPlayersReady ?? nested?.requireAllPlayersReady ?? true;

  if (typeof requireAllPlayersReady !== "boolean") {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  if (maxPlayers !== null && minimumPlayers > maxPlayers) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "minimumPlayers は maxPlayers 以下で指定してください。",
    });
  }

  return { minimumPlayers, requireAllPlayersReady };
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
  readonly at: Timestamp;
}

interface NormalizedOperationRequest {
  readonly requestId: string | null;
  readonly payload: JsonObject;
  readonly payloadJson: string;
}

interface NormalizedKickOptions extends Omit<
  RoomKickOptions,
  "targetParticipantId" | "targetPlayerId" | "reason"
> {
  readonly targetParticipantId: string | null;
  readonly targetPlayerId: string | null;
  readonly reason: string | null;
}

function normalizeParticipantJoinOptions(
  options: RoomParticipantJoinOptions,
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
  options: RoomParticipantLeaveOptions,
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
          ...(role === null ? {} : { role }),
        }
      : options.requestPayload;

  if (!isJsonValue(requestPayload)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    participantId: options.participantId,
    role,
    requestId,
    requestPayloadJson: JSON.stringify(requestPayload),
  };
}

function normalizeParticipantDisconnectOptions(
  options: RoomParticipantDisconnectOptions,
): NormalizedParticipantDisconnect {
  if (!isRecord(options) || !isNonEmptyString(options.participantId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    participantId: options.participantId,
    role:
      options.role === undefined
        ? null
        : normalizeParticipantRole(options.role),
    at: normalizeOperationTimestamp(options.at),
  };
}

function normalizeSetReadyOptions(
  options: RoomSetReadyOptions,
): RoomSetReadyOptions {
  normalizeParticipantOperationBase(options);

  if (typeof options.ready !== "boolean") {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return options;
}

function normalizeSelectTeamOptions(
  options: RoomSelectTeamOptions,
): RoomSelectTeamOptions {
  normalizeParticipantOperationBase(options);

  if (options.teamId !== null && !isNonEmptyString(options.teamId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    ...options,
    teamId: options.teamId === null ? null : options.teamId.trim(),
  };
}

function normalizeUpdateSettingsOptions(
  options: RoomUpdateSettingsOptions,
): RoomUpdateSettingsOptions {
  normalizeHostOperationBase(options);

  if (!isJsonObject(options.settings)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return options;
}

function normalizeTransferHostOptions(
  options: RoomTransferHostOptions,
): RoomTransferHostOptions {
  normalizeHostOperationBase(options);

  if (!isNonEmptyString(options.targetParticipantId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return {
    ...options,
    targetParticipantId: options.targetParticipantId.trim(),
  };
}

function normalizeKickOptions(options: RoomKickOptions): NormalizedKickOptions {
  normalizeHostOperationBase(options);
  const targetParticipantId = normalizeOptionalIdentifier(
    options.targetParticipantId,
  );
  const targetPlayerId = normalizeOptionalIdentifier(options.targetPlayerId);

  if (
    (targetParticipantId === null && targetPlayerId === null) ||
    (targetParticipantId !== null && targetPlayerId !== null)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message:
        "強制退出の対象 participantId または playerId を一つ指定してください。",
    });
  }

  const reason =
    options.reason === undefined ? null : normalizeKickReason(options.reason);

  return {
    ...options,
    targetParticipantId,
    targetPlayerId,
    reason,
  };
}

function normalizeStartMatchOptions(
  options: RoomStartMatchOptions,
): RoomStartMatchOptions & { readonly at: Timestamp } {
  normalizeHostOperationBase(options);

  return {
    ...options,
    at: normalizeOperationTimestamp(options.at),
  };
}

function normalizeCloseOptions(
  options: RoomCloseOptions,
): RoomCloseOptions & { readonly at: Timestamp } {
  normalizeHostOperationBase(options);

  return {
    ...options,
    at: normalizeOperationTimestamp(options.at),
  };
}

function normalizeParticipantOperationBase(
  options: RoomParticipantOperationOptions,
): void {
  if (!isRecord(options) || !isNonEmptyString(options.participantId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  normalizeOptionalOperationRequestId(options.requestId);

  if (
    options.requestPayload !== undefined &&
    !isJsonValue(options.requestPayload)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
}

function normalizeHostOperationBase(options: RoomHostOperationOptions): void {
  normalizeParticipantOperationBase(options);
}

function normalizeOptionalOperationRequestId(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return normalizeRequestIdentifier(value);
}

function normalizeOptionalIdentifier(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value) || value.length > 256) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value.trim();
}

function normalizeKickReason(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 256) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value.trim();
}

function normalizeOperationTimestamp(value: unknown): Timestamp {
  const normalized = value ?? new Date().toISOString();

  if (!isValidTimestamp(normalized)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "操作時刻は有効な Timestamp で指定してください。",
    });
  }

  return normalized;
}

function normalizeOperationRequest(
  requestId: string | undefined,
  requestPayload: JsonValue | undefined,
  operationPayload: JsonObject,
): NormalizedOperationRequest {
  const normalizedRequestId = normalizeOptionalOperationRequestId(requestId);
  const payload: JsonObject = {
    operation: operationPayload,
    ...(requestPayload === undefined ? {} : { requestPayload }),
  };

  return {
    requestId: normalizedRequestId,
    payload,
    payloadJson: JSON.stringify(payload),
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
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
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

function isRoomParticipantRole(value: unknown): value is RoomParticipantRole {
  return value === "player" || value === "spectator";
}

async function assertJoinCredentials(
  room: RoomRow,
  options: NormalizedParticipantJoin,
): Promise<void> {
  if (room.joinMethod === "invitation") {
    if (
      room.invitationCode === null ||
      options.invitationCode !== room.invitationCode.toUpperCase()
    ) {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "招待コードが正しくありません。",
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
        room.joinPasswordHash,
      ))
    ) {
      throw new FlareLobbyError("FORBIDDEN", {
        message: "パスワードが正しくありません。",
      });
    }
  }
}

function parseParticipantLeaveResult(
  value: JsonValue,
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

function parseRoomSnapshotResult(value: JsonValue): RoomSnapshot {
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return value as unknown as RoomSnapshot;
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
    hash: encodeBase64Url(hash),
  };
}

async function verifyRoomPassword(
  password: string,
  encodedSalt: string,
  expectedHash: string,
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
  salt: Uint8Array,
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

function normalizeScheduledOperation(options: RoomScheduledOperationOptions): {
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

  if (
    kind !== "noop" &&
    kind !== "room_retention" &&
    kind !== ROOM_INDEX_UPSERT_OPERATION_KIND &&
    kind !== ROOM_INDEX_DELETE_OPERATION_KIND
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  if (options.id === ROOM_RETENTION_OPERATION_ID && kind !== "room_retention") {
    throw new FlareLobbyError("CONFLICT", {
      message: "Room の保持期限で予約する識別子は利用できません。",
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
    payloadJson: JSON.stringify(payload),
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
    createdAt,
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
    playerId: value.playerId,
  };
}

function normalizeParticipants(
  values: readonly Participant[] | undefined,
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
        message: "参加者の識別子は一意な空でない文字列で指定してください。",
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
        ready: participant["ready"],
      };
    }

    if (participant["kind"] === "spectator") {
      return {
        participantId,
        kind: "spectator" as const,
        playerId,
        teamId: null,
        ready: false,
      };
    }

    throw new FlareLobbyError("INVALID_PAYLOAD");
  });
}

function normalizeTeams(
  values: readonly Team[] | undefined,
): readonly string[] {
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

    if (
      team === undefined ||
      !isNonEmptyString(teamId) ||
      teamIds.has(teamId)
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "チームの識別子は一意な空でない文字列で指定してください。",
      });
    }

    teamIds.add(teamId);
    return teamId;
  });
}

function createRoomState(
  status: RoomStatus,
  startedAt: string | null,
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

function assertWaitingRoom(room: RoomRow): void {
  if (room.state === "finished") {
    throw new FlareLobbyError("ROOM_FINISHED");
  }

  if (room.state !== "waiting") {
    throw new FlareLobbyError("CONFLICT", {
      message: "待機中の Room だけがこの操作を受け付けます。",
    });
  }
}

function assertActiveRoom(room: RoomRow): void {
  if (room.state === "finished") {
    throw new FlareLobbyError("ROOM_FINISHED");
  }
}

function isAllowedTransition(current: RoomStatus, next: RoomStatus): boolean {
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

function parseCustomRoomIndexRecord(value: JsonValue): CustomRoomIndexRecord {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["name"]) ||
    !isNullableIndexString(value["mode"]) ||
    !isNullableIndexString(value["region"]) ||
    !isRoomStatus(value["state"]) ||
    !isRoomJoinMethod(value["joinMethod"]) ||
    !isPositiveSafeInteger(value["maxPlayers"]) ||
    !isNonNegativeSafeInteger(value["playerCount"]) ||
    !isNonNegativeSafeInteger(value["availableSlots"]) ||
    !isNonNegativeSafeInteger(value["maxSpectators"]) ||
    !isNonNegativeSafeInteger(value["spectatorCount"]) ||
    !isNonNegativeSafeInteger(value["availableSpectatorSlots"]) ||
    !isSafeTimestamp(value["revision"]) ||
    !isSafeTimestamp(value["createdAt"]) ||
    !isSafeTimestamp(value["updatedAt"])
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return value as CustomRoomIndexRecord;
}

function readIndexString(value: unknown): string | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length <= 64 ? normalized : normalized.slice(0, 64);
}

function isNullableIndexString(value: unknown): value is string | null {
  return value === null || (isNonEmptyString(value) && value.length <= 64);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRoomJoinMethod(value: unknown): value is RoomJoinMethod {
  return value === "public" || value === "invitation" || value === "password";
}

function parseMatchmakingPool(value: JsonObject): MatchmakingPool {
  const fields = ["id", "gameId", "seasonId", "mode", "region"] as const;

  if (!fields.every((field) => isNonEmptyString(value[field]))) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return withOptionalPartyFields(
    {
      id: value["id"] as string,
      gameId: value["gameId"] as string,
      seasonId: value["seasonId"] as string,
      mode: value["mode"] as string,
      region: value["region"] as string,
    },
    value,
  );
}

/**
 * Pool のパーティー拡張項目 (ADR-0005) を、保存値が持つ場合だけ復元します。
 */
function withOptionalPartyFields(
  pool: MatchmakingPool,
  value: Readonly<Record<string, unknown>>,
): MatchmakingPool {
  const maxPartySize = readPositiveSafeInteger(value["maxPartySize"]);
  const teamSize = readPositiveSafeInteger(value["teamSize"]);
  return {
    ...pool,
    ...(maxPartySize === undefined ? {} : { maxPartySize }),
    ...(teamSize === undefined ? {} : { teamSize }),
  };
}

function readPositiveSafeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function normalizeMatchmakingPool(value: unknown): MatchmakingPool {
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const fields = ["id", "gameId", "seasonId", "mode", "region"] as const;

  if (!fields.every((field) => isNonEmptyString(value[field]))) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return withOptionalPartyFields(
    {
      id: value["id"] as string,
      gameId: value["gameId"] as string,
      seasonId: value["seasonId"] as string,
      mode: value["mode"] as string,
      region: value["region"] as string,
    },
    value,
  );
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

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item),
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function normalizeOptionalPositiveInteger(
  value: number | undefined,
  fieldName: string,
): number | null {
  if (value === undefined) {
    return null;
  }

  return normalizePositiveInteger(value, fieldName);
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 1 以上の整数で指定してください。`,
    });
  }

  return value;
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${fieldName} は 0 以上の整数で指定してください。`,
    });
  }

  return value;
}
