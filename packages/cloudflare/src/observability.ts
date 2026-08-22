import { FLARE_LOBBY_ERROR_CODES, FlareLobbyError } from "@flarelobby/core";
import type { FlareLobbyErrorCode } from "@flarelobby/core";

/** Gateway から Durable Object へ相関情報を渡す内部ヘッダーです。 */
export const FLARE_LOBBY_CORRELATION_ID_HEADER =
  "x-flarelobby-correlation-id" as const;
export const FLARE_LOBBY_REQUEST_ID_HEADER = "x-flarelobby-request-id" as const;
export const FLARE_LOBBY_OPERATION_HEADER =
  "x-flarelobby-observability-operation" as const;
const FLARE_LOBBY_LOG_SAMPLED_HEADER =
  "x-flarelobby-observability-log-sampled" as const;
const FLARE_LOBBY_ANALYTICS_SAMPLED_HEADER =
  "x-flarelobby-observability-analytics-sampled" as const;

/** 構造化ログのスキーマ版です。項目名を変更するときは版を上げます。 */
export const FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION = 1 as const;

/** 観測処理に利用できるサンプリング設定です。1 が全件、0 が無効です。 */
export interface FlareLobbyObservabilityConfiguration {
  readonly logSampleRate?: number;
  readonly analyticsSampleRate?: number;
}

/** Gateway から Room / Match Pool まで共有する相関情報です。 */
export interface FlareLobbyObservabilityContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly sampled: boolean;
  readonly analyticsSampled: boolean;
}

/** 相関情報を作成するときの上書き値です。 */
export interface FlareLobbyObservabilityContextOptions extends FlareLobbyObservabilityConfiguration {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly sampled?: boolean;
  readonly analyticsSampled?: boolean;
}

/** 操作結果です。失敗時は安定したエラーコードを併記します。 */
export type FlareLobbyObservationResult = "success" | "failure";

/** 観測対象の品質メトリクス名です。 */
export type FlareLobbyQualityMetricName =
  | "match_wait_time_ms"
  | "match_rating_difference"
  | "match_search_width"
  | "match_cancelled"
  | "match_succeeded"
  | "match_outcome";

/** 構造化ログへ記録できる安全な属性値です。 */
export type FlareLobbyObservabilityAttributeValue = string | number | boolean;

/**
 * 構造化ログの記録です。
 *
 * 属性はこのモジュールの許可リストを通過した値だけが出力されます。
 * 任意の Payload、本文、認証情報を渡す用途には使いません。
 */
export interface FlareLobbyStructuredLogRecord {
  readonly schemaVersion: typeof FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION;
  readonly event: "flarelobby.operation";
  readonly timestamp: string;
  readonly level: "info" | "error";
  readonly correlationId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly durationMs: number;
  readonly result: FlareLobbyObservationResult;
  readonly errorCode?: string;
  readonly stage?: string;
  readonly attributes?: Readonly<
    Record<string, FlareLobbyObservabilityAttributeValue>
  >;
}

/** Analytics Engine へ送る品質メトリクスです。 */
export interface FlareLobbyQualityMetric {
  readonly context: FlareLobbyObservabilityContext;
  readonly name: FlareLobbyQualityMetricName;
  readonly value: number;
  readonly operation?: string;
  readonly result?: FlareLobbyObservationResult;
  readonly attributes?: Readonly<
    Record<string, FlareLobbyObservabilityAttributeValue>
  >;
}

/** 構造化ログの出力先です。テストでは差し替えられます。 */
export interface FlareLobbyStructuredLogger {
  readonly log: (...values: readonly unknown[]) => void;
}

/** ログと Analytics Engine を安全に扱う観測 Sink です。 */
export interface FlareLobbyObservabilitySink {
  log(input: {
    readonly context: FlareLobbyObservabilityContext;
    readonly operation: string;
    readonly startedAt: number;
    readonly result: FlareLobbyObservationResult;
    readonly errorCode?: string;
    readonly stage?: string;
    readonly attributes?: Readonly<
      Record<string, FlareLobbyObservabilityAttributeValue>
    >;
  }): void;
  metric(input: FlareLobbyQualityMetric): void;
}

