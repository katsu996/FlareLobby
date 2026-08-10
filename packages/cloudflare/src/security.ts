import {
  FlareLobbyError,
  decodeClientCommand
} from "@flarelobby/core";
import type {
  ClientCommandEnvelope,
  FlareLobbyErrorCode,
  Principal,
  ProtocolResult,
  RoomId
} from "@flarelobby/core";

/** 利用者が実装する、サーバー側の認証結果です。 */
export type FlareLobbyAuthenticationResult = Principal;

/** Gateway Worker が利用者の認証済み主体を取得する Hook です。 */
export type FlareLobbyAuthenticationHook = (
  request: Request
) =>
  | FlareLobbyAuthenticationResult
  | null
  | Promise<FlareLobbyAuthenticationResult | null>;

/** サーバー側で認可する操作の種別です。 */
export type FlareLobbyAuthorizationOperation =
  | "host_operation"
  | "join"
  | "spectate"
  | "match_result";

/** 認可 Hook に渡す、認証済み主体と操作対象です。 */
export interface FlareLobbyAuthorizationContext {
  readonly operation: FlareLobbyAuthorizationOperation;
  readonly principal: Principal;
  readonly roomId?: RoomId;
  readonly matchId?: string;
}

/** 認可 Hook の共通契約です。`true` のときだけ操作を許可します。 */
export type FlareLobbyAuthorizationHook = (
  context: FlareLobbyAuthorizationContext
) => boolean | Promise<boolean>;

/** 操作種別ごとに利用者が差し替えられる認可 Hook です。 */
export interface FlareLobbyAuthorizationHooks {
  readonly authorizeHostOperation?: FlareLobbyAuthorizationHook;
  readonly authorizeJoin?: FlareLobbyAuthorizationHook;
  readonly authorizeSpectate?: FlareLobbyAuthorizationHook;
  readonly authorizeMatchResult?: FlareLobbyAuthorizationHook;
}

/** 認可したい操作の対象です。主体は Gateway の認証結果から固定されます。 */
export interface FlareLobbyAuthorizationRequest {
  readonly operation: FlareLobbyAuthorizationOperation;
  readonly roomId?: RoomId;
  readonly matchId?: string;
}

/** 利用者が差し替えられる HTTP 本文・Query・コマンドの検証関数です。 */
export type FlareLobbyInputValidator<TValue> = (
  value: unknown
) => value is TValue;

/** 参加用と再開用の用途を区別するトークンの種別です。 */
export type FlareLobbyRoomTokenPurpose = "join" | "resume";

/** 参加トークンへ束縛する Room 内の役割です。 */
export type FlareLobbyRoomParticipantRole = "player" | "spectator";

/** 参加用または再開用トークンを発行するときの情報です。 */
export interface FlareLobbyRoomTokenIssueOptions {
  readonly principal: Principal;
  readonly roomId: RoomId;
  /** 参加者へ紐付ける役割。省略時は player です。 */
  readonly role?: FlareLobbyRoomParticipantRole;
  /** 参加者へ紐付けるサーバー発行の識別子です。 */
  readonly participantId?: string;
  /** Unix epoch milliseconds。現在より後の時刻を指定します。 */
  readonly expiresAt: number;
  /** テストなどで現在時刻を固定するときだけ指定します。 */
  readonly now?: number;
  /** 再開接続を同じ接続履歴へ束縛するときに使う内部識別子です。 */
  readonly nonce?: string;
}

/** 参加用または再開用トークンを検証するときの期待値です。 */
export interface FlareLobbyRoomTokenVerificationOptions {
  readonly principal: Principal;
  readonly roomId: RoomId;
  /** 指定時、トークンの役割も照合します。 */
  readonly role?: FlareLobbyRoomParticipantRole;
  /** 指定時、トークンの参加者識別子も照合します。 */
  readonly participantId?: string;
  /** テストなどで現在時刻を固定するときだけ指定します。 */
  readonly now?: number;
}

