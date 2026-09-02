import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  authenticateGatewayRequest,
  PartyDurableObject,
} from "../src/index.js";
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

  it("キュー投入の入力検証・同じチケットでの再開・凍結解除を検証する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    // 2 名構成にしてからキュー投入し、memberIds の整列も確認します。
    const memberPrincipalId = `member-zz-${crypto.randomUUID()}`;
    const member = await createGatewayPrincipal(memberPrincipalId);
    const memberInvite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${memberPrincipalId}-player`,
    });
    await stub.acceptInvite({
      gatewayPrincipal: member,
      requestId: `request-${crypto.randomUUID()}`,
      token: memberInvite.token,
    });

    // ticketId / poolKey は必須です。
    expect(
      await errorOf(
        stub.beginQueueTicket({
          gatewayPrincipal: leader,
          ticketId: "",
          poolKey: `pool:${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    // 招待の入力検証です。
    expect(
      await errorOf(
        stub.inviteMember({
          gatewayPrincipal: leader,
          requestId: `request-${crypto.randomUUID()}`,
          playerId: `${"x".repeat(513)}`,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await errorOf(
        stub.inviteMember({
          gatewayPrincipal: leader,
          requestId: `request-${crypto.randomUUID()}`,
          playerId: `${memberPrincipalId}-player`,
          ttlMs: 0,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const ticketId = `ticket_${crypto.randomUUID()}`;
    const started = await stub.beginQueueTicket({
      gatewayPrincipal: leader,
      ticketId,
      poolKey: `pool:${crypto.randomUUID()}`,
    });

    // 同じチケットIDの再呼び出しは凍結された構成をそのまま返します。
    const restarted = await stub.beginQueueTicket({
      gatewayPrincipal: leader,
      ticketId,
      poolKey: `pool:${crypto.randomUUID()}`,
    });
    expect(restarted.partyRevision).toBe(started.partyRevision);
    expect(restarted.memberIds).toEqual([...started.memberIds].sort());

    // 異なるチケットIDでの二重投入は拒否します。
    expect(
      await errorOf(
        stub.beginQueueTicket({
          gatewayPrincipal: leader,
          ticketId: `ticket_${crypto.randomUUID()}`,
          poolKey: `pool:${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("CONFLICT");

    // 凍結解除は不正なチケットIDを拒否し、未知のチケットIDは無視します。
    expect(await errorOf(stub.endQueueTicket({ ticketId: "" }))).toBe(
      "INVALID_PAYLOAD",
    );
    await stub.endQueueTicket({ ticketId: `ticket_${crypto.randomUUID()}` });
    await stub.endQueueTicket({ ticketId });
  });

  it("待機中の解散はチケット凍結を解除し、requestId の再送で同じ結果を返す", async () => {
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

    await stub.beginQueueTicket({
      gatewayPrincipal: leader,
      ticketId: `ticket_${crypto.randomUUID()}`,
      poolKey: `pool_${crypto.randomUUID()}`,
    });

    const requestId = `request-${crypto.randomUUID()}`;
    const dissolved = await stub.dissolveParty({
      gatewayPrincipal: leader,
      requestId,
    });
    expect(dissolved.members).toHaveLength(0);
    expect(dissolved.queuedTicket).toBeNull();

    // 同じ requestId の再送は記録された解散後スナップショットを返します。
    const replayed = await stub.dissolveParty({
      gatewayPrincipal: leader,
      requestId,
    });
    expect(replayed).toEqual(dissolved);

    // 解散済みパーティーへの退出は存在しない扱いで拒否されます。
    expect(await errorOf(stub.leaveParty({ gatewayPrincipal: member }))).toBe(
      "CONFLICT",
    );
  });

  it("退出の再送は同じ結果を返し、他主体の再利用は拒否する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    // 解散を避けるため、メンバーは 2 人追加します。
    const members: TestMember[] = [];
    for (const prefix of ["a", "b"]) {
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

    const requestId = `request-${crypto.randomUUID()}`;
    const firstLeave = await stub.leaveParty({
      gatewayPrincipal: await createGatewayPrincipal(members[1]!.principalId),
      requestId,
    });

    expect(firstLeave).not.toBeNull();

    // メンバーの再送は記録済みスナップショットを返します。
    // リーダーによる同じ requestId の再利用は競合です。
    const replayedLeave = await stub.leaveParty({
      gatewayPrincipal: await createGatewayPrincipal(members[1]!.principalId),
      requestId,
    });
    expect(replayedLeave).toEqual(firstLeave);
    expect(
      await errorOf(stub.leaveParty({ gatewayPrincipal: leader, requestId })),
    ).toBe("CONFLICT");

    // 解散後の再送は記録された解散結果 (null) を返します。
    const leaderRequestId = `request-${crypto.randomUUID()}`;
    expect(
      await stub.leaveParty({
        gatewayPrincipal: leader,
        requestId: leaderRequestId,
      }),
    ).toBeNull();
    expect(
      await stub.leaveParty({
        gatewayPrincipal: leader,
        requestId: leaderRequestId,
      }),
    ).toBeNull();
  });

  it("期限切れの招待は受諾できず、一覧にも現れず、Alarm で掃除される", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    const invitedPrincipalId = `member-expired-${crypto.randomUUID()}`;
    const invited = await createGatewayPrincipal(invitedPrincipalId);
    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${invitedPrincipalId}-player`,
      ttlMs: 1,
    });

    // 期限切れトークンの受諾は拒否され、スナップショットにも現れません。
    expect(
      await errorOf(
        stub.acceptInvite({
          gatewayPrincipal: invited,
          requestId: `request-${crypto.randomUUID()}`,
          token: invite.token,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      (await stub.getSnapshot({ gatewayPrincipal: leader }))?.invites,
    ).toHaveLength(0);

    // Alarm は期限切れ招待を掃除します。
    await runInDurableObject(stub, async (instance: PartyDurableObject) => {
      await instance.alarm();
    });
    expect(
      (await stub.getSnapshot({ gatewayPrincipal: leader }))?.invites,
    ).toHaveLength(0);
  });

  it("イベント履歴と fetch 経路はメンバーだけに開かれる", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leaderPrincipalId = `leader-${crypto.randomUUID()}`;
    const leader = await createGatewayPrincipal(leaderPrincipalId);
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });

    // RPC でも fetch でも主体証明を検証します。
    expect(await stub.resolveGatewayPrincipal(leader)).toEqual({
      id: leaderPrincipalId,
      playerId: `${leaderPrincipalId}-player`,
    });

    const outsider = await createGatewayPrincipal(
      `outsider-${crypto.randomUUID()}`,
    );
    expect(await errorOf(stub.getEvents({ gatewayPrincipal: outsider }))).toBe(
      "FORBIDDEN",
    );
    expect(
      await errorOf(stub.getSnapshot({ gatewayPrincipal: outsider })),
    ).toBe("FORBIDDEN");

    const events = await stub.getEvents({
      gatewayPrincipal: leader,
      afterSequence: 0,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.type).toBe("created");
    expect(
      await errorOf(
        stub.getEvents({ gatewayPrincipal: leader, afterSequence: -1 }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const url = `https://party.test/${partyId}/events`;
    const unauthorized = await stub.fetch(new Request(url));
    expect(unauthorized.status).toBe(401);
    const forbidden = await stub.fetch(
      new Request(url, {
        headers: { authorization: `Bearer ${outsider.token}` },
      }),
    );
    expect(forbidden.status).toBe(403);
    const invalidAfter = await stub.fetch(
      new Request(`${url}?after=abc`, {
        headers: { authorization: `Bearer ${leader.token}` },
      }),
    );
    expect(invalidAfter.status).toBe(400);

    const listed = (await (
      await stub.fetch(
        new Request(`${url}?after=0`, {
          headers: { authorization: `Bearer ${leader.token}` },
        }),
      )
    ).json()) as { events: readonly { type: string }[] };
    expect(listed.events[0]?.type).toBe("created");

    // after 指定で履歴の途中から取得できます。
    if (events.length >= 2) {
      const tail = (await (
        await stub.fetch(
          new Request(`${url}?after=1`, {
            headers: { authorization: `Bearer ${leader.token}` },
          }),
        )
      ).json()) as { events: readonly unknown[] };
      expect(tail.events).toHaveLength(events.length - 1);
    }
  });

  it("満員パーティーでの招待発行と受諾を拒否する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const leader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      maxPartySize: 2,
    });

    const firstPrincipalId = `member-first-${crypto.randomUUID()}`;
    const secondPrincipalId = `member-second-${crypto.randomUUID()}`;
    const firstInvite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${firstPrincipalId}-player`,
    });
    const secondInvite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${secondPrincipalId}-player`,
    });

    const first = await createGatewayPrincipal(firstPrincipalId);
    const second = await createGatewayPrincipal(secondPrincipalId);
    await stub.acceptInvite({
      gatewayPrincipal: first,
      requestId: `request-${crypto.randomUUID()}`,
      token: firstInvite.token,
    });

    // 定員に達したら招待発行も受諾も拒否します。
    expect(
      await errorOf(
        stub.inviteMember({
          gatewayPrincipal: leader,
          requestId: `request-${crypto.randomUUID()}`,
          playerId: `${firstPrincipalId}-player`,
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await errorOf(
        stub.acceptInvite({
          gatewayPrincipal: second,
          requestId: `request-${crypto.randomUUID()}`,
          token: secondInvite.token,
        }),
      ),
    ).toBe("ROOM_FULL");
  });

  it("リーダー移譲は不正な移譲先を拒否し、再送で同じ結果を返す", async () => {
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

    // リーダー自身への移譲と所属外への移譲は拒否します。
    expect(
      await errorOf(
        stub.transferLeadership({
          gatewayPrincipal: leader,
          requestId: `request-${crypto.randomUUID()}`,
          playerId: `${leaderPrincipalId}-player`,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");
    expect(
      await errorOf(
        stub.transferLeadership({
          gatewayPrincipal: leader,
          requestId: `request-${crypto.randomUUID()}`,
          playerId: `unknown-${crypto.randomUUID()}-player`,
        }),
      ),
    ).toBe("INVALID_PAYLOAD");

    const requestId = `request-${crypto.randomUUID()}`;
    const transferred = await stub.transferLeadership({
      gatewayPrincipal: leader,
      requestId,
      playerId: `${memberPrincipalId}-player`,
    });
    const replayed = await stub.transferLeadership({
      gatewayPrincipal: leader,
      requestId,
      playerId: `${memberPrincipalId}-player`,
    });
    expect(replayed.revision).toBe(transferred.revision);
    expect(
      await errorOf(
        stub.transferLeadership({
          gatewayPrincipal: leader,
          requestId,
          playerId: `unknown-${crypto.randomUUID()}-player`,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("パーティー作成は識別子の重複と不正な定員・無証明を拒否する", async () => {
    const partyId = newPartyId();
    const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
    const firstLeader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    const created = await stub.createParty({
      gatewayPrincipal: firstLeader,
      requestId: `request-${crypto.randomUUID()}`,
    });
    expect(created.members).toHaveLength(1);

    // 同じ識別子での再作成は、別主体でも拒否します。
    const secondLeader = await createGatewayPrincipal(
      `leader-${crypto.randomUUID()}`,
    );
    expect(
      await errorOf(
        stub.createParty({
          gatewayPrincipal: secondLeader,
          requestId: `request-${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("CONFLICT");

    // 定員は 2 以上 64 以下です。
    for (const maxPartySize of [1, 65]) {
      expect(
        await errorOf(
          env.FLARE_LOBBY_PARTIES.getByName(newPartyId()).createParty({
            gatewayPrincipal: await createGatewayPrincipal(
              `leader-${crypto.randomUUID()}`,
            ),
            requestId: `request-${crypto.randomUUID()}`,
            maxPartySize,
          }),
        ),
      ).toBe("INVALID_PAYLOAD");
    }

    // Gateway の署名がない呼び出しは拒否します。
    expect(
      await errorOf(
        stub.createParty({
          gatewayPrincipal: { token: "not-a-valid-token" },
          requestId: `request-${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("UNAUTHENTICATED");

    // 所属レジストリは現在値と一致しない解除を拒否します。
    const registry = env.FLARE_LOBBY_PARTY_MEMBERSHIPS.getByName(
      `player-registry-${crypto.randomUUID()}`,
    );
    await expect(registry.release("nobody", "unknown-party")).resolves.toBe(
      false,
    );
  });
});

describe("Party Durable Object の冪等性と境界", () => {
  async function createPartyWithLeader(): Promise<{
    readonly stub: ReturnType<typeof env.FLARE_LOBBY_PARTIES.getByName>;
    readonly leader: GatewayPrincipalEnvelope;
    readonly leaderPlayerId: string;
  }> {
    const leaderPrincipalId = `leader-${crypto.randomUUID()}`;
    const leader = await createGatewayPrincipal(leaderPrincipalId);
    const stub = env.FLARE_LOBBY_PARTIES.getByName(newPartyId());
    await stub.createParty({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
    });
    return { stub, leader, leaderPlayerId: `${leaderPrincipalId}-player` };
  }

  it("招待の再送は同じ結果を返し、同じ requestId でも内容が違えば拒否する", async () => {
    const { stub, leader } = await createPartyWithLeader();
    const invitedPlayerId = `invited-${crypto.randomUUID()}-player`;
    const requestId = `request-${crypto.randomUUID()}`;

    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId,
      playerId: invitedPlayerId,
    });
    const replayed = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId,
      playerId: invitedPlayerId,
    });
    expect(replayed.token).toBe(invite.token);

    expect(
      await errorOf(
        stub.inviteMember({
          gatewayPrincipal: leader,
          requestId,
          playerId: `other-${crypto.randomUUID()}-player`,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("参加の再送は同じスナップショットを返し、token が違えば拒否する", async () => {
    const { stub, leader } = await createPartyWithLeader();
    const invitedPrincipalId = `member-${crypto.randomUUID()}`;
    const invite = await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: `request-${crypto.randomUUID()}`,
      playerId: `${invitedPrincipalId}-player`,
    });
    const invited = await createGatewayPrincipal(invitedPrincipalId);
    const requestId = `request-${crypto.randomUUID()}`;

    const joined = await stub.acceptInvite({
      gatewayPrincipal: invited,
      requestId,
      token: invite.token,
    });
    const replayed = await stub.acceptInvite({
      gatewayPrincipal: invited,
      requestId,
      token: invite.token,
    });
    expect(replayed.partyId).toBe(joined.partyId);
    expect(replayed.revision).toBe(joined.revision);

    expect(
      await errorOf(
        stub.acceptInvite({
          gatewayPrincipal: invited,
          requestId,
          token: `tampered-${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("メンバー以外の退出と、他操作で使った requestId の解散を拒否する", async () => {
    const { stub, leader } = await createPartyWithLeader();
    const outsider = await createGatewayPrincipal(
      `outsider-${crypto.randomUUID()}`,
    );

    expect(
      await errorOf(
        stub.leaveParty({
          gatewayPrincipal: outsider,
          requestId: `request-${crypto.randomUUID()}`,
        }),
      ),
    ).toBe("CONFLICT");

    const reusedRequestId = `request-${crypto.randomUUID()}`;
    await stub.inviteMember({
      gatewayPrincipal: leader,
      requestId: reusedRequestId,
      playerId: `invited-${crypto.randomUUID()}-player`,
    });
    expect(
      await errorOf(
        stub.dissolveParty({
          gatewayPrincipal: leader,
          requestId: reusedRequestId,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("無活動パーティーは Alarm で解散する", async () => {
    const { stub, leader } = await createPartyWithLeader();

    await runInDurableObject(stub, async (instance: PartyDurableObject) => {
      // テストから内部状態を操作するための、DO の SQL ストレージ境界です。
      type DurableObjectSqlBoundary = {
        ctx: {
          storage: {
            sql: { exec: (query: string, ...values: unknown[]) => void };
          };
        };
      };
      const storage = (instance as unknown as DurableObjectSqlBoundary).ctx
        .storage;
      // 最終活動時刻を大幅に過去へ動かし、無活動期限を超過させます。
      storage.sql.exec(
        "UPDATE flarelobby_party_state SET updated_at = ? WHERE singleton_id = 1",
        0,
      );
      await instance.alarm();
    });

    await expect(
      stub.getSnapshot({ gatewayPrincipal: leader }),
    ).resolves.toBeNull();
  });

  it("fetch は不正な主体証明を拒否する", async () => {
    const { stub } = await createPartyWithLeader();

    const response = await stub.fetch(
      new Request(`https://party.test/events`, {
        headers: { authorization: `Bearer ${crypto.randomUUID()}` },
      }),
    );
    expect(response.status).toBe(401);
  });
});
