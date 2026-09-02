import { FlareLobbyError } from "@flarelobby/core";
import type { AnyFlareLobbyApp } from "@flarelobby/core";

import type { FlareLobbyBindings, FlareLobbyConfiguration } from "./config.js";
import {
  authenticateGatewayRequest,
  createErrorResponse,
  readWebSocketJoinToken,
} from "./security.js";
import type {
  AuthenticatedGatewayRequest,
  GatewayPrincipalEnvelope,
} from "./security.js";
import type {
  PartyCreationOptions,
  PartyEvent,
  PartyInvite,
  PartyInviteAcceptanceOptions,
  PartyInviteOptions,
  PartyLeadershipTransferOptions,
  PartyOperationOptions,
  PartySnapshot,
} from "./party.js";

/** パーティーイベント WebSocket 接続の URL が Gateway で判定できる情報です。 */
export interface PartyEventsWebSocketRoute {
  readonly partyId: string;
}

/** Gateway が Party Durable Object へ転送するためのスタブ契約です。 */
export interface PartyGatewayStub {
  createParty(options: PartyCreationOptions): Promise<PartySnapshot>;
  inviteMember(options: PartyInviteOptions): Promise<PartyInvite>;
  acceptInvite(options: PartyInviteAcceptanceOptions): Promise<PartySnapshot>;
  leaveParty(options: PartyOperationOptions): Promise<PartySnapshot | null>;
  transferLeadership(
    options: PartyLeadershipTransferOptions,
  ): Promise<PartySnapshot>;
  dissolveParty(options: PartyOperationOptions): Promise<PartySnapshot>;
  getSnapshot(options: {
    gatewayPrincipal: GatewayPrincipalEnvelope;
  }): Promise<PartySnapshot | null>;
  getEvents(options: {
    gatewayPrincipal: GatewayPrincipalEnvelope;
    afterSequence?: number;
  }): Promise<readonly PartyEvent[]>;
  fetch(request: Request): Promise<Response>;
}

/** パーティーイベント WebSocket の URL を判定します。 */
export function getPartyWebSocketRoute(
  pathname: string,
): PartyEventsWebSocketRoute | null {
  const match = /^\/v1\/parties\/([^/]+)\/events\/ws$/u.exec(pathname);
  const partyId = match?.[1];
  if (partyId === undefined || partyId.length === 0) {
    return null;
  }
  try {
    return { partyId: decodeURIComponent(partyId) };
  } catch {
    return null;
  }
}

/** WebSocket subprotocol のアクセストークンを Gateway Token へ変換して転送します。 */
export async function upgradePartyEventsWebSocket<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  route: PartyEventsWebSocketRoute,
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
    env.FLARE_LOBBY_TOKEN_SECRET,
  );

  if (!authenticatedRequest.ok) {
    return createErrorResponse(authenticatedRequest.error);
  }

  const partyStub = env.FLARE_LOBBY_PARTIES.getByName(
    route.partyId,
  ) as unknown as PartyGatewayStub;
  try {
    headers.set(
      "Authorization",
      `Bearer ${authenticatedRequest.value.gatewayPrincipal.token}`,
    );
    return await partyStub.fetch(new Request(request, { headers }));
  } catch (error) {
    return createErrorResponse(normalizeGatewayError(error));
  }
}

