import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { KeyLike } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySupabaseAccessToken } from "./auth.js";

const projectUrl = "https://project.supabase.co";
const jwksUrl = `${projectUrl}/auth/v1/.well-known/jwks.json`;

describe("Supabase JWT verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the configured project and rejects invalid claims, algorithms, and JWKS failures", async () => {
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
      verifySupabaseAccessToken(`Bearer ${valid}`, projectUrl),
    ).resolves.toEqual({ id: "user-1", playerId: "user-1" });

    const cases = await Promise.all([
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
        sign(privateKey, { alg: "RS256", kid: "test-key" }, { sub: undefined }),
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
        sign(privateKey, { alg: "RS256", kid: "test-key" }, { aud: "public" }),
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
        verifySupabaseAccessToken(`Bearer ${token}`, projectUrl),
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
      verifySupabaseAccessToken(`Bearer ${missingExpiration}`, projectUrl),
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
      verifySupabaseAccessToken(`Bearer ${invalidAlgorithm}`, projectUrl),
    ).resolves.toBeNull();

    const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    await expect(
      verifySupabaseAccessToken(`Bearer ${tampered}`, projectUrl),
    ).resolves.toBeNull();
    await expect(
      verifySupabaseAccessToken("Bearer invalid", projectUrl),
    ).resolves.toBeNull();
    await expect(
      verifySupabaseAccessToken(
        `Bearer ${valid}`,
        "http://project.supabase.co",
      ),
    ).resolves.toBeNull();
  });

  it("does not use a token-supplied key URL", async () => {
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
      verifySupabaseAccessToken(`Bearer ${token}`, isolatedProjectUrl),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(isolatedJwksUrl, expect.anything());
  });

  it("accepts ES256 when the configured JWKS publishes an EC key", async () => {
    const isolatedProjectUrl = "https://ec-test.supabase.co";
    const isolatedJwksUrl = `${isolatedProjectUrl}/auth/v1/.well-known/jwks.json`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { alg: "ES256", kid: "ec-key", use: "sig" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(isolatedJwksUrl);
        return Response.json({ keys: [jwk] });
      }),
    );
    const token = await sign(
      privateKey,
      { alg: "ES256", kid: "ec-key" },
      {},
      isolatedProjectUrl,
    );

    await expect(
      verifySupabaseAccessToken(`Bearer ${token}`, isolatedProjectUrl),
    ).resolves.toEqual({ id: "user-1", playerId: "user-1" });
  });

  it("rejects a JWKS outage", async () => {
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
      verifySupabaseAccessToken(`Bearer ${token}`, isolatedProjectUrl),
    ).resolves.toBeNull();
  });
});

async function sign(
  privateKey: KeyLike,
  header: Record<string, string>,
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
  if (withExpiration && claims.exp === undefined) {
    builder.setExpirationTime("1h");
  }
  return builder.sign(privateKey);
}
