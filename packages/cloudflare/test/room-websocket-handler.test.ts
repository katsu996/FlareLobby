import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { FlareLobbyError } from "@flarelobby/core";
import type { RoomSnapshot } from "@flarelobby/core";
import type { ParticipantRow, RoomRow } from "../src/room.js";
import {
  RoomWebSocketHandler,
  type RoomWebSocketDependencies,
} from "../src/room/RoomWebSocketHandler.js";

const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;
const NOW = "2026-08-11T00:00:00.000Z";

function roomRow(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    roomId: "room-1",
    kind: "custom",
    invitationCode: "ABC123",
    visibility: "public",
    matchId: null,
    poolJson: null,
    settingsJson: "{}",
    metadataJson: "{}",
    state: "waiting",
    stateStartedAt: NOW,
    revision: 2,
    hostParticipantId: "participant-1",
    hostPlayerId: "player-1",
    maxPlayers: 4,
    maxSpectators: 0,
    minimumPlayers: 1,
    requireAllPlayersReady: 1,
    joinMethod: "invitation",
    joinPasswordSalt: null,
    joinPasswordHash: null,
    finishedRoomRetentionMs: 0,
    createdAt: Date.parse(NOW),
    resumeTokenTtlMs: 3_600_000,
    disconnectGracePeriodMs: 30_000,
    eventHistoryLimit: 100,
    processedCommandRetentionMs: 60_000,
    ...overrides,
  } as RoomRow;
}

function participantRow(
  overrides: Partial<ParticipantRow> = {},
): ParticipantRow {
  return {
    participantId: "participant-1",
    kind: "player",
    playerId: "player-1",
    teamId: null,
    ready: 0,
    ...overrides,
  } as ParticipantRow;
}

function snapshot(): RoomSnapshot {
  return { revision: 2 } as unknown as RoomSnapshot;
}

function attachment() {
  return {
    version: 1,
    roomId: "room-1",
    principal: { id: "principal-1", playerId: "player-1" },
    participantId: "participant-1",
    role: "player",
    connectedAt: NOW,
    resumeId: "resume-1",
    connectionGeneration: "gen-1",
    maxWebSocketMessageBytes: 65536,
    maxMessagesPerMinute: 60,
  };
}

