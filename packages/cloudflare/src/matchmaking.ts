import {
  FlareLobbyError
} from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  JsonObject,
  JsonValue,
  MatchmakingPool,
  Principal,
  RoomSnapshot
} from "@flarelobby/core";

import type {
  FlareLobbyBindings,
  FlareLobbyConfiguration,
  MatchmakingPoolConfiguration
} from "./config.js";
import {
  getRating as getStoredRating,
  registerMatchResult
} from "./rating.js";
import type { MatchResultRegistrationInput } from "./rating.js";
import {
  authorizeGatewayOperation,
  createErrorResponse,
  authenticateGatewayRequest,
  issueJoinToken,
  readValidatedJsonBody,
  readWebSocketJoinToken
} from "./security.js";
import type { AuthenticatedGatewayRequest } from "./security.js";
import type {
  MatchPoolInitializationOptions,
  MatchmakingMatchIntent,
  MatchmakingTicketRecord
} from "./match-pool.js";

const MATCHMAKING_JOIN_TOKEN_TTL_MS = 10 * 60 * 1_000;

/** マッチングチケットのイベント接続へ Gateway が返す接続先です。 */
export interface MatchmakingTicketWebSocketRoute {
  readonly poolId: string;
  readonly ticketId: string;
}

/** 成立済み対戦 Room へ接続するための一時的な情報です。 */
export interface MatchmakingRoomConnection {
  readonly roomId: string;
  readonly participantId: string;
  readonly role: "player";
  readonly joinToken: string;
  readonly websocketUrl: string;
  readonly snapshot: RoomSnapshot;
}

/** Gateway が Client SDK へ返すチケット応答です。 */
export interface MatchmakingTicketGatewayResponse {
  readonly ticket: MatchmakingTicketRecord;
  readonly connection?: MatchmakingRoomConnection;
}

interface MatchPoolGatewayStub {
  initialize(input: MatchPoolInitializationOptions | MatchmakingPool): Promise<MatchmakingPool>;
  getMatchIntent(
    matchIdOrCandidateId:
      | string
      | { readonly matchId?: string; readonly candidateId?: string }
  ): Promise<MatchmakingMatchIntent | null>;
  createTicket(options: {
    readonly gatewayPrincipal: AuthenticatedGatewayRequest["gatewayPrincipal"];
    readonly requestId: string;
    readonly rating: number | Partial<{ readonly value: number }>;
    readonly region?: string;
    readonly inputMethod?: string;
    readonly inputMode?: string;
    readonly searchAttributes?: JsonObject;
    readonly expiresAt?: number | string;
    readonly ttlMs?: number;
    readonly pool?: MatchmakingPool;
  }): Promise<MatchmakingTicketRecord>;
  getTicket(ticketId: string): Promise<MatchmakingTicketRecord | null>;
  cancelTicket(options: {
    readonly gatewayPrincipal: AuthenticatedGatewayRequest["gatewayPrincipal"];
    readonly ticketId: string;
    readonly requestId?: string;
    readonly requestPayload?: JsonValue;
  }): Promise<MatchmakingTicketRecord>;
  fetch(request: Request): Promise<Response>;
}

interface MatchRoomGatewayStub {
  getSnapshot(): Promise<RoomSnapshot | null>;
}

/** マッチングイベント WebSocket の URL を Gateway で判定します。 */
export function getMatchmakingTicketWebSocketRoute(
  pathname: string
): MatchmakingTicketWebSocketRoute | null {
  const segments = decodePathSegments(pathname);
  if (
    segments === null ||
    segments.length !== 8 ||
    segments[0] !== "v1" ||
    segments[1] !== "matchmaking" ||
    segments[2] !== "pools" ||
    segments[4] !== "tickets" ||
    segments[6] !== "events" ||
    segments[7] !== "ws"
  ) {
    return null;
  }

  return {
    poolId: segments[3]!,
    ticketId: segments[5]!
  };
}

