import {
  decodeServerMessage,
  encodeProtocolMessage,
  FlareLobbyError,
  isFlareLobbyErrorCode,
  PROTOCOL_VERSION,
} from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  ClientCommandEnvelope,
  FlareLobbyErrorCode,
  FlareLobbyApp,
  FlareLobbyErrorPayload,
  JsonValue,
  ProtocolEventType,
  Revision,
  RequestId,
  ServerEventEnvelope,
  ServerMessage,
} from "@flarelobby/core";
import { createCustomRoomApi } from "./custom-room.js";
import type {
  CustomRoomClientApi,
  CustomRoomCreationOptions,
  CustomRoomJoinOptions,
  CustomRoomListPage,
  CustomRoomListQuery,
  HostRoom,
  PlayerRoom,
  RoomReconnectOptions,
  Room,
  SpectatorRoom,
} from "./custom-room.js";
import { createMatchmakingApi } from "./matchmaking.js";
import type {
  MatchmakingClientApi,
  MatchmakingJoinOptions,
  MatchmakingPoolReference,
  MatchmakingTicket,
  MatchmakingTicketRequestOptions,
} from "./matchmaking.js";
import { createPartyApi } from "./party.js";
import type {
  PartyClientApi,
  PartyCreationOptions,
  PartyJoinOptions,
  PartyRequestOptions,
  Party,
  RawJsonEventConnection,
} from "./party.js";

const WEBSOCKET_OPEN = 1;
const WEBSOCKET_CLOSED = 3;
const DEFAULT_WEBSOCKET_PROTOCOL = "flarelobby.v1";
const AUTHENTICATION_PROTOCOL_PREFIX = "flarelobby.auth.";
/** タイマーの overflow を防ぐためのタイムアウト上限です。 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** リスナー未登録時に保持するイベント上限です。超過分は古いものから破棄します。 */
const MAX_QUEUED_EVENTS = 100;

/** 生 JSON イベント接続でリスナー未登録時に保持するメッセージ上限です。 */
const MAX_QUEUED_MESSAGES = 100;

/** 標準 fetch を差し替えるための関数契約です。 */
export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** 標準 WebSocket を差し替えるためのコンストラクター契約です。 */
export type WebSocketConstructor = {
  new (url: string, protocols?: string | string[]): WebSocket;
};

/** WebSocket コンストラクターを関数として差し替える契約です。 */
export type WebSocketFactory = (
  url: string,
  protocols: readonly string[],
) => WebSocket;

/** HTTP 要求の共通オプションです。 */
export interface ClientRequestOptions {
  readonly method?: string;
  readonly headers?: HeadersInit;
  /** JSON として送信する本文です。 */
  readonly body?: JsonValue;
  readonly signal?: AbortSignal;
  /** 指定時、要求識別子を生成して Idempotency-Key へ付与します。 */
  readonly idempotent?: boolean;
  /** 再送時に同じ処理結果を参照するための要求識別子です。 */
  readonly requestId?: RequestId;
  /**
   * 要求全体の期限（ミリ秒）です。`undefined` は Client の既定値を継承し、
   * `null` は明示的な無期限です。正の有限数（上限 2,147,483,647）のみ有効です。
   */
  readonly timeoutMs?: number | null;
}

/** WebSocket 接続のオプションです。 */
export interface ClientWebSocketOptions {
  readonly signal?: AbortSignal;
  readonly protocols?: string | readonly string[];
  readonly knownEventTypes?: readonly ProtocolEventType[];
  /** 再開接続時に最後に適用した Room の版番号を指定します。 */
  readonly lastRevision?: Revision;
  /**
   * 接続確立までの期限（ミリ秒）です。`undefined` は Client の既定値を継承し、
   * `null` は明示的な無期限です。正の有限数（上限 2,147,483,647）のみ有効です。
   */
  readonly timeoutMs?: number | null;
}

/** WebSocket コマンドのオプションです。 */
export interface ClientCommandOptions {
  readonly signal?: AbortSignal;
  /** 再送時に同じ処理結果を参照するための要求識別子です。 */
  readonly requestId?: RequestId;
  /**
   * 応答待ちの期限（ミリ秒）です。`undefined` は Client の既定値を継承し、
   * `null` は明示的な無期限です。正の有限数（上限 2,147,483,647）のみ有効です。
   */
  readonly timeoutMs?: number | null;
}

/** クライアントの初期化設定です。 */
export interface FlareLobbyClientOptions<
  _TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly endpoint: string | URL;
  readonly getAccessToken: () => string | Promise<string>;
  readonly fetch?: FetchImplementation;
  /** lower camel case の差し替え設定です。 */
  readonly webSocket?: WebSocketConstructor;
  /** ブラウザ標準の `WebSocket` と同じ名前で指定する別名です。 */
  readonly WebSocket?: WebSocketConstructor;
  readonly webSocketFactory?: WebSocketFactory;
  /** テストまたは再送制御用の要求識別子生成関数です。 */
  readonly requestIdFactory?: () => RequestId;
  /** Room の再接続に使う既定設定です。 */
  readonly reconnect?: RoomReconnectOptions;
  /**
   * HTTP 要求全体の既定の期限（ミリ秒）です。省略・`null` は無期限です。
   * 正の有限数（上限 2,147,483,647）のみ有効です。
   */
  readonly requestTimeoutMs?: number | null;
  /**
   * WebSocket 接続確立までの既定の期限（ミリ秒）です。省略・`null` は無期限です。
   * Raw JSON イベント接続にも適用されます。
   */
  readonly connectionTimeoutMs?: number | null;
  /**
   * WebSocket コマンド応答待ちの既定の期限（ミリ秒）です。省略・`null` は無期限です。
   */
  readonly commandTimeoutMs?: number | null;
}

/** WebSocket イベントを受け取るコールバックです。 */
export type ClientEventListener = (event: ServerEventEnvelope) => void;

/** 接続済み WebSocket の共通操作です。 */
export interface FlareLobbyWebSocketConnection<
  _TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly closed: boolean;
  send<TResponse = JsonValue>(
    command: string,
    payload: JsonValue,
    options?: ClientCommandOptions,
  ): Promise<TResponse>;
  onEvent(listener: ClientEventListener): () => void;
  onClose(listener: (error: FlareLobbyError) => void): () => void;
  close(code?: number, reason?: string): void;
}

