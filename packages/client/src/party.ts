import { FlareLobbyError } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  FlareLobbyApp,
  FlareLobbyError as FlareLobbyErrorType,
  FlareLobbyErrorCode,
  JsonValue,
  RequestId,
  Timestamp,
} from "@flarelobby/core";
import {
  normalizeRoomReconnectOptions,
  type MatchmakingJoinOptions,
  type MatchmakingPoolReference,
  type MatchmakingTicket,
  type MatchmakingTicketCancelOptions,
  type MatchmakingTicketSnapshot,
  type NormalizedReconnectOptions,
} from "./matchmaking.js";
import type {
  CustomRoomTransport,
  RoomReconnectOptions,
} from "./custom-room.js";

const DEFAULT_PARTY_PATH = "/v1/parties";

/** パーティーのメンバー役割です。リーダーは常にちょうど 1 人です。 */
export type PartyMemberRole = "leader" | "member";

/** パーティーのメンバーです。 */
export interface PartyMemberSnapshot {
  readonly playerId: string;
  readonly role: PartyMemberRole;
  readonly joinedAt: Timestamp;
}

/** パーティーへの未使用招待です。単一用途トークンを持ちます。 */
export interface PartyInvite {
  readonly playerId: string;
  /** 招待受諾でだけ提示する単一用途トークンです。 */
  readonly token: string;
  readonly expiresAt: Timestamp;
  readonly createdAt: Timestamp;
}

