import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { defineFlareLobby, verifyJoinToken } from "../src/index.js";
import type { FlareLobbyBindings } from "../src/index.js";

function createBaseConfiguration(customRooms: Record<string, unknown> = {}) {
  return {
    customRooms: {
      maxPlayers: 4,
      maxSpectators: 2,
      defaultSettings: { map: "forest" },
      ...customRooms,
    },
    matchmakingPools: [],
    authenticate: () => ({
      id: "principal-1",
      playerId: "player-1",
    }),
    authorization: {
      authorizeJoin: () => true,
      authorizeSpectate: () => true,
    },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
  };
}

function decodeTokenPayload(token: string): Record<string, unknown> {
  const segment = token.split(".")[0];
  if (segment === undefined) {
    throw new Error("token segment missing");
  }
  const padded = segment
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(segment.length / 4) * 4, "=");
  const binary = atob(padded);
  return JSON.parse(binary) as Record<string, unknown>;
}

describe("joinToken TTL 設定化 (#125)", () => {
  it("既定は 10 分で正規化される", () => {
    const lobby = defineFlareLobby(createBaseConfiguration());
    expect(lobby.configuration.customRooms.joinTokenTtlMs).toBe(10 * 60 * 1000);
  });

  it("不正な joinTokenTtlMs を拒否する", () => {
    for (const joinTokenTtlMs of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        defineFlareLobby(createBaseConfiguration({ joinTokenTtlMs })),
      ).toThrow();
    }
  });

  it("短縮設定が発行トークンの expiresAt へ反映される", async () => {
    const lobby = defineFlareLobby(
      createBaseConfiguration({ joinTokenTtlMs: 30_000 }),
    );
    const worker = lobby.createGatewayWorker<Env>();
    const before = Date.now();
    const response = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      }) as never,
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      roomId: string;
      joinToken: string;
    };
    const payload = decodeTokenPayload(body.joinToken);
    const expiresAt = payload["expiresAt"] as number;
    expect(expiresAt - before).toBeGreaterThanOrEqual(29_000);
    expect(expiresAt - before).toBeLessThanOrEqual(31_000);

    // 発行トークンは通常検証を通る（入室用途）。
    const verified = await verifyJoinToken(
      env.FLARE_LOBBY_TOKEN_SECRET,
      body.joinToken,
      {
        principal: { id: "principal-1", playerId: "player-1" },
        roomId: body.roomId,
      },
    );
    expect(verified.ok).toBe(true);
  });
});

describe("Worker 共存フォールバック (#127)", () => {
  it("FlareLobby 対象外は Binding 検証より前に委譲される", async () => {
    const lobby = defineFlareLobby(createBaseConfiguration());
    const worker = lobby.createGatewayWorker<Env>({
      onUnhandledRequest: (request) =>
        Response.json({
          delegated: true,
          path: new URL(request.url).pathname,
        }),
    });
    const brokenEnv = {
      FLARE_LOBBY_DB: undefined,
    } as unknown as Env;

    const response = await worker.fetch(
      new Request("https://example.test/api/v2/match") as never,
      brokenEnv,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      delegated: true,
      path: "/api/v2/match",
    });
  });

  it("/v1 の Binding 不備はフォールバックせず 500 を返す", async () => {
    const lobby = defineFlareLobby(createBaseConfiguration());
    const worker = lobby.createGatewayWorker<Env>({
      onUnhandledRequest: () => new Response("fallback", { status: 200 }),
    });
    const brokenEnv = { ...env, FLARE_LOBBY_DB: undefined } as unknown as Env;
    const response = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms") as never,
      brokenEnv,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(500);
  });

  it("FlareLobby の 404 はフォールバックへ委譲される", async () => {
    const lobby = defineFlareLobby(createBaseConfiguration());
    const worker = lobby.createGatewayWorker<Env>({
      onUnhandledRequest: () => new Response("game-api", { status: 200 }),
    });
    const response = await worker.fetch(
      new Request("https://example.test/v1/unknown-path", {
        method: "GET",
        headers: { "x-test-principal": "principal-1" },
      }) as never,
      env,
      {} as ExecutionContext,
    );
    // 認証ありの未知 /v1 経路はフォールバックへ委譲される。
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("game-api");
  });

  it("フォールバック未設定時は従来どおり 404 を返す", async () => {
    const lobby = defineFlareLobby(createBaseConfiguration());
    const worker = lobby.createGatewayWorker<Env>();
    const response = await worker.fetch(
      new Request("https://example.test/api/v2/match") as never,
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(404);
  });
});
