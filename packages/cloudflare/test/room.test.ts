import { evictDurableObject, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Participant, JsonValue } from "@flarelobby/core";

import { createGatewayPrincipalEnvelope } from "../src/index.js";
import type {
  RoomInitializationOptions,
  RoomOperationResult,
  RoomScheduledOperationOptions,
  RoomScheduledOperationKind,
  RoomScheduledOperation,
  RoomStateTransitionOptions,
  RoomDurableObject,
} from "../src/index.js";

function createRoomOptions(
  roomId: string,
  overrides: Partial<RoomInitializationOptions> = {},
): RoomInitializationOptions {
  return {
    room: {
      id: roomId,
      kind: "custom",
      invitationCode: "4F9K2D",
      visibility: "unlisted",
      settings: { map: "forest" },
      metadata: { title: "検証ルーム" },
    },
    host: {
      participantId: "participant-host",
      playerId: "player-host",
    },
    participants: [
      {
        kind: "player",
        id: "participant-host",
        player: { id: "player-host" },
        teamId: null,
        ready: false,
      },
    ],
    teams: [{ id: "red" }, { id: "blue" }],
    maxPlayers: 4,
    finishedRoomRetentionMs: 60_000,
    ...overrides,
  };
}

async function createGatewayPrincipal(
  principalId: string,
  playerId = principalId,
): Promise<{ readonly token: string }> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId },
  );

  if (!result.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }

  return result.value;
}