const SAFE_ATTRIBUTE_KEYS = new Set([
  "httpStatus",
  "roomKind",
  "role",
  "resumed",
  "status",
  "waitTimeMs",
  "ratingDifference",
  "searchWidth",
  "cancelled",
  "matched",
  "attempt",
  "sampleRate",
]);

/**
 * Request または明示的な値から相関情報を作成します。
 * Gateway の入口では `correlationId` を上書きしてクライアント申告値を採用しません。
 */
export function createObservabilityContext(
  request?: Request,
  options: FlareLobbyObservabilityContextOptions = {},
): FlareLobbyObservabilityContext {
  const correlationId = normalizeContextId(
    options.correlationId ??
      request?.headers.get(FLARE_LOBBY_CORRELATION_ID_HEADER) ??
      crypto.randomUUID(),
  );
  const requestId = normalizeContextId(
    options.requestId ??
      request?.headers.get(FLARE_LOBBY_REQUEST_ID_HEADER) ??
      request?.headers.get("Idempotency-Key") ??
      correlationId,
  );
  const logSampleRate = normalizeSampleRate(options.logSampleRate ?? 1);
  const analyticsSampleRate = normalizeSampleRate(
    options.analyticsSampleRate ?? 1,
  );

  return Object.freeze({
    correlationId,
    requestId,
    sampled:
      options.sampled ?? (logSampleRate >= 1 || Math.random() < logSampleRate),
    analyticsSampled:
      options.analyticsSampled ??
      (analyticsSampleRate >= 1 || Math.random() < analyticsSampleRate),
  });
}

/** RPC または内部処理用に要求識別子だけを差し替えます。 */
export function withObservabilityRequestId(
  context: FlareLobbyObservabilityContext,
  requestId: string,
): FlareLobbyObservabilityContext {
  return Object.freeze({
    ...context,
    requestId: normalizeContextId(requestId),
  });
}

/** 相関情報を内部ヘッダーへ設定した Request を返します。 */
export function attachObservabilityHeaders(
  request: Request,
  context: FlareLobbyObservabilityContext,
): Request {
  const headers = new Headers(request.headers);
  headers.set(FLARE_LOBBY_CORRELATION_ID_HEADER, context.correlationId);
  headers.set(FLARE_LOBBY_REQUEST_ID_HEADER, context.requestId);
  headers.set(FLARE_LOBBY_LOG_SAMPLED_HEADER, context.sampled ? "1" : "0");
  headers.set(
    FLARE_LOBBY_ANALYTICS_SAMPLED_HEADER,
    context.analyticsSampled ? "1" : "0",
  );
  return new Request(request, { headers });
}

/** 内部ヘッダーから相関情報を復元します。未設定なら新規に作成します。 */
export function readObservabilityContext(
  request: Request,
): FlareLobbyObservabilityContext {
  const sampled = readBooleanHeader(request, FLARE_LOBBY_LOG_SAMPLED_HEADER);
  const analyticsSampled = readBooleanHeader(
    request,
    FLARE_LOBBY_ANALYTICS_SAMPLED_HEADER,
  );
  return createObservabilityContext(request, {
    ...(sampled === undefined ? {} : { sampled }),
    ...(analyticsSampled === undefined ? {} : { analyticsSampled }),
  });
}

