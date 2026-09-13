import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createGatewayPrincipalEnvelope,
  RoomDurableObject,
} from "../src/index.js";
import type { RoomInitializationOptions } from "../src/index.js";

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

async function initializeRoom(
  overrides: Partial<RoomInitializationOptions> = {},
): Promise<{
  readonly roomId: string;
  readonly stub: ReturnType<typeof env.FLARE_LOBBY_ROOMS.getByName>;
}> {
  const roomId = `room-supplement-${crypto.randomUUID()}`;
  const stub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
  await stub.initialize(createRoomOptions(roomId, overrides));
  return { roomId, stub };
}

describe("Room 追加の分岐", () => {
  it("終了済みルームへの参加は ROOM_FINISHED になる", async () => {
    const { stub } = await initializeRoom();
    const hostPrincipal = await createGatewayPrincipal(
      "principal-finished-join",
      "player-host",
    );
    await stub.close({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      requestId: `request-${crypto.randomUUID()}`,
      at: new Date(Date.now() + 1_000).toISOString(),
    });

    const joiner = await createGatewayPrincipal(
      `principal-joiner-${crypto.randomUUID()}`,
    );
    expect(
      await readErrorCode(() =>
        stub.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("ROOM_FINISHED");
  });

  it("保持期限のオーバーフローで終了と退出を拒否する", async () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const { stub } = await initializeRoom({
      finishedRoomRetentionMs: huge,
    });
    const hostPrincipal = await createGatewayPrincipal(
      "principal-overflow",
      "player-host",
    );

    expect(
      await readErrorCode(() =>
        stub.close({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          requestId: `request-${crypto.randomUUID()}`,
          at: new Date().toISOString(),
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    // ホスト単独の退出は終了を伴い、同じく拒否される。
    expect(
      await readErrorCode(() =>
        stub.leave({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "player",
          requestId: `request-${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
  });

  it("同じ requestId の参加再送は同じ結果を返す", async () => {
    const { stub } = await initializeRoom();
    const joiner = await createGatewayPrincipal(
      `principal-replay-${crypto.randomUUID()}`,
    );
    const requestId = `request-${crypto.randomUUID()}`;

    const first = await stub.join({
      gatewayPrincipal: joiner,
      role: "player",
      requestId,
    });
    const second = await stub.join({
      gatewayPrincipal: joiner,
      role: "player",
      requestId,
    });
    expect(second.participantId).toBe(first.participantId);
  });

  it("最少人数未満の開始は CONFLICT になる", async () => {
    const { stub } = await initializeRoom({ minimumPlayers: 2 });
    const hostPrincipal = await createGatewayPrincipal(
      "principal-minimum",
      "player-host",
    );

    expect(
      await readErrorCode(() =>
        stub.startMatch({
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          requestId: `request-${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("内部結合の参加・退出と文字列表現を直接呼べる", async () => {
    const { roomId, stub } = await initializeRoom();
    const room = roomRowFixture(roomId);

    const joined = await runInDurableObject(
      stub,
      async (instance: RoomDurableObject) =>
        instance.internalJoinParticipant(
          room,
          {
            participantId: "participant-direct",
            kind: "player",
            playerId: "player-direct",
            teamId: null,
            ready: 0,
          },
          "player",
          undefined as never,
          false,
          {} as never,
        ),
    );
    expect(joined.room.id).toBe(roomId);

    const hostPrincipal = await createGatewayPrincipal(
      "principal-host-direct",
      "player-host",
    );
    const left = await runInDurableObject(
      stub,
      async (instance: RoomDurableObject) =>
        instance.internalLeaveParticipant(room, "participant-host", {
          gatewayPrincipal: hostPrincipal,
          participantId: "participant-host",
          role: "player",
        } as never),
    );
    expect(left.participants).toHaveLength(0);

    const tag = await runInDurableObject(
      stub,
      async (instance: RoomDurableObject) =>
        Object.prototype.toString.call(instance),
    );
    expect(tag).toBe("[object IRoomDurableObject]");
  });

  it("Alarm が未知種別・保持期限・不正切断を処理する", async () => {
    const { stub } = await initializeRoom();
    const dueAt = Date.now() - 1;

    // 未知種別の保存済み操作は false で終わる。
    const unknownResult = await runInDurableObject(
      stub,
      (instance: RoomDurableObject) =>
        (
          instance as unknown as {
            processCustomRoomIndexOperation(op: {
              operationId: string;
              dueAt: number;
              kind: string;
              payloadJson: string;
            }): Promise<boolean>;
          }
        ).processCustomRoomIndexOperation({
          operationId: "unknown-kind-operation",
          dueAt,
          kind: "bogus_kind",
          payloadJson: "{}",
        }),
    );
    expect(unknownResult).toBe(false);

    await runInDurableObject(stub, async (_instance, state) => {
      const exec = state.storage.sql.exec.bind(state.storage.sql);
      exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'room_retention', ?)`,
        "retention-active-operation",
        dueAt,
        "{}",
      );
      exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'noop', ?)`,
        "disconnect-invalid-operation",
        dueAt,
        "{}",
      );
    });

    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const remaining = await runInDurableObject(
      stub,
      (instance: RoomDurableObject) => instance.listScheduledOperations(),
    );
    const ids = remaining.map((operation) => operation.id);
    expect(ids).not.toContain("retention-active-operation");
    expect(ids).not.toContain("disconnect-invalid-operation");
  });

  it("未初期化ルームの切断期限切れは無視される", async () => {
    const roomId = `room-fresh-${crypto.randomUUID()}`;
    const stub = env.FLARE_LOBBY_ROOMS.getByName(roomId);
    const dueAt = Date.now() - 1;

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'noop', ?)`,
        "disconnect-fresh-operation",
        dueAt,
        JSON.stringify({
          type: "participant_disconnect",
          participantId: "ghost",
          disconnectedAt: new Date(dueAt).toISOString(),
        }),
      );
    });

    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const remaining = await runInDurableObject(
      stub,
      (instance: RoomDurableObject) => instance.listScheduledOperations(),
    );
    expect(
      remaining.some(
        (operation) => operation.id === "disconnect-fresh-operation",
      ),
    ).toBe(false);
  });

  it("存在しない参加者の切断期限切れは無視される", async () => {
    const { stub } = await initializeRoom();
    const dueAt = Date.now() - 1;

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'noop', ?)`,
        "disconnect-ghost-operation",
        dueAt,
        JSON.stringify({
          type: "participant_disconnect",
          participantId: "ghost-participant",
          disconnectedAt: new Date(dueAt).toISOString(),
        }),
      );
    });

    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const remaining = await runInDurableObject(
      stub,
      (instance: RoomDurableObject) => instance.listScheduledOperations(),
    );
    expect(
      remaining.some(
        (operation) => operation.id === "disconnect-ghost-operation",
      ),
    ).toBe(false);
  });

  it("定員なしの公開ルームは一覧記録を作らない", async () => {
    const { stub } = await initializeRoom();

    // 公開でも定員がなければ記録対象外になる。
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE flarelobby_rooms SET visibility = 'public', max_players = NULL WHERE singleton_id = 1",
      );
    });

    const hostPrincipal = await createGatewayPrincipal(
      "principal-no-record-host",
      "player-host",
    );
    const closed = await stub.close({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      requestId: `request-${crypto.randomUUID()}`,
      at: new Date(Date.now() + 1_000).toISOString(),
    });
    expect(closed.state.status).toBe("finished");

    const remaining = await runInDurableObject(
      stub,
      (instance: RoomDurableObject) => instance.listScheduledOperations(),
    );
    expect(
      remaining.some(
        (operation) => operation.kind === "custom_room_index_upsert",
      ),
    ).toBe(false);
  });

  it("壊れたイベント履歴はスナップショット再開になる", async () => {
    const { stub } = await initializeRoom();

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_events (revision, event_json, created_at)
         VALUES (?, ?, ?)`,
        1,
        "[1,2",
        Date.now(),
      );
    });

    const resumed = await runInDurableObject(
      stub,
      async (instance: RoomDurableObject) =>
        (
          instance as unknown as {
            readResumeEvents(
              lastRevision: number | null,
              currentRevision: number,
            ): { readonly useSnapshot: boolean };
          }
        ).readResumeEvents(0, 1),
    );
    expect(resumed.useSnapshot).toBe(true);

    // 種別が異なる履歴もスナップショット再開になる。
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE flarelobby_room_events SET event_json = ? WHERE revision = ?",
        '{"kind":"command"}',
        1,
      );
    });
    const resumedKind = await runInDurableObject(
      stub,
      async (instance: RoomDurableObject) =>
        (
          instance as unknown as {
            readResumeEvents(
              lastRevision: number | null,
              currentRevision: number,
            ): { readonly useSnapshot: boolean };
          }
        ).readResumeEvents(0, 1),
    );
    expect(resumedKind.useSnapshot).toBe(true);
  });

  it("未初期化ルームのゲームメッセージは無視される", async () => {    const stub = env.FLARE_LOBBY_ROOMS.getByName(
      `room-fresh-${crypto.randomUUID()}`,
    );

    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await (
        instance as unknown as {
          broadcastGameMessage(attachment: unknown, command: unknown): void;
        }
      ).broadcastGameMessage(
        {
          roomId: "room-fresh",
          participantId: "p-1",
          role: "player",
          principal: { id: "p", playerId: "p" },
        },
        {
          protocolVersion: 1,
          kind: "command",
          requestId: "request-1",
          command: "game.chat",
          payload: {},
        },
      );
    });
  });

  it("対戦中のルームへの参加は CONFLICT になる", async () => {
    const { stub } = await initializeRoom({
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
          id: "participant-guest",
          player: { id: "player-guest" },
          teamId: null,
          ready: false,
        },
      ],
    });
    const hostPrincipal = await createGatewayPrincipal(
      "principal-inprogress-host",
      "player-host",
    );
    const guestPrincipal = await createGatewayPrincipal(
      "principal-inprogress-guest",
      "player-guest",
    );

    await stub.setReady({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      requestId: `request-${crypto.randomUUID()}`,
      ready: true,
    });
    await stub.setReady({
      gatewayPrincipal: guestPrincipal,
      participantId: "participant-guest",
      requestId: `request-${crypto.randomUUID()}`,
      ready: true,
    });
    await stub.startMatch({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      requestId: `request-${crypto.randomUUID()}`,
    });

    const joiner = await createGatewayPrincipal(
      `principal-late-${crypto.randomUUID()}`,
    );
    expect(
      await readErrorCode(() =>
        stub.join({ gatewayPrincipal: joiner, role: "player" }),
      ),
    ).toBe("CONFLICT");
  });

  it("同じ requestId のチーム選択再送は同じ結果を返す", async () => {
    const { stub } = await initializeRoom();
    const hostPrincipal = await createGatewayPrincipal(
      "principal-replay-team",
      "player-host",
    );
    const requestId = `request-${crypto.randomUUID()}`;

    const first = await stub.selectTeam({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      requestId,
      teamId: "red",
    });
    const second = await stub.selectTeam({
      gatewayPrincipal: hostPrincipal,
      participantId: "participant-host",
      requestId,
      teamId: "red",
    });
    expect(second.revision).toBe(first.revision);
  });

  it("保持期限オーバーフローの切断期限切れは無視される", async () => {
    const { stub } = await initializeRoom({
      finishedRoomRetentionMs: Number.MAX_SAFE_INTEGER,
    });

    const result = await runInDurableObject(
      stub,
      async (instance: RoomDurableObject) => {
        const room = await (
          instance as unknown as {
            readRoomRow(): Record<string, unknown>;
          }
        ).readRoomRow();
        return (
          instance as unknown as {
            expireDisconnectedParticipant(
              room: unknown,
              participantId: string,
              disconnectedAt: string,
            ): string;
          }
        ).expireDisconnectedParticipant(
          room,
          "participant-host",
          new Date(Date.now() - 3_600_000).toISOString(),
        );
      },
    );
    expect(result).toBe("noop");
  });

  it("不正な切断時刻の期限切れは無視される", async () => {
    const { roomId, stub } = await initializeRoom();

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_connections (
          resume_id, room_id, principal_id, participant_id, role,
          connected_at, disconnected_at, connection_generation,
          resume_token_expires_at, invalidated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        "resume-garbage",
        roomId,
        "principal-garbage",
        "participant-host",
        "player",
        new Date().toISOString(),
        "not-a-timestamp",
        "gen-garbage",
        Date.now() + 60_000,
      );
      state.storage.sql.exec(
        `INSERT INTO flarelobby_room_scheduled_operations
          (operation_id, due_at, kind, payload_json)
         VALUES (?, ?, 'noop', ?)`,
        "disconnect-garbage-operation",
        Date.now() - 1,
        JSON.stringify({
          type: "participant_disconnect",
          participantId: "participant-host",
          disconnectedAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      );
    });

    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await instance.alarm();
    });

    const remaining = await runInDurableObject(stub, (instance: RoomDurableObject) =>
      instance.listScheduledOperations(),
    );
    expect(
      remaining.some(
        (operation) => operation.id === "disconnect-garbage-operation",
      ),
    ).toBe(false);
  });

  it("壊れた設定の一覧同期は失敗を飲み込む", async () => {
    const { stub } = await initializeRoom();

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE flarelobby_rooms SET settings_json = ? WHERE singleton_id = 1",
        "[1,2",
      );
    });

    // 設定が壊れていても一覧同期の呼び出し自体は成功扱いになる。
    await runInDurableObject(stub, async (instance: RoomDurableObject) => {
      await (
        instance as unknown as {
          enqueueCustomRoomIndexSync(): Promise<void>;
        }
      ).enqueueCustomRoomIndexSync();
    });
  });
});

function roomRowFixture(roomId: string) {
  return {
    roomId,
    kind: "custom",
    invitationCode: "4F9K2D",
    visibility: "unlisted",
    matchId: null,
    poolJson: null,
    settingsJson: "{}",
    metadataJson: "{}",
    state: "waiting",
    stateStartedAt: new Date().toISOString(),
    revision: 1,
    hostParticipantId: "participant-host",
    hostPlayerId: "player-host",
    maxPlayers: 4,
    maxSpectators: 0,
    minimumPlayers: 1,
    requireAllPlayersReady: 1,
    joinMethod: null,
    joinPasswordSalt: null,
    joinPasswordHash: null,
    finishedRoomRetentionMs: 60_000,
    createdAt: Date.now(),
    resumeTokenTtlMs: 3_600_000,
    disconnectGracePeriodMs: 0,
    eventHistoryLimit: 100,
    processedCommandRetentionMs: 60_000,
  } as never;
}
