import { FlareLobbyError, getMatchmakingSearchWidth } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  FlareLobbyApp,
  FlareLobbyErrorCode,
  JsonObject,
  JsonValue,
  MatchmakingPool,
  MatchmakingTicket as CoreMatchmakingTicket,
  MatchmakingTicketStatus,
  Rating,
  RequestId,
  ServerEventEnvelope,
  Timestamp,
} from "@flarelobby/core";

import type {
  ClientRequestOptions,
  ClientWebSocketOptions,
  FlareLobbyWebSocketConnection,
} from "./client.js";
import {
  createRoomHandle,
  type CustomRoomTransport,
  type PlayerRoom,
  type RoomConnectionResult,
  type RoomReconnectOptions,
} from "./custom-room.js";

const MATCHMAKING_EVENT = "matchmaking.ticket";
const DEFAULT_MATCHMAKING_EVENT_PATH = "/v1/matchmaking";
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.2;

/** `joinMatchmaking()` と `findMatch()` で指定できる Pool の参照です。 */
export type MatchmakingPoolReference = MatchmakingPool | string;

/** マッチング参加時の公開オプションです。 */
export interface MatchmakingJoinOptions {
  readonly requestId?: RequestId;
  /** 省略時はサーバー側の設定済みレーティングを使用します。 */
  readonly rating?: number | Pick<Rating, "value">;
  readonly region?: string;
  readonly inputMethod?: string;
  /** `inputMethod` の説明的な別名です。 */
  readonly inputMode?: string;
  readonly searchAttributes?: JsonObject;
  readonly expiresAt?: number | Timestamp;
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
  readonly reconnect?: RoomReconnectOptions;
}

/** マッチングチケットを再取得するときのオプションです。 */
export interface MatchmakingTicketRequestOptions {
  readonly signal?: AbortSignal;
}

/** チケット取消時の公開オプションです。 */
export interface MatchmakingTicketCancelOptions extends MatchmakingTicketRequestOptions {
  readonly requestId?: RequestId;
}

/** `waitForMatch()` の公開オプションです。 */
export interface MatchmakingWaitForMatchOptions extends MatchmakingTicketRequestOptions {}

/** Client SDK が公開する、サーバー保存値を含むチケット状態です。 */
export type MatchmakingTicketSnapshot<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> = CoreMatchmakingTicket<TApp> & {
  /** チケット作成時に保存したリージョンです。 */
  readonly region: string;
  /** チケット作成時に保存した入力方式です。 */
  readonly inputMethod: string;
  readonly searchAttributes: JsonObject;
  readonly expiresAt: Timestamp;
};

/** 成立済みチケットが保持する対戦結果です。 */
export type MatchmakingResult<TApp extends AnyFlareLobbyApp = FlareLobbyApp> =
  Extract<
    MatchmakingTicketSnapshot<TApp>,
    { readonly status: "matched" }
  > extends {
    readonly result: infer TResult;
  }
    ? TResult
    : never;

/** 進捗イベントで通知する現在値です。 */
export interface MatchmakingProgress<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly ticket: MatchmakingTicketSnapshot<TApp>;
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly waitingTimeMs: number;
  /** 現在のレーティング検索幅です。 */
  readonly searchWidth: number;
  /** `searchWidth` の説明的な別名です。 */
  readonly searchRange: number;
  readonly sequence: number;
  readonly occurredAt: Timestamp;
}

/** 進捗イベントの購読者です。 */
export type MatchmakingProgressListener<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> = (progress: MatchmakingProgress<TApp>) => void;

/** チケットのイベント接続状態です。 */
export type MatchmakingTicketConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/** チケット接続状態の購読者です。 */
export type MatchmakingTicketConnectionStatusListener = (
  status: MatchmakingTicketConnectionStatus,
) => void;

/**
 * マッチング待機を表す Client SDK のチケットハンドルです。
 *
 * `snapshot` はサーバーから確認できた最新状態であり、`status`、待機時間、
 * 検索幅はそのスナップショットから計算した読み取り専用のショートカットです。
 */
export interface MatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly id: string;
  readonly pool: MatchmakingPool;
  readonly status: MatchmakingTicketStatus;
  readonly state: MatchmakingTicketStatus;
  readonly snapshot: MatchmakingTicketSnapshot<TApp>;
  readonly ticket: MatchmakingTicketSnapshot<TApp>;
  readonly waitingTimeMs: number;
  readonly searchWidth: number;
  readonly searchRange: number;
  readonly connectionStatus: MatchmakingTicketConnectionStatus;
  readonly result: MatchmakingResult<TApp> | undefined;
  on(
    eventName: "progress",
    listener: MatchmakingProgressListener<TApp>,
  ): () => void;
  onStatusChange(
    listener: MatchmakingTicketConnectionStatusListener,
  ): () => void;
  refresh(
    options?: MatchmakingTicketRequestOptions,
  ): Promise<MatchmakingTicketSnapshot<TApp>>;
  cancel(
    options?: MatchmakingTicketCancelOptions,
  ): Promise<MatchmakingTicketSnapshot<TApp>>;
  waitForMatch(
    options?: MatchmakingWaitForMatchOptions,
  ): Promise<PlayerRoom<TApp>>;
}

