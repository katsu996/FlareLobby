import {
  evictDurableObject,
  env,
  runInDurableObject
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Participant } from "@flarelobby/core";

import { createGatewayPrincipalEnvelope } from "../src/index.js";
import type {
  RoomInitializationOptions,
  RoomOperationResult,
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

async function createGatewayPrincipal(
  principalId: string,
  playerId = principalId
): Promise<{ readonly token: string }> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId }
  );

  if (!result.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }

  return result.value;
}

async function readErrorCode(
  operation: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await operation();
  } catch (error) {
    return (error as { code?: string }).code;
  }

  return undefined;
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

describe("Room Durable Object のカスタムルーム操作", () => {
  it("本人だけが準備状態と許可されたチームを変更できる", async () => {
    const roomId = `room-operations-self-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-self",
      "player-host"
    );
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-self",
      "player-self"
    );
    const outsiderPrincipal = await createGatewayPrincipal(
      "principal-outsider-self",
      "player-outsider"
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 2,
        minimumPlayers: 2,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false
          },
          {
            kind: "player",
            id: "participant-self",
            player: { id: "player-self" },
            teamId: null,
            ready: false
          }
        ]
      })
    );

    const ready = await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true
    });
    expect(ready.revision).toBe(1);
    expect(ready.participants[0]).toMatchObject({ ready: true });

    const selected = await room.selectTeam({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-self",
      teamId: "blue"
    });
    expect(selected.revision).toBeGreaterThan(ready.revision);
    expect(selected.participants).toContainEqual({
      kind: "player",
      id: "participant-self",
      player: { id: "player-self" },
      teamId: "blue",
      ready: false
    });

    expect(
      await readErrorCode(() =>
        room.selectTeam({
          gatewayPrincipal: playerPrincipal,
          participantId: "participant-self",
          teamId: "unknown"
        })
      )
    ).toBe("CONFLICT");

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: outsiderPrincipal,
          participantId: "participant-host",
          ready: false
        })
      )
    ).toBe("FORBIDDEN");

    const disconnected = await room.disconnect({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host"
    });
    expect(disconnected.host).toEqual({
      participantId: "participant-host",
      playerId: "player-host"
    });
    expect(disconnected.revision).toBe(selected.revision);
  });

  it("ホストだけが設定更新・移譲・強制退出を実行できる", async () => {
    const roomId = `room-operations-host-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-operation",
      "player-host"
    );
    const playerOnePrincipal = await createGatewayPrincipal(
      "principal-player-one-operation",
      "player-one"
    );
    const playerTwoPrincipal = await createGatewayPrincipal(
      "principal-player-two-operation",
      "player-two"
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 3,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false
          },
          {
            kind: "player",
            id: "participant-one",
            player: { id: "player-one" },
            teamId: null,
            ready: false
          },
          {
            kind: "player",
            id: "participant-two",
            player: { id: "player-two" },
            teamId: null,
            ready: false
          }
        ]
      })
    );

    const updated = await room.updateSettings({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      settings: { map: "desert" }
    });
    expect(updated.room.settings).toEqual({ map: "desert" });

    expect(
      await readErrorCode(() =>
        room.updateSettings({
          gatewayPrincipal: playerOnePrincipal,
          participantId: "participant-one",
          settings: { map: "cheat" }
        })
      )
    ).toBe("FORBIDDEN");

    const transferred = await room.transferHost({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      targetParticipantId: "participant-one",
      requestId: "transfer-host-once"
    });
    expect(transferred.host).toEqual({
      participantId: "participant-one",
      playerId: "player-one"
    });
    expect(transferred.revision).toBeGreaterThan(updated.revision);

    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          targetParticipantId: "participant-two"
        })
      )
    ).toBe("FORBIDDEN");

    const kicked = await room.kick({
      gatewayPrincipal: playerOnePrincipal,
      participantId: "participant-one",
      targetPlayerId: "player-two",
      reason: "AFK"
    });
    expect(kicked.revision).toBeGreaterThan(transferred.revision);
    expect(kicked.participants.map((participant: Participant) => participant.id)).toEqual([
      "participant-host",
      "participant-one"
    ]);

    expect(
      await readErrorCode(() =>
        room.startMatch({
          gatewayPrincipal: playerTwoPrincipal,
          participantId: "participant-two"
        })
      )
    ).toBe("FORBIDDEN");
  });

  it("ホスト退出時に最古のプレイヤーへ自動移譲する", async () => {
    const roomId = `room-operations-leave-host-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-leave",
      "player-host"
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 3,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false
          },
          {
            kind: "player",
            id: "participant-oldest",
            player: { id: "player-oldest" },
            teamId: null,
            ready: false
          },
          {
            kind: "player",
            id: "participant-newest",
            player: { id: "player-newest" },
            teamId: null,
            ready: false
          }
        ]
      })
    );

    await runInDurableObject(room, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE flarelobby_room_participants
         SET joined_at = CASE participant_id
           WHEN 'participant-host' THEN 10
           WHEN 'participant-oldest' THEN 20
           WHEN 'participant-newest' THEN 30
         END`
      );
    });

    const left = await room.leave({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      role: "player",
      requestId: "host-leave-once"
    });
    expect(left.snapshot.host).toEqual({
      participantId: "participant-oldest",
      playerId: "player-oldest"
    });
    expect(left.snapshot.participants.map((participant: Participant) => participant.id)).toEqual([
      "participant-oldest",
      "participant-newest"
    ]);

    const resent = await room.leave({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      role: "player",
      requestId: "host-leave-once"
    });
    expect(resent).toEqual(left);
  });

  it("開始条件を検証し、準備完了後に対戦中へ遷移する", async () => {
    const roomId = `room-operations-start-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-start",
      "player-host"
    );
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-start",
      "player-start"
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 3,
        minimumPlayers: 2,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false
          },
          {
            kind: "player",
            id: "participant-start",
            player: { id: "player-start" },
            teamId: null,
            ready: false
          }
        ]
      })
    );

    expect(
      await readErrorCode(() =>
        room.startMatch({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          at: "2026-08-11T00:00:00.000Z"
        })
      )
    ).toBe("CONFLICT");

    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true
    });
    await room.setReady({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-start",
      ready: true
    });

    const started = await room.startMatch({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      at: "2026-08-11T00:00:00.000Z"
    });
    expect(started.state).toEqual({
      status: "in_progress",
      startedAt: "2026-08-11T00:00:00.000Z"
    });
    expect(started.revision).toBe(4);

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: false
        })
      )
    ).toBe("CONFLICT");
  });

  it("同じ要求 ID の再送では revision を二重に増やさず、閉鎖後の操作を拒否する", async () => {
    const roomId = `room-operations-idempotency-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-idempotency",
      "player-host"
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 1,
        minimumPlayers: 1,
        finishedRoomRetentionMs: 60_000
      })
    );

    const readyResults = await Promise.all(
      Array.from({ length: 3 }, () =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: true,
          requestId: "ready-once"
        })
      )
    );
    expect(new Set(readyResults.map((result: RoomOperationResult) => result.revision))).toEqual(
      new Set([1])
    );
    expect((await room.getSnapshot())?.revision).toBe(1);

    const closeResults = await Promise.all(
      Array.from({ length: 2 }, () =>
        room.close({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          requestId: "close-once",
          at: "2026-08-11T00:01:00.000Z"
        })
      )
    );
    expect(new Set(closeResults.map((result: RoomOperationResult) => result.revision))).toEqual(
      new Set([2])
    );
    expect(closeResults[0]?.state.status).toBe("finished");

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: false
        })
      )
    ).toBe("ROOM_FINISHED");
    expect(
      await readErrorCode(() =>
        room.updateSettings({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          settings: { map: "desert" }
        })
      )
    ).toBe("ROOM_FINISHED");
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "player"
        })
      )
    ).toBe("ROOM_FINISHED");
  });
});
