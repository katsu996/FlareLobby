import { FlareLobbyError, isFlareLobbyErrorCode } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  AppRoomSettings,
  FlareLobbyApp,
  JsonObject,
  JsonValue,
  Principal,
  ProtocolResult,
  RequestId,
  RoomSnapshot,
} from "@flarelobby/core";

import { consumeRoomCreationRateLimit } from "./config.js";
import {
  registerCustomRoomInvitation,
  resolveCustomRoomInvitation,
} from "./custom-room-index.js";
import type { FlareLobbyBindings, FlareLobbyConfiguration } from "./config.js";
import {
  authorizeGatewayOperation,
  issueJoinToken,
  readValidatedJsonBody,
  verifyJoinToken,
} from "./security.js";
import type {
  AuthenticatedGatewayRequest,
  FlareLobbyRoomParticipantRole,
} from "./security.js";
import {
  readObservabilityContext,
  withObservabilityRequestId,
} from "./observability.js";
import type {
  RoomInitializationOptions,
  RoomJoinMethod,
  RoomParticipantJoinResult,
  RoomParticipantLeaveOptions,
  RoomParticipantLeaveResult,
  RoomProcessedCommand,
  RoomProcessedCommandOptions,
  RoomParticipantRole,
} from "./room.js";
import type { FlareLobbyObservabilityContext } from "./observability.js";

const CUSTOM_ROOM_CREATE_COMMAND = "custom_room.create";
const CUSTOM_ROOM_JOIN_COMMAND = "custom_room.join";
const CUSTOM_ROOM_LEAVE_COMMAND = "custom_room.leave";
const DEFAULT_ROOM_NAME = "ルーム";
const DEFAULT_JOIN_TOKEN_TTL_MS = 10 * 60 * 1_000;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ROOM_NAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 128;
const INVITATION_CODE_LENGTH = 6;
const INVITATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** カスタムルーム作成要求で選択できる参加方式です。 */
export type CustomRoomJoinMethod = RoomJoinMethod;

/** カスタムルーム内の参加者役割です。 */
export type CustomRoomParticipantRole = FlareLobbyRoomParticipantRole;

/** Gateway のカスタムルーム作成入力です。省略項目は設定済みの既定値を使います。 */
export interface CustomRoomCreationInput<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly requestId?: RequestId;
  readonly name?: string;
  /** `name` の説明的な入力別名です。 */
  readonly title?: string;
  readonly visibility?: "public" | "unlisted";
  /** `visibility` の説明的な入力別名です。 */
  readonly listing?: "public" | "unlisted";
  readonly joinMethod?: CustomRoomJoinMethod | "open" | "invite";
  /** `joinMethod` の入力別名です。 */
  readonly joinMode?: CustomRoomJoinMethod | "open" | "invite";
  readonly maxPlayers?: number;
  readonly maxSpectators?: number;
  /** `joinMethod: "password"` のときだけ指定します。 */
  readonly password?: string;
  readonly settings?: AppRoomSettings<TApp>;
}

/** `CustomRoomCreationInput` の説明的な別名です。 */
export type CustomRoomCreationOptions<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> = CustomRoomCreationInput<TApp>;

/** カスタムルーム作成の成功結果です。 */
export interface CustomRoomCreationResult<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly roomId: string;
  /** 作成者へ割り当てられたホスト参加者の識別子です。 */
  readonly participantId?: string;
  /** 作成者の役割です。 */
  readonly role?: CustomRoomParticipantRole;
  readonly joinMethod: CustomRoomJoinMethod;
  readonly invitationCode: string | null;
  readonly joinToken: string;
  readonly websocketUrl: string;
  readonly snapshot: RoomSnapshot<TApp>;
}

/** `CustomRoomCreationResult` の説明的な別名です。 */
export type CustomRoomCreationResponse<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> = CustomRoomCreationResult<TApp>;

/** カスタムルーム参加要求です。 */
export interface CustomRoomJoinInput {
  readonly requestId?: RequestId;
  readonly roomId?: string;
  /** `roomId` の代わりに指定できる招待コードです。 */
  readonly invitationCode?: string;
  readonly role?: CustomRoomParticipantRole;
  /** `role` の説明的な入力別名です。 */
  readonly participantType?: CustomRoomParticipantRole;
  readonly password?: string;
}

