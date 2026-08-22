import {
  authenticateGatewayRequest,
  createErrorResponse,
  createMatchmakingPoolKey,
  readValidatedJsonBody,
  registerMatchResult,
} from "@flarelobby/cloudflare";
import type {
  AuthenticatedGatewayRequest,
  FlareLobbyBindings,
  FlareLobbyConfiguration,
  MatchmakingMatchIntent,
  MatchmakingTicketRecord,
  MatchmakingPoolConfiguration,
} from "@flarelobby/cloudflare";
import { FlareLobbyError } from "@flarelobby/core";
import type {
  AnyFlareLobbyApp,
  JsonObject,
  MatchmakingPool,
  RatingResult,
} from "@flarelobby/core";
import {
  createRpsResultId,
  getRpsOutcome,
  isRatingResult,
  isRpsMove,
  resolveRpsResult,
} from "./rps-game.js";
import type { RpsMove, RpsOutcome } from "./rps-game.js";

export {
  createRpsResultId,
  getRpsOutcome,
  isRatingResult,
  isRpsMove,
  resolveRpsResult,
  RPS_MOVES,
} from "./rps-game.js";
export type { RpsMove, RpsOutcome } from "./rps-game.js";

/** サンプルで利用するじゃんけんの手です。 */
export const DEMO_RANKED_POOL_ID = "ranked-jp";

interface MatchPoolGatewayStub {
  getMatchIntent(
    matchIdOrCandidateId:
      | string
      | { readonly matchId?: string; readonly candidateId?: string },
  ): Promise<MatchmakingMatchIntent | null>;
  getTicket(ticketId: string): Promise<MatchmakingTicketRecord | null>;
}

interface MatchedPlayers {
  readonly pool: MatchmakingPool;
  readonly poolConfiguration: MatchmakingPoolConfiguration;
  readonly matchId: string;
  readonly playerAId: string;
  readonly playerBId: string;
  readonly actorSlot: "A" | "B";
}

interface RpsMatchRow {
  readonly matchId: string;
  readonly playerAId: string;
  readonly playerBId: string;
  readonly moveA: RpsMove | null;
  readonly moveB: RpsMove | null;
  readonly result: RatingResult | null;
  readonly resultId: string | null;
  readonly appliedAt: number | null;
}

interface RpsMatchResponse {
  readonly matchId: string;
  readonly ready: boolean;
  readonly yourMove: RpsMove | null;
  readonly opponentMove: RpsMove | null;
  readonly result: {
    readonly value: RatingResult;
    readonly outcome: RpsOutcome;
    readonly resultId: string;
    readonly applied: boolean | null;
  } | null;
  readonly rating?: { readonly value: number };
}

/** ローカルサンプルのランク戦 API を処理します。 */
export async function handleDemoRpsRequest<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
): Promise<Response | null> {
  const route = parseRpsRoute(new URL(request.url).pathname);
  if (route === null) {
    return null;
  }

  try {
    const matched = await readMatchedPlayers(
      env,
      configuration,
      route.matchId,
      authenticatedRequest,
    );

    if (route.action === "state") {
      if (request.method !== "GET") {
        return new Response("Not Found", { status: 404 });
      }

      const row = await readRpsMatch(env.FLARE_LOBBY_DB, matched.matchId);
      return Response.json(
        toRpsResponse(row, matched.actorSlot, null, matched.matchId),
      );
    }

    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    return await acceptRpsMove(
      request,
      env,
      configuration,
      authenticatedRequest,
      matched,
    );
  } catch (error) {
    return createErrorResponse(
      error instanceof FlareLobbyError
        ? error
        : new FlareLobbyError("CONNECTION_FAILED"),
    );
  }
}

/** Worker入口でBearerトークンを検証する補助関数です。 */
export async function authenticateDemoRpsRequest<
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
>(
  request: Request,
  configuration: FlareLobbyConfiguration<TApp>,
  tokenSecret: string,
): Promise<Response | AuthenticatedGatewayRequest> {
  const authenticated = await authenticateGatewayRequest(
    request,
    configuration.authenticate,
    tokenSecret,
  );

  return authenticated.ok
    ? authenticated.value
    : createErrorResponse(authenticated.error);
}

