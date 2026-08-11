import {
  createFlareLobbyClient,
  type FlareLobbyClient,
  type PlayerRoom,
  type Room
} from "@flarelobby/client";
import type {
  AnyFlareLobbyApp,
  MatchmakingPool,
  RoomSnapshot
} from "@flarelobby/core";
import {
  createExecutionContext,
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMatchmakingPoolKey,
  createGatewayPrincipalEnvelope,
  defineFlareLobby,
  RoomDurableObject
} from "../src/index.js";

const integrationPool = {
  id: "workers-integration-ranked-1v1",
  gameId: "workers-integration",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp"
} satisfies MatchmakingPool;

const integrationLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 2,
    maxSpectators: 1,
    defaultSettings: { map: "forest", mode: "integration" },
    disconnectGracePeriodMs: 5_000,
    resumeTokenTtlMs: 60_000,
    eventHistoryLimit: 32
  },
  matchmakingPools: [
    {
      ...integrationPool,
      rating: { initialRating: 1_500, kFactor: 32 },
      matchRoom: {
        settings: { map: "arena", mode: "ranked" },
        metadata: { source: "client-integration" },
        maxPlayers: 2,
        minimumPlayers: 2,
        requireAllPlayersReady: false
      }
    }
  ],
  authenticate: (request) => {
    const authorization = request.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/u)?.[1];

    return token === undefined
      ? null
      : { id: token, playerId: `${token}-player` };
  },
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true,
    authorizeMatchResult: () => true
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 120,
    maxRoomCreationsPerMinute: 60
  }
});

const integrationWorker = integrationLobby.createGatewayWorker<Env>();
const activeClients = new Set<FlareLobbyClient>();

type EventListener = (event: Event) => void;

function createCloseEvent(code: number, reason: string): Event {
  const event = new Event("close");
  Object.defineProperties(event, {
    code: { value: code },
    reason: { value: reason },
    wasClean: { value: code === 1000 }
  });
  return event;
}

/** Workers Runtime の WebSocket を Client SDK の標準 WebSocket 契約へ橋渡しします。 */
class WorkerWebSocketAdapter {
  public readonly url: string;
  public readonly protocol = "flarelobby.v1";
  private readonly protocols: readonly string[];
  private readonly listeners = new Map<string, Set<EventListener>>();
  private remote: WebSocket | undefined;
  private readyStateValue = 0;
  private closeDispatched = false;

  public constructor(
    url: string,
    protocols: readonly string[],
    private readonly fetchWorker: (
      request: Request
    ) => Promise<Response>
  ) {
    this.url = url;
    this.protocols = protocols;
    void this.open();
  }

  public get readyState(): number {
    return this.readyStateValue;
  }