/** ブラウザ向け FlareLobby クライアントの公開契約です。 */
export interface FlareLobbyClient<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly endpoint: string;
  readonly disposed: boolean;
  request<TResponse = JsonValue>(
    path: string | URL,
    options?: ClientRequestOptions,
  ): Promise<TResponse>;
  connect(
    path: string | URL,
    options?: ClientWebSocketOptions,
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  /** `connect()` の説明的な別名です。 */
  connectWebSocket(
    path: string | URL,
    options?: ClientWebSocketOptions,
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  createCustomRoom(
    options?: CustomRoomCreationOptions<TApp>,
  ): Promise<HostRoom<TApp>>;
  joinCustomRoom(code: string): Promise<PlayerRoom<TApp>>;
  joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role: "spectator" },
  ): Promise<SpectatorRoom<TApp>>;
  joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role?: "player" },
  ): Promise<PlayerRoom<TApp>>;
  joinCustomRoom(options: CustomRoomJoinOptions): Promise<Room<TApp>>;
  listCustomRooms(
    query?: CustomRoomListQuery,
  ): Promise<CustomRoomListPage<TApp>>;
  joinMatchmaking(
    pool: MatchmakingPoolReference,
    options?: MatchmakingJoinOptions,
  ): Promise<MatchmakingTicket<TApp>>;
  findMatch(
    pool: MatchmakingPoolReference,
    options?: MatchmakingJoinOptions,
  ): Promise<import("./custom-room.js").PlayerRoom<TApp>>;
  getRating(
    pool: MatchmakingPoolReference,
    options?: MatchmakingTicketRequestOptions,
  ): Promise<import("@flarelobby/core").Rating>;
  dispose(): void;
  /** パーティーを作成し、作成者をリーダーとした接続済みハンドルを返します。 */
  createParty(options?: PartyCreationOptions): Promise<Party<TApp>>;
  /** 既存パーティーの状態を取得し、イベント購読を開始します。 */
  getParty(
    partyId: string,
    options?: PartyRequestOptions,
  ): Promise<Party<TApp>>;
  /**
   * 単一用途トークンでパーティーへ参加し、イベント購読を開始します。
   * トークンだけでは参加先を決められないため、招待元から受け取った
   * `partyId` を指定してください。
   */
  joinParty(
    invite: { readonly partyId: string; readonly token: string },
    options?: PartyJoinOptions,
  ): Promise<Party<TApp>>;
  /** `dispose()` の説明的な別名です。 */
  destroy(): void;
}

/** 認証、HTTP、WebSocket の共通基盤を初期化します。 */
export function createFlareLobbyClient<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(options: FlareLobbyClientOptions<TApp>): FlareLobbyClient<TApp> {
  return new FlareLobbyClientImpl(options);
}

class FlareLobbyClientImpl<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> implements FlareLobbyClient<TApp> {
  public readonly endpoint: string;

  private readonly endpointUrl: URL;
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly fetchImplementation: FetchImplementation | undefined;
  private readonly webSocketConstructor: WebSocketConstructor | undefined;
  private readonly webSocketFactory: WebSocketFactory | undefined;
  private readonly requestIdFactory: () => RequestId;
  private readonly customRoomApi: CustomRoomClientApi<TApp>;
  private readonly matchmakingApi: MatchmakingClientApi<TApp>;
  private readonly partyApi: PartyClientApi<TApp>;
  private readonly connections = new Set<FlareLobbyWebSocketConnectionImpl>();
  private readonly eventStreamConnections =
    new Set<RawJsonEventConnectionImpl>();
  private readonly requestTimeoutMs: number | undefined;
  private readonly connectionTimeoutMs: number | undefined;
  private readonly commandTimeoutMs: number | undefined;
  private readonly disposeController = new AbortController();
  private disposedState = false;

