import { describe, expect, it } from "vitest";

import {
  FlareLobbyConfigurationError,
  createGatewayWorker,
  defineFlareLobby,
} from "../src/index.js";
import type {
  FlareLobbyBindings,
  FlareLobbyConfigurationErrorCode,
} from "../src/index.js";

function createValidConfiguration() {
  return {
    customRooms: {
      maxPlayers: 4,
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
      },
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
