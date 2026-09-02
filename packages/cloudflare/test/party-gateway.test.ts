import { env } from "cloudflare:test";
import type { FlareLobbyErrorPayload } from "@flarelobby/core";
import { describe, expect, it } from "vitest";

import { defineFlareLobby } from "../src/index.js";
import {
  getPartyWebSocketRoute,
  handlePartyRequest,
} from "../src/party-gateway.js";
import type { MatchmakingPool } from "@flarelobby/core";

const pool: MatchmakingPool = {
  id: "party-gateway-test-pool",
  gameId: "party-gateway-game",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp",
};

const baseConfiguration = {
  customRooms: {
    maxPlayers: 4,
    defaultSettings: {},
  },
  authenticate: (request: Request) => {
    const principalId = request.headers.get("x-test-principal");
    if (principalId !== null && principalId.length > 0) {
      return { id: principalId, playerId: `${principalId}-player` };
    }

    return null;
  },
  matchmakingPools: [pool],
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10,
  },
};

const testLobby = defineFlareLobby(baseConfiguration);

const testWorker = testLobby.createGatewayWorker<Env>();

interface PartyMemberResponse {
  readonly playerId: string;
  readonly role: "leader" | "member";
}

interface PartySnapshotResponse {
  readonly partyId: string;
  readonly revision: number;
  readonly maxPartySize: number;
  readonly members: readonly PartyMemberResponse[];
}

async function fetchWorker(
  path: string,
  principalId: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-test-principal", principalId);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return testWorker.fetch(
    new Request(`https://example.test${path}`, {
      ...init,
      headers,
    }) as unknown as Parameters<typeof testWorker.fetch>[0],
    env,
    {} as ExecutionContext,
  );
}

function uniquePrincipal(label: string): string {
  return `party-gateway-${label}-${crypto.randomUUID()}`;
}

async function createParty(
  principalId: string,
  body: Record<string, unknown> = {},
): Promise<PartySnapshotResponse> {
  const response = await fetchWorker("/v1/parties", principalId, {
    method: "POST",
    body: JSON.stringify({
      requestId: `create-${principalId}`,
      ...body,
    }),
  });
  expect(response.status).toBe(201);
  const parsed = await response.json<{
    readonly party: PartySnapshotResponse;
  }>();
  return parsed.party;
}

async function listEventTypes(
  partyId: string,
  principalId: string,
): Promise<readonly string[]> {
  const response = await fetchWorker(
    `/v1/parties/${encodeURIComponent(partyId)}/events`,
    principalId,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    readonly events: readonly { readonly type: string }[];
  }>();
  return body.events.map((event) => event.type);
}

