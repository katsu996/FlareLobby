import {
  decodeServerMessage,
  encodeProtocolMessage,
  FlareLobbyError,
  isFlareLobbyErrorCode,
  PROTOCOL_VERSION
} from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  ClientCommandEnvelope,
  FlareLobbyErrorCode,
  FlareLobbyApp,
  FlareLobbyErrorPayload,
  JsonValue,
  ProtocolEventType,
  RequestId,
  ServerEventEnvelope,
  ServerMessage
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
  Room,
  SpectatorRoom
} from "./custom-room.js";

const WEBSOCKET_OPEN = 1;
const WEBSOCKET_CLOSED = 3;
const DEFAULT_WEBSOCKET_PROTOCOL = "flarelobby.v1";
const AUTHENTICATION_PROTOCOL_PREFIX = "flarelobby.auth.";

/** 標準 fetch を差し替えるための関数契約です。 */
export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/** 標準 WebSocket を差し替えるためのコンストラクター契約です。 */
export type WebSocketConstructor = {
  new (url: string, protocols?: string | string[]): WebSocket;
};

/** WebSocket コンストラクターを関数として差し替える契約です。 */
export type WebSocketFactory = (
  url: string,
  protocols: readonly string[]
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
}

/** WebSocket 接続のオプションです。 */
export interface ClientWebSocketOptions {
  readonly signal?: AbortSignal;
  readonly protocols?: string | readonly string[];
  readonly knownEventTypes?: readonly ProtocolEventType[];
}

/** WebSocket コマンドのオプションです。 */
export interface ClientCommandOptions {
  readonly signal?: AbortSignal;
  /** 再送時に同じ処理結果を参照するための要求識別子です。 */
  readonly requestId?: RequestId;
}

/** クライアントの初期化設定です。 */
export interface FlareLobbyClientOptions<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
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
}

/** WebSocket イベントを受け取るコールバックです。 */
export type ClientEventListener = (
  event: ServerEventEnvelope
) => void;

/** 接続済み WebSocket の共通操作です。 */
export interface FlareLobbyWebSocketConnection<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly closed: boolean;
  send<TResponse = JsonValue>(
    command: string,
    payload: JsonValue,
    options?: ClientCommandOptions
  ): Promise<TResponse>;
  onEvent(listener: ClientEventListener): () => void;
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
    options?: ClientRequestOptions
  ): Promise<TResponse>;
  connect(
    path: string | URL,
    options?: ClientWebSocketOptions
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  /** `connect()` の説明的な別名です。 */
  connectWebSocket(
    path: string | URL,
    options?: ClientWebSocketOptions
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  createCustomRoom(
    options?: CustomRoomCreationOptions<TApp>
  ): Promise<HostRoom<TApp>>;
  joinCustomRoom(code: string): Promise<PlayerRoom<TApp>>;
  joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role: "spectator" }
  ): Promise<SpectatorRoom<TApp>>;
  joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role?: "player" }
  ): Promise<PlayerRoom<TApp>>;
  joinCustomRoom(
    options: CustomRoomJoinOptions
  ): Promise<Room<TApp>>;
  listCustomRooms(
    query?: CustomRoomListQuery
  ): Promise<CustomRoomListPage<TApp>>;
  dispose(): void;
  /** `dispose()` の説明的な別名です。 */
  destroy(): void;
}