/** `CustomRoomJoinInput` の説明的な別名です。 */
export type CustomRoomJoinOptions = CustomRoomJoinInput;

/** カスタムルーム参加の成功結果です。 */
export interface CustomRoomJoinResult<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly roomId: string;
  readonly participantId: string;
  readonly role: CustomRoomParticipantRole;
  readonly joinToken: string;
  readonly websocketUrl: string;
  readonly snapshot: RoomSnapshot<TApp>;
}

/** `CustomRoomJoinResult` の説明的な別名です。 */
export type CustomRoomJoinResponse<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> = CustomRoomJoinResult<TApp>;

/** カスタムルーム退出要求です。 */
export interface CustomRoomLeaveInput {
  readonly requestId?: RequestId;
  readonly roomId: string;
  readonly joinToken?: string;
  /** `joinToken` の入力別名です。 */
  readonly token?: string;
  readonly participantId?: string;
  readonly role?: CustomRoomParticipantRole;
}

/** `CustomRoomLeaveInput` の説明的な別名です。 */
export type CustomRoomLeaveOptions = CustomRoomLeaveInput;

/** カスタムルーム退出の成功結果です。 */
export interface CustomRoomLeaveResult<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> {
  readonly roomId: string;
  readonly participantId: string;
  readonly role: CustomRoomParticipantRole;
  readonly snapshot: RoomSnapshot<TApp>;
}

interface NormalizedCustomRoomCreationInput {
  readonly requestId: RequestId;
  readonly name: string;
  readonly visibility: "public" | "unlisted";
  readonly joinMethod: CustomRoomJoinMethod;
  readonly maxPlayers: number;
  readonly maxSpectators: number;
  readonly password: string | null;
  readonly passwordFingerprint: string | null;
  readonly settings: JsonObject;
  readonly payload: JsonObject;
}

// RPC の公開型はアプリケーション設定の深い型引数まで展開されるため、
// Gateway の実行境界では必要な Room 操作だけを明示した薄い契約にします。
interface CustomRoomGatewayStub {
  getProcessedCommand(requestId: string): Promise<RoomProcessedCommand | null>;
  initialize(options: RoomInitializationOptions): Promise<RoomSnapshot>;
  join(options: {
    readonly gatewayPrincipal: AuthenticatedGatewayRequest["gatewayPrincipal"];
    readonly role: RoomParticipantRole;
    readonly invitationCode?: string;
    readonly password?: string;
    readonly observability?: FlareLobbyObservabilityContext;
  }): Promise<RoomParticipantJoinResult>;
  leave(
    options: RoomParticipantLeaveOptions,
  ): Promise<RoomParticipantLeaveResult>;
  recordProcessedCommand(
    options: RoomProcessedCommandOptions,
  ): Promise<RoomProcessedCommand>;
}

