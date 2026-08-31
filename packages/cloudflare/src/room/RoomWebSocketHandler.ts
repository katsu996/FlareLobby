import { FlareLobbyError, PROTOCOL_VERSION } from "@flarelobby/core";
import type {
  ClientCommandEnvelope,
  JsonObject,
  JsonValue,
  ProtocolMessage,
  RoomSnapshot,
  ServerEventEnvelope,
  ServerSuccessEnvelope,
  Timestamp,
} from "@flarelobby/core";
import type {
  RoomWebSocketAttachment,
  RoomConnectionRow,
  RoomRow,
  ParticipantRow,
  NormalizedOperationRequest,
  RoomSetReadyOptions,
  RoomSelectTeamOptions,
  RoomUpdateSettingsOptions,
  RoomTransferHostOptions,
  RoomKickOptions,
  RoomStartMatchOptions,
  RoomCloseOptions,
} from "../room.js";
import type { RateLimitDurableObject } from "../durable-objects.js";
import {
  ROOM_WEBSOCKET_ATTACHMENT_VERSION,
  DEFAULT_WEBSOCKET_MESSAGE_BYTES,
  DEFAULT_WEBSOCKET_MESSAGE_LIMIT,
  ROOM_WEBSOCKET_MESSAGE_BYTES_HEADER,
  ROOM_WEBSOCKET_MESSAGE_LIMIT_HEADER,
  FLARE_LOBBY_WEBSOCKET_PROTOCOL,
  ROOM_SET_READY_COMMAND,
  ROOM_SELECT_TEAM_COMMAND,
  ROOM_UPDATE_SETTINGS_COMMAND,
  ROOM_TRANSFER_HOST_COMMAND,
  ROOM_KICK_COMMAND,
  ROOM_START_MATCH_COMMAND,
  ROOM_CLOSE_COMMAND,
} from "../room.js";
import { readPositiveHeader } from "../room.js";
import {
  createGatewayPrincipalEnvelope,
  createErrorResponse,
} from "../security.js";
import type {
  GatewayPrincipalEnvelope,
  FlareLobbyRoomParticipantRole,
  FlareLobbyRoomTokenClaims,
} from "../security.js";
import type { FlareLobbyObservabilityContext } from "../observability.js";
import {
  createObservabilitySink,
  FLARE_LOBBY_OPERATION_HEADER,
  observeHttpOperation,
  readObservabilityContext,
} from "../observability.js";

/**
 * Room WebSocket ハンドラの依存インターフェース。
 * 実際の Durable Object から必要な機能を抽象化し、テスタビリティを確保。
 */