/** トークン検証に成功したときだけ公開する安全なクレームです。 */
export interface FlareLobbyRoomTokenClaims {
  readonly purpose: FlareLobbyRoomTokenPurpose;
  readonly role: FlareLobbyRoomParticipantRole;
  readonly principalId: string;
  readonly roomId: RoomId;
  readonly expiresAt: number;
  /** トークンと Room 内の再開セッションを結び付ける識別子です。 */
  readonly nonce: string;
  readonly participantId?: string;
}

/** Gateway と Room Durable Object が共有する WebSocket の基本 protocol 名です。 */
export const FLARE_LOBBY_WEBSOCKET_PROTOCOL = "flarelobby.v1" as const;

/** 参加用トークンを WebSocket subprotocol へ安全に運ぶための接頭辞です。 */
export const FLARE_LOBBY_WEBSOCKET_AUTH_PROTOCOL_PREFIX =
  "flarelobby.auth." as const;

/** 主体をまだ復元できない WebSocket 接続で行うトークン検証の期待値です。 */
export interface FlareLobbyWebSocketJoinTokenVerificationOptions {
  readonly roomId: RoomId;
  readonly role?: FlareLobbyRoomParticipantRole;
  readonly participantId?: string;
  /** テストなどで現在時刻を固定するときだけ指定します。 */
  readonly now?: number;
}

/** WebSocket Upgrade で参加用または再開用トークンを検証する共通入力です。 */
export type FlareLobbyWebSocketRoomTokenVerificationOptions =
  FlareLobbyWebSocketJoinTokenVerificationOptions;

/** Gateway から Durable Object へ渡す、署名済み主体の内部証明です。 */
export interface GatewayPrincipalEnvelope {
  readonly token: string;
}

/** Gateway で認証済みの要求です。 */
export interface AuthenticatedGatewayRequest {
  readonly principal: Principal;
  readonly gatewayPrincipal: GatewayPrincipalEnvelope;
}

/** 分散した利用制限 Durable Object に記録する操作の種別です。 */
export const FLARE_LOBBY_RATE_LIMIT_SCOPES = [
  "websocket_message",
  "room_creation"
] as const;

/** 分散した利用制限 Durable Object に記録する操作の種別です。 */
export type FlareLobbyRateLimitScope =
  (typeof FLARE_LOBBY_RATE_LIMIT_SCOPES)[number];

/** 利用制限を消費した結果です。 */
export interface FlareLobbyRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

const TOKEN_VERSION = 1 as const;
const GATEWAY_PRINCIPAL_TTL_MS = 60_000;
const TOKEN_SIGNATURE_CONTEXT = "flarelobby-token-v1";
const textEncoder = new TextEncoder();

interface RoomTokenPayload {
  readonly version: typeof TOKEN_VERSION;
  readonly kind: "room";
  readonly purpose: FlareLobbyRoomTokenPurpose;
  readonly role: FlareLobbyRoomParticipantRole;
  readonly principalId: string;
  readonly roomId: RoomId;
  readonly expiresAt: number;
  readonly nonce: string;
  readonly participantId?: string;
}

interface GatewayTokenPayload {
  readonly version: typeof TOKEN_VERSION;
  readonly kind: "gateway";
  readonly principalId: string;
  readonly playerId: string;
  readonly expiresAt: number;
  readonly nonce: string;
}

type SignedTokenPayload = RoomTokenPayload | GatewayTokenPayload;

/**
 * 認証 Hook の戻り値を、余分なプロパティを持たない読み取り専用の `Principal` へ
 * 正規化します。Gateway は認証 Hook の戻り値だけをこの関数へ渡します。
 */
export function normalizePrincipal(value: unknown): Principal | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const playerId = value["playerId"];

  if (!isNonEmptyString(id) || !isNonEmptyString(playerId)) {
    return null;
  }

  return Object.freeze({ id, playerId });
}

/**
 * 認証 Hook を安全に実行し、失敗または不正な戻り値を未認証として扱います。
 * 認証実装の内部例外は公開しません。
 */
