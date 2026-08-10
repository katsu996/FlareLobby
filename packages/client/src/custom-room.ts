import { FlareLobbyError } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  CustomRoomSnapshot,
  AppRoomMetadata,
  AppRoomSettings,
  FlareLobbyApp,
  GameMessageName,
  GameMessagePayload,
  JsonObject,
  JsonValue,
  ReadonlyDeep,
  RequestId,
  RoomSnapshot,
  RoomStatus,
  ServerEventEnvelope,
  Timestamp
} from "@flarelobby/core";

import type {
  ClientCommandOptions,
  ClientRequestOptions,
  ClientWebSocketOptions,
  FlareLobbyWebSocketConnection
} from "./client.js";

const ROOM_SNAPSHOT_EVENT = "room.snapshot";
const GAME_MESSAGE_EVENT = "game.message";

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
> {
  readonly id: string;
  readonly participantId: string;
  readonly participantRole: "player";
  readonly role: "player" | "host";
  readonly closed: boolean;
  readonly snapshot: RoomSnapshot<TApp>;
  setReady(ready: boolean, options?: RoomOperationOptions): Promise<RoomSnapshot<TApp>>;
  selectTeam(
    teamId: string | null,
    options?: RoomOperationOptions
  ): Promise<RoomSnapshot<TApp>>;
  send<TName extends GameMessageName<TApp>>(
    name: TName,
    payload: GameMessagePayload<TApp, TName>,
    options?: RoomOperationOptions
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
    options?: RoomOperationOptions
  ): Promise<RoomSnapshot<TApp>>;
  transferHost(
    targetParticipantId: string,
    options?: RoomOperationOptions
  ): Promise<RoomSnapshot<TApp>>;
  kick(
    target: string | RoomKickTarget,
    options?: RoomOperationOptions
  ): Promise<RoomSnapshot<TApp>>;
  startMatch(
    options?: RoomStateOperationOptions
  ): Promise<RoomSnapshot<TApp>>;
  close(options?: RoomStateOperationOptions): Promise<RoomSnapshot<TApp>>;
}

/** 観戦者として利用できる Room 操作です。 */
export interface SpectatorRoom<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
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

interface CustomRoomTransport<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  request<TResponse = JsonValue>(
    path: string | URL,
    options?: ClientRequestOptions
  ): Promise<TResponse>;
  connect(
    path: string | URL,
    options?: ClientWebSocketOptions
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
  connectWithToken(
    path: string | URL,
    options: ClientWebSocketOptions | undefined,
    token: string
  ): Promise<FlareLobbyWebSocketConnection<TApp>>;
}

export interface CustomRoomClientApi<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  createCustomRoom(
    options?: CustomRoomCreationOptions<TApp>
  ): Promise<HostRoom<TApp>>;
  joinCustomRoom(
    codeOrOptions: string | CustomRoomJoinOptions
  ): Promise<Room<TApp>>;
  listCustomRooms(
    query?: CustomRoomListQuery
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
    listCustomRooms: (query = {}) => listCustomRooms<TApp>(transport, query)
  };
}

async function createCustomRoom<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  options: CustomRoomCreationOptions<TApp>
): Promise<HostRoom<TApp>> {
  const result = parseCreationResult<TApp>(
    await transport.request<unknown>("/v1/custom-rooms", {
      method: "POST",
      body: toJsonValue(createCreationBody(options)),
      idempotent: true,
      ...requestOptions(options)
    })
  );

  return createRoomHandle(transport, result, "host", options.signal) as Promise<
    HostRoom<TApp>
  >;
}

async function joinCustomRoom<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  codeOrOptions: string | CustomRoomJoinOptions
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
      ...requestOptions(options)
    })
  );

  const role = result.role === "spectator" ? "spectator" : "player";
  return createRoomHandle(transport, result, role, options.signal);
}

async function listCustomRooms<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  query: CustomRoomListQuery
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
    requestSignalOptions(query.signal)
  );

  return parseListPage<TApp>(result);
}