/** ログと任意 Analytics Engine の Sink を作成します。 */
export function createObservabilitySink(
  analytics: AnalyticsEngineDataset | undefined,
  configuration: FlareLobbyObservabilityConfiguration = {},
  logger: FlareLobbyStructuredLogger = console,
): FlareLobbyObservabilitySink {
  const logSampleRate = normalizeSampleRate(configuration.logSampleRate ?? 1);
  const analyticsSampleRate = normalizeSampleRate(
    configuration.analyticsSampleRate ?? 1,
  );

  return {
    log(input): void {
      if (
        input.result === "success" &&
        (logSampleRate === 0 || (!input.context.sampled && logSampleRate < 1))
      ) {
        return;
      }

      const durationMs = Math.max(0, Date.now() - input.startedAt);
      const record: FlareLobbyStructuredLogRecord = {
        schemaVersion: FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION,
        event: "flarelobby.operation",
        timestamp: new Date().toISOString(),
        level: input.result === "failure" ? "error" : "info",
        correlationId: input.context.correlationId,
        requestId: input.context.requestId,
        operation: input.operation,
        durationMs,
        result: input.result,
        ...(input.errorCode === undefined
          ? {}
          : { errorCode: normalizeErrorCode(input.errorCode) }),
        ...(input.stage === undefined ? {} : { stage: input.stage }),
        ...safeAttributes(input.attributes),
      };

      safeInvoke(() => logger.log(JSON.stringify(record)));
    },
    metric(input): void {
      if (
        analytics === undefined ||
        analyticsSampleRate === 0 ||
        (!input.context.analyticsSampled && analyticsSampleRate < 1)
      ) {
        return;
      }

      if (!Number.isFinite(input.value)) {
        return;
      }

      const attributes = safeAttributes(input.attributes);
      safeInvoke(() => {
        analytics.writeDataPoint({
          indexes: [
            "flarelobby.v1",
            input.name,
            input.operation ?? "",
            input.result ?? "",
          ],
          doubles: [input.value],
          blobs: [
            JSON.stringify({
              schemaVersion: FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION,
              correlationId: input.context.correlationId,
              requestId: input.context.requestId,
              ...attributes,
            }),
          ],
        });
      });
    },
  };
}

/** 操作を実行し、成功・失敗・所要時間を構造化記録します。 */
export async function observeOperation<T>(
  sink: FlareLobbyObservabilitySink,
  context: FlareLobbyObservabilityContext,
  operation: string,
  action: () => Promise<T>,
  options: {
    readonly stage?: string;
    readonly attributes?: Readonly<
      Record<string, FlareLobbyObservabilityAttributeValue>
    >;
  } = {},
): Promise<T> {
  const startedAt = Date.now();

  try {
    const result = await action();
    safeLog(sink, {
      context,
      operation,
      startedAt,
      result: "success",
      ...(options.stage === undefined ? {} : { stage: options.stage }),
      ...(options.attributes === undefined
        ? {}
        : { attributes: options.attributes }),
    });
    return result;
  } catch (error) {
    safeLog(sink, {
      context,
      operation,
      startedAt,
      result: "failure",
      errorCode: getObservabilityErrorCode(error),
      ...(options.stage === undefined ? {} : { stage: options.stage }),
      ...(options.attributes === undefined
        ? {}
        : { attributes: options.attributes }),
    });
    throw error;
  }
}

/** HTTP 操作を観測し、エラー応答から安定したコードだけを抽出します。 */
export async function observeHttpOperation(
  sink: FlareLobbyObservabilitySink,
  context: FlareLobbyObservabilityContext,
  operation: string,
  action: () => Promise<Response>,
): Promise<Response> {
  const startedAt = Date.now();

  try {
    const response = await action();
    const successful = response.ok || response.status === 101;
    const errorCode = successful
      ? undefined
      : await readResponseErrorCode(response);
    safeLog(sink, {
      context,
      operation,
      startedAt,
      result: successful ? "success" : "failure",
      ...(errorCode === undefined ? {} : { errorCode }),
      attributes: { httpStatus: response.status },
    });
    return response;
  } catch (error) {
    safeLog(sink, {
      context,
      operation,
      startedAt,
      result: "failure",
      errorCode: getObservabilityErrorCode(error),
    });
    throw error;
  }
}

/** 品質メトリクスを安全に Analytics Engine へ送ります。 */
export function recordQualityMetric(
  sink: FlareLobbyObservabilitySink,
  metric: FlareLobbyQualityMetric,
): void {
  safeInvoke(() => sink.metric(metric));
}

