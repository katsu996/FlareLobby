import { describe, expect, it, vi } from "vitest";

import type {
  ParticipantRow,
  RoomRow,
  RoomScheduledOperationKind,
} from "../src/room.js";
import {
  RoomPersistence,
  type RoomPersistenceDependencies,
} from "../src/room/RoomPersistence.js";

const NOW = Date.parse("2026-08-11T00:00:00.000Z");

type SqlResponder = (sql: string, args: readonly unknown[]) => unknown[];

function createStorage(responder: SqlResponder = () => []) {
  const calls: Array<{ sql: string; args: readonly unknown[] }> = [];
  const alarms: Array<number | null> = [];
  let alarm: number | null = null;
  return {
    calls,
    alarms,
    sql: {
      exec: (query: string, ...args: unknown[]) => {
        calls.push({ sql: query, args });
        const rows = responder(query, args);
        return {
          toArray: () => rows,
          one: () => {
            if (rows.length !== 1) {
              throw new Error(`expected one row, got ${rows.length}`);
            }
            return rows[0];
          },
        };
      },
    },
    getAlarm: async () => alarm,
    setAlarm: async (timestamp: number) => {
      alarm = timestamp;
      alarms.push(timestamp);
    },
    deleteAlarm: async () => {
      alarm = null;
      alarms.push(null);
    },
  };
}

type Storage = ReturnType<typeof createStorage>;

function createDeps(
  storage: Storage,
  now: () => number = () => NOW,
): RoomPersistenceDependencies {
  return {
    storage: storage as unknown as RoomPersistenceDependencies["storage"],
    now,
  };
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
    stateStartedAt: "2026-08-11T00:00:00.000Z",
    revision: 1,
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
    createdAt: NOW,
    resumeTokenTtlMs: 3_600_000,
    disconnectGracePeriodMs: 0,
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

function expectSyncErrorCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }

  throw new Error(`例外 ${code} が送出されることを期待しました。`);
}