function joinClaims(overrides: Record<string, unknown> = {}) {
  return {
    participantId: "participant-1",
    role: "player" as const,
    purpose: "join" as const,
    principalId: "principal-1",
    roomId: "room-1",
    expiresAt: Date.now() + 3_600_000,
    nonce: "nonce-1",
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<RoomWebSocketDependencies> = {},
): RoomWebSocketDependencies {
  return {
    ctx: {
      acceptWebSocket: vi.fn(),
      blockConcurrencyWhile: async (fn: () => Promise<void>) => {
        await fn();
      },
    } as unknown as DurableObjectState,
    readRoomRow: () => roomRow(),
    readParticipantById: (id: string) =>
      id === "participant-1" ? participantRow() : undefined,
    readSnapshot: () => snapshot(),
    readRequiredSnapshot: () => snapshot(),
    readRoomConnection: () => undefined,
    readProcessedCommand: () => null,
    recordProcessedCommand: vi.fn(),
    exec: vi.fn(),
    synchronizeAlarm: vi.fn(async () => undefined),
    getNextAlarm: async () => null,
    storeWebSocketConnection: vi.fn(),
    markWebSocketDisconnected: vi.fn(async () => undefined),
    scheduleParticipantDisconnect: vi.fn(async () => undefined),
    expireDisconnectedParticipant: () => "noop" as const,
    cancelDisconnectOperation: vi.fn(),
    createRoomSnapshotEvent: (value: RoomSnapshot) =>
      ({
        protocolVersion: 1,
        kind: "event",
        event: "room.snapshot",
        revision: 2,
        payload: value,
      }) as never,
    broadcastRoomSnapshot: vi.fn(),
    broadcastProtocolMessage: vi.fn(),
    broadcastGameMessage: vi.fn(),
    recordRoomEvent: vi.fn(),
    readResumeEvents: () => ({ useSnapshot: true, events: [] }),
    setReady: vi.fn(async () => snapshot()),
    selectTeam: vi.fn(async () => snapshot()),
    updateSettings: vi.fn(async () => snapshot()),
    transferHost: vi.fn(async () => snapshot()),
    kick: vi.fn(async () => snapshot()),
    startMatch: vi.fn(async () => snapshot()),
    close: vi.fn(async () => snapshot()),
    scopeWebSocketRequestId: (
      _principalId: string,
      requestId: string | undefined,
    ) => requestId ?? "generated-request-id",
    issueResumeToken: vi.fn(async () => ({
      ok: true as const,
      value: "resume-token",
    })),
    joinParticipant: vi.fn(async () => snapshot()),
    readWebSocketJoinToken: () => ({ ok: true as const, value: "join-token" }),
    readWebSocketAttachment: () => attachment() as never,
    createWebSocketTags: () => ["room-1"],
    getWebSocketRoomId: () => "room-1",
    hasWebSocketProtocol: () => true,
    readLastRevision: () => ({ ok: true as const, value: 0 }),
    verifyWebSocketRoomToken: vi.fn(async () => ({
      ok: true as const,
      value: joinClaims(),
    })),
    validateWebSocketCommand: (message: string | ArrayBuffer) => {
      try {
        const value =
          typeof message === "string"
            ? JSON.parse(message)
            : JSON.parse("invalid");
        return { ok: true as const, value };
      } catch {
        return {
          ok: false as const,
          error: new FlareLobbyError("INVALID_MESSAGE"),
        };
      }
    },
    sendWebSocketFailure: vi.fn(),
    sendProtocolMessage: vi.fn(() => true),
    encodeProtocolMessage: (_message: never) => ({
      ok: true as const,
      value: "{}",
    }),
    normalizeWebSocketError: (error: unknown, requestId?: string) =>
      error instanceof FlareLobbyError
        ? error
        : new FlareLobbyError(
            "CONNECTION_FAILED",
            requestId === undefined ? {} : { requestId },
          ),
    closeWebSocketSafely: vi.fn(),
    requireJsonObject: (value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new FlareLobbyError("INVALID_PAYLOAD");
      }
      return value as Record<string, unknown>;
    },
    optionalString: (value: unknown) =>
      value === undefined || value === null
        ? undefined
        : typeof value === "string"
          ? value
          : (() => {
              throw new FlareLobbyError("INVALID_PAYLOAD");
            })(),
    isNonEmptyString: (value: unknown): value is string =>
      typeof value === "string" && value.length > 0,
    isPositiveSafeInteger: (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    isValidTimestamp: (value: string) => !Number.isNaN(Date.parse(value)),
    isRoomParticipantRole: (value: unknown): value is never =>
      value === "player" || value === "spectator",
    isRecord: (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
    deepFreeze: <T>(value: T): T => value,
    incrementRevision: vi.fn(),
    cancelScheduledOperation: vi.fn(async () => true),
    restoreOperationResult: () => null,
    storeOperationResult: (
      _request: never,
      _command: string,
      result: RoomSnapshot,
    ) => result,
    enqueueCustomRoomIndexSync: vi.fn(async () => undefined),
    getDisconnectGracePeriodMs: () => 30_000,
    getResumeTokenTtlMs: () => 3_600_000,
    getEventHistoryLimit: () => 100,
    getProcessedCommandRetentionMs: () => 60_000,
    getMinimumPlayers: () => 1,
    getRequireAllPlayersReady: () => 1,
    getMaxPlayers: () => 4,
    getMaxSpectators: () => 0,
    ...overrides,
  } as unknown as RoomWebSocketDependencies;
}

function createEnv(rateAllowed = true) {
  return {
    FLARE_LOBBY_TOKEN_SECRET: TOKEN_SECRET,
    FLARE_LOBBY_RATE_LIMITS: {
      getByName: () => ({
        consume: async () =>
          rateAllowed ? { allowed: true } : { allowed: false },
      }),
    },
  } as never;
}

function upgradeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/v1/rooms/room-1/ws", {
    method: "GET",
    headers: {
      Upgrade: "websocket",
      ...headers,
    },
  });
}

function commandMessage(
  command: string,
  payload: unknown,
  requestId = "request-1",
): string {
  return JSON.stringify({
    protocolVersion: 1,
    kind: "command",
    requestId,
    command,
    payload,
  });
}

