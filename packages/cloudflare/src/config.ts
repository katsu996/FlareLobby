import type {
  AnyFlareLobbyApp,
  AppRoomSettings,
  EloOptions,
  FlareLobbyApp,
  MatchmakingPool,
  MatchmakingSearchPolicy
} from "@flarelobby/core";
import {
  FlareLobbyError,
  elo,
  normalizeMatchmakingSearchPolicy
} from "@flarelobby/core";
import type { ProtocolResult } from "@flarelobby/core";

import type {
  MatchPoolDurableObject,
  RateLimitDurableObject,
  RoomDurableObject
} from "./durable-objects.js";
import type { MatchmakingMatchRoomOptions } from "./match-pool.js";
import type { RatingConfiguration } from "./rating.js";
import {
  attachObservabilityHeaders,
  createObservabilityContext,
  createObservabilitySink,
  getObservabilityOperationName,
  FLARE_LOBBY_OPERATION_HEADER,
  observeHttpOperation
} from "./observability.js";
import type { FlareLobbyObservabilityConfiguration } from "./observability.js";
import {
  createCustomRoom,
  joinCustomRoom,
  leaveCustomRoom
} from "./custom-room.js";
import { listCustomRooms } from "./custom-room-list.js";
import {
  getMatchmakingTicketWebSocketRoute,
  handleMatchmakingRequest,
  upgradeMatchmakingTicketWebSocket
} from "./matchmaking.js";
import {
  DEFAULT_DISCONNECT_GRACE_PERIOD_MS,
  DEFAULT_EVENT_HISTORY_LIMIT,
  DEFAULT_FINISHED_ROOM_RETENTION_MS,
  DEFAULT_PROCESSED_COMMAND_RETENTION_MS,
  DEFAULT_RESUME_TOKEN_TTL_MS
} from "./room-constants.js";
import {
  authenticateGatewayRequest,
  createErrorResponse,
  readWebSocketJoinToken,
  verifyWebSocketRoomToken
} from "./security.js";
import type {
  AuthenticatedGatewayRequest,
  FlareLobbyAuthenticationHook,
  FlareLobbyAuthorizationHooks,
  FlareLobbyRateLimitScope
} from "./security.js";

/** Wrangler 設定と Worker 実装で共通に使う Binding 名です。 */
export const FLARE_LOBBY_BINDINGS = {
  room: "FLARE_LOBBY_ROOMS",
  matchPool: "FLARE_LOBBY_MATCH_POOLS",
  rateLimit: "FLARE_LOBBY_RATE_LIMITS",
  database: "FLARE_LOBBY_DB",
  analytics: "FLARE_LOBBY_ANALYTICS",
  tokenSecret: "FLARE_LOBBY_TOKEN_SECRET"
} as const;

/**
 * `wrangler types` が生成する `Env` に必要な Binding 契約です。
 *
 * Analytics Engine は任意です。実際の `Env` は手書きせず、Wrangler が
 * `worker-configuration.d.ts` へ生成した型を `createGatewayWorker<Env>()` に
 * 渡してください。
 */
export interface FlareLobbyBindings {
  readonly FLARE_LOBBY_ROOMS: DurableObjectNamespace<RoomDurableObject>;
  readonly FLARE_LOBBY_MATCH_POOLS: DurableObjectNamespace<MatchPoolDurableObject>;
  readonly FLARE_LOBBY_RATE_LIMITS: DurableObjectNamespace<RateLimitDurableObject>;
  readonly FLARE_LOBBY_DB: D1Database;
  readonly FLARE_LOBBY_ANALYTICS?: AnalyticsEngineDataset;
  /** Wrangler Secret から注入する、トークン署名専用の秘密値です。 */
  readonly FLARE_LOBBY_TOKEN_SECRET: string;
}

