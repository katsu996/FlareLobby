import { createFlareLobbyClient } from "@flarelobby/client";
import type {
  FlareLobbyClient,
  HostRoom,
  MatchmakingTicket,
  PlayerRoom,
  Room
} from "@flarelobby/client";
import type {
  FlareLobbyApp,
  MatchmakingPool,
  RoomSnapshot
} from "@flarelobby/core";

type Move = "rock" | "paper" | "scissors";

type DemoApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string; playlist: string },
  {
    "rps.move": { move: Move };
    "rps.ready": { ready: boolean };
  }
>;

type DemoClient = FlareLobbyClient<DemoApp>;
type DemoPlayerRoom = PlayerRoom<DemoApp>;

interface RpsResultResponse {
  readonly matchId: string;
  readonly ready: boolean;
  readonly yourMove: Move | null;
  readonly opponentMove: Move | null;
  readonly result:
    | {
        readonly value: 0 | 0.5 | 1;
        readonly outcome: "win" | "draw" | "lose";
        readonly resultId: string;
        readonly applied: boolean | null;
      }
    | null;
  readonly rating?: { readonly value: number };
}

const RANKED_POOL = {
  id: "ranked-jp",
  gameId: "local-demo",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp"
} satisfies MatchmakingPool;

const MOVE_LABELS: Readonly<Record<Move, string>> = {
  rock: "グー",
  paper: "パー",
  scissors: "チョキ"
};

const loginScreen = element<HTMLElement>("login-screen");
const appScreen = element<HTMLElement>("app-screen");
const menuPanel = element<HTMLElement>("menu-panel");
const customPanel = element<HTMLElement>("custom-panel");
const rankedPanel = element<HTMLElement>("ranked-panel");
const customRoomInfo = element<HTMLElement>("custom-room-info");
const rankedRoomInfo = element<HTMLElement>("ranked-room-info");
const customRoomId = element<HTMLElement>("custom-room-id");
const rankedRoomId = element<HTMLElement>("ranked-room-id");
const customInvitationCode = element<HTMLElement>("custom-invitation-code");
const customState = element<HTMLElement>("custom-state");
const customParticipants = element<HTMLUListElement>("custom-participants");
const customConnection = element<HTMLElement>("custom-connection");
const rankedConnection = element<HTMLElement>("ranked-connection");
const customReady = element<HTMLButtonElement>("custom-ready");
const customStart = element<HTMLButtonElement>("custom-start");
const customMoveActions = element<HTMLElement>("custom-move-actions");
const customResult = element<HTMLElement>("custom-result");
const rankedMoveActions = element<HTMLElement>("ranked-move-actions");
const rankedResult = element<HTMLElement>("ranked-result");
const rankedResend = element<HTMLButtonElement>("ranked-resend");
const rankedStatus = element<HTMLElement>("ranked-status");
const rankedProgress = element<HTMLElement>("ranked-progress");
const rankedJoin = element<HTMLButtonElement>("ranked-join");
const rankedCancel = element<HTMLButtonElement>("ranked-cancel");
const rankedRating = element<HTMLElement>("ranked-rating");
const notice = element<HTMLElement>("notice");
const sessionPlayer = element<HTMLElement>("session-player");

let playerId = localStorage.getItem("flarelobby-demo-player") ?? "";
let client: DemoClient | undefined;
let activeRoom: Room<DemoApp> | undefined;
let activeTicket: MatchmakingTicket<DemoApp> | undefined;
let activeMode: "custom" | "ranked" | undefined;
let roomUnsubscribers: Array<() => void> = [];
let rankedPollTimer: number | undefined;
let selectedRankedMove: Move | undefined;
const customMoves = new Map<string, Move>();

const initialPlayerInput = element<HTMLInputElement>("player-input");
if (playerId !== "") {
  initialPlayerInput.value = playerId;
}

element<HTMLFormElement>("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = initialPlayerInput.value.trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(value)) {
    setNotice("プレイヤー名の形式を確認してください。", "danger");
    return;
  }

  startSession(value);
});

