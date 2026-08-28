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
  verifyResumeToken,
  verifyWebSocketJoinToken,
  verifyWebSocketResumeToken,
  verifyWebSocketRoomToken,
  verifyGatewayPrincipalEnvelope,
  createGatewayPrincipalEnvelope,
  authenticateRequest,
  readWebSocketJoinToken,
} from "../src/index.js";
import { FlareLobbyError } from "@flarelobby/core";
import {
  createErrorResponse,
  createRateLimitError,
  readGatewayToken,
} from "../src/security.js";
import type {
  ClientCommandEnvelope,
  Principal,
  ProtocolResult,
} from "@flarelobby/core";

// 署名には Wrangler Secret と同じ Binding 値を使い、実環境と一致させる。
const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;

function expectProtocolValue<TValue>(result: ProtocolResult<TValue>): TValue {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function expectProtocolError<TValue>(
  result: ProtocolResult<TValue>,
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "INVALID_MESSAGE"
    | "INVALID_PAYLOAD"
    | "CONFLICT",
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
      body: JSON.stringify({ playerId: "client-claimed-player" }),
    }),
    () => principal,
    TOKEN_SECRET,
  );
}

// 検証の拒否経路を直接作り込むため、署名形式を再現するヘルパー。
const TOKEN_SIGNATURE_CONTEXT = "flarelobby-token-v1";