/** カスタムルームで利用する既定設定と収容人数です。 */
export interface CustomRoomConfiguration<
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
> {
  readonly maxPlayers: number;
  /** 省略時は作成要求の既定値を 0（観戦不可）として扱います。 */
  readonly maxSpectators?: number;
  readonly defaultSettings: AppRoomSettings<TApp>;
  /** 終了済み Room を削除するまでの保持期間（ミリ秒）です。 */
  readonly finishedRoomRetentionMs?: number;
  /** 再開トークンの有効期間（ミリ秒）です。 */
  readonly resumeTokenTtlMs?: number;
  /** 通信切断後に参加状態を保持する猶予期間（ミリ秒）です。 */
  readonly disconnectGracePeriodMs?: number;
  /** Room に保持する状態変更イベントの最大件数です。 */
  readonly eventHistoryLimit?: number;
  /** 処理済みコマンド結果の保持期間（ミリ秒）です。 */
  readonly processedCommandRetentionMs?: number;
}

/** 1 対 1 マッチングに使うプール設定です。 */
export interface MatchmakingPoolConfiguration extends MatchmakingPool {
  /** 候補探索の検索幅と 1 回あたりの処理量です。 */
  readonly searchPolicy?: MatchmakingSearchPolicy;
  /** 成立時に生成する対戦ルームの初期設定です。 */
  readonly matchRoom?: MatchmakingMatchRoomOptions;
  /** この Pool/Season で利用する ELO の初期値と K 係数です。 */
  readonly rating?: RatingConfiguration;
}

/** Gateway Worker が受け付ける入力の上限です。 */
export interface FlareLobbyInputLimits {
  readonly maxHttpRequestBytes: number;
  readonly maxWebSocketMessageBytes: number;
  readonly maxMessagesPerMinute: number;
  readonly maxRoomCreationsPerMinute: number;
}

/** `defineFlareLobby()` に渡す単一の型付き設定です。 */
export interface FlareLobbyConfiguration<
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
> {
  readonly customRooms: CustomRoomConfiguration<TApp>;
  readonly matchmakingPools: readonly MatchmakingPoolConfiguration[];
  readonly authenticate: FlareLobbyAuthenticationHook;
  /** 未設定時はすべての保護対象操作を拒否します。 */
  readonly authorization?: FlareLobbyAuthorizationHooks;
  readonly inputLimits: FlareLobbyInputLimits;
  /** ログと Analytics Engine のサンプリング設定です。 */
  readonly observability?: FlareLobbyObservabilityConfiguration;
}

/** 設定または必須 Binding の不備を判定する安定したコードです。 */
export const FLARE_LOBBY_CONFIGURATION_ERROR_CODES = [
  "D1_BINDING_MISSING",
  "ROOM_DURABLE_OBJECT_BINDING_MISSING",
  "MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING",
  "INVALID_CUSTOM_ROOM_CONFIGURATION",
  "INVALID_MATCHMAKING_POOL",
  "INVALID_INPUT_LIMITS",
  "INVALID_AUTHENTICATION_HOOK",
  "INVALID_OBSERVABILITY_CONFIGURATION"
] as const;

/** 設定または必須 Binding の不備を判定する安定したコードです。 */
export type FlareLobbyConfigurationErrorCode =
  (typeof FLARE_LOBBY_CONFIGURATION_ERROR_CODES)[number];

const defaultConfigurationErrorMessages: Readonly<
  Record<FlareLobbyConfigurationErrorCode, string>
> = {
  D1_BINDING_MISSING:
    "FlareLobby の D1 Binding（FLARE_LOBBY_DB）が設定されていません。",
  ROOM_DURABLE_OBJECT_BINDING_MISSING:
    "FlareLobby の Room Durable Object Binding（FLARE_LOBBY_ROOMS）が設定されていません。",
  MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING:
    "FlareLobby の Match Pool Durable Object Binding（FLARE_LOBBY_MATCH_POOLS）が設定されていません。",
  INVALID_CUSTOM_ROOM_CONFIGURATION:
    "カスタムルーム設定が正しくありません。",
  INVALID_MATCHMAKING_POOL: "マッチングプール設定が正しくありません。",
  INVALID_INPUT_LIMITS: "入力制限の設定が正しくありません。",
  INVALID_AUTHENTICATION_HOOK: "認証 Hook の設定が正しくありません。",
  INVALID_OBSERVABILITY_CONFIGURATION:
    "観測サンプリング設定が正しくありません。"
};

