import { createClient, type Session } from "@supabase/supabase-js";
import { createFlareLobbyClient } from "@flarelobby/client";
import type {
  FlareLobbyClient,
  HostRoom,
  MatchmakingTicket,
  Room,
} from "@flarelobby/client";
import type {
  FlareLobbyApp,
  PlayerParticipant,
  RoomSnapshot,
} from "@flarelobby/core";

type SupabaseApp = FlareLobbyApp<
  { map: string },
  { name: string },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {}
>;

type SupabaseClient = FlareLobbyClient<SupabaseApp>;

const endpoint =
  import.meta.env["VITE_FLARE_LOBBY_ENDPOINT"]?.toString()?.trim() ||
  "http://localhost:8787";
const supabase = createClient(
  requiredEnv("VITE_SUPABASE_URL"),
  requiredEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  },
);

const SOLO_POOL = {
  id: "solo-1v1",
  gameId: "supabase",
  seasonId: "season-1",
  mode: "duel-1v1",
  region: "jp",
};

let session: Session | null = null;
let client: SupabaseClient | undefined;
let activeRoom: Room<SupabaseApp> | undefined;
let activeTicket: MatchmakingTicket<SupabaseApp> | undefined;
let unsubscribeRoom: (() => void) | undefined;
let unsubscribeRoomStatus: (() => void) | undefined;
let pendingOperation: Promise<void> = Promise.resolve();
let busy = false;

