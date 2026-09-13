import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { RoomSnapshot } from "@flarelobby/core";
import type { GatewayPrincipalEnvelope } from "../src/security.js";
import { authenticateGatewayRequest } from "../src/security.js";
import type { ParticipantRow, RoomRow } from "../src/room.js";
import {
  RoomOperations,
  close,
  kick,
  selectTeam,
  setReady,
  startMatch,
  transferHost,
  updateSettings,
  type RoomOperationsDependencies,
} from "../src/room/RoomOperations.js";

const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;
const NOW = "2026-08-11T00:00:00.000Z";

async function createGatewayPrincipal(
  principalId: string,
): Promise<GatewayPrincipalEnvelope> {
  const result = await authenticateGatewayRequest(
    new Request("https://example.test/rooms", { method: "POST" }),
    () => ({ id: principalId, playerId: `${principalId}-player` }),
    TOKEN_SECRET,
  );

  if (!result.ok) {
    throw result.error;
  }

  return result.value.gatewayPrincipal;
}

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
    revision: 1,
    hostParticipantId: "participant-1",
    hostPlayerId: "principal-1-player",
    maxPlayers: 4,
    maxSpectators: 0,
    minimumPlayers: 1,
    requireAllPlayersReady: 1,
    joinMethod: null,
    joinPasswordSalt: null,
    joinPasswordHash: null,
    finishedRoomRetentionMs: 0,
    createdAt: Date.parse(NOW),
    resumeTokenTtlMs: 3_600_000,
    disconnectGracePeriodMs: 0,
    eventHistoryLimit: 100,
    processedCommandRetentionMs: 60_000,
    ...overrides,
  };
}

function participantRow(
  overrides: Partial<ParticipantRow> = {},
): ParticipantRow {
  return {
    participantId: "participant-1",
    kind: "player",
    playerId: "principal-1-player",
    teamId: null,
    ready: 0,
    ...overrides,
  };
}

function snapshot(revision = 2): RoomSnapshot {
  return { revision } as unknown as RoomSnapshot;
}

function createDeps(
  overrides: Partial<RoomOperationsDependencies> = {},
): RoomOperationsDependencies & {
  readonly calls: { exec: unknown[][]; broadcast: unknown[][] };
} {
  const room = roomRow();
  const participant = participantRow();
  const calls: { exec: unknown[][]; broadcast: unknown[][] } = {
    exec: [],
    broadcast: [],
  };
  const actor = {
    principal: { id: "p", playerId: "principal-1-player" } as never,
    room,
    participant,
  };
  return {
    readRoomRow: () => room,
    readParticipantById: (id: string) =>
      id === participant.participantId ? participant : undefined,
    readParticipantByPlayerId: (id: string) =>
      id === participant.playerId ? participant : undefined,
    readPlayerCounts: () => ({ total: 2, ready: 2 }),
    readSnapshot: () => snapshot(),
    readRequiredSnapshot: () => snapshot(),
    authenticateParticipant: vi.fn(async () => actor),
    authenticateHost: vi.fn(async () => actor),
    exec: vi.fn((sql: string, ...args: unknown[]) => {
      calls.exec.push([sql, ...args]);
    }),
    incrementRevision: vi.fn(),
    teamExists: (teamId: string) => teamId === "red" || teamId === "blue",
    setHost: vi.fn(),
    invalidateResumeSessions: vi.fn(),
    cancelDisconnectOperation: vi.fn(),
    synchronizeAlarm: vi.fn(async () => undefined),
    broadcastRoomSnapshot: vi.fn((value: RoomSnapshot) => {
      calls.broadcast.push([value]);
    }),
    restoreOperationResult: () => null,
    storeOperationResult: vi.fn(
      async (_request: unknown, _command: string, result: RoomSnapshot) =>
        result,
    ),
    enqueueCustomRoomIndexSync: vi.fn(async () => undefined),
    getMinimumPlayers: () => 1,
    getRequireAllPlayersReady: () => 1,
    ...overrides,
    calls,
  };
}

