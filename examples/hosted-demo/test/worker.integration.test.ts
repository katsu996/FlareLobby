import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createHostedDemoGateway } from "../src/gateway.js";

async function fetchAs(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return SELF.fetch(
    new Request(`https://example.test${path}`, { ...init, headers }),
  );
}

function authorized(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { Authorization: "Bearer sample-player" },
    body: JSON.stringify(body),
  };
}

describe("公開デモのWorker導線", () => {
  it("ブラウザ静的ページとヘルスチェックを返す", async () => {
    const page = await SELF.fetch("https://example.test/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    await expect(page.text()).resolves.toContain(
      "FlareLobby 公開じゃんけんデモ",
    );

    const health = await SELF.fetch("https://example.test/health");
    await expect(health.json()).resolves.toEqual({ status: "ready" });
  });

  it("認証なしのGateway操作を拒否する", async () => {
    const create = await fetchAs("/v1/custom-rooms", {
      method: "POST",
      body: JSON.stringify({
        requestId: `hosted-noauth-${crypto.randomUUID()}`,
        name: "noauth",
        visibility: "unlisted",
        joinMethod: "invitation",
        maxPlayers: 2,
        settings: { map: "forest" },
      }),
    });
    expect(create.status).toBe(401);

    const rps = await fetchAs("/v1/demo/rps/matches/m-1");
    expect(rps.status).toBe(401);

    const result = await fetchAs(
      "/v1/matchmaking/pools/ranked-jp/matches/m-1/result",
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `hosted-result-${crypto.randomUUID()}`,
        }),
      },
    );
    expect(result.status).toBe(401);
  });

  it("任意Bearerとx-demo-playerを拒否する", async () => {
    const body = {
      requestId: `hosted-arbitrary-${crypto.randomUUID()}`,
      name: "arbitrary",
      visibility: "unlisted",
      joinMethod: "invitation",
      maxPlayers: 2,
      settings: { map: "forest" },
    };

    // local-demo 形式の任意 Bearer は Supabase JWT 検証で拒否する。
    const arbitrary = await fetchAs("/v1/custom-rooms", authorized(body));
    expect(arbitrary.status).toBe(401);

    // x-demo-player だけでは認証できない。
    const headerOnly = await fetchAs("/v1/custom-rooms", {
      method: "POST",
      headers: { "x-demo-player": "sample-player" },
      body: JSON.stringify(body),
    });
    expect(headerOnly.status).toBe(401);

    // x-demo-player と任意 Bearer の併用も拒否する。
    const combined = await fetchAs("/v1/custom-rooms", {
      method: "POST",
      headers: {
        Authorization: "Bearer sample-player",
        "x-demo-player": "sample-player",
      },
      body: JSON.stringify(body),
    });
    expect(combined.status).toBe(401);

    // 壊れた token も拒否する。
    const malformed = await fetchAs("/v1/custom-rooms", {
      method: "POST",
      headers: { Authorization: "Bearer invalid" },
      body: JSON.stringify(body),
    });
    expect(malformed.status).toBe(401);

    // RPS 入口と勝敗直送入口も同じく拒否する。
    const rps = await fetchAs(
      "/v1/demo/rps/matches/m-1/move",
      authorized({ move: "rock" }),
    );
    expect(rps.status).toBe(401);
    const result = await fetchAs(
      "/v1/matchmaking/pools/ranked-jp/matches/m-1/result",
      authorized({ result: 1 }),
    );
    expect(result.status).toBe(401);
  });

  it("公開設定（結果直送の拒否と入力制限）を維持する", async () => {
    const lobby = createHostedDemoGateway("https://project.supabase.co");
    const configuration = lobby.configuration;

    expect(configuration.customRooms.maxPlayers).toBe(4);
    expect(configuration.inputLimits.maxMessagesPerMinute).toBe(60);
    expect(configuration.inputLimits.maxRoomCreationsPerMinute).toBe(3);
    expect(configuration.matchmakingPools.map((pool) => pool.id)).toContain(
      "ranked-jp",
    );

    const authorizeMatchResult =
      configuration.authorization?.authorizeMatchResult;
    expect(authorizeMatchResult).toBeDefined();
    await expect(
      await authorizeMatchResult!({
        operation: "match_result",
        principal: { id: "user-1", playerId: "user-1" },
        matchId: "m-1",
      }),
    ).toBe(false);
  });
});
