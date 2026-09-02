import { classifyEventRevision, FlareLobbyError } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  CustomRoomSnapshot,
  AppRoomMetadata,
  AppRoomSettings,
  FlareLobbyErrorCode,
  FlareLobbyApp,
  GameMessageName,
  GameMessagePayload,
  JsonObject,
  JsonValue,
  ProtocolEventType,
  ReadonlyDeep,
  Revision,
  RequestId,
  RoomSnapshot,
  RoomStatus,
  ServerEventEnvelope,
  Timestamp,
} from "@flarelobby/core";

import type {
  ClientCommandOptions,
  ClientRequestOptions,
  ClientWebSocketOptions,
  FlareLobbyWebSocketConnection,
} from "./client.js";

const ROOM_SNAPSHOT_EVENT = "room.snapshot";
const GAME_MESSAGE_EVENT = "game.message";
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.2;

/** Room WebSocket の接続状態です。 */
export type RoomConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/** Room の自動再接続に使う待機と試行回数の設定です。 */
export interface RoomReconnectOptions {
  /** 初回切断後に行う再接続の最大試行回数です。 */
  readonly maxAttempts?: number;
  /** 指数バックオフの初回待機時間（ミリ秒）です。 */
  readonly baseDelayMs?: number;
  /** 指数バックオフの最大待機時間（ミリ秒）です。 */
  readonly maxDelayMs?: number;
  /** 待機時間へ適用する揺らぎの割合です。0 から 1 で指定します。 */
  readonly jitterRatio?: number;
}

/** Room のスナップショット購読者です。 */
export type RoomSnapshotListener<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> = (snapshot: RoomSnapshot<TApp>) => void;

/** Room のシステムイベント購読者です。 */
export type RoomEventListener<
  TEvent extends ProtocolEventType = ProtocolEventType,
> = (event: ServerEventEnvelope<TEvent>) => void;

/** ゲーム固有メッセージの送信者情報です。 */
export interface RoomMessageSender {
  readonly participantId: string;
  readonly role: CustomRoomParticipantRole;
}

/** Room で受信したゲーム固有メッセージです。 */
export interface RoomGameMessage<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
  TName extends GameMessageName<TApp> = GameMessageName<TApp>,
> {
  readonly name: TName;
  readonly payload: GameMessagePayload<TApp, TName>;
  readonly sender?: RoomMessageSender;
  readonly revision: Revision;
}

/** ゲーム固有メッセージ購読者です。 */
export type RoomMessageListener<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
  TName extends GameMessageName<TApp> = GameMessageName<TApp>,
> = (message: RoomGameMessage<TApp, TName>) => void;

/** 接続状態購読者です。 */
export type RoomConnectionStatusListener = (
  status: RoomConnectionStatus,
) => void;

/** Room の状態とイベントを購読する公開契約です。 */
export interface RoomSubscriptionApi<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly connectionStatus: RoomConnectionStatus;
  subscribe(listener: RoomSnapshotListener<TApp>): () => void;
  on<TEvent extends ProtocolEventType>(
    eventName: TEvent,
    listener: RoomEventListener<TEvent>,
  ): () => void;
  onMessage<TName extends GameMessageName<TApp>>(
    messageName: TName,
    listener: RoomMessageListener<TApp, TName>,
  ): () => void;
  onStatusChange(listener: RoomConnectionStatusListener): () => void;
}

/** カスタムルーム作成時に選択できる参加方式です。 */
export type CustomRoomJoinMethod = "public" | "invitation" | "password";

/** カスタムルーム参加者の役割です。 */
export type CustomRoomParticipantRole = "player" | "spectator";

/** Room ハンドルが利用者へ示す操作権限です。 */
export type RoomRole = "host" | "player" | "spectator";

/** カスタムルーム作成の公開オプションです。 */
export interface CustomRoomCreationOptions<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly requestId?: RequestId;
  readonly name?: string;
  /** `name` の説明的な別名です。 */
  readonly title?: string;
  readonly visibility?: "public" | "unlisted";
  /** `visibility` の説明的な別名です。 */
  readonly listing?: "public" | "unlisted";
  readonly joinMethod?: CustomRoomJoinMethod | "open" | "invite";
  /** `joinMethod` の入力別名です。 */
  readonly joinMode?: CustomRoomJoinMethod | "open" | "invite";
  readonly maxPlayers?: number;
  readonly maxSpectators?: number;
  readonly password?: string;
  readonly settings?: AppRoomSettings<TApp>;
  readonly signal?: AbortSignal;
  readonly reconnect?: RoomReconnectOptions;
}