describe("RoomPersistence モジュール", () => {
  it("スキーマ初期化が未適用時のみ DDL を実行する", async () => {
    const fresh = createStorage((sql) =>
      sql.includes("MAX(version)") ? [{ version: 0 }] : [],
    );
    await new RoomPersistence(createDeps(fresh)).initializeRoomSchema();
    expect(fresh.calls.some((call) => call.sql.includes("CREATE TABLE"))).toBe(
      true,
    );

    const migrated = createStorage((sql) =>
      sql.includes("MAX(version)") ? [{ version: 1 }] : [],
    );
    await new RoomPersistence(createDeps(migrated)).initializeRoomSchema();
    expect(
      migrated.calls.some((call) => call.sql.includes("flarelobby_rooms (")),
    ).toBe(false);
  });

  it("Room 行と参加者行の読み取りで欠落を undefined にする", () => {
    const room = roomRow();
    const participant = participantRow();
    const storage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [room];
      if (sql.includes("FROM flarelobby_room_participants"))
        return [participant];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    expect(persistence.readRoomRow()).toEqual(room);
    expect(persistence.readParticipantById("participant-1")).toEqual(
      participant,
    );
    expect(persistence.readParticipantByPlayerId("player-1")).toEqual(
      participant,
    );
    expect(persistence.readOldestPlayerParticipant("other")).toEqual(
      participant,
    );

    const empty = createStorage();
    const missing = new RoomPersistence(createDeps(empty));
    expect(missing.readRoomRow()).toBeUndefined();
    expect(missing.readParticipantById("x")).toBeUndefined();
    expect(missing.readParticipantByPlayerId("x")).toBeUndefined();
    expect(missing.readOldestPlayerParticipant("x")).toBeUndefined();
  });

  it("カスタムとマッチのスナップショットを構築し、不正を拒否する", () => {
    const participants = [
      participantRow(),
      participantRow({
        participantId: "participant-2",
        kind: "spectator",
        playerId: "player-2",
      }),
    ];
    const storage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      if (sql.includes("FROM flarelobby_room_participants"))
        return participants;
      if (sql.includes("FROM flarelobby_room_teams"))
        return [{ teamId: "red" }];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    const snapshot = persistence.readSnapshot() as unknown as {
      revision: number;
      room: { kind: string };
      participants: readonly unknown[];
    };
    expect(snapshot.revision).toBe(1);
    expect(snapshot.room.kind).toBe("custom");
    expect(snapshot.participants).toHaveLength(2);
    expect(persistence.readRequiredSnapshot()).toEqual(snapshot);

    // ホスト欠落のカスタムは CONNECTION_FAILED になる。
    const broken = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms"))
        return [roomRow({ hostParticipantId: null })];
      if (sql.includes("FROM flarelobby_room_participants"))
        return participants;
      if (sql.includes("FROM flarelobby_room_teams")) return [];
      return [];
    });
    expectSyncErrorCode(
      () => new RoomPersistence(createDeps(broken)).readSnapshot(),
      "CONNECTION_FAILED",
    );
  });

  it("マッチスナップショットと必須読み取りの異常系を扱う", () => {
    const poolJson = JSON.stringify({
      id: "ranked-1v1",
      gameId: "game-1",
      seasonId: "season-1",
      mode: "ranked-1v1",
      region: "jp",
    });
    const matchStorage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms"))
        return [roomRow({ kind: "match", matchId: "match-1", poolJson })];
      if (sql.includes("FROM flarelobby_room_participants"))
        return [participantRow()];
      if (sql.includes("FROM flarelobby_room_teams")) return [];
      return [];
    });
    const snapshot = new RoomPersistence(
      createDeps(matchStorage),
    ).readSnapshot() as unknown as { room: { kind: string } };
    expect(snapshot.room.kind).toBe("match");

    // プール欠落のマッチは CONNECTION_FAILED になる。
    const broken = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms"))
        return [roomRow({ kind: "match", matchId: "match-1", poolJson: null })];
      if (sql.includes("FROM flarelobby_room_participants"))
        return [participantRow()];
      if (sql.includes("FROM flarelobby_room_teams")) return [];
      return [];
    });
    expect(() =>
      new RoomPersistence(createDeps(broken)).readSnapshot(),
    ).toThrow();

    // 未初期化の必須読み取りは CONNECTION_FAILED になる。
    expect(() =>
      new RoomPersistence(createDeps(createStorage())).readRequiredSnapshot(),
    ).toThrow();
  });

  it("プレイヤー数と参加者・設定の更新文を発行する", () => {
    const storage = createStorage((sql) =>
      sql.includes("COUNT(*)") ? [{ total: 2, ready: 1 }] : [],
    );
    const persistence = new RoomPersistence(createDeps(storage));

    expect(persistence.readPlayerCounts()).toEqual({ total: 2, ready: 1 });
    persistence.insertParticipant("p-1", "player", "player-1", null, 0, NOW);
    persistence.deleteParticipant("p-1");
    persistence.updateParticipantReady("p-1", true);
    persistence.updateParticipantReady("p-1", false);
    persistence.updateParticipantTeam("p-1", "red");
    persistence.setHost(participantRow());
    persistence.incrementRevision(1);
    persistence.updateRoomState("in_progress", null, 2);
    persistence.updateRoomSettings("{}", 3);

    const statements = storage.calls.map((call) => call.sql);
    expect(
      statements.some((sql) =>
        sql.includes("INSERT INTO flarelobby_room_participants"),
      ),
    ).toBe(true);
    expect(statements.some((sql) => sql.includes("SET ready = ?"))).toBe(true);
    expect(statements.some((sql) => sql.includes("SET revision = ?"))).toBe(
      true,
    );
  });

  it("チーム存在確認と件数読み取りを行う", () => {
    const withTeam = createStorage(() => [{ count: 1 }]);
    expect(new RoomPersistence(createDeps(withTeam)).teamExists("red")).toBe(
      true,
    );
    const withoutTeam = createStorage(() => [{ count: 0 }]);
    expect(new RoomPersistence(createDeps(withoutTeam)).teamExists("red")).toBe(
      false,
    );

    const counts = createStorage(() => [
      { total: 3, players: 2, spectators: 1 },
    ]);
    expect(
      new RoomPersistence(createDeps(counts)).readParticipantCounts(),
    ).toEqual({ total: 3, players: 2, spectators: 1 });
  });

  it("期限処理の登録・取消・一覧・Alarm 同期を行う", async () => {
    const storage = createStorage((sql) => {
      if (sql.includes("COUNT(*)")) return [{ count: 1 }];
      if (sql.includes("MIN(due_at)")) return [{ nextDueAt: 1_000 }];
      if (sql.includes("FROM flarelobby_room_scheduled_operations"))
        return [
          {
            operationId: "op-1",
            dueAt: 1_000,
            kind: "room_retention",
            payloadJson: "{}",
          },
        ];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    const scheduled = persistence.scheduleOperation(
      "op-1",
      1_000,
      "room_retention" as RoomScheduledOperationKind,
      "{}",
    );
    expect(scheduled).toMatchObject({ id: "op-1", dueAt: 1_000 });
    await expect(persistence.cancelScheduledOperation("op-1")).resolves.toBe(
      true,
    );

    const empty = createStorage((sql) =>
      sql.includes("COUNT(*)") ? [{ count: 0 }] : [],
    );
    await expect(
      new RoomPersistence(createDeps(empty)).cancelScheduledOperation("op-1"),
    ).resolves.toBe(false);

    expect(persistence.readScheduledOperations()).toHaveLength(1);
    await expect(persistence.getNextAlarm()).resolves.toBeNull();

    await persistence.synchronizeAlarm();
    expect(storage.alarms).toContain(1_000);

    // 期限なしで Alarm 設定済みなら削除する。
    const noDue = createStorage((sql) =>
      sql.includes("MIN(due_at)") ? [{ nextDueAt: null }] : [],
    );
    const noDuePersistence = new RoomPersistence({
      ...createDeps(noDue),
      storage: {
        ...(createDeps(noDue).storage as object),
        getAlarm: async () => 500,
        setAlarm: async () => undefined,
        deleteAlarm: async () => {
          noDue.alarms.push("deleted" as never);
        },
      } as never,
    });
    await noDuePersistence.synchronizeAlarm();
    expect(noDue.alarms).toContain("deleted");

    // 同一 Alarm では再設定しない。
    const sameAlarm = createStorage((sql) =>
      sql.includes("MIN(due_at)") ? [{ nextDueAt: 500 }] : [],
    );
    const setAlarm = vi.fn(async (_timestamp: number) => undefined);
    await new RoomPersistence({
      ...createDeps(sameAlarm),
      storage: {
        ...(createDeps(sameAlarm).storage as object),
        getAlarm: async () => 500,
        setAlarm,
        deleteAlarm: async () => undefined,
      } as never,
    }).synchronizeAlarm();
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it("処理済みコマンドの保存・読取・復元を行う", async () => {
    const stored = {
      requestId: "request-1",
      command: "room.set_ready",
      payloadJson: JSON.stringify({ ready: true }),
      resultJson: JSON.stringify({ revision: 2 }),
      createdAt: NOW,
      expiresAt: NOW + 60_000,
    };
    const storage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      if (sql.includes("FROM flarelobby_room_processed_commands"))
        return [stored];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    // 同一内容の再登録は保存済みを返す。
    const replayed = await persistence.recordProcessedCommand(
      "request-1",
      "room.set_ready",
      { ready: true },
      { revision: 2 },
    );
    expect(replayed.command).toBe("room.set_ready");

    // 異なる内容は CONFLICT になる。
    await expect(
      persistence.recordProcessedCommand(
        "request-1",
        "room.close",
        { ready: true },
        { revision: 2 },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 復元は保存済みスナップショットを返す。
    const restored = persistence.restoreOperationResult(
      { requestId: "request-1", payloadJson: stored.payloadJson } as never,
      "room.set_ready",
    );
    expect(restored).toMatchObject({ revision: 2 });

    // 要求不一致は CONFLICT になる。
    expect(() =>
      persistence.restoreOperationResult(
        { requestId: "request-1", payloadJson: "{}" } as never,
        "room.set_ready",
      ),
    ).toThrow();
    expect(
      persistence.restoreOperationResult(
        { requestId: null } as never,
        "room.set_ready",
      ),
    ).toBeNull();

    // 未知の要求は null を返す。
    const unknown = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      return [];
    });
    expect(
      new RoomPersistence(createDeps(unknown)).restoreOperationResult(
        { requestId: "request-unknown", payloadJson: "{}" } as never,
        "room.set_ready",
      ),
    ).toBeNull();

    // 新規保存は凍結値を返す。
    const fresh = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      return [];
    });
    const created = await new RoomPersistence(
      createDeps(fresh),
    ).recordProcessedCommand(
      "request-9",
      "room.set_ready",
      { ready: false },
      { revision: 3 },
    );
    expect(created).toMatchObject({
      requestId: "request-9",
      command: "room.set_ready",
    });
    expect(Object.isFrozen(created)).toBe(true);

    // 未初期化への保存は CONFLICT になる。
    await expect(
      new RoomPersistence(createDeps(createStorage())).recordProcessedCommand(
        "request-1",
        "room.set_ready",
        {},
        {},
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 保持期限のオーバーフローは INVALID_PAYLOAD になる。
    const overflowRoom = roomRow({
      processedCommandRetentionMs: Number.MAX_SAFE_INTEGER,
    });
    const overflow = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [overflowRoom];
      return [];
    });
    await expect(
      new RoomPersistence(
        createDeps(overflow, () => Number.MAX_SAFE_INTEGER),
      ).recordProcessedCommand("request-1", "room.set_ready", {}, {}),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("期限切れコマンドの読取は削除して null を返す", () => {
    const expired = {
      requestId: "request-1",
      command: "room.set_ready",
      payloadJson: "{}",
      resultJson: "{}",
      createdAt: NOW,
      expiresAt: NOW - 1,
    };
    const storage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_room_processed_commands"))
        return [expired];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    expect(persistence.readProcessedCommand("request-1")).toBeNull();
    expect(
      storage.calls.some((call) =>
        call.sql.includes("DELETE FROM flarelobby_room_processed_commands"),
      ),
    ).toBe(true);
    persistence.purgeExpiredProcessedCommands(NOW);
  });

  it("スナップショット結果のパースとイベント記録・再開読取を行う", () => {
    const storage = createStorage();
    const persistence = new RoomPersistence(createDeps(storage));

    expect(persistence.parseRoomSnapshotResult('{"revision":5}')).toMatchObject(
      { revision: 5 },
    );

    // 未初期化では記録しない。
    persistence.recordRoomEvent({
      revision: 2,
      event: "room.snapshot",
      payload: {},
    } as never);
    expect(
      storage.calls.some((call) =>
        call.sql.includes("INSERT INTO flarelobby_room_events"),
      ),
    ).toBe(false);

    const withRoom = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      return [];
    });
    new RoomPersistence(createDeps(withRoom)).recordRoomEvent({
      revision: 2,
      event: "room.snapshot",
      payload: {},
    } as never);
    expect(
      withRoom.calls.some((call) =>
        call.sql.includes("INSERT INTO flarelobby_room_events"),
      ),
    ).toBe(true);

    // 範囲外の再開要求はスナップショットを使う。
    const resume = new RoomPersistence(createDeps(withRoom));
    expect(resume.readResumeEvents(null, 2)).toMatchObject({
      useSnapshot: true,
    });
    expect(resume.readResumeEvents(-1, 2)).toMatchObject({ useSnapshot: true });
    expect(resume.readResumeEvents(5, 2)).toMatchObject({ useSnapshot: true });

    // 履歴内はイベントを返す。
    const withEvents = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      if (sql.includes("FROM flarelobby_room_events"))
        return [{ eventId: 1, revision: 2, eventJson: '{"kind":"event"}' }];
      return [];
    });
    const resumed = new RoomPersistence(
      createDeps(withEvents),
    ).readResumeEvents(1, 2);
    expect(resumed.useSnapshot).toBe(false);
    expect(resumed.events).toHaveLength(1);

    // 空履歴は欠落とみなしてスナップショットを使う。
    const emptyHistory = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      return [];
    });
    expect(
      new RoomPersistence(createDeps(emptyHistory)).readResumeEvents(1, 2),
    ).toMatchObject({ useSnapshot: true, events: [] });

    // 最新版と一致する場合はイベントなしで再開できる。
    expect(
      new RoomPersistence(createDeps(emptyHistory)).readResumeEvents(2, 2),
    ).toMatchObject({ useSnapshot: false, events: [] });

    // 履歴上限を超える差分はスナップショットを使う。
    expect(
      new RoomPersistence(createDeps(withRoom)).readResumeEvents(1, 500),
    ).toMatchObject({ useSnapshot: true, events: [] });
  });

  it("WebSocket 接続の保存・切断・読取・無効化を行う", async () => {
    const attachment = {
      resumeId: "resume-1",
      roomId: "room-1",
      principal: { id: "principal-1", playerId: "player-1" },
      participantId: "participant-1",
      role: "player",
      connectedAt: NOW,
      connectionGeneration: "gen-1",
    };
    const connectionRow = {
      resumeId: "resume-1",
      roomId: "room-1",
      principalId: "principal-1",
      participantId: "participant-1",
      role: "player",
      connectedAt: NOW,
      disconnectedAt: null,
      connectionGeneration: "gen-1",
      resumeTokenExpiresAt: NOW + 3_600_000,
      invalidatedAt: null,
    };
    const storage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_room_connections"))
        return [connectionRow];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    persistence.storeWebSocketConnection(
      attachment as never,
      NOW + 3_600_000,
      false,
    );
    persistence.storeWebSocketConnection(
      attachment as never,
      NOW + 3_600_000,
      true,
    );
    expect(
      storage.calls.some((call) =>
        call.sql.includes("INSERT INTO flarelobby_room_connections"),
      ),
    ).toBe(true);
    expect(persistence.readRoomConnection("resume-1")).toEqual(connectionRow);

    // 世代一致の切断は記録される。
    await persistence.markWebSocketDisconnected(attachment as never);
    expect(
      storage.calls.some((call) =>
        call.sql.includes("SET disconnected_at = ?"),
      ),
    ).toBe(true);

    // 世代不一致・切断済み・無効化済み・不在は無視される。
    const stale = { ...attachment, connectionGeneration: "gen-0" };
    await persistence.markWebSocketDisconnected(stale as never);
    const disconnected = { ...connectionRow, disconnectedAt: NOW };
    const disconnectedStorage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_room_connections"))
        return [disconnected];
      return [];
    });
    await new RoomPersistence(
      createDeps(disconnectedStorage),
    ).markWebSocketDisconnected(attachment as never);
    const invalidated = { ...connectionRow, invalidatedAt: NOW };
    const invalidatedStorage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_room_connections"))
        return [invalidated];
      return [];
    });
    await new RoomPersistence(
      createDeps(invalidatedStorage),
    ).markWebSocketDisconnected(attachment as never);
    await new RoomPersistence(
      createDeps(createStorage()),
    ).markWebSocketDisconnected(attachment as never);

    persistence.invalidateResumeSessions("participant-1");
    persistence.cancelDisconnectOperation("participant-1");
    expect(
      storage.calls.some((call) => call.sql.includes("SET invalidated_at")),
    ).toBe(true);
  });

  it("参加者切断の予約と人数集計を行う", async () => {
    const joinedAt = "2026-08-11T00:00:00.000Z";
    const storage = createStorage((sql) => {
      if (sql.includes("FROM flarelobby_rooms")) return [roomRow()];
      if (sql.includes("MIN(due_at)")) return [{ nextDueAt: null }];
      return [];
    });
    const persistence = new RoomPersistence(createDeps(storage));

    await persistence.scheduleParticipantDisconnect("participant-1", joinedAt);
    expect(
      storage.calls.some((call) =>
        call.sql.includes("INSERT INTO flarelobby_room_scheduled_operations"),
      ),
    ).toBe(true);

    // 未初期化では予約しない。
    await new RoomPersistence(
      createDeps(createStorage()),
    ).scheduleParticipantDisconnect("participant-1", joinedAt);

    // 不正な時刻では予約しない。
    await persistence.scheduleParticipantDisconnect(
      "participant-1",
      "not-a-timestamp" as never,
    );

    const counts = createStorage(() => [
      { total: 3, players: 2, spectators: 1 },
    ]);
    expect(
      new RoomPersistence(createDeps(counts)).readParticipantCounts(),
    ).toEqual({ total: 3, players: 2, spectators: 1 });
  });
});
