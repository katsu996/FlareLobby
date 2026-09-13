import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { GatewayPrincipalEnvelope } from "../src/security.js";
import { authenticateGatewayRequest } from "../src/security.js";
import type { ParticipantRow, RoomRow } from "../src/room.js";
import {
  assertActiveRoom,
  assertInitializedRoom,
  assertPlayerRole,
  assertWaitingRoom,
  authenticateHost,
  authenticateParticipant,
  readRequiredSnapshot,
  resolveGatewayPrincipal,
} from "../src/room/RoomAuth.js";

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

function expectSyncErrorCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }

  throw new Error(`例外 ${code} が送出されることを期待しました。`);
}

function tamperedEnvelope(
  envelope: GatewayPrincipalEnvelope,
): GatewayPrincipalEnvelope {
  return { ...envelope, token: `${envelope.token}tampered` };
}

describe("RoomAuth モジュール", () => {
  it("正規のゲートウェイプリンシパルを解決し、不正な署名を拒否する", async () => {
    const config = { tokenSecret: TOKEN_SECRET };
    const envelope = await createGatewayPrincipal("principal-1");

    const principal = await resolveGatewayPrincipal(config, envelope);
    expect(principal?.playerId).toBe("principal-1-player");

    await expect(
      resolveGatewayPrincipal(config, tamperedEnvelope(envelope)),
    ).resolves.toBeNull();
  });

  it("参加者認証がトークン・Room・参加者・所有者を検証する", async () => {
    const config = { tokenSecret: TOKEN_SECRET };
    const envelope = await createGatewayPrincipal("principal-1");
    const room = roomRow();
    const participant = participantRow();

    const actor = await authenticateParticipant(
      config,
      () => room,
      () => participant,
      { gatewayPrincipal: envelope, participantId: "participant-1" },
    );
    expect(actor.room.roomId).toBe("room-1");
    expect(actor.participant.participantId).toBe("participant-1");

    // 不正な署名は UNAUTHENTICATED になる。
    await expect(
      authenticateParticipant(
        config,
        () => room,
        () => participant,
        {
          gatewayPrincipal: tamperedEnvelope(envelope),
          participantId: "participant-1",
        },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    // 未初期化の Room は CONFLICT になる。
    await expect(
      authenticateParticipant(
        config,
        () => undefined,
        () => participant,
        {
          gatewayPrincipal: envelope,
          participantId: "participant-1",
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 存在しない参加者は FORBIDDEN になる。
    await expect(
      authenticateParticipant(
        config,
        () => room,
        () => undefined,
        {
          gatewayPrincipal: envelope,
          participantId: "participant-1",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 他者の参加者 ID は FORBIDDEN になる。
    await expect(
      authenticateParticipant(
        config,
        () => room,
        () => participantRow({ participantId: "other", playerId: "other" }),
        { gatewayPrincipal: envelope, participantId: "other" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ホスト認証がカスタム種別・ホスト一致・役割を検証する", async () => {
    const config = { tokenSecret: TOKEN_SECRET };
    const envelope = await createGatewayPrincipal("principal-1");
    const room = roomRow();
    const participant = participantRow();
    const options = {
      gatewayPrincipal: envelope,
      participantId: "participant-1",
    };

    const actor = await authenticateHost(
      config,
      () => room,
      () => participant,
      options,
    );
    expect(actor.participant.playerId).toBe("principal-1-player");

    // マッチ種別は FORBIDDEN になる。
    await expect(
      authenticateHost(
        config,
        () => roomRow({ kind: "match" }),
        () => participant,
        options,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // ホスト未設定は FORBIDDEN になる。
    await expect(
      authenticateHost(
        config,
        () => roomRow({ hostParticipantId: null, hostPlayerId: null }),
        () => participant,
        options,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 観戦者は FORBIDDEN になる。
    await expect(
      authenticateHost(
        config,
        () => room,
        () => participantRow({ kind: "spectator" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // ホスト以外の参加者は FORBIDDEN になる。
    await expect(
      authenticateHost(
        config,
        () => room,
        () =>
          participantRow({
            participantId: "participant-2",
            playerId: "principal-1-player",
          }),
        { gatewayPrincipal: envelope, participantId: "participant-2" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("状態アサーションが終了・非待機・未初期化を拒否する", () => {
    expect(() => assertActiveRoom(roomRow())).not.toThrow();
    expectSyncErrorCode(
      () => assertActiveRoom(roomRow({ state: "finished" })),
      "ROOM_FINISHED",
    );

    expect(() => assertWaitingRoom(roomRow())).not.toThrow();
    expectSyncErrorCode(
      () => assertWaitingRoom(roomRow({ state: "in_progress" })),
      "CONFLICT",
    );

    expect(() => assertInitializedRoom(roomRow())).not.toThrow();
    expectSyncErrorCode(() => assertInitializedRoom(undefined), "CONFLICT");
  });

  it("スナップショット必須読み取りと役割検証を行う", () => {
    const snapshot = { revision: 1 };
    expect(readRequiredSnapshot(() => snapshot as never)).toBe(snapshot);
    expectSyncErrorCode(
      () => readRequiredSnapshot(() => null),
      "CONNECTION_FAILED",
    );

    expect(() => assertPlayerRole("player")).not.toThrow();
    expectSyncErrorCode(() => assertPlayerRole("spectator"), "FORBIDDEN");
  });
});
