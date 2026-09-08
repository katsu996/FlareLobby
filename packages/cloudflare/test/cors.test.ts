import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  FlareLobbyConfigurationError,
  applyCorsHeaders,
  createErrorResponse,
  defineFlareLobby,
  isAllowedCorsOrigin,
  isValidCorsOrigin,
} from "../src/index.js";
import { createRateLimitError } from "../src/security.js";
import { createGatewayPrincipalEnvelope } from "../src/index.js";

import type { Principal } from "@flarelobby/core";

const ALLOWED_ORIGIN = "https://game.example";
const ALLOWED_ORIGIN_WITH_PORT = "http://localhost:5173";

function createBaseConfiguration(
  authenticate: () => Principal | null | Promise<Principal | null> = () => ({
    id: "principal-cors",
    playerId: "player-cors",
  }),
) {
  return {
    customRooms: {
      maxPlayers: 2,
      defaultSettings: { map: "forest" },
    },
    matchmakingPools: [],
    authenticate,
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
  };
}

function createPreflightRequest(
  origin: string,
  method = "POST",
  headers = "authorization,content-type",
): Request {
  return new Request("https://example.test/v1/custom-rooms", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": headers,
    },
  });
}

describe("CORS Origin の検証", () => {
  it("正規の http/https Origin を受け付ける", () => {
    expect(isValidCorsOrigin("https://game.example")).toBe(true);
    expect(isValidCorsOrigin("http://localhost:5173")).toBe(true);
    expect(isValidCorsOrigin("https://game.example:8443")).toBe(true);
    expect(isAllowedCorsOrigin(ALLOWED_ORIGIN, [ALLOWED_ORIGIN])).toBe(true);
    expect(
      isAllowedCorsOrigin("https://sub.game.example", [ALLOWED_ORIGIN]),
    ).toBe(false);
  });

  it("パス・query・fragment・userinfo・wildcard・null を拒否する", () => {
    const invalid = [
      "https://game.example/path",
      "https://game.example?query=1",
      "https://game.example#fragment",
      "https://user@game.example",
      "https://user:pass@game.example",
      "https://*.game.example",
      "https://*",
      "null",
      "",
      "https://game.example/",
      "https://game.example:443",
      "http://game.example:80",
      "ftp://game.example",
      "game.example",
      "https://GAME.example",
      null,
      undefined,
      42,
    ];

    for (const origin of invalid) {
      expect(isValidCorsOrigin(origin), `origin=${String(origin)}`).toBe(false);
    }
  });

  it("不正な CORS 設定を INVALID_CORS_CONFIGURATION で拒否する", () => {
    const invalidOrigins = [
      ["https://game.example/path"],
      ["https://*.game.example"],
      ["null"],
      ["not-a-url"],
      ["https://user@game.example"],
    ];

    for (const allowedOrigins of invalidOrigins) {
      try {
        defineFlareLobby({
          ...createBaseConfiguration(),
          cors: { allowedOrigins },
        } as never);
      } catch (error) {
        expect(error).toBeInstanceOf(FlareLobbyConfigurationError);
        expect((error as FlareLobbyConfigurationError).code).toBe(
          "INVALID_CORS_CONFIGURATION",
        );
        continue;
      }

      throw new Error(
        `設定エラーが送出されることを期待しました: ${allowedOrigins}`,
      );
    }
  });

  it("許可 Origin 配列を複製して freeze する", () => {
    const allowedOrigins = ["https://game.example"];
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: { allowedOrigins },
    });

    allowedOrigins.push("https://evil.example");
    expect(lobby.configuration.cors?.allowedOrigins).toEqual([
      "https://game.example",
    ]);
    expect(Object.isFrozen(lobby.configuration.cors)).toBe(true);
    expect(Object.isFrozen(lobby.configuration.cors?.allowedOrigins)).toBe(
      true,
    );
  });
});