export async function authenticateRequest(
  request: Request,
  authenticate: FlareLobbyAuthenticationHook
): Promise<Principal | null> {
  try {
    return normalizePrincipal(await authenticate(request));
  } catch {
    return null;
  }
}

/** Gateway の認証結果から、DO に渡せる短命の署名済み主体を作ります。 */
export async function authenticateGatewayRequest(
  request: Request,
  authenticate: FlareLobbyAuthenticationHook,
  tokenSecret: string,
  now = Date.now()
): Promise<ProtocolResult<AuthenticatedGatewayRequest>> {
  const principal = await authenticateRequest(request, authenticate);

  if (principal === null) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const gatewayPrincipal = await createGatewayPrincipalEnvelope(
    tokenSecret,
    principal,
    now
  );

  if (!gatewayPrincipal.ok) {
    return gatewayPrincipal;
  }

  return protocolSuccess(
    Object.freeze({
      principal,
      gatewayPrincipal: gatewayPrincipal.value
    })
  );
}

/**
 * 認可 Hook を実行します。Hook が未設定、例外、または `false` を返した場合は
 * 安全側に倒して拒否します。
 */
export async function authorizeGatewayOperation(
  request: AuthenticatedGatewayRequest,
  authorization: FlareLobbyAuthorizationHooks | undefined,
  target: FlareLobbyAuthorizationRequest
): Promise<ProtocolResult<void>> {
  const hook = selectAuthorizationHook(authorization, target.operation);

  if (hook === undefined) {
    return protocolFailure("FORBIDDEN");
  }

  const context = Object.freeze({
    ...target,
    principal: request.principal
  });

  try {
    if (await hook(context)) {
      return protocolSuccess(undefined);
    }
  } catch {
    // 認可 Hook の例外は権限不足として扱い、内部実装を公開しません。
  }

  return protocolFailure("FORBIDDEN");
}

/** 設定済み上限以内で HTTP 本文を読み、JSON として検証します。 */
export async function readValidatedJsonBody<TValue>(
  request: Request,
  maxBytes: number,
  validator: FlareLobbyInputValidator<TValue>
): Promise<ProtocolResult<TValue>> {
  const bytes = await readRequestBodyWithinLimit(request, maxBytes);

  if (!bytes.ok) {
    return bytes;
  }

  let value: unknown;

  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes.value
      )
    );
  } catch {
    return protocolFailure("INVALID_MESSAGE");
  }

  return validateInput(value, validator);
}

/** Query を共通の検証関数へ渡し、不正値を安定した公開エラーへ変換します。 */
export function validateQuery<TValue>(
  request: Request,
  validator: FlareLobbyInputValidator<TValue>
): ProtocolResult<TValue> {
  return validateInput(new URL(request.url).searchParams, validator);
}

/** WebSocket コマンドのサイズ、UTF-8、プロトコル、用途固有の検証を一度に行います。 */
export function validateWebSocketCommand(
  message: string | ArrayBuffer,
  maxBytes: number,
  validator?: FlareLobbyInputValidator<ClientCommandEnvelope>
): ProtocolResult<ClientCommandEnvelope> {
  const decoded = decodeWebSocketMessage(message, maxBytes);

  if (!decoded.ok) {
    return decoded;
  }

  const command = decodeClientCommand(decoded.value);

  if (!command.ok) {
    return command;
  }

  return validator === undefined
    ? command
    : validateInput(command.value, validator, command.value.requestId);
}

/** WebSocket subprotocol から参加用トークンを読み取ります。トークン自体は公開しません。 */
export function readWebSocketJoinToken(
  request: Request
): ProtocolResult<string> {
  const header = request.headers.get("Sec-WebSocket-Protocol");

  if (header === null) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const protocols = header
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0);
  const authProtocols = protocols.filter((protocol) =>
    protocol.startsWith(FLARE_LOBBY_WEBSOCKET_AUTH_PROTOCOL_PREFIX)
  );

  if (authProtocols.length !== 1) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const encodedToken = authProtocols[0]?.slice(
    FLARE_LOBBY_WEBSOCKET_AUTH_PROTOCOL_PREFIX.length
  );

  if (!isNonEmptyString(encodedToken)) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const tokenBytes = decodeBase64Url(encodedToken);

  if (
    tokenBytes === null ||
    encodeBase64Url(tokenBytes) !== encodedToken
  ) {
    return protocolFailure("UNAUTHENTICATED");
  }

  try {
    const token = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false
    }).decode(tokenBytes);

    return isNonEmptyString(token)
      ? protocolSuccess(token)
      : protocolFailure("UNAUTHENTICATED");
  } catch {
    return protocolFailure("UNAUTHENTICATED");
  }
}

