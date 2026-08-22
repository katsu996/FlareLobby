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

  private emit(type: string, event: Event): void {
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
});