describe("Gateway の CORS プリフライト処理", () => {
  it("正しい許可 Origin のプリフライトが 204 で成功し認証を呼ばない", async () => {
    let authenticateCalls = 0;
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(() => {
        authenticateCalls += 1;
        return { id: "principal-cors", playerId: "player-cors" };
      }),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const response = await worker.fetch(
      createPreflightRequest(ALLOWED_ORIGIN) as never,
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization",
    );
    expect(response.headers.get("Vary")).toContain("Origin");
    expect(authenticateCalls).toBe(0);
  });

  it("不許可 Origin・method・header を許可しない", async () => {
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const cases: Array<[string, Request]> = [
      ["不許可 Origin", createPreflightRequest("https://evil.example")],
      ["未対応 method", createPreflightRequest(ALLOWED_ORIGIN, "PUT")],
      [
        "未対応 header",
        createPreflightRequest(ALLOWED_ORIGIN, "POST", "x-custom"),
      ],
      [
        "大文字小文字違いの未対応 header",
        createPreflightRequest(ALLOWED_ORIGIN, "POST", "X-Custom-Header"),
      ],
    ];

    for (const [description, request] of cases) {
      const response = await worker.fetch(
        request as never,
        env,
        {} as ExecutionContext,
      );
      expect(response.status, description).toBe(403);
      expect(
        response.headers.get("Access-Control-Allow-Origin"),
        description,
      ).toBeNull();
    }
  });

  it("要求ヘッダー名の大文字小文字を区別せず検証する", async () => {
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const response = await worker.fetch(
      createPreflightRequest(
        ALLOWED_ORIGIN,
        "POST",
        "Authorization, CONTENT-TYPE, idempotency-key, accept",
      ) as never,
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
  });

  it("許可 Origin の成功・エラー応答にヘッダーが付く", async () => {
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(() => null),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const unauthorized = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ requestId: "cors-unauthorized" }),
      }) as never,
      env,
      {} as ExecutionContext,
    );

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(unauthorized.headers.get("Vary")).toContain("Origin");
    expect(unauthorized.headers.get("Access-Control-Expose-Headers")).toContain(
      "Retry-After",
    );

    const notFound = await worker.fetch(
      new Request("https://example.test/v1/unknown-path", {
        headers: { Origin: ALLOWED_ORIGIN },
      }) as never,
      env,
      {} as ExecutionContext,
    );

    // 未認証のため認証より後の 404 には到達せず 401 になるが、
    // エラー応答にも CORS ヘッダーが付くことを確認する。
    expect(notFound.status).toBe(401);
    expect(notFound.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
  });

  it("既存 Vary や Retry-After を維持し Retry-After を公開する", () => {
    const retryAfter = createErrorResponse(
      createRateLimitError(30, "要求が許可された頻度を超えています。"),
    );
    expect(retryAfter.headers.get("Retry-After")).toBe("30");

    const withCors = applyCorsHeaders(
      retryAfter,
      new Request("https://example.test/v1/custom-rooms", {
        headers: { Origin: ALLOWED_ORIGIN },
      }),
      { allowedOrigins: [ALLOWED_ORIGIN] },
    );

    expect(withCors.status).toBe(429);
    expect(withCors.headers.get("Retry-After")).toBe("30");
    expect(withCors.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(withCors.headers.get("Access-Control-Expose-Headers")).toContain(
      "Retry-After",
    );

    const withVary = applyCorsHeaders(
      new Response("{}", {
        headers: {
          Vary: "Accept-Encoding",
          "Content-Type": "application/json",
        },
      }),
      new Request("https://example.test/", {
        headers: { Origin: ALLOWED_ORIGIN },
      }),
      { allowedOrigins: [ALLOWED_ORIGIN] },
    );

    expect(withVary.headers.get("Vary")).toContain("Accept-Encoding");
    expect(withVary.headers.get("Vary")).toContain("Origin");
  });

  it("未設定時・Origin なし・不許可 Origin に回帰がない", async () => {
    const withoutCors = defineFlareLobby(createBaseConfiguration());
    const plainWorker = withoutCors.createGatewayWorker<Env>();

    const preflightWithoutConfig = await plainWorker.fetch(
      createPreflightRequest(ALLOWED_ORIGIN) as never,
      env,
      {} as ExecutionContext,
    );
    // CORS 未設定時は既存挙動を維持し、プリフライト用の 204 を返さない。
    expect(preflightWithoutConfig.status).not.toBe(204);
    expect(
      preflightWithoutConfig.headers.get("Access-Control-Allow-Origin"),
    ).toBeNull();

    const withCors = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = withCors.createGatewayWorker<Env>();

    const withoutOrigin = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: "cors-no-origin" }),
      }) as never,
      env,
      {} as ExecutionContext,
    );
    expect(withoutOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const disallowed = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ requestId: "cors-disallowed" }),
      }) as never,
      env,
      {} as ExecutionContext,
    );
    expect(disallowed.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("WebSocket Upgrade の意味を変更しない", async () => {
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: {
        allowedOrigins: [ALLOWED_ORIGIN, ALLOWED_ORIGIN_WITH_PORT],
      },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const upgradeWithoutToken = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms/room-cors-ws/ws", {
        method: "GET",
        headers: {
          Upgrade: "websocket",
          Origin: ALLOWED_ORIGIN,
          "Sec-WebSocket-Protocol": "flarelobby.v1",
        },
      }) as never,
      env,
      {} as ExecutionContext,
    );

    // 参加トークンなしの Upgrade は従来どおり 401 で、CORS で 101 にしない。
    expect(upgradeWithoutToken.status).toBe(401);
    expect(
      upgradeWithoutToken.headers.get("Access-Control-Allow-Origin"),
    ).toBeNull();
  });

  it("非プリフライト OPTIONS を既存処理のまま扱う", async () => {
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const response = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms", {
        method: "OPTIONS",
        headers: { Origin: ALLOWED_ORIGIN },
      }) as never,
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
  });
});

describe("CORS と認証・再接続の両立", () => {
  it("許可 Origin の認証済み要求が引き続き成功する", async () => {
    const lobby = defineFlareLobby({
      ...createBaseConfiguration(),
      cors: { allowedOrigins: [ALLOWED_ORIGIN] },
    });
    const worker = lobby.createGatewayWorker<Env>();

    const response = await worker.fetch(
      new Request("https://example.test/v1/custom-rooms", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          authorization: "Bearer principal-cors",
          "content-type": "application/json",
        },
        body: JSON.stringify({ requestId: `cors-room-${crypto.randomUUID()}` }),
      }) as never,
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
  });

  it("Gateway 主体証明の発行が CORS 有効時も成功する", async () => {
    const envelope = await createGatewayPrincipalEnvelope(
      env.FLARE_LOBBY_TOKEN_SECRET,
      { id: "principal-cors", playerId: "player-cors" },
    );

    expect(envelope.ok).toBe(true);
  });
});
