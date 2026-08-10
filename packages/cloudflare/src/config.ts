import type {
  AnyFlareLobbyApp,
  AppRoomSettings,
  FlareLobbyApp,
  MatchmakingPool
} from "@flarelobby/core";
import { FlareLobbyError } from "@flarelobby/core";
import type { ProtocolResult } from "@flarelobby/core";

import type {
  MatchPoolDurableObject,
  RateLimitDurableObject,
  RoomDurableObject
} from "./durable-objects.js";
import {
  authenticateGatewayRequest,
  createErrorResponse
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
  readonly defaultSettings: AppRoomSettings<TApp>;
}

/** 1 対 1 マッチングに使うプール設定です。 */
export type MatchmakingPoolConfiguration = MatchmakingPool;

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
}

/** 設定または必須 Binding の不備を判定する安定したコードです。 */
export const FLARE_LOBBY_CONFIGURATION_ERROR_CODES = [
  "D1_BINDING_MISSING",
  "ROOM_DURABLE_OBJECT_BINDING_MISSING",
  "MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING",
  "INVALID_CUSTOM_ROOM_CONFIGURATION",
  "INVALID_MATCHMAKING_POOL",
  "INVALID_INPUT_LIMITS",
  "INVALID_AUTHENTICATION_HOOK"
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
  INVALID_AUTHENTICATION_HOOK: "認証 Hook の設定が正しくありません。"
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
      try {
        assertRequiredBindings(env);
      } catch (error) {
        if (error instanceof FlareLobbyConfigurationError) {
          return Response.json(error.toJSON(), { status: 500 });
        }

        throw error;
      }

      if (request.method === "GET" && new URL(request.url).pathname === "/") {
        return Response.json({ status: "ready" });
      }

      const authenticatedRequest = await authenticateGatewayRequest(
        request,
        normalizedConfiguration.authenticate,
        env.FLARE_LOBBY_TOKEN_SECRET
      );

      if (!authenticatedRequest.ok) {
        return createErrorResponse(authenticatedRequest.error);
      }

      // 後続 Issue の HTTP / WebSocket ルートは、この時点で取得した
      // authenticatedRequest.gatewayPrincipal だけを DO へ渡します。
      // 未認証要求はここより先の操作ディスパッチへ到達できません。
      return new Response("Not Found", { status: 404 });
    }
  };
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

  if (typeof configuration.authenticate !== "function") {
    throw new FlareLobbyConfigurationError("INVALID_AUTHENTICATION_HOOK");
  }

  const normalizedConfiguration: FlareLobbyConfiguration<TApp> = {
    customRooms: Object.freeze({
      maxPlayers: configuration.customRooms.maxPlayers,
      defaultSettings: configuration.customRooms.defaultSettings
    }),
    matchmakingPools: Object.freeze(
      configuration.matchmakingPools.map((pool) => Object.freeze({ ...pool }))
    ),
    authenticate: configuration.authenticate,
    inputLimits: Object.freeze({ ...configuration.inputLimits }),
    ...(configuration.authorization === undefined
      ? {}
      : { authorization: Object.freeze({ ...configuration.authorization }) })
  };

  return Object.freeze(normalizedConfiguration);
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
