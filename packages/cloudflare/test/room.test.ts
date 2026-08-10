import {
  evictDurableObject,
  env,
  runInDurableObject
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type {
  RoomInitializationOptions,
  RoomScheduledOperationOptions,
  RoomDurableObject
} from "../src/index.js";

function createRoomOptions(
  roomId: string,
  overrides: Partial<RoomInitializationOptions> = {}
): RoomInitializationOptions {
  return {
    room: {
      id: roomId,
      kind: "custom",
      invitationCode: "4F9K2D",
      visibility: "unlisted",
      settings: { map: "forest" },
      metadata: { title: "検証ルーム" }
    },
    host: {
      participantId: "participant-host",
      playerId: "player-host"
    },
    participants: [
      {
        kind: "player",
        id: "participant-host",
        player: { id: "player-host" },
        teamId: null,
        ready: false
      }
    ],
    teams: [{ id: "red" }, { id: "blue" }],
    maxPlayers: 4,
    finishedRoomRetentionMs: 60_000,
    ...overrides
  };
}

describe("Room Durable Object の永続状態とライフサイクル", () => {
  it("roomId から同じ Durable Object を解決し、初期化を冪等に実行する", async () => {
    const roomId = `room-init-${crypto.randomUUID()}`;
    const firstStub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const secondStub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const options = createRoomOptions(roomId);

    expect(env.FLARE_LOBBY_ROOMS.idFromName(roomId).toString()).toBe(
      env.FLARE_LOBBY_ROOMS.idFromName(roomId).toString()
    );

    const first = await firstStub.initialize(options);
    const second = await secondStub.initialize({
      ...options,
      participants: []
    });

    expect(second).toEqual(first);
    expect(second.revision).toBe(0);
    expect(second.participants).toHaveLength(1);

    const concurrentRoomId = `room-concurrent-${crypto.randomUUID()}`;
    const concurrentStub = env.FLARE_LOBBY_ROOMS.getByName(concurrentRoomId);
    const concurrentOptions = createRoomOptions(concurrentRoomId);
    const concurrent = await Promise.all([
      concurrentStub.initialize(concurrentOptions),
      concurrentStub.initialize(concurrentOptions)
    ]);

    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.participants).toHaveLength(1);

    await runInDurableObject(firstStub, async (_instance, state) => {
      const roomCount = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_rooms"
        )
        .one().count;
      const participantCount = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_room_participants"
        )
        .one().count;

      expect(roomCount).toBe(1);
      expect(participantCount).toBe(1);
    });
  });

  it("SQLite の状態を復元し、許可された遷移だけ revision を増加させる", async () => {
    const roomId = `room-transition-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const options = createRoomOptions(roomId);
    const initialized = await room.initialize(options);
    const preparingAt = new Date(Date.now() + 1_000).toISOString();
    const inProgressAt = new Date(Date.now() + 2_000).toISOString();

    const preparing = await room.transitionState({
      status: "preparing",
      at: preparingAt
    });
    expect(preparing.state).toEqual({
      status: "preparing",
      preparationStartedAt: preparingAt
    });
    expect(preparing.revision).toBe(initialized.revision + 1);

    const duplicatePreparing = await room.transition("preparing");
    expect(duplicatePreparing.revision).toBe(preparing.revision);

    const conflictCode = await runInDurableObject(
      room,
      async (instance: RoomDurableObject) => {
      try {
        await instance.transition("waiting");
      } catch (error) {
        return (error as { code?: string }).code;
      }

      return undefined;
      }
    );
    expect(conflictCode).toBe("CONFLICT");

    const inProgress = await room.transition("in_progress", inProgressAt);
    expect(inProgress.state).toEqual({
      status: "in_progress",
      startedAt: inProgressAt
    });
    expect(inProgress.revision).toBe(preparing.revision + 1);

    await evictDurableObject(room);
    const restored = await room.getSnapshot();
    expect(restored).toEqual(inProgress);

    const finished = await room.transition("finished");
    expect(finished.revision).toBe(inProgress.revision + 1);
    const finishedCode = await runInDurableObject(
      room,
      async (instance: RoomDurableObject) => {
      try {
        await instance.transition("preparing");
      } catch (error) {
        return (error as { code?: string }).code;
      }

      return undefined;
      }
    );
    expect(finishedCode).toBe("ROOM_FINISHED");
  });

  it("複数の期限を最も近い単一 Alarm で処理し、再実行しても重複しない", async () => {
    const roomId = `room-alarm-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(createRoomOptions(roomId));

    const now = Date.now();
    const later: RoomScheduledOperationOptions = {
      id: "later",
      dueAt: now + 10_000,
      payload: { name: "later" }
    };
    const earlier: RoomScheduledOperationOptions = {
      id: "earlier",
      dueAt: now + 2_000,
      payload: { name: "earlier" }
    };

    await room.scheduleOperation(later);
    await room.scheduleDeadline(earlier);

    expect(await room.getNextAlarm()).toBe(earlier.dueAt);
    await expect(room.listScheduledOperations()).resolves.toEqual([
      {
        id: "earlier",
        dueAt: earlier.dueAt,
        kind: "noop",
        payload: { name: "earlier" }
      },
      {
        id: "later",
        dueAt: later.dueAt,
        kind: "noop",
        payload: { name: "later" }
      }
    ]);

    await room.scheduleOperation({
      id: "due-now",
      dueAt: Date.now() - 1,
      payload: null
    });
    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    expect(await room.listScheduledOperations()).toEqual([
      {
        id: "earlier",
        dueAt: earlier.dueAt,
        kind: "noop",
        payload: { name: "earlier" }
      },
      {
        id: "later",
        dueAt: later.dueAt,
        kind: "noop",
        payload: { name: "later" }
      }
    ]);
  });

  it("終了済み Room を保持期間後に削除し、Alarm 再実行で状態を二重処理しない", async () => {
    const roomId = `room-retention-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(
      createRoomOptions(roomId, { finishedRoomRetentionMs: 0 })
    );

    await room.transition("finished", new Date(Date.now() - 1_000).toISOString());
    expect((await room.getSnapshot())?.state.status).toBe("finished");

    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });
    await expect(room.getSnapshot()).resolves.toBeNull();
    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });
    await expect(room.listScheduledOperations()).resolves.toEqual([]);
  });

  it("処理済みコマンドを SQLite に保存し、同じ requestId の再送を返す", async () => {
    const roomId = `room-command-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(createRoomOptions(roomId));

    const command = {
      requestId: "request-1",
      command: "room.set_ready",
      payload: { ready: true },
      result: { revision: 1 },
      createdAt: 1_000
    } as const;

    await expect(room.recordProcessedCommand(command)).resolves.toEqual(command);
    await expect(room.recordProcessedCommand(command)).resolves.toEqual(command);
    const conflictCode = await runInDurableObject(
      room,
      async (instance: RoomDurableObject) => {
      try {
        await instance.recordProcessedCommand({
          ...command,
          payload: { ready: false }
        });
      } catch (error) {
        return (error as { code?: string }).code;
      }

      return undefined;
      }
    );
    expect(conflictCode).toBe("CONFLICT");
  });
});
