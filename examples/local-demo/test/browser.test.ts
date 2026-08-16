import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@flarelobby/client", () => ({
  createFlareLobbyClient: mocks.createClient,
}));

class FakeClassList {
  private readonly values = new Set<string>();
  add(...tokens: string[]): void {
    tokens.forEach((token) => this.values.add(token));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((token) => this.values.delete(token));
  }
  toggle(token: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(token);
    if (enabled) this.values.add(token);
    else this.values.delete(token);
    return enabled;
  }
  contains(token: string): boolean {
    return this.values.has(token);
  }
}

class FakeElement {
  value = "";
  textContent = "";
  className = "";
  disabled = false;
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string | undefined> = {};
  children: FakeElement[] = [];
  private readonly listeners = new Map<
    string,
    Array<(event: { preventDefault(): void }) => unknown>
  >();
  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => unknown,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  async fire(type: string): Promise<void> {
    for (const listener of this.listeners.get(type) ?? [])
      await listener({ preventDefault() {} });
    await Promise.resolve();
    await Promise.resolve();
  }
}

const elements = new Map<string, FakeElement>();
let customMoveButtons = ["rock", "paper", "scissors"].map((move) =>
  Object.assign(new FakeElement(), { dataset: { customMove: move } }),
);
let rankedMoveButtons = ["rock", "paper", "scissors"].map((move) =>
  Object.assign(new FakeElement(), { dataset: { rankedMove: move } }),
);
let customRoom: ReturnType<typeof createRoom>;
let rankedRoom: ReturnType<typeof createRoom>;
type MockFunction = ReturnType<typeof vi.fn>;
type ClientMock = Record<string, MockFunction> & {
  createCustomRoom: MockFunction;
  dispose: MockFunction;
  getRating: MockFunction;
  joinCustomRoom: MockFunction;
  joinMatchmaking: MockFunction;
  request: MockFunction;
};
type TicketMock = Record<string, MockFunction> & {
  cancel: MockFunction;
  waitForMatch: MockFunction;
};
let client: ClientMock;
let ticket: TicketMock;

function element(id: string): FakeElement {
  const current = elements.get(id);
  if (current !== undefined) return current;
  const created = new FakeElement();
  elements.set(id, created);
  return created;
}

function roomSnapshot(kind: "custom" | "match", status = "waiting") {
  return {
    room:
      kind === "custom"
        ? { kind, id: "room-1", invitationCode: "invite-1" }
        : { kind, id: "room-2", matchId: "match-1" },
    state: { status },
    revision: 1,
    participants: [
      {
        id: "demo:alice",
        kind: "player",
        ready: false,
        player: { id: "demo:alice" },
      },
      {
        id: "demo:bob",
        kind: "player",
        ready: true,
        player: { id: "demo:bob" },
      },
    ],
  };
}

function createRoom(kind: "custom" | "match") {
  const snapshot = roomSnapshot(kind, kind === "match" ? "active" : "waiting");
  let moveListener:
    | ((message: {
        payload: { move: string };
        sender?: { participantId: string };
      }) => void)
    | undefined;
  return {
    snapshot,
    participantId: "demo:alice",
    role: kind === "custom" ? "host" : "player",
    closed: false,
    subscribe: vi.fn(() => () => {}),
    onStatusChange: vi.fn((listener: (status: string) => void) => {
      listener("connected");
      return () => {};
    }),
    onMessage: vi.fn((_event: string, listener: typeof moveListener) => {
      moveListener = listener;
      return () => {};
    }),
    setReady: vi.fn(async () => {
      snapshot.participants[0]!.ready = true;
    }),
    startMatch: vi.fn(async () => {
      snapshot.state.status = "active";
    }),
    send: vi.fn(async () => {
      moveListener?.({
        payload: { move: "rock" },
        sender: { participantId: "demo:bob" },
      });
    }),
    leave: vi.fn(async () => {}),
  };
}
function installDom(): void {
  elements.clear();
  customMoveButtons = ["rock", "paper", "scissors"].map((move) =>
    Object.assign(new FakeElement(), { dataset: { customMove: move } }),
  );
  rankedMoveButtons = ["rock", "paper", "scissors"].map((move) =>
    Object.assign(new FakeElement(), { dataset: { rankedMove: move } }),
  );
  const values = new Map<string, string>();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals["document"] = {
    getElementById: (id: string) => element(id),
    createElement: () => new FakeElement(),
    querySelectorAll: (selector: string) =>
      selector === "[data-custom-move]" ? customMoveButtons : rankedMoveButtons,
  };
  globals["localStorage"] = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  globals["window"] = {
    location: { origin: "https://demo.test" },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  };
}

function installClient(): void {
  customRoom = createRoom("custom");
  rankedRoom = createRoom("match");
  ticket = {
    on: vi.fn((_event: string, listener: (value: unknown) => void) => {
      listener({
        ticket: { status: "searching" },
        searchWidth: 40,
        waitingTimeMs: 1000,
      });
      return () => {};
    }),
    waitForMatch: vi.fn(async () => rankedRoom),
    cancel: vi.fn(async () => {}),
  };
  client = {
    createCustomRoom: vi.fn(async () => customRoom),
    joinCustomRoom: vi.fn(async () => customRoom),
    joinMatchmaking: vi.fn(async () => ticket),
    getRating: vi.fn(async () => ({ value: 1234 })),
    request: vi.fn(async () => ({
      matchId: "match-1",
      ready: true,
      yourMove: "rock",
      opponentMove: "scissors",
      result: { value: 1, outcome: "win", resultId: "result-1", applied: true },
      rating: { value: 1250 },
    })),
    dispose: vi.fn(),
  };
  mocks.createClient.mockReturnValue(client);
}