element<HTMLButtonElement>("show-custom").addEventListener("click", () => {
  showMode("custom");
});
element<HTMLButtonElement>("show-ranked").addEventListener("click", () => {
  showMode("ranked");
  void refreshRating();
});
element<HTMLButtonElement>("custom-back").addEventListener("click", () => showMode());
element<HTMLButtonElement>("ranked-back").addEventListener("click", () => showMode());
element<HTMLButtonElement>("logout").addEventListener("click", () => void logout());
element<HTMLButtonElement>("custom-leave").addEventListener("click", () => void leaveRoom());
element<HTMLButtonElement>("ranked-leave").addEventListener("click", () => void leaveRoom());
customReady.addEventListener("click", () => void toggleReady());
customStart.addEventListener("click", () => void startCustomMatch());
rankedJoin.addEventListener("click", () => void joinRankedQueue());
rankedCancel.addEventListener("click", () => void cancelRankedQueue());
rankedResend.addEventListener("click", () => {
  if (selectedRankedMove !== undefined) {
    void submitRankedMove(selectedRankedMove, true);
  }
});

element<HTMLFormElement>("custom-create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void createCustomRoom();
});
element<HTMLFormElement>("custom-join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void joinCustomRoom();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-custom-move]")) {
  button.addEventListener("click", () => {
    const move = button.dataset["customMove"];
    if (isMove(move)) {
      void submitCustomMove(move);
    }
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ranked-move]")) {
  button.addEventListener("click", () => {
    const move = button.dataset["rankedMove"];
    if (isMove(move)) {
      void submitRankedMove(move, false);
    }
  });
}

function startSession(value: string): void {
  client?.dispose();
  client = createFlareLobbyClient<DemoApp>({
    endpoint: window.location.origin,
    getAccessToken: () => value,
    reconnect: {
      maxAttempts: 8,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      jitterRatio: 0.2
    }
  });
  playerId = value;
  localStorage.setItem("flarelobby-demo-player", value);
  sessionPlayer.textContent = `player: ${value}`;
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  showMode();
  setNotice("接続しました。対戦モードを選んでください。", "success");
  void refreshRating();
}

function showMode(mode?: "custom" | "ranked"): void {
  menuPanel.classList.toggle("hidden", mode !== undefined);
  customPanel.classList.toggle("hidden", mode !== "custom");
  rankedPanel.classList.toggle("hidden", mode !== "ranked");
  activeMode = mode;
}

async function createCustomRoom(): Promise<void> {
  const current = getClient();
  try {
    const name = element<HTMLInputElement>("custom-name").value.trim() || "じゃんけんルーム";
    const room = await current.createCustomRoom({
      requestId: createRequestId("custom-create"),
      name,
      visibility: "unlisted",
      joinMethod: "invitation",
      maxPlayers: 2,
      settings: { map: "forest" }
    });
    await openRoom(room, "custom");
    setNotice("ルームを作成しました。招待コードをもう1つのブラウザへ共有してください。", "success");
  } catch (error) {
    showError(error);
  }
}

async function joinCustomRoom(): Promise<void> {
  const current = getClient();
  const input = element<HTMLInputElement>("custom-code-input");
  const code = input.value.trim().toUpperCase();
  try {
    const room = await current.joinCustomRoom({
      requestId: createRequestId("custom-join"),
      invitationCode: code,
      role: "player"
    });
    await openRoom(room, "custom");
    setNotice("招待ルームへ参加しました。準備ボタンを押してください。", "success");
  } catch (error) {
    showError(error);
  }
}

async function joinRankedQueue(): Promise<void> {
  const current = getClient();
  await leaveRoom(false);
  activeMode = "ranked";
  rankedJoin.disabled = true;
  rankedCancel.classList.remove("hidden");
  rankedStatus.textContent = "チケットを作成しています…";
  rankedProgress.textContent = "";
  try {
    const ticket = await current.joinMatchmaking(RANKED_POOL, {
      requestId: createRequestId("ranked-ticket"),
      inputMethod: "keyboard_mouse",
      ttlMs: 60_000
    });
    activeTicket = ticket;
    const stopProgress = ticket.on("progress", (progress) => {
      rankedStatus.textContent = `キュー状態: ${progress.ticket.status}`;
      rankedProgress.textContent = `待機 ${Math.round(progress.waitingTimeMs / 1_000)}秒 / 検索幅 ±${Math.round(progress.searchWidth)} / 待機 ${progress.waitingCount}人`;
    });
    roomUnsubscribers.push(stopProgress);
    setNotice("ランクキューに参加しました。もう1つのブラウザでも参加してください。", "success");
    const room = await ticket.waitForMatch();
    stopProgress();
    activeTicket = undefined;
    rankedCancel.classList.add("hidden");
    await openRoom(room, "ranked");
    setNotice("対戦Roomへ接続しました。手を選んでください。", "success");
  } catch (error) {
    activeTicket = undefined;
    rankedJoin.disabled = false;
    rankedCancel.classList.add("hidden");
    if (isCancelled(error)) {
      rankedStatus.textContent = "キューを取消しました。";
      return;
    }
    showError(error);
  }
}

async function cancelRankedQueue(): Promise<void> {
  const ticket = activeTicket;
  if (ticket === undefined) {
    return;
  }

  try {
    await ticket.cancel({ requestId: createRequestId("ranked-cancel") });
    activeTicket = undefined;
    rankedJoin.disabled = false;
    rankedCancel.classList.add("hidden");
    rankedStatus.textContent = "キューを取消しました。";
    rankedProgress.textContent = "";
  } catch (error) {
    showError(error);
  }
}

async function openRoom(room: Room<DemoApp>, mode: "custom" | "ranked"): Promise<void> {
  await leaveRoom(false);
  activeRoom = room;
  activeMode = mode;
  selectedRankedMove = undefined;
  customMoves.clear();
  roomUnsubscribers = [];
  roomUnsubscribers.push(room.subscribe(renderRoom));
  roomUnsubscribers.push(room.onStatusChange((status) => {
    const label = `通信状態: ${status}`;
    if (mode === "custom") {
      customConnection.textContent = label;
    } else {
      rankedConnection.textContent = label;
    }
  }));

  const playerRoom = room as DemoPlayerRoom;
  if (mode === "custom") {
    roomUnsubscribers.push(playerRoom.onMessage("rps.move", (message) => {
      const move = message.payload.move;
      const sender = message.sender?.participantId;
      if (sender !== undefined && isMove(move)) {
        customMoves.set(sender, move);
        renderCustomResult();
      }
    }));
  }

  customRoomInfo.classList.toggle("hidden", mode !== "custom");
  rankedRoomInfo.classList.toggle("hidden", mode !== "ranked");
  customMoveActions.classList.add("hidden");
  rankedResend.classList.add("hidden");
  rankedResult.textContent = "手を選ぶと、相手の入力を待ちます。";
  renderRoom(room.snapshot);

  if (mode === "ranked") {
    const matchRoom = room.snapshot.room;
    if (matchRoom.kind === "match") {
      rankedRoomId.textContent = `Match ID: ${matchRoom.matchId}`;
      startRankedPolling(matchRoom.matchId);
    }
  }
}

function renderRoom(snapshot: RoomSnapshot<DemoApp>): void {
  const room = activeRoom;
  if (room === undefined) {
    return;
  }

  const ownParticipant = snapshot.participants.find(
    (participant) => participant.id === room.participantId
  );
  const ownReady = ownParticipant?.kind === "player" && ownParticipant.ready;
  customReady.textContent = ownReady ? "準備を解除" : "準備する";
  customReady.disabled = snapshot.state.status !== "waiting";
  customStart.disabled =
    room.role !== "host" ||
    snapshot.state.status !== "waiting" ||
    snapshot.participants.filter((participant) => participant.kind === "player").length < 2 ||
    !snapshot.participants.every(
      (participant) => participant.kind !== "player" || participant.ready
    );
  customRoomId.textContent = `Room ID: ${snapshot.room.id}`;
  customInvitationCode.textContent =
    snapshot.room.kind === "custom" ? snapshot.room.invitationCode : "------";
  customState.textContent = `Room状態: ${snapshot.state.status} / revision ${snapshot.revision}`;
  customParticipants.replaceChildren(
    ...snapshot.participants.map((participant) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${displayPlayer(participant.player.id)}${participant.id === room.participantId ? "（自分）" : ""}`;
      const state = document.createElement("span");
      state.className = "small muted";
      state.textContent = participant.kind === "player"
        ? participant.ready ? "準備完了" : "待機中"
        : "観戦者";
      item.appendChild(label);
      item.appendChild(state);
      return item;
    })
  );

  if (activeMode === "custom") {
    const inProgress = snapshot.state.status === "in_progress";
    customMoveActions.classList.toggle("hidden", !inProgress);
  }
}

async function toggleReady(): Promise<void> {
  const room = activeRoom as DemoPlayerRoom | undefined;
  if (room === undefined || activeMode !== "custom") {
    return;
  }

  const ownParticipant = room.snapshot.participants.find(
    (participant) => participant.id === room.participantId
  );
  if (ownParticipant?.kind !== "player") {
    return;
  }

  try {
    await room.setReady(!ownParticipant.ready, { requestId: createRequestId("custom-ready") });
  } catch (error) {
    showError(error);
  }
}

async function startCustomMatch(): Promise<void> {
  const room = activeRoom;
  if (room === undefined || room.role !== "host") {
    return;
  }

  const host = room as HostRoom<DemoApp>;
  customStart.disabled = true;
  try {
    await host.startMatch({ requestId: createRequestId("custom-start") });
    setNotice("対戦開始。2人の手を選んでください。", "success");
  } catch (error) {
    showError(error);
    renderRoom(room.snapshot);
  }
}

async function submitCustomMove(move: Move): Promise<void> {
  const room = activeRoom as DemoPlayerRoom | undefined;
  if (room === undefined || activeMode !== "custom") {
    return;
  }

  try {
    await room.send("rps.move", { move }, { requestId: createRequestId("custom-move") });
    customMoves.set(room.participantId, move);
    renderCustomResult();
  } catch (error) {
    showError(error);
  }
}

function renderCustomResult(): void {
  const room = activeRoom;
  if (room === undefined) {
    return;
  }

  const ownMove = customMoves.get(room.participantId);
  const opponent = room.snapshot.participants.find(
    (participant) => participant.kind === "player" && participant.id !== room.participantId
  );
  const opponentMove = opponent === undefined ? undefined : customMoves.get(opponent.id);
  if (ownMove === undefined || opponentMove === undefined) {
    customResult.textContent = ownMove === undefined
      ? "手を選ぶと、相手の入力を待ちます。"
      : `${MOVE_LABELS[ownMove]}を選択しました。相手の手を待っています。`;
    return;
  }

  const result = resolveResult(ownMove, opponentMove);
  customResult.textContent = `${MOVE_LABELS[ownMove]} vs ${MOVE_LABELS[opponentMove]}：${result === "draw" ? "引き分け" : result === "win" ? "あなたの勝ち" : "あなたの負け"}`;
}

async function submitRankedMove(move: Move, resend: boolean): Promise<void> {
  const current = getClient();
  const room = activeRoom?.snapshot.room;
  if (activeMode !== "ranked" || room?.kind !== "match") {
    return;
  }

  selectedRankedMove = move;
  setRankedMoveButtonsDisabled(true);
  try {
    const response = await current.request<RpsResultResponse>(
      `/v1/demo/rps/matches/${encodeURIComponent(room.matchId)}/move`,
      {
        method: "POST",
        body: { move, requestId: createRequestId(resend ? "ranked-resend" : "ranked-move") }
      }
    );
    renderRankedResult(response);
    if (response.result !== null) {
      rankedResend.classList.remove("hidden");
      await refreshRating();
    }
  } catch (error) {
    showError(error);
  } finally {
    setRankedMoveButtonsDisabled(false);
  }
}

function startRankedPolling(matchId: string): void {
  stopRankedPolling();
  rankedPollTimer = window.setInterval(() => {
    void refreshRankedState(matchId);
  }, 750);
  void refreshRankedState(matchId);
}

function stopRankedPolling(): void {
  if (rankedPollTimer !== undefined) {
    window.clearInterval(rankedPollTimer);
    rankedPollTimer = undefined;
  }
}

async function refreshRankedState(matchId: string): Promise<void> {
  if (activeMode !== "ranked" || activeRoom?.snapshot.room.kind !== "match") {
    return;
  }

  try {
    const response = await getClient().request<RpsResultResponse>(
      `/v1/demo/rps/matches/${encodeURIComponent(matchId)}`
    );
    renderRankedResult(response);
    if (response.result !== null) {
      rankedResend.classList.remove("hidden");
      stopRankedPolling();
      await refreshRating();
    }
  } catch {
    // 再接続中の一時的な失敗は Room SDK の状態表示へ任せ、ポーリングを継続します。
  }
}

function renderRankedResult(response: RpsResultResponse): void {
  if (response.result === null) {
    rankedResult.textContent = response.yourMove === null
      ? "手を選ぶと、相手の入力を待ちます。"
      : `${MOVE_LABELS[response.yourMove]}を送信しました。相手の手を待っています。`;
    return;
  }

  const labels = `${MOVE_LABELS[response.yourMove ?? "rock"]} vs ${MOVE_LABELS[response.opponentMove ?? "rock"]}`;
  const outcome = response.result.outcome === "draw"
    ? "引き分け"
    : response.result.outcome === "win" ? "あなたの勝ち" : "あなたの負け";
  const applied = response.result.applied === false
    ? "（再送。ELOは二重更新されていません）"
    : "（ELOを更新しました）";
  rankedResult.textContent = `${labels}：${outcome} ${applied}`;
}

async function refreshRating(): Promise<void> {
  if (client === undefined) {
    return;
  }

  try {
    const rating = await client.getRating(RANKED_POOL.id);
    rankedRating.textContent = String(Math.round(rating.value));
  } catch {
    rankedRating.textContent = "未取得";
  }
}

async function leaveRoom(showNotice = true): Promise<void> {
  stopRankedPolling();
  const room = activeRoom;
  activeRoom = undefined;
  activeMode = undefined;
  for (const unsubscribe of roomUnsubscribers) {
    unsubscribe();
  }
  roomUnsubscribers = [];

  if (room !== undefined && !room.closed) {
    try {
      await room.leave({ requestId: createRequestId("leave") });
    } catch {
      // 切断済みならサーバー側の切断猶予へ任せます。
    }
  }

  customRoomInfo.classList.add("hidden");
  rankedRoomInfo.classList.add("hidden");
  if (showNotice) {
    setNotice("ルームを退出しました。", "success");
  }
}

async function logout(): Promise<void> {
  await leaveRoom(false);
  await cancelRankedQueue();
  client?.dispose();
  client = undefined;
  sessionPlayer.textContent = "未接続";
  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

function setRankedMoveButtonsDisabled(disabled: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ranked-move]")) {
    button.disabled = disabled;
  }
}

function getClient(): DemoClient {
  if (client === undefined) {
    throw new Error("セッションが開始されていません。");
  }
  return client;
}

function setNotice(message: string, tone: "success" | "danger" = "success"): void {
  notice.textContent = message;
  notice.className = `status ${tone}`;
}

function showError(error: unknown): void {
  const value = error as { readonly message?: unknown };
  setNotice(typeof value.message === "string" ? value.message : "通信に失敗しました。", "danger");
}

function isCancelled(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === "CANCELLED";
}

function displayPlayer(value: string): string {
  return value.startsWith("demo:") ? value.slice("demo:".length) : value;
}

function isMove(value: unknown): value is Move {
  return value === "rock" || value === "paper" || value === "scissors";
}

function resolveResult(own: Move, opponent: Move): "win" | "draw" | "lose" {
  if (own === opponent) {
    return "draw";
  }
  const win =
    (own === "rock" && opponent === "scissors") ||
    (own === "paper" && opponent === "rock") ||
    (own === "scissors" && opponent === "paper");
  return win ? "win" : "lose";
}

function createRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function element<T extends Element>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`サンプルUIの要素がありません: ${id}`);
  }
  return value as unknown as T;
}