  public addEventListener(
    type: string,
    listener: EventListener
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(
    type: string,
    listener: EventListener
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    if (this.readyStateValue !== 1 || this.remote === undefined) {
      throw new Error("WebSocket is not open");
    }

    this.remote.send(data);
  }

  public close(code = 1000, reason = "client closed"): void {
    if (this.closeDispatched) {
      return;
    }

    const remote = this.remote;
    if (remote === undefined) {
      this.finishClose(code, reason);
      return;
    }

    this.closeDispatched = true;
    this.readyStateValue = 2;
    remote.close(code, reason);
    this.readyStateValue = 3;
    this.dispatch("close", createCloseEvent(code, reason));
  }

  public async forceNetworkClose(): Promise<void> {
    if (this.closeDispatched) {
      return;
    }

    const remote = this.remote;
    if (remote === undefined) {
      this.finishClose(1006, "network drop");
      return;
    }

    // The server sees a real close frame and persists `disconnected_at`; the
    // SDK sees an abnormal close and therefore starts its reconnect path.
    this.closeDispatched = true;
    this.readyStateValue = 2;
    remote.close(1000, "network drop");
    this.remote = undefined;
    this.readyStateValue = 3;
    this.dispatch("close", createCloseEvent(1006, "network drop"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  private async open(): Promise<void> {
    try {
      const requestUrl = new URL(this.url);
      requestUrl.protocol = requestUrl.protocol === "wss:" ? "https:" : "http:";
      const response = await this.fetchWorker(
        new Request(requestUrl, {
          method: "GET",
          headers: {
            Upgrade: "websocket",
            "Sec-WebSocket-Protocol": this.protocols.join(", ")
          }
        })
      );
      const remote = response.webSocket;

      if (response.status !== 101 || remote === null) {
        this.finishClose(1006, "upgrade failed");
        this.dispatch("error", new Event("error"));
        return;
      }

      this.remote = remote;
      remote.addEventListener("message", (event) => {
        this.dispatch("message", event);
      });
      remote.addEventListener("error", (event) => {
        this.dispatch("error", event);
      });
      remote.addEventListener("close", (event) => {
        if (!this.closeDispatched) {
          const closeEvent = event as CloseEvent;
          this.finishClose(closeEvent.code, closeEvent.reason);
        }
      });
      remote.accept();
      this.readyStateValue = 1;
      this.dispatch("open", new Event("open"));
    } catch {
      this.finishClose(1006, "upgrade failed");
      this.dispatch("error", new Event("error"));
    }
  }

  private finishClose(code: number, reason: string): void {
    if (this.closeDispatched) {
      return;
    }

    this.closeDispatched = true;
    this.remote = undefined;
    this.readyStateValue = 3;
    this.dispatch("close", createCloseEvent(code, reason));
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

async function runWorker(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await integrationWorker.fetch(
    request as unknown as Parameters<typeof integrationWorker.fetch>[0],
    env,
    context
  );
  await waitOnExecutionContext(context);
  return response;
}

function createClient(label = crypto.randomUUID()): {
  readonly client: FlareLobbyClient;
  readonly sockets: Set<WorkerWebSocketAdapter>;
} {
  const sockets = new Set<WorkerWebSocketAdapter>();
  const client = createFlareLobbyClient({
    endpoint: "https://example.test",
    getAccessToken: () => label,
    fetch: (input, init) => runWorker(new Request(input, init)),
    webSocketFactory: (url, protocols) => {
      const socket = new WorkerWebSocketAdapter(url, protocols, runWorker);
      sockets.add(socket);
      return socket as unknown as WebSocket;
    },
    requestIdFactory: () => `client-request-${crypto.randomUUID()}`,
    reconnect: {
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 250,
      jitterRatio: 0
    }
  });

  activeClients.add(client);
  return { client, sockets };
}

async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 4_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("統合テストの状態遷移がタイムアウトしました。");
}

async function waitForSnapshot<TApp extends AnyFlareLobbyApp>(
  room: Room<TApp>,
  predicate: (snapshot: RoomSnapshot<TApp>) => boolean,
  timeoutMs = 4_000
): Promise<RoomSnapshot<TApp>> {
  if (predicate(room.snapshot)) {
    return room.snapshot;
  }

  return new Promise<RoomSnapshot<TApp>>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = room.subscribe((snapshot) => {
      if (!predicate(snapshot)) {
        return;
      }

      if (timer !== undefined) {
        clearTimeout(timer);
      }
      unsubscribe();
      resolve(snapshot);
    });

    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Room Snapshot の待機がタイムアウトしました。"));
    }, timeoutMs);
  });
}

async function waitForRoomStatus(
  room: Room,
  status: "connected" | "reconnecting" | "disconnected",
  timeoutMs = 4_000
): Promise<void> {
  if (room.connectionStatus === status) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = room.onStatusChange((nextStatus) => {
      if (nextStatus !== status) {
        return;
      }

      if (timer !== undefined) {
        clearTimeout(timer);
      }
      unsubscribe();
      resolve();
    });

    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Room の接続状態 ${status} を待機できませんでした。`));
    }, timeoutMs);
  });
}

async function waitForDisconnectedConnection(roomId: string): Promise<void> {
  await waitForCondition(async () => {
    const count = await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(roomId),
      (_instance: RoomDurableObject, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count
             FROM flarelobby_room_connections
             WHERE room_id = ? AND disconnected_at IS NOT NULL`,
            roomId
          )
          .one().count
    );

    return count > 0;
  });
}