  public constructor(options: FlareLobbyClientOptions<TApp>) {
    if (!isRecord(options) || typeof options.getAccessToken !== "function") {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "endpoint と getAccessToken を指定してください。",
      });
    }

    this.endpointUrl = normalizeEndpoint(options.endpoint);
    this.endpoint = this.endpointUrl.href;
    this.getAccessToken = options.getAccessToken;
    this.fetchImplementation = options.fetch;
    this.webSocketConstructor = options.webSocket ?? options.WebSocket;
    this.webSocketFactory = options.webSocketFactory;
    this.requestIdFactory = options.requestIdFactory ?? createRequestId;
    this.requestTimeoutMs = normalizeTimeoutDefault(options.requestTimeoutMs);
    this.connectionTimeoutMs = normalizeTimeoutDefault(
      options.connectionTimeoutMs,
    );
    this.commandTimeoutMs = normalizeTimeoutDefault(options.commandTimeoutMs);
    this.customRoomApi = createCustomRoomApi<TApp>({
      request: this.request.bind(this),
      connect: this.connect.bind(this),
      connectWithToken: (path, options, token) =>
        this.connectWithToken(path, options, token),
      ...(options.reconnect === undefined
        ? {}
        : { reconnectOptions: options.reconnect }),
    });
    this.matchmakingApi = createMatchmakingApi<TApp>({
      request: this.request.bind(this),
      connect: this.connect.bind(this),
      connectWithToken: (path, connectionOptions, token) =>
        this.connectWithToken(path, connectionOptions, token),
      requestIdFactory: this.requestIdFactory,
      ...(options.reconnect === undefined
        ? {}
        : { reconnectOptions: options.reconnect }),
    });
    this.partyApi = createPartyApi<TApp>({
      request: this.request.bind(this),
      connect: this.connect.bind(this),
      connectWithToken: (path, connectionOptions, token) =>
        this.connectWithToken(path, connectionOptions, token),
      requestIdFactory: this.requestIdFactory,
      connectEvents: (path, connectionOptions) =>
        this.connectEventStream(path, connectionOptions),
      startQueue: (pool, queueOptions) =>
        this.matchmakingApi.joinMatchmaking(pool, queueOptions),
      ...(options.reconnect === undefined
        ? {}
        : { reconnectOptions: options.reconnect }),
    });
  }

  public get disposed(): boolean {
    return this.disposedState;
  }

  public async request<TResponse = JsonValue>(
    path: string | URL,
    options: ClientRequestOptions = {},
  ): Promise<TResponse> {
    this.assertActive();
    throwIfAborted(options.signal);
    const operationTimeout = normalizeTimeoutOption(options.timeoutMs);
    const timeoutMs = resolveTimeoutMs(operationTimeout, this.requestTimeoutMs);

    const requestId = this.resolveHttpRequestId(options);
    const url = resolveHttpUrl(this.endpointUrl, path);

    const headersBase = new Headers(options.headers);
    if (requestId !== undefined) {
      headersBase.set("Idempotency-Key", requestId);
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      try {
        body = JSON.stringify(options.body);
      } catch {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }

      if (body === undefined) {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }

      headersBase.set("Content-Type", "application/json");
    }

    const fetchImplementation =
      this.fetchImplementation ?? getDefaultFetchImplementation();

    if (fetchImplementation === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    if (timeoutMs === undefined) {
      return this.requestWithoutTimeout<TResponse>(
        url,
        options,
        requestId,
        headersBase,
        body,
        fetchImplementation,
      );
    }

    return this.requestWithTimeout<TResponse>(
      url,
      options,
      requestId,
      headersBase,
      body,
      fetchImplementation,
      timeoutMs,
    );
  }

  private async requestWithoutTimeout<TResponse>(
    url: URL,
    options: ClientRequestOptions,
    requestId: RequestId | undefined,
    headersBase: Headers,
    body: string | undefined,
    fetchImplementation: FetchImplementation,
  ): Promise<TResponse> {
    const token = await this.readAccessToken();
    throwIfAborted(options.signal);

    const headers = new Headers(headersBase);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");

    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: options.method ?? "GET",
        headers,
        ...(body === undefined ? {} : { body }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        throw createErrorWithRequestId("CANCELLED", requestId);
      }

      throw createErrorWithRequestId("CONNECTION_FAILED", requestId);
    }

    if (!isResponseLike(response)) {
      throw createErrorWithRequestId("CONNECTION_FAILED", requestId);
    }

    const responseBody = await readResponseBody(response, requestId);

    if (!response.ok) {
      throw normalizeHttpError(response.status, responseBody, requestId);
    }

    if (!responseBody.ok) {
      throw responseBody.error;
    }

    return responseBody.value as TResponse;
  }

  private requestWithTimeout<TResponse>(
    url: URL,
    options: ClientRequestOptions,
    requestId: RequestId | undefined,
    headersBase: Headers,
    body: string | undefined,
    fetchImplementation: FetchImplementation,
    timeoutMs: number,
  ): Promise<TResponse> {
    const userSignal = options.signal;
    const disposeSignal = this.disposeController.signal;
    const fetchController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    return new Promise<TResponse>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (userSignal !== undefined) {
          userSignal.removeEventListener("abort", onUserAbort);
        }
        disposeSignal.removeEventListener("abort", onDispose);
      };
      const doResolve = (value: TResponse): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const doReject = (error: FlareLobbyError): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        try {
          fetchController.abort();
        } catch {
          // Abort の失敗は公開しません。
        }
        reject(error);
      };
      const onUserAbort = (): void => {
        doReject(createErrorWithRequestId("CANCELLED", requestId));
      };
      const onDispose = (): void => {
        doReject(createErrorWithRequestId("CANCELLED", requestId));
      };
      const onTimeout = (): void => {
        doReject(createErrorWithRequestId("TIMEOUT", requestId));
      };

      timer = setTimeout(onTimeout, timeoutMs);
      if (userSignal !== undefined) {
        if (userSignal.aborted) {
          onUserAbort();
          return;
        }
        userSignal.addEventListener("abort", onUserAbort, { once: true });
      }
      if (disposeSignal.aborted) {
        onDispose();
        return;
      }
      disposeSignal.addEventListener("abort", onDispose, { once: true });

      void (async (): Promise<void> => {
        try {
          const token = await this.readAccessToken();
          if (settled) {
            return;
          }
          if (this.disposedState) {
            doReject(createErrorWithRequestId("CANCELLED", requestId));
            return;
          }

          const headers = new Headers(headersBase);
          headers.set("Authorization", `Bearer ${token}`);
          headers.set("Accept", "application/json");

          let response: Response;
          try {
            response = await fetchImplementation(url, {
              method: options.method ?? "GET",
              headers,
              ...(body === undefined ? {} : { body }),
              signal: fetchController.signal,
            });
          } catch (error) {
            if (settled) {
              return;
            }
            if (
              userSignal?.aborted === true ||
              disposeSignal.aborted ||
              this.disposedState
            ) {
              doReject(createErrorWithRequestId("CANCELLED", requestId));
              return;
            }
            if (isAbortError(error)) {
              // 内部 Abort は利用者中止・dispose・期限切れのいずれかが先行しています。
              // settled が false のまま残るのは競合時のみであり、期限切れを優先しません。
              doReject(createErrorWithRequestId("CANCELLED", requestId));
              return;
            }
            doReject(createErrorWithRequestId("CONNECTION_FAILED", requestId));
            return;
          }

          if (settled) {
            return;
          }
          if (!isResponseLike(response)) {
            doReject(createErrorWithRequestId("CONNECTION_FAILED", requestId));
            return;
          }

          const responseBody = await readResponseBody(response, requestId);
          if (settled) {
            return;
          }
          if (!response.ok) {
            doReject(
              normalizeHttpError(response.status, responseBody, requestId),
            );
            return;
          }
          if (!responseBody.ok) {
            doReject(responseBody.error);
            return;
          }
          doResolve(responseBody.value as TResponse);
        } catch (error) {
          if (settled) {
            return;
          }
          if (error instanceof FlareLobbyError) {
            doReject(error);
            return;
          }
          doReject(createErrorWithRequestId("CONNECTION_FAILED", requestId));
        }
      })();
    });
  }

  public async connect(
    path: string | URL,
    options: ClientWebSocketOptions = {},
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    return this.connectWithToken(path, options);
  }

  private async connectWithToken(
    path: string | URL,
    options: ClientWebSocketOptions = {},
    token?: string,
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    this.assertActive();
    throwIfAborted(options.signal);
    const operationTimeout = normalizeTimeoutOption(options.timeoutMs);
    const timeoutMs = resolveTimeoutMs(
      operationTimeout,
      this.connectionTimeoutMs,
    );

    const url = resolveWebSocketUrl(
      this.endpointUrl,
      path,
      options.lastRevision,
    );

    if (timeoutMs === undefined) {
      const authenticationToken =
        token === undefined ? await this.readAccessToken() : token;
      this.assertActive();
      throwIfAborted(options.signal);

      const protocols = createWebSocketProtocols(
        options.protocols,
        authenticationToken,
      );
      const socket = this.createWebSocket(url, protocols);
      const connection = new FlareLobbyWebSocketConnectionImpl(
        socket,
        this.requestIdFactory,
        options.knownEventTypes,
        () => this.connections.delete(connection),
        this.commandTimeoutMs,
      );
      this.connections.add(connection);

      try {
        if (this.disposedState) {
          connection.close(1000, "client disposed");
          this.connections.delete(connection);
          throw new FlareLobbyError("CANCELLED");
        }

        await connection.waitForOpen(options.signal);
        this.assertActive();
        return connection as FlareLobbyWebSocketConnection<TApp>;
      } catch (error) {
        connection.close();
        this.connections.delete(connection);
        throw normalizeClientError(error, "CONNECTION_FAILED");
      }
    }

    return this.connectWithTimeout(url, options, token, timeoutMs);
  }

  private connectWithTimeout(
    url: URL,
    options: ClientWebSocketOptions,
    token: string | undefined,
    timeoutMs: number,
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    const userSignal = options.signal;
    const disposeSignal = this.disposeController.signal;

    return new Promise<FlareLobbyWebSocketConnection<TApp>>(
      (resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let connection: FlareLobbyWebSocketConnectionImpl | undefined;

        const cleanup = (): void => {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          if (userSignal !== undefined) {
            userSignal.removeEventListener("abort", onUserAbort);
          }
          disposeSignal.removeEventListener("abort", onDispose);
        };
        const doResolve = (
          value: FlareLobbyWebSocketConnection<TApp>,
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(value);
        };
        const doReject = (error: FlareLobbyError): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          if (connection !== undefined) {
            try {
              connection.close();
            } catch {
              // 閉塞時の例外は公開しません。
            }
            this.connections.delete(connection);
          }
          reject(error);
        };
        const onUserAbort = (): void => {
          doReject(new FlareLobbyError("CANCELLED"));
        };
        const onDispose = (): void => {
          doReject(new FlareLobbyError("CANCELLED"));
        };
        const onTimeout = (): void => {
          doReject(new FlareLobbyError("TIMEOUT"));
        };

        timer = setTimeout(onTimeout, timeoutMs);
        if (userSignal !== undefined) {
          if (userSignal.aborted) {
            onUserAbort();
            return;
          }
          userSignal.addEventListener("abort", onUserAbort, { once: true });
        }
        if (disposeSignal.aborted || this.disposedState) {
          onDispose();
          return;
        }
        disposeSignal.addEventListener("abort", onDispose, { once: true });

        void (async (): Promise<void> => {
          try {
            const authenticationToken =
              token === undefined ? await this.readAccessToken() : token;
            if (settled) {
              return;
            }
            if (this.disposedState) {
              doReject(new FlareLobbyError("CANCELLED"));
              return;
            }

            let protocols: readonly string[];
            try {
              protocols = createWebSocketProtocols(
                options.protocols,
                authenticationToken,
              );
            } catch (error) {
              if (settled) {
                return;
              }
              doReject(normalizeClientError(error, "CONNECTION_FAILED"));
              return;
            }

            let socket: WebSocket;
            try {
              socket = this.createWebSocket(url, protocols);
            } catch (error) {
              if (settled) {
                return;
              }
              doReject(normalizeClientError(error, "CONNECTION_FAILED"));
              return;
            }

            if (settled) {
              try {
                socket.close();
              } catch {
                // 期限切れ後の遅延ソケットは閉じるだけです。
              }
              return;
            }

            const created = new FlareLobbyWebSocketConnectionImpl(
              socket,
              this.requestIdFactory,
              options.knownEventTypes,
              () => this.connections.delete(created),
              this.commandTimeoutMs,
            );
            connection = created;
            this.connections.add(created);

            if (settled) {
              doReject(new FlareLobbyError("CANCELLED"));
              return;
            }
            if (this.disposedState) {
              doReject(new FlareLobbyError("CANCELLED"));
              return;
            }

            try {
              await created.waitForOpen();
            } catch (error) {
              if (settled) {
                return;
              }
              doReject(normalizeClientError(error, "CONNECTION_FAILED"));
              return;
            }

            if (settled) {
              // 期限切れ後に open した接続は閉じて登録しません。
              try {
                created.close();
              } catch {
                // 閉塞時の例外は公開しません。
              }
              this.connections.delete(created);
              return;
            }
            try {
              this.assertActive();
            } catch {
              doReject(new FlareLobbyError("CANCELLED"));
              return;
            }
            doResolve(created as FlareLobbyWebSocketConnection<TApp>);
          } catch (error) {
            if (settled) {
              return;
            }
            doReject(normalizeClientError(error, "CONNECTION_FAILED"));
          }
        })();
      },
    );
  }

  /**
   * Party Durable Object のイベント接続のように、プロトコル Envelope ではなく
   * 1 メッセージ = 1 JSON 値を配信する WebSocket を開きます。
   */
  private async connectEventStream(
    path: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<RawJsonEventConnection> {
    this.assertActive();
    throwIfAborted(options.signal);
    const timeoutMs = this.connectionTimeoutMs;

    const url = resolveWebSocketUrl(this.endpointUrl, path);

    if (timeoutMs === undefined) {
      const authenticationToken = await this.readAccessToken();
      this.assertActive();
      throwIfAborted(options.signal);

      const protocols = createWebSocketProtocols(
        undefined,
        authenticationToken,
      );
      const socket = this.createWebSocket(url, protocols);
      const connection = new RawJsonEventConnectionImpl(socket, () =>
        this.eventStreamConnections.delete(connection),
      );
      this.eventStreamConnections.add(connection);
      try {
        if (this.disposedState) {
          connection.close(1000, "client disposed");
          throw new FlareLobbyError("CANCELLED");
        }

        await connection.waitForOpen(options.signal);
        this.assertActive();
        return connection;
      } catch (error) {
        connection.close();
        throw normalizeClientError(error, "CONNECTION_FAILED");
      }
    }

    return this.connectEventStreamWithTimeout(url, options.signal, timeoutMs);
  }

  private connectEventStreamWithTimeout(
    url: URL,
    userSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<RawJsonEventConnection> {
    const disposeSignal = this.disposeController.signal;

    return new Promise<RawJsonEventConnection>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let connection: RawJsonEventConnectionImpl | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (userSignal !== undefined) {
          userSignal.removeEventListener("abort", onUserAbort);
        }
        disposeSignal.removeEventListener("abort", onDispose);
      };
      const doResolve = (value: RawJsonEventConnection): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const doReject = (error: FlareLobbyError): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (connection !== undefined) {
          try {
            connection.close();
          } catch {
            // 閉塞時の例外は公開しません。
          }
          this.eventStreamConnections.delete(connection);
        }
        reject(error);
      };
      const onUserAbort = (): void => {
        doReject(new FlareLobbyError("CANCELLED"));
      };
      const onDispose = (): void => {
        doReject(new FlareLobbyError("CANCELLED"));
      };
      const onTimeout = (): void => {
        doReject(new FlareLobbyError("TIMEOUT"));
      };

      timer = setTimeout(onTimeout, timeoutMs);
      if (userSignal !== undefined) {
        if (userSignal.aborted) {
          onUserAbort();
          return;
        }
        userSignal.addEventListener("abort", onUserAbort, { once: true });
      }
      if (disposeSignal.aborted || this.disposedState) {
        onDispose();
        return;
      }
      disposeSignal.addEventListener("abort", onDispose, { once: true });

      void (async (): Promise<void> => {
        try {
          const authenticationToken = await this.readAccessToken();
          if (settled) {
            return;
          }
          if (this.disposedState) {
            doReject(new FlareLobbyError("CANCELLED"));
            return;
          }

          const protocols = createWebSocketProtocols(
            undefined,
            authenticationToken,
          );
          let socket: WebSocket;
          try {
            socket = this.createWebSocket(url, protocols);
          } catch (error) {
            if (settled) {
              return;
            }
            doReject(normalizeClientError(error, "CONNECTION_FAILED"));
            return;
          }

          if (settled) {
            try {
              socket.close();
            } catch {
              // 期限切れ後の遅延ソケットは閉じるだけです。
            }
            return;
          }

          const created = new RawJsonEventConnectionImpl(socket, () =>
            this.eventStreamConnections.delete(created),
          );
          connection = created;
          this.eventStreamConnections.add(created);

          if (settled || this.disposedState) {
            doReject(new FlareLobbyError("CANCELLED"));
            return;
          }

          try {
            await created.waitForOpen();
          } catch (error) {
            if (settled) {
              return;
            }
            doReject(normalizeClientError(error, "CONNECTION_FAILED"));
            return;
          }

          if (settled) {
            try {
              created.close();
            } catch {
              // 期限切れ後に open した接続は閉じるだけです。
            }
            this.eventStreamConnections.delete(created);
            return;
          }
          try {
            this.assertActive();
          } catch {
            doReject(new FlareLobbyError("CANCELLED"));
            return;
          }
          doResolve(created);
        } catch (error) {
          if (settled) {
            return;
          }
          doReject(normalizeClientError(error, "CONNECTION_FAILED"));
        }
      })();
    });
  }

  public connectWebSocket(
    path: string | URL,
    options: ClientWebSocketOptions = {},
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    return this.connect(path, options);
  }

  public createCustomRoom(
    options: CustomRoomCreationOptions<TApp> = {},
  ): Promise<HostRoom<TApp>> {
    return this.customRoomApi.createCustomRoom(options);
  }

  public joinCustomRoom(code: string): Promise<PlayerRoom<TApp>>;
  public joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role: "spectator" },
  ): Promise<SpectatorRoom<TApp>>;
  public joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role?: "player" },
  ): Promise<PlayerRoom<TApp>>;
  public joinCustomRoom(options: CustomRoomJoinOptions): Promise<Room<TApp>>;
  public joinCustomRoom(
    codeOrOptions: string | CustomRoomJoinOptions,
  ): Promise<Room<TApp>> {
    return this.customRoomApi.joinCustomRoom(codeOrOptions);
  }

  public listCustomRooms(
    query: CustomRoomListQuery = {},
  ): Promise<CustomRoomListPage<TApp>> {
    return this.customRoomApi.listCustomRooms(query);
  }

  public joinMatchmaking(
    pool: MatchmakingPoolReference,
    options: MatchmakingJoinOptions = {},
  ): Promise<MatchmakingTicket<TApp>> {
    return this.matchmakingApi.joinMatchmaking(pool, options);
  }

  public findMatch(
    pool: MatchmakingPoolReference,
    options: MatchmakingJoinOptions = {},
  ): Promise<import("./custom-room.js").PlayerRoom<TApp>> {
    return this.matchmakingApi.findMatch(pool, options);
  }

  public getRating(
    pool: MatchmakingPoolReference,
    options: MatchmakingTicketRequestOptions = {},
  ): Promise<import("@flarelobby/core").Rating> {
    return this.matchmakingApi.getRating(pool, options);
  }

  public createParty(options: PartyCreationOptions = {}): Promise<Party<TApp>> {
    return this.partyApi.createParty(options);
  }

  public getParty(
    partyId: string,
    options: PartyRequestOptions = {},
  ): Promise<Party<TApp>> {
    return this.partyApi.getParty(partyId, options);
  }

  public joinParty(
    invite: { readonly partyId: string; readonly token: string },
    options: PartyJoinOptions = {},
  ): Promise<Party<TApp>> {
    return this.partyApi.joinParty(invite, options);
  }

  public dispose(): void {
    if (this.disposedState) {
      return;
    }

    this.disposedState = true;
    try {
      this.disposeController.abort();
    } catch {
      // Abort の失敗は公開しません。
    }
    this.matchmakingApi.dispose();
    this.partyApi.dispose();
    for (const connection of this.eventStreamConnections) {
      connection.close(1000, "client disposed");
    }
    this.eventStreamConnections.clear();
    for (const connection of this.connections) {
      connection.close(1000, "client disposed");
    }
    this.connections.clear();
  }

  public destroy(): void {
    this.dispose();
  }

  private assertActive(): void {
    if (this.disposedState) {
      throw new FlareLobbyError("CANCELLED");
    }
  }

  private resolveHttpRequestId(
    options: ClientRequestOptions,
  ): RequestId | undefined {
    const requestId =
      options.requestId ??
      (options.idempotent === true ? this.createRequestId() : undefined);

    if (requestId !== undefined && !isNonEmptyString(requestId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "requestId は空でない文字列で指定してください。",
      });
    }

    return requestId;
  }

  private createRequestId(): RequestId {
    try {
      const requestId = this.requestIdFactory();
      if (!isNonEmptyString(requestId)) {
        throw new Error("invalid request id");
      }
      return requestId;
    } catch {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }
  }

  private async readAccessToken(): Promise<string> {
    try {
      const token = await this.getAccessToken();
      if (!isNonEmptyString(token)) {
        throw new Error("empty token");
      }
      return token;
    } catch {
      // 認証 Hook の内部例外と token の値を公開しません。
      throw new FlareLobbyError("UNAUTHENTICATED");
    }
  }

  private createWebSocket(url: URL, protocols: readonly string[]): WebSocket {
    try {
      if (this.webSocketFactory !== undefined) {
        return this.webSocketFactory(url.href, protocols);
      }

      const constructor =
        this.webSocketConstructor ?? getDefaultWebSocketConstructor();

      if (constructor === undefined) {
        throw new Error("WebSocket is unavailable");
      }

      return new constructor(url.href, [...protocols]);
    } catch {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }
  }
}