function parseRpsRoute(
  pathname: string,
): { readonly action: "state" | "move"; readonly matchId: string } | null {
  const match = /^\/v1\/demo\/rps\/matches\/([^/]+)(?:\/(move))?$/u.exec(
    pathname,
  );

  if (match?.[1] === undefined) {
    return null;
  }

  let matchId: string;
  try {
    matchId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (matchId.length === 0 || matchId.length > 2_048) {
    return null;
  }

  return {
    matchId,
    action: match[2] === "move" ? "move" : "state",
  };
}

async function readMatchedPlayers<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp,
>(
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  matchId: string,
  authenticatedRequest: AuthenticatedGatewayRequest,
): Promise<MatchedPlayers> {
  const poolConfiguration = configuration.matchmakingPools.find(
    (candidate) => candidate.id === DEMO_RANKED_POOL_ID,
  );

  if (poolConfiguration === undefined) {
    throw new FlareLobbyError("CONFLICT");
  }

  const pool = toPool(poolConfiguration);
  const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
    createMatchmakingPoolKey(pool),
  ) as unknown as MatchPoolGatewayStub;
  const intent = await poolStub.getMatchIntent({ matchId });

  if (intent?.status !== "matched" || intent.result === null) {
    throw new FlareLobbyError("CONFLICT");
  }

  const [playerATicketId, playerBTicketId] = intent.result.candidate.ticketIds;
  const playerATicket = await poolStub.getTicket(playerATicketId);
  const playerBTicket = await poolStub.getTicket(playerBTicketId);

  if (
    playerATicket?.status !== "matched" ||
    playerBTicket?.status !== "matched" ||
    playerATicket.result.matchId !== matchId ||
    playerBTicket.result.matchId !== matchId
  ) {
    throw new FlareLobbyError("CONFLICT");
  }

  const actorPlayerId = authenticatedRequest.principal.playerId;
  const actorSlot =
    actorPlayerId === playerATicket.player.id
      ? "A"
      : actorPlayerId === playerBTicket.player.id
        ? "B"
        : null;

  if (actorSlot === null) {
    throw new FlareLobbyError("FORBIDDEN");
  }

  return {
    pool,
    poolConfiguration,
    matchId,
    playerAId: playerATicket.player.id,
    playerBId: playerBTicket.player.id,
    actorSlot,
  };
}

async function acceptRpsMove<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  authenticatedRequest: AuthenticatedGatewayRequest,
  matched: MatchedPlayers,
): Promise<Response> {
  const body = await readValidatedJsonBody(
    request,
    configuration.inputLimits.maxHttpRequestBytes,
    isJsonObject,
  );

  if (!body.ok) {
    return createErrorResponse(body.error);
  }

  const move = body.value["move"];
  if (!isRpsMove(move)) {
    return createErrorResponse(new FlareLobbyError("INVALID_PAYLOAD"));
  }

  await ensureRpsMatch(
    env.FLARE_LOBBY_DB,
    matched.matchId,
    matched.playerAId,
    matched.playerBId,
  );

  const rowBefore = await readRpsMatch(env.FLARE_LOBBY_DB, matched.matchId);
  const existingMove =
    matched.actorSlot === "A" ? rowBefore?.moveA : rowBefore?.moveB;

  if (
    existingMove !== null &&
    existingMove !== undefined &&
    existingMove !== move
  ) {
    throw new FlareLobbyError("CONFLICT", {
      message: "この試合では手を変更できません。",
    });
  }

  const moveColumn = matched.actorSlot === "A" ? "move_a" : "move_b";
  await env.FLARE_LOBBY_DB.prepare(
    `UPDATE flarelobby_demo_rps_matches
       SET ${moveColumn} = COALESCE(${moveColumn}, ?)
       WHERE match_id = ?`,
  )
    .bind(move, matched.matchId)
    .run();

  let row = await readRpsMatch(env.FLARE_LOBBY_DB, matched.matchId);
  if (row === null) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  let registrationApplied: boolean | null = null;
  if (row.moveA !== null && row.moveB !== null) {
    const result = resolveRpsResult(row.moveA, row.moveB);
    const registration = await registerMatchResult(
      env.FLARE_LOBBY_DB,
      matched.pool,
      {
        resultId: createRpsResultId(matched.matchId),
        matchId: matched.matchId,
        playerAId: matched.playerAId,
        playerBId: matched.playerBId,
        result,
      },
      matched.poolConfiguration.rating ?? {},
    );
    registrationApplied = registration.applied;

    await env.FLARE_LOBBY_DB.prepare(
      `UPDATE flarelobby_demo_rps_matches
         SET result = COALESCE(result, ?),
             result_id = COALESCE(result_id, ?),
             applied_at = COALESCE(applied_at, ?)
         WHERE match_id = ?`,
    )
      .bind(
        result,
        createRpsResultId(matched.matchId),
        Date.now(),
        matched.matchId,
      )
      .run();

    row = await readRpsMatch(env.FLARE_LOBBY_DB, matched.matchId);
    if (row === null) {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }

    const response = toRpsResponse(row, matched.actorSlot, registrationApplied);
    const playerRating = registration.match.participants.find(
      (participant) =>
        participant.playerId === authenticatedRequest.principal.playerId,
    )?.ratingAfter;

    return Response.json(
      playerRating === undefined
        ? response
        : { ...response, rating: { value: playerRating } },
    );
  }

  return Response.json(
    toRpsResponse(row, matched.actorSlot, registrationApplied),
  );
}