/** 利用者へ公開する設定エラーです。内部例外や Binding の実体は公開しません。 */
export class FlareLobbyConfigurationError extends Error {
  public readonly code: FlareLobbyConfigurationErrorCode;

  public constructor(
    code: FlareLobbyConfigurationErrorCode,
    message = defaultConfigurationErrorMessages[code]
  ) {
    super(message);
    this.name = "FlareLobbyConfigurationError";
    this.code = code;
  }

  /** HTTP 応答へ安全に含められる情報だけを返します。 */
  public toJSON(): Readonly<{
    code: FlareLobbyConfigurationErrorCode;
    message: string;
  }> {
    return {
      code: this.code,
      message: this.message
    };
  }
}

/** `defineFlareLobby()` で検証済みの設定から生成する Gateway Worker です。 */
export type FlareLobbyGatewayWorker<TEnv extends FlareLobbyBindings> =
  ExportedHandler<TEnv> & {
    readonly fetch: NonNullable<ExportedHandler<TEnv>["fetch"]>;
  };

/** 1 つの設定から Gateway Worker を生成する FlareLobby 定義です。 */
export interface DefinedFlareLobby<
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
> {
  readonly configuration: FlareLobbyConfiguration<TApp>;
  createGatewayWorker<TEnv extends FlareLobbyBindings>(): FlareLobbyGatewayWorker<TEnv>;
}

/**
 * 利用者の設定を検証し、共有する可変状態を持たない Gateway Worker 定義を作ります。
 *
 * `createGatewayWorker<Env>()` の `Env` には、Wrangler が生成したグローバルの
 * `Env` 型を指定してください。D1、3 種類の Durable Object Binding、トークン用の
 * Secret Binding がない型はこの時点で拒否されます。
 */
export function defineFlareLobby<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
>(configuration: FlareLobbyConfiguration<TApp>): DefinedFlareLobby<TApp> {
  const normalizedConfiguration = normalizeConfiguration(configuration);

  return Object.freeze({
    configuration: normalizedConfiguration,
    createGatewayWorker<TEnv extends FlareLobbyBindings>(): FlareLobbyGatewayWorker<TEnv> {
      return createGatewayWorker<TEnv, TApp>(normalizedConfiguration);
    }
  });
}