/** `POST /v1/custom-rooms` を処理します。 */
export async function createCustomRoom<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
): Promise<ProtocolResult<CustomRoomCreationResult<TApp>>> {
  try {
    const body = await readValidatedJsonBody(
      request,
      configuration.inputLimits.maxHttpRequestBytes,
      isJsonObject,
    );

    if (!body.ok) {
      return body;
    }

    const input = await normalizeCustomRoomCreationInput(
      request,
      body.value,
      configuration,
    );
    const observability = withObservabilityRequestId(
      authenticatedRequest.observability ?? readObservabilityContext(request),
      input.requestId,
    );
    const roomId = await deriveRoomId(
      env.FLARE_LOBBY_TOKEN_SECRET,
      authenticatedRequest.principal,
      input.requestId,
    );
    const room = env.FLARE_LOBBY_ROOMS.getByName(
      roomId,
    ) as unknown as CustomRoomGatewayStub;
    const existing = await room.getProcessedCommand(input.requestId);

    if (existing !== null) {
      const restored = restoreExistingCreationResult<TApp>(existing, input);

      if (restored.ok && restored.value.invitationCode !== null) {
        await registerCustomRoomInvitation(
          env.FLARE_LOBBY_DB,
          restored.value.invitationCode,
          restored.value.roomId,
        );
      }

      return restored;
    }

    const rateLimit = await consumeRoomCreationRateLimit(
      env,
      authenticatedRequest,
      configuration.inputLimits,
    );

    if (!rateLimit.ok) {
      return rateLimit;
    }

    const participantId = `participant-${roomId}`;
    const joinToken = await issueJoinToken(env.FLARE_LOBBY_TOKEN_SECRET, {
      principal: authenticatedRequest.principal,
      roomId,
      role: "player",
      participantId,
      expiresAt: Date.now() + DEFAULT_JOIN_TOKEN_TTL_MS,
    });

    if (!joinToken.ok) {
      return joinToken;
    }

    const invitationCode = createInvitationCode();
    const snapshot = await room.initialize({
      room: {
        id: roomId,
        kind: "custom",
        invitationCode,
        visibility: input.visibility,
        settings: input.settings,
        metadata: { name: input.name },
      },
      host: {
        participantId,
        playerId: authenticatedRequest.principal.playerId,
      },
      participants: [
        {
          kind: "player",
          id: participantId,
          player: { id: authenticatedRequest.principal.playerId },
          teamId: null,
          ready: false,
        },
      ],
      maxPlayers: input.maxPlayers,
      maxSpectators: input.maxSpectators,
      joinMethod: input.joinMethod,
      ...(input.password === null ? {} : { password: input.password }),
      ...(configuration.customRooms.finishedRoomRetentionMs === undefined
        ? {}
        : {
            finishedRoomRetentionMs:
              configuration.customRooms.finishedRoomRetentionMs,
          }),
      ...(configuration.customRooms.resumeTokenTtlMs === undefined
        ? {}
        : { resumeTokenTtlMs: configuration.customRooms.resumeTokenTtlMs }),
      ...(configuration.customRooms.disconnectGracePeriodMs === undefined
        ? {}
        : {
            disconnectGracePeriodMs:
              configuration.customRooms.disconnectGracePeriodMs,
          }),
      ...(configuration.customRooms.eventHistoryLimit === undefined
        ? {}
        : { eventHistoryLimit: configuration.customRooms.eventHistoryLimit }),
      ...(configuration.customRooms.processedCommandRetentionMs === undefined
        ? {}
        : {
            processedCommandRetentionMs:
              configuration.customRooms.processedCommandRetentionMs,
          }),
      observability,
    });
    const snapshotInvitationCode = getSnapshotInvitationCode(snapshot);

    if (input.joinMethod === "invitation") {
      await registerCustomRoomInvitation(
        env.FLARE_LOBBY_DB,
        snapshotInvitationCode,
        roomId,
      );
    }

    const result: CustomRoomCreationResult<TApp> = {
      roomId,
      participantId,
      role: "player",
      joinMethod: input.joinMethod,
      invitationCode:
        input.joinMethod === "invitation" ? snapshotInvitationCode : null,
      joinToken: joinToken.value,
      websocketUrl: createWebSocketUrl(request, roomId),
      snapshot: snapshot as RoomSnapshot<TApp>,
    };
    const stored = await room.recordProcessedCommand({
      requestId: input.requestId,
      command: CUSTOM_ROOM_CREATE_COMMAND,
      payload: input.payload,
      result: toJsonObject(result),
    });

    return parseCreationResult<TApp>(stored.result);
  } catch (error) {
    return {
      ok: false,
      error: normalizeGatewayError(error),
    };
  }
}