async function createMatchedRooms(): Promise<{
  readonly firstClient: FlareLobbyClient;
  readonly secondClient: FlareLobbyClient;
  readonly firstTicket: Awaited<ReturnType<FlareLobbyClient["joinMatchmaking"]>>;
  readonly firstRoom: PlayerRoom;
  readonly secondRoom: PlayerRoom;
}> {
  const first = createClient(`match-first-${crypto.randomUUID()}`);
  const second = createClient(`match-second-${crypto.randomUUID()}`);
  const firstTicket = await first.client.joinMatchmaking(integrationPool, {
    requestId: `match-ticket-first-${crypto.randomUUID()}`,
    rating: 1_500
  });
  const firstRoomPromise = firstTicket.waitForMatch();
  const secondRoomPromise = second.client.findMatch(integrationPool, {
    requestId: `match-ticket-second-${crypto.randomUUID()}`,
    rating: 1_500
  });
  const [firstRoom, secondRoom] = await Promise.all([
    firstRoomPromise,
    secondRoomPromise
  ]);

  return {
    firstClient: first.client,
    secondClient: second.client,
    firstTicket,
    firstRoom,
    secondRoom
  };
}

afterEach(() => {
  for (const client of activeClients) {
    client.dispose();
  }
  activeClients.clear();
});