/** Request のパスから、Gateway で利用する安定した操作名を返します。 */
export function getObservabilityOperationName(request: Request): string {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/") {
    return "gateway.ready";
  }
  if (pathname === "/v1/custom-rooms") {
    return request.method === "POST" ? "room.create" : "room.list";
  }
  if (
    pathname === "/v1/custom-rooms/join" ||
    /^\/v1\/custom-rooms\/[^/]+\/join$/u.test(pathname)
  ) {
    return "room.join";
  }
  if (
    pathname === "/v1/custom-rooms/leave" ||
    /^\/v1\/custom-rooms\/[^/]+\/leave$/u.test(pathname)
  ) {
    return "room.leave";
  }
  if (/^\/v1\/custom-rooms\/[^/]+\/ws$/u.test(pathname)) {
    return "room.connect";
  }
  if (pathname.includes("/matchmaking/")) {
    if (pathname.endsWith("/result")) {
      return "rating.result";
    }
    if (pathname.endsWith("/cancel")) {
      return "matchmaking.cancel";
    }
    if (pathname.endsWith("/tickets")) {
      return request.method === "POST"
        ? "matchmaking.ticket.create"
        : "matchmaking.ticket.list";
    }
    if (pathname.endsWith("/connection")) {
      return "room.match.connect";
    }
    if (pathname.endsWith("/rating")) {
      return "rating.read";
    }
    return "matchmaking.request";
  }

  return "gateway.request";
}

/** Core の公開エラーコードまたは観測用の安定コードへ正規化します。 */
export function getObservabilityErrorCode(error: unknown): string {
  if (error instanceof FlareLobbyError) {
    return error.code;
  }

  if (isRecord(error) && typeof error["code"] === "string") {
    return normalizeErrorCode(error["code"]);
  }

  return "INTERNAL_ERROR";
}

function safeLog(
  sink: FlareLobbyObservabilitySink,
  input: Parameters<FlareLobbyObservabilitySink["log"]>[0],
): void {
  safeInvoke(() => sink.log(input));
}

function safeAttributes(
  attributes:
    | Readonly<Record<string, FlareLobbyObservabilityAttributeValue>>
    | undefined,
):
  | {
      readonly attributes: Readonly<
        Record<string, FlareLobbyObservabilityAttributeValue>
      >;
    }
  | Record<string, never> {
  if (attributes === undefined) {
    return {};
  }

  const result: Record<string, FlareLobbyObservabilityAttributeValue> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (
      !SAFE_ATTRIBUTE_KEYS.has(key) ||
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean") ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      continue;
    }

    result[key] = value;
  }

  return Object.keys(result).length === 0 ? {} : { attributes: result };
}

function normalizeContextId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 256) {
    return crypto.randomUUID();
  }

  return trimmed;
}

function normalizeSampleRate(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      "観測サンプリング率は 0 以上 1 以下で指定してください。",
    );
  }

  return value;
}

function readBooleanHeader(
  request: Request,
  name: string,
): boolean | undefined {
  const value = request.headers.get(name);
  if (value === null) {
    return undefined;
  }

  return value === "1";
}

function normalizeErrorCode(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    /^[A-Z][A-Z0-9_]*$/u.test(trimmed)
  ) {
    return trimmed;
  }

  return "INTERNAL_ERROR";
}

async function readResponseErrorCode(response: Response): Promise<string> {
  try {
    const value: unknown = await response.clone().json();
    if (
      isRecord(value) &&
      typeof value["code"] === "string" &&
      isFlareLobbyErrorCode(value["code"])
    ) {
      return value["code"];
    }
  } catch {
    // 本文を観測のために必要としません。HTTP status だけを安定値にします。
  }

  return `HTTP_${response.status}`;
}

function isFlareLobbyErrorCode(value: string): value is FlareLobbyErrorCode {
  return FLARE_LOBBY_ERROR_CODES.some((code) => code === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeInvoke(action: () => void): void {
  try {
    action();
  } catch {
    // ログや観測先の障害で主要処理を失敗させません。
  }
}
