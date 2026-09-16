/**
 * 公開デモ用の Supabase JWT 検証です。
 *
 * #101 の `templates/supabase/src/auth.ts` と同じ検証方式（固定プロジェクトの
 * JWKS、ES256/RS256、issuer 完全一致、audience `authenticated`、exp/sub 必須、
 * role `authenticated`）を、この例専用に複製しています。local-demo の
 * ローカル専用認証（任意 Bearer / x-demo-player）は公開 entry から
 * import しません。暗号・JWT パーサーは自作せず `jose` を使います。
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWSAlgorithm, JWTVerifyGetKey } from "jose";

export interface HostedDemoPrincipal {
  readonly id: string;
  readonly playerId: string;
}

const allowedAlgorithms = ["ES256", "RS256"] satisfies JWSAlgorithm[];
const jwksCache = new Map<string, JWTVerifyGetKey>();

/** Worker の入口から渡された Authorization を Supabase の主体へ変換します。 */
export function authenticateHostedDemoRequest(
  request: Request,
  supabaseUrl: string,
): Promise<HostedDemoPrincipal | null> {
  return verifyHostedDemoAccessToken(
    request.headers.get("authorization"),
    supabaseUrl,
  );
}

/**
 * 固定した Supabase プロジェクトの JWKS だけで Bearer JWT を検証します。
 * 匿名ログインの token も有効な JWT として検証します。プレイヤー名や
 * URL パラメータは本人確認に使いません。
 */
export async function verifyHostedDemoAccessToken(
  authorization: string | null,
  supabaseUrl: string,
): Promise<HostedDemoPrincipal | null> {
  const token = readBearerToken(authorization);
  const projectUrl = normalizeProjectUrl(supabaseUrl);

  if (token === null || projectUrl === null) {
    return null;
  }

  const issuer = `${projectUrl}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  try {
    const { payload } = await jwtVerify(token, getJwks(jwksUrl), {
      algorithms: allowedAlgorithms,
      audience: "authenticated",
      issuer,
    });

    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== "string" ||
      payload.sub.trim().length === 0 ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= now ||
      payload["role"] !== "authenticated"
    ) {
      return null;
    }

    return { id: payload.sub, playerId: payload.sub };
  } catch {
    return null;
  }
}

function readBearerToken(authorization: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/iu.exec(authorization ?? "");
  return match?.[1] ?? null;
}

function normalizeProjectUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function getJwks(url: string): JWTVerifyGetKey {
  const cached = jwksCache.get(url);
  if (cached !== undefined) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, jwks);
  return jwks;
}