interface PendingCommand {
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: FlareLobbyError) => void;
  readonly signal: AbortSignal | undefined;
  readonly abortListener: (() => void) | undefined;
  readonly timeoutId: ReturnType<typeof setTimeout> | undefined;
}

class FlareLobbyWebSocketConnectionImpl implements FlareLobbyWebSocketConnection {
  private readonly socket: WebSocket;
  private readonly requestIdFactory: () => RequestId;
  private readonly knownEventTypes: readonly ProtocolEventType[] | undefined;
  private readonly onClosed: () => void;
  private readonly commandTimeoutMs: number | undefined;
  private readonly pending = new Map<RequestId, PendingCommand>();
  private readonly eventListeners = new Set<ClientEventListener>();
  private readonly closeListeners = new Set<(error: FlareLobbyError) => void>();
  private readonly queuedEvents: ServerEventEnvelope[] = [];
  private readonly openPromise: Promise<void>;
  private resolveOpen!: () => void;
  private rejectOpen!: (error: FlareLobbyError) => void;
  private opened = false;
  private closedState = false;
  private closedByClient = false;
  private closedError: FlareLobbyError | undefined;

  private readonly handleOpen = (): void => {
    if (this.closedState) {
      return;
    }

    this.opened = true;
    this.resolveOpen();
  };