function encodeWebSocketToken(token: string): string {
  const bytes = new TextEncoder().encode(token);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

describe("party-gateway ルーティング", () => {
  it("events/ws 以外の events パスは WebSocket ルートとして判定しない", () => {
    expect(getPartyWebSocketRoute("/v1/parties/party-1/events/ws")).toEqual({
      partyId: "party-1",
    });
    expect(getPartyWebSocketRoute("/v1/parties/party-1/events")).toBeNull();
    expect(getPartyWebSocketRoute("/v1/parties//events/ws")).toBeNull();
    expect(getPartyWebSocketRoute("/v1/parties/%zz/events/ws")).toBeNull();
  });

  it("未認識パスでは null を返して後段ハンドラーに委ねる", async () => {
    const configuration = testLobby.configuration;
    const authenticated = {
      principal: { id: "principal-1", playerId: "player-1" },
      gatewayPrincipal: {
        playerId: "player-1",
        token: "test-token",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    };

    await expect(
      handlePartyRequest(
        new Request("https://example.test/v1/rooms"),
        env,
        configuration,
        authenticated,
      ),
    ).resolves.toBeNull();
    await expect(
      handlePartyRequest(
        new Request("https://example.test/v1/parties/%zz"),
        env,
        configuration,
        authenticated,
      ),
    ).resolves.toBeNull();
  });
});

describe("Party Gateway API", () => {
  it("作成から招待、受諾、リーダー委譲、退出、解散までを公開する", async () => {
    const leader = uniquePrincipal("leader");
    const created = await createParty(leader);
    expect(created.members).toHaveLength(1);
    expect(created.members[0]?.role).toBe("leader");

    // 取得
    const fetched = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}`,
      leader,
    );
    expect(fetched.status).toBe(200);
    const fetchedBody = await fetched.json<{
      readonly party: PartySnapshotResponse | null;
    }>();
    expect(fetchedBody.party?.revision).toBe(created.revision);

    // 招待
    const invited = uniquePrincipal("invited");
    const inviteResponse = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/invites`,
      leader,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `invite-${created.partyId}`,
          playerId: `${invited}-player`,
          ttlMs: 60_000,
        }),
      },
    );
    expect(inviteResponse.status).toBe(200);
    const { invite } = await inviteResponse.json<{
      readonly invite: { readonly token: string };
    }>();
    expect(invite.token.length).toBeGreaterThan(0);

    // 受諾
    const acceptedResponse = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/members`,
      invited,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `accept-${invited}`,
          token: invite.token,
        }),
      },
    );
    expect(acceptedResponse.status).toBe(200);
    const accepted = await acceptedResponse.json<{
      readonly party: PartySnapshotResponse;
    }>();
    expect(accepted.party.members.map((member) => member.role)).toContain(
      "member",
    );

    // 2 人目を招待して受諾（退出時に解散しないようにする）
    const invited2 = uniquePrincipal("invited-2");
    const invite2Response = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/invites`,
      leader,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `invite-2-${created.partyId}`,
          playerId: `${invited2}-player`,
        }),
      },
    );
    expect(invite2Response.status).toBe(200);
    const { invite: invite2 } = await invite2Response.json<{
      readonly invite: { readonly token: string };
    }>();
    const accepted2Response = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/members`,
      invited2,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `accept-${invited2}`,
          token: invite2.token,
        }),
      },
    );
    expect(accepted2Response.status).toBe(200);

    // リーダー委譲
    const transferredResponse = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/transfer-leadership`,
      leader,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `transfer-${created.partyId}`,
          playerId: `${invited}-player`,
        }),
      },
    );
    expect(transferredResponse.status).toBe(200);
    const transferred = await transferredResponse.json<{
      readonly party: PartySnapshotResponse;
    }>();
    const roles = new Map(
      transferred.party.members.map((member) => [member.playerId, member.role]),
    );
    expect(roles.get(`${invited}-player`)).toBe("leader");

    // 旧リーダーが退出
    const leaveResponse = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/leave`,
      leader,
      {
        method: "POST",
        body: JSON.stringify({ requestId: `leave-${created.partyId}` }),
      },
    );
    expect(leaveResponse.status).toBe(200);
    const left = await leaveResponse.json<{ readonly dissolved: boolean }>();
    expect(left.dissolved).toBe(false);

    // 解放前のイベント履歴を確認する
    expect(await listEventTypes(created.partyId, invited)).toContain(
      "member_left",
    );

    // 新リーダーが解散
    const dissolvedResponse = await fetchWorker(
      `/v1/parties/${encodeURIComponent(created.partyId)}/dissolve`,
      invited,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `dissolve-${created.partyId}`,
        }),
      },
    );
    expect(dissolvedResponse.status).toBe(200);
  });

  it("存在しないパーティーの取得は null を返す", async () => {
    const response = await fetchWorker(
      `/v1/parties/${encodeURIComponent(`missing-${crypto.randomUUID()}`)}`,
      uniquePrincipal("get-missing"),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ readonly party: unknown }>();
    expect(body.party).toBeNull();
  });

  it("最後のメンバーが退出するとパーティーは解散扱いになる", async () => {
    const leader = uniquePrincipal("solo-leave");
    const party = await createParty(leader);
    const response = await fetchWorker(
      `/v1/parties/${encodeURIComponent(party.partyId)}/leave`,
      leader,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ readonly dissolved: boolean }>();
    expect(body.dissolved).toBe(true);
  });

  it("maxPartySize とイベント履歴を公開する", async () => {
    const leader = uniquePrincipal("sized");
    const party = await createParty(leader, { maxPartySize: 2 });
    expect(party.maxPartySize).toBe(2);
    expect(await listEventTypes(party.partyId, leader)).toEqual(["created"]);
  });
});

describe("Party Gateway API バリデーション", () => {
  it("requestId 欠落の作成は INVALID_PAYLOAD", async () => {
    const response = await fetchWorker(
      "/v1/parties",
      uniquePrincipal("no-id"),
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json<FlareLobbyErrorPayload>();
    expect(body.code).toBe("INVALID_PAYLOAD");
  });

  it("不正な maxPartySize の作成は INVALID_PAYLOAD", async () => {
    for (const maxPartySize of [-1, 0, 1.5, "large"]) {
      const response = await fetchWorker(
        "/v1/parties",
        uniquePrincipal("bad-size"),
        {
          method: "POST",
          body: JSON.stringify({
            requestId: `create-${crypto.randomUUID()}`,
            maxPartySize,
          }),
        },
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      const body = await response.json<FlareLobbyErrorPayload>();
      expect(body.code).toBe("INVALID_PAYLOAD");
    }
  });

  it("JSON でない本文は INVALID_MESSAGE、配列本文は INVALID_PAYLOAD", async () => {
    const notJson = await fetchWorker(
      "/v1/parties",
      uniquePrincipal("not-json"),
      {
        method: "POST",
        body: "not-json{{",
      },
    );
    expect(notJson.status).toBeGreaterThanOrEqual(400);
    const notJsonBody = await notJson.json<FlareLobbyErrorPayload>();
    expect(notJsonBody.code).toBe("INVALID_MESSAGE");

    const arrayBody = await fetchWorker(
      "/v1/parties",
      uniquePrincipal("array-body"),
      {
        method: "POST",
        body: JSON.stringify([]),
      },
    );
    expect(arrayBody.status).toBeGreaterThanOrEqual(400);
    const arrayJson = await arrayBody.json<FlareLobbyErrorPayload>();
    expect(arrayJson.code).toBe("INVALID_PAYLOAD");
  });

  it("サイズ上限を超える本文は INVALID_MESSAGE", async () => {
    const lobby = defineFlareLobby({
      ...baseConfiguration,
      inputLimits: {
        ...baseConfiguration.inputLimits,
        maxHttpRequestBytes: 64,
      },
    });
    const worker = lobby.createGatewayWorker<Env>();
    const headers = new Headers({
      "x-test-principal": "oversize",
      "content-type": "application/json",
    });
    const response = await worker.fetch(
      new Request("https://example.test/v1/parties", {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId: "x".repeat(128) }),
      }) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json<FlareLobbyErrorPayload>();
    expect(body.code).toBe("INVALID_MESSAGE");
  });

  it("対応しないメソッドや未知の操作は 404 を返す", async () => {
    const leader = uniquePrincipal("method-leader");
    const party = await createParty(leader);
    const encoded = encodeURIComponent(party.partyId);

    const wrongRequests = [
      ["PUT", "/v1/parties"],
      ["GET", `/v1/parties/${encoded}/invites`],
      ["DELETE", `/v1/parties/${encoded}`],
      ["POST", `/v1/parties/${encoded}/unknown-op`],
      ["GET", `/v1/parties/${encoded}/transfer-leadership`],
    ] as const;
    for (const [method, path] of wrongRequests) {
      const response = await fetchWorker(path, leader, { method });
      expect(response.status).toBe(404);
    }
  });

  it("不正な ttlMs の招待は INVALID_PAYLOAD、playerId 欠落も拒否される", async () => {
    const leader = uniquePrincipal("ttl-leader");
    const party = await createParty(leader);
    const encoded = encodeURIComponent(party.partyId);

    const badTtl = await fetchWorker(`/v1/parties/${encoded}/invites`, leader, {
      method: "POST",
      body: JSON.stringify({
        requestId: `invite-${crypto.randomUUID()}`,
        playerId: "some-player",
        ttlMs: -5,
      }),
    });
    expect(badTtl.status).toBeGreaterThanOrEqual(400);
    expect((await badTtl.json<FlareLobbyErrorPayload>()).code).toBe(
      "INVALID_PAYLOAD",
    );

    const missingPlayer = await fetchWorker(
      `/v1/parties/${encoded}/invites`,
      leader,
      {
        method: "POST",
        body: JSON.stringify({ requestId: `invite-${crypto.randomUUID()}` }),
      },
    );
    expect(missingPlayer.status).toBeGreaterThanOrEqual(400);
    expect((await missingPlayer.json<FlareLobbyErrorPayload>()).code).toBe(
      "INVALID_PAYLOAD",
    );
  });
});

describe("Party イベント WebSocket", () => {
  it("署名済みトークンで履歴を受信できる", async () => {
    const leader = uniquePrincipal("ws-leader");
    const party = await createParty(leader);
    const path = `/v1/parties/${encodeURIComponent(party.partyId)}/events/ws`;
    const response = await testWorker.fetch(
      new Request(`https://example.test${path}`, {
        method: "GET",
        headers: {
          Upgrade: "websocket",
          "x-test-principal": leader,
          "Sec-WebSocket-Protocol": `flarelobby.v1, flarelobby.auth.${encodeWebSocketToken("test-token")}`,
        },
      }) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(101);
    if (response.webSocket === null) {
      throw new Error("パーティーイベント WebSocket が返されませんでした。");
    }

    const message = new Promise<string>((resolve) => {
      response.webSocket!.addEventListener("message", (event) => {
        resolve((event as MessageEvent).data as string);
      });
    });
    response.webSocket.accept();
    const payload = JSON.parse(await message) as { readonly type: string };
    expect(payload.type).toBe("created");
    response.webSocket.close();
  });

  it("非 WebSocket リクエストの events/ws は拒否される", async () => {
    const leader = uniquePrincipal("ws-reject");
    const party = await createParty(leader);
    const rejected = await testWorker.fetch(
      new Request(
        `https://example.test/v1/parties/${encodeURIComponent(party.partyId)}/events/ws`,
        { method: "GET", headers: { "x-test-principal": leader } },
      ) as unknown as Parameters<typeof testWorker.fetch>[0],
      env,
      {} as ExecutionContext,
    );
    expect(rejected.status).toBeGreaterThanOrEqual(400);
  });
});
