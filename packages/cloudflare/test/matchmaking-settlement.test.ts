import { evictDurableObject, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type {
  MatchCandidate,
  MatchmakingPool,
  MatchmakingSearchPolicy,
  Participant,
  Team,
} from "@flarelobby/core";

import {
  MatchPoolDurableObject,
  createGatewayPrincipalEnvelope,
  createMatchmakingMatchId,
  createMatchmakingPoolKey,
  createMatchmakingRoomId,
  defineFlareLobby,
} from "../src/index.js";
import type {
  FlareLobbyGatewayWorker,
  GatewayPrincipalEnvelope,
  MatchmakingMatchIntent,
  MatchmakingMatchRoomOptions,
  MatchmakingTicketCreationOptions,
  RoomInitializationOptions,
} from "../src/index.js";

function createPool(suffix = crypto.randomUUID()): MatchmakingPool {
  return {
    id: `settlement-${suffix}`,
    gameId: `test-game-${suffix}`,
    seasonId: "season-1",
    mode: "ranked-1v1",
    region: "jp",
  };
}

function createNarrowSearchPolicy(): MatchmakingSearchPolicy {
  return {
    stages: [{ afterMs: 0, maxRatingDifference: 10 }],
    maxRatingDifference: 10,
    maxTicketsPerSearch: 16,
    maxCandidatesPerSearch: 64,
    maxMatchesPerSearch: 4,
  };
}

async function createGatewayPrincipal(
  principalId: string,
): Promise<GatewayPrincipalEnvelope> {
  const result = await createGatewayPrincipalEnvelope(
    env.FLARE_LOBBY_TOKEN_SECRET,
    { id: principalId, playerId: `${principalId}-player` },
  );

  if (!result.ok) {
    throw new Error("Gateway 主体証明を作成できません。");
  }

  return result.value;
}

function createTicketOptions(
  gatewayPrincipal: GatewayPrincipalEnvelope,
  overrides: Partial<MatchmakingTicketCreationOptions> = {},
): MatchmakingTicketCreationOptions {
  return {
    gatewayPrincipal,
    requestId: `request-${crypto.randomUUID()}`,
    rating: 1_500,
    inputMethod: "keyboard_mouse",
    searchAttributes: { platform: "web", role: "duelist" },
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

async function createInitializedPool(
  pool = createPool(),
  options: {
    readonly matchRoom?: MatchmakingMatchRoomOptions;
    readonly searchPolicy?: MatchmakingSearchPolicy;
  } = {},
): Promise<{
  readonly pool: MatchmakingPool;
  readonly stub: DurableObjectStub<MatchPoolDurableObject>;
}> {
  const stub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
    createMatchmakingPoolKey(pool),
  );
  await stub.initialize({
    pool,
    ...(options.searchPolicy === undefined
      ? {}
      : { searchPolicy: options.searchPolicy }),
    ...(options.matchRoom === undefined
      ? {}
      : { matchRoom: options.matchRoom }),
  });
  return { pool, stub };
}

function createCandidate(
  pool: MatchmakingPool,
  firstTicketId: string,
  secondTicketId: string,
): MatchCandidate {
  const ticketIds = [firstTicketId, secondTicketId].sort() as [string, string];

  return {
    id: `candidate:${encodeURIComponent(ticketIds[0]!)}:${encodeURIComponent(ticketIds[1]!)}`,
    pool,
    ticketIds,
    createdAt: new Date().toISOString(),
  };
}

async function initializeConflictingCustomRoom(roomId: string): Promise<void> {
  const room = env.FLARE_LOBBY_ROOMS.getByName(roomId);
  const participant: Participant = {
    kind: "player",
    id: "conflict-participant",
    player: { id: "conflict-player" },
    teamId: null,
    ready: false,
  };

  await room.initialize({
    room: {
      id: roomId,
      kind: "custom",
      invitationCode: "CONFLICT",
      visibility: "unlisted",
      settings: {},
      metadata: {},
    },
    host: {
      participantId: participant.id,
      playerId: participant.player.id,
    },
    participants: [participant],
    maxPlayers: 4,
  });
}

async function removeRoomState(roomId: string): Promise<void> {
  await runInDurableObject(
    env.FLARE_LOBBY_ROOMS.getByName(roomId),
    (_instance, state) => {
      for (const table of [
        "flarelobby_room_connections",
        "flarelobby_room_events",
        "flarelobby_room_scheduled_operations",
        "flarelobby_processed_commands",
        "flarelobby_room_participants",
        "flarelobby_room_teams",
        "flarelobby_rooms",
      ]) {
        state.storage.sql.exec(`DELETE FROM ${table}`);
      }
    },
  );
}

function createMatchRoomInitialization(
  intent: Pick<MatchmakingMatchIntent, "matchId" | "room">,
  ticketPlayers: readonly [string, string],
): RoomInitializationOptions {
  const participants: readonly Participant[] = ticketPlayers.map(
    (playerId, index) => ({
      kind: "player" as const,
      id: `participant_${intent.matchId}_${index + 1}`,
      player: { id: playerId },
      teamId: index === 0 ? "blue" : "red",
      ready: false,
    }),
  );
  const teams: readonly Team[] = [{ id: "blue" }, { id: "red" }];

  return {
    room: intent.room,
    participants,
    teams,
    maxPlayers: 2,
    minimumPlayers: 2,
    requireAllPlayersReady: false,
  };
}
const resultSoloPool: MatchmakingPool = {
  id: "settlement-result-solo",
  gameId: "settlement-result-game",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp",
};

const resultTeamPool: MatchmakingPool = {
  id: "settlement-result-team",
  gameId: "settlement-result-game",
  seasonId: "season-1",
  mode: "ranked-2v2",
  region: "jp",
  maxPartySize: 2,
  teamSize: 2,
};

function createResultLobby(authorizeMatchResult: boolean) {
  return defineFlareLobby({
    customRooms: {
      maxPlayers: 4,
      defaultSettings: {},
    },
    matchmakingPools: [resultSoloPool, resultTeamPool],
    authenticate: (request) => {
      const principalId = request.headers.get("x-test-principal");
      if (principalId !== null && principalId.length > 0) {
        return { id: principalId, playerId: `${principalId}-player` };
      }

      return null;
    },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
    ...(authorizeMatchResult
      ? { authorization: { authorizeMatchResult: () => true } }
      : {}),
  });
}

const resultWorker = createResultLobby(true).createGatewayWorker<Env>();
const deniedWorker = createResultLobby(false).createGatewayWorker<Env>();

async function fetchResultWorker(
  worker: FlareLobbyGatewayWorker<Env>,
  path: string,
  principalId: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-test-principal", principalId);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return worker.fetch(
    new Request(`https://example.test${path}`, {
      ...init,
      headers,
    }) as unknown as Parameters<typeof worker.fetch>[0],
    env,
    {} as ExecutionContext,
  );
}

interface PartyUnderTest {
  readonly partyId: string;
  readonly leaderPrincipalId: string;
  readonly memberPlayerIds: readonly [string, string];
}

/** リーダー + メンバー 1 人のパーティーを直接 DO 操作で作成します。 */
async function createTestParty(prefix: string): Promise<PartyUnderTest> {
  const partyId = `party_${crypto.randomUUID()}`;
  const stub = env.FLARE_LOBBY_PARTIES.getByName(partyId);
  const leaderPrincipalId = `${prefix}-leader-${crypto.randomUUID()}`;
  const memberPrincipalId = `${prefix}-member-${crypto.randomUUID()}`;
  const leaderPlayerId = `${leaderPrincipalId}-player`;
  const memberPlayerId = `${memberPrincipalId}-player`;
  const leader = await createGatewayPrincipal(leaderPrincipalId);
  const member = await createGatewayPrincipal(memberPrincipalId);

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
    leaderPrincipalId,
    memberPlayerIds: [leaderPlayerId, memberPlayerId],
  };
}

