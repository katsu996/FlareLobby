import {
  FlareLobbyError
} from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  AppRoomSettings,
  FlareLobbyApp,
  JsonObject,
  JsonValue,
  Principal,
  ProtocolResult,
  RequestId,
  RoomSnapshot
} from "@flarelobby/core";

import { consumeRoomCreationRateLimit } from "./config.js";
import type {
  FlareLobbyBindings,
  FlareLobbyConfiguration
} from "./config.js";
import {
  issueJoinToken,
  readValidatedJsonBody
} from "./security.js";
import type { AuthenticatedGatewayRequest } from "./security.js";
import type {
  RoomInitializationOptions,
  RoomJoinMethod,
  RoomProcessedCommand,
  RoomProcessedCommandOptions
} from "./room.js";

const CUSTOM_ROOM_CREATE_COMMAND = "custom_room.create";
const DEFAULT_ROOM_NAME = "ルーム";
const DEFAULT_JOIN_TOKEN_TTL_MS = 10 * 60 * 1_000;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ROOM_NAME_LENGTH = 80;
const INVITATION_CODE_LENGTH = 6;
const INVITATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** カスタムルーム作成要求で選択できる参加方式です。 */
export type CustomRoomJoinMethod = RoomJoinMethod;

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

interface NormalizedCustomRoomCreationInput {
  readonly requestId: RequestId;
  readonly name: string;
  readonly visibility: "public" | "unlisted";
  readonly joinMethod: CustomRoomJoinMethod;
  readonly maxPlayers: number;
  readonly maxSpectators: number;
  readonly settings: JsonObject;
  readonly payload: JsonObject;
}

// RPC の公開型はアプリケーション設定の深い型引数まで展開されるため、
// Gateway の実行境界では必要な Room 操作だけを明示した薄い契約にします。
interface CustomRoomGatewayStub {
  getProcessedCommand(requestId: string): Promise<RoomProcessedCommand | null>;
  initialize(options: RoomInitializationOptions): Promise<RoomSnapshot>;
  recordProcessedCommand(
    options: RoomProcessedCommandOptions
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
  authenticatedRequest: AuthenticatedGatewayRequest
): Promise<ProtocolResult<CustomRoomCreationResult<TApp>>> {
  try {
    const body = await readValidatedJsonBody(
      request,
      configuration.inputLimits.maxHttpRequestBytes,
      isJsonObject
    );

    if (!body.ok) {
      return body;
    }

    const input = normalizeCustomRoomCreationInput(
      request,
      body.value,
      configuration
    );
    const roomId = await deriveRoomId(
      env.FLARE_LOBBY_TOKEN_SECRET,
      authenticatedRequest.principal,
      input.requestId
    );
    const room = env.FLARE_LOBBY_ROOMS.getByName(
      roomId
    ) as unknown as CustomRoomGatewayStub;
    const existing = await room.getProcessedCommand(input.requestId);

    if (existing !== null) {
      return restoreExistingCreationResult<TApp>(existing, input);
    }

    const rateLimit = await consumeRoomCreationRateLimit(
      env,
      authenticatedRequest,
      configuration.inputLimits
    );

    if (!rateLimit.ok) {
      return rateLimit;
    }

    const joinToken = await issueJoinToken(env.FLARE_LOBBY_TOKEN_SECRET, {
      principal: authenticatedRequest.principal,
      roomId,
      expiresAt: Date.now() + DEFAULT_JOIN_TOKEN_TTL_MS
    });

    if (!joinToken.ok) {
      return joinToken;
    }

    const invitationCode = createInvitationCode();
    const participantId = `participant-${roomId}`;
    const snapshot = await room.initialize({
      room: {
        id: roomId,
        kind: "custom",
        invitationCode,
        visibility: input.visibility,
        settings: input.settings,
        metadata: { name: input.name }
      },
      host: {
        participantId,
        playerId: authenticatedRequest.principal.playerId
      },
      participants: [
        {
          kind: "player",
          id: participantId,
          player: { id: authenticatedRequest.principal.playerId },
          teamId: null,
          ready: false
        }
      ],
      maxPlayers: input.maxPlayers,
      maxSpectators: input.maxSpectators,
      joinMethod: input.joinMethod,
      ...(configuration.customRooms.finishedRoomRetentionMs === undefined
        ? {}
        : {
            finishedRoomRetentionMs:
              configuration.customRooms.finishedRoomRetentionMs
          })
    });
    const result: CustomRoomCreationResult<TApp> = {
      roomId,
      joinMethod: input.joinMethod,
      invitationCode:
        input.joinMethod === "invitation"
          ? getSnapshotInvitationCode(snapshot)
          : null,
      joinToken: joinToken.value,
      websocketUrl: createWebSocketUrl(request, roomId),
      snapshot: snapshot as RoomSnapshot<TApp>
    };
    const stored = await room.recordProcessedCommand({
      requestId: input.requestId,
      command: CUSTOM_ROOM_CREATE_COMMAND,
      payload: input.payload,
      result: toJsonObject(result)
    });

    return parseCreationResult<TApp>(stored.result);
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      return { ok: false, error };
    }

    return {
      ok: false,
      error: new FlareLobbyError("CONNECTION_FAILED")
    };
  }
}

