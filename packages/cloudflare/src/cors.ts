import { FlareLobbyError } from "@flarelobby/core";

/** ブラウザからのクロスオリジン利用を許可する CORS 設定です。 */
export interface FlareLobbyCorsConfiguration {
  readonly allowedOrigins: readonly string[];
}

/** 既存 HTTP API が対応するメソッドです。 */
export const CORS_SUPPORTED_METHODS = ["GET", "POST"] as const;

/** プリフライトで許可する要求ヘッダー名（小文字の正規形）です。 */
const CORS_ALLOWED_HEADER_NAMES = [
  "authorization",
  "content-type",
  "idempotency-key",
  "accept",
] as const;

/** プリフライト応答で通知する許可ヘッダー名（正規の大文字小文字）です。 */
const CORS_ALLOW_HEADERS_VALUE =
  "Authorization, Content-Type, Idempotency-Key, Accept" as const;

const CORS_EXPOSE_HEADERS_VALUE = "Retry-After" as const;
const CORS_PREFLIGHT_MAX_AGE = "86400" as const;

/**
 * 正規の http/https Origin 文字列かどうかを判定します。
 *
 * scheme/host/任意 port の `URL.origin` と完全一致する場合だけ真になります。
 * パス・query・fragment・userinfo・wildcard・文字列 `null` を拒否します。
 */
export function isValidCorsOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  if (value === "null" || value.includes("*")) {
    return false;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return false;
  }

  if (parsed.host === "") {
    return false;
  }

  return value === parsed.origin;
}

/** 許可 Origin に完全一致するかどうかを判定します。 */
export function isAllowedCorsOrigin(
  origin: string,
  allowedOrigins: readonly string[],
): boolean {
  return allowedOrigins.includes(origin);
}

/** WebSocket Upgrade 要求かどうかを判定します。 */
function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

/**
 * CORS プリフライト要求かどうかを判定します。
 *
 * `OPTIONS` + `Origin` + `Access-Control-Request-Method` を満たす場合だけ
 * 真になります。WebSocket Upgrade は対象外です。
 */
export function isCorsPreflightRequest(request: Request): boolean {
  if (request.method !== "OPTIONS") {
    return false;
  }

  if (isWebSocketUpgradeRequest(request)) {
    return false;
  }

  const origin = request.headers.get("Origin");

  if (origin === null || origin.trim() === "") {
    return false;
  }

  const requestMethod = request.headers.get("Access-Control-Request-Method");

  return requestMethod !== null && requestMethod.trim() !== "";
}

function parsePreflightRequestHeaders(request: Request): string[] | null {
  const raw = request.headers.get("Access-Control-Request-Headers");

  if (raw === null || raw.trim() === "") {
    return [];
  }

  const names = raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);

  // 空要素だけの場合はヘッダーなしとして扱います。
  if (
    names.length === 0 &&
    raw.split(",").every((part) => part.trim() === "")
  ) {
    return [];
  }

  return names;
}

/**
 * CORS プリフライトを処理します。
 *
 * 許可されたものに 204 を返します。未対応 method/header、許可されない Origin
 * のプリフライトは 403 を返し、許可ヘッダーを付けません。
 */
export function handleCorsPreflight(
  request: Request,
  allowedOrigins: readonly string[],
): Response {
  const origin = request.headers.get("Origin") ?? "";

  if (!isAllowedCorsOrigin(origin, allowedOrigins)) {
    return Response.json(new FlareLobbyError("FORBIDDEN").toJSON(), {
      status: 403,
    });
  }

  const requestMethod =
    request.headers
      .get("Access-Control-Request-Method")
      ?.trim()
      .toUpperCase() ?? "";

  if (
    requestMethod !== "GET" &&
    requestMethod !== "POST" &&
    !(CORS_SUPPORTED_METHODS as readonly string[]).includes(requestMethod)
  ) {
    return Response.json(new FlareLobbyError("FORBIDDEN").toJSON(), {
      status: 403,
    });
  }

  const requestHeaders = parsePreflightRequestHeaders(request);

  if (requestHeaders === null) {
    return Response.json(new FlareLobbyError("FORBIDDEN").toJSON(), {
      status: 403,
    });
  }

  const allowed = new Set<string>(CORS_ALLOWED_HEADER_NAMES);

  for (const name of requestHeaders) {
    if (!allowed.has(name)) {
      return Response.json(new FlareLobbyError("FORBIDDEN").toJSON(), {
        status: 403,
      });
    }
  }

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST");
  headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS_VALUE);
  headers.set("Access-Control-Max-Age", CORS_PREFLIGHT_MAX_AGE);

  return new Response(null, { status: 204, headers });
}

function mergeVary(existing: string | null): string {
  if (existing === null || existing.trim() === "") {
    return "Origin";
  }

  const parts = existing
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.some((part) => part === "*")) {
    return existing.trim();
  }

  if (parts.some((part) => part.toLowerCase() === "origin")) {
    return existing.trim();
  }

  return `${existing.trim()}, Origin`;
}

function mergeExposeHeaders(existing: string | null): string {
  if (existing === null || existing.trim() === "") {
    return CORS_EXPOSE_HEADERS_VALUE;
  }

  const parts = existing
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.some((part) => part.toLowerCase() === "retry-after")) {
    return existing.trim();
  }

  return `${existing.trim()}, ${CORS_EXPOSE_HEADERS_VALUE}`;
}

/**
 * 許可 Origin の通常 HTTP 応答に CORS ヘッダーを付けます。
 *
 * Origin なし、未設定時、不許可 Origin、WebSocket Upgrade、101 応答は
 * 既存処理を維持するため元の応答をそのまま返します。
 */
export function applyCorsHeaders(
  response: Response,
  request: Request,
  cors: FlareLobbyCorsConfiguration | undefined,
): Response {
  if (cors === undefined) {
    return response;
  }

  const origin = request.headers.get("Origin");

  if (origin === null || origin === "") {
    return response;
  }

  if (!isAllowedCorsOrigin(origin, cors.allowedOrigins)) {
    return response;
  }

  if (isWebSocketUpgradeRequest(request)) {
    return response;
  }

  // プリフライトの成否は handleCorsPreflight が決定済みのため、
  // 外側で許可ヘッダーを付け直さない。失敗時の許可ヘッダーなしを維持する。
  if (isCorsPreflightRequest(request)) {
    return response;
  }

  try {
    if (response.status === 101 || response.webSocket !== null) {
      return response;
    }
  } catch {
    if (response.status === 101) {
      return response;
    }
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", mergeVary(response.headers.get("Vary")));
  headers.set(
    "Access-Control-Expose-Headers",
    mergeExposeHeaders(response.headers.get("Access-Control-Expose-Headers")),
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