async function readErrorCode(
  operation: () => Promise<unknown>,
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
      env.FLARE_LOBBY_ROOMS.idFromName(roomId).toString(),
    );

    const first = await firstStub.initialize(options);
    const second = await secondStub.initialize({
      ...options,
      participants: [],
    });

    expect(second).toEqual(first);
    expect(second.revision).toBe(0);
    expect(second.participants).toHaveLength(1);

    const concurrentRoomId = `room-concurrent-${crypto.randomUUID()}`;
    const concurrentStub = env.FLARE_LOBBY_ROOMS.getByName(concurrentRoomId);
    const concurrentOptions = createRoomOptions(concurrentRoomId);
    const concurrent = await Promise.all([
      concurrentStub.initialize(concurrentOptions),
      concurrentStub.initialize(concurrentOptions),
    ]);

    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.participants).toHaveLength(1);

    await runInDurableObject(firstStub, async (_instance, state) => {
      const roomCount = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_rooms",
        )
        .one().count;
      const participantCount = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_room_participants",
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
      at: preparingAt,
    });
    expect(preparing.state).toEqual({
      status: "preparing",
      preparationStartedAt: preparingAt,
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
      },
    );
    expect(conflictCode).toBe("CONFLICT");

    const inProgress = await room.transition("in_progress", inProgressAt);
    expect(inProgress.state).toEqual({
      status: "in_progress",
      startedAt: inProgressAt,
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
      },
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
      payload: { name: "later" },
    };
    const earlier: RoomScheduledOperationOptions = {
      id: "earlier",
      dueAt: now + 2_000,
      payload: { name: "earlier" },
    };

    await room.scheduleOperation(later);
    await room.scheduleDeadline(earlier);

    expect(await room.getNextAlarm()).toBe(earlier.dueAt);
    await expect(room.listScheduledOperations()).resolves.toEqual([
      {
        id: "earlier",
        dueAt: earlier.dueAt,
        kind: "noop",
        payload: { name: "earlier" },
      },
      {
        id: "later",
        dueAt: later.dueAt,
        kind: "noop",
        payload: { name: "later" },
      },
    ]);

    await room.scheduleOperation({
      id: "due-now",
      dueAt: Date.now() - 1,
      payload: null,
    });
    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    expect(await room.listScheduledOperations()).toEqual([
      {
        id: "earlier",
        dueAt: earlier.dueAt,
        kind: "noop",
        payload: { name: "earlier" },
      },
      {
        id: "later",
        dueAt: later.dueAt,
        kind: "noop",
        payload: { name: "later" },
      },
    ]);
  });

  it("終了済み Room を保持期間後に削除し、Alarm 再実行で状態を二重処理しない", async () => {
    const roomId = `room-retention-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(
      createRoomOptions(roomId, { finishedRoomRetentionMs: 0 }),
    );

    await room.transition(
      "finished",
      new Date(Date.now() - 1_000).toISOString(),
    );
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
      createdAt: 1_000,
    } as const;

    await expect(room.recordProcessedCommand(command)).resolves.toEqual(
      command,
    );
    await expect(room.recordProcessedCommand(command)).resolves.toEqual(
      command,
    );
    const conflictCode = await runInDurableObject(
      room,
      async (instance: RoomDurableObject) => {
        try {
          await instance.recordProcessedCommand({
            ...command,
            payload: { ready: false },
          });
        } catch (error) {
          return (error as { code?: string }).code;
        }

        return undefined;
      },
    );
    expect(conflictCode).toBe("CONFLICT");
  });

  it("状態イベント履歴を上限件数で保持し、古い履歴を削除する", async () => {
    const roomId = `room-event-history-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      `principal-event-history-${crypto.randomUUID()}`,
      "player-host",
    );

    await room.initialize(
      createRoomOptions(roomId, {
        eventHistoryLimit: 2,
      }),
    );

    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true,
    });
    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: false,
    });
    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true,
    });

    await runInDurableObject(room, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ revision: number }>(
            "SELECT revision FROM flarelobby_room_events ORDER BY revision ASC",
          )
          .toArray()
          .map((event) => event.revision),
      ).toEqual([2, 3]);
    });
  });

  it("ホストの切断猶予終了後に最古のプレイヤーへ自動移譲する", async () => {
    const roomId = `room-disconnect-grace-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      `principal-disconnect-grace-${crypto.randomUUID()}`,
      "player-host",
    );

    await room.initialize(
      createRoomOptions(roomId, {
        disconnectGracePeriodMs: 0,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: true,
          },
          {
            kind: "player",
            id: "participant-oldest",
            player: { id: "player-oldest" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );

    const disconnectedAt = new Date(Date.now() - 1_000).toISOString();
    await room.disconnect({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      role: "player",
      at: disconnectedAt,
    });

    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const snapshot = await room.getSnapshot();
    if (snapshot === null) {
      throw new Error("切断猶予処理後のスナップショットがありません。");
    }

    expect(snapshot.host).toEqual({
      participantId: "participant-oldest",
      playerId: "player-oldest",
    });
    expect(
      snapshot.participants.map((participant: Participant) => participant.id),
    ).toEqual(["participant-oldest"]);
    expect(snapshot.revision).toBe(1);
  });
});

describe("Room Durable Object のカスタムルーム操作", () => {
  it("本人だけが準備状態と許可されたチームを変更できる", async () => {
    const roomId = `room-operations-self-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-self",
      "player-host",
    );
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-self",
      "player-self",
    );
    const outsiderPrincipal = await createGatewayPrincipal(
      "principal-outsider-self",
      "player-outsider",
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
            ready: false,
          },
          {
            kind: "player",
            id: "participant-self",
            player: { id: "player-self" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );

    const ready = await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true,
    });
    expect(ready.revision).toBe(1);
    expect(ready.participants[0]).toMatchObject({ ready: true });

    const selected = await room.selectTeam({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-self",
      teamId: "blue",
    });
    expect(selected.revision).toBeGreaterThan(ready.revision);
    expect(selected.participants).toContainEqual({
      kind: "player",
      id: "participant-self",
      player: { id: "player-self" },
      teamId: "blue",
      ready: false,
    });

    expect(
      await readErrorCode(() =>
        room.selectTeam({
          gatewayPrincipal: playerPrincipal,
          participantId: "participant-self",
          teamId: "unknown",
        }),
      ),
    ).toBe("CONFLICT");

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: outsiderPrincipal,
          participantId: "participant-host",
          ready: false,
        }),
      ),
    ).toBe("FORBIDDEN");

    const disconnected = await room.disconnect({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
    });
    expect(disconnected.host).toEqual({
      participantId: "participant-host",
      playerId: "player-host",
    });
    expect(disconnected.revision).toBe(selected.revision);
  });

  it("ホストだけが設定更新・移譲・強制退出を実行できる", async () => {
    const roomId = `room-operations-host-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-operation",
      "player-host",
    );
    const playerOnePrincipal = await createGatewayPrincipal(
      "principal-player-one-operation",
      "player-one",
    );
    const playerTwoPrincipal = await createGatewayPrincipal(
      "principal-player-two-operation",
      "player-two",
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
            ready: false,
          },
          {
            kind: "player",
            id: "participant-one",
            player: { id: "player-one" },
            teamId: null,
            ready: false,
          },
          {
            kind: "player",
            id: "participant-two",
            player: { id: "player-two" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );

    const updated = await room.updateSettings({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      settings: { map: "desert" },
    });
    expect(updated.room.settings).toEqual({ map: "desert" });

    expect(
      await readErrorCode(() =>
        room.updateSettings({
          gatewayPrincipal: playerOnePrincipal,
          participantId: "participant-one",
          settings: { map: "cheat" },
        }),
      ),
    ).toBe("FORBIDDEN");

    const transferred = await room.transferHost({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      targetParticipantId: "participant-one",
      requestId: "transfer-host-once",
    });
    expect(transferred.host).toEqual({
      participantId: "participant-one",
      playerId: "player-one",
    });
    expect(transferred.revision).toBeGreaterThan(updated.revision);

    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          targetParticipantId: "participant-two",
        }),
      ),
    ).toBe("FORBIDDEN");

    const kicked = await room.kick({
      gatewayPrincipal: playerOnePrincipal,
      participantId: "participant-one",
      targetPlayerId: "player-two",
      reason: "AFK",
    });
    expect(kicked.revision).toBeGreaterThan(transferred.revision);
    expect(
      kicked.participants.map((participant: Participant) => participant.id),
    ).toEqual(["participant-host", "participant-one"]);

    expect(
      await readErrorCode(() =>
        room.startMatch({
          gatewayPrincipal: playerTwoPrincipal,
          participantId: "participant-two",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("ホスト退出時に最古のプレイヤーへ自動移譲する", async () => {
    const roomId = `room-operations-leave-host-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-leave",
      "player-host",
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
            ready: false,
          },
          {
            kind: "player",
            id: "participant-oldest",
            player: { id: "player-oldest" },
            teamId: null,
            ready: false,
          },
          {
            kind: "player",
            id: "participant-newest",
            player: { id: "player-newest" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );

    await runInDurableObject(room, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE flarelobby_room_participants
         SET joined_at = CASE participant_id
           WHEN 'participant-host' THEN 10
           WHEN 'participant-oldest' THEN 20
           WHEN 'participant-newest' THEN 30
         END`,
      );
    });

    const left = await room.leave({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      role: "player",
      requestId: "host-leave-once",
    });
    expect(left.snapshot.host).toEqual({
      participantId: "participant-oldest",
      playerId: "player-oldest",
    });
    expect(
      left.snapshot.participants.map(
        (participant: Participant) => participant.id,
      ),
    ).toEqual(["participant-oldest", "participant-newest"]);

    const resent = await room.leave({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      role: "player",
      requestId: "host-leave-once",
    });
    expect(resent).toEqual(left);
  });

  it("開始条件を検証し、準備完了後に対戦中へ遷移する", async () => {
    const roomId = `room-operations-start-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-start",
      "player-host",
    );
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-start",
      "player-start",
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
            ready: false,
          },
          {
            kind: "player",
            id: "participant-start",
            player: { id: "player-start" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );

    expect(
      await readErrorCode(() =>
        room.startMatch({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          at: "2026-08-11T00:00:00.000Z",
        }),
      ),
    ).toBe("CONFLICT");

    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true,
    });
    await room.setReady({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-start",
      ready: true,
    });

    const started = await room.startMatch({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      at: "2026-08-11T00:00:00.000Z",
    });
    expect(started.state).toEqual({
      status: "in_progress",
      startedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(started.revision).toBe(4);

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: false,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("同じ要求 ID の再送では revision を二重に増やさず、閉鎖後の操作を拒否する", async () => {
    const roomId = `room-operations-idempotency-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-idempotency",
      "player-host",
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 1,
        minimumPlayers: 1,
        finishedRoomRetentionMs: 60_000,
      }),
    );

    const readyResults = await Promise.all(
      Array.from({ length: 3 }, () =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: true,
          requestId: "ready-once",
        }),
      ),
    );
    expect(
      new Set(
        readyResults.map((result: RoomOperationResult) => result.revision),
      ),
    ).toEqual(new Set([1]));
    expect((await room.getSnapshot())?.revision).toBe(1);

    const closeAt = new Date(Date.now() + 1_000).toISOString();
    const closeResults = await Promise.all(
      Array.from({ length: 2 }, () =>
        room.close({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          requestId: "close-once",
          at: closeAt,
        }),
      ),
    );
    expect(
      new Set(
        closeResults.map((result: RoomOperationResult) => result.revision),
      ),
    ).toEqual(new Set([2]));
    expect(closeResults[0]?.state.status).toBe("finished");

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: false,
        }),
      ),
    ).toBe("ROOM_FINISHED");
    expect(
      await readErrorCode(() =>
        room.updateSettings({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          settings: { map: "desert" },
        }),
      ),
    ).toBe("ROOM_FINISHED");
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "player",
        }),
      ),
    ).toBe("ROOM_FINISHED");
  });
});

describe("Room Durable Object の参加認証と入力検証", () => {
  it("招待コード制ルームは正しい招待コードでの参加だけを許可する", async () => {
    const roomId = `room-join-invitation-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(
      createRoomOptions(roomId, {
        joinMethod: "invitation",
        maxPlayers: 4,
      }),
    );
    const joiner = await createGatewayPrincipal(
      `principal-invitation-${crypto.randomUUID()}`,
      "player-invitation",
    );

    expect(
      await readErrorCode(() =>
        room.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: joiner,
          role: "player",
          invitationCode: "000000",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: joiner,
          role: "player",
          invitationCode: "",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: joiner,
          role: "player",
          invitationCode: "A".repeat(129),
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const joined = await room.join({
      gatewayPrincipal: joiner,
      role: "player",
      // 小文字で指定しても大文字へ正規化されて照合されます。
      invitationCode: "4f9k2d",
    });
    expect(joined.role).toBe("player");
    expect(joined.snapshot.participants).toContainEqual({
      kind: "player",
      id: joined.participantId,
      player: { id: "player-invitation" },
      teamId: null,
      ready: false,
    });
  });

  it("パスワード制ルームは保存したハッシュと一致するパスワードでの参加だけを許可する", async () => {
    const roomId = `room-join-password-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(
      createRoomOptions(roomId, {
        joinMethod: "password",
        password: "room-pass-1234",
        maxPlayers: 4,
      }),
    );
    const joiner = await createGatewayPrincipal(
      `principal-password-${crypto.randomUUID()}`,
      "player-password",
    );

    expect(
      await readErrorCode(() =>
        room.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: joiner,
          role: "player",
          password: "wrong-pass",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await readErrorCode(() =>
        room.join({ gatewayPrincipal: joiner, role: "player", password: "" }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: joiner,
          role: "player",
          password: "p".repeat(129),
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const joined = await room.join({
      gatewayPrincipal: joiner,
      role: "player",
      password: "room-pass-1234",
    });
    expect(joined.role).toBe("player");
    expect(joined.snapshot.participants).toHaveLength(2);
  });

  it("対戦ルームはホストや既定参加者なしで初期化され、Pool を検証する", async () => {
    const roomId = `room-init-match-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const pool = {
      id: "pool-match-init",
      gameId: "game-1",
      seasonId: "season-1",
      mode: "casual",
      region: "ap-northeast-1",
      maxPartySize: 2,
      teamSize: 1,
    } as const;

    const initialized = await room.initialize({
      room: {
        id: roomId,
        kind: "match",
        matchId: `match-${crypto.randomUUID()}`,
        pool,
        settings: {},
        metadata: {},
      },
    });

    expect(initialized.room).toMatchObject({ kind: "match", pool });
    expect(initialized.host).toBeUndefined();
    expect(initialized.participants).toEqual([]);
    expect(initialized.teams).toEqual([]);

    const brokenPoolRoomId = `room-init-match-broken-${crypto.randomUUID()}`;
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(brokenPoolRoomId).initialize({
          room: {
            id: brokenPoolRoomId,
            kind: "match",
            matchId: `match-${crypto.randomUUID()}`,
            pool: { ...pool, region: "" },
            settings: {},
            metadata: {},
          },
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
  });

  it("初期化時の設定・参加者・チームの入力を検証する", async () => {
    // settings がオブジェクトでないカスタムルーム
    const invalidSettingsRoomId = `room-init-settings-${crypto.randomUUID()}`;
    const invalidSettingsOptions = createRoomOptions(invalidSettingsRoomId);
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(invalidSettingsRoomId).initialize({
          ...invalidSettingsOptions,
          room: {
            ...invalidSettingsOptions.room,
            settings: [
              "broken",
            ] as unknown as typeof invalidSettingsOptions.room.settings,
          },
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    // 参加者 ID の重複
    const duplicateParticipantRoomId = `room-init-duplicate-participant-${crypto.randomUUID()}`;
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(duplicateParticipantRoomId).initialize(
          createRoomOptions(duplicateParticipantRoomId, {
            participants: [
              {
                kind: "player",
                id: "participant-host",
                player: { id: "player-host" },
                teamId: null,
                ready: false,
              },
              {
                kind: "player",
                id: "participant-host",
                player: { id: "player-host" },
                teamId: null,
                ready: true,
              },
            ],
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");

    // プレイヤー参加者に準備状態がない
    const missingReadyRoomId = `room-init-missing-ready-${crypto.randomUUID()}`;
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(missingReadyRoomId).initialize(
          createRoomOptions(missingReadyRoomId, {
            participants: [
              {
                kind: "player",
                id: "participant-host",
                player: { id: "player-host" },
                teamId: null,
              },
            ] as unknown as Participant[],
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");

    // 不明な参加者種別
    const unknownKindRoomId = `room-init-unknown-kind-${crypto.randomUUID()}`;
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(unknownKindRoomId).initialize(
          createRoomOptions(unknownKindRoomId, {
            participants: [
              {
                kind: "moderator",
                id: "participant-moderator",
                player: { id: "player-moderator" },
              },
            ] as unknown as Participant[],
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");

    // チーム ID の重複
    const duplicateTeamRoomId = `room-init-duplicate-team-${crypto.randomUUID()}`;
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(duplicateTeamRoomId).initialize(
          createRoomOptions(duplicateTeamRoomId, {
            teams: [{ id: "red" }, { id: "red" }],
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");

    // チームが配列でない
    const nonArrayTeamsRoomId = `room-init-non-array-teams-${crypto.randomUUID()}`;
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(nonArrayTeamsRoomId).initialize(
          createRoomOptions(nonArrayTeamsRoomId, {
            teams: "red" as unknown as [{ id: string }],
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");

    // 観戦者はチームも準備状態も持たずに登録される
    const spectatorRoomId = `room-init-spectator-${crypto.randomUUID()}`;
    const spectatorRoom = env.FLARE_LOBBY_ROOMS.getByName(spectatorRoomId);
    await spectatorRoom.initialize(
      createRoomOptions(spectatorRoomId, {
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false,
          },
          {
            kind: "spectator",
            id: "participant-spectator",
            player: { id: "player-spectator" },
          },
        ],
      }),
    );
    const spectatorSnapshot = await spectatorRoom.getSnapshot();
    expect(spectatorSnapshot?.participants).toContainEqual({
      kind: "spectator",
      id: "participant-spectator",
      player: { id: "player-spectator" },
    });
  });

  it("状態遷移・期限処理・処理済みコマンドの入力を検証する", async () => {
    const roomId = `room-validation-state-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(createRoomOptions(roomId));

    // 不明な状態
    expect(
      await readErrorCode(() =>
        room.transitionState({
          status: "unknown",
          at: new Date().toISOString(),
        } as unknown as RoomStateTransitionOptions),
      ),
    ).toBe("INVALID_PAYLOAD");
    // 不正な状態変更時刻
    expect(
      await readErrorCode(() =>
        room.transitionState({
          status: "preparing",
          at: "not-a-timestamp",
        } as RoomStateTransitionOptions),
      ),
    ).toBe("INVALID_PAYLOAD");

    // 期限処理の識別子と期限
    expect(
      await readErrorCode(() =>
        room.scheduleOperation({ id: "", dueAt: Date.now() + 1_000 }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.scheduleOperation({ id: "op-invalid-due", dueAt: -1 }),
      ),
    ).toBe("INVALID_PAYLOAD");
    // 不明な期限処理種別
    expect(
      await readErrorCode(() =>
        room.scheduleOperation({
          id: "op-unknown-kind",
          dueAt: Date.now() + 1_000,
          kind: "bogus" as RoomScheduledOperationKind,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    // 保持期限用の識別子は保持期限以外で予約できない
    expect(
      await readErrorCode(() =>
        room.scheduleOperation({
          id: "__flarelobby_room_retention__",
          dueAt: Date.now() + 1_000,
          kind: "noop",
        }),
      ),
    ).toBe("CONFLICT");
    // JSON 値にならない payload
    expect(
      await runInDurableObject(room, (instance: RoomDurableObject) =>
        readErrorCode(() =>
          instance.scheduleOperation({
            id: "op-non-json-payload",
            dueAt: Date.now() + 1_000,
            payload: (() => undefined) as unknown as JsonValue,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");

    // 処理済みコマンドの入力
    expect(
      await readErrorCode(() =>
        room.recordProcessedCommand({
          requestId: "",
          command: "room.set_ready",
          payload: null,
          result: null,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.recordProcessedCommand({
          requestId: "request-validation",
          command: "room.set_ready",
          payload: null,
          result: null,
          createdAt: -1,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
  });

  it("操作の要求 ID を検証する", async () => {
    const roomId = `room-validation-request-id-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      `principal-host-request-id-${crypto.randomUUID()}`,
      "player-host",
    );
    await room.initialize(createRoomOptions(roomId));

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: true,
          requestId: "",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect((await room.getSnapshot())?.revision).toBe(0);
  });
  it("参加の事前条件を個別に拒否し、同一主体の再参加を収束させる", async () => {
    const joiner = await createGatewayPrincipal(
      `principal-join-precondition-${crypto.randomUUID()}`,
      "player-join-precondition",
    );

    // 対戦ルームには参加できない
    const matchRoomId = `room-join-match-${crypto.randomUUID()}`;
    const matchRoom = env.FLARE_LOBBY_ROOMS.getByName(matchRoomId);
    await matchRoom.initialize({
      room: {
        id: matchRoomId,
        kind: "match",
        matchId: `match-${crypto.randomUUID()}`,
        pool: {
          id: "pool-join-precondition",
          gameId: "game-1",
          seasonId: "season-1",
          mode: "casual",
          region: "ap-northeast-1",
        },
        settings: {},
        metadata: {},
      },
    });
    expect(
      await readErrorCode(() =>
        matchRoom.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("CONFLICT");

    // 定員が空いていないカスタムルーム
    const fullRoomId = `room-join-full-${crypto.randomUUID()}`;
    const fullRoom = env.FLARE_LOBBY_ROOMS.getByName(fullRoomId);
    const hostPrincipal = await createGatewayPrincipal(
      `principal-join-host-${crypto.randomUUID()}`,
      "player-host",
    );
    await fullRoom.initialize(createRoomOptions(fullRoomId, { maxPlayers: 1 }));
    expect(
      await readErrorCode(() =>
        fullRoom.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("ROOM_FULL");

    // 同じ主体を別の役割で重複参加させられない
    expect(
      await readErrorCode(() =>
        fullRoom.join({
          gatewayPrincipal: hostPrincipal,
          role: "spectator",
        }),
      ),
    ).toBe("CONFLICT");

    // 同じ役割での再参加は既存の参加者として収束する
    const rejoined = await fullRoom.join({
      gatewayPrincipal: hostPrincipal,
      role: "player",
    });
    expect(rejoined.participantId).toBe("participant-host");

    // 閉鎖済みルームには参加できない
    await fullRoom.close({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
    });
    expect(
      await readErrorCode(() =>
        fullRoom.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("ROOM_FINISHED");
  });
});

describe("Room Durable Object のホスト操作の冪等性と対象検証", () => {
  it("移譲と強制退出の対象・同一要求 ID の再送を個別に検証する", async () => {
    const roomId = `room-host-ops-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-host-ops",
      "player-host",
    );
    const successorPrincipal = await createGatewayPrincipal(
      "principal-successor-host-ops",
      "player-two",
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 4,
        minimumPlayers: 2,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false,
          },
          {
            kind: "player",
            id: "participant-two",
            player: { id: "player-two" },
            teamId: null,
            ready: false,
          },
          {
            kind: "spectator",
            id: "participant-spec",
            player: { id: "player-spec" },
          },
        ],
      }),
    );

    expect(
      await readErrorCode(() =>
        room.transferHost({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          targetParticipantId: "   ",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.transferHost({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          targetParticipantId: "participant-host",
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await readErrorCode(() =>
        room.transferHost({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          targetParticipantId: "participant-spec",
        }),
      ),
    ).toBe("CONFLICT");

    const transferred = await room.transferHost({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      targetParticipantId: "participant-two",
      requestId: "transfer-host-coverage",
    });
    // 一度目の移譲でホストが変わるため、一度ホストを戻してから同一要求
    // ID の再送（移譲後に遅延到着した再送）を検証する。
    await room.transferHost({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
      targetParticipantId: "participant-host",
      requestId: "transfer-host-back",
    });
    const transferredReplay = await room.transferHost({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      targetParticipantId: "participant-two",
      requestId: "transfer-host-coverage",
    });
    expect(transferredReplay).toEqual(transferred);
    expect(transferredReplay.host).toEqual({
      participantId: "participant-two",
      playerId: "player-two",
    });
    // 以降の操作に備えてホストを participant-two へ戻す。
    await room.transferHost({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      targetParticipantId: "participant-two",
      requestId: "transfer-host-forward",
    });

    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
          targetParticipantId: "participant-host",
          targetPlayerId: "player-host",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
          targetPlayerId: "p".repeat(257),
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
          targetPlayerId: "player-host",
          reason: "r".repeat(257),
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
          targetParticipantId: "participant-missing",
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await readErrorCode(() =>
        room.kick({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
          targetParticipantId: "participant-two",
        }),
      ),
    ).toBe("CONFLICT");

    const kicked = await room.kick({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
      targetPlayerId: "player-spec",
      reason: "AFK",
      requestId: "kick-coverage",
    });
    const kickedReplay = await room.kick({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
      targetPlayerId: "player-spec",
      reason: "AFK",
      requestId: "kick-coverage",
    });
    expect(kickedReplay).toEqual(kicked);
    expect(
      kicked.participants.map((participant: Participant) => participant.id),
    ).toEqual(["participant-host", "participant-two"]);

    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true,
    });
    await room.setReady({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
      ready: true,
    });

    expect(
      await readErrorCode(() =>
        room.startMatch({
          gatewayPrincipal: successorPrincipal,
          participantId: "participant-two",
          at: "invalid-timestamp",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const started = await room.startMatch({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
      at: "2026-08-11T00:00:00.000Z",
      requestId: "start-match-coverage",
    });
    const startedReplay = await room.startMatch({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
      at: "2026-08-11T00:00:00.000Z",
      requestId: "start-match-coverage",
    });
    expect(startedReplay).toEqual(started);
    expect(started.state.status).toBe("in_progress");

    const closed = await room.closeRoom({
      gatewayPrincipal: successorPrincipal,
      participantId: "participant-two",
    });
    expect(closed.state.status).toBe("finished");
  });

  it("設定更新・退出・操作の同一要求 ID 異再送を拒否する", async () => {
    const roomId = `room-replay-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-replay",
      "player-host",
    );
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-replay",
      "player-two",
    );

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 2,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false,
          },
          {
            kind: "player",
            id: "participant-two",
            player: { id: "player-two" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );

    const updated = await room.updateSettings({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      settings: { map: "desert" },
      requestId: "update-settings-coverage",
    });
    const updatedReplay = await room.updateSettings({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      settings: { map: "desert" },
      requestId: "update-settings-coverage",
    });
    expect(updatedReplay).toEqual(updated);
    expect(updatedReplay.room.settings).toEqual({ map: "desert" });

    const left = await room.leave({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-two",
      role: "player",
      requestId: "leave-coverage",
    });
    expect(left.participantId).toBe("participant-two");
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "player",
          requestId: "leave-coverage",
        }),
      ),
    ).toBe("CONFLICT");

    await room.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      ready: true,
      requestId: "ready-duplicate",
    });
    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: false,
          requestId: "ready-duplicate",
        }),
      ),
    ).toBe("CONFLICT");

    const leftAlias = await room.leaveParticipant({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      role: "player",
    });
    expect(leftAlias.snapshot.participants).toEqual([]);
    expect(leftAlias.snapshot.state.status).toBe("finished");
    const operations = await room.listScheduledOperations();
    expect(
      operations.map((operation: RoomScheduledOperation) => operation.kind),
    ).toContain("room_retention");
  });

  it("観戦者・無効な主体・無効なチーム指定を個別に拒否する", async () => {
    const roomId = `room-permissions-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-permissions",
      "player-host",
    );
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-permissions",
      "player-two",
    );
    const spectatorPrincipal = await createGatewayPrincipal(
      "principal-spectator-permissions",
      "player-spectator",
    );
    const invalidPrincipal = {
      token: "invalid-token",
    } as unknown as Parameters<typeof room.setReady>[0]["gatewayPrincipal"];

    await room.initialize(
      createRoomOptions(roomId, {
        maxPlayers: 4,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false,
          },
          {
            kind: "player",
            id: "participant-two",
            player: { id: "player-two" },
            teamId: null,
            ready: false,
          },
          {
            kind: "spectator",
            id: "participant-spec",
            player: { id: "player-spectator" },
          },
        ],
      }),
    );

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: spectatorPrincipal,
          participantId: "participant-spec",
          ready: true,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await readErrorCode(() =>
        room.selectTeam({
          gatewayPrincipal: spectatorPrincipal,
          participantId: "participant-spec",
          teamId: "red",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await readErrorCode(() =>
        room.selectTeam({
          gatewayPrincipal: playerPrincipal,
          participantId: "participant-two",
          teamId: 5 as unknown as string,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const selected = await room.selectTeam({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-two",
      teamId: " blue ",
    });
    expect(selected.participants).toContainEqual({
      kind: "player",
      id: "participant-two",
      player: { id: "player-two" },
      teamId: "blue",
      ready: false,
    });

    const deselected = await room.selectTeam({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-two",
      teamId: null,
    });
    expect(deselected.participants).toContainEqual({
      kind: "player",
      id: "participant-two",
      player: { id: "player-two" },
      teamId: null,
      ready: false,
    });

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: invalidPrincipal,
          participantId: "participant-host",
          ready: true,
        }),
      ),
    ).toBe("UNAUTHENTICATED");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: invalidPrincipal,
          role: "player",
        }),
      ),
    ).toBe("UNAUTHENTICATED");
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: invalidPrincipal,
          participantId: "participant-host",
          role: "player",
        }),
      ),
    ).toBe("UNAUTHENTICATED");
    expect(
      await readErrorCode(() =>
        room.disconnect({
          gatewayPrincipal: invalidPrincipal,
          participantId: "participant-host",
          role: "player",
        }),
      ),
    ).toBe("UNAUTHENTICATED");
    expect(
      await readErrorCode(() =>
        room.disconnect({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "spectator",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("参加の別名 RPC と識別子不一致の初期化を検証する", async () => {
    const roomId = `room-alias-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const joiner = await createGatewayPrincipal(
      "principal-joiner-alias",
      "player-alias",
    );

    await room.initialize(createRoomOptions(roomId));

    const joined = await room.joinParticipant({
      gatewayPrincipal: joiner,
      role: "player",
    });
    expect(joined.role).toBe("player");
    expect(await room.getRoomSnapshot()).toEqual(await room.getSnapshot());

    const mismatchRoomId = `room-alias-mismatch-${crypto.randomUUID()}`;
    const mismatchRoom = env.FLARE_LOBBY_ROOMS.getByName(mismatchRoomId);
    const mismatchOptions = createRoomOptions(mismatchRoomId);
    await mismatchRoom.initialize(mismatchOptions);
    expect(
      await readErrorCode(() =>
        mismatchRoom.initialize({
          ...mismatchOptions,
          room: { ...mismatchOptions.room, id: `${mismatchRoomId}-other` },
        }),
      ),
    ).toBe("CONFLICT");
  });
});

describe("Room Durable Object の未初期化状態と入力検証", () => {
  it("未初期化 Room への状態操作を CONFLICT で拒否する", async () => {
    const roomId = `room-uninitialized-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const principal = await createGatewayPrincipal(
      "principal-uninitialized",
      "player-uninitialized",
    );

    expect(await room.getSnapshot()).toBeNull();
    expect(
      await readErrorCode(() =>
        room.join({ gatewayPrincipal: principal, role: "player" }),
      ),
    ).toBe("CONFLICT");
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: principal,
          participantId: "participant-host",
          role: "player",
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: principal,
          participantId: "participant-host",
          ready: true,
        }),
      ),
    ).toBe("CONFLICT");
    expect(await readErrorCode(() => room.transition("preparing"))).toBe(
      "CONFLICT",
    );
    expect(
      await readErrorCode(() =>
        room.scheduleOperation({ id: "op-uninit", dueAt: Date.now() + 1_000 }),
      ),
    ).toBe("CONFLICT");
    expect(
      await readErrorCode(() =>
        room.recordProcessedCommand({
          requestId: "request-uninit",
          command: "room.set_ready",
          payload: null,
          result: null,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("初期化入力の不足と範囲外の値を個別に拒否する", async () => {
    const baseRoomId = `room-init-validation-${crypto.randomUUID()}`;
    const base = createRoomOptions(baseRoomId);

    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-no-code-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          room: { ...base.room, invitationCode: "" },
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-no-host-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          host: undefined,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-broken-host-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          host: { participantId: "", playerId: "" },
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-pass-no-pass-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-pass-no-pass-${crypto.randomUUID()}`, {
            joinMethod: "password",
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-public-with-pass-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(
            `room-init-public-with-pass-${crypto.randomUUID()}`,
            {
              joinMethod: "public",
              password: "room-pass",
            },
          ),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-bad-kind-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          room: { ...base.room, kind: "arena" as unknown as "custom" },
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-bad-participants-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          participants: "host" as unknown as Participant[],
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-bad-conditions-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          startConditions:
            "nope" as unknown as RoomInitializationOptions["startConditions"],
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-bad-ready-${crypto.randomUUID()}`,
        ).initialize({
          ...base,
          requireAllPlayersReady: "yes" as unknown as boolean,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-min-over-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-min-over-${crypto.randomUUID()}`, {
            maxPlayers: 2,
            minimumPlayers: 3,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-max-players-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-max-players-${crypto.randomUUID()}`, {
            maxPlayers: 0,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-max-spec-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-max-spec-${crypto.randomUUID()}`, {
            maxSpectators: -1,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-resume-ttl-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-resume-ttl-${crypto.randomUUID()}`, {
            resumeTokenTtlMs: 0,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-grace-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-grace-${crypto.randomUUID()}`, {
            disconnectGracePeriodMs: -1,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-history-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-history-${crypto.randomUUID()}`, {
            eventHistoryLimit: 0,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-retention-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-retention-${crypto.randomUUID()}`, {
            finishedRoomRetentionMs: -1,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        env.FLARE_LOBBY_ROOMS.getByName(
          `room-init-cmd-retention-${crypto.randomUUID()}`,
        ).initialize(
          createRoomOptions(`room-init-cmd-retention-${crypto.randomUUID()}`, {
            processedCommandRetentionMs: 0,
          }),
        ),
      ),
    ).toBe("INVALID_PAYLOAD");
  });

  it("操作入力の型と識別子を個別に検証する", async () => {
    const roomId = `room-input-validation-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-input",
      "player-host",
    );

    await room.initialize(createRoomOptions(roomId));

    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: "yes" as unknown as boolean,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "   ",
          ready: true,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: true,
          requestPayload: (() => undefined) as unknown as JsonValue,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.updateSettings({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          settings: "desert" as unknown as Record<string, never>,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "moderator" as unknown as "player",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.join({
          gatewayPrincipal: hostPrincipal,
          role: "moderator" as unknown as "player",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.disconnect({
          gatewayPrincipal: hostPrincipal,
          participantId: "",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await readErrorCode(() =>
        room.disconnect({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          at: "not-a-timestamp",
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect((await room.getSnapshot())?.revision).toBe(0);
  });
});

describe("Room Durable Object の期限処理と保存データの検証", () => {
  it("処理済みコマンドの保持期限と復元失敗を検証する", async () => {
    const roomId = `room-command-expiry-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);

    await room.initialize(
      createRoomOptions(roomId, { processedCommandRetentionMs: 60_000 }),
    );

    expect(
      await readErrorCode(() =>
        room.recordProcessedCommand({
          requestId: "request-unsafe-created-at",
          command: "room.set_ready",
          payload: null,
          result: null,
          createdAt: Number.MAX_SAFE_INTEGER,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(await readErrorCode(() => room.getProcessedCommand(""))).toBe(
      "INVALID_PAYLOAD",
    );

    await room.recordProcessedCommand({
      requestId: "request-expiring",
      command: "room.set_ready",
      payload: null,
      result: null,
    });
    // 時刻の実待機を避けるため、保存済みの期限と Cleanup Operator の起算時刻を
    // 確定的に過去へ移す。保持期限 1ms のような極端な値では、記録と読み返しの
    // 間に Cleanup alarm が割り込み、読み返しが競合するため大きめの値を使う。
    await runInDurableObject(room, (_instance: RoomDurableObject, state) => {
      state.storage.sql.exec(
        "UPDATE flarelobby_processed_commands SET expires_at = ? WHERE request_id = ?",
        Date.now() - 1,
        "request-expiring",
      );
      state.storage.sql.exec(
        "UPDATE flarelobby_room_scheduled_operations SET due_at = ?",
        Date.now() - 1,
      );
    });
    expect(await room.getProcessedCommand("request-expiring")).toBeNull();
    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });
    expect(await room.listScheduledOperations()).toEqual([]);
  });

  it("破損した保存結果の復元を CONNECTION_FAILED で拒否する", async () => {
    const roomId = `room-command-corrupt-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-corrupt",
      "player-host",
    );

    await room.initialize(createRoomOptions(roomId));

    await room.recordProcessedCommand({
      requestId: "ready-corrupt-result",
      command: "room.set_ready",
      payload: {
        operation: { participantId: "participant-host", ready: true },
      },
      result: [1, 2, 3],
    });
    expect(
      await readErrorCode(() =>
        room.setReady({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          ready: true,
          requestId: "ready-corrupt-result",
        }),
      ),
    ).toBe("CONNECTION_FAILED");

    await room.recordProcessedCommand({
      requestId: "leave-corrupt-result",
      command: "custom_room.leave",
      payload: { participantId: "participant-host", role: "player" },
      result: "broken",
    });
    expect(
      await readErrorCode(() =>
        room.leave({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "player",
          requestId: "leave-corrupt-result",
        }),
      ),
    ).toBe("CONNECTION_FAILED");
  });

  it("処理済みコマンドの後続期限を Alarm で繰り送る", async () => {
    const roomId = `room-command-cleanup-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);

    await room.initialize(
      createRoomOptions(roomId, { processedCommandRetentionMs: 1_000 }),
    );

    await room.recordProcessedCommand({
      requestId: "cleanup-first",
      command: "room.set_ready",
      payload: null,
      result: null,
    });
    const laterCreatedAt = Date.now() + 60_000;
    await room.recordProcessedCommand({
      requestId: "cleanup-second",
      command: "room.set_ready",
      payload: null,
      result: null,
      createdAt: laterCreatedAt,
    });

    await runInDurableObject(room, (_instance: RoomDurableObject, state) => {
      const past = Date.now() - 1;
      state.storage.sql.exec(
        "UPDATE flarelobby_processed_commands SET expires_at = ? WHERE request_id = ?",
        past,
        "cleanup-first",
      );
      state.storage.sql.exec(
        "UPDATE flarelobby_room_scheduled_operations SET due_at = ? WHERE operation_id = ?",
        past,
        "__flarelobby_processed_command_cleanup__",
      );
    });

    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    expect(await room.getProcessedCommand("cleanup-first")).toBeNull();
    expect(await room.getProcessedCommand("cleanup-second")).not.toBeNull();
    const operations = await room.listScheduledOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: "__flarelobby_processed_command_cleanup__",
      dueAt: laterCreatedAt + 1_000,
    });
  });

  it("期限処理の取消と活性な Room の保持期限予約を検証する", async () => {
    const roomId = `room-cancel-${crypto.randomUUID()}`;
    const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    await room.initialize(createRoomOptions(roomId));

    await room.scheduleOperation({
      id: "op-cancel",
      dueAt: Date.now() + 5_000,
    });
    expect(await room.cancelScheduledOperation("op-cancel")).toBe(true);
    expect(await room.listScheduledOperations()).toEqual([]);
    expect(await room.cancelScheduledOperation("op-cancel")).toBe(false);
    expect(await readErrorCode(() => room.cancelScheduledOperation(""))).toBe(
      "INVALID_PAYLOAD",
    );

    await room.scheduleOperation({
      id: "__flarelobby_room_retention__",
      kind: "room_retention",
      dueAt: Date.now() - 1,
    });
    await runInDurableObject(room, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    expect(await room.listScheduledOperations()).toEqual([]);
    expect((await room.getSnapshot())?.state.status).toBe("waiting");
    expect(await room.getNextAlarm()).toBeNull();
  });

  it("切断猶予の期限処理を Room 状態別に検証する", async () => {
    // 終了済み Room では切断処理を何もせず破棄する
    const finishedRoomId = `room-grace-finished-${crypto.randomUUID()}`;
    const finishedRoom = env.FLARE_LOBBY_ROOMS.getByName(finishedRoomId);
    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-grace-finished",
      "player-host",
    );
    await finishedRoom.initialize(createRoomOptions(finishedRoomId));
    await finishedRoom.disconnect({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
    });
    await finishedRoom.close({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
    });
    await runInDurableObject(
      finishedRoom,
      (_instance: RoomDurableObject, state) => {
        state.storage.sql.exec(
          "UPDATE flarelobby_room_scheduled_operations SET due_at = ? WHERE operation_id = ?",
          Date.now() - 1,
          "__flarelobby_disconnect__:participant-host",
        );
      },
    );
    await runInDurableObject(
      finishedRoom,
      async (instance: RoomDurableObject) => {
        await instance.alarm();
      },
    );
    expect(
      (await finishedRoom.listScheduledOperations()).map(
        (operation: RoomScheduledOperation) => operation.kind,
      ),
    ).toContain("room_retention");
    expect((await finishedRoom.getSnapshot())?.state.status).toBe("finished");

    // 移譲先のいないホストの猶予切れは Room 閉鎖になる
    const hostOnlyRoomId = `room-grace-host-only-${crypto.randomUUID()}`;
    const hostOnlyRoom = env.FLARE_LOBBY_ROOMS.getByName(hostOnlyRoomId);
    const hostOnlyPrincipal = await createGatewayPrincipal(
      "principal-host-grace-only",
      "player-host",
    );
    await hostOnlyRoom.initialize(
      createRoomOptions(hostOnlyRoomId, { disconnectGracePeriodMs: 0 }),
    );
    await hostOnlyRoom.disconnect({
      gatewayPrincipal: hostOnlyPrincipal,
      participantId: "participant-host",
    });
    await runInDurableObject(
      hostOnlyRoom,
      async (instance: RoomDurableObject) => {
        await instance.alarm();
      },
    );
    const hostOnlySnapshot = await hostOnlyRoom.getSnapshot();
    expect(hostOnlySnapshot?.state.status).toBe("finished");
    expect(hostOnlySnapshot?.participants).toEqual([]);
    expect(
      (await hostOnlyRoom.listScheduledOperations()).map(
        (operation: RoomScheduledOperation) => operation.kind,
      ),
    ).toEqual(["room_retention"]);

    // 移譲先のいる非ホストの猶予切れは参加者削除だけを行う
    const playerRoomId = `room-grace-player-${crypto.randomUUID()}`;
    const playerRoom = env.FLARE_LOBBY_ROOMS.getByName(playerRoomId);
    const playerPrincipal = await createGatewayPrincipal(
      "principal-player-grace",
      "player-two",
    );
    await playerRoom.initialize(
      createRoomOptions(playerRoomId, {
        disconnectGracePeriodMs: 0,
        participants: [
          {
            kind: "player",
            id: "participant-host",
            player: { id: "player-host" },
            teamId: null,
            ready: false,
          },
          {
            kind: "player",
            id: "participant-two",
            player: { id: "player-two" },
            teamId: null,
            ready: false,
          },
        ],
      }),
    );
    await playerRoom.disconnect({
      gatewayPrincipal: playerPrincipal,
      participantId: "participant-two",
    });
    await runInDurableObject(
      playerRoom,
      async (instance: RoomDurableObject) => {
        await instance.alarm();
      },
    );
    const playerSnapshot = await playerRoom.getSnapshot();
    expect(playerSnapshot?.state.status).toBe("waiting");
    expect(playerSnapshot?.host).toEqual({
      participantId: "participant-host",
      playerId: "player-host",
    });
    expect(
      playerSnapshot?.participants.map(
        (participant: Participant) => participant.id,
      ),
    ).toEqual(["participant-host"]);
    expect(playerSnapshot?.revision).toBe(1);
  });
});