/** 認証、HTTP、WebSocket の共通基盤を初期化します。 */
export function createFlareLobbyClient<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(
  options: FlareLobbyClientOptions<TApp>
): FlareLobbyClient<TApp> {
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
  private readonly connections = new Set<FlareLobbyWebSocketConnectionImpl>();
  private disposedState = false;

  public constructor(options: FlareLobbyClientOptions<TApp>) {
    if (!isRecord(options) || typeof options.getAccessToken !== "function") {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "endpoint と getAccessToken を指定してください。"
      });
    }

    this.endpointUrl = normalizeEndpoint(options.endpoint);
    this.endpoint = this.endpointUrl.href;
    this.getAccessToken = options.getAccessToken;
    this.fetchImplementation = options.fetch;
    this.webSocketConstructor = options.webSocket ?? options.WebSocket;
    this.webSocketFactory = options.webSocketFactory;
    this.requestIdFactory = options.requestIdFactory ?? createRequestId;
    this.customRoomApi = createCustomRoomApi<TApp>({
      request: this.request.bind(this),
      connect: this.connect.bind(this),
      connectWithToken: (path, options, token) =>
        this.connectWithToken(path, options, token)
    });
  }

  public get disposed(): boolean {
    return this.disposedState;
  }

  public async request<TResponse = JsonValue>(
    path: string | URL,
    options: ClientRequestOptions = {}
  ): Promise<TResponse> {
    this.assertActive();
    throwIfAborted(options.signal);

    const requestId = this.resolveHttpRequestId(options);
    const url = resolveHttpUrl(this.endpointUrl, path);
    const token = await this.readAccessToken();
    throwIfAborted(options.signal);

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");

    if (requestId !== undefined) {
      headers.set("Idempotency-Key", requestId);
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

      headers.set("Content-Type", "application/json");
    }

    const fetchImplementation =
      this.fetchImplementation ?? getDefaultFetchImplementation();

    if (fetchImplementation === undefined) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: options.method ?? "GET",
        headers,
        ...(body === undefined ? {} : { body }),
        ...(options.signal === undefined ? {} : { signal: options.signal })
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

  public async connect(
    path: string | URL,
    options: ClientWebSocketOptions = {}
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    return this.connectWithToken(path, options);
  }

  private async connectWithToken(
    path: string | URL,
    options: ClientWebSocketOptions = {},
    token?: string
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    this.assertActive();
    throwIfAborted(options.signal);

    const url = resolveWebSocketUrl(this.endpointUrl, path);
    const authenticationToken =
      token === undefined ? await this.readAccessToken() : token;
    throwIfAborted(options.signal);

    const protocols = createWebSocketProtocols(
      options.protocols,
      authenticationToken
    );
    const socket = this.createWebSocket(url, protocols);
    const connection = new FlareLobbyWebSocketConnectionImpl(
      socket,
      this.requestIdFactory,
      options.knownEventTypes,
      () => this.connections.delete(connection)
    );
    this.connections.add(connection);

    try {
      await connection.waitForOpen(options.signal);
      return connection as FlareLobbyWebSocketConnection<TApp>;
    } catch (error) {
      connection.close();
      this.connections.delete(connection);
      throw normalizeClientError(error, "CONNECTION_FAILED");
    }
  }

  public connectWebSocket(
    path: string | URL,
    options: ClientWebSocketOptions = {}
  ): Promise<FlareLobbyWebSocketConnection<TApp>> {
    return this.connect(path, options);
  }

  public createCustomRoom(
    options: CustomRoomCreationOptions<TApp> = {}
  ): Promise<HostRoom<TApp>> {
    return this.customRoomApi.createCustomRoom(options);
  }

  public joinCustomRoom(code: string): Promise<PlayerRoom<TApp>>;
  public joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role: "spectator" }
  ): Promise<SpectatorRoom<TApp>>;
  public joinCustomRoom(
    options: CustomRoomJoinOptions & { readonly role?: "player" }
  ): Promise<PlayerRoom<TApp>>;
  public joinCustomRoom(
    options: CustomRoomJoinOptions
  ): Promise<Room<TApp>>;
  public joinCustomRoom(
    codeOrOptions: string | CustomRoomJoinOptions
  ): Promise<Room<TApp>> {
    return this.customRoomApi.joinCustomRoom(codeOrOptions);
  }

  public listCustomRooms(
    query: CustomRoomListQuery = {}
  ): Promise<CustomRoomListPage<TApp>> {
    return this.customRoomApi.listCustomRooms(query);
  }

  public dispose(): void {
    if (this.disposedState) {
      return;
    }

    this.disposedState = true;
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
    options: ClientRequestOptions
  ): RequestId | undefined {
    const requestId =
      options.requestId ??
      (options.idempotent === true ? this.createRequestId() : undefined);

    if (requestId !== undefined && !isNonEmptyString(requestId)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "requestId は空でない文字列で指定してください。"
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
        this.webSocketConstructor ??
        getDefaultWebSocketConstructor();

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
}

class FlareLobbyWebSocketConnectionImpl
  implements FlareLobbyWebSocketConnection
{
  private readonly socket: WebSocket;
  private readonly requestIdFactory: () => RequestId;
  private readonly knownEventTypes: readonly ProtocolEventType[] | undefined;
  private readonly onClosed: () => void;
  private readonly pending = new Map<RequestId, PendingCommand>();
  private readonly eventListeners = new Set<ClientEventListener>();
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
            knownEventTypes: this.knownEventTypes
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

  private readonly handleClose = (): void => {
    if (this.closedState) {
      return;
    }

    this.terminate(
      this.closedByClient
        ? new FlareLobbyError("CANCELLED")
        : new FlareLobbyError("CONNECTION_FAILED")
    );
  };

  public constructor(
    socket: WebSocket,
    requestIdFactory: () => RequestId,
    knownEventTypes: readonly ProtocolEventType[] | undefined,
    onClosed: () => void
  ) {
    this.socket = socket;
    this.requestIdFactory = requestIdFactory;
    this.knownEventTypes = knownEventTypes;
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
        (error: FlareLobbyError) => settle(() => reject(error))
      );
    });
  }

  public async send<TResponse = JsonValue>(
    command: string,
    payload: JsonValue,
    options: ClientCommandOptions = {}
  ): Promise<TResponse> {
    if (this.closedState || this.socket.readyState !== WEBSOCKET_OPEN) {
      throw this.closedError ?? new FlareLobbyError("CONNECTION_FAILED");
    }

    if (!isNonEmptyString(command)) {
      throw new FlareLobbyError("INVALID_PAYLOAD", {
        message: "command は空でない文字列で指定してください。"
      });
    }

    throwIfAborted(options.signal);

    const requestId = this.createRequestId(options.requestId);
    const message: ClientCommandEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      kind: "command",
      requestId,
      command,
      payload
    };
    const encoded = encodeProtocolMessage(message);

    if (!encoded.ok) {
      throw encoded.error;
    }

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
        abortListener
      });

      if (options.signal !== undefined && abortListener !== undefined) {
        options.signal.addEventListener("abort", abortListener, {
          once: true
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
    return (): void => {
      this.eventListeners.delete(listener);
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
        message: "requestId は空でない文字列で指定してください。"
      });
    }
    return value;
  }

  private handleServerMessage(message: ServerMessage): void {
    if (message.kind === "event") {
      for (const listener of this.eventListeners) {
        try {
          listener(message);
        } catch {
          // 利用者の listener 例外で通信路を壊さないようにします。
        }
      }
      return;
    }

    if (message.kind === "failure") {
      if (message.requestId === null) {
        this.terminate(
          FlareLobbyError.fromPayload(message.error),
          1002
        );
        return;
      }

      this.pending
        .get(message.requestId)
        ?.reject(
          FlareLobbyError.fromPayload(message.error, message.requestId)
        );
      return;
    }

    this.pending.get(message.requestId)?.resolve(message.payload);
  }

  private removePending(requestId: RequestId): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }

    if (pending.signal !== undefined && pending.abortListener !== undefined) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    this.pending.delete(requestId);
  }

  private terminate(
    error: FlareLobbyError,
    closeCode?: number,
    closeReason?: string
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

    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
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
      message: "endpoint は http または https の URL で指定してください。"
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
      message: "接続先と同じ HTTP エンドポイントを指定してください。"
    });
  }

  return url;
}

