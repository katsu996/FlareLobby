import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("@flarelobby/client", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
  });

  it("最新のアクセストークンを各 HTTP 要求へ付与し、冪等要求へ requestId を付与する", async () => {
    const tokens = ["token-a", "token-b"];
    const getAccessToken = vi.fn(async () => tokens.shift() ?? "token-last");
    const calls: Array<{
      readonly input: RequestInfo | URL;
      readonly init: RequestInit | undefined;
    }> = [];
    const fetchImplementation: FetchImplementation = vi.fn(
      async (input, init) => {
        calls.push({ input, init });
        return Response.json({ accepted: true });
      },
    );
    const signal = new AbortController().signal;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken,
      fetch: fetchImplementation,
      requestIdFactory: () => "request-1",
    });

    await client.request("/v1/custom-rooms", {
      method: "POST",
      body: { name: "練習ルーム" },
      idempotent: true,
      signal,
    });
    await client.request("/v1/rooms", { signal });

    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.input.toString()).toBe(
      "https://example.test/v1/custom-rooms",
    );
    expect(calls[0]?.init?.signal).toBe(signal);
    const firstHeaders = new Headers(calls[0]?.init?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer token-a");
    expect(firstHeaders.get("accept")).toBe("application/json");
    expect(firstHeaders.get("content-type")).toBe("application/json");
    expect(firstHeaders.get("idempotency-key")).toBe("request-1");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "練習ルーム" }));
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer token-b",
    );
    expect(
      new Headers(calls[1]?.init?.headers).get("idempotency-key"),
    ).toBeNull();
  });

  it("エンドポイントと通信経路が異なる URL は HTTP でも WebSocket でも拒否する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
    });

    // 既定ポートの一致だけで通っていた http / ws の URL を弾くことを確認します。
    await expect(
      client.request(new URL("http://example.test:443/v1/rooms")),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.connect("ws://example.test:443/v1/rooms/ws"),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("HTTP エラーを FlareLobbyError へ正規化し、内部本文を漏らさない", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async () =>
      Response.json(
        {
          code: "UNAUTHENTICATED",
          message: "認証が必要です。",
        },
        { status: 401 },
      ),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
    });

    await expect(client.request("/v1/rooms")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "認証が必要です。",
    });

    const malformedResponseFetch: FetchImplementation = vi.fn(
      async () =>
        new Response("SyntaxError: internal details", { status: 200 }),
    );
    const malformedClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: malformedResponseFetch,
    });

    await expect(malformedClient.request("/v1/rooms")).rejects.toMatchObject({
      code: "INVALID_MESSAGE",
      message: "メッセージの形式が正しくありません。",
    });
  });

  it("認証取得と通信の内部例外へ token や例外本文を含めない", async () => {
    const tokenFailureClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => {
        throw new Error("secret-token-from-provider");
      },
      fetch: vi.fn(),
    });

    await expect(tokenFailureClient.request("/v1/rooms")).rejects.toMatchObject(
      {
        code: "UNAUTHENTICATED",
        message: "認証が必要です。",
      },
    );

    const transportFailureClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(async () => {
        throw new Error("network details and secret-token");
      }),
    });

    await expect(
      transportFailureClient.request("/v1/rooms"),
    ).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "通信接続に失敗しました。",
    });
  });

  it("事前に中止された HTTP 要求を fetch へ渡さず CANCELLED にする", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation: FetchImplementation = vi.fn();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
    });

    await expect(
      client.request("/v1/rooms", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("複数クライアントの状態を分離し、dispose 後の要求を中止する", async () => {
    const fetchA: FetchImplementation = vi.fn(async () =>
      Response.json({ client: "a" }),
    );
    const fetchB: FetchImplementation = vi.fn(async () =>
      Response.json({ client: "b" }),
    );
    const clientA = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token-a",
      fetch: fetchA,
    });
    const clientB = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "token-b",
      fetch: fetchB,
    });

    await expect(clientA.request("/v1/rooms")).resolves.toEqual({
      client: "a",
    });
    await expect(clientB.request("/v1/rooms")).resolves.toEqual({
      client: "b",
    });

    clientA.dispose();
    expect(clientA.disposed).toBe(true);
    await expect(clientA.request("/v1/rooms")).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await expect(clientB.request("/v1/rooms")).resolves.toEqual({
      client: "b",
    });
  });

  it("認証付き WebSocket を開き、コマンド応答とイベントを共通プロトコルで処理する", async () => {
    const getAccessToken = vi.fn(() => "secret-token");
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken,
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: () => "ws-request-1",
    });

    const connection = await client.connect("/v1/rooms/room-1/ws", {
      knownEventTypes: ["room.snapshot"],
    });
    const socket = FakeWebSocket.instances[0];

    expect(socket?.url).toBe("wss://example.test/v1/rooms/room-1/ws");
    expect(socket?.protocols).toContain("flarelobby.v1");
    expect(socket?.protocols).toContain("flarelobby.auth.c2VjcmV0LXRva2Vu");
    expect(socket?.url).not.toContain("secret-token");
    expect(getAccessToken).toHaveBeenCalledTimes(1);

    const listener = vi.fn();
    connection.onEvent(listener);
    const responsePromise = connection.send("room.set_ready", {
      ready: true,
    });

    expect(JSON.parse(socket?.sent[0] ?? "{}")).toMatchObject({
      protocolVersion: 1,
      kind: "command",
      requestId: "ws-request-1",
      command: "room.set_ready",
      payload: { ready: true },
    });

    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "ws-request-1",
        payload: { revision: 1 },
      }),
    );
    await expect(responsePromise).resolves.toEqual({ revision: 1 });

    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "event",
        event: "room.snapshot",
        revision: 1,
        payload: { roomId: "room-1" },
      }),
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ event: "room.snapshot", revision: 1 }),
    );
  });

  it("WebSocket の失敗応答を FlareLobbyError にし、dispose で待機中コマンドを解放する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: () => "ws-request-2",
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];

    const failurePromise = connection.send("room.kick", { playerId: "p-1" });
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "failure",
        requestId: "ws-request-2",
        error: { code: "FORBIDDEN", message: "権限がありません。" },
      }),
    );
    await expect(failurePromise).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "権限がありません。",
    });

    const pendingPromise = connection.send("room.set_ready", {
      ready: true,
    });
    client.dispose();
    await expect(pendingPromise).rejects.toMatchObject({ code: "CANCELLED" });
    expect(connection.closed).toBe(true);
  });

  it("WebSocket 接続待機へ AbortSignal を伝播する", async () => {
    FakeWebSocket.autoOpen = false;
    const controller = new AbortController();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });

    const connectionPromise = client.connect("/v1/rooms/room-1/ws", {
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(connectionPromise).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(FakeWebSocket.instances[0]?.readyState).toBe(3);
  });

  const partyTimestamp = "2026-01-01T00:00:00.000Z";

  const partySnapshotValue = (
    partyId: string,
    revision: number,
    members: ReadonlyArray<{
      readonly playerId: string;
      readonly role: "leader" | "member";
    }> = [{ playerId: "leader-1", role: "leader" }],
  ) => ({
    partyId,
    revision,
    maxPartySize: 4,
    members: members.map((member) => ({
      ...member,
      joinedAt: partyTimestamp,
    })),
    invites: [],
    queuedTicket: null,
    createdAt: partyTimestamp,
    updatedAt: partyTimestamp,
  });

  const partyEnvelopeValue = (partyId: string, revision: number) => ({
    party: partySnapshotValue(partyId, revision),
  });

  const partyEventValue = (partyId: string, revision: number) => ({
    sequence: revision,
    partyRevision: revision,
    type: "member_joined",
    occurredAt: partyTimestamp,
    snapshot: partySnapshotValue(partyId, revision, [
      { playerId: "leader-1", role: "leader" },
      { playerId: "member-1", role: "member" },
    ]),
  });

  it("endpoint を正規化し、対応しないスキームや資格情報付き URL や不正なオプションを拒否する", () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test/base",
      getAccessToken: () => "secret-token",
    });
    expect(client.endpoint).toBe("https://example.test/base/");

    let invalidScheme: unknown;
    try {
      createFlareLobbyClient({
        endpoint: "ftp://example.test",
        getAccessToken: () => "secret-token",
      });
    } catch (error) {
      invalidScheme = error;
    }
    expect(invalidScheme).toMatchObject({ code: "INVALID_PAYLOAD" });

    let credentials: unknown;
    try {
      createFlareLobbyClient({
        endpoint: "https://user:pass@example.test",
        getAccessToken: () => "secret-token",
      });
    } catch (error) {
      credentials = error;
    }
    expect(credentials).toMatchObject({ code: "INVALID_PAYLOAD" });

    let missingTokenProvider: unknown;
    try {
      createFlareLobbyClient(
        {} as Parameters<typeof createFlareLobbyClient>[0],
      );
    } catch (error) {
      missingTokenProvider = error;
    }
    expect(missingTokenProvider).toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("JSON 化できない本文と空の requestId を送信前に INVALID_PAYLOAD にする", async () => {
    const fetchImplementation: FetchImplementation = vi.fn();
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
    });

    await expect(
      client.request("/v1/rooms", {
        method: "POST",
        body: BigInt(1) as never,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.request("/v1/rooms", {
        method: "POST",
        body: (() => undefined) as never,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.request("/v1/rooms", { requestId: "" }),
    ).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
      message: "requestId は空でない文字列で指定してください。",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("requestId ファクトリの失敗は CONNECTION_FAILED、空 token は UNAUTHENTICATED にする", async () => {
    const badFactoryClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(),
      requestIdFactory: () => 42 as unknown as string,
    });
    await expect(
      badFactoryClient.request("/v1/rooms", { idempotent: true }),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });

    const emptyTokenClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "",
      fetch: vi.fn(),
    });
    await expect(emptyTokenClient.request("/v1/rooms")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("fetch 実装が得られない環境では CONNECTION_FAILED になる", async () => {
    vi.stubGlobal("fetch", undefined);
    try {
      const client = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "secret-token",
      });
      await expect(client.request("/v1/rooms")).rejects.toMatchObject({
        code: "CONNECTION_FAILED",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fetch の中断と応答値以外の戻りをエラーコードへ正規化する", async () => {
    const abortClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
      requestIdFactory: () => "request-abort",
    });
    await expect(
      abortClient.request("/v1/rooms", { idempotent: true }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
      requestId: "request-abort",
    });

    const invalidResponseClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(async () => ({}) as Response),
    });
    await expect(
      invalidResponseClient.request("/v1/rooms"),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("空本文・text 読み取り失敗・状態コードのみの応答を正規化する", async () => {
    const emptyBodyClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(async () => new Response("", { status: 200 })),
    });
    await expect(emptyBodyClient.request("/v1/rooms")).resolves.toBeNull();

    const brokenTextClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            text: () => Promise.reject(new Error("stream broken")),
          }) as unknown as Response,
      ),
    });
    await expect(brokenTextClient.request("/v1/rooms")).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });

    const statusCases = [
      [400, "INVALID_PAYLOAD"],
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [409, "CONFLICT"],
      [422, "INVALID_PAYLOAD"],
      [500, "CONNECTION_FAILED"],
    ] as const;
    for (const [status, code] of statusCases) {
      const client = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "secret-token",
        fetch: vi.fn(async () => new Response("{}", { status })),
      });
      await expect(client.request("/v1/rooms")).rejects.toMatchObject({
        code,
      });
    }

    const nullBodyClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: vi.fn(async () => new Response("null", { status: 400 })),
    });
    await expect(nullBodyClient.request("/v1/rooms")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("webSocketFactory で既知 protocol と lastRevision を含む URL を構築できる", async () => {
    const created: Array<{ url: string; protocols: readonly string[] }> = [];
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocketFactory: (url, protocols) => {
        created.push({ url, protocols: [...protocols] });
        return new FakeWebSocket(url, [...protocols]) as unknown as WebSocket;
      },
      requestIdFactory: () => "factory-request-1",
    });

    const connection = await client.connectWebSocket("/v1/rooms/room-1/ws", {
      protocols: ["proto-a", "flarelobby.v1"],
      lastRevision: 7,
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.url).toBe(
      "wss://example.test/v1/rooms/room-1/ws?lastRevision=7",
    );
    expect(created[0]?.protocols).toEqual([
      "flarelobby.v1",
      "proto-a",
      "flarelobby.auth.c2VjcmV0LXRva2Vu",
    ]);
    expect(connection.closed).toBe(false);
  });

  it("lastRevision と protocols の不正値はソケット生成前に拒否する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });

    await expect(
      client.connect("/v1/rooms/room-1/ws", { lastRevision: -1 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.connect("/v1/rooms/room-1/ws", { lastRevision: 1.5 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.connect("/v1/rooms/room-1/ws", { protocols: [""] }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(
      client.connect("/v1/rooms/room-1/ws", { protocols: "" }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("WebSocket が利用できない環境やソケット生成の失敗は CONNECTION_FAILED になる", async () => {
    vi.stubGlobal("WebSocket", undefined);
    try {
      const unavailableClient = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "secret-token",
      });
      await expect(
        unavailableClient.connect("/v1/rooms/room-1/ws"),
      ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    } finally {
      vi.unstubAllGlobals();
    }

    const failingFactoryClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocketFactory: () => {
        throw new Error("constructor failed");
      },
    });
    await expect(
      failingFactoryClient.connect("/v1/rooms/room-1/ws"),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("既に開いているソケットへも接続でき、signal 付きでも open で解決する", async () => {
    const listeners = new Map<string, Set<EventListener>>();
    const preOpened = {
      readyState: 1,
      addEventListener(type: string, listener: EventListener): void {
        const set = listeners.get(type) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener): void {
        listeners.get(type)?.delete(listener);
      },
      send(): void {},
      close(): void {},
    };
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocketFactory: () => preOpened as unknown as WebSocket,
    });

    const controller = new AbortController();
    const connection = await client.connect("/v1/rooms/room-1/ws", {
      signal: controller.signal,
    });
    expect(connection.closed).toBe(false);
  });

  it("waitForOpen に中止済み signal を渡すと CANCELLED で閉じる", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");

    const controller = new AbortController();
    controller.abort();
    await expect(
      (
        connection as unknown as {
          waitForOpen(signal?: AbortSignal): Promise<void>;
        }
      ).waitForOpen(controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(connection.closed).toBe(true);
  });

  it("サーバー側 close コードをエラー種別へ写像して通知する", async () => {
    const cases = [
      [4001, "UNAUTHENTICATED"],
      [4401, "UNAUTHENTICATED"],
      [1008, "FORBIDDEN"],
      [4003, "FORBIDDEN"],
      [4403, "FORBIDDEN"],
      [4009, "CONFLICT"],
      [4409, "CONFLICT"],
      [4410, "ROOM_FINISHED"],
      [1000, "CONNECTION_FAILED"],
    ] as const;
    for (const [code, expected] of cases) {
      const client = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "secret-token",
        webSocket: fakeWebSocketConstructor,
      });
      const connection = await client.connect("/v1/rooms/room-1/ws");
      const socket = FakeWebSocket.instances.at(-1);
      const closeErrors: Array<{ code: string }> = [];
      connection.onClose((error) => closeErrors.push(error));

      socket?.close(code);

      expect(closeErrors, `close code ${code}`).toHaveLength(1);
      expect(closeErrors[0]?.code, `close code ${code}`).toBe(expected);
      expect(connection.closed, `close code ${code}`).toBe(true);
    }
  });

  it("クライアント起因の close は CANCELLED として一度だけ通知する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const closeErrors: Array<{ code: string }> = [];
    const unsubscribe = connection.onClose((error) => closeErrors.push(error));
    unsubscribe();
    connection.onClose((error) => closeErrors.push(error));

    connection.close();
    connection.close();

    expect(closeErrors).toHaveLength(1);
    expect(closeErrors[0]?.code).toBe("CANCELLED");
    expect(connection.closed).toBe(true);
  });

  it("socket の error イベントで CONNECTION_FAILED として切断する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const controller = new AbortController();
    const connection = await client.connect("/v1/rooms/room-1/ws", {
      signal: controller.signal,
    });
    const socket = FakeWebSocket.instances[0];
    const closeErrors: Array<{ code: string }> = [];
    connection.onClose((error) => closeErrors.push(error));

    socket?.emit("error", new Event("error"));

    expect(closeErrors).toHaveLength(1);
    expect(closeErrors[0]?.code).toBe("CONNECTION_FAILED");
    expect(connection.closed).toBe(true);
  });

  it("文字列でないメッセージと解析不能なメッセージで切断する", async () => {
    const firstClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const firstConnection = await firstClient.connect("/v1/rooms/room-1/ws");
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket?.emit(
      "message",
      new MessageEvent("message", { data: { broken: true } }),
    );
    expect(firstConnection.closed).toBe(true);

    const secondClient = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const secondConnection = await secondClient.connect("/v1/rooms/room-1/ws");
    const secondSocket = FakeWebSocket.instances[1];
    secondSocket?.receive("{not-json");
    expect(secondConnection.closed).toBe(true);
  });

  it("requestId のない失敗応答で接続を切断する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];
    const closeErrors: Array<{ code: string }> = [];
    connection.onClose((error) => closeErrors.push(error));

    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "failure",
        requestId: null,
        error: { code: "INVALID_MESSAGE", message: "不正な要求です。" },
      }),
    );

    expect(connection.closed).toBe(true);
    expect(closeErrors).toHaveLength(1);
    expect(closeErrors[0]?.code).toBe("INVALID_MESSAGE");
  });

  it("send は引数と接続状態を検証してから送信する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];

    await expect(connection.send("", { ready: true })).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(
      connection.send("room.set_ready", { ready: true }, { requestId: "" }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      connection.send(
        "room.set_ready",
        { ready: true },
        {
          signal: aborted.signal,
        },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(socket?.sent).toHaveLength(0);
  });

  it("送信待ちコマンドは signal 中止で CANCELLED になり解決後の中止は影響しない", async () => {
    let sequence = 0;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: () => `req-${++sequence}`,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];

    const controller = new AbortController();
    const pending = connection.send(
      "room.set_ready",
      { ready: true },
      { signal: controller.signal },
    );
    expect(socket?.sent).toHaveLength(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
      requestId: "req-1",
    });

    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "req-1",
        payload: { revision: 1 },
      }),
    );

    const resolvedController = new AbortController();
    const resolved = connection.send("room.ping", {});
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "req-2",
        payload: { ok: true },
      }),
    );
    await expect(resolved).resolves.toEqual({ ok: true });
    resolvedController.abort();
    expect(socket?.sent).toHaveLength(2);
  });

  it("ソケット送信の失敗は requestId 付き CONNECTION_FAILED になる", async () => {
    const listeners = new Map<string, Set<EventListener>>();
    const throwingSocket = {
      readyState: 1,
      addEventListener(type: string, listener: EventListener): void {
        const set = listeners.get(type) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener): void {
        listeners.get(type)?.delete(listener);
      },
      send(): void {
        throw new Error("send failed");
      },
      close(): void {},
    };
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocketFactory: () => throwingSocket as unknown as WebSocket,
      requestIdFactory: () => "req-send-fail",
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");

    await expect(
      connection.send("room.set_ready", { ready: true }),
    ).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      requestId: "req-send-fail",
    });
  });

  it("切断後の send・onEvent・onClose は切断時のエラーを反映する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];
    socket?.close(4401);

    await expect(
      connection.send("room.set_ready", { ready: true }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    let onEventError: unknown;
    try {
      connection.onEvent(vi.fn());
    } catch (error) {
      onEventError = error;
    }
    expect((onEventError as { readonly code?: string } | undefined)?.code).toBe(
      "UNAUTHENTICATED",
    );
    const lateErrors: Array<{ code: string }> = [];
    const removeLateListener = connection.onClose((error) =>
      lateErrors.push(error),
    );
    expect(lateErrors).toHaveLength(1);
    expect(lateErrors[0]?.code).toBe("UNAUTHENTICATED");
    // 切断後の解除用関数は安全な no-op です。
    expect(() => removeLateListener()).not.toThrow();
  });

  it("リスナー登録前のイベントを上限付きで保持し登録時にまとめて配信する", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];

    for (let revision = 1; revision <= 102; revision += 1) {
      socket?.receive(
        JSON.stringify({
          protocolVersion: 1,
          kind: "event",
          event: "room.snapshot",
          revision,
          payload: { revision },
        }),
      );
    }

    const listener = vi.fn();
    const unsubscribe = connection.onEvent(listener);
    expect(listener).toHaveBeenCalledTimes(100);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ revision: 3 });
    expect(listener.mock.calls[99]?.[0]).toMatchObject({ revision: 102 });

    unsubscribe();
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "event",
        event: "room.snapshot",
        revision: 103,
        payload: { revision: 103 },
      }),
    );
    expect(listener).toHaveBeenCalledTimes(100);
  });

  it("createParty はイベント接続を開き生 JSON イベントを購読者へ配信する", async () => {
    const fetchImplementation: FetchImplementation = vi.fn(async () =>
      Response.json(partyEnvelopeValue("party-1", 1)),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
      webSocket: fakeWebSocketConstructor,
    });

    const party = await client.createParty({ maxPartySize: 4 });
    expect(party.id).toBe("party-1");
    expect(party.revision).toBe(1);
    expect(party.connectionStatus).toBe("connected");
    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://example.test/v1/parties/party-1/events/ws",
    );

    const updates: Array<{ sequence: number }> = [];
    party.on("update", (event) => updates.push(event));
    FakeWebSocket.instances[0]?.receive(
      JSON.stringify(partyEventValue("party-1", 2)),
    );
    expect(updates).toHaveLength(1);
    expect(party.revision).toBe(2);
    client.dispose();
  });

  it("getParty と joinParty もスナップショットからイベント接続を開く", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImplementation: FetchImplementation = vi.fn(
      async (input, init) => {
        requests.push({
          url: input.toString(),
          method: init?.method ?? "GET",
        });
        return Response.json(partyEnvelopeValue("party-1", 3));
      },
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
      webSocket: fakeWebSocketConstructor,
    });

    const fetched = await client.getParty("party-1");
    expect(fetched.revision).toBe(3);
    expect(fetched.connectionStatus).toBe("connected");

    const joined = await client.joinParty({
      partyId: "party-1",
      token: "invite-token",
    });
    expect(joined.id).toBe("party-1");
    expect(joined.connectionStatus).toBe("connected");

    expect(requests.map((request) => `${request.method} ${request.url}`)) //
      .toEqual([
        "GET https://example.test/v1/parties/party-1",
        "POST https://example.test/v1/parties/party-1/members",
      ]);
    client.dispose();
  });

  it("レーティング取得とルーム一覧を各 API へ委譲する", async () => {
    const urls: string[] = [];
    const fetchImplementation: FetchImplementation = vi.fn(async (input) => {
      const url = input.toString();
      urls.push(url);
      if (url.endsWith("/rating")) {
        return Response.json({
          rating: { playerId: "player-1", poolId: "ranked-1", value: 1200 },
        });
      }
      return Response.json({ rooms: [], nextCursor: null });
    });
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
    });

    await expect(client.getRating("ranked-1")).resolves.toEqual({
      playerId: "player-1",
      poolId: "ranked-1",
      value: 1200,
    });
    await expect(
      client.listCustomRooms({ gameId: "game-1", limit: 10 }),
    ).resolves.toEqual({ rooms: [], nextCursor: null });
    expect(urls[0]).toContain("/rating");
    expect(urls[1]).toContain("gameId=game-1");
    expect(urls[1]).toContain("limit=10");
  });

  it("dispose は二回呼んでも一度だけ切断し destroy は別名として動く", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];

    client.dispose();
    client.dispose();
    client.destroy();
    expect(client.disposed).toBe(true);
    expect(connection.closed).toBe(true);
    expect(socket?.readyState).toBe(3);
  });

  it("http エンドポイントは ws へ変換され、ポート付き URL も受理する", async () => {
    const httpEndpointClient = createFlareLobbyClient({
      endpoint: "http://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    await httpEndpointClient.connect("/v1/rooms/room-1/ws");
    expect(FakeWebSocket.instances.at(-1)?.url).toBe(
      "ws://example.test/v1/rooms/room-1/ws",
    );

    const portedClient = createFlareLobbyClient({
      endpoint: "https://example.test:8443",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    await portedClient.connect("/v1/rooms/room-1/ws");
    expect(FakeWebSocket.instances.at(-1)?.url).toBe(
      "wss://example.test:8443/v1/rooms/room-1/ws",
    );
  });

  it("解決できないパスは HTTP でも WebSocket でも INVALID_PAYLOAD にする", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });

    await expect(client.request("http://[")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    await expect(client.connect("http://[")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("token 変換の失敗は CONNECTION_FAILED になる", async () => {
    vi.stubGlobal("btoa", () => {
      throw new Error("btoa unavailable");
    });
    try {
      const client = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "secret-token",
        webSocket: fakeWebSocketConstructor,
      });
      await expect(client.connect("/v1/rooms/room-1/ws")).rejects.toMatchObject(
        { code: "CONNECTION_FAILED" },
      );
      expect(FakeWebSocket.instances).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("crypto.randomUUID が無い環境では連番の requestId を生成する", async () => {
    vi.stubGlobal("crypto", {});
    try {
      const fetchImplementation: FetchImplementation = vi.fn(async () =>
        Response.json({ ok: true }),
      );
      const client = createFlareLobbyClient({
        endpoint: "https://example.test",
        getAccessToken: () => "secret-token",
        fetch: fetchImplementation,
      });

      await client.request("/v1/rooms", { idempotent: true });
      const init = vi.mocked(fetchImplementation).mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
        /^request-[0-9a-z]+-[0-9a-z]+$/u,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("招待コードでのルーム参加は joinToken をプロトコルへ載せて接続する", async () => {
    const roomResult = {
      roomId: "room-1",
      participantId: "participant-1",
      role: "player",
      invitationCode: "code-1",
      joinMethod: "invitation",
      joinToken: "join-token",
      websocketUrl: "/v1/rooms/room-1/ws",
      snapshot: {
        revision: 0,
        participants: [],
        teams: [],
        state: { status: "open" },
        room: { id: "room-1", kind: "custom" },
      },
    };
    const fetchImplementation: FetchImplementation = vi.fn(async () =>
      Response.json(roomResult),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
      webSocket: fakeWebSocketConstructor,
    });

    const room = (await client.joinCustomRoom("code-1")) as {
      readonly roomId?: string;
    };
    expect(room.roomId ?? "room-1").toBe("room-1");
    expect(vi.mocked(fetchImplementation).mock.calls[0]?.[0].toString()).toBe(
      "https://example.test/v1/custom-rooms/join",
    );
    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://example.test/v1/rooms/room-1/ws",
    );
    // アクセストークンではなくサーバー発行の joinToken を使います。
    expect(FakeWebSocket.instances[0]?.protocols).toContain(
      "flarelobby.auth.am9pbi10b2tlbg",
    );
    client.dispose();
  });

  it("パーティーイベント接続の確立失敗は CONNECTION_FAILED になる", async () => {
    FakeWebSocket.autoOpen = false;
    const fetchImplementation: FetchImplementation = vi.fn(async () =>
      Response.json(partyEnvelopeValue("party-1", 1)),
    );
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      fetch: fetchImplementation,
      webSocket: fakeWebSocketConstructor,
    });

    vi.useFakeTimers();
    try {
      const partyPromise = client.getParty("party-1");
      // WebSocket 生成まで処理を進めてから error イベントを発生させます。
      await vi.advanceTimersByTimeAsync(0);
      const socket = FakeWebSocket.instances.at(-1);
      socket?.emit("error", new Event("error"));

      await expect(partyPromise).rejects.toMatchObject({
        code: "CONNECTION_FAILED",
      });
      expect(socket?.readyState).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一 requestId の重複応答は最初の結果を優先する", async () => {
    let sequence = 0;
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
      requestIdFactory: () => `req-${++sequence}`,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const socket = FakeWebSocket.instances[0];

    const failing = connection.send("room.a", {}, { requestId: "dup-1" });
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "failure",
        requestId: "dup-1",
        error: { code: "FORBIDDEN", message: "権限がありません。" },
      }),
    );
    await expect(failing).rejects.toMatchObject({ code: "FORBIDDEN" });
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "dup-1",
        payload: { late: true },
      }),
    );

    const succeeding = connection.send("room.b", {}, { requestId: "dup-2" });
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "success",
        requestId: "dup-2",
        payload: { ok: true },
      }),
    );
    await expect(succeeding).resolves.toEqual({ ok: true });
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        kind: "failure",
        requestId: "dup-2",
        error: { code: "CONFLICT", message: "競合しました。" },
      }),
    );
  });

  it("エンコードできない payload は INVALID_PAYLOAD になる", async () => {
    const client = createFlareLobbyClient({
      endpoint: "https://example.test",
      getAccessToken: () => "secret-token",
      webSocket: fakeWebSocketConstructor,
    });
    const connection = await client.connect("/v1/rooms/room-1/ws");
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    await expect(
      connection.send("room.set_ready", circular as never),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(FakeWebSocket.instances[0]?.sent).toHaveLength(0);
  });
});