/** `POST /v1/custom-rooms/join` を処理します。 */
export async function joinCustomRoom<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
): Promise<ProtocolResult<CustomRoomJoinResult<TApp>>> {
  try {
    const body = await readValidatedJsonBody(
      request,
      configuration.inputLimits.maxHttpRequestBytes,
      isJsonObject,
    );

    if (!body.ok) {
      return body;
    }

    const input = await normalizeCustomRoomJoinInput(request, body.value);
    const roomId = await resolveRoomIdentifier(
      env.FLARE_LOBBY_DB,
      input.roomId,
      input.invitationCode,
    );
    const payload = { ...input.payload, roomId };
    const authorization = await authorizeGatewayOperation(
      authenticatedRequest,
      configuration.authorization,
      {
        operation: input.role === "spectator" ? "spectate" : "join",
        roomId,
      },
    );

    if (!authorization.ok) {
      return authorization;
    }

    const room = env.FLARE_LOBBY_ROOMS.getByName(
      roomId,
    ) as unknown as CustomRoomGatewayStub;
    const requestId = scopeRoomRequestId(
      authenticatedRequest.principal.id,
      roomId,
      input.requestId,
    );
    const observability = withObservabilityRequestId(
      authenticatedRequest.observability ?? readObservabilityContext(request),
      input.requestId,
    );
    const existing = await room.getProcessedCommand(requestId);

    if (existing !== null) {
      return restoreExistingJoinResult<TApp>(existing, roomId, payload);
    }

    const joined = await room.join({
      gatewayPrincipal: authenticatedRequest.gatewayPrincipal,
      role: input.role,
      ...(input.invitationCode === null
        ? {}
        : { invitationCode: input.invitationCode }),
      ...(input.password === null ? {} : { password: input.password }),
      observability,
    });
    const joinToken = await issueJoinToken(env.FLARE_LOBBY_TOKEN_SECRET, {
      principal: authenticatedRequest.principal,
      roomId,
      role: joined.role,
      participantId: joined.participantId,
      expiresAt: Date.now() + DEFAULT_JOIN_TOKEN_TTL_MS,
    });

    if (!joinToken.ok) {
      return joinToken;
    }

    const result: CustomRoomJoinResult<TApp> = {
      roomId,
      participantId: joined.participantId,
      role: joined.role,
      joinToken: joinToken.value,
      websocketUrl: createWebSocketUrl(request, roomId),
      snapshot: joined.snapshot as RoomSnapshot<TApp>,
    };
    const stored = await room.recordProcessedCommand({
      requestId,
      command: CUSTOM_ROOM_JOIN_COMMAND,
      payload,
      result: toJsonObject(result),
    });

    return parseJoinResult<TApp>(stored.result);
  } catch (error) {
    return {
      ok: false,
      error: normalizeGatewayError(error),
    };
  }
}