function createCreationBody<TApp extends AnyFlareLobbyApp>(
  options: CustomRoomCreationOptions<TApp>
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
    settings: options.settings as unknown as JsonValue
  });
}

function createJoinBody(options: CustomRoomJoinOptions): JsonObject {
  if (
    options.invitationCode !== undefined &&
    options.code !== undefined &&
    options.invitationCode !== options.code
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "invitationCode と code が一致しません。"
    });
  }

  return compactJsonObject({
    requestId: options.requestId,
    roomId: options.roomId,
    invitationCode: options.invitationCode ?? options.code,
    role: options.role,
    participantType: options.participantType,
    password: options.password
  });
}

function requestOptions(
  options: Pick<CustomRoomCreationOptions, "requestId" | "signal">
): ClientRequestOptions {
  return {
    ...requestSignalOptions(options.signal),
    ...(options.requestId === undefined ? {} : { requestId: options.requestId })
  };
}

function requestSignalOptions(signal: AbortSignal | undefined): ClientRequestOptions {
  return signal === undefined ? {} : { signal };
}

function appendQueryValue(
  params: URLSearchParams,
  name: string,
  value: string | number | boolean | readonly string[] | undefined
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

async function createRoomHandle<TApp extends AnyFlareLobbyApp>(
  transport: CustomRoomTransport<TApp>,
  result: RoomConnectionResult<TApp>,
  initialRole: "host" | CustomRoomParticipantRole,
  signal: AbortSignal | undefined
): Promise<Room<TApp>> {
  const connection = await transport.connectWithToken(
    result.websocketUrl,
    {
      knownEventTypes: [ROOM_SNAPSHOT_EVENT, GAME_MESSAGE_EVENT],
      ...(signal === undefined ? {} : { signal })
    },
    result.joinToken
  );
  const room = new RoomImpl(
    transport,
    connection,
    result.roomId,
    result.participantId,
    initialRole === "host" ? "player" : initialRole,
    result.joinToken,
    result.snapshot
  );

  return room as unknown as Room<TApp>;
}

interface RoomConnectionResult<TApp extends AnyFlareLobbyApp> {
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
  value: unknown
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
  value: unknown
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
  value: unknown
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
    nextCursor: rawCursor as string | null
  });
}

class RoomImpl<TApp extends AnyFlareLobbyApp>
{
  private snapshotState: RoomSnapshot<TApp>;
  private closedState = false;
  private readonly participantRoleState: CustomRoomParticipantRole;
  private readonly unsubscribeEvents: () => void;

  public constructor(
    private readonly transport: CustomRoomTransport<TApp>,
    private readonly connection: FlareLobbyWebSocketConnection<TApp>,
    public readonly id: string,
    public readonly participantId: string,
    participantRole: CustomRoomParticipantRole,
    private readonly joinToken: string,
    snapshot: RoomSnapshot<TApp>
  ) {
    this.participantRoleState = participantRole;
    this.snapshotState = freezeSnapshot(snapshot);
    this.unsubscribeEvents = connection.onEvent((event) => {
      this.handleEvent(event);
    });
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
    return this.closedState || this.connection.closed;
  }

  public get snapshot(): RoomSnapshot<TApp> {
    return this.snapshotState;
  }

  public async setReady(
    ready: boolean,
    options: RoomOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertPlayer();
    return this.sendSnapshot("room.set_ready", { ready }, options);
  }

  public async selectTeam(
    teamId: string | null,
    options: RoomOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertPlayer();
    return this.sendSnapshot("room.select_team", { teamId }, options);
  }

  public async updateSettings(
    settings: AppRoomSettings<TApp>,
    options: RoomOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    return this.sendSnapshot(
      "room.update_settings",
      { settings: settings as unknown as JsonValue },
      options
    );
  }

  public async transferHost(
    targetParticipantId: string,
    options: RoomOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    return this.sendSnapshot(
      "room.transfer_host",
      { targetParticipantId },
      options
    );
  }