describe("RoomOperations モジュール", () => {
  it("setReady が準備状態を更新し、再送は保存済み結果を返す", async () => {
    const deps = createDeps();
    const ops = new RoomOperations(deps);
    const envelope = await createGatewayPrincipal("principal-1");

    const result = await ops.setReady({
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-1",
      ready: true,
    });
    expect(result.revision).toBe(2);
    expect(deps.calls.exec).toHaveLength(1);
    expect(deps.calls.broadcast).toHaveLength(1);

    // 非待機状態では CONFLICT になる。
    const waitingDeps = createDeps({
      authenticateParticipant: vi.fn(async () => ({
        principal: { id: "p", playerId: "principal-1-player" } as never,
        room: roomRow({ state: "in_progress" }),
        participant: participantRow(),
      })),
    });
    await expect(
      new RoomOperations(waitingDeps).setReady({
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-2",
        ready: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 観戦者は FORBIDDEN になる。
    const spectatorDeps = createDeps({
      authenticateParticipant: vi.fn(async () => ({
        principal: { id: "p", playerId: "principal-1-player" } as never,
        room: roomRow(),
        participant: participantRow({ kind: "spectator" }),
      })),
    });
    await expect(
      new RoomOperations(spectatorDeps).setReady({
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-3",
        ready: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      new RoomOperations(spectatorDeps).selectTeam({
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-4",
        teamId: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 関数形式の API も同じ処理へ委譲する。
    const replayed = snapshot(9);
    const replayDeps = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      setReady(replayDeps, {
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-1",
        ready: true,
      }),
    ).resolves.toBe(replayed);
    expect(replayDeps.calls.exec).toHaveLength(0);
  });

  it("selectTeam が存在しないチームを拒否する", async () => {
    const deps = createDeps();
    const ops = new RoomOperations(deps);
    const envelope = await createGatewayPrincipal("principal-1");

    await expect(
      ops.selectTeam({
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-1",
        teamId: "green",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const result = await selectTeam(deps, {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-2",
      teamId: "red",
    });
    expect(result.revision).toBe(2);

    const cleared = await selectTeam(deps, {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-3",
      teamId: null,
    });
    expect(cleared.revision).toBe(2);
  });

  it("updateSettings が設定をマージして索引同期する", async () => {
    const deps = createDeps();
    const envelope = await createGatewayPrincipal("principal-1");

    const result = await updateSettings(deps, {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-1",
      settings: { map: "desert" },
    });
    expect(result.revision).toBe(2);
    const execCall = deps.calls.exec[0]?.[0] as string;
    expect(execCall).toContain("settings_json");
    expect(
      deps.calls.exec.some((call) => JSON.stringify(call).includes("desert")),
    ).toBe(true);
  });

  it("transferHost が対象検証と自己移譲を拒否する", async () => {
    const deps = createDeps();
    const ops = new RoomOperations(deps);
    const envelope = await createGatewayPrincipal("principal-1");
    const base = {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-1",
    };

    // 存在しない参加者は CONFLICT になる。
    await expect(
      ops.transferHost({ ...base, targetParticipantId: "nobody" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 自分自身へは CONFLICT になる。
    await expect(
      ops.transferHost({ ...base, targetParticipantId: "participant-1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const other = participantRow({
      participantId: "participant-2",
      playerId: "other-player",
    });
    const withOther = createDeps({
      readParticipantById: (id: string) =>
        id === "participant-2"
          ? other
          : id === "participant-1"
            ? participantRow()
            : undefined,
    });
    const result = await transferHost(withOther, {
      ...base,
      requestId: "request-2",
      targetParticipantId: "participant-2",
    });
    expect(result.revision).toBe(2);
  });

  it("kick が対象検証と自己退出を拒否する", async () => {
    const deps = createDeps();
    const ops = new RoomOperations(deps);
    const envelope = await createGatewayPrincipal("principal-1");

    // 対象不在は CONFLICT になる。
    await expect(
      ops.kick({
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-1",
        targetParticipantId: "nobody",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 自分自身は CONFLICT になる。
    await expect(
      ops.kick({
        gatewayPrincipal: envelope,
        participantId: "participant-1",
        requestId: "request-2",
        targetParticipantId: "participant-1",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const other = participantRow({
      participantId: "participant-2",
      playerId: "other-player",
    });
    const withOther = createDeps({
      readParticipantById: (id: string) =>
        id === "participant-2"
          ? other
          : id === "participant-1"
            ? participantRow()
            : undefined,
      readParticipantByPlayerId: (id: string) =>
        id === "other-player" ? other : undefined,
    });
    const byId = await kick(withOther, {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-3",
      targetParticipantId: "participant-2",
      reason: "afk",
    });
    expect(byId.revision).toBe(2);

    const byPlayer = await kick(withOther, {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-4",
      targetPlayerId: "other-player",
    });
    expect(byPlayer.revision).toBe(2);
  });

  it("startMatch が人数と準備完了を検証する", async () => {
    const envelope = await createGatewayPrincipal("principal-1");
    const base = {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-1",
      at: NOW,
    };

    // 最少人数未満は CONFLICT になる。
    const few = createDeps({
      readPlayerCounts: () => ({ total: 1, ready: 1 }),
      getMinimumPlayers: () => 2,
    });
    await expect(
      new RoomOperations(few).startMatch(base),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // 未準備ありは CONFLICT になる。
    const unready = createDeps({
      readPlayerCounts: () => ({ total: 2, ready: 1 }),
    });
    await expect(
      new RoomOperations(unready).startMatch({ ...base, requestId: "r2" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const deps = createDeps();
    const result = await startMatch(deps, { ...base, requestId: "r3" });
    expect(result.revision).toBe(2);
    expect(deps.calls.exec).toHaveLength(2);
  });

  it("close が終了済みと保持期限オーバーフローを拒否する", async () => {
    const envelope = await createGatewayPrincipal("principal-1");
    const base = {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
      requestId: "request-1",
      at: NOW,
    };

    // 終了済みは ROOM_FINISHED になる。
    const finished = createDeps({
      authenticateHost: vi.fn(async () => ({
        principal: { id: "p", playerId: "principal-1-player" } as never,
        room: roomRow(),
        participant: participantRow(),
      })),
      readRoomRow: () => roomRow({ state: "finished" }),
    });
    await expect(
      new RoomOperations(finished).close(base),
    ).rejects.toMatchObject({
      code: "ROOM_FINISHED",
    });

    // 未初期化は ROOM_FINISHED になる。
    const missing = createDeps({ readRoomRow: () => undefined });
    await expect(
      new RoomOperations(missing).close({ ...base, requestId: "r2" }),
    ).rejects.toMatchObject({ code: "ROOM_FINISHED" });

    // 保持期限のオーバーフローは INVALID_PAYLOAD になる。
    const overflow = createDeps({
      readRoomRow: () =>
        roomRow({ finishedRoomRetentionMs: Number.MAX_SAFE_INTEGER }),
    });
    await expect(
      new RoomOperations(overflow).close({ ...base, requestId: "r3" }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const deps = createDeps();
    const result = await close(deps, { ...base, requestId: "r4" });
    expect(result.revision).toBe(2);
    expect(deps.calls.exec).toHaveLength(2);
  });

  it("再送は保存済み結果を返して再実行しない", async () => {
    const envelope = await createGatewayPrincipal("principal-1");
    const replayed = { revision: 9 } as never;
    const base = {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
    };

    const selectTeamReplayed = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      selectTeam(selectTeamReplayed, {
        ...base,
        requestId: "request-1",
        teamId: "red",
      }),
    ).resolves.toBe(replayed);

    const updateSettingsReplayed = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      updateSettings(updateSettingsReplayed, {
        ...base,
        requestId: "request-1",
        settings: {},
      }),
    ).resolves.toBe(replayed);

    const transferReplayed = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      transferHost(transferReplayed, {
        ...base,
        requestId: "request-1",
        targetParticipantId: "participant-2",
      }),
    ).resolves.toBe(replayed);

    const kickReplayed = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      kick(kickReplayed, {
        ...base,
        requestId: "request-1",
        targetParticipantId: "participant-2",
      }),
    ).resolves.toBe(replayed);

    const startReplayed = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      startMatch(startReplayed, { ...base, requestId: "request-1", at: NOW }),
    ).resolves.toBe(replayed);

    const closeReplayed = createDeps({
      restoreOperationResult: () => replayed,
    });
    await expect(
      close(closeReplayed, { ...base, requestId: "request-1", at: NOW }),
    ).resolves.toBe(replayed);

    for (const replayDeps of [
      selectTeamReplayed,
      updateSettingsReplayed,
      transferReplayed,
      kickReplayed,
      startReplayed,
      closeReplayed,
    ]) {
      expect(replayDeps.calls.exec).toHaveLength(0);
    }
  });
});