/** `POST /v1/custom-rooms/leave` を処理します。 */
export async function leaveCustomRoom<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
): Promise<ProtocolResult<CustomRoomLeaveResult<TApp>>> {
  try {
    const body = await readValidatedJsonBody(
      request,
      configuration.inputLimits.maxHttpRequestBytes,
      isJsonObject,
    );

    if (!body.ok) {
      return body;
    }

    const input = normalizeCustomRoomLeaveInput(request, body.value);
    const token = input.joinToken;
    const claims = await verifyJoinToken(env.FLARE_LOBBY_TOKEN_SECRET, token, {
      principal: authenticatedRequest.principal,
      roomId: input.roomId,
      ...(input.role === null ? {} : { role: input.role }),
      ...(input.participantId === null
        ? {}
        : { participantId: input.participantId }),
    });

    if (!claims.ok || claims.value.participantId === undefined) {
      return {
        ok: false,
        error: claims.ok
          ? new FlareLobbyError("UNAUTHENTICATED")
          : claims.error,
      };
    }

    const authorization = await authorizeGatewayOperation(
      authenticatedRequest,
      configuration.authorization,
      {
        operation: claims.value.role === "spectator" ? "spectate" : "join",
        roomId: input.roomId,
      },
    );

    if (!authorization.ok) {
      return authorization;
    }

    const room = env.FLARE_LOBBY_ROOMS.getByName(
      input.roomId,
    ) as unknown as CustomRoomGatewayStub;
    const requestId = scopeRoomRequestId(
      authenticatedRequest.principal.id,
      input.roomId,
      input.requestId,
    );
    const observability = withObservabilityRequestId(
      authenticatedRequest.observability ?? readObservabilityContext(request),
      input.requestId,
    );
    const payload = {
      ...input.payload,
      participantId: claims.value.participantId,
      role: claims.value.role,
    };
    const existing = await room.getProcessedCommand(requestId);

    if (existing !== null) {
      return restoreExistingLeaveResult<TApp>(existing, input.roomId, payload);
    }

    const left = await room.leave({
      gatewayPrincipal: authenticatedRequest.gatewayPrincipal,
      participantId: claims.value.participantId,
      role: claims.value.role,
      requestId,
      requestPayload: payload,
      observability,
    });

    return {
      ok: true,
      value: {
        roomId: input.roomId,
        participantId: left.participantId,
        role: left.role,
        snapshot: left.snapshot as RoomSnapshot<TApp>,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeGatewayError(error),
    };
  }
}

interface NormalizedCustomRoomJoinInput {
  readonly requestId: RequestId;
  readonly roomId: string | null;
  readonly invitationCode: string | null;
  readonly role: CustomRoomParticipantRole;
  readonly password: string | null;
  readonly payload: JsonObject;
}

interface NormalizedCustomRoomLeaveInput {
  readonly requestId: RequestId;
  readonly roomId: string;
  readonly joinToken: string;
  readonly participantId: string | null;
  readonly role: CustomRoomParticipantRole | null;
  readonly payload: JsonObject;
}

async function normalizeCustomRoomJoinInput(
  request: Request,
  value: JsonObject,
): Promise<NormalizedCustomRoomJoinInput> {
  const requestId = normalizeRequestId(request, value);
  let roomId = normalizeOptionalIdentifier(value["roomId"]);
  let invitationCode = normalizeOptionalInvitationCode(value["invitationCode"]);
  const routeIdentifier = getRoomRouteIdentifier(request, "join");

  if (roomId === null && invitationCode === null && routeIdentifier !== null) {
    if (routeIdentifier.startsWith("room_")) {
      roomId = routeIdentifier;
    } else {
      invitationCode = normalizeInvitationCode(routeIdentifier);
    }
  }

  if (roomId === null && invitationCode === null) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "roomId または invitationCode を指定してください。",
    });
  }

  const bodyRole = value["role"];
  const aliasRole = value["participantType"];

  if (
    bodyRole !== undefined &&
    aliasRole !== undefined &&
    bodyRole !== aliasRole
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "role と participantType が一致しません。",
    });
  }

  const role = normalizeParticipantRole(bodyRole ?? aliasRole ?? "player");
  const password =
    value["password"] === undefined
      ? null
      : normalizeRoomPassword(value["password"]);
  const passwordFingerprint =
    password === null ? null : await createPasswordFingerprint(password);

  return {
    requestId,
    roomId,
    invitationCode,
    role,
    password,
    payload: {
      requestId,
      roomId,
      invitationCode,
      role,
      passwordFingerprint,
    },
  };
}

function normalizeCustomRoomLeaveInput(
  request: Request,
  value: JsonObject,
): NormalizedCustomRoomLeaveInput {
  const requestId = normalizeRequestId(request, value);
  const routeRoomId = getRoomRouteIdentifier(request, "leave");
  const roomId = normalizeOptionalIdentifier(value["roomId"]) ?? routeRoomId;

  if (roomId === null) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "退出には roomId が必要です。",
    });
  }

  const tokenValue =
    value["joinToken"] === undefined ? value["token"] : value["joinToken"];
  const authorization = request.headers.get("authorization");
  const bearerToken =
    tokenValue === undefined && authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : tokenValue;

  if (!isNonEmptyString(bearerToken)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "退出には joinToken が必要です。",
    });
  }

  const participantId = normalizeOptionalIdentifier(value["participantId"]);
  const roleValue = value["role"];
  const role =
    roleValue === undefined ? null : normalizeParticipantRole(roleValue);

  return {
    requestId,
    roomId,
    joinToken: bearerToken,
    participantId,
    role,
    payload: {
      requestId,
      roomId,
      participantId,
      role,
    },
  };
}

function normalizeRequestId(request: Request, value: JsonObject): RequestId {
  const bodyRequestId = value["requestId"];
  const headerRequestId = request.headers.get("Idempotency-Key");

  if (
    bodyRequestId !== undefined &&
    (!isNonEmptyString(bodyRequestId) ||
      bodyRequestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `requestId は 1 文字以上 ${MAX_REQUEST_ID_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  if (
    headerRequestId !== null &&
    (!isNonEmptyString(headerRequestId) ||
      headerRequestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `Idempotency-Key は 1 文字以上 ${MAX_REQUEST_ID_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  if (
    bodyRequestId !== undefined &&
    headerRequestId !== null &&
    bodyRequestId !== headerRequestId
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "requestId と Idempotency-Key が一致しません。",
    });
  }

  return bodyRequestId ?? headerRequestId ?? crypto.randomUUID();
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

function normalizeOptionalInvitationCode(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return normalizeInvitationCode(value);
}

function normalizeInvitationCode(value: unknown): string {
  if (!isNonEmptyString(value) || value.length > 128) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return value.trim().toUpperCase();
}

function normalizeParticipantRole(value: unknown): CustomRoomParticipantRole {
  if (value !== "player" && value !== "spectator") {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "role は player または spectator で指定してください。",
    });
  }

  return value;
}

