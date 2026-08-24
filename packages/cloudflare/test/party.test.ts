import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { authenticateGatewayRequest } from "../src/index.js";
import type { GatewayPrincipalEnvelope } from "../src/index.js";

const TOKEN_SECRET = env.FLARE_LOBBY_TOKEN_SECRET;

function newPartyId(): string {
  return `party_${crypto.randomUUID()}`;
}

async function createGatewayPrincipal(
  principalId: string,
): Promise<GatewayPrincipalEnvelope> {
  const result = await authenticateGatewayRequest(
    new Request("https://example.test/parties", { method: "POST" }),
    () => ({ id: principalId, playerId: `${principalId}-player` }),
    TOKEN_SECRET,
  );

  if (!result.ok) {
    throw result.error;
  }

  return result.value.gatewayPrincipal;
}

/** RPC のエラーコードを取り出します。成功時は `undefined` を返します。 */
async function errorOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

interface TestMember {
  readonly principalId: string;
  readonly playerId: string;
}

describe("Party Durable Object", () => {
  it("パーティーを作成し、作成者をリーダーへ登録する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leaderPrincipalId = `leader-${crypto.randomUUID()}`;
    const leader = await createGatewayPrincipal(leaderPrincipalId);
    const party = await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    expect(party.members).toHaveLength(1);
    expect(party.members[0]?.playerId).toBe(`${leaderPrincipalId}-player`);
    expect(party.members[0]?.role).toBe("leader");
    expect(party.revision).toBe(1);
  });

  it("同じ requestId の再送は同じ結果を返し、異なる内容は拒否する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    const requestId = `request-${crypto.randomUUID()}`;

    const created = await stub.createParty({
      gatewayPrincipal: leader,
      requestId,
    });
    const replayed = await stub.createParty({
      gatewayPrincipal: leader,
      requestId,
    });
    expect(replayed.revision).toBe(created.revision);

    expect(
      await errorOf(
        stub.createParty({
          gatewayPrincipal: leader,
          requestId,
          maxPartySize: 4,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("招待の発行・受諾・単一用途性を検証する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    const invitedPrincipalId = `member-${crypto.randomUUID()}`;
    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${invitedPrincipalId}-player`,
    });
    // 未使用かつ期限内の招待は再利用されます。
    const replayedInvite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${invitedPrincipalId}-player`,
    });
    expect(replayedInvite.token).toBe(invite.token);

    const invited = await createGatewayPrincipal(invitedPrincipalId);
    const party = await stub.acceptInvite({
      gatewayPrincipal: invited,
      requestId: `request-${crypto.randomUUID()}`,
      token: invite.token,
    });
    expect(party.members).toHaveLength(2);
    expect(
      party.members.map((member: { role: string }) => member.role),
    ).toContain("member");

    // 同じトークンの再受諾は拒否されます。
    expect(
      await errorOf(
        stub.acceptInvite({
          gatewayPrincipal: invited,
          requestId: `request-${crypto.randomUUID()}`,
          token: invite.token,
        }),
      ),
    ).toBe("FORBIDDEN");

    // リーダー以外は招待を発行できません。
    expect(
      await errorOf(
        stub.inviteMember({
          gatewayPrincipal: invited,
          requestId: `request-${crypto.randomUUID()}`,
          playerId: `other-${crypto.randomUUID()}-player`,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("同じ主体が同時に所属できるパーティーは 1 つだけである", async () => {
    const principalId = `member-${crypto.randomUUID()}`;
    const member = await createGatewayPrincipal(principalId);

    const firstPartyId = newPartyId();
    const firstLeader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    const firstStub = env.FLARE_LOBBY_PARTIES.getByName(firstPartyId);
    await firstStub.createParty({
      gatewayPrincipal: firstLeader,
      requestId: `request-${crypto.randomUUID()}`,
    });
    const invite = await firstStub.inviteMember({
      gatewayPrincipal: firstLeader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${principalId}-player`,
    });
    await firstStub.acceptInvite({
      gatewayPrincipal: member,
      requestId: `request-${crypto.randomUUID()}`,
      token: invite.token,
    });

    const secondPartyId = newPartyId();
    const secondLeader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    const secondStub = env.FLARE_LOBBY_PARTIES.getByName(secondPartyId);
    await secondStub.createParty({
      gatewayPrincipal: secondLeader,
      requestId: `request-${crypto.randomUUID()}`,
    });
    const secondInvite = await secondStub.inviteMember({
      gatewayPrincipal: secondLeader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${principalId}-player`,
    });

    expect(
      await errorOf(
        secondStub.acceptInvite({
          gatewayPrincipal: member,
          requestId: `request-${crypto.randomUUID()}`,
          token: secondInvite.token,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("リーダーの退出では最古参メンバーへ権限が移り、2 未満で自動解散する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leaderPrincipalId = `leader-${crypto.randomUUID()}`;
    const leader = await createGatewayPrincipal(leaderPrincipalId);
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    const members: TestMember[] = [];
    for (const prefix of ["a", "b", "c"]) {
      const memberPrincipalId = `member-${prefix}-${crypto.randomUUID()}`;
      const member = await createGatewayPrincipal(memberPrincipalId);
      members.push({
        principalId: memberPrincipalId,
        playerId: `${memberPrincipalId}-player`,
      });
      const invite = await stub.inviteMember({
        gatewayPrincipal: leader,
        requestId: `request-${crypto.randomUUID()}`,
        playerId: `${memberPrincipalId}-player`,
      });
      await stub.acceptInvite({
        gatewayPrincipal: member,
        requestId: `request-${crypto.randomUUID()}`,
        token: invite.token,
      });
    }
    expect(members).toHaveLength(3);

    // メンバーの退出は解散しません。
    await stub.leaveParty({
      gatewayPrincipal: await createGatewayPrincipal(members[2]!.principalId),
    });

    // リーダーの退出では、残った最古参メンバーへ権限が移ります。
    const afterLeaderLeave = await stub.leaveParty({
      gatewayPrincipal: leader,
    });
    expect(afterLeaderLeave?.members).toHaveLength(2);
    expect(afterLeaderLeave?.members[0]?.playerId).toBe(members[0]?.playerId);
    expect(afterLeaderLeave?.members[0]?.role).toBe("leader");

    // メンバー数が 2 未満になった時点で自動解散します。
    const lastMember = await createGatewayPrincipal(members[0]!.principalId);
    const dissolved = await stub.leaveParty({
      gatewayPrincipal: lastMember,
    });
    expect(dissolved).toBeNull();

    // 解散後は存在しないパーティーとして扱われます。
    const outsider = await createGatewayPrincipal(
      `outsider-${crypto.randomUUID()}`,
    );
    expect(await stub.getSnapshot({ gatewayPrincipal: outsider })).toBeNull();
  });

  it("リーダー移譲と解散を検証する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leaderPrincipalId = `leader-${crypto.randomUUID()}`;
    const leader = await createGatewayPrincipal(leaderPrincipalId);
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    const memberPrincipalId = `member-${crypto.randomUUID()}`;
    const member = await createGatewayPrincipal(memberPrincipalId);
    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${memberPrincipalId}-player`,
    });
    await stub.acceptInvite({
      gatewayPrincipal: member,
      requestId: `request-${crypto.randomUUID()}`,
      token: invite.token,
    });

    const transferred = await stub.transferLeadership({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${memberPrincipalId}-player`,
    });
    expect(
      transferred.members.find(
        (candidate: { playerId: string }) =>
          candidate.playerId === `${memberPrincipalId}-player`,
      )?.role,
    ).toBe("leader");

    // 旧リーダーは解散できません。
    expect(
      await errorOf(stub.dissolveParty({ gatewayPrincipal: leader })),
    ).toBe("FORBIDDEN");

    const dissolved = await stub.dissolveParty({ gatewayPrincipal: member });
    expect(dissolved.members).toHaveLength(0);
  });

  it("キュー投入はリーダーに限られ、待機中は構成変更を凍結する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leaderPrincipalId = `leader-${crypto.randomUUID()}`;
    const leader = await createGatewayPrincipal(leaderPrincipalId);
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    const memberPrincipalId = `member-${crypto.randomUUID()}`;
    const member = await createGatewayPrincipal(memberPrincipalId);
    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${memberPrincipalId}-player`,
    });
    await stub.acceptInvite({
      gatewayPrincipal: member,
      requestId: `request-${crypto.randomUUID()}`,
      token: invite.token,
    });

    const ticketId = `ticket_${crypto.randomUUID()}`;

    // メンバーはキュー投入できません。
    expect(
      await errorOf(
        stub.beginQueueTicket({
          gatewayPrincipal: member,
          ticketId,
          poolKey: `pool:${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("FORBIDDEN");

    const started = await stub.beginQueueTicket({
      gatewayPrincipal: leader,
      ticketId,
      poolKey: `pool:${crypto.randomUUID()}`,
    });
    expect(started.memberIds).toEqual([
      `${leaderPrincipalId}-player`,
      `${memberPrincipalId}-player`,
    ]);

    // 待機中は参加・退出を拒否します。
    const outsiderPrincipalId = `outsider-${crypto.randomUUID()}`;
    const outsider = await createGatewayPrincipal(outsiderPrincipalId);
    const frozenInvite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${outsiderPrincipalId}-player`,
    });
    expect(
      await errorOf(
        stub.acceptInvite({
          gatewayPrincipal: outsider,
          requestId: `request-${crypto.randomUUID()}`,
          token: frozenInvite.token,
        }),
      ),
    ).toBe("CONFLICT");
    expect(await errorOf(stub.leaveParty({ gatewayPrincipal: member }))).toBe(
      "CONFLICT",
    );

    // 凍結解除で構成変更できるようになります。メンバーが退出して
    // 1 名になると自動解散します。
    await stub.endQueueTicket({ ticketId });
    const afterEnd = await stub.leaveParty({ gatewayPrincipal: member });
    expect(afterEnd).toBeNull();
  });

  it("待機中の解散はチケットのキャンセルを伴う", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    const memberPrincipalId = `member-${crypto.randomUUID()}`;
    const member = await createGatewayPrincipal(memberPrincipalId);
    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${memberPrincipalId}-player`,
    });
    await stub.acceptInvite({
      gatewayPrincipal: member,
      requestId: `request-${crypto.randomUUID()}`,
      token: invite.token,
    });

    // 実在しない Pool へのキャンセルはベストエフォートで無視され、
    // 解散自体は完了します。
    const dissolved = await stub.dissolveParty({ gatewayPrincipal: leader });
    expect(dissolved.members).toHaveLength(0);
  });
});