export interface MatchmakingClientApi<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  joinMatchmaking(
    pool: MatchmakingPoolReference,
    options?: MatchmakingJoinOptions,
  ): Promise<MatchmakingTicket<TApp>>;
  findMatch(
    pool: MatchmakingPoolReference,
    options?: MatchmakingJoinOptions,
  ): Promise<PlayerRoom<TApp>>;
  getRating(
    pool: MatchmakingPoolReference,
    options?: MatchmakingTicketRequestOptions,
  ): Promise<Rating>;
  dispose(): void;
}

interface MatchmakingTransport<
  TApp extends AnyFlareLobbyApp,
> extends CustomRoomTransport<TApp> {
  readonly requestIdFactory: () => RequestId;
}

interface MatchmakingTicketEventPayload<TApp extends AnyFlareLobbyApp> {
  readonly ticket: MatchmakingTicketSnapshot<TApp>;
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly sequence: number;
  readonly occurredAt: Timestamp;
  readonly searchWidth?: number;
  readonly connection?: MatchRoomConnection<TApp>;
}

interface MatchRoomConnection<TApp extends AnyFlareLobbyApp> {
  readonly roomId: string;
  readonly participantId: string;
  readonly role: "player";
  readonly joinToken: string;
  readonly websocketUrl: string;
  readonly snapshot: RoomConnectionResult<TApp>["snapshot"];
}

interface ParsedTicketEnvelope<TApp extends AnyFlareLobbyApp> {
  readonly ticket: MatchmakingTicketSnapshot<TApp>;
  readonly connection?: MatchRoomConnection<TApp>;
}

interface TicketWaiter<TApp extends AnyFlareLobbyApp> {
  readonly resolve: (room: PlayerRoom<TApp>) => void;
  readonly reject: (error: FlareLobbyError) => void;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
  aborted: boolean;
}

interface NormalizedReconnectOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

/** クライアント本体からマッチング API を組み立てます。 */
export function createMatchmakingApi<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(transport: MatchmakingTransport<TApp>): MatchmakingClientApi<TApp> {
  const tickets = new Set<MatchmakingTicketImpl<TApp>>();

  return {
    joinMatchmaking: async (pool, options = {}) => {
      const ticket = await joinMatchmaking<TApp>(transport, pool, options);
      tickets.add(ticket);
      return ticket;
    },
    findMatch: async (pool, options = {}) => {
      const ticket = await joinMatchmaking<TApp>(transport, pool, options);
      tickets.add(ticket);
      return ticket.waitForMatch(
        options.signal === undefined
          ? {}
          : {
              signal: options.signal,
            },
      );
    },
    getRating: (pool, options = {}) => getRating(transport, pool, options),
    dispose: () => {
      for (const ticket of tickets) {
        ticket.dispose();
      }
      tickets.clear();
    },
  };
}

async function joinMatchmaking<TApp extends AnyFlareLobbyApp>(
  transport: MatchmakingTransport<TApp>,
  poolReference: MatchmakingPoolReference,
  options: MatchmakingJoinOptions,
): Promise<MatchmakingTicketImpl<TApp>> {
  throwIfAborted(options.signal);
  const pool = normalizePoolReference(poolReference);
  const poolId = typeof pool === "string" ? pool : pool.id;
  const requestId =
    options.requestId ?? createRequestId(transport.requestIdFactory);
  const path = createPoolPath(poolId, "/tickets");
  const body = compactJsonObject({
    requestId,
    pool: typeof pool === "string" ? undefined : (pool as unknown as JsonValue),
    rating: toJsonValue(options.rating),
    region: options.region,
    inputMethod: options.inputMethod,
    inputMode: options.inputMode,
    searchAttributes: options.searchAttributes,
    expiresAt: options.expiresAt,
    ttlMs: options.ttlMs,
  });

  let response: unknown;
  try {
    response = await transport.request<unknown>(path, {
      method: "POST",
      body,
      requestId,
      ...requestSignalOptions(options.signal),
    });
  } catch (error) {
    if (!isCancelledError(error) || options.signal?.aborted !== true) {
      throw normalizeClientError(error);
    }

    // HTTP request が送信後に中止された場合でも、同じ requestId で結果を
    // 再取得してからサーバー側キャンセルへ進めます。これにより AbortSignal
    // がローカルだけでなく、既に作成されたチケットへ反映されます。
    try {
      response = await transport.request<unknown>(path, {
        method: "POST",
        body,
        requestId,
      });
    } catch {
      throw new FlareLobbyError("CANCELLED");
    }
  }

  const parsed = parseTicketEnvelope<TApp>(response);
  const ticket = new MatchmakingTicketImpl(
    transport,
    parsed.ticket,
    poolId,
    parsed.connection,
    options.reconnect,
  );

  try {
    await ticket.start(options.signal);
    throwIfAborted(options.signal);
    return ticket;
  } catch (error) {
    if (options.signal?.aborted === true) {
      await ticket.cancel().catch(() => undefined);
      ticket.dispose();
      throw new FlareLobbyError("CANCELLED");
    }

    ticket.dispose();
    throw normalizeClientError(error);
  }
}