async function ensureRpsMatch(
  database: D1Database,
  matchId: string,
  playerAId: string,
  playerBId: string,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO flarelobby_demo_rps_matches (
         match_id, player_a_id, player_b_id, move_a, move_b,
         result, result_id, applied_at
       ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL)
       ON CONFLICT(match_id) DO NOTHING`,
    )
    .bind(matchId, playerAId, playerBId)
    .run();
}

async function readRpsMatch(
  database: D1Database,
  matchId: string,
): Promise<RpsMatchRow | null> {
  const row = await database
    .prepare(
      `SELECT
         match_id AS matchId,
         player_a_id AS playerAId,
         player_b_id AS playerBId,
         move_a AS moveA,
         move_b AS moveB,
         result,
         result_id AS resultId,
         applied_at AS appliedAt
       FROM flarelobby_demo_rps_matches
       WHERE match_id = ?`,
    )
    .bind(matchId)
    .first<{
      matchId: string;
      playerAId: string;
      playerBId: string;
      moveA: string | null;
      moveB: string | null;
      result: number | null;
      resultId: string | null;
      appliedAt: number | null;
    }>();

  if (row === null) {
    return null;
  }

  if (
    (row.moveA !== null && !isRpsMove(row.moveA)) ||
    (row.moveB !== null && !isRpsMove(row.moveB)) ||
    (row.result !== null && !isRatingResult(row.result))
  ) {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }

  return {
    matchId: row.matchId,
    playerAId: row.playerAId,
    playerBId: row.playerBId,
    moveA: row.moveA as RpsMove | null,
    moveB: row.moveB as RpsMove | null,
    result: row.result as RatingResult | null,
    resultId: row.resultId,
    appliedAt: row.appliedAt,
  };
}

function toRpsResponse(
  row: RpsMatchRow | null,
  actorSlot: "A" | "B",
  applied: boolean | null,
  fallbackMatchId = "",
): RpsMatchResponse {
  if (row === null) {
    return {
      matchId: fallbackMatchId,
      ready: false,
      yourMove: null,
      opponentMove: null,
      result: null,
    };
  }

  const yourMove = actorSlot === "A" ? row.moveA : row.moveB;
  const opponentMove = actorSlot === "A" ? row.moveB : row.moveA;
  const result =
    row.result === null || row.resultId === null
      ? null
      : {
          value: row.result,
          outcome: getRpsOutcome(row.result, actorSlot),
          resultId: row.resultId,
          applied,
        };

  return {
    matchId: row.matchId,
    ready: row.moveA !== null && row.moveB !== null,
    yourMove,
    opponentMove: result === null ? null : opponentMove,
    result,
  };
}

function toPool(configuration: MatchmakingPoolConfiguration): MatchmakingPool {
  return {
    id: configuration.id,
    gameId: configuration.gameId,
    seasonId: configuration.seasonId,
    mode: configuration.mode,
    region: configuration.region,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