  public async kick(
    target: string | RoomKickTarget,
    options: RoomOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    const payload =
      typeof target === "string"
        ? { targetParticipantId: target }
        : compactJsonObject({
            targetParticipantId: target.participantId,
            targetPlayerId: target.playerId,
            reason: target.reason
          });
    return this.sendSnapshot("room.kick", payload, options);
  }

  public async startMatch(
    options: RoomStateOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    return this.sendSnapshot(
      "room.start_match",
      compactJsonObject({ at: options.at }),
      options
    );
  }

  public async send<TName extends GameMessageName<TApp>>(
    name: TName,
    payload: GameMessagePayload<TApp, TName>,
    options: RoomOperationOptions = {}
  ): Promise<void> {
    this.assertPlayer();
    await this.sendCommand(
      name,
      payload as unknown as JsonValue,
      options
    );
  }

  public async leave(
    options: RoomLeaveOptions = {}
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
          role: this.participantRoleState
        }),
        idempotent: true,
        ...requestOptions(options)
      }
    );

    if (!isRecord(result) || !isRoomSnapshot<TApp>(result["snapshot"])) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const snapshot = this.replaceSnapshot(result["snapshot"]);
    this.markClosed();
    return snapshot;
  }

  public async close(
    options: RoomStateOperationOptions = {}
  ): Promise<RoomSnapshot<TApp>> {
    this.assertHost();
    const snapshot = await this.sendSnapshot(
      "room.close",
      compactJsonObject({ at: options.at }),
      options
    );
    this.markClosed();
    return snapshot;
  }

  private assertOpen(): void {
    if (this.closedState) {
      throw new FlareLobbyError("CANCELLED");
    }

    if (this.connection.closed) {
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
    options: RoomOperationOptions
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
    options: RoomOperationOptions
  ): Promise<JsonValue> {
    this.assertOpen();
    return this.connection.send<JsonValue>(command, payload, options);
  }

  private handleEvent(event: ServerEventEnvelope): void {
    if (
      event.event !== ROOM_SNAPSHOT_EVENT ||
      !isRoomSnapshot<TApp>(event.payload)
    ) {
      // `game.message` は #16 の購読 API で扱うため、ここでは状態を変更しません。
      return;
    }

    if (
      event.revision !== (event.payload as RoomSnapshot<TApp>).revision ||
      event.revision < this.snapshotState.revision
    ) {
      return;
    }

    this.replaceSnapshot(event.payload);
  }

  private replaceSnapshot(value: unknown): RoomSnapshot<TApp> {
    if (!isRoomSnapshot<TApp>(value)) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const snapshot = freezeSnapshot(value as RoomSnapshot<TApp>);
    if (snapshot.revision >= this.snapshotState.revision) {
      this.snapshotState = snapshot;
    }
    return this.snapshotState;
  }

  private markClosed(): void {
    if (this.closedState) {
      return;
    }

    this.closedState = true;
    this.unsubscribeEvents();
    this.connection.close(1000, "room closed");
  }
}

function compactJsonObject(
  values: Readonly<Record<string, JsonValue | undefined>>
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

function isCustomRoomJoinMethod(
  value: unknown
): value is CustomRoomJoinMethod {
  return value === "public" || value === "invitation" || value === "password";
}

function isCustomRoomParticipantRole(
  value: unknown
): value is CustomRoomParticipantRole {
  return value === "player" || value === "spectator";
}

function isRoomSnapshot<TApp extends AnyFlareLobbyApp = FlareLobbyApp>(
  value: unknown
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
  participantId: string
): boolean {
  if (snapshot.room.kind !== "custom") {
    return false;
  }

  return (snapshot as CustomRoomSnapshot<TApp>).host.participantId === participantId;
}

function freezeSnapshot<TApp extends AnyFlareLobbyApp>(
  snapshot: RoomSnapshot<TApp>
): RoomSnapshot<TApp> {
  return deepFreeze(snapshot);
}

function deepFreeze<TValue>(value: TValue, seen = new WeakSet<object>()): TValue {
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
