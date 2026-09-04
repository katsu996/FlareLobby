import { FlareLobbyError } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  FlareLobbyApp,
  ProtocolResult,
  RoomStatus,
} from "@flarelobby/core";

import type {
  CustomRoomIndexJoinMethod,
  CustomRoomIndexRecord,
} from "./custom-room-index.js";
import { queryCustomRoomIndex } from "./custom-room-index.js";
import type { FlareLobbyBindings, FlareLobbyConfiguration } from "./config.js";

const CURSOR_VERSION = 1 as const;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_FILTER_LENGTH = 64;
const MAX_CURSOR_LENGTH = 512;

/** 公開ルーム一覧へ指定できる検索条件です。空き枠はプレイヤー枠の下限です。 */
export interface CustomRoomListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly pageSize?: number;
  readonly mode?: string;
  readonly region?: string;
  readonly state?: RoomStatus | readonly RoomStatus[];
  /** `state` の説明的な入力別名です。 */
  readonly status?: RoomStatus | readonly RoomStatus[];
  /** `true` のとき、プレイヤーの空き枠がある Room だけを返します。 */
  readonly available?: boolean;
  readonly availableSlots?: number;
  /** `availableSlots` の説明的な入力別名です。 */
  readonly minAvailableSlots?: number;
}

/** 公開一覧へ返す安全なルーム概要です。 */
export interface RoomSummary {
  /** `CustomRoom` の公開ドメイン型と対応する識別子です。 */
  readonly id: string;
  readonly kind: "custom";
  readonly roomId: string;
  readonly name: string;
  readonly mode: string | null;
  readonly region: string | null;
  readonly visibility: "public";
  readonly state: RoomStatus;
  readonly joinMethod: CustomRoomIndexJoinMethod;
  /** パスワードそのものではなく、参加時に必要かだけを表します。 */
  readonly requiresPassword: boolean;
  readonly maxPlayers: number;
  readonly playerCount: number;
  readonly availableSlots: number;
  readonly maxSpectators: number;
  readonly spectatorCount: number;
  readonly availableSpectatorSlots: number;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 公開ルーム一覧のページです。`nextCursor` は次ページがないとき null です。 */
export interface CustomRoomListResult {
  readonly rooms: readonly RoomSummary[];
  readonly nextCursor: string | null;
}

interface NormalizedCustomRoomListQuery {
  readonly mode: string | undefined;
  readonly region: string | undefined;
  readonly states: readonly RoomStatus[] | undefined;
  readonly requireAvailable: boolean;
  readonly minAvailableSlots: number | undefined;
  readonly limit: number;
  readonly cursor: string | null;
  readonly cursorPosition: {
    readonly createdAt: number;
    readonly roomId: string;
  } | null;
  readonly fingerprint: string;
}

interface CursorPayload {
  readonly version: typeof CURSOR_VERSION;
  readonly createdAt: number;
  readonly roomId: string;
  readonly fingerprint: string;
}

/** `GET /v1/custom-rooms` を処理します。公開一覧のため認証なしで利用できます。 */
export async function listCustomRooms<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  _configuration: FlareLobbyConfiguration<TApp>,
): Promise<ProtocolResult<CustomRoomListResult>> {
  try {
    const query = await normalizeCustomRoomListQuery(
      readCustomRoomListQuery(request),
      env.FLARE_LOBBY_TOKEN_SECRET,
    );
    const rows = await queryCustomRoomIndex(env.FLARE_LOBBY_DB, {
      ...(query.mode === undefined ? {} : { mode: query.mode }),
      ...(query.region === undefined ? {} : { region: query.region }),
      ...(query.states === undefined ? {} : { states: query.states }),
      ...(query.requireAvailable ? { requireAvailable: true } : {}),
      ...(query.minAvailableSlots === undefined
        ? {}
        : { minAvailableSlots: query.minAvailableSlots }),
      ...(query.cursorPosition === null
        ? {}
        : { cursor: query.cursorPosition }),
      limit: query.limit + 1,
    });
    const hasNextPage = rows.length > query.limit;
    const page = rows.slice(0, query.limit).map(toRoomSummary);
    const last = page[page.length - 1];

    return {
      ok: true,
      value: {
        rooms: Object.freeze(page),
        nextCursor:
          hasNextPage && last !== undefined
            ? await encodeCursor(
                env.FLARE_LOBBY_TOKEN_SECRET,
                {
                  createdAt: last.createdAt,
                  roomId: last.roomId,
                },
                query.fingerprint,
              )
            : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof FlareLobbyError
          ? error
          : new FlareLobbyError("CONNECTION_FAILED"),
    };
  }
}

function readCustomRoomListQuery(request: Request): CustomRoomListQuery {
  const searchParams = new URL(request.url).searchParams;
  const stateValues = searchParams.getAll("state");
  const statusValues = searchParams.getAll("status");
  const availableSlots = searchParams.get("availableSlots");
  const minAvailableSlots = searchParams.get("minAvailableSlots");
  const limit = searchParams.get("limit");
  const pageSize = searchParams.get("pageSize");
  const available = searchParams.get("available");

  return {
    ...(searchParams.get("cursor") === null
      ? {}
      : { cursor: searchParams.get("cursor")! }),
    ...(limit === null ? {} : { limit: parseQueryNumber(limit, "limit") }),
    ...(pageSize === null
      ? {}
      : { pageSize: parseQueryNumber(pageSize, "pageSize") }),
    ...(searchParams.get("mode") === null
      ? {}
      : { mode: searchParams.get("mode")! }),
    ...(searchParams.get("region") === null
      ? {}
      : { region: searchParams.get("region")! }),
    ...(stateValues.length === 0
      ? {}
      : {
          state: (stateValues.length === 1 ? stateValues[0] : stateValues) as
            | RoomStatus
            | readonly RoomStatus[],
        }),
    ...(statusValues.length === 0
      ? {}
      : {
          status: (statusValues.length === 1
            ? statusValues[0]
            : statusValues) as RoomStatus | readonly RoomStatus[],
        }),
    ...(available === null
      ? {}
      : { available: parseQueryBoolean(available, "available") }),
    ...(availableSlots === null
      ? {}
      : {
          availableSlots: parseQueryNumber(availableSlots, "availableSlots"),
        }),
    ...(minAvailableSlots === null
      ? {}
      : {
          minAvailableSlots: parseQueryNumber(
            minAvailableSlots,
            "minAvailableSlots",
          ),
        }),
  };
}

function parseQueryNumber(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${name} は 0 以上の整数で指定してください。`,
    });
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${name} は安全な整数で指定してください。`,
    });
  }

  return parsed;
}

