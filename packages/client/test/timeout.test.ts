import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFlareLobbyClient,
  type FetchImplementation,
  type WebSocketConstructor,
} from "../src/index.js";

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static autoOpen = true;

  public readonly url: string;
  public readonly protocols: string | string[] | undefined;
  public readonly sent: string[] = [];
  public readyState = 0;

  private readonly listeners = new Map<string, Set<EventListener>>();

  public constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);

    if (FakeWebSocket.autoOpen) {
      queueMicrotask(() => this.emit("open", new Event("open")));
    }
  }

  public addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error("socket is not open");
    }
    this.sent.push(data);
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === 3) {
      return;
    }

    this.readyState = 3;
    this.emit(
      "close",
      new CloseEvent("close", {
        code: code ?? 1000,
        reason: reason ?? "",
      }),
    );
  }

  public open(): void {
    this.readyState = 1;
    this.emit("open", new Event("open"));
  }

  public receive(data: string): void {
    this.emit("message", new MessageEvent("message", { data }));
  }

  public emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }

    if (type === "open") {
      this.readyState = 1;
    }
  }
}

const fakeWebSocketConstructor =
  FakeWebSocket as unknown as WebSocketConstructor;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("client timeout", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("初期値・個別上書き・null・不正値を実行時に検証する", async () => {
    // 不正な既定値は構築時に INVALID_PAYLOAD になる。
    for (const invalid of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2_147_483_648,
      "100" as unknown as number,
    ]) {
      expect(() =>
        createFlareLobbyClient({
          endpoint: "https://example.test",
          getAccessToken: () => "token",
          requestTimeoutMs: invalid,
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
      expect(() =>
        createFlareLobbyClient({
          endpoint: "https://example.test",
          getAccessToken: () => "token",
          connectionTimeoutMs: invalid,
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
      expect(() =>
        createFlareLobbyClient({
          endpoint: "https://example.test",
          getAccessToken: () => "token",
          commandTimeoutMs: invalid,
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    }

    // null と undefined は無期限として受け付ける。
    const nullClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json({ ok: true }),
      requestTimeoutMs: null,
      connectionTimeoutMs: null,
      commandTimeoutMs: null,
    });
    await expect(
      nullClient.request("/v1/rooms", { timeoutMs: null }),
    ).resolves.toEqual({ ok: true });

    // 不正な個別値は操作時に INVALID_PAYLOAD になる。
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: vi.fn(),
      webSocket: fakeWebSocketConstructor,
    });
    await expect(
      client.request("/v1/rooms", { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.request("/v1/rooms", { timeoutMs: -5 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.request("/v1/rooms", { timeoutMs: Number.NaN }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.request("/v1/rooms", { timeoutMs: Number.POSITIVE_INFINITY }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.request("/v1/rooms", { timeoutMs: 2_147_483_648 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.connect("/v1/rooms/room-1/ws", { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const connection = await client.connect("/v1/rooms/room-1/ws");
    await expect(
      connection.send("room.set_ready", {}, { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("個別 timeoutMs が既定値を上書きし null で無期限に戻せる", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async () =>
      Response.json({ ok: true }),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: fetchImplementation,
      requestTimeoutMs: 1000,
    });

    // 個別指定なしは既定値を使う。fetch が即時解決すれば TIMEOUT にならない。
    await expect(client.request("/v1/rooms")).resolves.toEqual({ ok: true });

    // null で明示的な無期限にできる。fake timers を進めても解決済みのため影響しない。
    await expect(
      client.request("/v1/rooms", { timeoutMs: null }),
    ).resolves.toEqual({ ok: true });

    // 不正な上書きは INVALID_PAYLOAD。
    await expect(
      client.request("/v1/rooms", { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("token 取得停止が TIMEOUT になり requestId を保持する", async () => {
    const tokenGate = deferred<string>();
    // Abort 非対応の token 取得を模倣する。signal を受けず永遠に待つ。
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => tokenGate.promise,
      fetch: vi.fn(async () => Response.json({ ok: true })),
      requestIdFactory: () => "request-timeout-1",
    });

    const pending = client.request("/v1/rooms", {
      timeoutMs: 1000,
      idempotent: true,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
      requestId: "request-timeout-1",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    // 遅延した token 解決で状態が復活しない。
    tokenGate.resolve("late-token");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("HTTP ヘッダー受信停止と本文受信停止が TIMEOUT になる", async () => {
    const fetchGate = deferred<Response>();
    const fetchImplementation: FetchImplementation = vi.fn(
      () => fetchGate.promise,
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: fetchImplementation,
      requestIdFactory: () => "request-fetch-stall",
    });

    const pending = client.request("/v1/rooms", {
      timeoutMs: 500,
      requestId: "request-fetch-stall",
    });
    // 内部 AbortController の signal が fetch へ渡る。
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    const passedSignal = (fetchImplementation as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1]?.signal as AbortSignal | undefined;
    expect(passedSignal).toBeInstanceOf(AbortSignal);

    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
      requestId: "request-fetch-stall",
    });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(passedSignal?.aborted).toBe(true);

    // 遅延 response が処理済みの待機を復活させない。
    fetchGate.resolve(Response.json({ late: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    // 本文 text() 停止の検証。
    const hangingBody = {
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response;
    const bodyClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => hangingBody,
    });
    const bodyPending = bodyClient.request("/v1/rooms", { timeoutMs: 300 });
    const bodyAssertion = expect(bodyPending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(300);
    await bodyAssertion;
  });

  it("WebSocket 未 open が TIMEOUT になり遅延 open は登録されない", async () => {
    FakeWebSocket.autoOpen = false;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
    });

    const pending = client.connect("/v1/rooms/room-1/ws", { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(socket?.readyState).toBe(3);

    // 期限切れ後の遅延 open で接続が復活しない。
    socket?.open();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("command 無応答が TIMEOUT になり requestId を保持する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: () => "command-timeout-1",
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    // connect 時の autoOpen マイクロタスクを消化する。
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];

    const pending = connection.send(
      "room.set_ready",
      { ready: true },
      { timeoutMs: 800 },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
      requestId: "command-timeout-1",
    });
    await vi.advanceTimersByTimeAsync(800);
    await assertion;

    // 遅延 message が処理済みの待機を復活させない。
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "command-timeout-1",
        payload: { late: true },
      }),
    );
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    // 接続自体は閉じない。
    expect(connection.closed).toBe(false);
  });

  it("正常完了はタイマーを残さない", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json({ ok: true }),
      webSocket: fakeWebSocketConstructor,
      requestTimeoutMs: 1000,
      connectionTimeoutMs: 1000,
      commandTimeoutMs: 1000,
    });

    await expect(client.request("/v1/rooms")).resolves.toEqual({ ok: true });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    const pending = connection.send("room.ping", {});
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: JSON.parse(socket?.sent[0] ?? "{}").requestId,
        payload: { ok: true },
      }),
    );
    await expect(pending).resolves.toEqual({ ok: true });
    // 成功後にタイマーが残らない。
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Abort 先行は CANCELLED、期限先行は TIMEOUT で二重 settle しない", async () => {
    // Abort 先行。
    const abortFirstClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => new Promise<string>(() => undefined),
      fetch: vi.fn(async () => Response.json({ ok: true })),
      requestIdFactory: () => "abort-first",
    });
    const abortController = new AbortController();
    const abortFirst = abortFirstClient.request("/v1/rooms", {
      timeoutMs: 1000,
      signal: abortController.signal,
      requestId: "abort-first",
    });
    const abortFirstAssertion = expect(abortFirst).rejects.toMatchObject({
      code: "CANCELLED",
      requestId: "abort-first",
    });
    abortController.abort();
    await abortFirstAssertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);

    // 期限先行。期限後に Abort しても TIMEOUT のまま。
    const timeoutFirstClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => new Promise<string>(() => undefined),
      fetch: vi.fn(),
      requestIdFactory: () => "timeout-first",
    });
    const timeoutController = new AbortController();
    const timeoutFirst = timeoutFirstClient.request("/v1/rooms", {
      timeoutMs: 1000,
      signal: timeoutController.signal,
      requestId: "timeout-first",
    });
    const timeoutAssertion = expect(timeoutFirst).rejects.toMatchObject({
      code: "TIMEOUT",
      requestId: "timeout-first",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await timeoutAssertion;
    timeoutController.abort();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);

    // command の Abort 先行 / 期限先行。
    const commandClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: (() => {
        let n = 0;
        return () => `cmd-${++n}`;
      })(),
    });
    const commandConnection = await commandClient.connect(
      "/v1/rooms/room-1/ws",
    );
    await Promise.resolve();

    const commandAbortController = new AbortController();
    const commandAbortFirst = commandConnection.send(
      "room.set_ready",
      {},
      { timeoutMs: 1000, signal: commandAbortController.signal },
    );
    const commandAbortAssertion = expect(
      commandAbortFirst,
    ).rejects.toMatchObject({
      code: "CANCELLED",
      requestId: "cmd-1",
    });
    commandAbortController.abort();
    await commandAbortAssertion;

    const commandTimeout = commandConnection.send(
      "room.set_ready",
      {},
      { timeoutMs: 500 },
    );
    const commandTimeoutAssertion = expect(
      commandTimeout,
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      requestId: "cmd-2",
    });
    await vi.advanceTimersByTimeAsync(500);
    await commandTimeoutAssertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose と期限切れが競合しても漏れがない", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => new Promise<string>(() => undefined),
      fetch: vi.fn(async () => Response.json({ ok: true })),
      webSocket: fakeWebSocketConstructor,
    });

    const pending = client.request("/v1/rooms", { timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    client.dispose();
    await assertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);

    // connect の dispose 競合。
    FakeWebSocket.autoOpen = false;
    const connectClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => new Promise<string>(() => undefined),
      webSocket: fakeWebSocketConstructor,
    });
    const connectPending = connectClient.connect("/v1/rooms/room-1/ws", {
      timeoutMs: 1000,
    });
    const connectAssertion = expect(connectPending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    connectClient.dispose();
    await connectAssertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("command 一件の期限切れが別 command を中断しない", async () => {
    let sequence = 0;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: () => `isolated-${++sequence}`,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];

    const first = connection.send("room.set_ready", {}, { timeoutMs: 500 });
    const second = connection.send("room.ping", {}, { timeoutMs: 5000 });
    const firstAssertion = expect(first).rejects.toMatchObject({
      code: "TIMEOUT",
      requestId: "isolated-1",
    });
    await vi.advanceTimersByTimeAsync(500);
    await firstAssertion;
    expect(connection.closed).toBe(false);

    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "isolated-2",
        payload: { ok: true },
      }),
    );
    await expect(second).resolves.toEqual({ ok: true });
  });

  it("未設定時は従来の無期限・Abort 対応を維持する", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          // 標準 fetch と同様に AbortSignal へ対応する。
          if (init?.signal?.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
            },
            { once: true },
          );
        }),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: fetchImplementation,
    });

    const controller = new AbortController();
    const pending = client.request("/v1/rooms", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    // 無期限のためタイマーが設定されない。
    expect(vi.getTimerCount()).toBe(0);
    // Abort で CANCELLED になる。
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });

    // command も無期限で Abort できる。
    const wsClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await wsClient.connect("/v1/rooms/room-1/ws");
    await Promise.resolve();
    const commandController = new AbortController();
    const commandPending = connection.send(
      "room.set_ready",
      {},
      { signal: commandController.signal },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    commandController.abort();
    await expect(commandPending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("Client 既定値が transport 経由の要求に適用される", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async () =>
      Response.json({ rooms: [], nextCursor: null }),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => new Promise<string>(() => undefined),
      fetch: fetchImplementation,
      requestTimeoutMs: 400,
    });

    const pending = client.listCustomRooms();
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });
});

