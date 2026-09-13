import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { authenticateGatewayRequest } from "../src/index.js";

const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;

describe("RateLimit Durable Object", () => {
  it("検証できない主体を制限超過として拒否する", async () => {
    const stub = env.FLARE_LOBBY_RATE_LIMITS.getByName(
      `rate-deny-${crypto.randomUUID()}`,
    );

    const decision = await stub.consume(
      { token: "invalid-token" } as never,
      "room_creation",
      10,
    );

    expect(decision.allowed).toBe(false);
  });

  it("初回消費を許可する", async () => {
    const stub = env.FLARE_LOBBY_RATE_LIMITS.getByName(
      `rate-allow-${crypto.randomUUID()}`,
    );
    const authenticated = await authenticateGatewayRequest(
      new Request("https://example.test/", { method: "POST" }),
      () => ({ id: "rate-user", playerId: "rate-user-player" }),
      TOKEN_SECRET,
    );

    if (!authenticated.ok) {
      throw authenticated.error;
    }

    const decision = await stub.consume(
      authenticated.value.gatewayPrincipal,
      "room_creation",
      10,
    );

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({ allowed: true, retryAfterSeconds: 0 });
  });
});