async function getRating<TApp extends AnyFlareLobbyApp>(
  transport: MatchmakingTransport<TApp>,
  poolReference: MatchmakingPoolReference,
  options: MatchmakingTicketRequestOptions,
): Promise<Rating> {
  const pool = normalizePoolReference(poolReference);
  const poolId = typeof pool === "string" ? pool : pool.id;
  const raw = await transport.request<unknown>(
    createPoolPath(poolId, "/rating"),
    requestSignalOptions(options.signal),
  );
  const value = isRecord(raw) && isRecord(raw["rating"]) ? raw["rating"] : raw;

  if (
    !isRecord(value) ||
    !isNonEmptyString(value["playerId"]) ||
    !isNonEmptyString(value["poolId"]) ||
    value["poolId"] !== poolId ||
    !isFiniteNonNegativeNumber(value["value"])
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return deepFreeze({
    playerId: value["playerId"],
    poolId: value["poolId"],
    value: value["value"],
  });
}

class MatchmakingTicketImpl<
  TApp extends AnyFlareLobbyApp,
> implements MatchmakingTicket<TApp> {
  private snapshotState: MatchmakingTicketSnapshot<TApp>;
  private readonly poolId: string;
  private readonly transport: MatchmakingTransport<TApp>;
  private readonly reconnectOptions: NormalizedReconnectOptions;
  private readonly roomReconnectOptions: RoomReconnectOptions | undefined;
  private readonly progressListeners = new Set<
    MatchmakingProgressListener<TApp>
  >();
  private readonly statusListeners =
    new Set<MatchmakingTicketConnectionStatusListener>();
  private readonly waiters = new Set<TicketWaiter<TApp>>();
  private connection: FlareLobbyWebSocketConnection<TApp> | undefined;
  private unsubscribeConnectionEvents: () => void = (): void => undefined;
  private unsubscribeConnectionClose: () => void = (): void => undefined;
  private connectionStatusState: MatchmakingTicketConnectionStatus =
    "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private lastSequence = 0;
  private queuedAtMs: number | undefined;
  private searchWidthState: number;
  private inlineConnection: MatchRoomConnection<TApp> | undefined;
  private roomPromise: Promise<PlayerRoom<TApp>> | undefined;
  private cancelPromise: Promise<MatchmakingTicketSnapshot<TApp>> | undefined;
  private stopped = false;
  private terminalProgressStatus: MatchmakingTicketStatus | undefined;

  public constructor(
    transport: MatchmakingTransport<TApp>,
    snapshot: MatchmakingTicketSnapshot<TApp>,
    poolId: string,
    connection: MatchRoomConnection<TApp> | undefined,
    reconnectOptions: RoomReconnectOptions | undefined,
  ) {
    this.transport = transport;
    this.snapshotState = snapshot;
    this.poolId = poolId;
    this.inlineConnection = connection;
    this.roomReconnectOptions = reconnectOptions;
    this.reconnectOptions = normalizeReconnectOptions(reconnectOptions);
    this.queuedAtMs = getQueuedAtMs(snapshot);
    this.searchWidthState = getCurrentSearchWidth(snapshot, this.queuedAtMs);
  }

  public get id(): string {
    return this.snapshotState.id;
  }

  public get pool(): MatchmakingPool {
    return this.snapshotState.pool;
  }

  public get status(): MatchmakingTicketStatus {
    return this.snapshotState.status;
  }

  public get state(): MatchmakingTicketStatus {
    return this.status;
  }

  public get snapshot(): MatchmakingTicketSnapshot<TApp> {
    return this.snapshotState;
  }

  public get ticket(): MatchmakingTicketSnapshot<TApp> {
    return this.snapshotState;
  }

  public get waitingTimeMs(): number {
    if (this.queuedAtMs === undefined) {
      return 0;
    }

    const end = isTerminalStatus(this.status)
      ? getTerminalAtMs(this.snapshotState)
      : Date.now();
    return Math.max(0, end - this.queuedAtMs);
  }

  public get searchWidth(): number {
    return this.searchWidthState;
  }

  public get searchRange(): number {
    return this.searchWidth;
  }

  public get connectionStatus(): MatchmakingTicketConnectionStatus {
    return this.connectionStatusState;
  }

  public get result(): MatchmakingResult<TApp> | undefined {
    return this.status === "matched"
      ? (
          this.snapshotState as Extract<
            MatchmakingTicketSnapshot<TApp>,
            { readonly status: "matched" }
          >
        ).result
      : undefined;
  }

  public on(
    eventName: "progress",
    listener: MatchmakingProgressListener<TApp>,
  ): () => void {
    if (eventName !== "progress" || typeof listener !== "function") {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    this.progressListeners.add(listener);
    return (): void => {
      this.progressListeners.delete(listener);
    };
  }

  public onStatusChange(
    listener: MatchmakingTicketConnectionStatusListener,
  ): () => void {
    if (typeof listener !== "function") {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    this.statusListeners.add(listener);
    return (): void => {
      this.statusListeners.delete(listener);
    };
  }

  public async start(signal?: AbortSignal): Promise<void> {
    if (this.stopped || isTerminalStatus(this.status)) {
      return;
    }

    await this.connect(signal);
  }

  public async refresh(
    options: MatchmakingTicketRequestOptions = {},
  ): Promise<MatchmakingTicketSnapshot<TApp>> {
    throwIfAborted(options.signal);
    const raw = await this.transport.request<unknown>(
      createTicketPath(this.poolId, this.id),
      requestSignalOptions(options.signal),
    );
    const parsed = parseTicketEnvelope<TApp>(raw);
    this.inlineConnection = parsed.connection ?? this.inlineConnection;
    this.applyTicket(parsed.ticket, this.lastSequence, undefined);
    return this.snapshotState;
  }

  public cancel(
    options: MatchmakingTicketCancelOptions = {},
  ): Promise<MatchmakingTicketSnapshot<TApp>> {
    if (this.cancelPromise !== undefined) {
      return this.cancelPromise;
    }

    const requestId =
      options.requestId ?? createRequestId(this.transport.requestIdFactory);
    const request = this.transport.request<unknown>(
      `${createTicketPath(this.poolId, this.id)}/cancel`,
      {
        method: "POST",
        body: {
          requestId,
          ticketId: this.id,
        },
        requestId,
        ...requestSignalOptions(options.signal),
      },
    );

    this.cancelPromise = request
      .then((raw) => {
        const parsed = parseTicketEnvelope<TApp>(raw);
        this.inlineConnection = parsed.connection ?? this.inlineConnection;
        this.applyTicket(parsed.ticket, this.lastSequence, undefined);
        return this.snapshotState;
      })
      .catch((error) => {
        throw normalizeClientError(error);
      })
      .finally(() => {
        this.cancelPromise = undefined;
      });

    return this.cancelPromise;
  }

  public waitForMatch(
    options: MatchmakingWaitForMatchOptions = {},
  ): Promise<PlayerRoom<TApp>> {
    if (options.signal?.aborted === true) {
      return this.cancelForAbort(options.signal);
    }

    if (this.status === "matched") {
      return this.ensureMatchRoom(options.signal);
    }

    if (this.status === "cancelled" || this.status === "expired") {
      return Promise.reject(new FlareLobbyError("CONFLICT"));
    }

    return new Promise<PlayerRoom<TApp>>((resolve, reject) => {
      const waiter: TicketWaiter<TApp> = {
        resolve,
        reject,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        aborted: false,
      };
      const onAbort = (): void => {
        if (waiter.aborted) {
          return;
        }

        waiter.aborted = true;
        this.removeWaiter(waiter);
        void this.cancelIfNoWaiters()
          .catch(() => undefined)
          .finally(() => {
            reject(new FlareLobbyError("CANCELLED"));
          });
      };
      waiter.abortListener = onAbort;
      this.waiters.add(waiter);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      if (this.status === "matched") {
        void this.resolveWaiters();
      } else if (isTerminalStatus(this.status)) {
        this.rejectWaitersForTerminal();
      }
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
    this.rejectWaiters(new FlareLobbyError("CANCELLED"));
    this.progressListeners.clear();
    this.statusListeners.clear();
  }

  private async connect(signal?: AbortSignal): Promise<void> {
    this.setConnectionStatus("connecting");
    const connection = await this.transport.connect(
      this.createEventPath(),
      this.eventConnectionOptions(signal),
    );

    if (this.stopped) {
      connection.close(1000, "ticket closed");
      return;
    }

    this.attachConnection(connection);
    this.reconnectAttempt = 0;
    this.setConnectionStatus("connected");
  }

  private eventConnectionOptions(signal?: AbortSignal): ClientWebSocketOptions {
    return {
      knownEventTypes: [MATCHMAKING_EVENT],
      ...(signal === undefined ? {} : { signal }),
    };
  }

  private createEventPath(): string {
    const after = this.lastSequence > 0 ? `?after=${this.lastSequence}` : "";
    return `${createTicketPath(this.poolId, this.id)}/events/ws${after}`;
  }

  private attachConnection(
    connection: FlareLobbyWebSocketConnection<TApp>,
  ): void {
    this.unsubscribeConnectionEvents();
    this.unsubscribeConnectionClose();
    this.connection = connection;
    this.unsubscribeConnectionEvents = connection.onEvent((event) => {
      this.handleEvent(event);
    });
    this.unsubscribeConnectionClose = connection.onClose((error) => {
      this.handleConnectionClosed(connection, error);
    });
  }

  private handleEvent(event: ServerEventEnvelope): void {
    if (event.event !== MATCHMAKING_EVENT) {
      return;
    }

    const parsed = parseTicketEventPayload<TApp>(event.payload);
    if (parsed === null || parsed.ticket.id !== this.id) {
      this.requestResync();
      return;
    }

    if (parsed.sequence <= this.lastSequence) {
      return;
    }

    // `sequence` は Pool 全体で採番されるため、他チケットのイベントによる
    // 数値の飛びは正常です。最後に適用した値より新しいイベントだけを受け付け、
    // 再接続時はその値を `after` へ渡して同じチケットの履歴を再取得します。
    this.lastSequence = parsed.sequence;
    this.inlineConnection = parsed.connection ?? this.inlineConnection;
    this.applyTicket(parsed.ticket, parsed.sequence, parsed);
  }

  private applyTicket(
    ticket: MatchmakingTicketSnapshot<TApp>,
    sequence: number,
    event: MatchmakingTicketEventPayload<TApp> | undefined,
  ): void {
    if (ticket.id !== this.id || ticket.pool.id !== this.poolId) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const currentRank = ticketStatusRank(this.status);
    const nextRank = ticketStatusRank(ticket.status);
    this.queuedAtMs = this.queuedAtMs ?? getQueuedAtMs(ticket);

    if (this.terminalProgressStatus !== undefined) {
      return;
    }

    // createTicket() が waiting/matched を返した後に、WebSocket が保持していた
    // 古い creating/waiting イベントを受け取っても公開状態を巻き戻しません。
    if (nextRank < currentRank) {
      return;
    }

    const shouldNotifySyntheticTerminal =
      event === undefined &&
      isTerminalStatus(ticket.status) &&
      this.terminalProgressStatus === undefined;

    if (isTerminalStatus(ticket.status)) {
      // 端末イベントを購読者へ渡す前に固定し、購読者からの再入呼び出しでも
      // 同じ終端状態を二重通知しないようにします。
      this.terminalProgressStatus = ticket.status;
    }

    this.snapshotState = ticket;
    if (
      event?.searchWidth !== undefined &&
      isFiniteNonNegativeNumber(event.searchWidth)
    ) {
      this.searchWidthState = event.searchWidth;
    } else {
      this.searchWidthState = getCurrentSearchWidth(ticket, this.queuedAtMs);
    }

    if (event !== undefined) {
      this.notifyProgress(event, sequence);
    } else if (shouldNotifySyntheticTerminal) {
      const terminalSequence = Math.max(1, this.lastSequence + 1);
      this.notifyProgress(
        {
          ticket,
          waitingCount: 0,
          activeCount: 0,
          sequence: terminalSequence,
          occurredAt: new Date(getTerminalAtMs(ticket)).toISOString(),
        },
        terminalSequence,
      );
    }

    if (isTerminalStatus(ticket.status)) {
      this.handleTerminalState(ticket.status);
    }
  }

  private notifyProgress(
    event: MatchmakingTicketEventPayload<TApp>,
    sequence: number,
  ): void {
    const waitingTimeMs = this.waitingTimeMs;
    const progress = deepFreeze({
      ticket: this.snapshotState,
      waitingCount: event.waitingCount,
      activeCount: event.activeCount,
      waitingTimeMs,
      searchWidth: this.searchWidthState,
      searchRange: this.searchWidthState,
      sequence,
      occurredAt: event.occurredAt,
    });

    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch {
        // 進捗購読者の例外でチケット状態を壊しません。
      }
    }
  }

  private handleTerminalState(status: MatchmakingTicketStatus): void {
    if (this.terminalProgressStatus === undefined) {
      this.terminalProgressStatus = status;
    }

    this.stopConnection();
    if (status === "matched") {
      void this.resolveWaiters();
    } else {
      this.rejectWaitersForTerminal();
    }
  }

  private async resolveWaiters(): Promise<void> {
    if (this.status !== "matched" || this.waiters.size === 0) {
      return;
    }

    try {
      const room = await this.ensureMatchRoom();
      const waiters = [...this.waiters];
      for (const waiter of waiters) {
        this.removeWaiter(waiter);
        if (!waiter.aborted) {
          waiter.resolve(room);
        }
      }
    } catch (error) {
      const normalized = normalizeClientError(error);
      this.rejectWaiters(normalized);
    }
  }

  private ensureMatchRoom(signal?: AbortSignal): Promise<PlayerRoom<TApp>> {
    if (this.roomPromise !== undefined) {
      return this.roomPromise;
    }

    if (this.status !== "matched") {
      return Promise.reject(new FlareLobbyError("CONFLICT"));
    }

    this.roomPromise = this.loadMatchRoomConnection(signal)
      .then((connection) =>
        createRoomHandle(
          this.transport,
          connection,
          "player",
          signal,
          this.roomReconnectOptions,
        ),
      )
      .then((room) => room as PlayerRoom<TApp>)
      .catch((error) => {
        this.roomPromise = undefined;
        throw normalizeClientError(error);
      });

    return this.roomPromise;
  }

  private async loadMatchRoomConnection(
    signal?: AbortSignal,
  ): Promise<RoomConnectionResult<TApp>> {
    const inline = this.inlineConnection;
    if (inline !== undefined) {
      return inline;
    }

    const raw = await this.transport.request<unknown>(
      `${createTicketPath(this.poolId, this.id)}/connection`,
      requestSignalOptions(signal),
    );
    const parsed = parseTicketEnvelope<TApp>(raw);
    this.inlineConnection = parsed.connection;

    if (parsed.connection === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return parsed.connection;
  }

  private cancelForAbort(signal: AbortSignal): Promise<PlayerRoom<TApp>> {
    return this.cancelIfNoWaiters(true)
      .then(() => {
        throw new FlareLobbyError("CANCELLED");
      })
      .catch((error) => {
        if (signal.aborted) {
          throw new FlareLobbyError("CANCELLED");
        }
        throw error;
      });
  }

  private async cancelIfNoWaiters(force = false): Promise<void> {
    if (!force && this.waiters.size > 0) {
      return;
    }

    if (this.status === "creating" || this.status === "waiting") {
      await this.cancel();
    }
  }

  private removeWaiter(waiter: TicketWaiter<TApp>): void {
    this.waiters.delete(waiter);
    if (waiter.signal !== undefined && waiter.abortListener !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.abortListener);
    }
  }

  private rejectWaitersForTerminal(): void {
    this.rejectWaiters(
      this.status === "cancelled"
        ? new FlareLobbyError("CANCELLED")
        : new FlareLobbyError("CONFLICT"),
    );
  }

  private rejectWaiters(error: FlareLobbyError): void {
    const waiters = [...this.waiters];
    for (const waiter of waiters) {
      this.removeWaiter(waiter);
      if (!waiter.aborted) {
        waiter.reject(error);
      }
    }
  }

  private handleConnectionClosed(
    connection: FlareLobbyWebSocketConnection<TApp>,
    error: FlareLobbyError,
  ): void {
    if (
      this.stopped ||
      connection !== this.connection ||
      isTerminalStatus(this.status)
    ) {
      return;
    }

    this.setConnectionStatus("disconnected");
    if (!isRetryableReconnectError(error.code)) {
      return;
    }

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
    if (this.stopped || isTerminalStatus(this.status)) {
      return;
    }

    this.reconnectAttempt += 1;
    try {
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
        this.handleConnectionClosed(
          this.connection as FlareLobbyWebSocketConnection<TApp>,
          new FlareLobbyError("CONNECTION_FAILED"),
        );
      } else {
        this.setConnectionStatus("disconnected");
      }
    }
  }

  private requestResync(): void {
    if (this.stopped || isTerminalStatus(this.status)) {
      return;
    }

    this.connection?.close(1000, "ticket resync");
  }

  private stopConnection(): void {
    this.unsubscribeConnectionEvents();
    this.unsubscribeConnectionClose();
    this.connection?.close(1000, "ticket settled");
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

  private setConnectionStatus(status: MatchmakingTicketConnectionStatus): void {
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

function createPoolPath(poolId: string, suffix: string): string {
  return `${DEFAULT_MATCHMAKING_EVENT_PATH}/pools/${encodeURIComponent(poolId)}${suffix}`;
}

function createTicketPath(poolId: string, ticketId: string): string {
  return `${createPoolPath(poolId, "/tickets")}/${encodeURIComponent(ticketId)}`;
}

function normalizePoolReference(
  value: MatchmakingPoolReference,
): MatchmakingPool | string {
  if (typeof value === "string") {
    if (!isNonEmptyString(value)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    return value;
  }

  if (
    !isRecord(value) ||
    !isNonEmptyString(value["id"]) ||
    !isNonEmptyString(value["gameId"]) ||
    !isNonEmptyString(value["seasonId"]) ||
    !isNonEmptyString(value["mode"]) ||
    !isNonEmptyString(value["region"])
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return deepFreeze({
    id: value["id"],
    gameId: value["gameId"],
    seasonId: value["seasonId"],
    mode: value["mode"],
    region: value["region"],
  });
}

function parseTicketEnvelope<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): ParsedTicketEnvelope<TApp> {
  if (!isRecord(value)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  const rawTicket = Object.hasOwn(value, "ticket") ? value["ticket"] : value;
  const ticket = parseTicket<TApp>(rawTicket);
  const connectionValue =
    isRecord(value) && Object.hasOwn(value, "connection")
      ? value["connection"]
      : isRecord(rawTicket) &&
          isRecord(rawTicket["result"]) &&
          Object.hasOwn(rawTicket["result"], "connection")
        ? rawTicket["result"]["connection"]
        : undefined;
  const connection =
    connectionValue === undefined
      ? parseRoomConnection<TApp>(value)
      : parseRoomConnection<TApp>(connectionValue);

  return {
    ticket,
    ...(connection === undefined ? {} : { connection }),
  };
}

function parseTicketEventPayload<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): MatchmakingTicketEventPayload<TApp> | null {
  if (!isRecord(value)) {
    return null;
  }

  const ticket = parseTicketSafely<TApp>(value["ticket"]);
  const waitingCount = value["waitingCount"];
  const activeCount = value["activeCount"];
  const sequence = value["sequence"];
  const occurredAt = value["occurredAt"];

  if (
    ticket === null ||
    !isNonNegativeSafeInteger(waitingCount) ||
    !isNonNegativeSafeInteger(activeCount) ||
    !isPositiveSafeInteger(sequence) ||
    !isNonEmptyString(occurredAt)
  ) {
    return null;
  }

  const connection = parseRoomConnection<TApp>(value["connection"]);
  const searchWidth = value["searchWidth"];
  return {
    ticket,
    waitingCount,
    activeCount,
    sequence,
    occurredAt,
    ...(isFiniteNonNegativeNumber(searchWidth) ? { searchWidth } : {}),
    ...(connection === undefined ? {} : { connection }),
  };
}

function parseTicket<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): MatchmakingTicketSnapshot<TApp> {
  const parsed = parseTicketSafely<TApp>(value);
  if (parsed === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
  return parsed;
}

function parseTicketSafely<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): MatchmakingTicketSnapshot<TApp> | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["id"]) ||
    !isMatchmakingTicketStatus(value["status"]) ||
    !isRecord(value["pool"]) ||
    !isNonEmptyString(value["pool"]["id"]) ||
    !isNonEmptyString(value["pool"]["gameId"]) ||
    !isNonEmptyString(value["pool"]["seasonId"]) ||
    !isNonEmptyString(value["pool"]["mode"]) ||
    !isNonEmptyString(value["pool"]["region"]) ||
    !isRecord(value["player"]) ||
    !isNonEmptyString(value["player"]["id"]) ||
    !isRecord(value["rating"]) ||
    !isNonEmptyString(value["rating"]["playerId"]) ||
    !isNonEmptyString(value["rating"]["poolId"]) ||
    !isFiniteNumber(value["rating"]["value"]) ||
    !isNonEmptyString(value["createdAt"]) ||
    !isNonEmptyString(value["region"]) ||
    !isNonEmptyString(value["inputMethod"]) ||
    !isRecord(value["searchAttributes"]) ||
    !isNonEmptyString(value["expiresAt"])
  ) {
    return null;
  }

  if (
    value["rating"]["playerId"] !== value["player"]["id"] ||
    value["rating"]["poolId"] !== value["pool"]["id"]
  ) {
    return null;
  }

  if (value["status"] === "waiting" && !isNonEmptyString(value["queuedAt"])) {
    return null;
  }

  return deepFreeze(value as unknown as MatchmakingTicketSnapshot<TApp>);
}

function parseRoomConnection<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): MatchRoomConnection<TApp> | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["participantId"]) ||
    !isNonEmptyString(value["joinToken"]) ||
    !isNonEmptyString(value["websocketUrl"]) ||
    !isRoomSnapshot(value["snapshot"])
  ) {
    return undefined;
  }

  return {
    roomId: value["roomId"],
    participantId: value["participantId"],
    role: "player",
    joinToken: value["joinToken"],
    websocketUrl: value["websocketUrl"],
    snapshot: value["snapshot"] as RoomConnectionResult<TApp>["snapshot"],
  };
}