/** 検証済みの設定から最小の Gateway Worker Handler を生成します。 */
export function createGatewayWorker<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp = AnyFlareLobbyApp,
>(
  configuration: FlareLobbyConfiguration<TApp>
): FlareLobbyGatewayWorker<TEnv> {
  const normalizedConfiguration = normalizeConfiguration(configuration);

  return {
    async fetch(request, env): Promise<Response> {
      const context = createObservabilityContext(request, {
        // 相関 ID はクライアント申告値を信頼せず、Gateway の入口で発行します。
        correlationId: crypto.randomUUID(),
        logSampleRate: normalizedConfiguration.observability?.logSampleRate ?? 1,
        analyticsSampleRate:
          normalizedConfiguration.observability?.analyticsSampleRate ?? 1
      });
      const observedRequest = attachObservabilityHeaders(request, context);
      const sink = createObservabilitySink(
        env.FLARE_LOBBY_ANALYTICS,
        normalizedConfiguration.observability
      );

      return observeHttpOperation(
        sink,
        context,
        getObservabilityOperationName(observedRequest),
        async () => {
          try {
            assertRequiredBindings(env);
          } catch (error) {
            if (error instanceof FlareLobbyConfigurationError) {
              return Response.json(error.toJSON(), { status: 500 });
            }

            throw error;
          }

          request = observedRequest as typeof request;

          const pathname = new URL(request.url).pathname;

      if (request.method === "GET" && pathname === "/") {
        return Response.json({ status: "ready" });
      }

      if (
        request.method === "GET" &&
        pathname === "/v1/custom-rooms"
      ) {
        const result = await listCustomRooms(
          request,
          env,
          normalizedConfiguration
        );

        return result.ok
          ? Response.json(result.value)
          : createErrorResponse(result.error);
      }

      const websocketRoomId = getCustomRoomWebSocketRoute(pathname);

      const matchmakingWebSocketRoute =
        getMatchmakingTicketWebSocketRoute(pathname);

      if (matchmakingWebSocketRoute !== null) {
        return upgradeMatchmakingTicketWebSocket(
          request,
          env,
          normalizedConfiguration,
          matchmakingWebSocketRoute
        );
      }

      if (
        request.method === "GET" &&
        websocketRoomId !== null
      ) {
        return upgradeCustomRoomWebSocket(
          request,
          env,
          normalizedConfiguration,
          websocketRoomId
        );
      }

      const authenticatedRequest = await authenticateGatewayRequest(
        request,
        normalizedConfiguration.authenticate,
        env.FLARE_LOBBY_TOKEN_SECRET
      );

      if (!authenticatedRequest.ok) {
        return createErrorResponse(authenticatedRequest.error);
      }

      const matchmakingResponse = await handleMatchmakingRequest(
        request,
        env,
        normalizedConfiguration,
        authenticatedRequest.value
      );

      if (matchmakingResponse !== null) {
        return matchmakingResponse;
      }

      if (
        request.method === "POST" &&
        pathname === "/v1/custom-rooms"
      ) {
        const result = await createCustomRoom(
          request,
          env,
          normalizedConfiguration,
          authenticatedRequest.value
        );

        return result.ok
          ? Response.json(result.value, { status: 201 })
          : createErrorResponse(result.error);
      }

      if (
        request.method === "POST" &&
        isCustomRoomOperationPath(pathname, "join")
      ) {
        const result = await joinCustomRoom(
          request,
          env,
          normalizedConfiguration,
          authenticatedRequest.value
        );

        return result.ok
          ? Response.json(result.value)
          : createErrorResponse(result.error);
      }

      if (
        request.method === "POST" &&
        isCustomRoomOperationPath(pathname, "leave")
      ) {
        const result = await leaveCustomRoom(
          request,
          env,
          normalizedConfiguration,
          authenticatedRequest.value
        );

        return result.ok
          ? Response.json(result.value)
          : createErrorResponse(result.error);
      }

          return new Response("Not Found", { status: 404 });
        }
      );
    }
  };
}

function isCustomRoomOperationPath(
  pathname: string,
  operation: "join" | "leave"
): boolean {
  return (
    pathname === `/v1/custom-rooms/${operation}` ||
    new RegExp(`^/v1/custom-rooms/[^/]+/${operation}$`, "u").test(pathname)
  );
}