/** パーティーの現在状態です。 */
export interface PartySnapshot {
  readonly partyId: string;
  readonly revision: number;
  readonly maxPartySize: number;
  readonly members: readonly PartyMemberSnapshot[];
  readonly invites: readonly PartyInvite[];
  /** 待機中のマッチングチケットによる構成変更の凍結状態です。 */
  readonly queuedTicket: {
    readonly ticketId: string;
    readonly poolKey: string;
  } | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** パーティーの状態変更イベントの種別です。 */
export type PartyEventType =
  | "created"
  | "member_joined"
  | "member_left"
  | "leader_transferred"
  | "invite_created"
  | "queue_started"
  | "queue_ended"
  | "dissolved";

/** パーティーの状態変更イベントです。各イベントは完全な Snapshot を運びます。 */
export interface PartyEvent {
  readonly sequence: number;
  readonly partyRevision: number;
  readonly type: PartyEventType;
  readonly snapshot: PartySnapshot;
  readonly occurredAt: Timestamp;
}

/** `createParty()` の公開オプションです。 */
export interface PartyCreationOptions {
  readonly requestId?: RequestId;
  /** 省略時はサーバー側の既定定員が使われます。 */
  readonly maxPartySize?: number;
  readonly signal?: AbortSignal;
  readonly reconnect?: RoomReconnectOptions;
}

/** 既存パーティーの購読や操作で使う共通オプションです。 */
export interface PartyRequestOptions {
  readonly signal?: AbortSignal;
  readonly reconnect?: RoomReconnectOptions;
}

/** 招待受諾で参加するときのオプションです。 */
export interface PartyJoinOptions extends PartyRequestOptions {}

/** 退出・移譲・解散など、操作系リクエストの共通オプションです。 */
export interface PartyOperationOptions {
  /** 省略時は自動生成した要求識別子を送ります。 */
  readonly requestId?: RequestId;
  readonly signal?: AbortSignal;
}

/** `invite()` の公開オプションです。 */
export interface PartyInviteRequestOptions extends PartyOperationOptions {
  /** 省略時はサーバー側の既定期限が使われます。 */
  readonly ttlMs?: number;
}

/** パーティーのイベント接続状態です。 */
export type PartyConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/** 接続状態の購読者です。 */
export type PartyConnectionStatusListener = (
  status: PartyConnectionStatus,
) => void;

/** パーティー更新イベントの購読者です。 */
export type PartyUpdateListener = (event: PartyEvent) => void;

/** `joinRankedQueue()` の公開オプションです。`partyId` はハンドルの値を使います。 */
export type PartyQueueJoinOptions = Omit<MatchmakingJoinOptions, "partyId">;

/**
 * パーティーを表す Client SDK のハンドルです。
 *
 * `snapshot` はサーバーから確認できた最新状態であり、イベント接続と
 * `refresh()` によって単調に進みます。
 */
export interface Party<TApp extends AnyFlareLobbyApp = FlareLobbyApp> {
  readonly id: string;
  readonly snapshot: PartySnapshot;
  readonly revision: number;
  readonly dissolved: boolean;
  readonly connectionStatus: PartyConnectionStatus;
  on(eventName: "update", listener: PartyUpdateListener): () => void;
  onStatusChange(listener: PartyConnectionStatusListener): () => void;
  refresh(options?: PartyRequestOptions): Promise<PartySnapshot>;
  invite(
    playerId: string,
    options?: PartyInviteRequestOptions,
  ): Promise<PartyInvite>;
  leave(
    options?: PartyOperationOptions,
  ): Promise<{ readonly dissolved: boolean }>;
  transferLeadership(
    playerId: string,
    options?: PartyOperationOptions,
  ): Promise<PartySnapshot>;
  dissolve(options?: PartyOperationOptions): Promise<PartySnapshot>;
  /** リーダーだけが実行できます。権限判定はサーバー側で行われます。 */
  joinRankedQueue(
    pool: MatchmakingPoolReference,
    options?: PartyQueueJoinOptions,
  ): Promise<MatchmakingTicket<TApp>>;
  cancelQueue(
    options?: MatchmakingTicketCancelOptions,
  ): Promise<MatchmakingTicketSnapshot<TApp>>;
  dispose(): void;
}

export interface PartyClientApi<TApp extends AnyFlareLobbyApp = FlareLobbyApp> {
  createParty(options?: PartyCreationOptions): Promise<Party<TApp>>;
  getParty(
    partyId: string,
    options?: PartyRequestOptions,
  ): Promise<Party<TApp>>;
  joinParty(
    invite: { readonly partyId: string; readonly token: string },
    options?: PartyJoinOptions,
  ): Promise<Party<TApp>>;
  dispose(): void;
}

interface QueueStarter<TApp extends AnyFlareLobbyApp> {
  (
    pool: MatchmakingPoolReference,
    options: MatchmakingJoinOptions,
  ): Promise<MatchmakingTicket<TApp>>;
}

interface PartyTransport<
  TApp extends AnyFlareLobbyApp,
> extends CustomRoomTransport<TApp> {
  requestIdFactory(): RequestId;
  connectEvents(
    path: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RawJsonEventConnection>;
  startQueue: QueueStarter<TApp>;
}

/**
 * プロトコル Envelope を使わず、1 メッセージ = 1 JSON 値を配信する接続です。
 * Party Durable Object のイベント接続は生の PartyEvent JSON を送信します。
 */
export interface RawJsonEventConnection {
  close(code?: number, reason?: string): void;
  onMessage(listener: (value: JsonValue) => void): () => void;
  onClose(listener: (error: FlareLobbyErrorType) => void): () => void;
}

/** クライアント本体からパーティー API を組み立てます。 */
export function createPartyApi<TApp extends AnyFlareLobbyApp = FlareLobbyApp>(
  transport: PartyTransport<TApp>,
): PartyClientApi<TApp> {
  const parties = new Set<PartyImpl<TApp>>();

  const registerParty = (party: PartyImpl<TApp>): void => {
    parties.add(party);
    // 解散などで購読が不要になったハンドルは参照を保持し続けません。
    party.onSettled = (): void => {
      parties.delete(party);
    };
  };

  const startHandle = async (
    party: PartyImpl<TApp>,
    signal: AbortSignal | undefined,
  ): Promise<PartyImpl<TApp>> => {
    registerParty(party);
    try {
      await party.start(signal);
      throwIfAborted(signal);
      return party;
    } catch (error) {
      party.dispose();
      throw normalizeClientError(error);
    }
  };

  return {
    createParty: async (options = {}) => {
      throwIfAborted(options.signal);
      const requestId =
        options.requestId ?? createRequestId(transport.requestIdFactory);
      const raw = await transport.request<unknown>(DEFAULT_PARTY_PATH, {
        method: "POST",
        body: compactJsonObject({
          requestId,
          maxPartySize: options.maxPartySize,
        }),
        requestId,
        ...requestSignalOptions(options.signal),
      });
      const snapshot = parsePartyEnvelope(raw);
      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      const party = new PartyImpl<TApp>(
        transport,
        snapshot,
        options.reconnect ?? transport.reconnectOptions,
      );
      return await startHandle(party, options.signal);
    },
    getParty: async (partyId, options = {}) => {
      throwIfAborted(options.signal);
      assertPartyId(partyId);
      const raw = await transport.request<unknown>(
        createPartyPath(partyId),
        requestSignalOptions(options.signal),
      );
      const snapshot = parsePartyEnvelope(raw);
      if (snapshot === null || snapshot.partyId !== partyId) {
        // 存在しないパーティーと非所属は、存在確認を防ぐため同一視します。
        throw new FlareLobbyError("FORBIDDEN");
      }

      const party = new PartyImpl<TApp>(
        transport,
        snapshot,
        options.reconnect ?? transport.reconnectOptions,
      );
      return await startHandle(party, options.signal);
    },
    joinParty: async (invite, options = {}) => {
      throwIfAborted(options.signal);
      assertPartyId(invite.partyId);
      if (!isNonEmptyString(invite.token)) {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }

      const requestId = createRequestId(transport.requestIdFactory);
      const path = `${createPartyPath(invite.partyId)}/members`;
      const body: JsonValue = { requestId, token: invite.token };
      let raw: unknown;
      try {
        raw = await transport.request<unknown>(path, {
          method: "POST",
          body,
          requestId,
          ...requestSignalOptions(options.signal),
        });
      } catch (error) {
        if (!isCancelledError(error) || options.signal?.aborted !== true) {
          throw normalizeClientError(error);
        }

        // 送信後に中止された場合も、同じ requestId で結果を再取得します。
        try {
          raw = await transport.request<unknown>(path, {
            method: "POST",
            body,
            requestId,
          });
        } catch {
          throw new FlareLobbyError("CANCELLED");
        }
      }

      const snapshot = parsePartyEnvelope(raw);
      if (snapshot === null) {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }

      const party = new PartyImpl<TApp>(
        transport,
        snapshot,
        options.reconnect ?? transport.reconnectOptions,
      );
      return await startHandle(party, options.signal);
    },
    dispose: () => {
      for (const party of parties) {
        party.dispose();
      }
      parties.clear();
    },
  };
}

class PartyImpl<TApp extends AnyFlareLobbyApp> implements Party<TApp> {
  private snapshotState: PartySnapshot;
  private dissolvedState = false;
  private readonly transport: PartyTransport<TApp>;
  private readonly reconnectOptions: NormalizedReconnectOptions;
  private readonly updateListeners = new Set<PartyUpdateListener>();
  private readonly statusListeners = new Set<PartyConnectionStatusListener>();
  private connection: RawJsonEventConnection | undefined;
  private unsubscribeMessages: () => void = (): void => undefined;
  private unsubscribeClose: () => void = (): void => undefined;
  private connectionStatusState: PartyConnectionStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private lastSequence = 0;
  private stopped = false;
  private activeQueueTicket: MatchmakingTicket<TApp> | undefined;
  /** 解散などで購読が不要になったことを API 層へ通知する内部フックです。 */
  onSettled?: () => void;

  public constructor(
    transport: PartyTransport<TApp>,
    snapshot: PartySnapshot,
    reconnectOptions: RoomReconnectOptions | undefined,
  ) {
    this.transport = transport;
    this.snapshotState = snapshot;
    this.reconnectOptions = normalizeRoomReconnectOptions(reconnectOptions);
  }

  public get id(): string {
    return this.snapshotState.partyId;
  }

  public get snapshot(): PartySnapshot {
    return this.snapshotState;
  }

  public get revision(): number {
    return this.snapshotState.revision;
  }

  public get dissolved(): boolean {
    return this.dissolvedState;
  }

  public get connectionStatus(): PartyConnectionStatus {
    return this.connectionStatusState;
  }

  public on(eventName: "update", listener: PartyUpdateListener): () => void {
    if (eventName !== "update" || typeof listener !== "function") {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    this.updateListeners.add(listener);
    return (): void => {
      this.updateListeners.delete(listener);
    };
  }

  public onStatusChange(listener: PartyConnectionStatusListener): () => void {
    if (typeof listener !== "function") {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    this.statusListeners.add(listener);
    return (): void => {
      this.statusListeners.delete(listener);
    };
  }

  public async start(signal?: AbortSignal): Promise<void> {
    if (this.stopped || this.dissolvedState) {
      return;
    }

    await this.connect(signal);
  }

  public async refresh(
    options: PartyRequestOptions = {},
  ): Promise<PartySnapshot> {
    throwIfAborted(options.signal);
    const raw = await this.transport.request<unknown>(
      createPartyPath(this.id),
      requestSignalOptions(options.signal),
    );
    const snapshot = parsePartyEnvelope(raw);
    if (snapshot === null || snapshot.partyId !== this.id) {
      throw new FlareLobbyError("FORBIDDEN");
    }

    this.applySnapshot(snapshot);
    return this.snapshotState;
  }

  public async invite(
    playerId: string,
    options: PartyInviteRequestOptions = {},
  ): Promise<PartyInvite> {
    if (!isNonEmptyString(playerId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const requestId =
      options.requestId ?? createRequestId(this.transport.requestIdFactory);
    const raw = await this.transport.request<unknown>(
      `${createPartyPath(this.id)}/invites`,
      {
        method: "POST",
        body: compactJsonObject({
          requestId,
          playerId,
          ttlMs: options.ttlMs,
        }),
        requestId,
        ...requestSignalOptions(options.signal),
      },
    );
    return parseInviteEnvelope(raw);
  }

  public async leave(
    options: PartyOperationOptions = {},
  ): Promise<{ readonly dissolved: boolean }> {
    const requestId =
      options.requestId ?? createRequestId(this.transport.requestIdFactory);
    const raw = await this.transport.request<unknown>(
      `${createPartyPath(this.id)}/leave`,
      {
        method: "POST",
        body: { requestId },
        requestId,
        ...requestSignalOptions(options.signal),
      },
    );
    const dissolved = isRecord(raw) && raw["dissolved"] === true;
    this.settle();
    return deepFreeze({ dissolved });
  }

  public async transferLeadership(
    playerId: string,
    options: PartyOperationOptions = {},
  ): Promise<PartySnapshot> {
    if (!isNonEmptyString(playerId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const requestId =
      options.requestId ?? createRequestId(this.transport.requestIdFactory);
    const raw = await this.transport.request<unknown>(
      `${createPartyPath(this.id)}/transfer-leadership`,
      {
        method: "POST",
        body: { requestId, playerId },
        requestId,
        ...requestSignalOptions(options.signal),
      },
    );
    return this.applyEnvelopeSnapshot(raw);
  }

  public async dissolve(
    options: PartyOperationOptions = {},
  ): Promise<PartySnapshot> {
    const requestId =
      options.requestId ?? createRequestId(this.transport.requestIdFactory);
    const raw = await this.transport.request<unknown>(
      `${createPartyPath(this.id)}/dissolve`,
      {
        method: "POST",
        body: { requestId },
        requestId,
        ...requestSignalOptions(options.signal),
      },
    );
    const snapshot = this.applyEnvelopeSnapshot(raw);
    this.settle();
    return snapshot;
  }

  public joinRankedQueue(
    pool: MatchmakingPoolReference,
    options: PartyQueueJoinOptions = {},
  ): Promise<MatchmakingTicket<TApp>> {
    if (this.dissolvedState) {
      return Promise.reject(new FlareLobbyError("CONFLICT"));
    }

    return this.transport
      .startQueue(pool, { ...options, partyId: this.id })
      .then((ticket) => {
        this.activeQueueTicket = ticket;
        ticket.onStatusChange(() => {
          if (
            this.activeQueueTicket === ticket &&
            isTerminalQueueStatus(ticket.status)
          ) {
            this.activeQueueTicket = undefined;
          }
        });
        return ticket;
      })
      .catch((error) => {
        throw normalizeClientError(error);
      });
  }

  public cancelQueue(
    options: MatchmakingTicketCancelOptions = {},
  ): Promise<MatchmakingTicketSnapshot<TApp>> {
    const ticket = this.activeQueueTicket;
    if (ticket === undefined || isTerminalQueueStatus(ticket.status)) {
      return Promise.reject(new FlareLobbyError("CONFLICT"));
    }

    return ticket.cancel(options).catch((error) => {
      throw normalizeClientError(error);
    });
  }

  public dispose(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopConnection();
    this.updateListeners.clear();
    this.statusListeners.clear();
    // 起動失敗や明示的な破棄でも、API 層がハンドルを保持し続けないようにします。
    this.onSettled?.();
  }

  private async connect(signal?: AbortSignal): Promise<void> {
    this.setConnectionStatus("connecting");
    const connection = await this.transport.connectEvents(
      this.createEventPath(),
      requestSignalOptions(signal),
    );

    if (this.stopped) {
      connection.close(1000, "party closed");
      return;
    }

    this.attachConnection(connection);
    this.reconnectAttempt = 0;
    this.setConnectionStatus("connected");
  }

  private createEventPath(): string {
    const after =
      this.lastSequence > 0 ? `?after=${String(this.lastSequence)}` : "";
    return `${createPartyPath(this.id)}/events/ws${after}`;
  }

  private attachConnection(connection: RawJsonEventConnection): void {
    this.unsubscribeMessages();
    this.unsubscribeClose();
    this.connection = connection;
    this.unsubscribeMessages = connection.onMessage((value) => {
      this.handlePayload(value);
    });
    this.unsubscribeClose = connection.onClose((error) => {
      this.handleConnectionClosed(connection, error);
    });
  }

  private handlePayload(value: JsonValue): void {
    const parsed = parsePartyEvent(value);
    if (parsed === null || parsed.snapshot.partyId !== this.id) {
      // 解釈できないメッセージは履歴との不整合を疑い、接続を作り直します。
      this.requestResync();
      return;
    }

    if (parsed.sequence <= this.lastSequence) {
      return;
    }

    // 各イベントが完全な Snapshot を運ぶため、履歴に数値の飛びがあっても
    // 最新 Snapshot へ一括で前進できます。
    this.lastSequence = parsed.sequence;
    if (!this.applySnapshot(parsed.snapshot)) {
      return;
    }
    this.notifyUpdate(parsed);

    if (parsed.type === "dissolved") {
      this.settle();
    }
  }

  /** Snapshot を単調に適用します。後退する版と解散後の値は破棄します。 */
  private applySnapshot(snapshot: PartySnapshot): boolean {
    if (snapshot.revision < this.snapshotState.revision) {
      return false;
    }

    if (this.dissolvedState) {
      return false;
    }

    this.snapshotState = snapshot;
    return true;
  }

  private applyEnvelopeSnapshot(raw: unknown): PartySnapshot {
    const snapshot = parsePartyEnvelope(raw);
    if (snapshot === null || snapshot.partyId !== this.id) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    this.applySnapshot(snapshot);
    return this.snapshotState;
  }

  private notifyUpdate(event: PartyEvent): void {
    for (const listener of this.updateListeners) {
      try {
        listener(event);
      } catch {
        // 更新購読者の例外でパーティー状態を壊しません。
      }
    }
  }

  private settle(): void {
    this.dissolvedState = true;
    this.stopConnection();
    this.onSettled?.();
  }

  private handleConnectionClosed(
    connection: RawJsonEventConnection,
    error: FlareLobbyErrorType,
  ): void {
    if (this.stopped || connection !== this.connection || this.dissolvedState) {
      return;
    }

    this.setConnectionStatus("disconnected");
    if (!isRetryableReconnectError(error.code)) {
      return;
    }

    this.scheduleReconnect();
  }

  /** 切断後の再接続を再試行回数の上限内で遅延実行します。 */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      return;
    }

    if (this.reconnectAttempt >= this.reconnectOptions.maxAttempts) {
      return;
    }

    this.setConnectionStatus("reconnecting");
    const delay = this.reconnectDelay(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.stopped || this.dissolvedState) {
      return;
    }

    this.reconnectAttempt += 1;
    try {
      // 最後に適用した sequence を after へ渡し、欠落分の履歴と各イベントの
      // Snapshot で状態を復元します。
      await this.connect();
      this.reconnectAttempt = 0;
    } catch (error) {
      if (
        this.stopped ||
        !isRetryableReconnectError(normalizeClientError(error).code)
      ) {
        this.setConnectionStatus("disconnected");
        return;
      }

      if (this.reconnectAttempt < this.reconnectOptions.maxAttempts) {
        this.scheduleReconnect();
      } else {
        this.setConnectionStatus("disconnected");
      }
    }
  }

  private requestResync(): void {
    if (this.stopped || this.dissolvedState) {
      return;
    }

    this.connection?.close(1000, "party resync");
  }

  private stopConnection(): void {
    this.unsubscribeMessages();
    this.unsubscribeClose();
    this.connection?.close(1000, "party settled");
    this.connection = undefined;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.setConnectionStatus("disconnected");
  }

  private reconnectDelay(attempt: number): number {
    const exponential = Math.min(
      this.reconnectOptions.maxDelayMs,
      this.reconnectOptions.baseDelayMs * 2 ** attempt,
    );
    const jitter =
      this.reconnectOptions.jitterRatio === 0
        ? 0
        : (Math.random() * 2 - 1) * this.reconnectOptions.jitterRatio;
    return Math.max(0, Math.round(exponential * (1 + jitter)));
  }

  private setConnectionStatus(status: PartyConnectionStatus): void {
    if (this.connectionStatusState === status) {
      return;
    }

    this.connectionStatusState = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // 接続状態購読者の例外で再接続処理を止めません。
      }
    }
  }
}

function createPartyPath(partyId: string): string {
  return `${DEFAULT_PARTY_PATH}/${encodeURIComponent(partyId)}`;
}

function parsePartyEnvelope(value: unknown): PartySnapshot | null {
  if (!isRecord(value)) {
    throw new FlareLobbyError("INVALID_MESSAGE");
  }

  const payload = value["party"];
  return payload === null ? null : parsePartySnapshot(payload);
}

function parsePartySnapshot(value: unknown): PartySnapshot {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["partyId"]) ||
    !isFiniteNonNegativeNumber(value["revision"]) ||
    !isFiniteNonNegativeNumber(value["maxPartySize"]) ||
    !Array.isArray(value["members"]) ||
    !Array.isArray(value["invites"]) ||
    !isTimestamp(value["createdAt"]) ||
    !isTimestamp(value["updatedAt"])
  ) {
    throw new FlareLobbyError("INVALID_MESSAGE");
  }

  const queuedTicketValue = value["queuedTicket"];
  let queuedTicket: PartySnapshot["queuedTicket"] = null;
  if (queuedTicketValue !== null) {
    if (
      !isRecord(queuedTicketValue) ||
      !isNonEmptyString(queuedTicketValue["ticketId"]) ||
      !isNonEmptyString(queuedTicketValue["poolKey"])
    ) {
      throw new FlareLobbyError("INVALID_MESSAGE");
    }

    queuedTicket = deepFreeze({
      ticketId: queuedTicketValue["ticketId"],
      poolKey: queuedTicketValue["poolKey"],
    });
  }

  return deepFreeze({
    partyId: value["partyId"],
    revision: value["revision"],
    maxPartySize: value["maxPartySize"],
    members: deepFreeze(value["members"].map(parsePartyMember)),
    invites: deepFreeze(value["invites"].map(parsePartyInvite)),
    queuedTicket,
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  });
}

function parsePartyMember(value: unknown): PartyMemberSnapshot {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["playerId"]) ||
    (value["role"] !== "leader" && value["role"] !== "member") ||
    !isTimestamp(value["joinedAt"])
  ) {
    throw new FlareLobbyError("INVALID_MESSAGE");
  }