function getQueuedAtMs<TApp extends AnyFlareLobbyApp>(
  ticket: MatchmakingTicketSnapshot<TApp>,
): number | undefined {
  if (ticket.status === "waiting" && isNonEmptyString(ticket.queuedAt)) {
    const value = Date.parse(ticket.queuedAt);
    return Number.isFinite(value) ? value : undefined;
  }

  const value = Date.parse(ticket.createdAt);
  return Number.isFinite(value) ? value : undefined;
}

function getTerminalAtMs<TApp extends AnyFlareLobbyApp>(
  ticket: MatchmakingTicketSnapshot<TApp>,
): number {
  const value =
    ticket.status === "matched"
      ? Date.parse(ticket.matchedAt)
      : ticket.status === "cancelled"
        ? Date.parse(ticket.cancelledAt)
        : ticket.status === "expired"
          ? Date.parse(ticket.expiredAt)
          : Date.parse(ticket.createdAt);
  return Number.isFinite(value) ? value : Date.now();
}

function getCurrentSearchWidth<TApp extends AnyFlareLobbyApp>(
  ticket: MatchmakingTicketSnapshot<TApp>,
  queuedAtMs: number | undefined,
): number {
  if (queuedAtMs === undefined) {
    return 0;
  }
  return getMatchmakingSearchWidth(
    undefined,
    Math.max(0, Date.now() - queuedAtMs),
  );
}