function getRoomRouteIdentifier(
  request: Request,
  operation: "join" | "leave",
): string | null {
  const match = new RegExp(`^/v1/custom-rooms/([^/]+)/${operation}$`, "u").exec(
    new URL(request.url).pathname,
  );

  if (match?.[1] === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
}

async function resolveRoomIdentifier(
  database: D1Database,
  roomId: string | null,
  invitationCode: string | null,
): Promise<string> {
  if (roomId !== null) {
    return roomId;
  }

  if (invitationCode === null) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  const resolved = await resolveCustomRoomInvitation(database, invitationCode);

  if (resolved === null) {
    throw new FlareLobbyError("FORBIDDEN", {
      message: "招待コードが正しくありません。",
    });
  }

  return resolved;
}

function scopeRoomRequestId(
  principalId: string,
  roomId: string,
  requestId: RequestId,
): string {
  return `custom-room:${principalId}:${roomId}:${requestId}`;
}

function restoreExistingJoinResult<TApp extends AnyFlareLobbyApp>(
  existing: RoomProcessedCommand,
  roomId: string,
  payload: JsonObject,
): ProtocolResult<CustomRoomJoinResult<TApp>> {
  if (
    existing.command !== CUSTOM_ROOM_JOIN_COMMAND ||
    JSON.stringify(existing.payload) !== JSON.stringify(payload)
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT", {
        message: "同じ requestId に異なる参加条件を指定できません。",
      }),
    };
  }

  const result = parseJoinResult<TApp>(existing.result);

  if (result.ok && result.value.roomId !== roomId) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT"),
    };
  }

  return result;
}

function restoreExistingLeaveResult<TApp extends AnyFlareLobbyApp>(
  existing: RoomProcessedCommand,
  roomId: string,
  payload: JsonObject,
): ProtocolResult<CustomRoomLeaveResult<TApp>> {
  if (
    existing.command !== CUSTOM_ROOM_LEAVE_COMMAND ||
    JSON.stringify(existing.payload) !== JSON.stringify(payload)
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT", {
        message: "同じ requestId に異なる退出条件を指定できません。",
      }),
    };
  }

  const left = parseRoomParticipantLeaveResult(existing.result);

  if (!left.ok) {
    return left;
  }

  return {
    ok: true,
    value: {
      roomId,
      participantId: left.value.participantId,
      role: left.value.role,
      snapshot: left.value.snapshot as RoomSnapshot<TApp>,
    },
  };
}

function parseJoinResult<TApp extends AnyFlareLobbyApp>(
  value: JsonValue,
): ProtocolResult<CustomRoomJoinResult<TApp>> {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["participantId"]) ||
    !isNonEmptyString(value["joinToken"]) ||
    !isNonEmptyString(value["websocketUrl"]) ||
    !isRoomParticipantRoleValue(value["role"]) ||
    !isJsonObject(value["snapshot"])
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("CONNECTION_FAILED"),
    };
  }

  return {
    ok: true,
    value: value as unknown as CustomRoomJoinResult<TApp>,
  };
}

function parseRoomParticipantLeaveResult(
  value: JsonValue,
): ProtocolResult<RoomParticipantLeaveResult> {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value["participantId"]) ||
    !isRoomParticipantRoleValue(value["role"]) ||
    !isJsonObject(value["snapshot"])
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("CONNECTION_FAILED"),
    };
  }

  return {
    ok: true,
    value: value as unknown as RoomParticipantLeaveResult,
  };
}

function isRoomParticipantRoleValue(
  value: unknown,
): value is CustomRoomParticipantRole {
  return value === "player" || value === "spectator";
}