/** カスタムルーム参加の公開オプションです。 */
export interface CustomRoomJoinOptions {
  readonly requestId?: RequestId;
  readonly roomId?: string;
  readonly invitationCode?: string;
  /** 招待コードの短い別名です。 */
  readonly code?: string;
  readonly role?: CustomRoomParticipantRole;
  /** `role` の説明的な別名です。 */
  readonly participantType?: CustomRoomParticipantRole;
  readonly password?: string;
  readonly signal?: AbortSignal;
  readonly reconnect?: RoomReconnectOptions;
}

/** 公開ルーム一覧の検索条件です。 */
export interface CustomRoomListQuery {
  readonly gameId?: string;
  readonly seasonId?: string;
  readonly mode?: string;
  readonly region?: string;
  readonly status?: RoomStatus | readonly RoomStatus[];
  /** 空き枠のある Room だけに絞り込みます。 */
  readonly available?: boolean;
  /** プレイヤー空き枠の最小数で絞り込みます。 */
  readonly availableSlots?: number;
  readonly limit?: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

/** 公開ルーム一覧で返す秘密情報を含まない要約です。 */
export interface CustomRoomSummary<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly id: string;
  readonly kind: "custom";
  readonly visibility: "public";
  readonly state: RoomStatus;
  readonly name?: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly spectatorCount?: number;
  readonly maxSpectators?: number;
  readonly availableSlots?: number;
  readonly settings?: ReadonlyDeep<AppRoomSettings<TApp>>;
  readonly metadata?: ReadonlyDeep<AppRoomMetadata<TApp>>;
}

/** 公開ルーム一覧のページです。 */
export interface CustomRoomListPage<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly rooms: readonly CustomRoomSummary<TApp>[];
  readonly nextCursor: string | null;
}

/** Room の WebSocket 操作に共通するオプションです。 */
export interface RoomOperationOptions extends ClientCommandOptions {}

/** Room の退出に使うオプションです。 */
export interface RoomLeaveOptions {
  readonly requestId?: RequestId;
  readonly signal?: AbortSignal;
}

/** Room の開始・閉鎖時刻を指定するオプションです。 */
export interface RoomStateOperationOptions extends RoomOperationOptions {
  readonly at?: Timestamp;
}

/** 強制退出対象です。文字列は participantId として扱います。 */
export interface RoomKickTarget {
  readonly participantId?: string;
  readonly playerId?: string;
  readonly reason?: string;
}

/** プレイヤーとして利用できる Room 操作です。 */
export interface PlayerRoom<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends RoomSubscriptionApi<TApp> {
  readonly id: string;
  readonly participantId: string;
  readonly participantRole: "player";
  readonly role: "player" | "host";
  readonly closed: boolean;
  readonly snapshot: RoomSnapshot<TApp>;
  setReady(
    ready: boolean,
    options?: RoomOperationOptions,
  ): Promise<RoomSnapshot<TApp>>;
  selectTeam(
    teamId: string | null,
    options?: RoomOperationOptions,
  ): Promise<RoomSnapshot<TApp>>;
  send<TName extends GameMessageName<TApp>>(
    name: TName,
    payload: GameMessagePayload<TApp, TName>,
    options?: RoomOperationOptions,
  ): Promise<void>;
  leave(options?: RoomLeaveOptions): Promise<RoomSnapshot<TApp>>;
}

/** ホストとして利用できる Room 操作です。 */
export interface HostRoom<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends PlayerRoom<TApp> {
  readonly role: "host";
  updateSettings(
    settings: AppRoomSettings<TApp>,
    options?: RoomOperationOptions,
  ): Promise<RoomSnapshot<TApp>>;
  transferHost(
    targetParticipantId: string,
    options?: RoomOperationOptions,
  ): Promise<RoomSnapshot<TApp>>;
  kick(
    target: string | RoomKickTarget,
    options?: RoomOperationOptions,
  ): Promise<RoomSnapshot<TApp>>;
  startMatch(options?: RoomStateOperationOptions): Promise<RoomSnapshot<TApp>>;
  close(options?: RoomStateOperationOptions): Promise<RoomSnapshot<TApp>>;
}

/** 観戦者として利用できる Room 操作です。 */
export interface SpectatorRoom<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends RoomSubscriptionApi<TApp> {
  readonly id: string;
  readonly participantId: string;
  readonly participantRole: "spectator";
  readonly role: "spectator";
  readonly closed: boolean;
  readonly snapshot: RoomSnapshot<TApp>;
  leave(options?: RoomLeaveOptions): Promise<RoomSnapshot<TApp>>;
}