describe("Matchmaking match settlement", () => {
  it("2 チケットから 1 Room を作成し、両チケットへ同じ成立結果を返す", async () => {
    const { pool, stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_501 }),
    );

    expect(first.status).toBe("waiting");
    expect(second.status).toBe("matched");

    const currentFirst = await stub.getTicket(first.id);
    const currentSecond = await stub.getTicket(second.id);

    expect(currentFirst?.status).toBe("matched");
    expect(currentSecond?.status).toBe("matched");

    if (
      currentFirst?.status !== "matched" ||
      currentSecond?.status !== "matched"
    ) {
      throw new Error("両チケットが matched へ遷移していません。");
    }

    expect(currentFirst.result.matchId).toBe(currentSecond.result.matchId);
    expect(currentFirst.result.room.id).toBe(currentSecond.result.room.id);
    expect(currentFirst.result.candidate.ticketIds).toEqual(
      currentSecond.result.candidate.ticketIds,
    );
    expect(currentFirst.result.room.pool).toEqual(pool);

    const intent = await stub.getMatchIntent(currentFirst.result.matchId);
    expect(intent).toMatchObject({
      matchId: currentFirst.result.matchId,
      status: "matched",
      result: currentFirst.result,
    });

    const roomSnapshot = await env.FLARE_LOBBY_ROOMS.getByName(
      currentFirst.result.room.id,
    ).getSnapshot();
    expect(roomSnapshot?.room).toMatchObject({
      kind: "match",
      id: currentFirst.result.room.id,
      matchId: currentFirst.result.matchId,
    });
    expect(roomSnapshot?.participants).toHaveLength(2);
    expect(roomSnapshot?.teams).toHaveLength(2);

    const firstEvents = await stub.getTicketEvents({
      gatewayPrincipal: firstPrincipal,
      ticketId: first.id,
    });
    const secondEvents = await stub.getTicketEvents({
      gatewayPrincipal: secondPrincipal,
      ticketId: second.id,
    });
    expect(firstEvents.at(-1)?.type).toBe("matched");
    expect(secondEvents.at(-1)?.type).toBe("matched");
    expect(firstEvents.at(-1)?.ticket).toMatchObject({
      id: first.id,
      status: "matched",
    });
    expect(secondEvents.at(-1)?.ticket).toMatchObject({
      id: second.id,
      status: "matched",
    });
  });

  it("同じ成立処理と Room 初期化を再実行しても Room と成立意図を増やさない", async () => {
    const { stub } = await createInitializedPool();
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_502 }),
    );
    const matched = await stub.getTicket(first.id);

    if (matched?.status !== "matched") {
      throw new Error("成立済みチケットを取得できません。");
    }

    const room = env.FLARE_LOBBY_ROOMS.getByName(matched.result.room.id);
    const before = await room.getSnapshot();
    const processed = await stub.processPendingMatches();
    const settled = await stub.settleMatches();
    const reinitialized = await room.initialize({ room: matched.result.room });
    const after = await room.getSnapshot();
    const roomCounts = await runInDurableObject(room, (_instance, state) => ({
      rooms: state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_rooms",
        )
        .one().count,
      participants: state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM flarelobby_room_participants",
        )
        .one().count,
    }));
    const intentCount = await runInDurableObject(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_matchmaking_match_intents",
          )
          .one().count,
    );

    expect(processed).toEqual([]);
    expect(settled).toEqual([]);
    expect(reinitialized).toEqual(before);
    expect(after).toEqual(before);
    expect(roomCounts).toEqual({ rooms: 1, participants: 2 });
    expect(intentCount).toBe(1);
  });

  it("Room 通知の送信失敗でも状態イベントを永続化し、成立を中断しない", async () => {
    const pool = createPool();
    const { stub } = await createInitializedPool(pool, {
      searchPolicy: createNarrowSearchPolicy(),
    });
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_600 }),
    );
    const candidate = createCandidate(pool, first.id, second.id);
    let closeCount = 0;

    const results = await runInDurableObject(
      stub,
      async (instance: MatchPoolDurableObject, state) => {
        const failingSocket = {
          send: () => {
            throw new Error("notification failed");
          },
          close: () => {
            closeCount += 1;
          },
        } as unknown as WebSocket;
        const getWebSockets = vi
          .spyOn(state, "getWebSockets")
          .mockReturnValue([failingSocket]);

        try {
          return await instance.reserveCandidate({ candidate });
        } finally {
          getWebSockets.mockRestore();
        }
      },
    );

    expect(results.map((ticket) => ticket.status)).toEqual([
      "matched",
      "matched",
    ]);
    expect(closeCount).toBeGreaterThanOrEqual(2);
    const events = await stub.getTicketEvents({
      gatewayPrincipal: firstPrincipal,
      ticketId: first.id,
    });
    expect(events.map((event) => event.type)).toEqual([
      "creating",
      "waiting",
      "reserved",
      "matched",
    ]);
  });

  it("一時的な Room 競合から再生成後の成立処理を再開する", async () => {
    const pool = createPool();
    const { stub } = await createInitializedPool(pool, {
      searchPolicy: createNarrowSearchPolicy(),
      matchRoom: { maxAttempts: 3 },
    });
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_600 }),
    );
    const candidate = createCandidate(pool, first.id, second.id);
    const matchId = createMatchmakingMatchId(candidate.id);
    const roomId = createMatchmakingRoomId(matchId);

    await initializeConflictingCustomRoom(roomId);
    const reserved = await stub.reserveCandidate({ candidate });
    expect(reserved.map((ticket) => ticket.status)).toEqual([
      "reserved",
      "reserved",
    ]);
    const pending = await stub.getMatchIntent(candidate.id);
    expect(pending).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastErrorCode: "CONFLICT",
    });
    if (pending === null || pending.nextAttemptAt === null) {
      throw new Error("再試行予定の成立意図がありません。");
    }

    await removeRoomState(roomId);
    await evictDurableObject(stub);
    const firstCurrent = await stub.getTicket(first.id);
    const secondCurrent = await stub.getTicket(second.id);
    if (firstCurrent === null || secondCurrent === null || pending === null) {
      throw new Error("再試行に必要な状態を取得できません。");
    }

    await env.FLARE_LOBBY_ROOMS.getByName(roomId).initialize(
      createMatchRoomInitialization(pending, [
        firstCurrent.player.id,
        secondCurrent.player.id,
      ]),
    );
    const processed = await stub.processPendingMatches({
      now: pending.nextAttemptAt + 1,
    });
    const intent = await stub.getMatchIntent(candidate.id);

    expect(processed[0]?.status).toBe("matched");
    expect(intent?.status).toBe("matched");
    await expect(stub.getTicket(first.id)).resolves.toMatchObject({
      status: "matched",
    });
    await expect(stub.getTicket(second.id)).resolves.toMatchObject({
      status: "matched",
    });
  });

  it("成立とキャンセルの競合で reserved/matched の中間状態を残さない", async () => {
    const pool = createPool();
    const { stub } = await createInitializedPool(pool, {
      searchPolicy: createNarrowSearchPolicy(),
    });
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_600 }),
    );
    const candidate = createCandidate(pool, first.id, second.id);

    await runInDurableObject(stub, async (instance: MatchPoolDurableObject) => {
      await Promise.all([
        instance.reserveCandidate({ candidate }).catch(() => undefined),
        instance
          .cancelTicket({
            gatewayPrincipal: firstPrincipal,
            ticketId: first.id,
          })
          .catch(() => undefined),
      ]);
    });

    const currentFirst = await stub.getTicket(first.id);
    const currentSecond = await stub.getTicket(second.id);
    expect([currentFirst?.status, currentSecond?.status]).toEqual(
      ["matched", "matched"].includes(currentFirst?.status ?? "")
        ? ["matched", "matched"]
        : ["cancelled", "waiting"],
    );
  });

  it("回復不能な Room 競合では成立意図を failed にして予約を解放する", async () => {
    const pool = createPool();
    const { stub } = await createInitializedPool(pool, {
      searchPolicy: createNarrowSearchPolicy(),
      matchRoom: { maxAttempts: 1 },
    });
    const firstPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const secondPrincipal = await createGatewayPrincipal(
      `principal-${crypto.randomUUID()}`,
    );
    const first = await stub.createTicket(createTicketOptions(firstPrincipal));
    const second = await stub.createTicket(
      createTicketOptions(secondPrincipal, { rating: 1_600 }),
    );
    const candidate = createCandidate(pool, first.id, second.id);
    const roomId = createMatchmakingRoomId(
      createMatchmakingMatchId(candidate.id),
    );

    await initializeConflictingCustomRoom(roomId);
    const result = await stub.reserveCandidate({ candidate });
    const intent = await stub.getMatchIntent(candidate.id);
    const events = await stub.getTicketEvents({
      gatewayPrincipal: firstPrincipal,
      ticketId: first.id,
    });

    expect(result.map((ticket) => ticket.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(intent).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "CONFLICT",
      nextAttemptAt: null,
    });
    expect(events.map((event) => event.type)).not.toContain("matched");
  });
});