function parseQueryBoolean(value: string, name: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new FlareLobbyError("INVALID_PAYLOAD", {
    message: `${name} は true または false で指定してください。`,
  });
}

async function normalizeCustomRoomListQuery(
  query: CustomRoomListQuery,
  tokenSecret: string,
): Promise<NormalizedCustomRoomListQuery> {
  if (query.cursor !== undefined && query.cursor.length > MAX_CURSOR_LENGTH) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が長すぎます。",
    });
  }

  const limitValue = query.limit ?? query.pageSize ?? DEFAULT_PAGE_SIZE;

  if (
    !Number.isSafeInteger(limitValue) ||
    limitValue < 1 ||
    limitValue > MAX_PAGE_SIZE
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `limit は 1 以上 ${MAX_PAGE_SIZE} 以下の整数で指定してください。`,
    });
  }

  if (
    query.limit !== undefined &&
    query.pageSize !== undefined &&
    query.limit !== query.pageSize
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "limit と pageSize が一致しません。",
    });
  }

  const mode = normalizeFilter(query.mode, "mode");
  const region = normalizeFilter(query.region, "region");
  const states = normalizeState(query.state, query.status);
  const requireAvailable = query.available === true;
  const availableSlots = query.availableSlots;
  const minAvailableSlots = query.minAvailableSlots;

  if (
    availableSlots !== undefined &&
    (!Number.isSafeInteger(availableSlots) || availableSlots < 0)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "availableSlots は 0 以上の整数で指定してください。",
    });
  }

  if (
    minAvailableSlots !== undefined &&
    (!Number.isSafeInteger(minAvailableSlots) || minAvailableSlots < 0)
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "minAvailableSlots は 0 以上の整数で指定してください。",
    });
  }

  if (
    availableSlots !== undefined &&
    minAvailableSlots !== undefined &&
    availableSlots !== minAvailableSlots
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "availableSlots と minAvailableSlots が一致しません。",
    });
  }

  const fingerprint = createQueryFingerprint({
    mode,
    region,
    states,
    minAvailableSlots:
      availableSlots === undefined ? minAvailableSlots : availableSlots,
    requireAvailable,
    limit: limitValue,
  });
  const cursorPosition =
    query.cursor === undefined
      ? null
      : await decodeCursor(query.cursor, tokenSecret, fingerprint);

  return {
    mode,
    region,
    states,
    requireAvailable,
    minAvailableSlots:
      availableSlots === undefined ? minAvailableSlots : availableSlots,
    limit: limitValue,
    cursor: query.cursor ?? null,
    cursorPosition,
    fingerprint,
  };
}