describe("RoomWebSocketHandler モジュール", () => {
  it("Upgrade 以外と不正な接続情報を拒否する", async () => {
    const handler = new RoomWebSocketHandler(createDeps(), createEnv());

    await expect(
      handler.handleFetch(
        new Request("https://example.test/", { method: "POST" }),
      ),
    ).resolves.toMatchObject({ status: 404 });

    await expect(
      handler.handleFetch(
        new Request("https://example.test/v1/rooms/room-1/ws", {
          method: "GET",
        }),
      ),
    ).resolves.toMatchObject({ status: 404 });

    const noRoom = new RoomWebSocketHandler(
      createDeps({ getWebSocketRoomId: () => null }),
      createEnv(),
    );
    await expect(noRoom.handleFetch(upgradeRequest())).resolves.toMatchObject({
      status: 400,
    });

    const noProtocol = new RoomWebSocketHandler(
      createDeps({ hasWebSocketProtocol: () => false }),
      createEnv(),
    );
    await expect(
      noProtocol.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({
      status: 400,
    });
  });

  it("トークン検証の失敗をエラー応答にする", async () => {
    const badToken = new RoomWebSocketHandler(
      createDeps({
        readWebSocketJoinToken: () => ({
          ok: false as const,
          error: new FlareLobbyError("UNAUTHENTICATED"),
        }),
      }),
      createEnv(),
    );
    await expect(badToken.handleFetch(upgradeRequest())).resolves.toMatchObject(
      {
        status: 401,
      },
    );

    const badClaims = new RoomWebSocketHandler(
      createDeps({
        verifyWebSocketRoomToken: vi.fn(async () => ({
          ok: false as const,
          error: new FlareLobbyError("FORBIDDEN"),
        })),
      }),
      createEnv(),
    );
    await expect(
      badClaims.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({
      status: 403,
    });

    const noParticipant = new RoomWebSocketHandler(
      createDeps({
        verifyWebSocketRoomToken: vi.fn(async () => ({
          ok: true as const,
          value: joinClaims({ participantId: undefined }),
        })),
      }),
      createEnv(),
    );
    await expect(
      noParticipant.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({ status: 401 });

    const badRevision = new RoomWebSocketHandler(
      createDeps({
        readLastRevision: () => ({
          ok: false as const,
          error: new FlareLobbyError("INVALID_MESSAGE"),
        }),
      }),
      createEnv(),
    );
    await expect(
      badRevision.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({
      status: 400,
    });
  });

  it("Room と参加者の不一致を拒否する", async () => {
    const noRoom = new RoomWebSocketHandler(
      createDeps({ readRoomRow: () => undefined }),
      createEnv(),
    );
    await expect(noRoom.handleFetch(upgradeRequest())).resolves.toMatchObject({
      status: 403,
    });

    const finished = new RoomWebSocketHandler(
      createDeps({ readRoomRow: () => roomRow({ state: "finished" }) }),
      createEnv(),
    );
    await expect(finished.handleFetch(upgradeRequest())).resolves.toMatchObject(
      {
        status: 400,
      },
    );

    const noParticipant = new RoomWebSocketHandler(
      createDeps({ readParticipantById: () => undefined }),
      createEnv(),
    );
    await expect(
      noParticipant.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("新規接続で 101 を返し、失敗時は後始末する", async () => {
    const handler = new RoomWebSocketHandler(createDeps(), createEnv());
    const response = await handler.handleFetch(upgradeRequest());
    expect(response.status).toBe(101);

    // 再開トークン発行の失敗はエラー応答になる。
    const issueFailed = new RoomWebSocketHandler(
      createDeps({
        issueResumeToken: vi.fn(async () => ({
          ok: false as const,
          error: new FlareLobbyError("CONNECTION_FAILED"),
        })),
      }),
      createEnv(),
    );
    const issueResponse = await issueFailed.handleFetch(upgradeRequest());
    expect(issueResponse.status).not.toBe(101);

    // スナップショット欠落は CONNECTION_FAILED になる。
    const noSnapshot = new RoomWebSocketHandler(
      createDeps({ readSnapshot: () => null }),
      createEnv(),
    );
    await expect(
      noSnapshot.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({ status: 400 });

    // 初期送信の失敗は切断を記録する。
    const sendFailed = new RoomWebSocketHandler(
      createDeps({ sendProtocolMessage: () => false }),
      createEnv(),
    );
    const sendResponse = await sendFailed.handleFetch(upgradeRequest());
    expect(sendResponse.status).toBe(101);
  });

  it("再開接続の検証と期限切れを処理する", async () => {
    const resumeClaims = () =>
      joinClaims({ purpose: "resume", nonce: "resume-1" });
    const connectionRow = {
      resumeId: "resume-1",
      roomId: "room-1",
      principalId: "principal-1",
      participantId: "participant-1",
      role: "player",
      connectedAt: NOW,
      disconnectedAt: new Date(Date.now() - 1_000).toISOString(),
      connectionGeneration: "gen-0",
      resumeTokenExpiresAt: Date.now() + 3_600_000,
      invalidatedAt: null,
    };
    const resumeDeps = (connection: unknown) =>
      createDeps({
        verifyWebSocketRoomToken: vi.fn(async () => ({
          ok: true as const,
          value: resumeClaims(),
        })),
        readRoomConnection: () => connection as never,
      });

    // 接続行なしは FORBIDDEN になる。
    await expect(
      new RoomWebSocketHandler(resumeDeps(undefined), createEnv()).handleFetch(
        upgradeRequest(),
      ),
    ).resolves.toMatchObject({ status: 403 });

    // 期限切れの切断は FORBIDDEN になる。
    const expired = {
      ...connectionRow,
      disconnectedAt: "2020-01-01T00:00:00.000Z",
    };
    const expiredHandler = new RoomWebSocketHandler(
      resumeDeps(expired),
      createEnv(),
    );
    await expect(
      expiredHandler.handleFetch(upgradeRequest()),
    ).resolves.toMatchObject({
      status: 403,
    });

    // 有効な再開は 101 を返す。
    const valid = new RoomWebSocketHandler(
      resumeDeps(connectionRow),
      createEnv(),
    );
    await expect(valid.handleFetch(upgradeRequest())).resolves.toMatchObject({
      status: 101,
    });
  });

  it("メッセージの購読なし・検証失敗・認証失敗を処理する", async () => {
    const socket = new WebSocketPair()[0];
    const handler = new RoomWebSocketHandler(
      createDeps({ readWebSocketAttachment: () => null }),
      createEnv(),
    );
    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", {}),
    );
    await handler.handleWebSocketClose(socket, 1006, "", false);
    await handler.handleWebSocketError(socket, new Error("boom"));

    // 不正なコマンドは失敗送信し、requestId なしでは閉じる。
    const invalid = new RoomWebSocketHandler(createDeps(), createEnv());
    await invalid.handleWebSocketMessage(socket, "not-json{{{");
    await invalid.handleWebSocketMessage(
      socket,
      JSON.stringify({
        protocolVersion: 1,
        kind: "command",
        command: "room.set_ready",
        payload: {},
      }),
    );
  });

  it("コマンドをディスパッチして成功応答を返す", async () => {
    const socket = new WebSocketPair()[0];
    const setReady = vi.fn(async () => snapshot());
    const selectTeam = vi.fn(async () => snapshot());
    const updateSettings = vi.fn(async () => snapshot());
    const transferHost = vi.fn(async () => snapshot());
    const kick = vi.fn(async () => snapshot());
    const startMatch = vi.fn(async () => snapshot());
    const close = vi.fn(async () => snapshot());
    const sendWebSocketFailure = vi.fn();
    const deps = createDeps({
      setReady,
      selectTeam,
      updateSettings,
      transferHost,
      kick,
      startMatch,
      close,
      sendWebSocketFailure,
    });
    const handler = new RoomWebSocketHandler(deps, createEnv());

    const commands: Array<[string, unknown]> = [
      ["room.set_ready", { ready: true }],
      ["room.select_team", { teamId: "red" }],
      ["room.update_settings", { settings: { map: "desert" } }],
      ["room.transfer_host", { targetParticipantId: "participant-2" }],
      ["room.kick", { targetParticipantId: "participant-2", reason: "afk" }],
      ["room.start_match", {}],
      ["room.close", {}],
    ];
    for (const [command, payload] of commands) {
      await handler.handleWebSocketMessage(
        socket,
        commandMessage(command, payload),
      );
    }

    expect(setReady).toHaveBeenCalledTimes(1);
    expect(setReady).toHaveBeenCalledWith(
      expect.objectContaining({
        participantId: "participant-1",
        requestId: "request-1",
        ready: true,
      }),
    );
    expect(selectTeam).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "red" }),
    );
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { map: "desert" } }),
    );
    expect(transferHost).toHaveBeenCalledWith(
      expect.objectContaining({ targetParticipantId: "participant-2" }),
    );
    expect(kick).toHaveBeenCalledWith(
      expect.objectContaining({
        targetParticipantId: "participant-2",
        reason: "afk",
      }),
    );
    expect(startMatch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sendWebSocketFailure).not.toHaveBeenCalled();

    // 未知のコマンドは失敗応答になる。
    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.unknown", {}),
    );
    // 形式不正の payload は失敗応答になる。
    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: "yes" }),
    );
    expect(sendWebSocketFailure).toHaveBeenCalledTimes(2);
    expect(sendWebSocketFailure).toHaveBeenNthCalledWith(
      1,
      socket,
      expect.objectContaining({ code: "INVALID_PAYLOAD" }),
    );
    expect(sendWebSocketFailure).toHaveBeenNthCalledWith(
      2,
      socket,
      expect.objectContaining({ code: "INVALID_PAYLOAD" }),
    );
  });

  it("レート制限と送信失敗を処理する", async () => {
    const socket = new WebSocketPair()[0];
    const limited = new RoomWebSocketHandler(createDeps(), createEnv(false));
    await limited.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: true }),
    );

    const failingRate = new RoomWebSocketHandler(createDeps(), {
      FLARE_LOBBY_TOKEN_SECRET: TOKEN_SECRET,
      FLARE_LOBBY_RATE_LIMITS: {
        getByName: () => ({
          consume: async () => {
            throw new Error("rate DO down");
          },
        }),
      },
    } as never);
    await failingRate.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: true }),
    );

    // 操作の失敗は失敗応答になる。
    const opFailed = new RoomWebSocketHandler(
      createDeps({
        setReady: vi.fn(async () => {
          throw new FlareLobbyError("CONFLICT");
        }),
      }),
      createEnv(),
    );
    await opFailed.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: true }),
    );

    // 応答送信の失敗は接続を閉じる。
    const sendFailed = new RoomWebSocketHandler(
      createDeps({ sendProtocolMessage: () => false }),
      createEnv(),
    );
    await sendFailed.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: true }),
    );
  });

  it("接続保存の失敗は後始末してエラー応答にする", async () => {
    const markDisconnected = vi.fn(async () => undefined);
    const handler = new RoomWebSocketHandler(
      createDeps({
        storeWebSocketConnection: () => {
          throw new Error("store failed");
        },
        markWebSocketDisconnected: markDisconnected,
      }),
      createEnv(),
    );

    await expect(handler.handleFetch(upgradeRequest())).resolves.toMatchObject({
      status: 400,
    });
    expect(markDisconnected).toHaveBeenCalledTimes(1);
  });

  it("プリンシパル不正のメッセージは失敗応答になる", async () => {
    const socket = new WebSocketPair()[0];
    const badPrincipal = {
      ...attachment(),
      principal: { id: "", playerId: "" },
    };
    const handler = new RoomWebSocketHandler(
      createDeps({ readWebSocketAttachment: () => badPrincipal as never }),
      createEnv(),
    );
    const sendFailure = vi.fn();
    const withSpy = new RoomWebSocketHandler(
      createDeps({
        readWebSocketAttachment: () => badPrincipal as never,
        sendWebSocketFailure: sendFailure,
      }),
      createEnv(),
    );

    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: true }),
    );
    await withSpy.handleWebSocketMessage(
      socket,
      commandMessage("room.set_ready", { ready: true }),
    );
    expect(sendFailure).toHaveBeenCalledTimes(1);
  });

  it("形式不正のコマンド payload は失敗応答になる", async () => {
    const socket = new WebSocketPair()[0];
    const sendFailure = vi.fn();
    const handler = new RoomWebSocketHandler(
      createDeps({ sendWebSocketFailure: sendFailure }),
      createEnv(),
    );

    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.select_team", { teamId: 42 }),
    );
    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.transfer_host", { targetParticipantId: "" }),
    );
    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.start_match", { at: 42 }),
    );
    await handler.handleWebSocketMessage(
      socket,
      commandMessage("room.close", { at: 42 }),
    );
    expect(sendFailure).toHaveBeenCalledTimes(4);
  });

  it("切断とエラーを後始末する", async () => {
    const socket = new WebSocketPair()[0];
    const markDisconnected = vi.fn(async () => undefined);
    const handler = new RoomWebSocketHandler(
      createDeps({ markWebSocketDisconnected: markDisconnected }),
      createEnv(),
    );

    await handler.handleWebSocketClose(socket, 1006, "", false);
    expect(markDisconnected).toHaveBeenCalledTimes(1);
    await handler.handleWebSocketError(socket, new Error("boom"));
    expect(markDisconnected).toHaveBeenCalledTimes(2);

    const noAttachment = new RoomWebSocketHandler(
      createDeps({ readWebSocketAttachment: () => null }),
      createEnv(),
    );
    await noAttachment.handleWebSocketClose(socket, 1006, "", false);
    await noAttachment.handleWebSocketError(socket, new Error("boom"));
  });
});