/** 参加用の期限付きトークンを発行します。 */
export async function issueJoinToken(
  tokenSecret: string,
  options: FlareLobbyRoomTokenIssueOptions
): Promise<ProtocolResult<string>> {
  return issueRoomToken(tokenSecret, "join", options);
}

/** 再開用の期限付きトークンを発行します。 */
export async function issueResumeToken(
  tokenSecret: string,
  options: FlareLobbyRoomTokenIssueOptions
): Promise<ProtocolResult<string>> {
  return issueRoomToken(tokenSecret, "resume", options);
}

/** 参加用トークンを、主体・ルーム・用途・期限まで照合して検証します。 */
export async function verifyJoinToken(
  tokenSecret: string,
  token: string,
  options: FlareLobbyRoomTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  return verifyRoomToken(tokenSecret, token, "join", options);
}

/** 主体を別経路で持たない WebSocket Upgrade 用に、署名済み参加用トークンを検証します。 */
export async function verifyWebSocketJoinToken(
  tokenSecret: string,
  token: string,
  options: FlareLobbyWebSocketJoinTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  return verifyWebSocketRoomTokenPurpose(tokenSecret, token, "join", options);
}

/** 主体を別経路で持たない WebSocket Upgrade 用に、再開用トークンを検証します。 */
export async function verifyWebSocketResumeToken(
  tokenSecret: string,
  token: string,
  options: FlareLobbyWebSocketJoinTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  return verifyWebSocketRoomTokenPurpose(tokenSecret, token, "resume", options);
}

/** WebSocket Upgrade 用に、参加用または再開用トークンを検証します。 */
export async function verifyWebSocketRoomToken(
  tokenSecret: string,
  token: string,
  options: FlareLobbyWebSocketRoomTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  const join = await verifyWebSocketRoomTokenPurpose(
    tokenSecret,
    token,
    "join",
    options
  );

  if (join.ok) {
    return join;
  }

  return verifyWebSocketRoomTokenPurpose(tokenSecret, token, "resume", options);
}

async function verifyWebSocketRoomTokenPurpose(
  tokenSecret: string,
  token: string,
  purpose: FlareLobbyRoomTokenPurpose,
  options: FlareLobbyWebSocketRoomTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  const now = options.now ?? Date.now();

  if (
    !isNonEmptyString(options.roomId) ||
    (options.role !== undefined && !isRoomParticipantRole(options.role)) ||
    (options.participantId !== undefined &&
      !isNonEmptyString(options.participantId)) ||
    !isSafeTimestamp(now) ||
    !isUsableSecret(tokenSecret)
  ) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const payload = await verifySignedToken(tokenSecret, token);

  if (
    payload === null ||
    payload.kind !== "room" ||
    payload.purpose !== purpose ||
    payload.expiresAt <= now ||
    payload.roomId !== options.roomId ||
    (options.role !== undefined && payload.role !== options.role) ||
    (options.participantId !== undefined &&
      payload.participantId !== options.participantId)
  ) {
    return protocolFailure("UNAUTHENTICATED");
  }

  return protocolSuccess(
    Object.freeze({
      purpose: payload.purpose,
      role: payload.role,
      principalId: payload.principalId,
      roomId: payload.roomId,
      expiresAt: payload.expiresAt,
      nonce: payload.nonce,
      ...(payload.participantId === undefined
        ? {}
        : { participantId: payload.participantId })
    })
  );
}