function normalizeFilter(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_FILTER_LENGTH
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${name} は 1 文字以上 ${MAX_FILTER_LENGTH} 文字以下で指定してください。`,
    });
  }

  return value.trim();
}

function normalizeState(
  state: RoomStatus | readonly RoomStatus[] | undefined,
  status: RoomStatus | readonly RoomStatus[] | undefined,
): readonly RoomStatus[] | undefined {
  const normalizedState = normalizeStates(state, "state");
  const normalizedStatus = normalizeStates(status, "status");

  if (
    normalizedState !== undefined &&
    normalizedStatus !== undefined &&
    !sameValues(normalizedState, normalizedStatus)
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "state と status が一致しません。",
    });
  }

  return normalizedState ?? normalizedStatus;
}

function normalizeStates(
  value: RoomStatus | readonly RoomStatus[] | undefined,
  name: string,
): readonly RoomStatus[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];

  if (values.length === 0 || !values.every(isRoomStatus)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: `${name} は waiting、preparing、in_progress、finished のいずれかで指定してください。`,
    });
  }

  return Object.freeze([...new Set(values)].sort());
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
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

function createQueryFingerprint(query: {
  readonly mode: string | undefined;
  readonly region: string | undefined;
  readonly states: readonly RoomStatus[] | undefined;
  readonly minAvailableSlots: number | undefined;
  readonly requireAvailable: boolean;
  readonly limit: number;
}): string {
  return JSON.stringify({
    mode: query.mode ?? null,
    region: query.region ?? null,
    states: query.states ?? null,
    minAvailableSlots: query.minAvailableSlots ?? null,
    requireAvailable: query.requireAvailable,
    limit: query.limit,
  });
}

function toRoomSummary(record: CustomRoomIndexRecord): RoomSummary {
  return Object.freeze({
    id: record.roomId,
    kind: "custom" as const,
    roomId: record.roomId,
    name: record.name,
    mode: record.mode,
    region: record.region,
    visibility: "public" as const,
    state: record.state,
    joinMethod: record.joinMethod,
    requiresPassword: record.joinMethod === "password",
    maxPlayers: record.maxPlayers,
    playerCount: record.playerCount,
    availableSlots: record.availableSlots,
    maxSpectators: record.maxSpectators,
    spectatorCount: record.spectatorCount,
    availableSpectatorSlots: record.availableSpectatorSlots,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

async function encodeCursor(
  tokenSecret: string,
  position: { readonly createdAt: number; readonly roomId: string },
  fingerprint: string,
): Promise<string> {
  const payload: CursorPayload = {
    version: CURSOR_VERSION,
    createdAt: position.createdAt,
    roomId: position.roomId,
    fingerprint,
  };
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await signCursor(tokenSecret, encodedPayload);

  return `${encodedPayload}.${encodeBase64Url(signature)}`;
}

async function decodeCursor(
  cursor: string,
  tokenSecret: string,
  expectedFingerprint: string,
): Promise<{ readonly createdAt: number; readonly roomId: string }> {
  if (!isNonEmptyString(tokenSecret)) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  if (!isNonEmptyString(cursor)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が正しくありません。",
    });
  }

  const [encodedPayload, encodedSignature, extra] = cursor.split(".");

  if (
    extra !== undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が正しくありません。",
    });
  }

  const expectedSignature = await signCursor(tokenSecret, encodedPayload);
  const actualSignature = decodeBase64Url(encodedSignature);

  if (!constantTimeEqual(expectedSignature, actualSignature)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が正しくありません。",
    });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    );
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が正しくありません。",
    });
  }

  if (!isRecord(payload)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が検索条件または一覧の形式と一致しません。",
    });
  }

  const createdAt = isSafeInteger(payload["createdAt"])
    ? payload["createdAt"]
    : null;
  const roomId = isNonEmptyString(payload["roomId"]) ? payload["roomId"] : null;

  if (
    payload["version"] !== CURSOR_VERSION ||
    createdAt === null ||
    roomId === null ||
    payload["fingerprint"] !== expectedFingerprint
  ) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が検索条件または一覧の形式と一致しません。",
    });
  }

  return {
    createdAt,
    roomId,
  };
}

async function signCursor(
  tokenSecret: string,
  encodedPayload: string,
): Promise<Uint8Array> {
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
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `flarelobby-room-list-v${CURSOR_VERSION}:${encodedPayload}`,
    ),
  );

  return new Uint8Array(signature);
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

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が正しくありません。",
    });
  }

  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new FlareLobbyError("INVALID_PAYLOAD", {
      message: "cursor が正しくありません。",
    });
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }

  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