function normalizeCustomRoomCreationInput<TApp extends AnyFlareLobbyApp>(
  request: Request,
  value: JsonObject,
  configuration: FlareLobbyConfiguration<TApp>
): NormalizedCustomRoomCreationInput {
  const bodyRequestId = value["requestId"];
  const headerRequestId = request.headers.get("Idempotency-Key");

  if (
    bodyRequestId !== undefined &&
    (!isNonEmptyString(bodyRequestId) ||
      bodyRequestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `requestId は 1 文字以上 ${MAX_REQUEST_ID_LENGTH} 文字以下の文字列で指定してください。`
    });
  }

  if (
    headerRequestId !== null &&
    (!isNonEmptyString(headerRequestId) ||
      headerRequestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `Idempotency-Key は 1 文字以上 ${MAX_REQUEST_ID_LENGTH} 文字以下の文字列で指定してください。`
    });
  }

  if (
    bodyRequestId !== undefined &&
    headerRequestId !== null &&
    bodyRequestId !== headerRequestId
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "requestId と Idempotency-Key が一致しません。"
    });
  }

  const requestId =
    bodyRequestId ?? headerRequestId ?? crypto.randomUUID();
  const rawName =
    value["name"] === undefined ? value["title"] : value["name"];
  const name =
    rawName === undefined
      ? DEFAULT_ROOM_NAME
      : normalizeRoomName(rawName);
  const rawVisibility =
    value["visibility"] === undefined
      ? value["listing"]
      : value["visibility"];
  const visibility = normalizeVisibility(rawVisibility);
  const rawJoinMethod =
    value["joinMethod"] === undefined
      ? value["joinMode"]
      : value["joinMethod"];
  const joinMethod = normalizeJoinMethod(rawJoinMethod);
  const maxPlayers = normalizeMaxPlayers(
    value["maxPlayers"],
    configuration.customRooms.maxPlayers
  );
  const configuredMaxSpectators = configuration.customRooms.maxSpectators;
  const maxSpectators = normalizeMaxSpectators(
    value["maxSpectators"],
    configuredMaxSpectators ?? 0,
    configuredMaxSpectators
  );
  const settings = normalizeSettings(
    value["settings"],
    configuration.customRooms.defaultSettings
  );

  return {
    requestId,
    name,
    visibility,
    joinMethod,
    maxPlayers,
    maxSpectators,
    settings,
    payload: {
      requestId,
      name,
      visibility,
      joinMethod,
      maxPlayers,
      maxSpectators,
      settings
    }
  };
}

function normalizeRoomName(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `name は 1 文字以上 ${MAX_ROOM_NAME_LENGTH} 文字以下の文字列で指定してください。`
    });
  }

  const name = value.trim();

  if (name.length > MAX_ROOM_NAME_LENGTH) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `name は 1 文字以上 ${MAX_ROOM_NAME_LENGTH} 文字以下の文字列で指定してください。`
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
      message: "visibility は public または unlisted で指定してください。"
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

  throw new FlareLobbyError("INVALID_PAYLOAD", {
    message: "joinMethod は public または invitation で指定してください。"
  });
}

function normalizeMaxPlayers(value: unknown, configuredMaximum: number): number {
  const maxPlayers = value === undefined ? configuredMaximum : value;

  if (!isPositiveSafeInteger(maxPlayers) || maxPlayers > configuredMaximum) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `maxPlayers は 1 以上 ${configuredMaximum} 以下の整数で指定してください。`
    });
  }

  return maxPlayers;
}

function normalizeMaxSpectators(
  value: unknown,
  defaultValue: number,
  configuredMaximum: number | undefined
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
      message: `maxSpectators は ${maximumMessage}の整数で指定してください。`
    });
  }

  return maxSpectators;
}

function normalizeSettings(
  value: unknown,
  defaultSettings: unknown
): JsonObject {
  const settings = value === undefined ? defaultSettings : value;

  if (!isJsonObject(settings)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "settings は JSON オブジェクトで指定してください。"
    });
  }

  return settings;
}

async function deriveRoomId(
  tokenSecret: string,
  principal: Principal,
  requestId: RequestId
): Promise<string> {
  if (!isNonEmptyString(tokenSecret)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `flarelobby-room-id-v1:${principal.id}:${requestId}`
    )
  );

  return `room_${encodeBase64Url(new Uint8Array(digest))}`;
}

function createInvitationCode(): string {
  const bytes = new Uint8Array(INVITATION_CODE_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) => INVITATION_CODE_ALPHABET[byte % INVITATION_CODE_ALPHABET.length]
  ).join("");
}

function createWebSocketUrl(request: Request, roomId: string): string {
  const url = new URL(`/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`, request.url);
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
  input: NormalizedCustomRoomCreationInput
): ProtocolResult<CustomRoomCreationResult<TApp>> {
  if (existing.command !== CUSTOM_ROOM_CREATE_COMMAND) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT", {
        message: "同じ requestId は別の操作へ再利用できません。"
      })
    };
  }

  if (JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) {
    return {
      ok: false,
      error: new FlareLobbyError("CONFLICT", {
        message: "同じ requestId に異なる作成条件を指定できません。"
      })
    };
  }

  return parseCreationResult<TApp>(existing.result);
}

function parseCreationResult<TApp extends AnyFlareLobbyApp>(
  value: JsonValue
): ProtocolResult<CustomRoomCreationResult<TApp>> {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value["roomId"]) ||
    !isNonEmptyString(value["joinToken"]) ||
    !isNonEmptyString(value["websocketUrl"]) ||
    (value["joinMethod"] !== "public" &&
      value["joinMethod"] !== "invitation") ||
    (value["invitationCode"] !== null &&
      !isNonEmptyString(value["invitationCode"])) ||
    !isJsonObject(value["snapshot"])
  ) {
    return {
      ok: false,
      error: new FlareLobbyError("CONNECTION_FAILED")
    };
  }

  return {
    ok: true,
    value: value as unknown as CustomRoomCreationResult<TApp>
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
  ancestors = new Set<object>()
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
      isJsonValue(item, ancestors)
    );
  } finally {
    ancestors.delete(value);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