function requiredEnv(name: string): string {
  const value = import.meta.env[name]?.toString().trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} を .env に設定してください。`);
  }
  return value;
}

/** 要求直前の Supabase session から token を取得し、refresh 後の値を使います。 */
async function getAccessToken(): Promise<string> {
  const result = await supabase.auth.getSession();
  if (result.error !== null) {
    throw new Error(
      "認証セッションの有効期限を確認できません。再度ログインしてください。",
    );
  }

  const accessToken = result.data.session?.access_token;
  if (accessToken === undefined || accessToken.length === 0) {
    throw new Error("未認証です。先に Supabase へログインしてください。");
  }

  return accessToken;
}

function requiredElement<T extends Element>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`要素がありません: ${id}`);
  }
  return value as unknown as T;
}

function requiredInput(id: string): HTMLInputElement {
  return requiredElement<HTMLInputElement>(id);
}

function log(message: string): void {
  const output = requiredElement<HTMLElement>("log");
  const line = document.createElement("p");
  line.textContent = message;
  output.prepend(line);
}

function runExclusive(operation: () => Promise<void>): void {
  pendingOperation = pendingOperation
    .catch(() => undefined)
    .then(async () => {
      busy = true;
      renderControls();
      try {
        await operation();
      } catch (error) {
        log(toMessage(error));
      } finally {
        busy = false;
        renderControls();
      }
    });
}

function getClient(): SupabaseClient {
  if (client === undefined) {
    client = createFlareLobbyClient<SupabaseApp>({
      endpoint,
      getAccessToken,
    });
    log(`接続先: ${endpoint}`);
  }
  return client;
}

async function signIn(): Promise<void> {
  const email = requiredInput("email").value.trim();
  const password = requiredInput("password").value;
  const result = await supabase.auth.signInWithPassword({ email, password });
  if (result.error !== null) {
    throw result.error;
  }
  requiredInput("password").value = "";
  log("ログインしました。");
}

async function signOut(): Promise<void> {
  await cancelQueue(false).catch((error: unknown) => log(toMessage(error)));
  await leaveRoom(false).catch((error: unknown) => log(toMessage(error)));
  disposeClient();

  const result = await supabase.auth.signOut();
  if (result.error !== null) {
    throw result.error;
  }
  log("ログアウトしました。");
}

async function createRoom(): Promise<void> {
  await leaveRoom(false);
  const room = await getClient().createCustomRoom({
    requestId: crypto.randomUUID(),
    name: "supabase room",
    visibility: "unlisted",
    joinMethod: "invitation",
    maxPlayers: 2,
    settings: { map: "forest" },
  });
  watchRoom(room);
  log(`ルームを作成しました: ${room.snapshot.room.id}`);
}

async function joinRoom(): Promise<void> {
  await leaveRoom(false);
  const invitationCode = requiredInput("invitation-code")
    .value.trim()
    .toUpperCase();
  const room = await getClient().joinCustomRoom({
    requestId: crypto.randomUUID(),
    invitationCode,
    role: "player",
  });
  watchRoom(room);
  log(`ルームへ参加しました: ${room.snapshot.room.id}`);
}

async function leaveRoom(notify = true): Promise<void> {
  const room = activeRoom;
  if (room === undefined) {
    return;
  }

  if (!room.closed) {
    await room.leave({ requestId: crypto.randomUUID() });
  }
  clearRoom();
  if (notify) {
    log("ルームを退出しました。");
  }
}

async function closeRoom(): Promise<void> {
  const room = activeRoom;
  if (room === undefined || room.role !== "host") {
    throw new Error("ホストのルームがありません。");
  }

  await (room as HostRoom<SupabaseApp>).close({
    requestId: crypto.randomUUID(),
  });
  clearRoom();
  log("ルームを終了しました。");
}

async function toggleReady(): Promise<void> {
  const room = activeRoom;
  if (room === undefined || room.participantRole !== "player") {
    throw new Error("プレイヤーとして参加しているルームがありません。");
  }

  const participant = room.snapshot.participants.find(
    (item): item is PlayerParticipant =>
      item.id === room.participantId && item.kind === "player",
  );
  await room.setReady(!participant?.ready, {
    requestId: crypto.randomUUID(),
  });
}

async function joinQueue(): Promise<void> {
  await cancelQueue(false);
  await leaveRoom(false);
  const ticket = await getClient().joinMatchmaking(SOLO_POOL, {
    requestId: crypto.randomUUID(),
    ttlMs: 60_000,
  });
  activeTicket = ticket;
  log(`1v1キューへ参加しました: ${ticket.id}`);

  void ticket
    .waitForMatch()
    .then((room) => {
      if (activeTicket !== ticket) {
        return;
      }
      activeTicket = undefined;
      watchRoom(room);
      log(`1v1が成立しました: ${room.snapshot.room.id}`);
      renderControls();
    })
    .catch((error: unknown) => {
      if (activeTicket !== ticket) {
        return;
      }
      activeTicket = undefined;
      log(`1v1待機に失敗しました: ${toMessage(error)}`);
      renderControls();
    });
}

async function cancelQueue(notify = true): Promise<void> {
  const ticket = activeTicket;
  if (ticket === undefined) {
    return;
  }
  await ticket.cancel({ requestId: crypto.randomUUID() });
  if (activeTicket === ticket) {
    activeTicket = undefined;
  }
  if (notify) {
    log("1v1キューを取り消しました。");
  }
  renderControls();
}

function watchRoom(room: Room<SupabaseApp>): void {
  clearRoom();
  activeRoom = room;
  unsubscribeRoom = room.subscribe((snapshot) => renderRoom(snapshot));
  unsubscribeRoomStatus = room.onStatusChange((status) => {
    requiredElement<HTMLElement>("room-status").textContent =
      `接続状態: ${status}`;
  });
  renderRoom(room.snapshot);
  renderControls();
}

function clearRoom(): void {
  unsubscribeRoom?.();
  unsubscribeRoomStatus?.();
  unsubscribeRoom = undefined;
  unsubscribeRoomStatus = undefined;
  activeRoom = undefined;
  renderRoom(undefined);
  renderControls();
}

function disposeClient(): void {
  clearRoom();
  activeTicket = undefined;
  const current = client;
  client = undefined;
  current?.dispose();
}

function renderSession(nextSession: Session | null): void {
  session = nextSession;
  requiredElement<HTMLElement>("auth-status").textContent =
    session === null
      ? "未認証"
      : `ログイン中: ${session.user.email ?? "ユーザー"}`;
  renderControls();
}

function renderRoom(snapshot: RoomSnapshot<SupabaseApp> | undefined): void {
  const roomStatus = requiredElement<HTMLElement>("room-status");
  const readyState = requiredElement<HTMLElement>("ready-state");
  const participants = requiredElement<HTMLUListElement>("participants");
  const invitation = requiredElement<HTMLElement>("created-invitation");

  participants.replaceChildren();
  if (snapshot === undefined) {
    roomStatus.textContent = "ルーム未接続";
    readyState.textContent = "準備状態: -";
    invitation.textContent = "-";
    return;
  }

  const players = snapshot.participants.filter(
    (item): item is PlayerParticipant => item.kind === "player",
  );
  const readyPlayers = players.filter((item) => item.ready);
  roomStatus.textContent = `ルーム: ${snapshot.room.id} / ${snapshot.state.status}`;
  readyState.textContent = `準備状態: ${readyPlayers.length}/${players.length}`;
  for (const [index, participant] of players.entries()) {
    const item = document.createElement("li");
    item.textContent = `プレイヤー ${index + 1}: ${participant.ready ? "準備完了" : "未準備"}`;
    participants.append(item);
  }
  invitation.textContent =
    activeRoom?.role === "host" && snapshot.room.kind === "custom"
      ? snapshot.room.invitationCode
      : "ホスト画面だけに表示されます";
}

function renderControls(): void {
  const authenticated = session !== null;
  const room = activeRoom;
  const playerRoom = room?.participantRole === "player";
  requiredElement<HTMLButtonElement>("sign-in").disabled =
    busy || authenticated;
  requiredElement<HTMLButtonElement>("sign-out").disabled =
    busy || !authenticated;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "button[data-requires-auth]",
  )) {
    button.disabled = busy || !authenticated;
  }
  requiredElement<HTMLButtonElement>("toggle-ready").hidden = !playerRoom;
  requiredElement<HTMLButtonElement>("close-room").hidden =
    room?.role !== "host";
  requiredElement<HTMLButtonElement>("leave-room").disabled =
    busy || room === undefined;
  requiredElement<HTMLButtonElement>("cancel-queue").disabled =
    busy || activeTicket === undefined;
}

function toMessage(error: unknown): string {
  if (isErrorWithCode(error) && error.code === "UNAUTHENTICATED") {
    return "認証の有効期限が切れています。再度ログインしてください。";
  }
  return error instanceof Error ? error.message : "不明なエラー";
}

function isErrorWithCode(value: unknown): value is { readonly code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
  );
}

requiredElement<HTMLButtonElement>("sign-in").addEventListener("click", () => {
  runExclusive(signIn);
});
requiredElement<HTMLButtonElement>("sign-out").addEventListener("click", () => {
  runExclusive(signOut);
});
requiredElement<HTMLButtonElement>("create-room").addEventListener(
  "click",
  () => {
    runExclusive(createRoom);
  },
);
requiredElement<HTMLButtonElement>("join-room").addEventListener(
  "click",
  () => {
    runExclusive(joinRoom);
  },
);
requiredElement<HTMLButtonElement>("toggle-ready").addEventListener(
  "click",
  () => {
    runExclusive(toggleReady);
  },
);
requiredElement<HTMLButtonElement>("leave-room").addEventListener(
  "click",
  () => {
    runExclusive(() => leaveRoom());
  },
);
requiredElement<HTMLButtonElement>("close-room").addEventListener(
  "click",
  () => {
    runExclusive(closeRoom);
  },
);
requiredElement<HTMLButtonElement>("join-queue").addEventListener(
  "click",
  () => {
    runExclusive(joinQueue);
  },
);
requiredElement<HTMLButtonElement>("cancel-queue").addEventListener(
  "click",
  () => {
    runExclusive(() => cancelQueue());
  },
);

void supabase.auth.getSession().then((result) => {
  if (result.error !== null) {
    log("認証セッションを読み込めません。再度ログインしてください。");
    renderSession(null);
    return;
  }
  renderSession(result.data.session);
});

const authState = supabase.auth.onAuthStateChange((_event, nextSession) => {
  if (nextSession === null) {
    disposeClient();
  }
  renderSession(nextSession);
});

window.addEventListener("beforeunload", () => {
  authState.data.subscription.unsubscribe();
  disposeClient();
});

renderRoom(undefined);
renderSession(null);