/** `createGatewayWorker()` からマッチングの HTTP API を処理します。 */
export async function handleMatchmakingRequest<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest
): Promise<Response | null> {
  const route = parseMatchmakingRoute(new URL(request.url).pathname);
  if (route === null || route.action === "eventsWebSocket") {
    return null;
  }

  try {
    const poolConfiguration = findPoolConfiguration(
      configuration.matchmakingPools,
      route.poolId
    );
    if (poolConfiguration === null) {
      return createErrorResponse(new FlareLobbyError("CONFLICT"));
    }

    const pool = await initializeMatchPool(env, poolConfiguration);
    const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool)
    ) as unknown as MatchPoolGatewayStub;

    if (route.action === "rating") {
      if (request.method !== "GET") {
        return new Response("Not Found", { status: 404 });
      }

      const rating = await getStoredRating(
        env.FLARE_LOBBY_DB,
        pool,
        authenticatedRequest.principal.playerId,
        poolConfiguration.rating
      );
      return Response.json({ rating });
    }

    if (route.action === "result") {
      if (request.method !== "POST" || route.matchId === undefined) {
        return new Response("Not Found", { status: 404 });
      }

      return await registerGatewayMatchResult(
        request,
        env,
        configuration,
        authenticatedRequest,
        poolConfiguration,
        pool,
        poolStub,
        route.matchId
      );
    }

    if (route.action === "create") {
      if (request.method !== "POST") {
        return new Response("Not Found", { status: 404 });
      }
      return await createTicket(
        request,
        env,
        configuration,
        authenticatedRequest,
        poolStub,
        pool,
        poolConfiguration
      );
    }

    if (route.ticketId === undefined) {
      return new Response("Not Found", { status: 404 });
    }

    const ticket = await poolStub.getTicket(route.ticketId);
    if (ticket === null) {
      return createErrorResponse(
        new FlareLobbyError("CONFLICT", {
          message: "存在しないマッチングチケットです。"
        })
      );
    }

    if (!ownsTicket(ticket, authenticatedRequest.principal)) {
      return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
    }

    if (route.action === "get") {
      return request.method === "GET"
        ? Response.json({ ticket })
        : new Response("Not Found", { status: 404 });
    }

    if (route.action === "cancel") {
      if (request.method !== "POST" && request.method !== "DELETE") {
        return new Response("Not Found", { status: 404 });
      }
      return await cancelTicket(
        request,
        configuration,
        authenticatedRequest,
        poolStub,
        route.ticketId
      );
    }

    if (route.action === "events") {
      if (request.method !== "GET") {
        return new Response("Not Found", { status: 404 });
      }
      const headers = new Headers(request.headers);
      headers.set(
        "Authorization",
        `Bearer ${authenticatedRequest.gatewayPrincipal.token}`
      );
      return await poolStub.fetch(new Request(request, { headers }));
    }

    if (route.action === "connection") {
      if (request.method !== "GET" || ticket.status !== "matched") {
        return ticket.status === "matched"
          ? new Response("Not Found", { status: 404 })
          : createErrorResponse(new FlareLobbyError("CONFLICT"));
      }
      const connection = await createMatchRoomConnection(
        request,
        env,
        authenticatedRequest,
        ticket
      );
      return Response.json({ ticket, connection });
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    return createErrorResponse(normalizeGatewayError(error));
  }
}

