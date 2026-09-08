import { createFlareLobbyClient } from "@flarelobby/client";
import type {
  FlareLobbyClient,
  HostRoom,
  MatchmakingTicket,
  Room,
} from "@flarelobby/client";
import type { FlareLobbyApp } from "@flarelobby/core";

type StandaloneApp = FlareLobbyApp<
  { map: string },
  { name: string },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {}
>;

type StandaloneClient = FlareLobbyClient<StandaloneApp>;

const SOLO_POOL = {
  id: "solo-1v1",
  gameId: "standalone",
  seasonId: "season-1",
  mode: "duel-1v1",
  region: "jp",
};

const endpoint =
  import.meta.env["VITE_FLARE_LOBBY_ENDPOINT"]?.toString()?.trim() ||
  "http://localhost:8787";

/**
 * ログイン済みトークンの取得関数を差し込む箇所です。
 * 現在は画面の入力値をそのまま返します。実際のアプリでは
 * ログインセッションから発行済みトークンを返してください。
 */
function getAccessToken(): string {
  return tokenInput().value.trim();
}

let client: StandaloneClient | undefined;
let activeRoom: Room<StandaloneApp> | undefined;
let activeTicket: MatchmakingTicket<StandaloneApp> | undefined;
let pendingOperation: Promise<void> = Promise.resolve();

/**
 * 非同期 UI 操作を直列化し、連打による競合を防ぐ共有ロックです。
 * 伝播した失敗はここでまとめて通知します。
 */
function runExclusive(operation: () => Promise<void>): void {
  pendingOperation = pendingOperation.then(operation, operation).then(
    () => undefined,
    (error: unknown) => {
      log(`操作に失敗しました: ${toMessage(error)}`);
    },
  );
}

function tokenInput(): HTMLInputElement {
  return element<HTMLInputElement>("token");
}

function element<T extends Element>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`要素がありません: ${id}`);
  }
  return value as unknown as T;
}

function log(message: string): void {
  const output = element<HTMLElement>("log");
  const line = document.createElement("p");
  line.textContent = message;
  output.prepend(line);
}

function getClient(): StandaloneClient {
  if (client === undefined) {
    client = createFlareLobbyClient<StandaloneApp>({
      endpoint,
      getAccessToken,
    });
    log(`接続先: ${endpoint}`);
  }
  return client;
}

async function createRoom(): Promise<void> {
  try {
    await leaveRoom(false);
    const room = await getClient().createCustomRoom({
      requestId: crypto.randomUUID(),
      name: "standalone room",
      visibility: "unlisted",
      joinMethod: "invitation",
      maxPlayers: 2,
      settings: { map: "forest" },
    });
    activeRoom = room;
    log(`ルーム作成: ${room.snapshot.room.id}`);
  } catch (error) {
    log(`ルーム作成に失敗: ${toMessage(error)}`);
  }
}

async function joinRoom(): Promise<void> {
  try {
    await leaveRoom(false);
    const code = element<HTMLInputElement>("invitation-code")
      .value.trim()
      .toUpperCase();
    const room = await getClient().joinCustomRoom({
      requestId: crypto.randomUUID(),
      invitationCode: code,
      role: "player",
    });
    activeRoom = room;
    log(`ルーム参加: ${room.snapshot.room.id}`);
  } catch (error) {
    log(`ルーム参加に失敗: ${toMessage(error)}`);
  }
}

async function leaveRoom(notify = true): Promise<void> {
  const room = activeRoom;
  if (room === undefined) {
    return;
  }
  if (room.closed) {
    activeRoom = undefined;
    return;
  }
  await room.leave({ requestId: crypto.randomUUID() });
  activeRoom = undefined;
  if (notify) {
    log("ルームを退出しました。");
  }
}

async function closeRoom(): Promise<void> {
  const room = activeRoom;
  if (room === undefined || room.role !== "host") {
    log("ホストのルームがありません。");
    return;
  }
  try {
    await (room as HostRoom<StandaloneApp>).close({
      requestId: crypto.randomUUID(),
    });
    activeRoom = undefined;
    log("ルームを終了しました。");
  } catch (error) {
    log(`ルーム終了に失敗: ${toMessage(error)}`);
  }
}

async function joinQueue(): Promise<void> {
  try {
    await cancelQueue(false);
    await leaveRoom(false);
  } catch (error) {
    log(`キュー参加に失敗: ${toMessage(error)}`);
    return;
  }
  try {
    const ticket = await getClient().joinMatchmaking(SOLO_POOL, {
      requestId: crypto.randomUUID(),
      ttlMs: 60_000,
    });
    activeTicket = ticket;
    log(`1v1キューに参加: ${ticket.id}`);
    const room = await ticket.waitForMatch();
    activeTicket = undefined;
    activeRoom = room;
    log(`対戦成立: ${room.snapshot.room.id}`);
  } catch (error) {
    activeTicket = undefined;
    log(`キュー参加に失敗: ${toMessage(error)}`);
  }
}

async function cancelQueue(notify = true): Promise<void> {
  const ticket = activeTicket;
  if (ticket === undefined) {
    return;
  }
  await ticket.cancel({ requestId: crypto.randomUUID() });
  activeTicket = undefined;
  if (notify) {
    log("キューを取り消しました。");
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "不明なエラー";
}

element<HTMLButtonElement>("create-room").addEventListener("click", () => {
  runExclusive(createRoom);
});
element<HTMLButtonElement>("join-room").addEventListener("click", () => {
  runExclusive(joinRoom);
});
element<HTMLButtonElement>("leave-room").addEventListener("click", () => {
  runExclusive(() => leaveRoom());
});
element<HTMLButtonElement>("close-room").addEventListener("click", () => {
  runExclusive(closeRoom);
});
element<HTMLButtonElement>("join-queue").addEventListener("click", () => {
  runExclusive(joinQueue);
});
element<HTMLButtonElement>("cancel-queue").addEventListener("click", () => {
  runExclusive(() => cancelQueue());
});
