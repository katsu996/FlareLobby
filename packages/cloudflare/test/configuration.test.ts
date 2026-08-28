import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  FlareLobbyConfigurationError,
  createGatewayWorker,
  defineFlareLobby,
  issueResumeToken,
} from "../src/index.js";
import type {
  FlareLobbyBindings,
  FlareLobbyConfigurationErrorCode,
  MatchmakingPoolConfiguration,
} from "../src/index.js";

function createValidConfiguration() {
  return {
    customRooms: {
      maxPlayers: 4,
      maxSpectators: 2,
      defaultSettings: {
        map: "forest",
      },
      finishedRoomRetentionMs: 60_000,
    },
    matchmakingPools: [
      {
        id: "ranked-1v1-jp",
        gameId: "example-game",
        seasonId: "season-1",
        mode: "ranked-1v1",
        region: "jp",
      } as MatchmakingPoolConfiguration,
    ],
    authenticate: () => ({
      id: "principal-1",
      playerId: "player-1",
    }),
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
  };
}

function expectConfigurationError(
  action: () => unknown,
  code: FlareLobbyConfigurationErrorCode,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FlareLobbyConfigurationError);
    expect((error as FlareLobbyConfigurationError).code).toBe(code);
    return;
  }

  throw new Error("設定エラーが送出されることを期待しました。");
}

describe("defineFlareLobby", () => {
  it("設定ごとに共有する可変状態を持たない Gateway Worker 定義を作る", () => {
    const first = defineFlareLobby(createValidConfiguration());
    const second = defineFlareLobby(createValidConfiguration());

    expect(first).not.toBe(second);
    expect(first.configuration).not.toBe(second.configuration);
    expect(Object.isFrozen(first.configuration)).toBe(true);
    expect(Object.isFrozen(first.configuration.matchmakingPools)).toBe(true);
  });

  it("不正なプール定義を安定したエラーコードで拒否する", () => {
    const configuration = createValidConfiguration();
    const pool = configuration.matchmakingPools[0];

    if (pool === undefined) {
      throw new Error("検証用マッチングプールがありません。");
    }

    configuration.matchmakingPools[0] = {
      ...pool,
      region: "",
    };

    expectConfigurationError(
      () => defineFlareLobby(configuration),
      "INVALID_MATCHMAKING_POOL",
    );
  });

  it("同じマッチングプール ID の重複を拒否する", () => {
    const configuration = createValidConfiguration();
    const pool = configuration.matchmakingPools[0];

    if (pool === undefined) {
      throw new Error("検証用マッチングプールがありません。");
    }

    configuration.matchmakingPools.push({ ...pool });

    expectConfigurationError(
      () => defineFlareLobby(configuration),
      "INVALID_MATCHMAKING_POOL",
    );
  });

  it("ルーム作成頻度の上限が不正な設定を拒否する", () => {
    const configuration = createValidConfiguration();
    configuration.inputLimits.maxRoomCreationsPerMinute = 0;

    expectConfigurationError(
      () => defineFlareLobby(configuration),
      "INVALID_INPUT_LIMITS",
    );
  });

  it("終了済み Room の保持期間に負の値を指定できない", () => {
    const configuration = createValidConfiguration();
    configuration.customRooms.finishedRoomRetentionMs = -1;

    expectConfigurationError(
      () => defineFlareLobby(configuration),
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
    );
  });

  it("再接続関連の期間と履歴上限に不正な値を指定できない", () => {
    const invalidConfigurations = [
      { resumeTokenTtlMs: 0 },
      { disconnectGracePeriodMs: -1 },
      { eventHistoryLimit: 0 },
      { processedCommandRetentionMs: 0 },
    ] as const;

    for (const customRooms of invalidConfigurations) {
      const configuration = createValidConfiguration();
      configuration.customRooms = {
        ...configuration.customRooms,
        ...customRooms,
      };

      expectConfigurationError(
        () => defineFlareLobby(configuration),
        "INVALID_CUSTOM_ROOM_CONFIGURATION",
      );
    }
  });

  it("観測サンプリング率を 0 以上 1 以下に制限する", () => {
    const configuration = {
      ...createValidConfiguration(),
      observability: { logSampleRate: 1.1 },
    };

    expectConfigurationError(
      () => defineFlareLobby(configuration),
      "INVALID_OBSERVABILITY_CONFIGURATION",
    );
  });

  it("必須 D1 Binding の不足を安全なエラー応答として検出する", async () => {
    const worker = createGatewayWorker<FlareLobbyBindings>(
      createValidConfiguration(),
    );
    const response = await worker.fetch(
      new Request("https://example.test/"),
      {} as FlareLobbyBindings,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "D1_BINDING_MISSING",
      message:
        "FlareLobby の D1 Binding（FLARE_LOBBY_DB）が設定されていません。",
    });
  });
});