describe("Matchmaking Gateway 経由の試合結果登録", () => {
  const ticketsPath = `/v1/matchmaking/pools/${encodeURIComponent(resultTeamPool.id)}/tickets`;
  const resultPath = (matchId: string): string =>
    `/v1/matchmaking/pools/${encodeURIComponent(resultTeamPool.id)}/matches/${encodeURIComponent(matchId)}/result`;

  it("パーティー単位の成立から全員の結果をチームとして登録する", async () => {
    await createInitializedPool(resultTeamPool);
    const partyA = await createTestParty("result-a");
    const partyB = await createTestParty("result-b");

    let firstTicketId: string | null = null;
    for (const party of [partyA, partyB]) {
      const response = await fetchResultWorker(
        resultWorker,
        ticketsPath,
        party.leaderPrincipalId,
        {
          method: "POST",
          body: JSON.stringify({
            requestId: `request-${crypto.randomUUID()}`,
            rating: 1_500,
            partyId: party.partyId,
          }),
        },
      );
      expect(response.status).toBe(201);
      const created = await response.json<{
        readonly ticket: { readonly id: string };
      }>();
      if (firstTicketId === null) {
        firstTicketId = created.ticket.id;
      }
    }

    const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      createMatchmakingPoolKey(resultTeamPool),
    ) as unknown as MatchPoolDurableObject;
    // 候補探索は 2 枚目のチケット作成時と processPendingMatches で決定的に進む。
    await poolStub.processPendingMatches();
    const matched = await poolStub.getTicket(firstTicketId!);
    if (matched?.status !== "matched") {
      throw new Error("パーティー チケットが成立しませんでした。");
    }
    const matchId = matched.result.matchId;

    const resultId = `result_${crypto.randomUUID()}`;
    const response = await fetchResultWorker(
      resultWorker,
      resultPath(matchId),
      "result-authority",
      {
        method: "POST",
        body: JSON.stringify({ resultId, result: 1 }),
      },
    );
    expect(response.status).toBe(200);
    const payload = await response.json<{
      readonly match: {
        readonly matchId: string;
        readonly participants: readonly { readonly playerId: string }[];
      };
      readonly applied: boolean;
    }>();
    expect(payload.applied).toBe(true);

    const replayed = await fetchResultWorker(
      resultWorker,
      resultPath(matchId),
      "result-authority",
      {
        method: "POST",
        body: JSON.stringify({ resultId, result: 1 }),
      },
    );
    expect(replayed.status).toBe(200);
    await expect(replayed.json<{ applied: boolean }>()).resolves.toMatchObject({
      applied: false,
    });
  });

  it("結果登録の検証エラーと未認可を拒否する", async () => {
    await createInitializedPool(resultSoloPool);
    const soloTicketsPath = `/v1/matchmaking/pools/${encodeURIComponent(resultSoloPool.id)}/tickets`;
    const unauthorizedPath = `/v1/matchmaking/pools/${encodeURIComponent(resultSoloPool.id)}/matches/gateway-unauthorized-match/result`;

    const unauthorized = await fetchResultWorker(
      deniedWorker,
      unauthorizedPath,
      "result-authority",
      {
        method: "POST",
        body: JSON.stringify({ resultId: "result-x", result: 1 }),
      },
    );
    expect(unauthorized.status).toBe(403);
    await expect(unauthorized.json<{ code: string }>()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const invalidPayload = await fetchResultWorker(
      resultWorker,
      `${unauthorizedPath}`,
      "result-authority",
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(invalidPayload.status).toBe(400);
    await expect(
      invalidPayload.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "INVALID_PAYLOAD",
    });

    const unknownMatch = await fetchResultWorker(
      resultWorker,
      `/v1/matchmaking/pools/${encodeURIComponent(resultSoloPool.id)}/matches/settlement-unknown-match/result`,
      "result-authority",
      {
        method: "POST",
        body: JSON.stringify({
          resultId: `result_${crypto.randomUUID()}`,
          result: 1,
        }),
      },
    );
    expect(unknownMatch.status).toBe(400);
    await expect(unknownMatch.json<{ code: string }>()).resolves.toMatchObject({
      code: "CONFLICT",
    });

    // チケット作成のパーティー参照も、認可済み Worker ではリーダーのみ許可される。
    const missingParty = await fetchResultWorker(
      resultWorker,
      soloTicketsPath,
      "result-authority",
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `request-${crypto.randomUUID()}`,
          rating: 1_500,
          partyId: "party_settlement-missing-party",
        }),
      },
    );
    expect(missingParty.status).toBe(403);
  });

  it("成立後接続で Room 状態が失われた要求を拒否する", async () => {
    await createInitializedPool(resultSoloPool);
    const ticketsPath = `/v1/matchmaking/pools/${encodeURIComponent(resultSoloPool.id)}/tickets`;
    const connectionPath = (ticketId: string): string =>
      `/v1/matchmaking/pools/${encodeURIComponent(resultSoloPool.id)}/tickets/${encodeURIComponent(ticketId)}/connection`;

    const firstPrincipal = `solo-a-${crypto.randomUUID()}`;
    const firstResponse = await fetchResultWorker(
      resultWorker,
      ticketsPath,
      firstPrincipal,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `request-${crypto.randomUUID()}`,
          rating: 1_500,
        }),
      },
    );
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json<{
      readonly ticket: { readonly id: string };
    }>();

    const waitingConnection = await fetchResultWorker(
      resultWorker,
      connectionPath(first.ticket.id),
      firstPrincipal,
    );

    const secondPrincipal = `solo-b-${crypto.randomUUID()}`;
    const secondResponse = await fetchResultWorker(
      resultWorker,
      ticketsPath,
      secondPrincipal,
      {
        method: "POST",
        body: JSON.stringify({
          requestId: `request-${crypto.randomUUID()}`,
          rating: 1_500,
        }),
      },
    );
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json<{
      readonly ticket: {
        readonly id: string;
        readonly status: string;
        readonly result?: {
          readonly matchId: string;
          readonly room: { readonly id: string };
        };
      };
    }>();
    if (
      second.ticket.status !== "matched" ||
      second.ticket.result === undefined
    ) {
      throw new Error("成立済みチケットを期待しました。");
    }

    await removeRoomState(second.ticket.result.room.id);
    const lostRoomConnection = await fetchResultWorker(
      resultWorker,
      connectionPath(second.ticket.id),
      secondPrincipal,
    );
    expect(waitingConnection.status).toBe(400);
    await expect(
      waitingConnection.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });
    expect(lostRoomConnection.status).toBe(400);
    await expect(
      lostRoomConnection.json<{ code: string }>(),
    ).resolves.toMatchObject({
      code: "CONFLICT",
    });
  });
});