/** 役割に応じて利用できる Room ハンドルです。 */
export type Room<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
  TRole extends RoomRole = RoomRole,
> = TRole extends "host"
  ? HostRoom<TApp>
  : TRole extends "player"
    ? PlayerRoom<TApp>
    : TRole extends "spectator"
      ? SpectatorRoom<TApp>
      : HostRoom<TApp> | PlayerRoom<TApp> | SpectatorRoom<TApp>;

export interface CustomRoomTransport<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  request<TResponse = JsonValue>(
    path: string | URL,
    options?: ClientRequestOptions,
  ): Promise<TResponse>;
  connect(
    path: string | URL,
    options?: ClientWebSocketOptions,
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  connectWithToken(
    path: string | URL,
    options: ClientWebSocketOptions | undefined,
    token: string,
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  readonly reconnectOptions?: RoomReconnectOptions;
}

export interface CustomRoomClientApi<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  createCustomRoom(
    options?: CustomRoomCreationOptions<TApp>,
  ): Promise<HostRoom<TApp>>;
  joinCustomRoom(
    codeOrOptions: string | CustomRoomJoinOptions,
  ): Promise<Room<TApp>>;
  listCustomRooms(
    query?: CustomRoomListQuery,
  ): Promise<CustomRoomListPage<TApp>>;
}

/** クライアント本体からカスタムルーム API を組み立てます。 */
export function createCustomRoomApi<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(transport: CustomRoomTransport<TApp>): CustomRoomClientApi<TApp> {
  return {
    createCustomRoom: (options = {}) =>
      createCustomRoom<TApp>(transport, options),
    joinCustomRoom: (codeOrOptions) =>
      joinCustomRoom<TApp>(transport, codeOrOptions),
    listCustomRooms: (query = {}) => listCustomRooms<TApp>(transport, query),
  };
}

async function createCustomRoom<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  options: CustomRoomCreationOptions<TApp>,
): Promise<HostRoom<TApp>> {
  const result = parseCreationResult<TApp>(
    await transport.request<unknown>("/v1/custom-rooms", {
      method: "POST",
      body: toJsonValue(createCreationBody(options)),
      idempotent: true,
      ...requestOptions(options),
    }),
  );

  return createRoomHandle(
    transport,
    result,
    "host",
    options.signal,
    options.reconnect,
  ) as Promise<HostRoom<TApp>>;
}

async function joinCustomRoom<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  codeOrOptions: string | CustomRoomJoinOptions,
): Promise<Room<TApp>> {
  const options: CustomRoomJoinOptions =
    typeof codeOrOptions === "string"
      ? { invitationCode: codeOrOptions }
      : codeOrOptions;
  const result = parseJoinResult<TApp>(
    await transport.request<unknown>("/v1/custom-rooms/join", {
      method: "POST",
      body: toJsonValue(createJoinBody(options)),
      idempotent: true,
      ...requestOptions(options),
    }),
  );

  const role = result.role === "spectator" ? "spectator" : "player";
  return createRoomHandle(
    transport,
    result,
    role,
    options.signal,
    options.reconnect,
  );
}

async function listCustomRooms<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  query: CustomRoomListQuery,
): Promise<CustomRoomListPage<TApp>> {
  const url = new URL("/v1/custom-rooms", "https://flarelobby.invalid/");
  appendQueryValue(url.searchParams, "gameId", query.gameId);
  appendQueryValue(url.searchParams, "seasonId", query.seasonId);
  appendQueryValue(url.searchParams, "mode", query.mode);
  appendQueryValue(url.searchParams, "region", query.region);
  appendQueryValue(url.searchParams, "status", query.status);
  appendQueryValue(url.searchParams, "available", query.available);
  appendQueryValue(url.searchParams, "availableSlots", query.availableSlots);
  appendQueryValue(url.searchParams, "limit", query.limit);
  appendQueryValue(url.searchParams, "cursor", query.cursor);

  const result = await transport.request<unknown>(
    `${url.pathname}${url.search}`,
    requestSignalOptions(query.signal),
  );

  return parseListPage<TApp>(result);
}

function createCreationBody<TApp extends AnyFlareLobbyApp>(
  options: CustomRoomCreationOptions<TApp>,
): JsonObject {
  return compactJsonObject({
    requestId: options.requestId,
    name: options.name,
    title: options.title,
    visibility: options.visibility,
    listing: options.listing,
    joinMethod: options.joinMethod,
    joinMode: options.joinMode,
    maxPlayers: options.maxPlayers,
    maxSpectators: options.maxSpectators,
    password: options.password,
    settings: options.settings as unknown as JsonValue,
  });
}

