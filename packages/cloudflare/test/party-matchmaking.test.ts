import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  authenticateGatewayRequest,
  createMatchmakingRoomId,
  createMatchmakingPoolKey,
  MatchPoolDurableObject,
  registerTeamMatchResult,
} from "../src/index.js";
import type { MatchmakingPool, RoomSnapshot } from "@flarelobby/core";
import type { GatewayPrincipalEnvelope } from "../src/index.js";

const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;

function createPartyPool(): MatchmakingPool {
  const suffix = crypto.randomUUID();
  return {
    id: `ranked-2v2-${suffix}`,
    gameId: `test-game-${suffix}`,
    seasonId: "season-1",
    mode: "ranked-2v2",
    region: "jp",
    maxPartySize: 2,
    teamSize: 2,
  };
}

async function createGatewayPrincipal(
  playerId: string,
): Promise<GatewayPrincipalEnvelope> {
  const result = await authenticateGatewayRequest(
    new Request("https://example.test/matchmaking", { method: "POST" }),
    () => ({ id: `${playerId}-principal`, playerId }),
    TOKEN_SECRET,
  );

  if (!result.ok) {
    throw result.error;
  }

  return result.value.gatewayPrincipal;
}

interface PartyUnderTest {
  readonly partyId: string;
  readonly leaderPlayerId: string;
  readonly memberPlayerIds: readonly [string, string];
}

/** リーダー + メンバー 1 人のパーティーを作成します。 */
async function createTestParty(prefix: string): Promise<PartyUnderTest> {
  const partyId = `party_${crypto.randomUUID()}`;
  const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
  const leaderPlayerId = `${prefix}-leader-${crypto.randomUUID()}-player`;
  const memberPlayerId = `${prefix}-member-${crypto.randomUUID()}-player`;
  const leader = await createGatewayPrincipal(leaderPlayerId);
  const member = await createGatewayPrincipal(memberPlayerId);

  await stub.createParty({
    gatewayPrincipal: leader,
    requestId: `request-${crypto.randomUUID()}`,
  });
  const invite = await stub.inviteMember({
    gatewayPrincipal: leader,
    requestId: `request-${crypto.randomUUID()}`,
    playerId: memberPlayerId,
  });
  await stub.acceptInvite({
    gatewayPrincipal: member,
    requestId: `request-${crypto.randomUUID()}`,
    token: invite.token,
  });

  return {
    partyId,
    leaderPlayerId,
    memberPlayerIds: [leaderPlayerId, memberPlayerId],
  };
}

describe("パーティー単位のマッチング統合", () => {
  it("2 対 2 のパーティーを成立させ、構成員全員を同一チームへ割り当てる", async () => {
    const pool = createPartyPool();
    const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool),
    ) as unknown as MatchPoolDurableObject;
    await poolStub.initialize({ pool });

    const partyA = await createTestParty("a");
    const partyB = await createTestParty("b");

    // リーダーがパーティー単位でキュー投入します。構成員のレートは
    // D1 からサーバー側で取得され、平均が参照レートになります。
    const ticketIds: string[] = [];
    for (const party of [partyA, partyB]) {
      const leader = await createGatewayPrincipal(party.leaderPlayerId);
      const ticket = await poolStub.createTicket({
        gatewayPrincipal: leader,
        requestId: `request-${crypto.randomUUID()}`,
        rating: 1_500,
        expiresAt: Date.now() + 60_000,
        pool,
        party: { partyId: party.partyId },
      });
      expect(ticket.players?.map((member) => member.id)).toEqual(
        [...party.memberPlayerIds].sort(),
      );
      expect(ticket.party).toEqual({ partyId: party.partyId, revision: 3 });
      ticketIds.push(ticket.id);
    }

    // パーティー B のキュー投入時に候補探索が走り、即座に成立します。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await poolStub.processPendingMatches();
      if ((await poolStub.getTicket(ticketIds[0]!))?.status === "matched") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const ticketA = await poolStub.getTicket(ticketIds[0]!);
    expect(ticketA?.status).toBe("matched");
    if (ticketA?.status !== "matched") {
      throw new Error("パーティーの成立に失敗しました。");
    }
    const matchId = ticketA.result.matchId;

    // Room には 4 人の参加者がおり、パーティーごとに同一チームへ割り当てられています。
    const roomStub = env.FLARE_LOBBY_ROOMS.getByName(
      createMatchmakingRoomId(matchId),
    );
    const roomSnapshot = (await roomStub.getSnapshot()) as RoomSnapshot | null;
    expect(roomSnapshot).not.toBeNull();
    const players = roomSnapshot!.participants.filter(
      (participant) => participant.kind === "player",
    );
    expect(players).toHaveLength(4);
    const teamOf = (playerId: string) =>
      players.find(
        (participant) =>
          participant.kind === "player" && participant.player.id === playerId,
      )?.kind === "player"
        ? players.find(
            (participant) =>
              participant.kind === "player" &&
              participant.player.id === playerId,
          )!.teamId
        : undefined;
    expect(teamOf(partyA.memberPlayerIds[0]!)).toBe(
      teamOf(partyA.memberPlayerIds[1]!),
    );
    expect(teamOf(partyB.memberPlayerIds[0]!)).toBe(
      teamOf(partyB.memberPlayerIds[1]!),
    );
    expect(teamOf(partyA.memberPlayerIds[0]!)).not.toBe(
      teamOf(partyB.memberPlayerIds[0]!),
    );

    // 試合結果登録は N 人分の参加者を復元し、再送では applied: false になります。
    const registrationInput = {
      resultId: `result_${crypto.randomUUID()}`,
      matchId,
      teamAId: teamOf(partyA.memberPlayerIds[0]!)!,
      playerAIds: [...partyA.memberPlayerIds].sort(),
      teamBId: teamOf(partyB.memberPlayerIds[0]!)!,
      playerBIds: [...partyB.memberPlayerIds].sort(),
      result: 1,
    } as const;
    const first = await registerTeamMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      registrationInput,
    );
    expect(first.applied).toBe(true);
    expect(first.match.participants).toHaveLength(4);

    const replayed = await registerTeamMatchResult(
      env.FLARE_LOBBY_DB,
      pool,
      registrationInput,
    );
    expect(replayed.applied).toBe(false);
    expect(replayed.match.matchId).toBe(first.match.matchId);
  });

  it("待機中の解散でチケットがキャンセルされる", async () => {
    const pool = createPartyPool();
    const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(pool),
    ) as unknown as MatchPoolDurableObject;
    await poolStub.initialize({ pool });

    const party = await createTestParty("solo");
    const leader = await createGatewayPrincipal(party.leaderPlayerId);

    const ticket = await poolStub.createTicket({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      rating: 1_200,
      expiresAt: Date.now() + 60_000,
      pool,
      party: { partyId: party.partyId },
    });
    expect(ticket.status).toBe("waiting");

    const partyStub = env.FLARE_LOBBY_PARTIES.getByName(party.partyId);
    const dissolved = await partyStub.dissolveParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });
    expect(dissolved.members).toHaveLength(0);

    const cancelledTicket = await poolStub.getTicket(ticket.id);
    expect(cancelledTicket?.status).toBe("cancelled");
  });
});
