import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface TicketResponse {
  readonly ticket: {
    readonly id: string;
    readonly status: string;
    readonly result?: { readonly matchId: string };
  };
}

interface RpsResponse {
  readonly matchId: string;
  readonly ready: boolean;
  readonly result: {
    readonly outcome: string;
    readonly applied: boolean | null;
  } | null;
  readonly rating?: { readonly value: number };
}

async function requestAs<T>(
  path: string,
  player: string,
  init: RequestInit = {},
): Promise<{ readonly response: Response; readonly body: T }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${player}`);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await SELF.fetch(
    new Request(`https://example.test${path}`, { ...init, headers }),
  );
  return { response, body: (await response.json()) as T };
}

describe("ローカルじゃんけんサンプルのWorker導線", () => {
  it("ブラウザ静的ページとヘルスチェックを返す", async () => {
    const page = await SELF.fetch("https://example.test/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    await expect(page.text()).resolves.toContain(
      "FlareLobby じゃんけんアリーナ",
    );

    const health = await SELF.fetch("https://example.test/health");
    await expect(health.json()).resolves.toEqual({ status: "ready" });
  });

  it("招待ルームの作成と参加をGatewayへ接続する", async () => {
    const create = await requestAs<{
      readonly roomId: string;
      readonly invitationCode: string;
    }>("/v1/custom-rooms", "sample-host", {
      method: "POST",
      body: JSON.stringify({
        requestId: `sample-custom-create-${crypto.randomUUID()}`,
        name: "サンプルテスト",
        visibility: "unlisted",
        joinMethod: "invitation",
        maxPlayers: 2,
        settings: { map: "forest" },
      }),
    });
    expect(create.response.status).toBe(201);
    expect(create.body.invitationCode).toMatch(/^[A-Z0-9]{6}$/u);

    const join = await requestAs<{ readonly roomId: string }>(
      "/v1/custom-rooms/join",
      "sample-player",
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `sample-custom-join-${crypto.randomUUID()}`,
          invitationCode: create.body.invitationCode,
          role: "player",
        }),
      },
    );
    expect(join.response.status).toBe(200);
    expect(join.body.roomId).toBe(create.body.roomId);
  });

  it("2チケットを同じMatchへ接続し、結果再送を一度だけELOへ反映する", async () => {
    const first = await requestAs<TicketResponse>(
      "/v1/matchmaking/pools/ranked-jp/tickets",
      "sample-rank-a",
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `sample-rank-a-${crypto.randomUUID()}`,
          rating: 1_500,
          inputMethod: "keyboard_mouse",
          ttlMs: 60_000,
        }),
      },
    );
    const second = await requestAs<TicketResponse>(
      "/v1/matchmaking/pools/ranked-jp/tickets",
      "sample-rank-b",
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `sample-rank-b-${crypto.randomUUID()}`,
          rating: 1_500,
          inputMethod: "keyboard_mouse",
          ttlMs: 60_000,
        }),
      },
    );

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    const secondMatchId = second.body.ticket.result?.matchId;
    expect(secondMatchId).toBeTruthy();
    if (secondMatchId === undefined) {
      throw new Error("Match成立結果がありません。");
    }

    const firstTicket = await requestAs<TicketResponse>(
      `/v1/matchmaking/pools/ranked-jp/tickets/${encodeURIComponent(first.body.ticket.id)}`,
      "sample-rank-a",
    );
    expect(firstTicket.body.ticket.result?.matchId).toBe(secondMatchId);

    const movePath = `/v1/demo/rps/matches/${encodeURIComponent(secondMatchId)}/move`;
    const firstMove = await requestAs<RpsResponse>(movePath, "sample-rank-a", {
      method: "POST",
      body: JSON.stringify({ move: "rock" }),
    });
    expect(firstMove.response.status).toBe(200);
    expect(firstMove.body.ready).toBe(false);

    const secondMove = await requestAs<RpsResponse>(movePath, "sample-rank-b", {
      method: "POST",
      body: JSON.stringify({ move: "paper" }),
    });
    expect(secondMove.response.status).toBe(200);
    expect(secondMove.body.ready).toBe(true);
    expect(secondMove.body.result?.applied).toBe(true);
    expect(secondMove.body.rating?.value).toBeGreaterThan(1_500);

    const resend = await requestAs<RpsResponse>(movePath, "sample-rank-b", {
      method: "POST",
      body: JSON.stringify({ move: "paper" }),
    });
    expect(resend.body.result?.applied).toBe(false);

    const rows = await env.FLARE_LOBBY_DB.prepare(
      "SELECT COUNT(*) AS count FROM flarelobby_rating_matches WHERE match_id = ?",
    )
      .bind(secondMatchId)
      .first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });
});