function createJoinBody(options: CustomRoomJoinOptions): JsonObject {
  if (
    options.invitationCode !== undefined &&
    options.code !== undefined &&
    options.invitationCode !== options.code
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "invitationCode と code が一致しません。",
    });
  }

  return compactJsonObject({
    requestId: options.requestId,
    roomId: options.roomId,
    invitationCode: options.invitationCode ?? options.code,
    role: options.role,
    participantType: options.participantType,
    password: options.password,
  });
}

function requestOptions(
  options: Pick<CustomRoomCreationOptions, "requestId" | "signal">,
): ClientRequestOptions {
  return {
    ...requestSignalOptions(options.signal),
    ...(options.requestId === undefined
      ? {}
      : { requestId: options.requestId }),
  };
}

function requestSignalOptions(
  signal: AbortSignal | undefined,
): ClientRequestOptions {
  return signal === undefined ? {} : { signal };
}

function appendQueryValue(
  params: URLSearchParams,
  name: string,
  value: string | number | boolean | readonly string[] | undefined,
): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      params.append(name, item);
    }
    return;
  }

  params.set(name, String(value));
}

export async function createRoomHandle<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  result: RoomConnectionResult<TApp>,
  initialRole: "host" | CustomRoomParticipantRole,
  signal: AbortSignal | undefined,
  reconnectOptions: RoomReconnectOptions | undefined,
): Promise<Room<TApp>> {
  const connection = await transport.connectWithToken(
    result.websocketUrl,
    {
      knownEventTypes: [ROOM_SNAPSHOT_EVENT, GAME_MESSAGE_EVENT],
      ...(signal === undefined ? {} : { signal }),
    },
    result.joinToken,
  );
  const room = new RoomImpl(
    transport,
    connection,
    result.roomId,
    result.participantId,
    initialRole === "host" ? "player" : initialRole,
    result.joinToken,
    result.websocketUrl,
    result.snapshot,
    reconnectOptions ?? transport.reconnectOptions,
  );

  return room as unknown as Room<TApp>;
}

export interface RoomConnectionResult<TApp extends AnyFlareLobbyApp> {
  readonly roomId: string;
  readonly participantId: string;
  readonly role: CustomRoomParticipantRole;
  readonly joinToken: string;
  readonly websocketUrl: string;
  readonly snapshot: RoomSnapshot<TApp>;
}

interface RoomCreationConnectionResult<
  TApp extends AnyFlareLobbyApp,
> extends RoomConnectionResult<TApp> {
  readonly role: "player";
  readonly joinMethod: CustomRoomJoinMethod;
  readonly invitationCode: string | null;
}

function parseCreationResult<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): RoomCreationConnectionResult<TApp> {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["participantId"]) ||
    value["role"] !== "player" ||
    !isCustomRoomJoinMethod(value["joinMethod"]) ||
    (value["invitationCode"] !== null &&
      !isNonEmptyString(value["invitationCode"])) ||
    !isNonEmptyString(value["joinToken"]) ||
    !isNonEmptyString(value["websocketUrl"]) ||
    !isRoomSnapshot<TApp>(value["snapshot"])
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return value as unknown as RoomCreationConnectionResult<TApp>;
}

function parseJoinResult<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): RoomConnectionResult<TApp> {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["participantId"]) ||
    !isCustomRoomParticipantRole(value["role"]) ||
    !isNonEmptyString(value["joinToken"]) ||
    !isNonEmptyString(value["websocketUrl"]) ||
    !isRoomSnapshot<TApp>(value["snapshot"])
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return value as unknown as RoomConnectionResult<TApp>;
}

