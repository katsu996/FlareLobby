import { describe, expect, it, vi } from "vitest";

import type { RoomRow, ScheduledOperationRow } from "../src/room.js";
import {
  ROOM_INDEX_DELETE_OPERATION_KIND,
  ROOM_INDEX_UPSERT_OPERATION_KIND,
} from "../src/room.js";
import {
  RoomIndexSync,
  createCustomRoomIndexRecord,
  enqueueCustomRoomIndexSync,
  processCustomRoomIndexOperation,
  rescheduleCustomRoomIndexOperation,
  type RoomIndexSyncDependencies,
} from "../src/room/RoomIndexSync.js";

const NOW = "2026-08-11T00:00:00.000Z";

function roomRow(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    roomId: "room-1",
    kind: "custom",
    invitationCode: "ABC123",
    visibility: "public",
    matchId: null,
    poolJson: null,
    settingsJson: JSON.stringify({ mode: "ranked", region: "jp" }),
    metadataJson: JSON.stringify({ name: "練習ルーム" }),
    state: "waiting",
    stateStartedAt: NOW,
    revision: 3,
    hostParticipantId: "participant-1",
    hostPlayerId: "player-1",
    maxPlayers: 4,
    maxSpectators: 2,
    minimumPlayers: 1,
    requireAllPlayersReady: 1,
    joinMethod: "invitation",
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

function createD1(failRun = false): D1Database & { calls: string[] } {
  const calls: string[] = [];
  const statement = {
    bind: (...args: unknown[]) => {
      calls.push(`bind:${args.length}`);
      return statement;
    },
    run: async () => {
      calls.push("run");
      if (failRun) {
        throw new Error("D1 temporary failure");
      }
      return {};
    },
    first: async () => null,
    all: async () => ({ results: [] }),
  };
  return {
    exec: async (query: string) => {
      calls.push(`exec:${query.slice(0, 24)}`);
      return undefined as never;
    },
    prepare: (query: string) => {
      calls.push(`prepare:${query.slice(0, 24)}`);
      return statement as never;
    },
    batch: async (statements: readonly unknown[]) => {
      calls.push(`batch:${statements.length}`);
      return [];
    },
    calls,
  } as unknown as D1Database & { calls: string[] };
}

function createDeps(
  overrides: Partial<RoomIndexSyncDependencies> = {},
  options: { d1Fails?: boolean } = {},
): RoomIndexSyncDependencies & { execCalls: unknown[][] } {
  const execCalls: unknown[][] = [];
  return {
    readRoomRow: () => roomRow(),
    readParticipantCounts: () => ({ total: 3, players: 2, spectators: 1 }),
    exec: vi.fn((sql: string, ...args: unknown[]) => {
      execCalls.push([sql, ...args]);
    }),
    synchronizeAlarm: vi.fn(async () => undefined),
    FLARE_LOBBY_DB: createD1(options.d1Fails),
    ...overrides,
    execCalls,
  } as RoomIndexSyncDependencies & { execCalls: unknown[][] };
}

function operation(
  overrides: Partial<ScheduledOperationRow> = {},
): ScheduledOperationRow {
  return {
    operationId: "index-sync",
    dueAt: Date.now(),
    kind: ROOM_INDEX_UPSERT_OPERATION_KIND,
    payloadJson: "{}",
    ...overrides,
  };
}

describe("RoomIndexSync モジュール", () => {
  it("公開カスタムルームの一覧レコードを組み立てる", () => {
    const deps = createDeps();
    const handler = new RoomIndexSync(deps);

    const record = handler.createCustomRoomIndexRecord(roomRow());
    expect(record).toMatchObject({
      roomId: "room-1",
      name: "練習ルーム",
      mode: "ranked",
      region: "jp",
      maxPlayers: 4,
      playerCount: 2,
      availableSlots: 2,
      maxSpectators: 2,
      spectatorCount: 1,
      availableSpectatorSlots: 1,
    });

    // 非公開・マッチ・必須欠落は null になる。
    expect(
      handler.createCustomRoomIndexRecord(roomRow({ kind: "match" })),
    ).toBeNull();
    expect(
      handler.createCustomRoomIndexRecord(
        roomRow({ visibility: null, joinMethod: null, maxPlayers: null }),
      ),
    ).toBeNull();
    expect(
      handler.createCustomRoomIndexRecord(roomRow({ visibility: null })),
    ).toBeNull();

    // 関数形式の API も同じ処理へ委譲する。
    expect(createCustomRoomIndexRecord(deps, roomRow())?.roomId).toBe("room-1");
  });

  it("公開ルームの同期をキューイングし、対象外では何もしない", async () => {
    const deps = createDeps();
    await new RoomIndexSync(deps).enqueueCustomRoomIndexSync();
    expect(deps.execCalls.length).toBeGreaterThan(0);

    const hidden = createDeps({
      readRoomRow: () => roomRow({ kind: "match" }),
    });
    await new RoomIndexSync(hidden).enqueueCustomRoomIndexSync();
    expect(hidden.execCalls).toHaveLength(0);

    const missing = createDeps({ readRoomRow: () => undefined });
    await new RoomIndexSync(missing).enqueueCustomRoomIndexSync();
    expect(missing.execCalls).toHaveLength(0);

    // 結合方式なしの公開ルームは記録対象外になる。
    const noMethod = createDeps({
      readRoomRow: () => roomRow({ joinMethod: null }),
    });
    await new RoomIndexSync(noMethod).enqueueCustomRoomIndexSync();
    expect(noMethod.execCalls).toHaveLength(0);

    // D1 障害でも例外にせず Alarm 同期へフォールバックする。
    const failing = createDeps({}, { d1Fails: true });
    await expect(
      new RoomIndexSync(failing).enqueueCustomRoomIndexSync(),
    ).resolves.toBeUndefined();

    // Alarm 同期の失敗も送出しない。
    const alarmFailing = createDeps(
      {
        synchronizeAlarm: vi.fn(async () => {
          throw new Error("alarm failed");
        }),
      },
      { d1Fails: true },
    );
    await expect(
      enqueueCustomRoomIndexSync(alarmFailing),
    ).resolves.toBeUndefined();
  });

  it("保存済み操作を処理し、成功時は削除・失敗時は再試行する", async () => {
    const deps = createDeps();
    const handler = new RoomIndexSync(deps);
    const record = handler.createCustomRoomIndexRecord(roomRow());
    expect(record).not.toBeNull();

    const upserted = await handler.processCustomRoomIndexOperation(
      operation({ payloadJson: JSON.stringify(record) }),
    );
    expect(upserted).toBe(true);

    const deleted = await processCustomRoomIndexOperation(
      deps,
      operation({
        kind: ROOM_INDEX_DELETE_OPERATION_KIND,
        payloadJson: JSON.stringify({ roomId: "room-1" }),
      }),
    );
    expect(deleted).toBe(true);

    // 不明な種別は false になる。
    await expect(
      handler.processCustomRoomIndexOperation(
        operation({ kind: "unknown-kind" as never }),
      ),
    ).resolves.toBe(false);

    // 不正な削除ペイロードは再試行になる。
    const invalidDelete = await handler.processCustomRoomIndexOperation(
      operation({
        kind: ROOM_INDEX_DELETE_OPERATION_KIND,
        payloadJson: JSON.stringify({ roomId: "" }),
      }),
    );
    expect(invalidDelete).toBe(false);

    // D1 障害は再試行になる。
    const failing = createDeps({}, { d1Fails: true });
    const retried = await new RoomIndexSync(
      failing,
    ).processCustomRoomIndexOperation(
      operation({ payloadJson: JSON.stringify(record) }),
    );
    expect(retried).toBe(false);
  });

  it("再試行時刻を遅延後に更新する", () => {
    const deps = createDeps();
    const handler = new RoomIndexSync(deps);
    const before = Date.now();

    handler.rescheduleCustomRoomIndexOperation(operation({ dueAt: before }));
    rescheduleCustomRoomIndexOperation(deps, operation({ dueAt: before }));

    expect(deps.execCalls).toHaveLength(2);
    const dueAt = deps.execCalls[0]?.[1] as number;
    expect(dueAt).toBeGreaterThan(before);
  });
});