export interface RoomWebSocketDependencies {
  /** Durable Object コンテキスト */
  readonly ctx: DurableObjectState;
  /** Room 行を読み取る */
  readRoomRow(): RoomRow | undefined;
  /** 参加者行を読み取る */
  readParticipantById(participantId: string): ParticipantRow | undefined;
  /** スナップショットを読み取る */
  readSnapshot(): RoomSnapshot | null;
  /** 必須スナップショットを読み取る（存在しない場合は例外） */
  readRequiredSnapshot(): RoomSnapshot;
  /** 接続行を読み取る */
  readRoomConnection(resumeId: string): RoomConnectionRow | undefined;
  /** 処理済みコマンドを読み取る */
  readProcessedCommand(requestId: string): NormalizedOperationRequest | null;
  /** 処理済みコマンドを記録する */
  recordProcessedCommand(requestId: string, result: RoomSnapshot): void;
  /** SQL 実行 */
  exec(sql: string, ...args: unknown[]): void;
  /** Alarm 同期 */
  synchronizeAlarm(): Promise<void>;
  /** 次回 Alarm 取得 */
  getNextAlarm(): Promise<number | null>;
  /** 接続を保存 */
  storeWebSocketConnection(
    attachment: RoomWebSocketAttachment,
    resumeTokenExpiresAt: number,
    isResume: boolean,
  ): void;
  /** 切断済みマーク */
  markWebSocketDisconnected(attachment: RoomWebSocketAttachment): Promise<void>;
  /** 参加者切断をスケジュール */
  scheduleParticipantDisconnect(
    participantId: string,
    disconnectedAt: Timestamp,
  ): Promise<void>;
  /** 参加者の切断期限切れ処理 */
  expireDisconnectedParticipant(
    room: RoomRow,
    participantId: string,
    disconnectedAt: Timestamp,
  ): "removed" | "deferred" | "noop";
  /** 切断操作をキャンセル */
  cancelDisconnectOperation(participantId: string): void;
  /** スナップショットイベント作成 */
  createRoomSnapshotEvent(
    snapshot: RoomSnapshot,
    resume?: {
      readonly resumeToken: string;
      readonly resumeTokenExpiresAt: number;
      readonly participantId: string;
      readonly role: FlareLobbyRoomParticipantRole;
      readonly resumed: boolean;
    },
  ): ServerEventEnvelope;
  /** ルームスナップショットをブロードキャスト */
  broadcastRoomSnapshot(snapshot: RoomSnapshot): void;
  /** プロトコルメッセージをブロードキャスト */
  broadcastProtocolMessage(message: ProtocolMessage): void;
  /** ゲームメッセージをブロードキャスト */
  broadcastGameMessage(
    attachment: RoomWebSocketAttachment,
    command: ClientCommandEnvelope,
  ): void;
  /** ルームイベントを記録 */
  recordRoomEvent(event: ServerEventEnvelope): void;
  /** 再開イベントを読み取る */
  readResumeEvents(
    lastRevision: number | null,
    currentRevision: number,
  ): {
    readonly useSnapshot: boolean;
    readonly events: readonly ProtocolMessage[];
  };
  /** 参加者操作を実行 */
  setReady(options: RoomSetReadyOptions): Promise<RoomSnapshot>;
  selectTeam(options: RoomSelectTeamOptions): Promise<RoomSnapshot>;
  updateSettings(options: RoomUpdateSettingsOptions): Promise<RoomSnapshot>;
  transferHost(options: RoomTransferHostOptions): Promise<RoomSnapshot>;
  kick(options: RoomKickOptions): Promise<RoomSnapshot>;
  startMatch(options: RoomStartMatchOptions): Promise<RoomSnapshot>;
  close(options: RoomCloseOptions): Promise<RoomSnapshot>;
  /** リクエストIDをスコープ付け */
  scopeWebSocketRequestId(
    principalId: string,
    requestId: string | undefined,
  ): string;
  /** 再開トークンを発行 */
  issueResumeToken(
    secret: string,
    params: {
      readonly principal: { readonly id: string; readonly playerId: string };
      readonly roomId: string;
      readonly role: FlareLobbyRoomParticipantRole;
      readonly participantId: string;
      readonly expiresAt: number;
      readonly now: number;
      readonly nonce: string;
    },
  ): Promise<
    { ok: true; value: string } | { ok: false; error: FlareLobbyError }
  >;
  /** 参加者参加処理 */
  joinParticipant(
    room: RoomRow,
    participant: ParticipantRow,
    role: FlareLobbyRoomParticipantRole,
    attachment: RoomWebSocketAttachment,
    isResume: boolean,
    context: FlareLobbyObservabilityContext,
  ): Promise<RoomSnapshot>;
  /** 再開トークンを読み取る */
  readWebSocketJoinToken(
    request: Request,
  ): { ok: true; value: string } | { ok: false; error: FlareLobbyError };
  /** WebSocket 接続情報を読み取る */
  readWebSocketAttachment(webSocket: WebSocket): RoomWebSocketAttachment | null;
  /** WebSocket タグを作成 */
  createWebSocketTags(attachment: RoomWebSocketAttachment): string[];
  /** ルーム ID を WebSocket から取得 */
  getWebSocketRoomId(request: Request): string | null;
  /** WebSocket プロトコルを確認 */
  hasWebSocketProtocol(request: Request): boolean;
  /** 最後のリビジョンを読み取る */
  readLastRevision(
    request: Request,
  ): { ok: true; value: number } | { ok: false; error: FlareLobbyError };
  /** 再開トークンを検証 */
  verifyWebSocketRoomToken(
    secret: string,
    token: string,
    options: { readonly roomId: string },
  ): Promise<
    | { ok: true; value: FlareLobbyRoomTokenClaims }
    | { ok: false; error: FlareLobbyError }
  >;
  /** WebSocket コマンドを検証 */
  validateWebSocketCommand(
    message: string | ArrayBuffer,
    maxBytes: number,
  ):
    | { ok: true; value: ClientCommandEnvelope }
    | { ok: false; error: FlareLobbyError };
  /** WebSocket メッセージ失敗を送信 */
  sendWebSocketFailure(webSocket: WebSocket, error: FlareLobbyError): void;
  /** プロトコルメッセージを送信 */
  sendProtocolMessage(webSocket: WebSocket, message: ProtocolMessage): boolean;
  /** プロトコルメッセージをエンコード */
  encodeProtocolMessage(
    message: ProtocolMessage,
  ): { ok: true; value: string } | { ok: false; error: FlareLobbyError };
  /** WebSocket エラーを正規化 */
  normalizeWebSocketError(error: unknown, requestId?: string): FlareLobbyError;
  /** WebSocket を安全に閉じる */
  closeWebSocketSafely(
    webSocket: WebSocket,
    code: number,
    reason: string,
  ): void;
  /** JSON オブジェクトを要求 */
  requireJsonObject(value: unknown): JsonObject;
  /** オプション文字列を取得 */
  optionalString(value: unknown): string | undefined;
  /** 非空文字列判定 */
  isNonEmptyString(value: unknown): value is string;
  /** 正の安全整数判定 */
  isPositiveSafeInteger(value: unknown): value is number;
  /** 有効なタイムスタンプ判定 */
  isValidTimestamp(value: string): boolean;
  /** ルーム参加者役割判定 */
  isRoomParticipantRole(value: unknown): value is FlareLobbyRoomParticipantRole;
  /** レコード判定 */
  isRecord(value: unknown): value is Record<string, unknown>;
  /** 深く凍結 */
  deepFreeze<T>(value: T): T;
  /** リビジョンを増加 */
  incrementRevision(revision: number): void;
  /** スケジュール操作をキャンセル */
  cancelScheduledOperation(operationId: string): Promise<boolean>;
  /** 操作結果を復元 */
  restoreOperationResult(
    request: NormalizedOperationRequest,
    command: string,
  ): RoomSnapshot | null;
  /** 操作結果を保存 */
  storeOperationResult(
    request: NormalizedOperationRequest,
    command: string,
    result: RoomSnapshot,
  ): RoomSnapshot;
  /** 派生インデックス同期をキューイング */
  enqueueCustomRoomIndexSync(): Promise<void>;
  /** 切断猶予期間を取得 */
  getDisconnectGracePeriodMs(): number;
  /** 再開トークン TTL を取得 */
  getResumeTokenTtlMs(): number;
  /** イベント履歴制限を取得 */
  getEventHistoryLimit(): number;
  /** 処理済みコマンド保持期間を取得 */
  getProcessedCommandRetentionMs(): number;
  /** 最小プレイヤー数を取得 */
  getMinimumPlayers(): number;
  /** 全プレイヤー準備完了要求を取得 */
  getRequireAllPlayersReady(): number;
  /** 最大プレイヤー数を取得 */
  getMaxPlayers(): number;
  /** 最大観戦者数を取得 */
  getMaxSpectators(): number;
}