  return deepFreeze({
    playerId: value["playerId"],
    role: value["role"],
    joinedAt: value["joinedAt"],
  });
}

function parsePartyInvite(value: unknown): PartyInvite {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["playerId"]) ||
    !isNonEmptyString(value["token"]) ||
    !isTimestamp(value["expiresAt"]) ||
    !isTimestamp(value["createdAt"])
  ) {
    throw new FlareLobbyError("INVALID_MESSAGE");
  }

  return deepFreeze({
    playerId: value["playerId"],
    token: value["token"],
    expiresAt: value["expiresAt"],
    createdAt: value["createdAt"],
  });
}

function parseInviteEnvelope(value: unknown): PartyInvite {
  if (!isRecord(value)) {
    throw new FlareLobbyError("INVALID_MESSAGE");
  }

  return parsePartyInvite(value["invite"]);
}

function parsePartyEvent(value: JsonValue): PartyEvent | null {
  if (
    !isRecord(value) ||
    !isFiniteNonNegativeNumber(value["sequence"]) ||
    !isFiniteNonNegativeNumber(value["partyRevision"]) ||
    !isPartyEventType(value["type"]) ||
    !isTimestamp(value["occurredAt"])
  ) {
    return null;
  }

  try {
    const snapshot = parsePartySnapshot(value["snapshot"]);
    if (snapshot.revision !== value["partyRevision"]) {
      return null;
    }

    return deepFreeze({
      sequence: value["sequence"],
      partyRevision: value["partyRevision"],
      type: value["type"],
      snapshot,
      occurredAt: value["occurredAt"],
    });
  } catch {
    return null;
  }
}