async function normalizeCustomRoomCreationInput<TApp extends AnyFlareLobbyApp>(
  request: Request,
  value: JsonObject,
  configuration: FlareLobbyConfiguration<TApp>,
): Promise<NormalizedCustomRoomCreationInput> {
  const bodyRequestId = value["requestId"];
  const headerRequestId = request.headers.get("Idempotency-Key");

  if (
    bodyRequestId !== undefined &&
    (!isNonEmptyString(bodyRequestId) ||
      bodyRequestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `requestId は 1 文字以上 ${MAX_REQUEST_ID_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  if (
    headerRequestId !== null &&
    (!isNonEmptyString(headerRequestId) ||
      headerRequestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `Idempotency-Key は 1 文字以上 ${MAX_REQUEST_ID_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  if (
    bodyRequestId !== undefined &&
    headerRequestId !== null &&
    bodyRequestId !== headerRequestId
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "requestId と Idempotency-Key が一致しません。",
    });
  }

  const requestId = bodyRequestId ?? headerRequestId ?? crypto.randomUUID();
  const rawName = value["name"] === undefined ? value["title"] : value["name"];
  const name =
    rawName === undefined ? DEFAULT_ROOM_NAME : normalizeRoomName(rawName);
  const rawVisibility =
    value["visibility"] === undefined ? value["listing"] : value["visibility"];
  const visibility = normalizeVisibility(rawVisibility);
  const rawJoinMethod =
    value["joinMethod"] === undefined ? value["joinMode"] : value["joinMethod"];
  const joinMethod = normalizeJoinMethod(rawJoinMethod);
  const password =
    value["password"] === undefined
      ? null
      : normalizeRoomPassword(value["password"]);

  if (
    (joinMethod === "password" && password === null) ||
    (joinMethod !== "password" && password !== null)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "パスワード方式ではパスワードが必要です。",
    });
  }

  const passwordFingerprint =
    password === null ? null : await createPasswordFingerprint(password);
  const maxPlayers = normalizeMaxPlayers(
    value["maxPlayers"],
    configuration.customRooms.maxPlayers,
  );
  const configuredMaxSpectators = configuration.customRooms.maxSpectators;
  const maxSpectators = normalizeMaxSpectators(
    value["maxSpectators"],
    configuredMaxSpectators ?? 0,
    configuredMaxSpectators,
  );
  const settings = normalizeSettings(
    value["settings"],
    configuration.customRooms.defaultSettings,
  );

  return {
    requestId,
    name,
    visibility,
    joinMethod,
    maxPlayers,
    maxSpectators,
    password,
    passwordFingerprint,
    settings,
    payload: {
      requestId,
      name,
      visibility,
      joinMethod,
      maxPlayers,
      maxSpectators,
      passwordFingerprint,
      settings,
    },
  };
}

function normalizeRoomName(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `name は 1 文字以上 ${MAX_ROOM_NAME_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  const name = value.trim();

  if (name.length > MAX_ROOM_NAME_LENGTH) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `name は 1 文字以上 ${MAX_ROOM_NAME_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  return name;
}

function normalizeVisibility(value: unknown): "public" | "unlisted" {
  if (value === undefined) {
    return "public";
  }

  if (value !== "public" && value !== "unlisted") {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "visibility は public または unlisted で指定してください。",
    });
  }

  return value;
}

function normalizeJoinMethod(value: unknown): CustomRoomJoinMethod {
  if (value === undefined || value === "public" || value === "open") {
    return "public";
  }

  if (value === "invitation" || value === "invite") {
    return "invitation";
  }

  if (value === "password") {
    return "password";
  }

  throw new FlareLobbyError("INVALID_PAYLOAD", {
    message:
      "joinMethod は public、invitation、password のいずれかで指定してください。",
  });
}

function normalizeRoomPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PASSWORD_LENGTH
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `password は 1 文字以上 ${MAX_PASSWORD_LENGTH} 文字以下の文字列で指定してください。`,
    });
  }

  return value;
}

function normalizeMaxPlayers(
  value: unknown,
  configuredMaximum: number,
): number {
  const maxPlayers = value === undefined ? configuredMaximum : value;

  if (!isPositiveSafeInteger(maxPlayers) || maxPlayers > configuredMaximum) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `maxPlayers は 1 以上 ${configuredMaximum} 以下の整数で指定してください。`,
    });
  }

  return maxPlayers;
}

