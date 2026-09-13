import { describe, expect, it, vi } from "vitest";

import type { RoomSnapshot } from "@flarelobby/core";
import type { RoomRow } from "../src/room.js";
import {
  executeTransition,
  type TransitionContext,
} from "../src/room/RoomStateMachine.js";

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
    createdAt: Date.parse("2026-08-11T00:00:00.000Z"),
    resumeTokenTtlMs: 3_600_000,
    disconnectGracePeriodMs: 0,
    eventHistoryLimit: 100,
    processedCommandRetentionMs: 60_000,
    ...overrides,
  } as RoomRow;
}

function context(
  overrides: Partial<TransitionContext> = {},
): TransitionContext {
  return {
    readRoomRow: () => roomRow(),
    exec: vi.fn(),
    synchronizeAlarm: vi.fn(async () => undefined),
    readSnapshot: () => ({ revision: 2 }) as unknown as RoomSnapshot,
    broadcastRoomSnapshot: vi.fn(),
    enqueueCustomRoomIndexSync: vi.fn(async () => undefined),
    getFinishedRoomRetentionMs: () => 0,
    ...overrides,
  };
}

describe("RoomStateMachine モジュール", () => {
  it("同一状態の再適用でスナップショット欠落を拒否する", async () => {
    await expect(
      executeTransition(
        context({ readSnapshot: () => null }),
        "waiting",
        "2026-08-11T00:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("許可されない遷移を拒否する", async () => {
    await expect(
      executeTransition(
        context({ readRoomRow: () => roomRow({ state: "in_progress" }) }),
        "waiting",
        "2026-08-11T00:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("時刻省略のオブジェクト指定で遷移できる", async () => {
    const result = await executeTransition(context(), { status: "preparing" });
    expect(result.snapshot.revision).toBe(2);
    expect(result.retentionDueAt).toBeNull();
  });

  it("遷移後のスナップショット欠落を拒否する", async () => {
    await expect(
      executeTransition(
        context({ readSnapshot: () => null }),
        "preparing",
        "2026-08-11T00:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("保持期限のオーバーフローで終了遷移を拒否する", async () => {
    await expect(
      executeTransition(
        context({ getFinishedRoomRetentionMs: () => Number.MAX_SAFE_INTEGER }),
        { status: "finished", at: "2026-08-11T00:00:00.000Z" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});