  private readonly handleMessage = (event: Event): void => {
    if (this.closedState) {
      return;
    }

    const data = (event as MessageEvent).data;
    if (typeof data !== "string") {
      this.terminate(new FlareLobbyError("INVALID_MESSAGE"), 1002);
      return;
    }

    const decoded =
      this.knownEventTypes === undefined
        ? decodeServerMessage(data)
        : decodeServerMessage(data, {
            knownEventTypes: this.knownEventTypes,
          });

    if (!decoded.ok) {
      this.terminate(decoded.error, 1002);
      return;
    }

    this.handleServerMessage(decoded.value);
  };

  private readonly handleError = (): void => {
    this.terminate(new FlareLobbyError("CONNECTION_FAILED"));
  };

  private readonly handleClose = (event: Event): void => {
    if (this.closedState) {
      return;
    }

    this.terminate(
      this.closedByClient
        ? new FlareLobbyError("CANCELLED")
        : errorForWebSocketCloseCode((event as CloseEvent).code),
    );
  };

  public constructor(
    socket: WebSocket,
    requestIdFactory: () => RequestId,
    knownEventTypes: readonly ProtocolEventType[] | undefined,
    onClosed: () => void,
    commandTimeoutMs?: number | null,
  ) {
    this.socket = socket;
    this.requestIdFactory = requestIdFactory;
    this.knownEventTypes = knownEventTypes;
    this.onClosed = onClosed;
    this.commandTimeoutMs =
      commandTimeoutMs === null || commandTimeoutMs === undefined
        ? undefined
        : commandTimeoutMs;
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });

    this.socket.addEventListener("open", this.handleOpen);
    this.socket.addEventListener("message", this.handleMessage);
    this.socket.addEventListener("error", this.handleError);
    this.socket.addEventListener("close", this.handleClose);

    if (this.socket.readyState === WEBSOCKET_OPEN) {
      queueMicrotask(this.handleOpen);
    }
  }

  public get closed(): boolean {
    return this.closedState || this.socket.readyState === WEBSOCKET_CLOSED;
  }

  public waitForOpen(signal?: AbortSignal): Promise<void> {
    if (signal === undefined) {
      return this.openPromise;
    }

    if (signal.aborted) {
      this.close();
      return Promise.reject(new FlareLobbyError("CANCELLED"));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = (): void => {
        this.close();
        settle(() => reject(new FlareLobbyError("CANCELLED")));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.openPromise.then(
        () => settle(resolve),
        (error: FlareLobbyError) => settle(() => reject(error)),
      );
    });
  }

  public async send<TResponse = JsonValue>(
    command: string,
    payload: JsonValue,
    options: ClientCommandOptions = {},
  ): Promise<TResponse> {
    if (this.closedState || this.socket.readyState !== WEBSOCKET_OPEN) {
      throw this.closedError ?? new FlareLobbyError("CONNECTION_FAILED");
    }

    if (!isNonEmptyString(command)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "command は空でない文字列で指定してください。",
      });
    }

    throwIfAborted(options.signal);
    const operationTimeout = normalizeTimeoutOption(options.timeoutMs);
    const timeoutMs = resolveTimeoutMs(operationTimeout, this.commandTimeoutMs);

    const requestId = this.createRequestId(options.requestId);
    const message: ClientCommandEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      kind: "command",
      requestId,
      command,
      payload,
    };
    const encoded = encodeProtocolMessage(message);

    if (!encoded.ok) {
      throw encoded.error;
    }

    if (timeoutMs === undefined) {
      return new Promise<TResponse>((resolve, reject) => {
        let settled = false;
        const abortListener =
          options.signal === undefined
            ? undefined
            : (): void => {
                if (settled) {
                  return;
                }
                settled = true;
                this.removePending(requestId);
                reject(new FlareLobbyError("CANCELLED", { requestId }));
              };

        const resolvePending = (value: JsonValue): void => {
          if (settled) {
            return;
          }
          settled = true;
          this.removePending(requestId);
          resolve(value as TResponse);
        };
        const rejectPending = (error: FlareLobbyError): void => {
          if (settled) {
            return;
          }
          settled = true;
          this.removePending(requestId);
          reject(error);
        };

        this.pending.set(requestId, {
          resolve: resolvePending,
          reject: rejectPending,
          signal: options.signal,
          abortListener,
          timeoutId: undefined,
        });

        if (options.signal !== undefined && abortListener !== undefined) {
          options.signal.addEventListener("abort", abortListener, {
            once: true,
          });
          if (options.signal.aborted) {
            abortListener();
            return;
          }
        }

        try {
          this.socket.send(encoded.value);
        } catch {
          rejectPending(
            new FlareLobbyError("CONNECTION_FAILED", { requestId }),
          );
        }
      });
    }

    return new Promise<TResponse>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanupTimer = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
      const abortListener =
        options.signal === undefined
          ? undefined
          : (): void => {
              if (settled) {
                return;
              }
              settled = true;
              cleanupTimer();
              this.removePending(requestId);
              reject(new FlareLobbyError("CANCELLED", { requestId }));
            };
      const timeoutListener = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        // 期限切れで pending 登録を削除するが、他の command が使う接続は閉じない。
        this.removePending(requestId);
        reject(new FlareLobbyError("TIMEOUT", { requestId }));
      };

      const resolvePending = (value: JsonValue): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupTimer();
        this.removePending(requestId);
        resolve(value as TResponse);
      };
      const rejectPending = (error: FlareLobbyError): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupTimer();
        this.removePending(requestId);
        reject(error);
      };

      timer = setTimeout(timeoutListener, timeoutMs);
      this.pending.set(requestId, {
        resolve: resolvePending,
        reject: rejectPending,
        signal: options.signal,
        abortListener,
        timeoutId: timer,
      });

      if (options.signal !== undefined && abortListener !== undefined) {
        options.signal.addEventListener("abort", abortListener, {
          once: true,
        });
        if (options.signal.aborted) {
          abortListener();
          return;
        }
      }

      try {
        this.socket.send(encoded.value);
      } catch {
        rejectPending(new FlareLobbyError("CONNECTION_FAILED", { requestId }));
      }
    });
  }

  public onEvent(listener: ClientEventListener): () => void {
    if (this.closedState) {
      throw this.closedError ?? new FlareLobbyError("CANCELLED");
    }

    this.eventListeners.add(listener);
    if (this.queuedEvents.length > 0) {
      const queuedEvents = this.queuedEvents.splice(0);
      for (const event of queuedEvents) {
        this.notifyEventListeners(event);
      }
    }
    return (): void => {
      this.eventListeners.delete(listener);
    };
  }

  public onClose(listener: (error: FlareLobbyError) => void): () => void {
    if (this.closedState) {
      listener(this.closedError ?? new FlareLobbyError("CONNECTION_FAILED"));
      return (): void => undefined;
    }

    this.closeListeners.add(listener);
    return (): void => {
      this.closeListeners.delete(listener);
    };
  }

  public close(code?: number, reason?: string): void {
    if (this.closedState) {
      return;
    }

    this.closedByClient = true;
    this.terminate(new FlareLobbyError("CANCELLED"), code, reason);
  }

  private createRequestId(requestId: RequestId | undefined): RequestId {
    const value = requestId ?? this.requestIdFactory();
    if (!isNonEmptyString(value)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "requestId は空でない文字列で指定してください。",
      });
    }
    return value;
  }

  private handleServerMessage(message: ServerMessage): void {
    if (message.kind === "event") {
      if (this.eventListeners.size === 0) {
        this.queuedEvents.push(message);
        if (this.queuedEvents.length > MAX_QUEUED_EVENTS) {
          this.queuedEvents.shift();
        }
        return;
      }

      this.notifyEventListeners(message);
      return;
    }

    if (message.kind === "failure") {
      if (message.requestId === null) {
        this.terminate(FlareLobbyError.fromPayload(message.error), 1002);
        return;
      }

      this.pending
        .get(message.requestId)
        ?.reject(FlareLobbyError.fromPayload(message.error, message.requestId));
      return;
    }

    this.pending.get(message.requestId)?.resolve(message.payload);
  }

  private notifyEventListeners(message: ServerEventEnvelope): void {
    for (const listener of this.eventListeners) {
      try {
        listener(message);
      } catch {
        // 利用者の listener 例外で通信路を壊さないようにします。
      }
    }
  }

  private removePending(requestId: RequestId): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }

    if (pending.signal !== undefined && pending.abortListener !== undefined) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    this.pending.delete(requestId);
  }

  private terminate(
    error: FlareLobbyError,
    closeCode?: number,
    closeReason?: string,
  ): void {
    if (this.closedState) {
      return;
    }

    this.closedState = true;
    this.closedError = error;
    this.socket.removeEventListener("open", this.handleOpen);
    this.socket.removeEventListener("message", this.handleMessage);
    this.socket.removeEventListener("error", this.handleError);
    this.socket.removeEventListener("close", this.handleClose);

    if (!this.opened) {
      this.rejectOpen(error);
    }

    const pendings = [...this.pending.values()];
    for (const pending of pendings) {
      try {
        pending.reject(error);
      } catch {
        // 利用者の reject 例外で後始末を止めないようにします。
      }
    }
    this.pending.clear();
    this.queuedEvents.length = 0;

    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // 切断通知の利用者例外で後始末を止めないようにします。
      }
    }
    this.closeListeners.clear();
    this.eventListeners.clear();
    this.onClosed();

    if (this.socket.readyState !== WEBSOCKET_CLOSED) {
      try {
        this.socket.close(closeCode, closeReason);
      } catch {
        // すでに閉じた WebSocket の例外は公開しません。
      }
    }
  }
}