function getCustomRoomWebSocketRoute(pathname: string): string | null {
  const match = /^\/v1\/custom-rooms\/([^/]+)\/ws$/u.exec(pathname);

  if (match?.[1] === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function upgradeCustomRoomWebSocket<
  TEnv extends FlareLobbyBindings,
  TApp extends AnyFlareLobbyApp,
>(
  request: Request,
  env: TEnv,
  configuration: FlareLobbyConfiguration<TApp>,
  roomId: string
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return createErrorResponse(new FlareLobbyError("INVALID_MESSAGE"));
  }

  const token = readWebSocketJoinToken(request);

  if (!token.ok) {
    return createErrorResponse(token.error);
  }

  const claims = await verifyWebSocketRoomToken(
    env.FLARE_LOBBY_TOKEN_SECRET,
    token.value,
    { roomId }
  );

  if (!claims.ok) {
    return createErrorResponse(claims.error);
  }

  if (claims.value.participantId === undefined) {
    return createErrorResponse(new FlareLobbyError("UNAUTHENTICATED"));
  }

  try {
    const headers = new Headers(request.headers);
    // Hibernation 後の Handler でも設定値を復元できるよう、接続 attachment
    // へ保存する小さい数値だけを Gateway から DO へ渡します。
    headers.set(
      "x-flarelobby-websocket-message-bytes",
      String(configuration.inputLimits.maxWebSocketMessageBytes)
    );
    headers.set(
      "x-flarelobby-websocket-message-limit",
      String(configuration.inputLimits.maxMessagesPerMinute)
    );
    headers.set(
      FLARE_LOBBY_OPERATION_HEADER,
      claims.value.purpose === "resume" ? "room.reconnect" : "room.connect"
    );

    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    return await room.fetch(new Request(request, { headers }));
  } catch {
    return createErrorResponse(new FlareLobbyError("CONNECTION_FAILED"));
  }
}

/**
 * 認証済み主体ごとの分散した利用制限を消費します。
 *
 * `principal.id` を Durable Object の分割キーにするため、全利用者を 1 個の
 * Durable Object へ集約しません。上限超過は既存の安定した `CONFLICT` として
 * 公開します。
 */
export async function consumeRateLimit(
  env: Pick<
    FlareLobbyBindings,
    "FLARE_LOBBY_RATE_LIMITS" | "FLARE_LOBBY_TOKEN_SECRET"
  >,
  request: AuthenticatedGatewayRequest,
  scope: FlareLobbyRateLimitScope,
  limit: number
): Promise<ProtocolResult<void>> {
  try {
    const rateLimit = env.FLARE_LOBBY_RATE_LIMITS.getByName(
      request.principal.id
    );
    const result = await rateLimit.consume(
      request.gatewayPrincipal,
      scope,
      limit
    );

    return result.allowed
      ? { ok: true, value: undefined }
      : {
          ok: false,
          error: new FlareLobbyError("CONFLICT", {
            message: "要求が許可された頻度を超えています。"
          })
        };
  } catch {
    return {
      ok: false,
      error: new FlareLobbyError("CONNECTION_FAILED")
    };
  }
}

/** WebSocket メッセージの主体別頻度を制限します。 */
export function consumeWebSocketMessageRateLimit(
  env: Pick<
    FlareLobbyBindings,
    "FLARE_LOBBY_RATE_LIMITS" | "FLARE_LOBBY_TOKEN_SECRET"
  >,
  request: AuthenticatedGatewayRequest,
  limits: FlareLobbyInputLimits
): Promise<ProtocolResult<void>> {
  return consumeRateLimit(
    env,
    request,
    "websocket_message",
    limits.maxMessagesPerMinute
  );
}

/** ルーム作成の主体別頻度を制限します。 */
export function consumeRoomCreationRateLimit(
  env: Pick<
    FlareLobbyBindings,
    "FLARE_LOBBY_RATE_LIMITS" | "FLARE_LOBBY_TOKEN_SECRET"
  >,
  request: AuthenticatedGatewayRequest,
  limits: FlareLobbyInputLimits
): Promise<ProtocolResult<void>> {
  return consumeRateLimit(
    env,
    request,
    "room_creation",
    limits.maxRoomCreationsPerMinute
  );
}

function normalizeConfiguration<TApp extends AnyFlareLobbyApp>(
  configuration: FlareLobbyConfiguration<TApp>
): FlareLobbyConfiguration<TApp> {
  assertCustomRoomConfiguration(configuration.customRooms);
  assertMatchmakingPools(configuration.matchmakingPools);
  assertInputLimits(configuration.inputLimits);
  assertObservabilityConfiguration(configuration.observability);

  if (typeof configuration.authenticate !== "function") {
    throw new FlareLobbyConfigurationError("INVALID_AUTHENTICATION_HOOK");
  }

  const normalizedConfiguration: FlareLobbyConfiguration<TApp> = {
    customRooms: Object.freeze({
      maxPlayers: configuration.customRooms.maxPlayers,
      ...(configuration.customRooms.maxSpectators === undefined
        ? {}
        : { maxSpectators: configuration.customRooms.maxSpectators }),
      defaultSettings: configuration.customRooms.defaultSettings,
      finishedRoomRetentionMs:
        configuration.customRooms.finishedRoomRetentionMs ??
        DEFAULT_FINISHED_ROOM_RETENTION_MS,
      resumeTokenTtlMs:
        configuration.customRooms.resumeTokenTtlMs ?? DEFAULT_RESUME_TOKEN_TTL_MS,
      disconnectGracePeriodMs:
        configuration.customRooms.disconnectGracePeriodMs ??
        DEFAULT_DISCONNECT_GRACE_PERIOD_MS,
      eventHistoryLimit:
        configuration.customRooms.eventHistoryLimit ?? DEFAULT_EVENT_HISTORY_LIMIT,
      processedCommandRetentionMs:
        configuration.customRooms.processedCommandRetentionMs ??
        DEFAULT_PROCESSED_COMMAND_RETENTION_MS
    }),
    matchmakingPools: Object.freeze(
      configuration.matchmakingPools.map((pool) =>
        Object.freeze({
          ...pool,
          ...(pool.searchPolicy === undefined
            ? {}
            : { searchPolicy: normalizeMatchmakingSearchPolicy(pool.searchPolicy) }),
          ...(pool.rating === undefined
            ? {}
            : { rating: normalizeRatingConfiguration(pool.rating) })
        })
      )
    ),
    authenticate: configuration.authenticate,
    inputLimits: Object.freeze({ ...configuration.inputLimits }),
    observability: Object.freeze({
      logSampleRate: configuration.observability?.logSampleRate ?? 1,
      analyticsSampleRate: configuration.observability?.analyticsSampleRate ?? 1
    }),
    ...(configuration.authorization === undefined
      ? {}
      : { authorization: Object.freeze({ ...configuration.authorization }) })
  };

  return Object.freeze(normalizedConfiguration);
}

function assertObservabilityConfiguration(
  configuration: FlareLobbyObservabilityConfiguration | undefined
): void {
  for (const [fieldName, value] of [
    ["logSampleRate", configuration?.logSampleRate],
    ["analyticsSampleRate", configuration?.analyticsSampleRate]
  ] as const) {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new FlareLobbyConfigurationError(
        "INVALID_OBSERVABILITY_CONFIGURATION",
        `observability.${fieldName} は 0 以上 1 以下で指定してください。`
      );
    }
  }
}