function parseListPage<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): CustomRoomListPage<TApp> {
  if (!isRecord(value)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  const rawRooms = value["rooms"] ?? value["items"];
  const rawCursor = value["nextCursor"] ?? value["cursor"] ?? null;

  if (
    !Array.isArray(rawRooms) ||
    !rawRooms.every((room) => isRecord(room)) ||
    (rawCursor !== null && !isNonEmptyString(rawCursor))
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return deepFreeze({
    rooms: rawRooms as unknown as readonly CustomRoomSummary<TApp>[],
    nextCursor: rawCursor as string | null,
  });
}

interface NormalizedRoomReconnectOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

interface ParsedRoomSnapshotEvent<TApp extends AnyFlareLobbyApp> {
  readonly snapshot: RoomSnapshot<TApp>;
  readonly resumeToken?: string;
}

class RoomImpl<
  TApp extends AnyFlareLobbyApp,
> implements RoomSubscriptionApi<TApp> {
  private snapshotState: RoomSnapshot<TApp>;
  private statusState: RoomConnectionStatus = "connecting";
  private closedState = false;
  private readonly participantRoleState: CustomRoomParticipantRole;
  private connection: FlareLobbyWebSocketConnection<TApp>;
  private unsubscribeConnectionEvents: () => void = (): void => undefined;
  private unsubscribeConnectionClose: () => void = (): void => undefined;
  private resumeTokenState: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private reconnectingState = false;
  private closeRequestedForReconnect:
    | FlareLobbyWebSocketConnection<TApp>
    | undefined;
  private readonly reconnectOptions: NormalizedRoomReconnectOptions;
  private readonly snapshotListeners = new Set<RoomSnapshotListener<TApp>>();
  private readonly eventListeners = new Map<string, Set<RoomEventListener>>();
  private readonly messageListeners = new Map<
    string,
    Set<RoomMessageListener<TApp>>
  >();
  private readonly statusListeners = new Set<RoomConnectionStatusListener>();

  public constructor(
    private readonly transport: CustomRoomTransport<TApp>,
    connection: FlareLobbyWebSocketConnection<TApp>,
    public readonly id: string,
    public readonly participantId: string,
    participantRole: CustomRoomParticipantRole,
    private readonly joinToken: string,
    private readonly websocketUrl: string,
    snapshot: RoomSnapshot<TApp>,
    reconnectOptions: RoomReconnectOptions | undefined,
  ) {
    this.participantRoleState = participantRole;
    this.snapshotState = freezeSnapshot(snapshot);
    this.connection = connection;
    this.reconnectOptions = normalizeReconnectOptions(reconnectOptions);
    this.attachConnection(connection);
    if (!this.reconnectingState && !this.closedState) {
      this.setStatus("connected");
    }
  }

  public get participantRole(): CustomRoomParticipantRole {
    return this.participantRoleState;
  }

  public get role(): RoomRole {
    if (this.participantRoleState === "spectator") {
      return "spectator";
    }

    return isHostSnapshot(this.snapshotState, this.participantId)
      ? "host"
      : "player";
  }

  public get closed(): boolean {
    return this.closedState;
  }

  public get connectionStatus(): RoomConnectionStatus {
    return this.statusState;
  }

  public get snapshot(): RoomSnapshot<TApp> {
    return this.snapshotState;
  }

  public subscribe(listener: RoomSnapshotListener<TApp>): () => void {
    this.assertSubscriptionOpen();
    this.snapshotListeners.add(listener);
    return (): void => {
      this.snapshotListeners.delete(listener);
    };
  }

  public on<TEvent extends ProtocolEventType>(
    eventName: TEvent,
    listener: RoomEventListener<TEvent>,
  ): () => void {
    this.assertSubscriptionOpen();
    if (!isNonEmptyString(eventName)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const listeners =
      this.eventListeners.get(eventName) ?? new Set<RoomEventListener>();
    listeners.add(listener as RoomEventListener);
    this.eventListeners.set(eventName, listeners);
    return (): void => {
      listeners.delete(listener as RoomEventListener);
      if (listeners.size === 0) {
        this.eventListeners.delete(eventName);
      }
    };
  }

  public onMessage<TName extends GameMessageName<TApp>>(
    messageName: TName,
    listener: RoomMessageListener<TApp, TName>,
  ): () => void {
    this.assertSubscriptionOpen();
    if (!isNonEmptyString(messageName)) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }

    const listeners =
      this.messageListeners.get(messageName) ??
      new Set<RoomMessageListener<TApp>>();
    listeners.add(listener as RoomMessageListener<TApp>);
    this.messageListeners.set(messageName, listeners);
    return (): void => {
      listeners.delete(listener as RoomMessageListener<TApp>);
      if (listeners.size === 0) {
        this.messageListeners.delete(messageName);
      }
    };
  }

  public onStatusChange(listener: RoomConnectionStatusListener): () => void {
    this.statusListeners.add(listener);
    return (): void => {
      this.statusListeners.delete(listener);
    };
  }

  public async setReady(
    ready: boolean,
    options: RoomOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertPlayer();
    return this.sendSnapshot("room.set_ready", { ready }, options);
  }

  public async selectTeam(
    teamId: string | null,
    options: RoomOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertPlayer();
    return this.sendSnapshot("room.select_team", { teamId }, options);
  }

  public async updateSettings(
    settings: AppRoomSettings<TApp>,
    options: RoomOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    return this.sendSnapshot(
      "room.update_settings",
      { settings: settings as unknown as JsonValue },
      options,
    );
  }

  public async transferHost(
    targetParticipantId: string,
    options: RoomOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    return this.sendSnapshot(
      "room.transfer_host",
      { targetParticipantId },
      options,
    );
  }

  public async kick(
    target: string | RoomKickTarget,
    options: RoomOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    const payload =
      typeof target === "string"
        ? { targetParticipantId: target }
        : compactJsonObject({
            targetParticipantId: target.participantId,
            targetPlayerId: target.playerId,
            reason: target.reason,
          });
    return this.sendSnapshot("room.kick", payload, options);
  }

  public async startMatch(
    options: RoomStateOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    return this.sendSnapshot(
      "room.start_match",
      compactJsonObject({ at: options.at }),
      options,
    );
  }

  public async send<TName extends GameMessageName<TApp>>(
    name: TName,
    payload: GameMessagePayload<TApp, TName>,
    options: RoomOperationOptions = {},
  ): Promise<void> {
    this.assertPlayer();
    await this.sendCommand(name, payload as unknown as JsonValue, options);
  }

  public async leave(
    options: RoomLeaveOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertOpen();
    const result = await this.transport.request<unknown>(
      "/v1/custom-rooms/leave",
      {
        method: "POST",
        body: toJsonValue({
          requestId: options.requestId,
          roomId: this.id,
          joinToken: this.joinToken,
          participantId: this.participantId,
          role: this.participantRoleState,
        }),
        idempotent: true,
        ...requestOptions(options),
      },
    );

    if (!isRecord(result) || !isRoomSnapshot<TApp>(result["snapshot"])) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const snapshot = this.replaceSnapshot(result["snapshot"]);
    this.markClosed();
    return snapshot;
  }

  public async close(
    options: RoomStateOperationOptions = {},
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    const snapshot = await this.sendSnapshot(
      "room.close",
      compactJsonObject({ at: options.at }),
      options,
    );
    this.markClosed();
    return snapshot;
  }

  private assertSubscriptionOpen(): void {
    if (this.closedState) {
      throw new FlareLobbyError("CANCELLED");
    }
  }

  private assertOpen(): void {
    if (this.closedState) {
      throw new FlareLobbyError("CANCELLED");
    }

    if (this.statusState !== "connected" || this.connection.closed) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }
  }

  private assertPlayer(): void {
    this.assertOpen();
    if (this.participantRoleState !== "player") {
      throw new FlareLobbyError("FORBIDDEN");
    }
  }

  private assertHost(): void {
    this.assertPlayer();
    if (this.role !== "host") {
      throw new FlareLobbyError("FORBIDDEN");
    }
  }

  private async sendSnapshot(
    command: string,
    payload: JsonObject,
    options: RoomOperationOptions,
  ): Promise<RoomSnapshot<TApp>> {
    const result = await this.sendCommand(command, payload, options);
    if (!isRoomSnapshot<TApp>(result)) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    return this.replaceSnapshot(result);
  }

  private async sendCommand(
    command: string,
    payload: JsonValue,
    options: RoomOperationOptions,
  ): Promise<JsonValue> {
    this.assertOpen();
    return this.connection.send<JsonValue>(command, payload, options);
  }

  private attachConnection(
    connection: FlareLobbyWebSocketConnection<TApp>,
  ): void {
    this.unsubscribeConnectionEvents();
    this.unsubscribeConnectionClose();
    this.connection = connection;
    this.unsubscribeConnectionClose = connection.onClose((error) => {
      this.handleConnectionClosed(connection, error);
    });

    if (this.closedState || connection.closed) {
      return;
    }

    this.unsubscribeConnectionEvents = connection.onEvent((event) => {
      this.handleEvent(event);
    });
  }

  private handleConnectionClosed(
    connection: FlareLobbyWebSocketConnection<TApp>,
    error: FlareLobbyError,
  ): void {
    if (this.closedState || connection !== this.connection) {
      return;
    }

    if (this.closeRequestedForReconnect === connection) {
      this.closeRequestedForReconnect = undefined;
      this.scheduleReconnect();
      return;
    }

    if (!isRetryableReconnectError(error.code)) {
      this.markDisconnected();
      return;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedState) {
      return;
    }

    if (!this.reconnectingState) {
      this.reconnectingState = true;
      this.reconnectAttempt = 0;
      this.setStatus("reconnecting");
    }

    if (this.reconnectTimer !== undefined) {
      return;
    }

    if (this.reconnectAttempt >= this.reconnectOptions.maxAttempts) {
      this.markDisconnected();
      return;
    }

    const delay = this.reconnectDelay(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.closedState || !this.reconnectingState) {
      return;
    }

    this.reconnectAttempt += 1;
    const token = this.resumeTokenState ?? this.joinToken;
    const lastRevision =
      this.resumeTokenState === undefined
        ? undefined
        : this.snapshotState.revision;

    try {
      const connection = await this.transport.connectWithToken(
        this.websocketUrl,
        {
          knownEventTypes: [ROOM_SNAPSHOT_EVENT, GAME_MESSAGE_EVENT],
          ...(lastRevision === undefined ? {} : { lastRevision }),
        },
        token,
      );

      if (this.closedState) {
        connection.close(1000, "room closed");
        return;
      }

      this.attachConnection(connection);
      if (
        this.closedState ||
        this.connection !== connection ||
        connection.closed
      ) {
        return;
      }

      this.reconnectingState = false;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    } catch (error) {
      const normalized = normalizeReconnectError(error);
      if (!isRetryableReconnectError(normalized.code)) {
        this.markDisconnected();
        return;
      }

      if (this.reconnectAttempt >= this.reconnectOptions.maxAttempts) {
        this.markDisconnected();
        return;
      }

      this.scheduleReconnect();
    }
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

  private handleEvent(event: ServerEventEnvelope): void {
    if (event.event === ROOM_SNAPSHOT_EVENT) {
      const parsed = parseRoomSnapshotEvent<TApp>(event.payload);
      if (parsed === null || event.revision !== parsed.snapshot.revision) {
        this.requestResync();
        return;
      }

      if (parsed.resumeToken !== undefined) {
        this.resumeTokenState = parsed.resumeToken;
      }

      const revisionStatus = classifyEventRevision(
        this.snapshotState.revision,
        event.revision,
      );
      if (revisionStatus === "gap" || revisionStatus === "out_of_order") {
        this.requestResync();
        return;
      }

      if (revisionStatus === "next") {
        this.replaceSnapshot(parsed.snapshot);
      }
      this.notifyEventListeners(event);
      return;
    }

    this.notifyEventListeners(event);
    if (event.event !== GAME_MESSAGE_EVENT) {
      return;
    }

    const message = parseRoomGameMessage<TApp>(event);
    if (message === null) {
      return;
    }

    for (const listener of this.messageListeners.get(message.name) ?? []) {
      try {
        listener(message as RoomGameMessage<TApp>);
      } catch {
        // 1 件のメッセージ購読者の例外で他の購読者を止めません。
      }
    }
  }

  private notifyEventListeners(event: ServerEventEnvelope): void {
    for (const listener of this.eventListeners.get(event.event) ?? []) {
      try {
        listener(event);
      } catch {
        // 購読者の例外で状態適用や他の購読者を止めません。
      }
    }
  }

  private replaceSnapshot(value: unknown): RoomSnapshot<TApp> {
    if (!isRoomSnapshot<TApp>(value)) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const snapshot = freezeSnapshot(value as RoomSnapshot<TApp>);
    if (snapshot.revision <= this.snapshotState.revision) {
      return this.snapshotState;
    }

    this.snapshotState = snapshot;
    for (const listener of this.snapshotListeners) {
      try {
        listener(snapshot);
      } catch {
        // 購読者の例外で内部スナップショットを壊しません。
      }
    }
    return this.snapshotState;
  }

  private requestResync(): void {
    if (this.closedState || this.reconnectingState) {
      return;
    }

    this.reconnectingState = true;
    this.reconnectAttempt = 0;
    this.setStatus("reconnecting");
    this.closeRequestedForReconnect = this.connection;
    this.connection.close(1000, "room resync");
  }

  private setStatus(status: RoomConnectionStatus): void {
    if (this.statusState === status) {
      return;
    }

    this.statusState = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // 状態購読者の例外で他の購読者を止めません。
      }
    }
  }

  private markDisconnected(): void {
    if (this.closedState) {
      return;
    }

    this.cancelReconnectTimer();
    this.reconnectingState = false;
    this.closedState = true;
    this.unsubscribeConnectionEvents();
    this.unsubscribeConnectionClose();
    this.setStatus("disconnected");
    this.clearListeners();
  }

  private markClosed(): void {
    if (this.closedState) {
      return;
    }

    this.cancelReconnectTimer();
    this.reconnectingState = false;
    this.closedState = true;
    this.unsubscribeConnectionEvents();
    this.unsubscribeConnectionClose();
    this.setStatus("disconnected");
    this.clearListeners();
    this.connection.close(1000, "room closed");
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer === undefined) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearListeners(): void {
    this.snapshotListeners.clear();
    this.eventListeners.clear();
    this.messageListeners.clear();
    this.statusListeners.clear();
  }
}

