import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { CryptoKey, JWSAlgorithm } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyHostedDemoAccessToken } from "../src/auth.js";

const projectUrl = "https://project.supabase.co";
const jwksUrl = `${projectUrl}/auth/v1/.well-known/jwks.json`;

describe("公開デモの Supabase JWT 検証", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("設定したプロジェクトを受け入れ、claim・alg・JWKS 異常を拒否する", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { alg: "RS256", kid: "test-key", use: "sig" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(jwksUrl);
        return Response.json({ keys: [jwk] });
      }),
    );

    const valid = await sign(privateKey, {
      alg: "RS256",
      kid: "test-key",
    });
    await expect(
      verifyHostedDemoAccessToken(`Bearer ${valid}`, projectUrl),
    ).resolves.toEqual({ id: "user-1", playerId: "user-1" });

    const cases: Array<readonly [label: string, token: Promise<string>]> =
      await Promise.all([
        [
          "expired",
          sign(
            privateKey,
            { alg: "RS256", kid: "test-key" },
            { exp: 1_700_000_000 },
          ),
        ],
        [
          "missing sub",
          sign(
            privateKey,
            { alg: "RS256", kid: "test-key" },
            { sub: undefined },
          ),
        ],
        [
          "wrong role",
          sign(privateKey, { alg: "RS256", kid: "test-key" }, { role: "anon" }),
        ],
        [
          "wrong issuer",
          sign(
            privateKey,
            { alg: "RS256", kid: "test-key" },
            {},
            "https://other.supabase.co",
          ),
        ],
        [
          "wrong audience",
          sign(
            privateKey,
            { alg: "RS256", kid: "test-key" },
            { aud: "public" },
          ),
        ],
        [
          "future nbf",
          sign(
            privateKey,
            { alg: "RS256", kid: "test-key" },
            {
              nbf: Math.floor(Date.now() / 1000) + 3600,
            },
          ),
        ],
      ]);
    for (const [label, tokenPromise] of cases) {
      const token = await tokenPromise;
      await expect(
        verifyHostedDemoAccessToken(`Bearer ${token}`, projectUrl),
        label,
      ).resolves.toBeNull();
    }

    const missingExpiration = await sign(
      privateKey,
      { alg: "RS256", kid: "test-key" },
      {},
      projectUrl,
      false,
    );
    await expect(
      verifyHostedDemoAccessToken(`Bearer ${missingExpiration}`, projectUrl),
    ).resolves.toBeNull();

    const invalidAlgorithm = await new SignJWT({
      aud: "authenticated",
      role: "authenticated",
      sub: "user-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(`${projectUrl}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("not-a-jwks-key"));
    await expect(
      verifyHostedDemoAccessToken(`Bearer ${invalidAlgorithm}`, projectUrl),
    ).resolves.toBeNull();

    const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    await expect(
      verifyHostedDemoAccessToken(`Bearer ${tampered}`, projectUrl),
    ).resolves.toBeNull();
    // 任意 Bearer（local-demo 形式の名前）は署名検証で拒否する。
    await expect(
      verifyHostedDemoAccessToken("Bearer sample-player", projectUrl),
    ).resolves.toBeNull();
    await expect(
      verifyHostedDemoAccessToken(
        `Bearer ${valid}`,
        "http://project.supabase.co",
      ),
    ).resolves.toBeNull();
  });

  it("token 付随の鍵 URL を使わない", async () => {
    const isolatedProjectUrl = "https://jku-test.supabase.co";
    const isolatedJwksUrl = `${isolatedProjectUrl}/auth/v1/.well-known/jwks.json`;
    const { privateKey } = await generateKeyPair("RS256");
    const fetchMock = vi.fn(async () => Response.json({ keys: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const token = await sign(
      privateKey,
      {
        alg: "RS256",
        kid: "test-key",
        jku: "https://attacker.example/jwks.json",
      },
      {},
      isolatedProjectUrl,
    );

    await expect(
      verifyHostedDemoAccessToken(`Bearer ${token}`, isolatedProjectUrl),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(isolatedJwksUrl, expect.anything());
  });

  it("JWKS 障害を拒否する", async () => {
    const isolatedProjectUrl = "https://outage-test.supabase.co";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const { privateKey } = await generateKeyPair("RS256");
    const token = await sign(
      privateKey,
      { alg: "RS256", kid: "test-key" },
      {},
      isolatedProjectUrl,
    );

    await expect(
      verifyHostedDemoAccessToken(`Bearer ${token}`, isolatedProjectUrl),
    ).resolves.toBeNull();
  });
});

async function sign(
  privateKey: CryptoKey,
  header: {
    readonly alg: JWSAlgorithm;
    readonly kid?: string;
    readonly jku?: string;
  },
  claims: Record<string, unknown> = {},
  issuerUrl = projectUrl,
  withExpiration = true,
): Promise<string> {
  const builder = new SignJWT({
    aud: "authenticated",
    role: "authenticated",
    sub: "user-1",
    ...claims,
  })
    .setProtectedHeader(header)
    .setIssuer(`${issuerUrl}/auth/v1`)
    .setIssuedAt();
  if (withExpiration && claims["exp"] === undefined) {
    builder.setExpirationTime("1h");
  }
  return builder.sign(privateKey);
}