function resolveWebSocketUrl(endpoint: URL, path: string | URL): URL {
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
      message: "接続先と同じ WebSocket エンドポイントを指定してください。"
    });
  }

  return url;
}

function isSameEndpoint(first: URL, second: URL): boolean {
  return (
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
  token: string
): readonly string[] {
  const requested =
    protocols === undefined
      ? []
      : typeof protocols === "string"
        ? [protocols]
        : [...protocols];

  if (requested.some((protocol) => !isNonEmptyString(protocol))) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "WebSocket の protocol は空でない文字列で指定してください。"
    });
  }

  const encodedToken = encodeBase64Url(token);
  return [...new Set([
    DEFAULT_WEBSOCKET_PROTOCOL,
    ...requested,
    `${AUTHENTICATION_PROTOCOL_PREFIX}${encodedToken}`
  ])];
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
  requestId: RequestId | undefined
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
      error: createErrorWithRequestId("CONNECTION_FAILED", requestId)
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
      error: createErrorWithRequestId("INVALID_MESSAGE", requestId)
    };
  }
}

function normalizeHttpError(
  status: number,
  body:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: FlareLobbyError },
  requestId: RequestId | undefined
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

function normalizeClientError(
  error: unknown,
  fallbackCode: "CONNECTION_FAILED" | "CANCELLED"
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
  return (
    isRecord(error) &&
    error["name"] === "AbortError"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
  requestId: RequestId | undefined
): FlareLobbyError {
  return requestId === undefined
    ? new FlareLobbyError(code)
    : new FlareLobbyError(code, { requestId });
}