describe("Workers Client SDK 横断統合", () => {
  it("D1 migrationとDurable ObjectのBindingをWorkers Runtimeへ適用できる", async () => {
    const migrations = await env.FLARE_LOBBY_DB.prepare(
      "SELECT name FROM d1_migrations"
    ).all<{ name: string }>();
    const names = migrations.results.map((row) => row.name);

    expect(names).toEqual(
      expect.arrayContaining(["0001_custom_room_index.sql", "0002_rating.sql"])
    );

    await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(`binding-${crypto.randomUUID()}`),
      (instance: RoomDurableObject, state) => {
        expect(instance).toBeInstanceOf(RoomDurableObject);
        expect(state.storage.sql).toBeDefined();
      }
    );
  });

  it("Client SDKからカスタムルームの作成、参加、準備、開始、退出を完了できる", async () => {
    const hostClient = createClient(`custom-host-${crypto.randomUUID()}`);
    const playerClient = createClient(`custom-player-${crypto.randomUUID()}`);
    const host = await hostClient.client.createCustomRoom({
      requestId: `custom-create-${crypto.randomUUID()}`,
      maxPlayers: 2,
      settings: { map: "forest", mode: "integration" }
    });
    const player = await playerClient.client.joinCustomRoom({
      requestId: `custom-join-${crypto.randomUUID()}`,
      roomId: host.id
    });

    expect(host.snapshot.participants).toHaveLength(2);
    expect(player.snapshot.room.id).toBe(host.id);

    await player.setReady(true, {
      requestId: `custom-ready-player-${crypto.randomUUID()}`
    });
    await waitForSnapshot(
      host,
      (snapshot) =>
        snapshot.participants.some(
          (participant) =>
            participant.id === player.participantId &&
            participant.kind === "player" &&
            participant.ready
        )
    );
    await host.setReady(true, {
      requestId: `custom-ready-host-${crypto.randomUUID()}`
    });

    const started = await host.startMatch({
      requestId: `custom-start-${crypto.randomUUID()}`
    });
    expect(started.state.status).toBe("in_progress");

    await player.leave({
      requestId: `custom-leave-${crypto.randomUUID()}`
    });
    await waitForSnapshot(
      host,
      (snapshot) => snapshot.participants.length === 1
    );
    expect(host.snapshot.participants).toHaveLength(1);
  });

  it("満員直前の同時参加で定員を超えず、同じチケット作成要求を重複処理しない", async () => {
    const hostClient = createClient(`capacity-host-${crypto.randomUUID()}`);
    const joiners = [
      createClient(`capacity-a-${crypto.randomUUID()}`),
      createClient(`capacity-b-${crypto.randomUUID()}`),
      createClient(`capacity-c-${crypto.randomUUID()}`)
    ];
    const host = await hostClient.client.createCustomRoom({
      requestId: `capacity-create-${crypto.randomUUID()}`,
      maxPlayers: 2
    });
    const joinResults = await Promise.allSettled(
      joiners.map((joiner, index) =>
        joiner.client.joinCustomRoom({
          roomId: host.id,
          requestId: `capacity-join-${index}-${crypto.randomUUID()}`
        })
      )
    );
    const successfulJoins = joinResults.filter(
      (result): result is PromiseFulfilledResult<PlayerRoom> =>
        result.status === "fulfilled"
    );

    expect(successfulJoins).toHaveLength(1);
    const playerCount = await runInDurableObject(
      env.FLARE_LOBBY_ROOMS.getByName(host.id),
      (_instance: RoomDurableObject, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_room_participants WHERE kind = 'player'"
          )
          .one().count
    );
    expect(playerCount).toBe(2);

    const duplicateClient = createClient(`duplicate-ticket-${crypto.randomUUID()}`);
    const requestId = `duplicate-ticket-request-${crypto.randomUUID()}`;
    const [firstTicket, secondTicket] = await Promise.all([
      duplicateClient.client.joinMatchmaking(integrationPool, {
        requestId,
        rating: 1_500
      }),
      duplicateClient.client.joinMatchmaking(integrationPool, {
        requestId,
        rating: 1_500
      })
    ]);

    expect(firstTicket.id).toBe(secondTicket.id);
    const processedCount = await runInDurableObject(
      env.FLARE_LOBBY_MATCH_POOLS.getByName(createMatchmakingPoolKey(integrationPool)),
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM flarelobby_matchmaking_processed_commands WHERE request_id = ?",
            requestId
          )
          .one().count
    );
    expect(processedCount).toBe(1);
    await firstTicket.cancel({
      requestId: `duplicate-ticket-cancel-${crypto.randomUUID()}`
    });
  });

  it("WebSocket切断後に再接続し、切断中のSnapshotを復元できる", async () => {
    const hostClient = createClient(`resume-host-${crypto.randomUUID()}`);
    const playerClient = createClient(`resume-player-${crypto.randomUUID()}`);
    const host = await hostClient.client.createCustomRoom({
      requestId: `resume-create-${crypto.randomUUID()}`,
      maxPlayers: 2
    });
    const player = await playerClient.client.joinCustomRoom({
      requestId: `resume-join-${crypto.randomUUID()}`,
      roomId: host.id,
      reconnect: {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 200,
        jitterRatio: 0
      }
    });
    const revisionBeforeDisconnect = player.snapshot.revision;
    const reconnecting = waitForRoomStatus(player, "reconnecting");
    const socket = [...playerClient.sockets][0];

    if (socket === undefined) {
      throw new Error("Room WebSocket が作成されていません。");
    }

    await socket.forceNetworkClose();
    await reconnecting;
    await waitForDisconnectedConnection(host.id);

    await host.setReady(true, {
      requestId: `resume-ready-${crypto.randomUUID()}`
    });
    await waitForCondition(
      () =>
        player.connectionStatus === "connected" &&
        player.snapshot.revision > revisionBeforeDisconnect &&
        player.snapshot.participants.some(
          (participant) =>
            participant.id === host.participantId &&
            participant.kind === "player" &&
            participant.ready
        )
    );

    expect(player.snapshot.participants).toHaveLength(2);
    expect(player.snapshot.revision).toBeGreaterThan(revisionBeforeDisconnect);
    expect(player.connectionStatus).toBe("connected");
  });

  it("2クライアントのランクキューを成立させ、対戦ルームへ接続できる", async () => {
    const first = createClient(`queue-first-${crypto.randomUUID()}`);
    const second = createClient(`queue-second-${crypto.randomUUID()}`);
    const progress: string[] = [];
    const ticket = await first.client.joinMatchmaking(integrationPool, {
      requestId: `queue-first-ticket-${crypto.randomUUID()}`,
      rating: 1_500
    });
    const unsubscribe = ticket.on("progress", (event) => {
      progress.push(event.ticket.status);
    });
    const firstRoomPromise = ticket.waitForMatch();
    const secondRoom = await second.client.findMatch(integrationPool, {
      requestId: `queue-second-ticket-${crypto.randomUUID()}`,
      rating: 1_500
    });
    const firstRoom = await firstRoomPromise;
    unsubscribe();

    expect(ticket.status).toBe("matched");
    expect(progress).toContain("matched");
    expect(firstRoom.snapshot.room.kind).toBe("match");
    expect(secondRoom.snapshot.room.kind).toBe("match");
    if (secondRoom.snapshot.room.kind !== "match") {
      throw new Error("対戦ルームの Snapshot を期待しました。");
    }
    expect(firstRoom.snapshot.room.id).toBe(secondRoom.snapshot.room.id);
    expect(firstRoom.snapshot.participants).toHaveLength(2);
    expect(secondRoom.snapshot.room.matchId).toBeTruthy();
  });

  it("同じ試合結果を同時登録してもELO更新を一度だけ適用する", async () => {
    const matched = await createMatchedRooms();
    const snapshot = matched.firstRoom.snapshot;

    if (snapshot.room.kind !== "match") {
      throw new Error("対戦ルームの Snapshot を期待しました。");
    }

    const matchId = snapshot.room.matchId;
    const resultId = `integration-result-${crypto.randomUUID()}`;
    const resultPath = `/v1/matchmaking/pools/${encodeURIComponent(
      integrationPool.id
    )}/matches/${encodeURIComponent(matchId)}/result`;
    const [firstResult, duplicateResult] = await Promise.all([
      matched.firstClient.request<{ applied: boolean }>(resultPath, {
        method: "POST",
        body: { resultId, result: 1 }
      }),
      matched.secondClient.request<{ applied: boolean }>(resultPath, {
        method: "POST",
        body: { resultId, result: 1 }
      })
    ]);

    expect([firstResult.applied, duplicateResult.applied]).toContain(true);
    expect(
      [firstResult.applied, duplicateResult.applied].filter(Boolean)
    ).toHaveLength(1);

    const matchRows = await env.FLARE_LOBBY_DB.prepare(
      "SELECT COUNT(*) AS count FROM flarelobby_rating_matches WHERE match_id = ?"
    )
      .bind(matchId)
      .first<{ count: number }>();
    expect(matchRows?.count).toBe(1);

    const updatedRatings = await Promise.all([
      matched.firstClient.getRating(integrationPool),
      matched.secondClient.getRating(integrationPool)
    ]);
    expect(updatedRatings.some((rating) => rating.value !== 1_500)).toBe(true);
    expect(
      updatedRatings.reduce((total, rating) => total + rating.value, 0)
    ).toBe(3_000);
  });

  it("Alarm実行後とDurable Object再生成後も状態変更を継続できる", async () => {
    const clientLabel = `alarm-room-${crypto.randomUUID()}`;
    const client = createClient(clientLabel);
    const room = await client.client.createCustomRoom({
      requestId: `alarm-create-${crypto.randomUUID()}`,
      maxPlayers: 2
    });
    const roomStub = env.FLARE_LOBBY_ROOMS.getByName(room.id);
    const operationId = `integration-alarm-${crypto.randomUUID()}`;

    await runInDurableObject(roomStub, (instance: RoomDurableObject) =>
      instance.scheduleOperation({
        id: operationId,
        dueAt: Date.now() - 1,
        kind: "noop"
      })
    );
    expect(await roomStub.getSnapshot()).toEqual(room.snapshot);
    const alarmRan = await runDurableObjectAlarm(roomStub);
    const remainingOperations = await roomStub.listScheduledOperations();
    const operationWasConsumed = !remainingOperations.some(
      (operation: { readonly id: string }) => operation.id === operationId
    );
    expect(alarmRan || operationWasConsumed).toBe(true);
    expect(operationWasConsumed).toBe(true);

    const revisionBeforeEviction = room.snapshot.revision;
    client.client.dispose();
    await waitForDisconnectedConnection(room.id);
    await evictDurableObject(roomStub);
    const restored = await roomStub.getSnapshot();
    expect(restored?.revision).toBe(revisionBeforeEviction);

    const gatewayPrincipal = await createGatewayPrincipalEnvelope(
      env.FLARE_LOBBY_TOKEN_SECRET,
      { id: clientLabel, playerId: `${clientLabel}-player` }
    );
    if (!gatewayPrincipal.ok) {
      throw new Error("テスト用 Gateway 主体証明を作成できません。");
    }
    const changed = await roomStub.setReady({
      gatewayPrincipal: gatewayPrincipal.value,
      participantId: room.participantId,
      ready: true,
      requestId: `alarm-after-eviction-${crypto.randomUUID()}`
    });
    expect(changed.revision).toBeGreaterThan(revisionBeforeEviction);

  });
});