/** 再開用トークンを、主体・ルーム・用途・期限まで照合して検証します。 */
export async function verifyResumeToken(
  tokenSecret: string,
  token: string,
  options: FlareLobbyRoomTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  return verifyRoomToken(tokenSecret, token, "resume", options);
}

/** Gateway だけが発行する、Durable Object 向けの短命な主体証明を作ります。 */
export async function createGatewayPrincipalEnvelope(
  tokenSecret: string,
  principalInput: Principal,
  now = Date.now()
): Promise<ProtocolResult<GatewayPrincipalEnvelope>> {
  const principal = normalizePrincipal(principalInput);

  if (principal === null || !isSafeTimestamp(now) || !isUsableSecret(tokenSecret)) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const payload: GatewayTokenPayload = {
    version: TOKEN_VERSION,
    kind: "gateway",
    principalId: principal.id,
    playerId: principal.playerId,
    expiresAt: now + GATEWAY_PRINCIPAL_TTL_MS,
    nonce: createTokenNonce()
  };

  return protocolSuccess(
    Object.freeze({
      token: await createSignedToken(tokenSecret, payload)
    })
  );
}

/** Durable Object で Gateway の内部主体証明を検証し、成功時だけ主体を返します。 */
export async function verifyGatewayPrincipalEnvelope(
  tokenSecret: string,
  envelope: GatewayPrincipalEnvelope,
  now = Date.now()
): Promise<Principal | null> {
  if (!isUsableSecret(tokenSecret) || !isRecord(envelope) || !isNonEmptyString(envelope["token"])) {
    return null;
  }

  const payload = await verifySignedToken(tokenSecret, envelope["token"]);

  if (
    payload === null ||
    payload.kind !== "gateway" ||
    !isSafeTimestamp(now) ||
    payload.expiresAt <= now
  ) {
    return null;
  }

  return normalizePrincipal({
    id: payload.principalId,
    playerId: payload.playerId
  });
}

/** `FlareLobbyError` を HTTP の安全な失敗応答へ変換します。 */
export function createErrorResponse(error: FlareLobbyError): Response {
  const status =
    error.code === "UNAUTHENTICATED"
      ? 401
      : error.code === "FORBIDDEN"
        ? 403
        : 400;

  return Response.json(error.toJSON(), { status });
}

async function issueRoomToken(
  tokenSecret: string,
  purpose: FlareLobbyRoomTokenPurpose,
  options: FlareLobbyRoomTokenIssueOptions
): Promise<ProtocolResult<string>> {
  const principal = normalizePrincipal(options.principal);
  const now = options.now ?? Date.now();
  const nonce = options.nonce ?? createTokenNonce();

  if (
    principal === null ||
    !isNonEmptyString(options.roomId) ||
    (options.role !== undefined && !isRoomParticipantRole(options.role)) ||
    (options.participantId !== undefined &&
      !isNonEmptyString(options.participantId)) ||
    !isSafeTimestamp(now) ||
    !isSafeTimestamp(options.expiresAt) ||
    options.expiresAt <= now ||
    !isNonEmptyString(nonce) ||
    nonce.length > 256 ||
    !isUsableSecret(tokenSecret)
  ) {
    return protocolFailure("INVALID_PAYLOAD");
  }

  const payload: RoomTokenPayload = {
    version: TOKEN_VERSION,
    kind: "room",
    purpose,
    role: options.role ?? "player",
    principalId: principal.id,
    roomId: options.roomId,
    expiresAt: options.expiresAt,
    nonce,
    ...(options.participantId === undefined
      ? {}
      : { participantId: options.participantId })
  };

  return protocolSuccess(await createSignedToken(tokenSecret, payload));
}