async function boot(): Promise<void> {
  installDom();
  installClient();
  vi.resetModules();
  await import("../src/browser.ts");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ローカルデモのブラウザUI", () => {
  it("不正なプレイヤーIDを拒否し、有効なセッションを開始する", async () => {
    await boot();
    element("player-input").value = "INVALID PLAYER";
    await element("login-form").fire("submit");
    expect(element("notice").textContent).toContain("プレイヤー名");
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(element("session-player").textContent).toContain("alice");
    expect(element("login-screen").classList.contains("hidden")).toBe(true);
    expect(client.getRating).toHaveBeenCalled();
  });

  it("カスタムルームの作成、準備、開始、手の送信、退出を処理する", async () => {
    await boot();
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    await element("show-custom").fire("click");
    element("custom-name").value = "テストルーム";
    await element("custom-create-form").fire("submit");
    expect(client.createCustomRoom).toHaveBeenCalledOnce();
    expect(element("custom-room-id").textContent).toContain("room-1");
    await element("custom-ready").fire("click");
    await element("custom-start").fire("click");
    await customMoveButtons[0]!.fire("click");
    await customMoveButtons[1]!.fire("click");
    expect(customRoom.setReady).toHaveBeenCalledOnce();
    expect(customRoom.startMatch).toHaveBeenCalledOnce();
    expect(customRoom.send).toHaveBeenCalledTimes(2);
    await element("custom-leave").fire("click");
    expect(customRoom.leave).toHaveBeenCalledOnce();
  });

  it("ランクマッチの参加、結果送信、再送、取消、ログアウトを処理する", async () => {
    await boot();
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    await element("show-ranked").fire("click");
    await element("ranked-join").fire("click");
    expect(client.joinMatchmaking).toHaveBeenCalledOnce();
    expect(ticket.waitForMatch).toHaveBeenCalledOnce();
    await rankedMoveButtons[0]!.fire("click");
    await element("ranked-resend").fire("click");
    expect(client.request).toHaveBeenCalled();
    expect(element("ranked-result").textContent).toContain("勝ち");
    await element("ranked-cancel").fire("click");
    await element("logout").fire("click");
    expect(client.dispose).toHaveBeenCalledOnce();
    expect(element("session-player").textContent).toBe("未接続");
  });
});
describe("ローカルデモの失敗・取消フロー", () => {
  it("カスタムルーム参加失敗を表示する", async () => {
    await boot();
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    await element("show-custom").fire("click");
    element("custom-code-input").value = "invite-1";
    client.joinCustomRoom.mockRejectedValueOnce(
      new Error("参加に失敗しました"),
    );
    await element("custom-join-form").fire("submit");
    expect(element("notice").className).toContain("danger");
    expect(element("notice").textContent).toContain("参加に失敗しました");
  });

  it("ランクマッチのキュー取消と送信失敗を安全に処理する", async () => {
    await boot();
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    await element("show-ranked").fire("click");
    await element("ranked-join").fire("click");
    client.request.mockRejectedValueOnce({ code: "CANCELLED" });
    await rankedMoveButtons[1]!.fire("click");
    client.request.mockRejectedValueOnce(new Error("送信に失敗しました"));
    await rankedMoveButtons[2]!.fire("click");
    await element("ranked-cancel").fire("click");
    expect(ticket.cancel).not.toHaveBeenCalled();
    expect(element("ranked-join").disabled).toBe(true);
    expect(element("notice").textContent).toContain("送信に失敗しました");
  });
});
describe("ローカルデモのカスタムルーム参加", () => {
  it("招待コードで既存ルームへ参加して接続状態を表示する", async () => {
    await boot();
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    await element("show-custom").fire("click");
    element("custom-code-input").value = "invite-1";
    await element("custom-join-form").fire("submit");
    expect(client.joinCustomRoom).toHaveBeenCalledOnce();
    expect(element("custom-invitation-code").textContent).toContain("invite-1");
    expect(element("custom-connection").textContent).toContain("connected");
    expect(element("custom-move-actions").classList.contains("hidden")).toBe(
      true,
    );
  });
});

describe("ローカルデモのランク対戦退出", () => {
  it("成立済みランク対戦を退出して画面を復帰する", async () => {
    await boot();
    element("player-input").value = "alice";
    await element("login-form").fire("submit");
    await element("show-ranked").fire("click");
    await element("ranked-join").fire("click");
    await element("ranked-leave").fire("click");
    expect(rankedRoom.leave).toHaveBeenCalledOnce();
    expect(element("ranked-room-info").classList.contains("hidden")).toBe(true);
    expect(element("menu-panel").classList.contains("hidden")).toBe(true);
  });
});