function assertCustomRoomConfiguration<TApp extends AnyFlareLobbyApp>(
  configuration: CustomRoomConfiguration<TApp>
): void {
  if (!isPositiveInteger(configuration.maxPlayers)) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.maxPlayers は 1 以上の整数で指定してください。"
    );
  }

  if (
    configuration.maxSpectators !== undefined &&
    !isNonNegativeInteger(configuration.maxSpectators)
  ) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.maxSpectators は 0 以上の整数で指定してください。"
    );
  }

  if (
    configuration.finishedRoomRetentionMs !== undefined &&
    (!Number.isSafeInteger(configuration.finishedRoomRetentionMs) ||
      configuration.finishedRoomRetentionMs < 0)
  ) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.finishedRoomRetentionMs は 0 以上の整数で指定してください。"
    );
  }

  if (
    configuration.resumeTokenTtlMs !== undefined &&
    !isPositiveInteger(configuration.resumeTokenTtlMs)
  ) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.resumeTokenTtlMs は 1 以上の整数で指定してください。"
    );
  }

  if (
    configuration.disconnectGracePeriodMs !== undefined &&
    !isNonNegativeInteger(configuration.disconnectGracePeriodMs)
  ) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.disconnectGracePeriodMs は 0 以上の整数で指定してください。"
    );
  }

  if (
    configuration.eventHistoryLimit !== undefined &&
    !isPositiveInteger(configuration.eventHistoryLimit)
  ) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.eventHistoryLimit は 1 以上の整数で指定してください。"
    );
  }

  if (
    configuration.processedCommandRetentionMs !== undefined &&
    !isPositiveInteger(configuration.processedCommandRetentionMs)
  ) {
    throw new FlareLobbyConfigurationError(
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
      "customRooms.processedCommandRetentionMs は 1 以上の整数で指定してください。"
    );
  }
}