/**
 * プロトコル Envelope を解釈せず、受信メッセージを JSON 値として配信する
 * WebSocket 接続です。Party イベント接続のような送信専用方向を持たない
 * 購読系の通信で使います。
 */
class RawJsonEventConnectionImpl implements RawJsonEventConnection {
  private readonly socket: WebSocket;
  private readonly onClosed: () => void;
  private readonly messageListeners = new Set<(value: JsonValue) => void>();
  private readonly closeListeners = new Set<(error: FlareLobbyError) => void>();
  private readonly queuedMessages: JsonValue[] = [];
  private readonly openPromise: Promise<void>;
  private resolveOpen!: () => void;
  private rejectOpen!: (error: FlareLobbyError) => void;
  private opened = false;
  private closedState = false;
  private closedByClient = false;
  private closedError: FlareLobbyError | undefined;

  public constructor(socket: WebSocket, onClosed: () => void) {
    this.socket = socket;
    this.onClosed = onClosed;
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });

    this.socket.addEventListener("open", this.handleOpen);
    this.socket.addEventListener("message", this.handleMessage);
    this.socket.addEventListener("error", this.handleError);
    this.socket.addEventListener("close", this.handleClose);

    if (this.socket.readyState === WEBSOCKET_OPEN) {
      queueMicrotask(this.handleOpen);
    }
  }

  public get closed(): boolean {
    return this.closedState || this.socket.readyState === WEBSOCKET_CLOSED;
  }

  public waitForOpen(signal?: AbortSignal): Promise<void> {
    if (signal === undefined) {
      return this.openPromise;
    }

    if (signal.aborted) {
      this.close();
      return Promise.reject(new FlareLobbyError("CANCELLED"));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = (): void => {
        this.close();
        settle(() => reject(new FlareLobbyError("CANCELLED")));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.openPromise.then(
        () => settle(resolve),
        (error: FlareLobbyError) => settle(() => reject(error)),
      );
    });
  }

  public onMessage(listener: (value: JsonValue) => void): () => void {
    if (this.closedState) {
      throw this.closedError ?? new FlareLobbyError("CANCELLED");
    }

    this.messageListeners.add(listener);
    if (this.queuedMessages.length > 0) {
      const queuedMessages = this.queuedMessages.splice(0);
      for (const value of queuedMessages) {
        this.notifyMessageListeners(value);
      }
    }
    return (): void => {
      this.messageListeners.delete(listener);
    };
  }

  public onClose(listener: (error: FlareLobbyError) => void): () => void {
    if (this.closedState) {
      listener(this.closedError ?? new FlareLobbyError("CONNECTION_FAILED"));
      return (): void => undefined;
    }

    this.closeListeners.add(listener);
    return (): void => {
      this.closeListeners.delete(listener);
    };
  }

  public close(code?: number, reason?: string): void {
    if (this.closedState) {
      return;
    }

    this.closedByClient = true;
    this.terminate(new FlareLobbyError("CANCELLED"), code, reason);
  }

  private readonly handleOpen = (): void => {
    if (this.closedState) {
      return;
    }

    this.opened = true;
    this.resolveOpen();
  };

  private readonly handleMessage = (event: Event): void => {
    if (this.closedState) {
      return;
    }

    const data = (event as MessageEvent).data;
    if (typeof data !== "string") {
      this.terminate(new FlareLobbyError("INVALID_MESSAGE"), 1002);
      return;
    }

    let value: JsonValue;
    try {
      value = JSON.parse(data) as JsonValue;
    } catch {
      this.terminate(new FlareLobbyError("INVALID_MESSAGE"), 1002);
      return;
    }

    if (this.messageListeners.size === 0) {
      // 接続直後の購読開始までの間に届いたメッセージは、リスナー登録時に
      // 一括で配信できるよう上限付きで保持します。
      this.queuedMessages.push(value);
      if (this.queuedMessages.length > MAX_QUEUED_MESSAGES) {
        this.queuedMessages.shift();
      }
      return;
    }

    this.notifyMessageListeners(value);
  };

  private notifyMessageListeners(value: JsonValue): void {
    for (const listener of this.messageListeners) {
      try {
        listener(value);
      } catch {
        // 利用者の listener 例外で通信路を壊さないようにします。
      }
    }
  }

  private readonly handleError = (): void => {
    this.terminate(new FlareLobbyError("CONNECTION_FAILED"));
  };

  private readonly handleClose = (event: Event): void => {
    if (this.closedState) {
      return;
    }

    this.terminate(
      this.closedByClient
        ? new FlareLobbyError("CANCELLED")
        : errorForWebSocketCloseCode((event as CloseEvent).code),
    );
  };

  private terminate(
    error: FlareLobbyError,
    closeCode?: number,
    closeReason?: string,
  ): void {
    if (this.closedState) {
      return;
    }

    this.closedState = true;
    this.closedError = error;
    this.socket.removeEventListener("open", this.handleOpen);
    this.socket.removeEventListener("message", this.handleMessage);
    this.socket.removeEventListener("error", this.handleError);
    this.socket.removeEventListener("close", this.handleClose);

    if (!this.opened) {
      this.rejectOpen(error);
    }

    // 閉じた接続の保持メッセージが後から配信されないように破棄します。
    this.queuedMessages.length = 0;

    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // 切断通知の利用者例外で後始末を止めないようにします。
      }
    }
    this.closeListeners.clear();
    this.messageListeners.clear();
    this.onClosed();

    if (this.socket.readyState !== WEBSOCKET_CLOSED) {
      try {
        this.socket.close(closeCode, closeReason);
      } catch {
        // すでに閉じた WebSocket の例外は公開しません。
      }
    }
  }
}