function normalizeReconnectOptions(
  options: RoomReconnectOptions | undefined,
): NormalizedRoomReconnectOptions {
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

  if (
    typeof jitterRatio !== "number" ||
    !Number.isFinite(jitterRatio) ||
    jitterRatio < 0 ||
    jitterRatio > 1
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "jitterRatio は 0 から 1 の範囲で指定してください。",
    });
  }

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio,
  };
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
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "再接続設定は安全な範囲の整数で指定してください。",
    });
  }
  return normalized;
}

function isRetryableReconnectError(code: FlareLobbyErrorCode): boolean {
  return code === "CONNECTION_FAILED" || code === "CANCELLED";
}

function normalizeReconnectError(error: unknown): FlareLobbyError {
  return error instanceof FlareLobbyError
    ? error
    : new FlareLobbyError("CONNECTION_FAILED");
}

function parseRoomSnapshotEvent<TApp extends AnyFlareLobbyApp>(
  value: unknown,
): ParsedRoomSnapshotEvent<TApp> | null {
  if (!isRoomSnapshot<TApp>(value)) {
    return null;
  }

  const resumeToken =
    isRecord(value) && isNonEmptyString(value["resumeToken"])
      ? value["resumeToken"]
      : undefined;

  return {
    snapshot: value,
    ...(resumeToken === undefined ? {} : { resumeToken }),
  };
}