/**
 * Room WebSocket ハンドラ。
 * WebSocket 接続、メッセージ、切断、エラー処理を一元管理。
 */
export class RoomWebSocketHandler {
  constructor(
    private readonly deps: RoomWebSocketDependencies,
    private readonly env: {
      readonly FLARE_LOBBY_TOKEN_SECRET: string;
      readonly FLARE_LOBBY_ANALYTICS?: AnalyticsEngineDataset;
      readonly FLARE_LOBBY_RATE_LIMITS: DurableObjectNamespace<RateLimitDurableObject>;
    },
  ) {}

  /**
   * WebSocket Upgrade リクエストを処理する。
   * Hibernation API のエントリーポイント。
   */
  public async handleFetch(request: Request): Promise<Response> {
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

      const roomId = this.deps.getWebSocketRoomId(request);

      if (roomId === null || !this.deps.hasWebSocketProtocol(request)) {
        return createErrorResponse(new FlareLobbyError("INVALID_MESSAGE"));
      }

      const token = this.deps.readWebSocketJoinToken(request);

      if (!token.ok) {
        return createErrorResponse(token.error);
      }

      const claims = await this.deps.verifyWebSocketRoomToken(
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

      const lastRevision = this.deps.readLastRevision(request);

      if (!lastRevision.ok) {
        return createErrorResponse(lastRevision.error);
      }

      let connectionAttachment: RoomWebSocketAttachment | undefined;

      try {
        const room = this.deps.readRoomRow();

        if (room === undefined || room.roomId !== roomId) {
          return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
        }

        if (room.state === "finished") {
          return createErrorResponse(new FlareLobbyError("ROOM_FINISHED"));
        }

        const participant = this.deps.readParticipantById(
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
          const connection = this.deps.readRoomConnection(claims.value.nonce);

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
            disconnectedAt + this.deps.getDisconnectGracePeriodMs() < Date.now()
          ) {
            this.deps.expireDisconnectedParticipant(
              room,
              participant.participantId,
              connection.disconnectedAt,
            );
            await this.deps.synchronizeAlarm();
            return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
          }

          resumeId = connection.resumeId;
          resumeTokenExpiresAt = connection.resumeTokenExpiresAt;
          this.deps.cancelDisconnectOperation(participant.participantId);
        }

        const connectedAt = new Date().toISOString();
        const connectionGeneration = crypto.randomUUID();

        if (!isResume) {
          const resumeTokenNow = Date.now();
          resumeTokenExpiresAt =
            resumeTokenNow + this.deps.getResumeTokenTtlMs();
          const issuedResumeToken = await this.deps.issueResumeToken(
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

        const snapshot = this.deps.readSnapshot();

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
        this.deps.storeWebSocketConnection(
          connectionAttachment,
          resumeTokenExpiresAt,
          claims.value.purpose === "resume",
        );
        this.deps.ctx.acceptWebSocket(
          server,
          this.deps.createWebSocketTags(connectionAttachment),
        );

        const replay = isResume
          ? this.deps.readResumeEvents(lastRevision.value, snapshot.revision)
          : null;
        const messages =
          replay === null || replay.useSnapshot
            ? [
                this.deps.createRoomSnapshotEvent(snapshot, {
                  resumeToken,
                  resumeTokenExpiresAt,
                  participantId: participant.participantId,
                  role: participant.kind,
                  resumed: isResume,
                }),
              ]
            : replay.events.length === 0
              ? [
                  this.deps.createRoomSnapshotEvent(snapshot, {
                    resumeToken,
                    resumeTokenExpiresAt,
                    participantId: participant.participantId,
                    role: participant.kind,
                    resumed: true,
                  }),
                ]
              : [
                  ...replay.events,
                  this.deps.createRoomSnapshotEvent(snapshot, {
                    resumeToken,
                    resumeTokenExpiresAt,
                    participantId: participant.participantId,
                    role: participant.kind,
                    resumed: true,
                  }),
                ];

        if (
          !messages.every((message) =>
            this.deps.sendProtocolMessage(server, message),
          )
        ) {
          await this.deps.markWebSocketDisconnected(connectionAttachment);
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
            await this.deps.markWebSocketDisconnected(connectionAttachment);
          } catch {
            // 接続行の後始末に失敗しても、公開エラーへ内部情報を含めません。
          }
        }

        return createErrorResponse(this.deps.normalizeWebSocketError(error));
      }
    });
  }

  /**
   * WebSocket メッセージを処理する。
   */
  public async handleWebSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.deps.ctx.blockConcurrencyWhile(async () => {
      await this.handleWebSocketMessageInternal(webSocket, message);
    });
  }

  private async handleWebSocketMessageInternal(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.deps.readWebSocketAttachment(webSocket);

    if (attachment === null) {
      this.deps.closeWebSocketSafely(webSocket, 1008, "接続情報が無効です。");
      return;
    }

    const command = this.deps.validateWebSocketCommand(
      message,
      attachment.maxWebSocketMessageBytes,
    );

    if (!command.ok) {
      this.deps.sendWebSocketFailure(webSocket, command.error);

      if (command.error.requestId === undefined) {
        this.deps.closeWebSocketSafely(
          webSocket,
          1002,
          "メッセージを解釈できません。",
        );
      }

      return;
    }

    const gatewayPrincipal = await createGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      attachment.principal,
    );

    if (!gatewayPrincipal.ok) {
      this.deps.sendWebSocketFailure(
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
      this.deps.sendWebSocketFailure(
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

      if (!this.deps.sendProtocolMessage(webSocket, response)) {
        this.deps.closeWebSocketSafely(
          webSocket,
          1011,
          "応答を送信できません。",
        );
      }
    } catch (error) {
      this.deps.sendWebSocketFailure(
        webSocket,
        this.deps.normalizeWebSocketError(error, command.value.requestId),
      );
    }
  }

  /**
   * WebSocket 切断を処理する。
   */
  public async handleWebSocketClose(
    webSocket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.deps.ctx.blockConcurrencyWhile(async () => {
      const attachment = this.deps.readWebSocketAttachment(webSocket);

      if (attachment !== null) {
        await this.deps.markWebSocketDisconnected(attachment);
      }
    });
  }

  /**
   * WebSocket エラーを処理する。
   */
  public async handleWebSocketError(
    webSocket: WebSocket,
    _error: unknown,
  ): Promise<void> {
    await this.deps.ctx.blockConcurrencyWhile(async () => {
      const attachment = this.deps.readWebSocketAttachment(webSocket);

      if (attachment !== null) {
        await this.deps.markWebSocketDisconnected(attachment);
      }
    });
  }

  /**
   * WebSocket コマンドをディスパッチする。
   */
  private async dispatchWebSocketCommand(
    attachment: RoomWebSocketAttachment,
    gatewayPrincipal: GatewayPrincipalEnvelope,
    command: ClientCommandEnvelope,
  ): Promise<JsonValue> {
    const requestId = this.deps.scopeWebSocketRequestId(
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
        const payload = this.deps.requireJsonObject(command.payload);

        if (typeof payload["ready"] !== "boolean") {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.deps.setReady({
          ...common,
          ready: payload["ready"],
        })) as unknown as JsonValue;
      }
      case ROOM_SELECT_TEAM_COMMAND: {
        const payload = this.deps.requireJsonObject(command.payload);
        const teamId = payload["teamId"];

        if (teamId !== null && !this.deps.isNonEmptyString(teamId)) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.deps.selectTeam({
          ...common,
          teamId: teamId === null ? null : teamId,
        })) as unknown as JsonValue;
      }
      case ROOM_UPDATE_SETTINGS_COMMAND: {
        const payload = this.deps.requireJsonObject(command.payload);

        return (await this.deps.updateSettings({
          ...common,
          settings: this.deps.requireJsonObject(payload["settings"]),
        })) as unknown as JsonValue;
      }
      case ROOM_TRANSFER_HOST_COMMAND: {
        const payload = this.deps.requireJsonObject(command.payload);

        if (!this.deps.isNonEmptyString(payload["targetParticipantId"])) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.deps.transferHost({
          ...common,
          targetParticipantId: payload["targetParticipantId"],
        })) as unknown as JsonValue;
      }
      case ROOM_KICK_COMMAND: {
        const payload = this.deps.requireJsonObject(command.payload);
        const targetParticipantId = this.deps.optionalString(
          payload["targetParticipantId"],
        );
        const targetPlayerId = this.deps.optionalString(
          payload["targetPlayerId"],
        );
        const reason = this.deps.optionalString(payload["reason"]);

        return (await this.deps.kick({
          ...common,
          ...(targetParticipantId === undefined ? {} : { targetParticipantId }),
          ...(targetPlayerId === undefined ? {} : { targetPlayerId }),
          ...(reason === undefined ? {} : { reason }),
        })) as unknown as JsonValue;
      }
      case ROOM_START_MATCH_COMMAND: {
        const payload = this.deps.requireJsonObject(command.payload);
        const at = payload["at"];

        if (at !== undefined && !this.deps.isNonEmptyString(at)) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.deps.startMatch({
          ...common,
          ...(at === undefined ? {} : { at }),
        })) as unknown as JsonValue;
      }
      case ROOM_CLOSE_COMMAND: {
        const payload = this.deps.requireJsonObject(command.payload);
        const at = payload["at"];

        if (at !== undefined && !this.deps.isNonEmptyString(at)) {
          throw new FlareLobbyError("INVALID_PAYLOAD");
        }

        return (await this.deps.close({
          ...common,
          ...(at === undefined ? {} : { at }),
        })) as unknown as JsonValue;
      }
      default: {
        throw new FlareLobbyError("INVALID_PAYLOAD", {
          message: `未知のコマンド: ${command.command}`,
        });
      }
    }
  }

  /**
   * WebSocket メッセージレート制限を消費する。
   */
  private async consumeWebSocketMessageRateLimit(
    principalId: string,
    gatewayPrincipal: GatewayPrincipalEnvelope,
    limit: number,
  ): Promise<
    { ok: true; value: undefined } | { ok: false; error: FlareLobbyError }
  > {
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
}
