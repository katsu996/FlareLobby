import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  authenticateGatewayRequest,
  authorizeGatewayOperation,
  consumeRoomCreationRateLimit,
  consumeWebSocketMessageRateLimit,
  issueJoinToken,
  issueResumeToken,
  readValidatedJsonBody,
  validateQuery,
  validateWebSocketCommand,
  verifyJoinToken,
  verifyResumeToken
} from "../src/index.js";
import type {
  ClientCommandEnvelope,
  Principal,
  ProtocolResult
} from "@flarelobby/core";

const TOKEN_SECRET = "flarelobby-test-token-secret";

function expectProtocolValue<TValue>(result: ProtocolResult<TValue>): TValue {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function expectProtocolError<TValue>(
  result: ProtocolResult<TValue>,
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_MESSAGE" | "INVALID_PAYLOAD" | "CONFLICT"
): void {
  expect(result.ok).toBe(false);

  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createAuthenticatedRequest(principal: Principal) {
  return authenticateGatewayRequest(
    new Request("https://example.test/rooms", {
      method: "POST",
      body: JSON.stringify({ playerId: "client-claimed-player" })
    }),
    () => principal,
    TOKEN_SECRET
  );
}

describe("認証・認可・入力検証・利用制限の共通基盤", () => {
  it("未認証要求を Gateway Worker の保護対象パスで拒否する", async () => {
    const response = await SELF.fetch("https://example.test/rooms", {
      method: "POST"
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
      message: "認証が必要です。"
    });
  });

  it("クライアント申告の playerId ではなく認証 Hook の主体を正規化する", async () => {
    const principal = {
      id: "principal-trusted",
      playerId: "player-trusted"
    } as const;
    const authenticated = expectProtocolValue(
      await createAuthenticatedRequest(principal)
    );

    expect(authenticated.principal).toEqual(principal);
    expect(authenticated.principal.playerId).not.toBe("client-claimed-player");

    const room = env.FLARE_LOBBY_ROOMS.getByName(
      `security-room-${crypto.randomUUID()}`
    );
    const matchPool = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      `security-pool-${crypto.randomUUID()}`
    );

    await expect(
      room.resolveGatewayPrincipal(authenticated.gatewayPrincipal)
    ).resolves.toEqual(principal);
    await expect(
      matchPool.resolveGatewayPrincipal(authenticated.gatewayPrincipal)
    ).resolves.toEqual(principal);

    const token = authenticated.gatewayPrincipal.token;
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(
      room.resolveGatewayPrincipal({ token: tampered })
    ).resolves.toBeNull();
  });

  it("認可 Hook は利用者が差し替えられ、未設定時は安全側に拒否する", async () => {
    const authenticated = expectProtocolValue(
      await createAuthenticatedRequest({
        id: "principal-authorized",
        playerId: "player-authorized"
      })
    );

    expectProtocolError(
      await authorizeGatewayOperation(authenticated, undefined, {
        operation: "join",
        roomId: "room-1"
      }),
      "FORBIDDEN"
    );

    const allowed = await authorizeGatewayOperation(
      authenticated,
      {
        authorizeJoin: async (context) =>
          context.principal.id === "principal-authorized" &&
          context.roomId === "room-1"
      },
      {
        operation: "join",
        roomId: "room-1"
      }
    );

    expectProtocolValue(allowed);
  });

  it("HTTP 本文、Query、WebSocket コマンドを共通の安定したエラーで検証する", async () => {
    const body = await readValidatedJsonBody(
      new Request("https://example.test/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "練習部屋" })
      }),
      256,
      (value): value is { title: string } =>
        isRecord(value) && typeof value["title"] === "string"
    );

    expectProtocolValue(body);

    const malformedBody = await readValidatedJsonBody(
      new Request("https://example.test/rooms", {
        method: "POST",
        body: "{invalid-json"
      }),
      256,
      (value): value is { title: string } =>
        isRecord(value) && typeof value["title"] === "string"
    );

    expectProtocolError(malformedBody, "INVALID_MESSAGE");

    const oversizedBody = await readValidatedJsonBody(
      new Request("https://example.test/rooms", {
        method: "POST",
        body: JSON.stringify({ title: "x".repeat(256) })
      }),
      32,
      (value): value is { title: string } =>
        isRecord(value) && typeof value["title"] === "string"
    );

    expectProtocolError(oversizedBody, "INVALID_MESSAGE");

    const invalidQuery = validateQuery(
      new Request("https://example.test/rooms?limit=not-a-number"),
      (value): value is URLSearchParams =>
        value instanceof URLSearchParams && /^\d+$/u.test(value.get("limit") ?? "")
    );

    expectProtocolError(invalidQuery, "INVALID_PAYLOAD");

    const command: ClientCommandEnvelope = {
      protocolVersion: 1,
      kind: "command",
      requestId: "request-security-1",
      command: "room.set_ready",
      payload: { ready: true }
    };
    const validWebSocketCommand = validateWebSocketCommand(
      JSON.stringify(command),
      1_024,
      (value): value is ClientCommandEnvelope =>
        isRecord(value) &&
        isRecord(value["payload"]) &&
        value["payload"]["ready"] === true
    );

    expectProtocolValue(validWebSocketCommand);

    const oversizedWebSocketCommand = validateWebSocketCommand(
      "x".repeat(1_025),
      1_024
    );

    expectProtocolError(oversizedWebSocketCommand, "INVALID_MESSAGE");
  });

  it("参加用・再開用トークンを期限、用途、主体、署名まで検証する", async () => {
    const principal = { id: "principal-token", playerId: "player-token" };
    const token = expectProtocolValue(
      await issueJoinToken(TOKEN_SECRET, {
        principal,
        roomId: "room-token",
        expiresAt: 2_000,
        now: 1_000
      })
    );
    const anotherToken = expectProtocolValue(
      await issueJoinToken(TOKEN_SECRET, {
        principal,
        roomId: "room-token",
        expiresAt: 2_000,
        now: 1_000
      })
    );

    expect(anotherToken).not.toBe(token);

    expectProtocolValue(
      await verifyJoinToken(TOKEN_SECRET, token, {
        principal,
        roomId: "room-token",
        now: 1_500
      })
    );

    expectProtocolError(
      await verifyResumeToken(TOKEN_SECRET, token, {
        principal,
        roomId: "room-token",
        now: 1_500
      }),
      "UNAUTHENTICATED"
    );

    const resumeToken = expectProtocolValue(
      await issueResumeToken(TOKEN_SECRET, {
        principal,
        roomId: "room-token",
        expiresAt: 2_000,
        now: 1_000
      })
    );

    expectProtocolValue(
      await verifyResumeToken(TOKEN_SECRET, resumeToken, {
        principal,
        roomId: "room-token",
        now: 1_500
      })
    );

    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, token, {
        principal: { id: "different-principal", playerId: "different-player" },
        roomId: "room-token",
        now: 1_500
      }),
      "UNAUTHENTICATED"
    );
    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, token, {
        principal,
        roomId: "room-token",
        now: 2_000
      }),
      "UNAUTHENTICATED"
    );

    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, tampered, {
        principal,
        roomId: "room-token",
        now: 1_500
      }),
      "UNAUTHENTICATED"
    );
  });

  it("メッセージとルーム作成を主体ごとの Durable Object で制限する", async () => {
    const limits = {
      maxHttpRequestBytes: 1_024,
      maxWebSocketMessageBytes: 1_024,
      maxMessagesPerMinute: 2,
      maxRoomCreationsPerMinute: 1
    } as const;
    const firstPrincipal = expectProtocolValue(
      await createAuthenticatedRequest({
        id: `principal-rate-${crypto.randomUUID()}`,
        playerId: "player-rate-1"
      })
    );
    const secondPrincipal = expectProtocolValue(
      await createAuthenticatedRequest({
        id: `principal-rate-${crypto.randomUUID()}`,
        playerId: "player-rate-2"
      })
    );

    expectProtocolValue(
      await consumeWebSocketMessageRateLimit(env, firstPrincipal, limits)
    );
    expectProtocolValue(
      await consumeWebSocketMessageRateLimit(env, firstPrincipal, limits)
    );
    expectProtocolError(
      await consumeWebSocketMessageRateLimit(env, firstPrincipal, limits),
      "CONFLICT"
    );
    expectProtocolValue(
      await consumeWebSocketMessageRateLimit(env, secondPrincipal, limits)
    );

    expectProtocolValue(
      await consumeRoomCreationRateLimit(env, firstPrincipal, limits)
    );
    expectProtocolError(
      await consumeRoomCreationRateLimit(env, firstPrincipal, limits),
      "CONFLICT"
    );
  });
});