/** WebSocket subprotocol のアクセストークンを Gateway Token へ変換して転送します。 */
export async function upgradeMatchmakingTicketWebSocket<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  route: MatchmakingTicketWebSocketRoute
): Promise<Response> {
  if (
    request.method !== "GET" ||
    request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
  ) {
    return createErrorResponse(new FlareLobbyError("INVALID_MESSAGE"));
  }

  const token = readWebSocketJoinToken(request);
  if (!token.ok) {
    return createErrorResponse(token.error);
  }

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token.value}`);
  const authenticationRequest = new Request(request, { headers });
  const authenticatedRequest = await authenticateGatewayRequest(
    authenticationRequest,
    configuration.authenticate,
    env.FLARE_LOBBY_TOKEN_SECRET
  );

  if (!authenticatedRequest.ok) {
    return createErrorResponse(authenticatedRequest.error);
  }

  const poolConfiguration = findPoolConfiguration(
    configuration.matchmakingPools,
    route.poolId
  );
  if (poolConfiguration === null) {
    return createErrorResponse(new FlareLobbyError("CONFLICT"));
  }

  try {
    const pool = await initializeMatchPool(env, poolConfiguration);
    const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool)
    ) as unknown as MatchPoolGatewayStub;
    const ticket = await poolStub.getTicket(route.ticketId);

    if (ticket === null) {
      return createErrorResponse(new FlareLobbyError("CONFLICT"));
    }
    if (!ownsTicket(ticket, authenticatedRequest.value.principal)) {
      return createErrorResponse(new FlareLobbyError("FORBIDDEN"));
    }

    headers.set(
      "Authorization",
      `Bearer ${authenticatedRequest.value.gatewayPrincipal.token}`
    );
    return await poolStub.fetch(new Request(request, { headers }));
  } catch (error) {
    return createErrorResponse(normalizeGatewayError(error));
  }
}

async function createTicket<TApp extends AnyFlareLobbyApp>(
  request: Request,
  env: FlareLobbyBindings,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
  poolStub: MatchPoolGatewayStub,
  pool: MatchmakingPool,
  poolConfiguration: MatchmakingPoolConfiguration
): Promise<Response> {
  const body = await readValidatedJsonBody(
    request,
    configuration.inputLimits.maxHttpRequestBytes,
    isJsonObject
  );
  if (!body.ok) {
    return createErrorResponse(body.error);
  }

  const requestId = readRequestId(request, body.value);
  if (requestId === null) {
    return createErrorResponse(new FlareLobbyError("INVALID_PAYLOAD"));
  }

  const requestedPool = body.value["pool"];
  if (requestedPool !== undefined && !samePoolValue(requestedPool, pool)) {
    return createErrorResponse(new FlareLobbyError("CONFLICT"));
  }

  const region = readOptionalString(body.value["region"]);
  const inputMethod = readOptionalString(body.value["inputMethod"]);
  const inputMode = readOptionalString(body.value["inputMode"]);
  const searchAttributes = readOptionalJsonObject(
    body.value["searchAttributes"]
  );
  const expiresAt = readOptionalExpiry(body.value["expiresAt"]);
  const ttlMs = readOptionalNumber(body.value["ttlMs"]);
  const requestedRating = readRating(body.value["rating"]);
  const rating =
    requestedRating ??
    (
      await getStoredRating(
        env.FLARE_LOBBY_DB,
        pool,
        authenticatedRequest.principal.playerId,
        poolConfiguration.rating
      )
    ).value;
  const options = {
    gatewayPrincipal: authenticatedRequest.gatewayPrincipal,
    requestId,
    rating,
    ...(region === undefined ? {} : { region }),
    ...(inputMethod === undefined ? {} : { inputMethod }),
    ...(inputMode === undefined ? {} : { inputMode }),
    ...(searchAttributes === undefined ? {} : { searchAttributes }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(ttlMs === undefined ? {} : { ttlMs }),
    pool
  };
  const ticket = await poolStub.createTicket(options);
  return Response.json({ ticket }, { status: 201 });
}

async function cancelTicket<TApp extends AnyFlareLobbyApp>(
  request: Request,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
  poolStub: MatchPoolGatewayStub,
  ticketId: string
): Promise<Response> {
  let body: JsonObject = { ticketId };
  if (request.method !== "DELETE") {
    const parsed = await readValidatedJsonBody(
      request,
      configuration.inputLimits.maxHttpRequestBytes,
      isJsonObject
    );
    if (!parsed.ok) {
      return createErrorResponse(parsed.error);
    }
    body = parsed.value;
  }

  const requestId = readRequestId(request, body);
  const ticket = await poolStub.cancelTicket({
    gatewayPrincipal: authenticatedRequest.gatewayPrincipal,
    ticketId,
    ...(requestId === null ? {} : { requestId }),
    requestPayload: body
  });
  return Response.json({ ticket });
}

async function registerGatewayMatchResult<TApp extends AnyFlareLobbyApp>(
  request: Request,
  env: FlareLobbyBindings,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
  poolConfiguration: MatchmakingPoolConfiguration,
  pool: MatchmakingPool,
  poolStub: MatchPoolGatewayStub,
  matchId: string
): Promise<Response> {
  const authorization = await authorizeGatewayOperation(
    authenticatedRequest,
    configuration.authorization,
    { operation: "match_result", matchId }
  );
  if (!authorization.ok) {
    return createErrorResponse(authorization.error);
  }

  const body = await readValidatedJsonBody(
    request,
    configuration.inputLimits.maxHttpRequestBytes,
    isJsonObject
  );
  if (!body.ok) {
    return createErrorResponse(body.error);
  }

  const input = readMatchResultInput(body.value, matchId);
  const intent = await poolStub.getMatchIntent({ matchId });
  if (intent === null || intent.status !== "matched" || intent.result === null) {
    throw new FlareLobbyError("CONFLICT");
  }

  const [playerATicketId, playerBTicketId] = intent.result.candidate.ticketIds;
  const playerATicket = await poolStub.getTicket(playerATicketId);
  const playerBTicket = await poolStub.getTicket(playerBTicketId);
  if (
    playerATicket === null ||
    playerBTicket === null ||
    playerATicket.status !== "matched" ||
    playerBTicket.status !== "matched" ||
    playerATicket.result.matchId !== matchId ||
    playerBTicket.result.matchId !== matchId
  ) {
    throw new FlareLobbyError("CONFLICT");
  }

  const registration = await registerMatchResult(
    env.FLARE_LOBBY_DB,
    pool,
    {
      ...input,
      playerAId: playerATicket.player.id,
      playerBId: playerBTicket.player.id
    },
    poolConfiguration.rating
  );

  return Response.json({
    match: registration.match,
    applied: registration.applied
  });
}

async function createMatchRoomConnection(
  request: Request,
  env: FlareLobbyBindings,
  authenticatedRequest: AuthenticatedGatewayRequest,
  ticket: Extract<MatchmakingTicketRecord, { readonly status: "matched" }>
): Promise<MatchmakingRoomConnection> {
  const index = ticket.result.candidate.ticketIds.indexOf(ticket.id);
  if (index < 0) {
    throw new FlareLobbyError("CONFLICT");
  }

  const participantId = `participant_${ticket.result.matchId}_${index + 1}`;
  const joinToken = await issueJoinToken(env.FLARE_LOBBY_TOKEN_SECRET, {
    principal: authenticatedRequest.principal,
    roomId: ticket.result.room.id,
    role: "player",
    participantId,
    expiresAt: Date.now() + MATCHMAKING_JOIN_TOKEN_TTL_MS
  });
  if (!joinToken.ok) {
    throw joinToken.error;
  }

  const room = env.FLARE_LOBBY_ROOMS.getByName(
    ticket.result.room.id
  ) as unknown as MatchRoomGatewayStub;
  const snapshot = await room.getSnapshot();
  if (
    snapshot === null ||
    snapshot.room.kind !== "match" ||
    snapshot.room.id !== ticket.result.room.id ||
    snapshot.room.matchId !== ticket.result.matchId
  ) {
    throw new FlareLobbyError("CONFLICT");
  }

  return {
    roomId: ticket.result.room.id,
    participantId,
    role: "player",
    joinToken: joinToken.value,
    websocketUrl: createRoomWebSocketUrl(request, ticket.result.room.id),
    snapshot
  };
}

async function initializeMatchPool(
  env: FlareLobbyBindings,
  configuration: MatchmakingPoolConfiguration
): Promise<MatchmakingPool> {
  const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
    createMatchmakingPoolKey(configuration)
  ) as unknown as MatchPoolGatewayStub;
  return stub.initialize({
    pool: configuration,
    ...(configuration.searchPolicy === undefined
      ? {}
      : { searchPolicy: configuration.searchPolicy }),
    ...(configuration.matchRoom === undefined
      ? {}
      : { matchRoom: configuration.matchRoom })
  });
}

function findPoolConfiguration(
  pools: readonly MatchmakingPoolConfiguration[],
  poolId: string
): MatchmakingPoolConfiguration | null {
  return pools.find((pool) => pool.id === poolId) ?? null;
}

type MatchmakingRouteAction =
  | "create"
  | "rating"
  | "result"
  | "get"
  | "cancel"
  | "events"
  | "eventsWebSocket"
  | "connection";

interface MatchmakingRoute {
  readonly poolId: string;
  readonly ticketId?: string;
  readonly matchId?: string;
  readonly action: MatchmakingRouteAction;
}

function parseMatchmakingRoute(pathname: string): MatchmakingRoute | null {
  const segments = decodePathSegments(pathname);
  if (
    segments === null ||
    segments[0] !== "v1" ||
    segments[1] !== "matchmaking" ||
    segments[2] !== "pools" ||
    segments[3] === undefined
  ) {
    return null;
  }

  if (segments.length === 5 && segments[4] === "tickets") {
    return { poolId: segments[3], action: "create" };
  }

  if (segments.length === 5 && segments[4] === "rating") {
    return { poolId: segments[3], action: "rating" };
  }

  if (
    segments.length === 7 &&
    segments[4] === "matches" &&
    segments[5] !== undefined &&
    (segments[6] === "result" || segments[6] === "results")
  ) {
    return {
      poolId: segments[3],
      matchId: segments[5],
      action: "result"
    };
  }

  if (
    segments.length < 6 ||
    segments[4] !== "tickets" ||
    segments[5] === undefined
  ) {
    return null;
  }

  if (segments.length === 6) {
    return {
      poolId: segments[3],
      ticketId: segments[5],
      action: "get"
    };
  }

  const action = segments[6];
  if (action === "cancel" && segments.length === 7) {
    return {
      poolId: segments[3],
      ticketId: segments[5],
      action
    };
  }
  if (action === "connection" && segments.length === 7) {
    return {
      poolId: segments[3],
      ticketId: segments[5],
      action
    };
  }
  if (action === "events" && segments.length === 7) {
    return {
      poolId: segments[3],
      ticketId: segments[5],
      action
    };
  }
  if (action === "events" && segments.length === 8 && segments[7] === "ws") {
    return {
      poolId: segments[3],
      ticketId: segments[5],
      action: "eventsWebSocket"
    };
  }

  return null;
}

function readRequestId(request: Request, body: JsonObject): string | null {
  const bodyValue = body["requestId"];
  const headerValue = request.headers.get("Idempotency-Key");
  if (bodyValue !== undefined && !isNonEmptyString(bodyValue)) {
    return null;
  }
  if (headerValue !== null && !isNonEmptyString(headerValue)) {
    return null;
  }
  if (
    bodyValue !== undefined &&
    headerValue !== null &&
    bodyValue !== headerValue
  ) {
    throw new FlareLobbyError("CONFLICT");
  }
  return isNonEmptyString(bodyValue)
    ? bodyValue
    : isNonEmptyString(headerValue)
      ? headerValue
      : null;
}

function readRating(
  value: unknown
): number | { readonly value: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isFiniteNumber(value)) {
    return value;
  }
  if (isRecord(value) && isFiniteNumber(value["value"])) {
    return { value: value["value"] };
  }
  throw new FlareLobbyError("INVALID_PAYLOAD");
}

interface MatchResultPayload {
  readonly resultId: string;
  readonly matchId: string;
  readonly result: MatchResultRegistrationInput["result"];
}

function readMatchResultInput(
  body: JsonObject,
  matchId: string
): MatchResultPayload {
  const resultId = body["resultId"];
  const result = body["result"];

  if (!isNonEmptyString(resultId) || !isRatingResult(result)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  return { resultId, matchId, result };
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isFiniteNumber(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function readOptionalExpiry(value: unknown): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isFiniteNumber(value) || isNonEmptyString(value)) {
    return value;
  }
  throw new FlareLobbyError("INVALID_PAYLOAD");
}

function readOptionalJsonObject(value: unknown): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function ownsTicket(
  ticket: MatchmakingTicketRecord,
  principal: Principal
): boolean {
  return ticket.player.id === principal.playerId;
}

function samePoolValue(value: unknown, pool: MatchmakingPool): boolean {
  return (
    isRecord(value) &&
    value["id"] === pool.id &&
    value["gameId"] === pool.gameId &&
    value["seasonId"] === pool.seasonId &&
    value["mode"] === pool.mode &&
    value["region"] === pool.region
  );
}

function createRoomWebSocketUrl(request: Request, roomId: string): string {
  const url = new URL(
    `/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`,
    request.url
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function createMatchmakingPoolKey(pool: MatchmakingPool): string {
  const fields = [pool.gameId, pool.seasonId, pool.mode, pool.region];
  if (!fields.every(isNonEmptyString)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return fields.map((field) => encodeURIComponent(field)).join(":");
}

function decodePathSegments(pathname: string): string[] | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  try {
    return segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function normalizeGatewayError(error: unknown): FlareLobbyError {
  return error instanceof FlareLobbyError
    ? error
    : new FlareLobbyError("CONNECTION_FAILED");
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    isRecord(value) &&
    Object.values(value).every((nested) => isJsonValue(nested))
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isRecord(value) && Object.values(value).every((nested) => isJsonValue(nested));
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

function isRatingResult(value: unknown): value is MatchResultRegistrationInput["result"] {
  return value === 0 || value === 0.5 || value === 1;
}