function assertMatchmakingPools(
  pools: readonly MatchmakingPoolConfiguration[]
): void {
  const poolIds = new Set<string>();

  for (const pool of pools) {
    const fields: readonly [string, unknown][] = [
      ["id", pool.id],
      ["gameId", pool.gameId],
      ["seasonId", pool.seasonId],
      ["mode", pool.mode],
      ["region", pool.region]
    ];

    for (const [fieldName, value] of fields) {
      if (!isNonEmptyString(value)) {
        throw new FlareLobbyConfigurationError(
          "INVALID_MATCHMAKING_POOL",
          `matchmakingPools の ${fieldName} は空でない文字列で指定してください。`
        );
      }
    }

    if (poolIds.has(pool.id)) {
      throw new FlareLobbyConfigurationError(
        "INVALID_MATCHMAKING_POOL",
        `matchmakingPools の id（${pool.id}）が重複しています。`
      );
    }

    if (pool.searchPolicy !== undefined) {
      try {
        normalizeMatchmakingSearchPolicy(pool.searchPolicy);
      } catch {
        throw new FlareLobbyConfigurationError(
          "INVALID_MATCHMAKING_POOL",
          "matchmakingPools の searchPolicy が正しくありません。"
        );
      }
    }

    if (pool.rating !== undefined) {
      try {
        normalizeRatingConfiguration(pool.rating);
      } catch {
        throw new FlareLobbyConfigurationError(
          "INVALID_MATCHMAKING_POOL",
          "matchmakingPools の rating 設定が正しくありません。"
        );
      }
    }

    poolIds.add(pool.id);
  }
}

function assertInputLimits(limits: FlareLobbyInputLimits): void {
  const fields: readonly [string, number][] = [
    ["maxHttpRequestBytes", limits.maxHttpRequestBytes],
    ["maxWebSocketMessageBytes", limits.maxWebSocketMessageBytes],
    ["maxMessagesPerMinute", limits.maxMessagesPerMinute],
    ["maxRoomCreationsPerMinute", limits.maxRoomCreationsPerMinute]
  ];

  for (const [fieldName, value] of fields) {
    if (!isPositiveInteger(value)) {
      throw new FlareLobbyConfigurationError(
        "INVALID_INPUT_LIMITS",
        `inputLimits.${fieldName} は 1 以上の整数で指定してください。`
      );
    }
  }
}

function assertRequiredBindings(env: FlareLobbyBindings): void {
  if (env.FLARE_LOBBY_DB === undefined) {
    throw new FlareLobbyConfigurationError("D1_BINDING_MISSING");
  }

  if (env.FLARE_LOBBY_ROOMS === undefined) {
    throw new FlareLobbyConfigurationError(
      "ROOM_DURABLE_OBJECT_BINDING_MISSING"
    );
  }

  if (env.FLARE_LOBBY_MATCH_POOLS === undefined) {
    throw new FlareLobbyConfigurationError(
      "MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING"
    );
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRatingConfiguration(
  configuration: RatingConfiguration
): Required<EloOptions> {
  const engine = elo(configuration);
  return {
    initialRating: engine.initialRating,
    kFactor: engine.kFactor
  };
}