const PARTY_EVENT_TYPES: readonly PartyEventType[] = [
  "created",
  "member_joined",
  "member_left",
  "leader_transferred",
  "invite_created",
  "queue_started",
  "queue_ended",
  "dissolved",
];

function isPartyEventType(value: unknown): value is PartyEventType {
  return (
    typeof value === "string" &&
    PARTY_EVENT_TYPES.some((type) => type === value)
  );
}

function isTerminalQueueStatus(
  status: MatchmakingTicketSnapshot["status"],
): boolean {
  return status === "matched" || status === "cancelled" || status === "expired";
}

function isRetryableReconnectError(code: FlareLobbyErrorCode): boolean {
  return code === "CONNECTION_FAILED" || code === "CANCELLED";
}

function isCancelledError(error: unknown): boolean {
  return error instanceof FlareLobbyError && error.code === "CANCELLED";
}

function normalizeClientError(error: unknown): FlareLobbyError {
  return error instanceof FlareLobbyError
    ? error
    : new FlareLobbyError("CONNECTION_FAILED");
}

function assertPartyId(partyId: string): void {
  if (!isNonEmptyString(partyId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
}

function requestSignalOptions(signal: AbortSignal | undefined): {
  readonly signal?: AbortSignal;
} {
  return signal === undefined ? {} : { signal };
}

function createRequestId(factory: () => RequestId): RequestId {
  try {
    const requestId = factory();
    if (!isNonEmptyString(requestId)) {
      throw new Error("invalid request id");
    }
    return requestId;
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new FlareLobbyError("CANCELLED");
  }
}

function compactJsonObject(
  values: Readonly<Record<string, JsonValue | undefined>>,
): JsonValue {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function deepFreeze<TValue>(
  value: TValue,
  seen = new WeakSet<object>(),
): TValue {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isTimestamp(value: unknown): value is Timestamp {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}