function normalizeReconnectOptions(
  options: RoomReconnectOptions | undefined,
): NormalizedReconnectOptions {
  const maxAttempts = normalizeReconnectInteger(
    options?.maxAttempts,
    DEFAULT_RECONNECT_MAX_ATTEMPTS,
    0,
  );
  const baseDelayMs = normalizeReconnectInteger(
    options?.baseDelayMs,
    DEFAULT_RECONNECT_BASE_DELAY_MS,
    0,
  );
  const maxDelayMs = normalizeReconnectInteger(
    options?.maxDelayMs,
    Math.max(DEFAULT_RECONNECT_MAX_DELAY_MS, baseDelayMs),
    baseDelayMs,
  );
  const jitterRatio = options?.jitterRatio ?? DEFAULT_RECONNECT_JITTER_RATIO;

  if (!isFiniteNumber(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return { maxAttempts, baseDelayMs, maxDelayMs, jitterRatio };
}

function normalizeReconnectInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < minimum ||
    normalized > 2 ** 31 - 1
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return normalized;
}

function ticketStatusRank(status: MatchmakingTicketStatus): number {
  switch (status) {
    case "creating":
      return 0;
    case "waiting":
      return 1;
    case "reserved":
      return 2;
    case "matched":
    case "cancelled":
    case "expired":
      return 3;
  }
}

function isTerminalStatus(status: MatchmakingTicketStatus): boolean {
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

function requestSignalOptions(
  signal: AbortSignal | undefined,
): ClientRequestOptions {
  return signal === undefined ? {} : { signal };
}

function createRequestId(factory: () => RequestId): RequestId {
  try {
    const value = factory();
    if (!isNonEmptyString(value)) {
      throw new Error("invalid request id");
    }
    return value;
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new FlareLobbyError("CANCELLED");
  }
}

function compactJsonObject(
  values: Readonly<Record<string, JsonValue | undefined>>,
): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isMatchmakingTicketStatus(
  value: unknown,
): value is MatchmakingTicketStatus {
  return (
    value === "creating" ||
    value === "waiting" ||
    value === "reserved" ||
    value === "matched" ||
    value === "cancelled" ||
    value === "expired"
  );
}

function isRoomSnapshot(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value["room"]) ||
    !isRecord(value["state"])
  ) {
    return false;
  }

  return (
    isNonNegativeSafeInteger(value["revision"]) &&
    Array.isArray(value["participants"]) &&
    Array.isArray(value["teams"]) &&
    isNonEmptyString(value["room"]["id"]) &&
    (value["room"]["kind"] === "custom" || value["room"]["kind"] === "match") &&
    isNonEmptyString(value["state"]["status"])
  );
}

function deepFreeze<TValue>(
  value: TValue,
  seen = new WeakSet<object>(),
): TValue {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  Object.freeze(value);
  return value;
}