function normalizeMaxSpectators(
  value: unknown,
  defaultValue: number,
  configuredMaximum: number | undefined,
): number {
  const maxSpectators = value === undefined ? defaultValue : value;

  if (
    !isNonNegativeSafeInteger(maxSpectators) ||
    (configuredMaximum !== undefined && maxSpectators > configuredMaximum)
  ) {
    const maximumMessage =
      configuredMaximum === undefined
        ? "0 以上"
        : `0 以上 ${configuredMaximum} 以下`;
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `maxSpectators は ${maximumMessage}の整数で指定してください。`,
    });
  }

  return maxSpectators;
}

function normalizeSettings(
  value: unknown,
  defaultSettings: unknown,
): JsonObject {
  const settings = value === undefined ? defaultSettings : value;

  if (!isJsonObject(settings)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "settings は JSON オブジェクトで指定してください。",
    });
  }

  return settings;
}

async function deriveRoomId(
  tokenSecret: string,
  principal: Principal,
  requestId: RequestId,
): Promise<string> {
  if (!isNonEmptyString(tokenSecret)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `flarelobby-room-id-v1:${principal.id}:${requestId}`,
    ),
  );

  return `room_${encodeBase64Url(new Uint8Array(digest))}`;
}

async function createPasswordFingerprint(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password),
  );

  return encodeBase64Url(new Uint8Array(digest));
}

function createInvitationCode(): string {
  const bytes = new Uint8Array(INVITATION_CODE_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) => INVITATION_CODE_ALPHABET[byte % INVITATION_CODE_ALPHABET.length],
  ).join("");
}

function createWebSocketUrl(request: Request, roomId: string): string {
  const url = new URL(
    `/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`,
    request.url,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function getSnapshotInvitationCode(snapshot: RoomSnapshot): string {
  if (snapshot.room.kind !== "custom") {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return snapshot.room.invitationCode;
}

function restoreExistingCreationResult<TApp extends AnyFlareLobbyApp>(
  existing: {
    readonly command: string;
    readonly payload: JsonValue;
    readonly result: JsonValue;
  },
  input: NormalizedCustomRoomCreationInput,
): ProtocolResult<CustomRoomCreationResult<TApp>> {
  if (existing.command !== CUSTOM_ROOM_CREATE_COMMAND) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT", {
        message: "同じ requestId は別の操作へ再利用できません。",
      }),
    };
  }

  if (JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT", {
        message: "同じ requestId に異なる作成条件を指定できません。",
      }),
    };
  }

  return parseCreationResult<TApp>(existing.result);
}

function parseCreationResult<TApp extends AnyFlareLobbyApp>(
  value: JsonValue,
): ProtocolResult<CustomRoomCreationResult<TApp>> {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["joinToken"]) ||
    !isNonEmptyString(value["websocketUrl"]) ||
    (value["joinMethod"] !== "public" &&
      value["joinMethod"] !== "invitation" &&
      value["joinMethod"] !== "password") ||
    (value["invitationCode"] !== null &&
      !isNonEmptyString(value["invitationCode"])) ||
    !isJsonObject(value["snapshot"])
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("CONNECTION_FAILED"),
    };
  }

  return {
    ok: true,
    value: value as unknown as CustomRoomCreationResult<TApp>,
  };
}

function toJsonObject(value: unknown): JsonObject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(JSON.stringify(value));
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  if (!isJsonObject(parsed)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return parsed;
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

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function isJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
): value is JsonValue {
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

  if (typeof value !== "object") {
    return false;
  }

  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, ancestors));
    }

    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item, ancestors),
    );
  } finally {
    ancestors.delete(value);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeGatewayError(error: unknown): FlareLobbyError {
  if (error instanceof FlareLobbyError) {
    return error;
  }

  const remoteError =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : null;

  if (remoteError !== null && isFlareLobbyErrorCode(remoteError.code)) {
    return new FlareLobbyError(
      remoteError.code,
      isNonEmptyString(remoteError.message)
        ? { message: remoteError.message }
        : undefined,
    );
  }

  return new FlareLobbyError("CONNECTION_FAILED");
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