function parseRoomGameMessage<TApp extends AnyFlareLobbyApp>(
  event: ServerEventEnvelope,
): RoomGameMessage<TApp> | null {
  if (!isRecord(event.payload)) {
    return null;
  }

  const name = event.payload["name"];
  if (!isNonEmptyString(name) || !Object.hasOwn(event.payload, "payload")) {
    return null;
  }

  const senderValue = event.payload["sender"];
  const sender =
    isRecord(senderValue) &&
    isNonEmptyString(senderValue["participantId"]) &&
    isCustomRoomParticipantRole(senderValue["role"])
      ? {
          participantId: senderValue["participantId"],
          role: senderValue["role"],
        }
      : undefined;

  return deepFreeze({
    name,
    payload: event.payload["payload"] as RoomGameMessage<TApp>["payload"],
    revision: event.revision,
    ...(sender === undefined ? {} : { sender }),
  }) as RoomGameMessage<TApp>;
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

function toJsonValue(value: JsonValue | object): JsonValue {
  return value as JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCustomRoomJoinMethod(value: unknown): value is CustomRoomJoinMethod {
  return value === "public" || value === "invitation" || value === "password";
}

function isCustomRoomParticipantRole(
  value: unknown,
): value is CustomRoomParticipantRole {
  return value === "player" || value === "spectator";
}

function isRoomSnapshot<TApp extends AnyFlareLobbyApp = FlareLobbyApp>(
  value: unknown,
): value is RoomSnapshot<TApp> {
  if (!isRecord(value)) {
    return false;
  }

  const state = value["state"];
  const room = value["room"];
  return (
    Number.isSafeInteger(value["revision"]) &&
    (value["revision"] as number) >= 0 &&
    Array.isArray(value["participants"]) &&
    Array.isArray(value["teams"]) &&
    isRecord(state) &&
    isNonEmptyString(state["status"]) &&
    isRecord(room) &&
    isNonEmptyString(room["id"]) &&
    (room["kind"] === "custom" || room["kind"] === "match")
  );
}

function isHostSnapshot<TApp extends AnyFlareLobbyApp>(
  snapshot: RoomSnapshot<TApp>,
  participantId: string,
): boolean {
  if (snapshot.room.kind !== "custom") {
    return false;
  }

  return (
    (snapshot as CustomRoomSnapshot<TApp>).host.participantId === participantId
  );
}

function freezeSnapshot<TApp extends AnyFlareLobbyApp>(
  snapshot: RoomSnapshot<TApp>,
): RoomSnapshot<TApp> {
  return deepFreeze(snapshot);
}

function deepFreeze<TValue>(
  value: TValue,
  seen = new WeakSet<object>(),
): TValue {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  Object.freeze(value);
  return value;
}