describe("Gateway Worker の設定検証", () => {
  it("認証 Hook が関数でない設定を拒否する", () => {
    const configuration = {
      ...createValidConfiguration(),
      authenticate: "not-a-function",
    } as unknown as Parameters<typeof createGatewayWorker>[0];

    expectConfigurationError(
      () => createGatewayWorker<FlareLobbyBindings>(configuration),
      "INVALID_AUTHENTICATION_HOOK",
    );
  });

  it("カスタムルームの定員設定に不正な値を指定できない", () => {
    const invalidPlayers = createValidConfiguration();
    invalidPlayers.customRooms.maxPlayers = 0;
    expectConfigurationError(
      () => createGatewayWorker<FlareLobbyBindings>(invalidPlayers),
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
    );

    const invalidSpectators = createValidConfiguration();
    invalidSpectators.customRooms.maxSpectators = -1;
    expectConfigurationError(
      () => createGatewayWorker<FlareLobbyBindings>(invalidSpectators),
      "INVALID_CUSTOM_ROOM_CONFIGURATION",
    );
  });

  it("検索ポリシーの正規化結果を設定へ反映し、不正値を拒否する", () => {
    const validConfiguration = createValidConfiguration();
    validConfiguration.matchmakingPools[0] = {
      ...validConfiguration.matchmakingPools[0]!,
      searchPolicy: {
        stages: [
          { afterMs: 0, maxRatingDifference: 50 },
          { afterMs: 1_000, maxRatingDifference: 150 },
        ],
      },
    };
    expect(() =>
      createGatewayWorker<FlareLobbyBindings>(validConfiguration),
    ).not.toThrow();

    const invalidConfiguration = createValidConfiguration();
    invalidConfiguration.matchmakingPools[0] = {
      ...invalidConfiguration.matchmakingPools[0]!,
      searchPolicy: {
        stages: [{ afterMs: 0, maxRatingDifference: 200 }],
        maxRatingDifference: 100,
      },
    };
    expectConfigurationError(
      () => createGatewayWorker<FlareLobbyBindings>(invalidConfiguration),
      "INVALID_MATCHMAKING_POOL",
    );
  });

  it("プールのレーティング設定に不正値を指定できない", () => {
    const configuration = createValidConfiguration();
    configuration.matchmakingPools[0] = {
      ...configuration.matchmakingPools[0]!,
      rating: { kFactor: "strong" } as never,
    };

    expectConfigurationError(
      () => createGatewayWorker<FlareLobbyBindings>(configuration),
      "INVALID_MATCHMAKING_POOL",
    );
  });

  it("必須 Binding の不足ごとに安定したエラーコードを返す", async () => {
    const worker = createGatewayWorker<FlareLobbyBindings>(
      createValidConfiguration(),
    );
    const missingBindings: readonly [keyof FlareLobbyBindings, string][] = [
      ["FLARE_LOBBY_ROOMS", "ROOM_DURABLE_OBJECT_BINDING_MISSING"],
      ["FLARE_LOBBY_MATCH_POOLS", "MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING"],
      ["FLARE_LOBBY_PARTIES", "PARTY_DURABLE_OBJECT_BINDING_MISSING"],
      [
        "FLARE_LOBBY_PARTY_MEMBERSHIPS",
        "PARTY_MEMBERSHIP_DURABLE_OBJECT_BINDING_MISSING",
      ],
      ["FLARE_LOBBY_TOKEN_SECRET", "TOKEN_SECRET_MISSING"],
    ];

    for (const [binding, code] of missingBindings) {
      const brokenEnv = { ...env } as FlareLobbyBindings;
      (brokenEnv as unknown as Record<string, unknown>)[binding] = undefined;
      const response = await worker.fetch(
        new Request("https://example.test/v1/custom-rooms"),
        brokenEnv,
        {} as ExecutionContext,
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ code });
    }
  });
});

describe("Gateway Worker の WebSocket Upgrade 経路", () => {
  const lobby = defineFlareLobby(createValidConfiguration());
  const worker = lobby.createGatewayWorker<FlareLobbyBindings>();
  const roomId = "room-configuration-ws";

  it("Upgrade ヘッダーのない要求を INVALID_MESSAGE で拒否する", async () => {
    const response = await worker.fetch(
      new Request(
        `https://example.test/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`,
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_MESSAGE",
    });
  });

  it("参加トークンのない Upgrade を拒否する", async () => {
    const response = await worker.fetch(
      new Request(
        `https://example.test/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`,
        {
          headers: { Upgrade: "websocket" },
        },
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("参加者識別子を持たないトークンでの Upgrade を拒否する", async () => {
    const token = await issueResumeToken(env.FLARE_LOBBY_TOKEN_SECRET, {
      principal: {
        id: "principal-no-participant",
        playerId: "player-no-participant",
      },
      roomId,
      expiresAt: Date.now() + 60_000,
    });

    if (!token.ok) {
      throw token.error;
    }

    const bytes = new TextEncoder().encode(token.value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    const encodedToken = btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const response = await worker.fetch(
      new Request(
        `https://example.test/v1/custom-rooms/${encodeURIComponent(roomId)}/ws`,
        {
          headers: {
            Upgrade: "websocket",
            "Sec-WebSocket-Protocol": `flarelobby.v1, flarelobby.auth.${encodedToken}`,
          },
        },
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("パーセントエンコーディングが不正な Room 経路を WebSocket 経路として扱わない", async () => {
    const response = await worker.fetch(
      new Request(
        "https://example.test/v1/custom-rooms/%zz/ws",
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    // WebSocket 経路として解釈されず、未知の経路として扱われます。
    expect(response.status).toBe(404);
  });
});