async function verifyRoomToken(
  tokenSecret: string,
  token: string,
  purpose: FlareLobbyRoomTokenPurpose,
  options: FlareLobbyRoomTokenVerificationOptions
): Promise<ProtocolResult<FlareLobbyRoomTokenClaims>> {
  const principal = normalizePrincipal(options.principal);
  const now = options.now ?? Date.now();

  if (
    principal === null ||
    !isNonEmptyString(options.roomId) ||
    (options.role !== undefined && !isRoomParticipantRole(options.role)) ||
    (options.participantId !== undefined &&
      !isNonEmptyString(options.participantId)) ||
    !isSafeTimestamp(now) ||
    !isUsableSecret(tokenSecret)
  ) {
    return protocolFailure("UNAUTHENTICATED");
  }

  const payload = await verifySignedToken(tokenSecret, token);

  if (
    payload === null ||
    payload.kind !== "room" ||
    payload.purpose !== purpose ||
    payload.expiresAt <= now ||
    payload.principalId !== principal.id ||
    payload.roomId !== options.roomId ||
    (options.role !== undefined && payload.role !== options.role) ||
    (options.participantId !== undefined &&
      payload.participantId !== options.participantId)
  ) {
    return protocolFailure("UNAUTHENTICATED");
  }

  return protocolSuccess(
    Object.freeze({
      purpose: payload.purpose,
      role: payload.role,
      principalId: payload.principalId,
      roomId: payload.roomId,
      expiresAt: payload.expiresAt,
      nonce: payload.nonce,
      ...(payload.participantId === undefined
        ? {}
        : { participantId: payload.participantId })
    })
  );
}

async function readRequestBodyWithinLimit(
  request: Request,
  maxBytes: number
): Promise<ProtocolResult<Uint8Array>> {
  if (!isPositiveSafeInteger(maxBytes)) {
    return protocolFailure("INVALID_MESSAGE");
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return protocolFailure("INVALID_MESSAGE");
    }

    const declaredLength = Number(contentLength);

    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      return protocolFailure(
        "INVALID_MESSAGE",
        "要求本文が許可された上限を超えています。"
      );
    }
  }

  if (request.body === null) {
    return protocolSuccess(new Uint8Array());
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // すでに切断済みでも、公開する結果は上限超過で一定にします。
        }

        return protocolFailure(
          "INVALID_MESSAGE",
          "要求本文が許可された上限を超えています。"
        );
      }

      chunks.push(value);
    }
  } catch {
    return protocolFailure("INVALID_MESSAGE");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return protocolSuccess(bytes);
}

function decodeWebSocketMessage(
  message: string | ArrayBuffer,
  maxBytes: number
): ProtocolResult<string> {
  if (!isPositiveSafeInteger(maxBytes)) {
    return protocolFailure("INVALID_MESSAGE");
  }

  if (typeof message === "string") {
    if (textEncoder.encode(message).byteLength > maxBytes) {
      return protocolFailure(
        "INVALID_MESSAGE",
        "WebSocket メッセージが許可された上限を超えています。"
      );
    }

    return protocolSuccess(message);
  }

  if (message.byteLength > maxBytes) {
    return protocolFailure(
      "INVALID_MESSAGE",
      "WebSocket メッセージが許可された上限を超えています。"
    );
  }

  try {
    return protocolSuccess(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(message)
    );
  } catch {
    return protocolFailure("INVALID_MESSAGE");
  }
}

function validateInput<TValue>(
  value: unknown,
  validator: FlareLobbyInputValidator<TValue>,
  requestId?: string
): ProtocolResult<TValue> {
  try {
    return validator(value)
      ? protocolSuccess(value)
      : protocolFailure("INVALID_PAYLOAD", undefined, requestId);
  } catch {
    return protocolFailure("INVALID_PAYLOAD", undefined, requestId);
  }
}

function selectAuthorizationHook(
  authorization: FlareLobbyAuthorizationHooks | undefined,
  operation: FlareLobbyAuthorizationOperation
): FlareLobbyAuthorizationHook | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  switch (operation) {
    case "host_operation":
      return authorization.authorizeHostOperation;
    case "join":
      return authorization.authorizeJoin;
    case "spectate":
      return authorization.authorizeSpectate;
    case "match_result":
      return authorization.authorizeMatchResult;
  }
}

