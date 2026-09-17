import { createFlareLobbyClient } from "@flarelobby/client";
import { FlareLobbyError, type FlareLobbyApp } from "@flarelobby/core";

type ExampleApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string },
  { chat: { text: string } }
>;

declare const auth: { getAccessToken(): string | Promise<string> };

const lobby = createFlareLobbyClient<ExampleApp>({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
  requestTimeoutMs: 10_000,
  connectionTimeoutMs: 10_000,
  commandTimeoutMs: 10_000,
});

const host = await lobby.createCustomRoom({
  name: "型検査対象のルーム",
  visibility: "unlisted",
  joinMethod: "invitation",
  settings: { map: "forest" },
});

const stop = host.onMessage("chat", (message) => {
  const text: string = message.payload.text;
  console.log(text);
});

await host.setReady(true);
await host.send("chat", { text: "準備完了" });
await lobby.request("/v1/example", { timeoutMs: 5_000 });

declare const renderWait: (seconds: number | undefined) => void;

try {
  await lobby.request("/v1/example", { method: "POST" });
} catch (error) {
  if (error instanceof FlareLobbyError && error.httpStatus !== undefined) {
    const waitSeconds: number | undefined = error.retryAfterSeconds;
    renderWait(waitSeconds);
  } else {
    throw error;
  }
}

// エラー表示レシピの型検査例。`code` で分岐し、`message` の文言では分岐しない。
// `httpStatus` は補助表示用、`retryAfterSeconds` は有効なときだけ表示する。
export function describeLobbyError(error: unknown): string {
  if (!(error instanceof FlareLobbyError)) {
    throw error;
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "ログインし直してください。";
    case "FORBIDDEN":
      return "この操作の権限がありません。";
    case "ROOM_FULL":
      return "ルームは満員です。空きができてから再参加してください。";
    case "ROOM_FINISHED":
      return "ルームは終了しています。新しいルームを使ってください。";
    case "CONFLICT": {
      const waitSeconds: number | undefined = error.retryAfterSeconds;
      return waitSeconds === undefined
        ? "状態が変わりました。最新の状態を取り直してください。"
        : `混み合っています。約${waitSeconds}秒後に再試行できます。`;
    }
    case "TIMEOUT": {
      // TIMEOUT は未処理確定とみなさない。呼び出し側で同じ requestId を保持する。
      const pendingId: string | undefined = error.requestId;
      return pendingId === undefined
        ? "時間切れです。結果が不明なため確認してください。"
        : "時間切れです。結果が不明なため同じ要求で確認してください。";
    }
    case "CANCELLED":
      return "操作は取り消されました。必要なら新しい要求を作ってください。";
    case "CONNECTION_FAILED": {
      const waitSeconds: number | undefined = error.retryAfterSeconds;
      return waitSeconds === undefined
        ? "通信に失敗しました。しばらくしてから再試行してください。"
        : `通信に失敗しました。約${waitSeconds}秒後に再試行できます。`;
    }
    default:
      return `${error.code}: ${error.message}`;
  }
}

// pending 中の重複操作抑止の型検査例。SDK に自動抑止はないため利用者側で抑止する。
let creatingRoom = false;

export async function createRoomOnce(): Promise<void> {
  if (creatingRoom) {
    return;
  }
  creatingRoom = true;
  try {
    await lobby.createCustomRoom({ name: "重複抑止の例" });
  } finally {
    creatingRoom = false;
  }
}

// TIMEOUT 時の再送禁止の型検査例。新しい requestId で再送せず同じ requestId で確認する。
export async function requestWithTimeoutConfirmation(): Promise<void> {
  const requestId = crypto.randomUUID();
  try {
    await lobby.request("/v1/example", {
      method: "POST",
      body: { value: 1 },
      requestId,
      timeoutMs: 5_000,
    });
  } catch (error) {
    if (error instanceof FlareLobbyError && error.code === "TIMEOUT") {
      await lobby.request("/v1/example", {
        method: "POST",
        body: { value: 1 },
        requestId,
      });
      return;
    }
    throw error;
  }
}

// 終了契約の型検査例。`dispose()` はサーバー上の Ticket を取り消さないため、
// 先に `ticket.cancel()` を呼ぶ。渡された対戦 Room も変更しない。
export async function disposeAfterCancel(): Promise<void> {
  const ticket = await lobby.joinMatchmaking("ranked-1v1");
  try {
    await ticket.cancel();
  } finally {
    lobby.dispose();
  }
}
const timedConnection = await lobby.connect("/v1/rooms/room-1/ws", {
  timeoutMs: 5_000,
});
await timedConnection.send(
  "room.set_ready",
  { ready: true },
  { timeoutMs: 5_000 },
);
timedConnection.close();
const spectator = await lobby.joinCustomRoom({
  roomId: host.id,
  role: "spectator",
});
await spectator.leave();
stop();
await host.leave();