describe("client timeout edge branches", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("事前 abort・fetch 失敗・不正応答を timeout 設定時も正規化する", async () => {
    const baseClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: vi.fn(),
      webSocket: fakeWebSocketConstructor,
    });

    // 事前に abort 済みの要求は fetch へ進まず CANCELLED。
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      baseClient.request("/v1/rooms", {
        timeoutMs: 1000,
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });

    // fetch が汎用例外を投げると CONNECTION_FAILED。
    const throwingClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      throwingClient.request("/v1/rooms", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    // Response 風でない戻りは CONNECTION_FAILED。
    const invalidResponseClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => ({}) as unknown as Response,
    });
    await expect(
      invalidResponseClient.request("/v1/rooms", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    // HTTP 状態コードと不正 JSON 本文を正規化する。
    const statusClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => new Response("{}", { status: 401 }),
    });
    await expect(
      statusClient.request("/v1/rooms", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const malformedClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => new Response("{not-json", { status: 200 }),
    });
    await expect(
      malformedClient.request("/v1/rooms", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "INVALID_MESSAGE" });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("接続の事前 abort・protocol 不正・ソケット生成失敗を timeout 設定時も処理する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      client.connect("/v1/rooms/room-1/ws", {
        timeoutMs: 1000,
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });

    await expect(
      client.connect("/v1/rooms/room-1/ws", {
        timeoutMs: 1000,
        protocols: [""],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const failingClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocketFactory: () => {
        throw new Error("constructor failed");
      },
    });
    await expect(
      failingClient.connect("/v1/rooms/room-1/ws", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    // 接続中の利用者 abort は CANCELLED になる。
    FakeWebSocket.autoOpen = false;
    const abortController = new AbortController();
    const abortClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
    });
    const pending = abortClient.connect("/v1/rooms/room-1/ws", {
      timeoutMs: 5000,
      signal: abortController.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    abortController.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Raw JSON イベント接続にも connectionTimeoutMs が適用される", async () => {
    const partyTimestamp = "2026-01-01T00:00:00.000Z";
    const partyEnvelope = {
      party: {
        partyId: "party-1",
        revision: 1,
        maxPartySize: 4,
        members: [
          { playerId: "leader-1", role: "leader", joinedAt: partyTimestamp },
        ],
        invites: [],
        queuedTicket: null,
        createdAt: partyTimestamp,
        updatedAt: partyTimestamp,
      },
    };

    // 未 open のイベント接続は TIMEOUT になる。
    FakeWebSocket.autoOpen = false;
    const timeoutClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json(partyEnvelope),
      webSocket: fakeWebSocketConstructor,
      connectionTimeoutMs: 700,
    });
    const timeoutPending = timeoutClient.createParty({ maxPartySize: 4 });
    const timeoutAssertion = expect(timeoutPending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    // HTTP 完了後にイベント接続のタイマーが設定されるまで microtask を流す。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      if (vi.getTimerCount() > 0) {
        break;
      }
    }
    await vi.advanceTimersByTimeAsync(700);
    await timeoutAssertion;
    expect(FakeWebSocket.instances[0]?.readyState).toBe(3);

    // 正常時はタイマーを残さない。
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    const okClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json(partyEnvelope),
      webSocket: fakeWebSocketConstructor,
      connectionTimeoutMs: 5000,
    });
    const party = await okClient.createParty({ maxPartySize: 4 });
    expect(party.id).toBe("party-1");
    expect(vi.getTimerCount()).toBe(0);
    okClient.dispose();

    // dispose 競合のイベント接続は CANCELLED になる。
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = false;
    const abortClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json(partyEnvelope),
      webSocket: fakeWebSocketConstructor,
      connectionTimeoutMs: 5000,
    });
    const abortPending = abortClient.createParty({ maxPartySize: 4 });
    const abortAssertion = expect(abortPending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    // HTTP 完了後にイベント接続のタイマーが設定されるまで microtask を流す。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      if (FakeWebSocket.instances.length > 0) {
        break;
      }
    }
    abortClient.dispose();
    await abortAssertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("command の送信失敗と失敗応答を timeout 設定時も正規化する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: (() => {
        let n = 100;
        return () => `edge-${++n}`;
      })(),
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];

    // 失敗応答はサーバーのコードをそのまま返す。
    const failurePending = connection.send(
      "room.kick",
      { playerId: "p-1" },
      { timeoutMs: 5000 },
    );
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "failure",
        requestId: "edge-101",
        error: { code: "FORBIDDEN", message: "権限がありません。" },
      }),
    );
    await expect(failurePending).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 送信例外は CONNECTION_FAILED になる。
    const throwingSocket = {
      readyState: 1,
      addEventListener(_type: string, _listener: EventListener): void {},
      removeEventListener(_type: string, _listener: EventListener): void {},
      send(): void {
        throw new Error("send failed");
      },
      close(): void {},
    };
    const throwingClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      webSocketFactory: () => throwingSocket as unknown as WebSocket,
      requestIdFactory: () => "edge-send-fail",
    });
    const throwingConnection = await throwingClient.connect(
      "/v1/rooms/room-1/ws",
    );
    await expect(
      throwingConnection.send("room.set_ready", {}, { timeoutMs: 1000 }),
    ).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      requestId: "edge-send-fail",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("client timeout additional branches", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("token 失敗を timeout 設定時も正規化する", async () => {
    const unauthClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => {
        throw new Error("provider boom");
      },
      fetch: vi.fn(),
    });
    await expect(
      unauthClient.request("/v1/rooms", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const emptyTokenClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "",
      fetch: vi.fn(),
    });
    await expect(
      emptyTokenClient.request("/v1/rooms", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const connectUnauthClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => {
        throw new Error("provider boom");
      },
      webSocket: fakeWebSocketConstructor,
    });
    await expect(
      connectUnauthClient.connect("/v1/rooms/room-1/ws", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("イベント接続のソケット生成失敗と error イベントを timeout 設定時も処理する", async () => {
    const envelope = {
      party: {
        partyId: "party-9",
        revision: 1,
        maxPartySize: 4,
        members: [
          {
            playerId: "leader-1",
            role: "leader",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        invites: [],
        queuedTicket: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    const failingClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json(envelope),
      webSocketFactory: () => {
        throw new Error("constructor failed");
      },
      connectionTimeoutMs: 1000,
    });
    await expect(
      failingClient.createParty({ maxPartySize: 4 }),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    // error イベントで切断される。
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = false;
    const errorClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json(envelope),
      webSocket: fakeWebSocketConstructor,
      connectionTimeoutMs: 5000,
    });
    const errorPending = errorClient.createParty({ maxPartySize: 4 });
    const errorAssertion = expect(errorPending).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      if (FakeWebSocket.instances.length > 0) {
        break;
      }
    }
    FakeWebSocket.instances[0]?.emit("error", new Event("error"));
    await errorAssertion;
    expect(vi.getTimerCount()).toBe(0);
    errorClient.dispose();
  });
});

describe("client timeout remaining branches", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dispose 時に fetch が AbortError で終了しても CANCELLED になる", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
            },
            { once: true },
          );
        }),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: fetchImplementation,
    });
    const pending = client.request("/v1/rooms", { timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await vi.advanceTimersByTimeAsync(0);
    client.dispose();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("期限切れ後のイベント接続の遅延 open は登録されない", async () => {
    const envelope = {
      party: {
        partyId: "party-late",
        revision: 1,
        maxPartySize: 4,
        members: [
          {
            playerId: "leader-1",
            role: "leader",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        invites: [],
        queuedTicket: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    FakeWebSocket.autoOpen = false;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token",
      fetch: async () => Response.json(envelope),
      webSocket: fakeWebSocketConstructor,
      connectionTimeoutMs: 400,
    });
    const pending = client.createParty({ maxPartySize: 4 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      if (FakeWebSocket.instances.length > 0) {
        break;
      }
    }
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
    const socket = FakeWebSocket.instances[0];
    expect(socket?.readyState).toBe(3);
    // 遅延 open しても復活しない。
    socket?.open();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
    client.dispose();
  });
});