function normalizeEndpoint(endpoint: string | URL): URL {
  try {
    const url = new URL(endpoint.toString());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported endpoint protocol");
    }

    if (url.username !== "" || url.password !== "") {
      throw new Error("endpoint credentials are not allowed");
    }

    url.hash = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname += "/";
    }
    return url;
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "endpoint は http または https の URL で指定してください。",
    });
  }
}

function resolveHttpUrl(endpoint: URL, path: string | URL): URL {
  let url: URL;
  try {
    url = new URL(path.toString(), endpoint);
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isSameEndpoint(url, endpoint)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "接続先と同じ HTTP エンドポイントを指定してください。",
    });
  }

  return url;
}

function resolveWebSocketUrl(
  endpoint: URL,
  path: string | URL,
  lastRevision?: Revision,
): URL {
  let url: URL;
  try {
    url = new URL(path.toString(), endpoint);
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  if (
    (url.protocol !== "ws:" && url.protocol !== "wss:") ||
    !isSameEndpoint(url, endpoint)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "接続先と同じ WebSocket エンドポイントを指定してください。",
    });
  }

  if (
    lastRevision !== undefined &&
    (!Number.isSafeInteger(lastRevision) || lastRevision < 0)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "lastRevision は 0 以上の安全な整数で指定してください。",
    });
  }

  if (lastRevision !== undefined) {
    url.searchParams.set("lastRevision", String(lastRevision));
  }

  return url;
}

