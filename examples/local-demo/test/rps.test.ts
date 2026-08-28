import { SELF } from "cloudflare:test";
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
  readonly yourMove: string | null;
  readonly opponentMove: string | null;
}

async function requestAs(
  path: string,
  player: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (player.length > 0) {
    headers.set("Authorization", `Bearer ${player}`);
  }
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return SELF.fetch(
    new Request(`https://example.test${path}`, { ...init, headers }),
  );
}

async function createMatchedPair(): Promise<{
  readonly playerA: string;
  readonly playerB: string;
  readonly matchId: string;
}> {
  const suffix = crypto.randomUUID().slice(0, 6).replaceAll("-", "0");
  const players = [`rps-a-${suffix}`, `rps-b-${suffix}`] as const;
  const ticketIds: string[] = [];
  let matchId = "";

  for (const [index, player] of players.entries()) {
    const response = await requestAs(
      "/v1/matchmaking/pools/ranked-jp/tickets",
      player,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `rps-test-${player}-${index}`,
          inputMethod: "keyboard_mouse",
          ttlMs: 60_000,
        }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as TicketResponse;
    ticketIds.push(body.ticket.id);
    if (body.ticket.result?.matchId !== undefined) {
      matchId = body.ticket.result.matchId;
    }
  }

  expect(matchId).not.toBe("");
  // 片方のチケットから成立 Match を再確認する
  const confirm = await requestAs(
    `/v1/matchmaking/pools/ranked-jp/tickets/${encodeURIComponent(ticketIds[0]!)}`,
    players[0],
  );
  const confirmed = (await confirm.json()) as TicketResponse;
  expect(confirmed.ticket.result?.matchId).toBe(matchId);

  return { playerA: players[0], playerB: players[1], matchId };
}

describe("じゃんけんサンプル API のエッジ", () => {
  it("認証なしのじゃんけん API へのアクセスは 401", async () => {
    const response = await requestAs("/v1/demo/rps/matches/m-1", "");
    expect(response.status).toBe(401);
  });

  it("未知のじゃんけんルートは 404", async () => {
    const response = await requestAs(
      "/v1/demo/rps/unknown-path",
      "some-player",
    );
    expect(response.status).toBe(404);
  });

  it("状態取得、メソッド不整合、不正な手、出し直しを検証する", async () => {
    const { playerA, playerB, matchId } = await createMatchedPair();
    const encoded = encodeURIComponent(matchId);
    const statePath = `/v1/demo/rps/matches/${encoded}`;
    const movePath = `${statePath}/move`;

    // 状態取得（まだ手が出ていない）
    const state = await requestAs(statePath, playerA);
    expect(state.status).toBe(200);
    const stateBody = (await state.json()) as RpsResponse;
    expect(stateBody.ready).toBe(false);
    expect(stateBody.yourMove).toBeNull();
    expect(stateBody.opponentMove).toBeNull();

    // メソッド不整合は 404
    expect(
      (await requestAs(statePath, playerA, { method: "PUT" })).status,
    ).toBe(404);
    expect((await requestAs(movePath, playerA)).status).toBe(404);

    // 不正な手は 400
    const invalidMove = await requestAs(movePath, playerA, {
      method: "POST",
      body: JSON.stringify({ move: "spock" }),
    });
    expect(invalidMove.status).toBeGreaterThanOrEqual(400);

    // 関係者のないプレイヤーは 403
    expect(
      (
        await requestAs(movePath, "not-a-participant", {
          method: "POST",
          body: JSON.stringify({ move: "rock" }),
        })
      ).status,
    ).toBe(403);

    // A が rock を提示してから scissors へ変えようとすると 409
    const firstMove = await requestAs(movePath, playerA, {
      method: "POST",
      body: JSON.stringify({ move: "rock" }),
    });
    expect(firstMove.status).toBe(200);
    expect(((await firstMove.json()) as RpsResponse).yourMove).toBe("rock");

    const changeMove = await requestAs(movePath, playerA, {
      method: "POST",
      body: JSON.stringify({ move: "scissors" }),
    });
    expect(changeMove.status).toBeGreaterThanOrEqual(400);
    expect(((await changeMove.json()) as { readonly code: string }).code).toBe(
      "CONFLICT",
    );

    // B の着手で試合が確定し、相手の手が公開される
    const secondMove = await requestAs(movePath, playerB, {
      method: "POST",
      body: JSON.stringify({ move: "paper" }),
    });
    expect(secondMove.status).toBe(200);
    const settled = (await secondMove.json()) as RpsResponse;
    expect(settled.ready).toBe(true);
    expect(settled.opponentMove).toBe("rock");

    // 存在しない Match の状態取得は CONFLICT
    const missing = await requestAs(
      `/v1/demo/rps/matches/${encodeURIComponent(`missing-${crypto.randomUUID()}`)}`,
      playerA,
    );
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(((await missing.json()) as { readonly code: string }).code).toBe(
      "CONFLICT",
    );
  });
});