async function createSignedToken(
  tokenSecret: string,
  payload: SignedTokenPayload
): Promise<string> {
  const encodedPayload = encodeBase64Url(
    textEncoder.encode(JSON.stringify(payload))
  );
  const signature = await signTokenSegment(tokenSecret, encodedPayload);

  return `${encodedPayload}.${encodeBase64Url(signature)}`;
}

async function verifySignedToken(
  tokenSecret: string,
  token: string
): Promise<SignedTokenPayload | null> {
  if (!isNonEmptyString(token)) {
    return null;
  }

  const segments = token.split(".");
  const encodedPayload = segments[0];
  const encodedSignature = segments[1];

  if (
    segments.length !== 2 ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    return null;
  }

  const signature = decodeBase64Url(encodedSignature);

  if (
    signature === null ||
    encodeBase64Url(signature) !== encodedSignature
  ) {
    return null;
  }

  const key = await importSigningKey(tokenSecret, ["verify"]);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    textEncoder.encode(`${TOKEN_SIGNATURE_CONTEXT}.${encodedPayload}`)
  );

  if (!isValid) {
    return null;
  }

  const payloadBytes = decodeBase64Url(encodedPayload);

  if (payloadBytes === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        payloadBytes
      )
    );

    return parseSignedTokenPayload(parsed);
  } catch {
    return null;
  }
}

async function signTokenSegment(
  tokenSecret: string,
  encodedPayload: string
): Promise<Uint8Array> {
  const key = await importSigningKey(tokenSecret, ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(`${TOKEN_SIGNATURE_CONTEXT}.${encodedPayload}`)
  );

  return new Uint8Array(signature);
}

function importSigningKey(
  tokenSecret: string,
  usages: string[]
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(tokenSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

function parseSignedTokenPayload(value: unknown): SignedTokenPayload | null {
  if (!isRecord(value) || value["version"] !== TOKEN_VERSION) {
    return null;
  }

  const kind = value["kind"];
  const role = value["role"] ?? "player";
  const principalId = value["principalId"];
  const expiresAt = value["expiresAt"];
  const nonce = value["nonce"];
  const participantId = value["participantId"];

  if (
    !isRoomParticipantRole(role) ||
    !isNonEmptyString(principalId) ||
    !isSafeTimestamp(expiresAt) ||
    !isNonEmptyString(nonce) ||
    (participantId !== undefined && !isNonEmptyString(participantId))
  ) {
    return null;
  }

  if (kind === "room") {
    const purpose = value["purpose"];
    const roomId = value["roomId"];

    if (
      (purpose !== "join" && purpose !== "resume") ||
      !isNonEmptyString(roomId)
    ) {
      return null;
    }

    return {
      version: TOKEN_VERSION,
      kind,
      purpose,
      role,
      principalId,
      roomId,
      expiresAt,
      nonce,
      ...(participantId === undefined ? {} : { participantId })
    };
  }

  if (kind === "gateway") {
    const playerId = value["playerId"];

    if (!isNonEmptyString(playerId)) {
      return null;
    }

    return {
      version: TOKEN_VERSION,
      kind,
      principalId,
      playerId,
      expiresAt,
      nonce
    };
  }

  return null;
}

function createTokenNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
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

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }

  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      const character = binary.codePointAt(index);

      if (character === undefined) {
        return null;
      }

      bytes[index] = character;
    }

    return bytes;
  } catch {
    return null;
  }
}

function protocolSuccess<TValue>(value: TValue): ProtocolResult<TValue> {
  return { ok: true, value };
}

function protocolFailure<TValue>(
  code: FlareLobbyErrorCode,
  message?: string,
  requestId?: string
): ProtocolResult<TValue> {
  return {
    ok: false,
    error: new FlareLobbyError(
      code,
      message === undefined && requestId === undefined
        ? {}
        : {
            ...(message === undefined ? {} : { message }),
            ...(requestId === undefined ? {} : { requestId })
          }
    )
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isUsableSecret(value: unknown): value is string {
  return isNonEmptyString(value);
}

function isRoomParticipantRole(
  value: unknown
): value is FlareLobbyRoomParticipantRole {
  return value === "player" || value === "spectator";
}