const COMPATIBLE_PROTOCOLS: Readonly<Record<string, "http:" | "https:">> = {
  "http:": "http:",
  "ws:": "http:",
  "https:": "https:",
  "wss:": "https:",
};

function isSameEndpoint(first: URL, second: URL): boolean {
  // http と ws、https と wss は同じ通信経路として比較します。
  const firstProtocol = COMPATIBLE_PROTOCOLS[first.protocol];
  return (
    firstProtocol !== undefined &&
    firstProtocol === COMPATIBLE_PROTOCOLS[second.protocol] &&
    first.hostname === second.hostname &&
    effectivePort(first) === effectivePort(second)
  );
}

function effectivePort(url: URL): string {
  if (url.port !== "") {
    return url.port;
  }

  return url.protocol === "http:" || url.protocol === "ws:" ? "80" : "443";
}

function createWebSocketProtocols(
  protocols: string | readonly string[] | undefined,
  token: string,
): readonly string[] {
  const requested =
    protocols === undefined
      ? []
      : typeof protocols === "string"
        ? [protocols]
        : [...protocols];

  if (requested.some((protocol) => !isNonEmptyString(protocol))) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "WebSocket の protocol は空でない文字列で指定してください。",
    });
  }

  const encodedToken = encodeBase64Url(token);
  return [
    ...new Set([
      DEFAULT_WEBSOCKET_PROTOCOL,
      ...requested,
      `${AUTHENTICATION_PROTOCOL_PREFIX}${encodedToken}`,
    ]),
  ];
}

function encodeBase64Url(value: string): string {
  try {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return globalThis
      .btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function getDefaultFetchImplementation(): FetchImplementation | undefined {
  return typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : undefined;
}

function getDefaultWebSocketConstructor(): WebSocketConstructor | undefined {
  return typeof globalThis.WebSocket === "function"
    ? (globalThis.WebSocket as WebSocketConstructor)
    : undefined;
}

async function readResponseBody(
  response: Response,
  requestId: RequestId | undefined,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: FlareLobbyError }
> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return {
      ok: false,
      error: createErrorWithRequestId("CONNECTION_FAILED", requestId),
    };
  }

  if (text.trim() === "") {
    return { ok: true, value: null };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      error: createErrorWithRequestId("INVALID_MESSAGE", requestId),
    };
  }
}

function normalizeHttpError(
  status: number,
  body:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: FlareLobbyError },
  requestId: RequestId | undefined,
): FlareLobbyError {
  if (!body.ok) {
    return body.error;
  }

  const payload = readErrorPayload(body.value);
  if (payload !== null) {
    return FlareLobbyError.fromPayload(payload, requestId);
  }

  switch (status) {
    case 400:
    case 422:
      return createErrorWithRequestId("INVALID_PAYLOAD", requestId);
    case 401:
      return createErrorWithRequestId("UNAUTHENTICATED", requestId);
    case 403:
      return createErrorWithRequestId("FORBIDDEN", requestId);
    case 409:
      return createErrorWithRequestId("CONFLICT", requestId);
    default:
      return createErrorWithRequestId("CONNECTION_FAILED", requestId);
  }
}

function readErrorPayload(value: unknown): FlareLobbyErrorPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const nestedError = value["error"];
  const candidate = isRecord(nestedError) ? nestedError : value;
  const code = candidate["code"];
  const message = candidate["message"];

  return isFlareLobbyErrorCode(code) && isNonEmptyString(message)
    ? { code, message }
    : null;
}

function isResponseLike(value: unknown): value is Response {
  return (
    isRecord(value) &&
    typeof value["ok"] === "boolean" &&
    typeof value["status"] === "number" &&
    typeof value["text"] === "function"
  );
}

function normalizeTimeoutOption(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message:
        "timeout は 1 以上 2147483647 以下の正の有限数、または null で指定してください。",
    });
  }

  return value;
}

function normalizeTimeoutDefault(value: unknown): number | undefined {
  const normalized = normalizeTimeoutOption(value);
  return normalized === null || normalized === undefined
    ? undefined
    : normalized;
}

function resolveTimeoutMs(
  operationTimeout: number | null | undefined,
  clientDefault: number | undefined,
): number | undefined {
  const effective =
    operationTimeout !== undefined ? operationTimeout : clientDefault;
  if (effective === undefined || effective === null) {
    return undefined;
  }
  return effective;
}

function normalizeClientError(
  error: unknown,
  fallbackCode: "CONNECTION_FAILED" | "CANCELLED",
): FlareLobbyError {
  return error instanceof FlareLobbyError
    ? error
    : new FlareLobbyError(fallbackCode);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new FlareLobbyError("CANCELLED");
  }
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error["name"] === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function errorForWebSocketCloseCode(code: number): FlareLobbyError {
  switch (code) {
    case 4001:
    case 4401:
      return new FlareLobbyError("UNAUTHENTICATED");
    case 1008:
    case 4003:
    case 4403:
      return new FlareLobbyError("FORBIDDEN");
    case 4009:
    case 4409:
      return new FlareLobbyError("CONFLICT");
    case 4410:
      return new FlareLobbyError("ROOM_FINISHED");
    default:
      return new FlareLobbyError("CONNECTION_FAILED");
  }
}

let fallbackRequestSequence = 0;

function createRequestId(): RequestId {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  fallbackRequestSequence += 1;
  return `request-${Date.now().toString(36)}-${fallbackRequestSequence.toString(36)}`;
}

function createErrorWithRequestId(
  code: FlareLobbyErrorCode,
  requestId: RequestId | undefined,
): FlareLobbyError {
  return requestId === undefined
    ? new FlareLobbyError(code)
    : new FlareLobbyError(code, { requestId });
}