function encodeBase64UrlForTest(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function signEncodedPayload(
  encodedPayload: string,
  tokenSecret = TOKEN_SECRET,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${TOKEN_SIGNATURE_CONTEXT}.${encodedPayload}`),
  );

  return `${encodedPayload}.${encodeBase64UrlForTest(new Uint8Array(signature))}`;
}

async function craftSignedToken(payload: unknown): Promise<string> {
  return signEncodedPayload(
    encodeBase64UrlForTest(new TextEncoder().encode(JSON.stringify(payload))),
  );
}

describe("認証・認可・入力検証・利用制限の共通基盤", () => {
  it("未認証要求を Gateway Worker の保護対象パスで拒否する", async () => {
    const response = await SELF.fetch("https://example.test/rooms", {
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
      message: "認証が必要です。",
    });
  });

  it("クライアント申告の playerId ではなく認証 Hook の主体を正規化する", async () => {
    const principal = {
      id: "principal-trusted",
      playerId: "player-trusted",
    } as const;
    const authenticated = expectProtocolValue(
      await createAuthenticatedRequest(principal),
    );

    expect(authenticated.principal).toEqual(principal);
    expect(authenticated.principal.playerId).not.toBe("client-claimed-player");

    const room = env.FLARE_LOBBY_ROOMS.getByName(
      `security-room-${crypto.randomUUID()}`,
    );
    const matchPool = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      `security-pool-${crypto.randomUUID()}`,
    );

    await expect(
      room.resolveGatewayPrincipal(authenticated.gatewayPrincipal),
    ).resolves.toEqual(principal);
    await expect(
      matchPool.resolveGatewayPrincipal(authenticated.gatewayPrincipal),
    ).resolves.toEqual(principal);

    const token = authenticated.gatewayPrincipal.token;
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(
      room.resolveGatewayPrincipal({ token: tampered }),
    ).resolves.toBeNull();
  });

  it("認可 Hook は利用者が差し替えられ、未設定時は安全側に拒否する", async () => {
    const authenticated = expectProtocolValue(
      await createAuthenticatedRequest({
        id: "principal-authorized",
        playerId: "player-authorized",
      }),
    );

    expectProtocolError(
      await authorizeGatewayOperation(authenticated, undefined, {
        operation: "join",
        roomId: "room-1",
      }),
      "FORBIDDEN",
    );

    const allowed = await authorizeGatewayOperation(
      authenticated,
      {
        authorizeJoin: async (context) =>
          context.principal.id === "principal-authorized" &&
          context.roomId === "room-1",
      },
      {
        operation: "join",
        roomId: "room-1",
      },
    );

    expectProtocolValue(allowed);
  });

  it("HTTP 本文、Query、WebSocket コマンドを共通の安定したエラーで検証する", async () => {
    const body = await readValidatedJsonBody(
      new Request("https://example.test/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "練習部屋" }),
      }),
      256,
      (value): value is { title: string } =>
        isRecord(value) && typeof value["title"] === "string",
    );

    expectProtocolValue(body);

    const malformedBody = await readValidatedJsonBody(
      new Request("https://example.test/rooms", {
        method: "POST",
        body: "{invalid-json",
      }),
      256,
      (value): value is { title: string } =>
        isRecord(value) && typeof value["title"] === "string",
    );

    expectProtocolError(malformedBody, "INVALID_MESSAGE");

    const oversizedBody = await readValidatedJsonBody(
      new Request("https://example.test/rooms", {
        method: "POST",
        body: JSON.stringify({ title: "x".repeat(256) }),
      }),
      32,
      (value): value is { title: string } =>
        isRecord(value) && typeof value["title"] === "string",
    );

    expectProtocolError(oversizedBody, "INVALID_MESSAGE");

    const invalidQuery = validateQuery(
      new Request("https://example.test/rooms?limit=not-a-number"),
      (value): value is URLSearchParams =>
        value instanceof URLSearchParams &&
        /^\d+$/u.test(value.get("limit") ?? ""),
    );

    expectProtocolError(invalidQuery, "INVALID_PAYLOAD");

    const command: ClientCommandEnvelope = {
      protocolVersion: 1,
      kind: "command",
      requestId: "request-security-1",
      command: "room.set_ready",
      payload: { ready: true },
    };
    const validWebSocketCommand = validateWebSocketCommand(
      JSON.stringify(command),
      1_024,
      (value): value is ClientCommandEnvelope =>
        isRecord(value) &&
        isRecord(value["payload"]) &&
        value["payload"]["ready"] === true,
    );

    expectProtocolValue(validWebSocketCommand);

    const oversizedWebSocketCommand = validateWebSocketCommand(
      "x".repeat(1_025),
      1_024,
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
        now: 1_000,
      }),
    );
    const anotherToken = expectProtocolValue(
      await issueJoinToken(TOKEN_SECRET, {
        principal,
        roomId: "room-token",
        expiresAt: 2_000,
        now: 1_000,
      }),
    );

    expect(anotherToken).not.toBe(token);

    expectProtocolValue(
      await verifyJoinToken(TOKEN_SECRET, token, {
        principal,
        roomId: "room-token",
        now: 1_500,
      }),
    );

    expectProtocolError(
      await verifyResumeToken(TOKEN_SECRET, token, {
        principal,
        roomId: "room-token",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );

    const resumeToken = expectProtocolValue(
      await issueResumeToken(TOKEN_SECRET, {
        principal,
        roomId: "room-token",
        expiresAt: 2_000,
        now: 1_000,
      }),
    );

    expectProtocolValue(
      await verifyResumeToken(TOKEN_SECRET, resumeToken, {
        principal,
        roomId: "room-token",
        now: 1_500,
      }),
    );

    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, token, {
        principal: { id: "different-principal", playerId: "different-player" },
        roomId: "room-token",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, token, {
        principal,
        roomId: "room-token",
        now: 2_000,
      }),
      "UNAUTHENTICATED",
    );

    const spectatorToken = expectProtocolValue(
      await issueJoinToken(TOKEN_SECRET, {
        principal,
        roomId: "room-token",
        role: "spectator",
        participantId: "participant-token",
        expiresAt: 2_000,
        now: 1_000,
      }),
    );

    expectProtocolValue(
      await verifyJoinToken(TOKEN_SECRET, spectatorToken, {
        principal,
        roomId: "room-token",
        role: "spectator",
        participantId: "participant-token",
        now: 1_500,
      }),
    );
    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, spectatorToken, {
        principal,
        roomId: "room-token",
        role: "player",
        participantId: "participant-token",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, spectatorToken, {
        principal,
        roomId: "room-token",
        role: "spectator",
        participantId: "different-participant",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );

    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, tampered, {
        principal,
        roomId: "room-token",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
  });

  it("メッセージとルーム作成を主体ごとの Durable Object で制限する", async () => {
    const limits = {
      maxHttpRequestBytes: 1_024,
      maxWebSocketMessageBytes: 1_024,
      maxMessagesPerMinute: 2,
      maxRoomCreationsPerMinute: 1,
    } as const;
    const firstPrincipal = expectProtocolValue(
      await createAuthenticatedRequest({
        id: `principal-rate-${crypto.randomUUID()}`,
        playerId: "player-rate-1",
      }),
    );
    const secondPrincipal = expectProtocolValue(
      await createAuthenticatedRequest({
        id: `principal-rate-${crypto.randomUUID()}`,
        playerId: "player-rate-2",
      }),
    );

    expectProtocolValue(
      await consumeWebSocketMessageRateLimit(env, firstPrincipal, limits),
    );
    expectProtocolValue(
      await consumeWebSocketMessageRateLimit(env, firstPrincipal, limits),
    );
    expectProtocolError(
      await consumeWebSocketMessageRateLimit(env, firstPrincipal, limits),
      "CONFLICT",
    );
    expectProtocolValue(
      await consumeWebSocketMessageRateLimit(env, secondPrincipal, limits),
    );

    expectProtocolValue(
      await consumeRoomCreationRateLimit(env, firstPrincipal, limits),
    );
    expectProtocolError(
      await consumeRoomCreationRateLimit(env, firstPrincipal, limits),
      "CONFLICT",
    );
  });

  it("利用制限の CONFLICT を HTTP 429 と Retry-After へ変換する", () => {
    const response = createErrorResponse(
      createRateLimitError(30, "要求が許可された頻度を超えています。"),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("利用制限以外の CONFLICT は従来どおり HTTP 400 を返す", async () => {
    const response = createErrorResponse(new FlareLobbyError("CONFLICT"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Retry-After")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      code: "CONFLICT",
      message: "現在の状態と競合しました。",
    });
  });

  it("認証 Hook の例外と不正な戻り値を未認証として扱う", async () => {
    expectProtocolError(
      await authenticateGatewayRequest(
        new Request("https://example.test/rooms", { method: "POST" }),
        () => {
          throw new Error("認証実装の内部エラー");
        },
        TOKEN_SECRET,
      ),
      "UNAUTHENTICATED",
    );

    expectProtocolError(
      await authenticateRequest(
        new Request("https://example.test/rooms", { method: "POST" }),
        () => ({ id: "principal-id-only" }) as unknown as Principal,
      ).then((principal) =>
        principal === null
          ? ({
              ok: false,
              error: new FlareLobbyError("UNAUTHENTICATED"),
            } as const)
          : ({ ok: true, value: principal } as const),
      ),
      "UNAUTHENTICATED",
    );

    const authenticated = expectProtocolValue(
      await createAuthenticatedRequest({
        id: "principal-valid",
        playerId: "player-valid",
      }),
    );
    expect(authenticated.principal).toEqual({
      id: "principal-valid",
      playerId: "player-valid",
    });

    // Secret が利用できない場合は署名を作らず失敗を返します。
    expectProtocolError(
      await authenticateGatewayRequest(
        new Request("https://example.test/rooms", { method: "POST" }),
        () => ({ id: "principal-valid", playerId: "player-valid" }),
        "",
      ),
      "UNAUTHENTICATED",
    );

    expectProtocolError(
      await createGatewayPrincipalEnvelope(TOKEN_SECRET, {
        id: "",
        playerId: "player-empty-id",
      }),
      "UNAUTHENTICATED",
    );
  });

  it("署名済み Gateway 主体証明の形式と期限を検証で拒否する", async () => {
    const principal = { id: "principal-envelope", playerId: "player-envelope" };
    const envelope = expectProtocolValue(
      await createGatewayPrincipalEnvelope(TOKEN_SECRET, principal, 1_000),
    );

    await expect(
      verifyGatewayPrincipalEnvelope(TOKEN_SECRET, envelope, 1_500),
    ).resolves.toEqual(principal);
    await expect(
      verifyGatewayPrincipalEnvelope(TOKEN_SECRET, envelope, 1_000 + 60_000),
    ).resolves.toBeNull();
    await expect(
      verifyGatewayPrincipalEnvelope(TOKEN_SECRET, {} as never, 1_500),
    ).resolves.toBeNull();
    await expect(
      verifyGatewayPrincipalEnvelope(TOKEN_SECRET, { token: "" }, 1_500),
    ).resolves.toBeNull();
    await expect(
      verifyGatewayPrincipalEnvelope(
        TOKEN_SECRET,
        { token: "segment-without-dot" },
        1_500,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyGatewayPrincipalEnvelope(`${TOKEN_SECRET}-wrong`, envelope, 1_500),
    ).resolves.toBeNull();
  });

  it("参加・再開トークンの発行入力を検証して INVALID_PAYLOAD で拒否する", async () => {
    const principal = { id: "principal-issue", playerId: "player-issue" };
    const base = {
      principal,
      roomId: "room-issue",
      expiresAt: 2_000,
      now: 1_000,
    } as const;

    expectProtocolError(
      await issueJoinToken(TOKEN_SECRET, { ...base, expiresAt: 1_000 }),
      "INVALID_PAYLOAD",
    );
    expectProtocolError(
      await issueJoinToken(TOKEN_SECRET, {
        ...base,
        role: "admin" as never,
      }),
      "INVALID_PAYLOAD",
    );
    expectProtocolError(
      await issueJoinToken(TOKEN_SECRET, { ...base, participantId: "" }),
      "INVALID_PAYLOAD",
    );
    expectProtocolError(
      await issueJoinToken(TOKEN_SECRET, { ...base, nonce: "x".repeat(257) }),
      "INVALID_PAYLOAD",
    );
    expectProtocolError(await issueResumeToken("", base), "INVALID_PAYLOAD");
    expectProtocolError(
      await issueResumeToken(TOKEN_SECRET, { ...base, roomId: "" }),
      "INVALID_PAYLOAD",
    );
    expectProtocolError(
      await issueResumeToken(TOKEN_SECRET, {
        ...base,
        principal: { id: "principal-issue", playerId: "" },
      }),
      "INVALID_PAYLOAD",
    );
  });

  it("WebSocket 用トークンは用途と期待値まで照合して検証する", async () => {
    const principal = { id: "principal-ws", playerId: "player-ws" };
    const joinToken = expectProtocolValue(
      await issueJoinToken(TOKEN_SECRET, {
        principal,
        roomId: "room-ws",
        expiresAt: 2_000,
        now: 1_000,
      }),
    );
    const resumeToken = expectProtocolValue(
      await issueResumeToken(TOKEN_SECRET, {
        principal,
        roomId: "room-ws",
        expiresAt: 2_000,
        now: 1_000,
      }),
    );

    const joinClaims = expectProtocolValue(
      await verifyWebSocketJoinToken(TOKEN_SECRET, joinToken, {
        roomId: "room-ws",
        now: 1_500,
      }),
    );
    expect(joinClaims.purpose).toBe("join");
    expect(joinClaims.principalId).toBe("principal-ws");
    expect(joinClaims.role).toBe("player");
    expect(Object.isFrozen(joinClaims)).toBe(true);

    expectProtocolError(
      await verifyWebSocketJoinToken(TOKEN_SECRET, resumeToken, {
        roomId: "room-ws",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
    const resumeClaims = expectProtocolValue(
      await verifyWebSocketResumeToken(TOKEN_SECRET, resumeToken, {
        roomId: "room-ws",
        now: 1_500,
      }),
    );
    expect(resumeClaims.purpose).toBe("resume");

    // 両対応の検証では join を先に試行し、不成功なら resume へフォールバックします。
    expectProtocolValue(
      await verifyWebSocketRoomToken(TOKEN_SECRET, joinToken, {
        roomId: "room-ws",
        now: 1_500,
      }),
    );
    const fallbackClaims = expectProtocolValue(
      await verifyWebSocketRoomToken(TOKEN_SECRET, resumeToken, {
        roomId: "room-ws",
        now: 1_500,
      }),
    );
    expect(fallbackClaims.purpose).toBe("resume");

    expectProtocolError(
      await verifyWebSocketJoinToken(TOKEN_SECRET, joinToken, {
        roomId: "other-room",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      await verifyWebSocketJoinToken(TOKEN_SECRET, joinToken, {
        roomId: "room-ws",
        now: 2_000,
      }),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      await verifyWebSocketJoinToken(TOKEN_SECRET, joinToken, {
        roomId: "room-ws",
        role: "spectator",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      await verifyWebSocketJoinToken(TOKEN_SECRET, "", {
        roomId: "",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      await verifyWebSocketJoinToken(`${TOKEN_SECRET}-wrong`, joinToken, {
        roomId: "room-ws",
        now: 1_500,
      }),
      "UNAUTHENTICATED",
    );
  });

  it("WebSocket subprotocol の参加トークン読み取りを境界まで検証する", async () => {
    const prefix = "flarelobby.auth.";
    const token = "join-token-payload";
    const encoded = encodeBase64UrlForTest(new TextEncoder().encode(token));

    // 正常系: 他プロトコルが混在しても認証用は 1 つだけ取り出します。
    const valid = readWebSocketJoinToken(
      new Request("https://example.test/ws", {
        headers: { "Sec-WebSocket-Protocol": `chat, ${prefix}${encoded}` },
      }),
    );
    if (!valid.ok || valid.value !== token) {
      throw new Error("正常な subprotocol から参加トークンを読み取れません。");
    }

    expectProtocolError(
      readWebSocketJoinToken(new Request("https://example.test/ws")),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      readWebSocketJoinToken(
        new Request("https://example.test/ws", {
          headers: { "Sec-WebSocket-Protocol": "chat" },
        }),
      ),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      readWebSocketJoinToken(
        new Request("https://example.test/ws", {
          headers: {
            "Sec-WebSocket-Protocol": `${prefix}${encoded}, ${prefix}${encoded}`,
          },
        }),
      ),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      readWebSocketJoinToken(
        new Request("https://example.test/ws", {
          headers: { "Sec-WebSocket-Protocol": prefix },
        }),
      ),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      readWebSocketJoinToken(
        new Request("https://example.test/ws", {
          headers: { "Sec-WebSocket-Protocol": `${prefix}!!!` },
        }),
      ),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      readWebSocketJoinToken(
        new Request("https://example.test/ws", {
          headers: { "Sec-WebSocket-Protocol": `${prefix}ab` },
        }),
      ),
      "UNAUTHENTICATED",
    );
    expectProtocolError(
      readWebSocketJoinToken(
        new Request("https://example.test/ws", {
          headers: {
            "Sec-WebSocket-Protocol": `${prefix}${encodeBase64UrlForTest(
              Uint8Array.of(0xff),
            )}`,
          },
        }),
      ),
      "UNAUTHENTICATED",
    );
  });

  it("Gateway 転送トークンの読み取りは内部ヘッダーと Bearer の両方を受け付ける", () => {
    expect(
      readGatewayToken(
        new Request("https://example.test/events", {
          headers: { "x-flarelobby-gateway-token": "direct-token" },
        }),
      ),
    ).toBe("direct-token");
    expect(
      readGatewayToken(
        new Request("https://example.test/events", {
          headers: { authorization: "Bearer bearer-token" },
        }),
      ),
    ).toBe("bearer-token");
    expect(
      readGatewayToken(
        new Request("https://example.test/events", {
          headers: { authorization: "Bearer " },
        }),
      ),
    ).toBeNull();
    expect(
      readGatewayToken(new Request("https://example.test/events")),
    ).toBeNull();
  });

  it("改竄や形式不正の署名済みトークンを検証で拒否する", async () => {
    const principal = { id: "principal-parse", playerId: "player-parse" };
    const options = {
      principal,
      roomId: "room-parse",
      now: 1_500,
    } as const;

    // セグメント数が不正なトークン。
    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, "no-signature-segment", options),
      "UNAUTHENTICATED",
    );
    // 署名セグメントが base64url として不正。
    expectProtocolError(
      await verifyJoinToken(TOKEN_SECRET, "cGF5bG9hZA.!!!", options),
      "UNAUTHENTICATED",
    );
    // 署名は正しいが payload 部が base64url として不正。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await signEncodedPayload("!!!"),
        options,
      ),
      "UNAUTHENTICATED",
    );
    // 署名は正しいが payload が UTF-8 として解釈できない。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await signEncodedPayload(encodeBase64UrlForTest(Uint8Array.of(0xff))),
        options,
      ),
      "UNAUTHENTICATED",
    );
    // version 不一致。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await craftSignedToken({ kind: "room" }),
        options,
      ),
      "UNAUTHENTICATED",
    );
    // room ペイロードの必須クレーム不正。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await craftSignedToken({
          version: 1,
          kind: "room",
          purpose: "join",
          principalId: "principal-parse",
          roomId: "room-parse",
          expiresAt: "soon",
          nonce: "nonce",
        }),
        options,
      ),
      "UNAUTHENTICATED",
    );
    // purpose 不正。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await craftSignedToken({
          version: 1,
          kind: "room",
          purpose: "other",
          role: "player",
          principalId: "principal-parse",
          roomId: "room-parse",
          expiresAt: 2_000,
          nonce: "nonce",
        }),
        options,
      ),
      "UNAUTHENTICATED",
    );
    // gateway ペイロードの playerId 欠落。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await craftSignedToken({
          version: 1,
          kind: "gateway",
          principalId: "principal-parse",
          expiresAt: 2_000,
          nonce: "nonce",
        }),
        options,
      ),
      "UNAUTHENTICATED",
    );
    // 既知外の kind。
    expectProtocolError(
      await verifyJoinToken(
        TOKEN_SECRET,
        await craftSignedToken({
          version: 1,
          kind: "unknown",
          principalId: "principal-parse",
          expiresAt: 2_000,
          nonce: "nonce",
        }),
        options,
      ),
      "UNAUTHENTICATED",
    );
  });

  it("要求本文と WebSocket メッセージのサイズ境界を検査する", async () => {
    expectProtocolError(
      await readValidatedJsonBody(
        new Request("https://example.test/rooms", { method: "POST" }),
        0,
        (value): value is Record<string, unknown> => isRecord(value),
      ),
      "INVALID_MESSAGE",
    );

    // 本文なしの要求は空バイト列になり、JSON としては不正扱いです。
    expectProtocolError(
      await readValidatedJsonBody(
        new Request("https://example.test/rooms", { method: "GET" }),
        256,
        (value): value is Record<string, unknown> => isRecord(value),
      ),
      "INVALID_MESSAGE",
    );

    // content-length の申告が上限を超える本文は読む前に拒否します。
    expectProtocolError(
      await readValidatedJsonBody(
        new Request("https://example.test/rooms", {
          method: "POST",
          headers: { "content-length": "4096" },
          body: "{}",
        }),
        256,
        (value): value is Record<string, unknown> => isRecord(value),
      ),
      "INVALID_MESSAGE",
    );

    // ストリームが途中で失敗した場合も安全な失敗に変換します。
    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.error(new Error("stream failure"));
      },
    });
    expectProtocolError(
      await readValidatedJsonBody(
        new Request("https://example.test/rooms", {
          method: "POST",
          body: failingStream,
        }),
        256,
        (value): value is Record<string, unknown> => isRecord(value),
      ),
      "INVALID_MESSAGE",
    );

    // ArrayBuffer 入力は上限・UTF-8・JSON の順に検証します。
    const commandBytes = new TextEncoder().encode(
      JSON.stringify({
        protocolVersion: 1,
        kind: "command",
        requestId: "request-security-ab",
        command: "room.set_ready",
        payload: { ready: true },
      }),
    );
    expectProtocolValue(
      validateWebSocketCommand(commandBytes.buffer as ArrayBuffer, 1_024),
    );
    expectProtocolError(
      validateWebSocketCommand(
        new Uint8Array(1_025).buffer as ArrayBuffer,
        1_024,
      ),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateWebSocketCommand(
        Uint8Array.of(0xff).buffer as ArrayBuffer,
        1_024,
      ),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateWebSocketCommand(JSON.stringify({ kind: "command" }), 1_024),
      "INVALID_MESSAGE",
    );
  });

  it("認可 Hook の false と例外を権限不足として扱う", async () => {
    const authenticated = expectProtocolValue(
      await createAuthenticatedRequest({
        id: "principal-deny",
        playerId: "player-deny",
      }),
    );
    const target = { operation: "join" as const, roomId: "room-deny" };

    expectProtocolError(
      await authorizeGatewayOperation(
        authenticated,
        {
          authorizeJoin: () => false,
        },
        target,
      ),
      "FORBIDDEN",
    );
    expectProtocolError(
      await authorizeGatewayOperation(
        authenticated,
        {
          authorizeJoin: () => {
            throw new Error("認可実装の内部エラー");
          },
        },
        target,
      ),
      "FORBIDDEN",
    );
  });
});