/** `createGatewayWorker()` からパーティーの HTTP API を処理します。 */
export async function handlePartyRequest<TEnv extends FlareLobbyBindings>(
  request: Request,
  env: TEnv,
  configuration: Pick<FlareLobbyConfiguration<AnyFlareLobbyApp>, "inputLimits">,
  authenticatedRequest: AuthenticatedGatewayRequest,
): Promise<Response | null> {
  const parsedRoute = parsePartyRoute(new URL(request.url).pathname);
  if (parsedRoute === null) {
    return null;
  }

  try {
    // 作成時は Gateway の入口で新しい Party ID を発行します。
    // 既存パーティーへの操作は URL 中の partyId をそのまま使います。
    const partyStub = env.FLARE_LOBBY_PARTIES.getByName(
      parsedRoute.action === "create"
        ? `party_${crypto.randomUUID()}`
        : (parsedRoute.partyId ?? ""),
    ) as unknown as PartyGatewayStub;
    const gatewayPrincipal = authenticatedRequest.gatewayPrincipal;
    const body =
      request.method === "POST"
        ? await parsePartyJsonBody(
            request,
            configuration.inputLimits.maxHttpRequestBytes,
          )
        : {};

    switch (parsedRoute.action) {
      case "create": {
        if (request.method !== "POST") {
          return notFound();
        }
        const party = await partyStub.createParty({
          gatewayPrincipal,
          requestId: readRequiredString(body, "requestId"),
          ...(readOptionalPositiveInteger(body, "maxPartySize") === undefined
            ? {}
            : {
                maxPartySize: readOptionalPositiveInteger(
                  body,
                  "maxPartySize",
                )!,
              }),
        });
        return Response.json({ party }, { status: 201 });
      }
      case "get":
        if (request.method !== "GET") {
          return notFound();
        }
        return Response.json({
          party: await partyStub.getSnapshot({ gatewayPrincipal }),
        });
      case "invite": {
        if (request.method !== "POST") {
          return notFound();
        }
        const invite = await partyStub.inviteMember({
          gatewayPrincipal,
          requestId: readRequiredString(body, "requestId"),
          playerId: readRequiredString(body, "playerId"),
          ...(readOptionalPositiveInteger(body, "ttlMs") === undefined
            ? {}
            : { ttlMs: readOptionalPositiveInteger(body, "ttlMs")! }),
        });
        return Response.json({ invite });
      }
      case "accept": {
        if (request.method !== "POST") {
          return notFound();
        }
        const party = await partyStub.acceptInvite({
          gatewayPrincipal,
          requestId: readRequiredString(body, "requestId"),
          token: readRequiredString(body, "token"),
        });
        return Response.json({ party });
      }
      case "leave":
        if (request.method !== "POST") {
          return notFound();
        }
        return Response.json({
          dissolved:
            (await partyStub.leaveParty({
              gatewayPrincipal,
              ...(typeof body["requestId"] === "string"
                ? { requestId: body["requestId"] }
                : {}),
            })) === null,
        });
      case "transferLeadership": {
        if (request.method !== "POST") {
          return notFound();
        }
        const party = await partyStub.transferLeadership({
          gatewayPrincipal,
          playerId: readRequiredString(body, "playerId"),
          ...(typeof body["requestId"] === "string"
            ? { requestId: body["requestId"] }
            : {}),
        });
        return Response.json({ party });
      }
      case "dissolve":
        if (request.method !== "POST") {
          return notFound();
        }
        return Response.json({
          party: await partyStub.dissolveParty({
            gatewayPrincipal,
            ...(typeof body["requestId"] === "string"
              ? { requestId: body["requestId"] }
              : {}),
          }),
        });
      case "events": {
        if (request.method !== "GET") {
          return notFound();
        }
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${gatewayPrincipal.token}`);
        return await partyStub.fetch(new Request(request, { headers }));
      }
    }
  } catch (error) {
    return createErrorResponse(normalizeGatewayError(error));
  }
}

type PartyRouteAction =
  | "create"
  | "get"
  | "invite"
  | "accept"
  | "leave"
  | "transferLeadership"
  | "dissolve"
  | "events";

interface PartyRoute {
  readonly action: PartyRouteAction;
  readonly partyId?: string;
}

function parsePartyRoute(pathname: string): PartyRoute | null {
  // POST /v1/parties
  if (pathname === "/v1/parties") {
    return { action: "create" };
  }

  const match = /^\/v1\/parties\/([^/]+)(?:\/([^/]+))?$/u.exec(pathname);
  const partyId = match?.[1];
  const operation = match?.[2];
  if (partyId === undefined || partyId.length === 0) {
    return null;
  }

  let decodedPartyId: string;
  try {
    decodedPartyId = decodeURIComponent(partyId);
  } catch {
    return null;
  }

  if (operation === undefined) {
    return { action: "get", partyId: decodedPartyId };
  }

  switch (operation) {
    case "invites":
      return { action: "invite", partyId: decodedPartyId };
    case "members":
      return { action: "accept", partyId: decodedPartyId };
    case "leave":
      return { action: "leave", partyId: decodedPartyId };
    case "transfer-leadership":
      return { action: "transferLeadership", partyId: decodedPartyId };
    case "dissolve":
      return { action: "dissolve", partyId: decodedPartyId };
    case "events":
      return { action: "events", partyId: decodedPartyId };
    default:
      return null;
  }
}

async function parsePartyJsonBody(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new FlareLobbyError("INVALID_MESSAGE");
  }
  if (bytes.byteLength === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new FlareLobbyError("INVALID_PAYLOAD");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }
    throw new FlareLobbyError("INVALID_MESSAGE");
  }
}

function readRequiredString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function readOptionalPositiveInteger(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }
  return value;
}

function normalizeGatewayError(error: unknown): FlareLobbyError {
  return error instanceof FlareLobbyError
    ? error
    : new FlareLobbyError("CONNECTION_FAILED");
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}
