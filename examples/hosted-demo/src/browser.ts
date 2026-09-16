/**
 * 公開デモのブラウザ UI です。
 *
 * ゲストとして開始（Supabase 匿名ログイン＋本番 CAPTCHA）→招待リンクを共有→
 * 双方準備→対戦→ランク戦の結果確認までを 2 導線（招待対戦・ランク戦）で提供
 * します。Bot 対戦は作りません。認証 token / joinToken / resumeToken を
 * URL へ載せず、DOM 表示は text として扱います。
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFlareLobbyClient } from "@flarelobby/client";
import type {
  FlareLobbyClient,
  HostRoom,
  MatchmakingTicket,
  PlayerRoom,
  Room,
} from "@flarelobby/client";
import type {
  FlareLobbyApp,
  MatchmakingPool,
  RoomSnapshot,
} from "@flarelobby/core";
import {
  buildInviteUrl,
  classifyInviteJoinError,
  describeInviteJoinFailure,
  isInviteCode,
  parseInviteCodeFromHash,
} from "./invite.js";

declare const __HOSTED_DEMO_CONFIG__: {
  readonly endpoint: string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly turnstileSiteKey: string;
};

interface TurnstileApi {
  render(
    container: string | HTMLElement,
    options: Record<string, unknown>,
  ): string;
  reset(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
}

declare global {
  interface Window {
    readonly turnstile?: TurnstileApi;
  }
}

type Move = "rock" | "paper" | "scissors";

type HostedDemoApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string; playlist: string },
  {
    "rps.move": { move: Move };
    "rps.ready": { ready: boolean };
  }
>;

type HostedDemoClient = FlareLobbyClient<HostedDemoApp>;
type HostedDemoPlayerRoom = PlayerRoom<HostedDemoApp>;

interface RpsResultResponse {
  readonly matchId: string;
  readonly ready: boolean;
  readonly yourMove: Move | null;
  readonly opponentMove: Move | null;
  readonly result: {
    readonly value: 0 | 0.5 | 1;
    readonly outcome: "win" | "draw" | "lose";
    readonly resultId: string;
    readonly applied: boolean | null;
  } | null;
  readonly rating?: { readonly value: number };
}

const RANKED_POOL = {
  id: "ranked-jp",
  gameId: "hosted-demo",
  seasonId: "season-1",
  mode: "ranked-1v1",
  region: "jp",
} satisfies MatchmakingPool;

const MOVE_LABELS: Readonly<Record<Move, string>> = {
  rock: "グー",
  paper: "パー",
  scissors: "チョキ",
};

const endpoint = __HOSTED_DEMO_CONFIG__.endpoint || window.location.origin;

let supabase: SupabaseClient | undefined;

/** Supabase client を遅延生成します。設定なしでも招待リンク表示は動きます。 */
function getSupabase(): SupabaseClient {
  if (supabase === undefined) {
    if (
      __HOSTED_DEMO_CONFIG__.supabaseUrl === "" ||
      __HOSTED_DEMO_CONFIG__.supabasePublishableKey === ""
    ) {
      throw new Error(
        "Supabase の接続設定がありません。運用担当に確認してください。",
      );
    }
    supabase = createClient(
      __HOSTED_DEMO_CONFIG__.supabaseUrl,
      __HOSTED_DEMO_CONFIG__.supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
        },
      },
    );
  }
  return supabase;
}

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
const customInviteLink = element<HTMLElement>("custom-invite-link");
const customState = element<HTMLElement>("custom-state");
const customParticipants = element<HTMLUListElement>("custom-participants");
const customConnection = element<HTMLElement>("custom-connection");
const rankedConnection = element<HTMLElement>("ranked-connection");
const customReady = element<HTMLButtonElement>("custom-ready");
const customStart = element<HTMLButtonElement>("custom-start");
const customMoveActions = element<HTMLElement>("custom-move-actions");
const customResult = element<HTMLElement>("custom-result");
const rankedResult = element<HTMLElement>("ranked-result");
const rankedResend = element<HTMLButtonElement>("ranked-resend");
const rankedStatus = element<HTMLElement>("ranked-status");
const rankedProgress = element<HTMLElement>("ranked-progress");
const rankedJoin = element<HTMLButtonElement>("ranked-join");
const rankedCancel = element<HTMLButtonElement>("ranked-cancel");
const rankedRating = element<HTMLElement>("ranked-rating");
const notice = element<HTMLElement>("notice");
const sessionPlayer = element<HTMLElement>("session-player");
const inviteBanner = element<HTMLElement>("invite-banner");
const inviteBannerCode = element<HTMLElement>("invite-banner-code");
const guestStart = element<HTMLButtonElement>("guest-start");
const inviteCodeInput = element<HTMLInputElement>("custom-code-input");

let client: HostedDemoClient | undefined;
let activeRoom: Room<HostedDemoApp> | undefined;
let activeTicket: MatchmakingTicket<HostedDemoApp> | undefined;
let activeMode: "custom" | "ranked" | undefined;
let roomUnsubscribers: Array<() => void> = [];
let rankedPollTimer: number | undefined;
let selectedRankedMove: Move | undefined;
let pendingInviteCode: string | null = parseInviteCodeFromHash(
  window.location.hash,
);
let busy = false;
const customMoves = new Map<string, Move>();

if (pendingInviteCode !== null) {
  inviteBanner.classList.remove("hidden");
  inviteBannerCode.textContent = pendingInviteCode;
  inviteCodeInput.value = pendingInviteCode;
} else if (window.location.hash.startsWith("#invite=")) {
  setNotice("招待リンクの形式が正しくありません。", "danger");
}

guestStart.addEventListener("click", () => void startGuestSession());
element<HTMLButtonElement>("show-custom").addEventListener("click", () => {
  showMode("custom");
});
element<HTMLButtonElement>("show-ranked").addEventListener("click", () => {
  showMode("ranked");
  void refreshRating();
});
element<HTMLButtonElement>("custom-back").addEventListener("click", () =>
  showMode(),
);
element<HTMLButtonElement>("ranked-back").addEventListener("click", () =>
  showMode(),
);
element<HTMLButtonElement>("logout").addEventListener(
  "click",
  () => void logout(),
);
element<HTMLButtonElement>("custom-leave").addEventListener(
  "click",
  () => void leaveRoom(),
);
element<HTMLButtonElement>("ranked-leave").addEventListener(
  "click",
  () => void leaveRoom(),
);
customReady.addEventListener("click", () => void toggleReady());
customStart.addEventListener("click", () => void startCustomMatch());
rankedJoin.addEventListener("click", () => void joinRankedQueue());
rankedCancel.addEventListener("click", () => void cancelRankedQueue());
rankedResend.addEventListener("click", () => {
  if (selectedRankedMove !== undefined) {
    void submitRankedMove(selectedRankedMove, true);
  }
});

element<HTMLFormElement>("custom-create-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    void createCustomRoom();
  },
);
element<HTMLFormElement>("custom-join-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    void joinCustomRoom();
  },
);

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-custom-move]",
)) {
  button.addEventListener("click", () => {
    const move = button.dataset["customMove"];
    if (isMove(move)) {
      void submitCustomMove(move);
    }
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-ranked-move]",
)) {
  button.addEventListener("click", () => {
    const move = button.dataset["rankedMove"];
    if (isMove(move)) {
      void submitRankedMove(move, false);
    }
  });
}

void restoreSession();
void initTurnstileWidget();

/** Turnstile ウィジェットを描画します。sitekey 未設定の検証環境では何もしません。 */
async function initTurnstileWidget(): Promise<void> {
  if (__HOSTED_DEMO_CONFIG__.turnstileSiteKey === "") {
    return;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (window.turnstile !== undefined) {
      window.turnstile.render("#turnstile-widget", {
        sitekey: __HOSTED_DEMO_CONFIG__.turnstileSiteKey,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  setNotice(
    "CAPTCHA を読み込めませんでした。通信環境を確認してください。",
    "danger",
  );
}

/** ページ再読み込み時に Supabase session が残っていれば復元します。 */
async function restoreSession(): Promise<void> {
  let result;
  try {
    result = await getSupabase().auth.getSession();
  } catch {
    return;
  }
  if (result.data.session !== null) {
    attachClient();
    sessionPlayer.textContent = "ゲストで接続中";
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    showMode(pendingInviteCode !== null ? "custom" : undefined);
    if (pendingInviteCode !== null) {
      setNotice(
        "招待リンクを引き継ぎました。「ルームへ参加」を押してください。",
        "success",
      );
    }
    void refreshRating();
  }
}

/** ゲストとして開始します。匿名ログインに本番 CAPTCHA を接続します。 */
async function startGuestSession(): Promise<void> {
  if (busy) {
    return;
  }
  setBusy(true);
  try {
    const captchaToken = readCaptchaToken();
    if (
      __HOSTED_DEMO_CONFIG__.turnstileSiteKey !== "" &&
      captchaToken === null
    ) {
      setNotice(
        "CAPTCHA の確認が終わっていません。チェックを完了してください。",
        "danger",
      );
      return;
    }

    const { data, error } = await getSupabase().auth.signInAnonymously(
      captchaToken === null ? undefined : { options: { captchaToken } },
    );
    if (error !== null || data.session === null) {
      setNotice(
        "ゲスト開始に失敗しました。CAPTCHA と時間をおいて試してください。",
        "danger",
      );
      return;
    }

    attachClient();
    sessionPlayer.textContent = "ゲストで接続中";
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    showMode(pendingInviteCode !== null ? "custom" : undefined);
    if (pendingInviteCode !== null) {
      setNotice(
        "招待リンクを引き継ぎました。「ルームへ参加」を押してください。",
        "success",
      );
    } else {
      setNotice("接続しました。対戦モードを選んでください。", "success");
    }
    void refreshRating();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function readCaptchaToken(): string | null {
  if (__HOSTED_DEMO_CONFIG__.turnstileSiteKey === "") {
    return null;
  }
  const token = window.turnstile?.getResponse();
  return token === undefined || token === "" ? null : token;
}

function attachClient(): void {
  client?.dispose();
  client = createFlareLobbyClient<HostedDemoApp>({
    endpoint,
    getAccessToken: () => getAccessToken(),
    reconnect: {
      maxAttempts: 8,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      jitterRatio: 0.2,
    },
  });
}

/** 要求直前の session から token を取得し、更新後 token を使います。 */
async function getAccessToken(): Promise<string> {
  const result = await getSupabase().auth.getSession();
  if (result.error !== null || result.data.session === null) {
    throw new Error("未認証です。先にゲストとして開始してください。");
  }
  return result.data.session.access_token;
}

function setBusy(value: boolean): void {
  busy = value;
  renderControls();
}

function showMode(mode?: "custom" | "ranked"): void {
  menuPanel.classList.toggle("hidden", mode !== undefined);
  customPanel.classList.toggle("hidden", mode !== "custom");
  rankedPanel.classList.toggle("hidden", mode !== "ranked");
  activeMode = mode;
  renderControls();
}

function renderControls(): void {
  const locked = busy || client === undefined;
  guestStart.disabled = busy;
  rankedJoin.disabled = locked || activeTicket !== undefined;
  customReady.disabled =
    locked || activeRoom === undefined || activeMode !== "custom";
  setRankedMoveButtonsDisabled(
    locked || activeMode !== "ranked" || activeRoom === undefined,
  );
}

async function createCustomRoom(): Promise<void> {
  const current = getClient();
  if (busy) {
    return;
  }
  setBusy(true);
  try {
    const name =
      element<HTMLInputElement>("custom-name").value.trim() ||
      "じゃんけんルーム";
    const room = await current.createCustomRoom({
      requestId: createRequestId("custom-create"),
      name,
      visibility: "unlisted",
      joinMethod: "invitation",
      maxPlayers: 2,
      settings: { map: "forest" },
    });
    await openRoom(room, "custom");
    renderInviteLink();
    setNotice(
      "ルームを作成しました。招待リンクをもう1つのブラウザへ共有してください。",
      "success",
    );
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function renderInviteLink(): void {
  if (
    activeRoom === undefined ||
    activeRoom.snapshot.room.kind !== "custom" ||
    activeRoom.snapshot.room.invitationCode === null
  ) {
    customInviteLink.textContent = "";
    return;
  }
  const code = activeRoom.snapshot.room.invitationCode;
  const url = buildInviteUrl(window.location.origin, code);
  customInviteLink.textContent = url === null ? "" : `招待リンク: ${url}`;
}

async function joinCustomRoom(): Promise<void> {
  const current = getClient();
  if (busy) {
    return;
  }
  const code = inviteCodeInput.value.trim().toUpperCase();
  if (!isInviteCode(code)) {
    setNotice(describeInviteJoinFailure("invalid"), "danger");
    return;
  }
  setBusy(true);
  try {
    const room = await current.joinCustomRoom({
      requestId: createRequestId("custom-join"),
      invitationCode: code,
      role: "player",
    });
    pendingInviteCode = null;
    await openRoom(room, "custom");
    setNotice(
      "招待ルームへ参加しました。準備ボタンを押してください。",
      "success",
    );
  } catch (error) {
    showError(describeInviteJoinFailure(classifyInviteJoinError(error)));
  } finally {
    setBusy(false);
  }
}

async function joinRankedQueue(): Promise<void> {
  const current = getClient();
  if (busy) {
    return;
  }
  setBusy(true);
  await leaveRoom(false);
  activeMode = "ranked";
  rankedCancel.classList.remove("hidden");
  rankedStatus.textContent = "チケットを作成しています…";
  rankedProgress.textContent = "";
  renderControls();
  try {
    const ticket = await current.joinMatchmaking(RANKED_POOL, {
      requestId: createRequestId("ranked-ticket"),
      inputMethod: "keyboard_mouse",
      ttlMs: 60_000,
    });
    activeTicket = ticket;
    const stopProgress = ticket.on("progress", (progress) => {
      rankedStatus.textContent = `キュー状態: ${progress.ticket.status}`;
      rankedProgress.textContent = `待機 ${Math.round(progress.waitingTimeMs / 1_000)}秒 / 検索幅 ±${Math.round(progress.searchWidth)} / 待機 ${progress.waitingCount}人`;
    });
    roomUnsubscribers.push(stopProgress);
    setNotice(
      "ランクキューに参加しました。もう1つのブラウザでも参加してください。",
      "success",
    );
    const room = await ticket.waitForMatch();
    stopProgress();
    activeTicket = undefined;
    rankedCancel.classList.add("hidden");
    await openRoom(room, "ranked");
    setNotice("対戦Roomへ接続しました。手を選んでください。", "success");
  } catch (error) {
    activeTicket = undefined;
    rankedCancel.classList.add("hidden");
    if (isCancelled(error)) {
      rankedStatus.textContent = "キューを取消しました。";
    } else {
      showError(error);
    }
  } finally {
    setBusy(false);
    renderControls();
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
    rankedCancel.classList.add("hidden");
    rankedStatus.textContent = "キューを取消しました。";
    rankedProgress.textContent = "";
  } catch (error) {
    showError(error);
  } finally {
    renderControls();
  }
}

async function openRoom(
  room: Room<HostedDemoApp>,
  mode: "custom" | "ranked",
): Promise<void> {
  await leaveRoom(false);
  activeRoom = room;
  activeMode = mode;
  selectedRankedMove = undefined;
  customMoves.clear();
  roomUnsubscribers = [];
  roomUnsubscribers.push(room.subscribe(renderRoom));
  roomUnsubscribers.push(
    room.onStatusChange((status) => {
      const label = `通信状態: ${status}`;
      if (mode === "custom") {
        customConnection.textContent = label;
      } else {
        rankedConnection.textContent = label;
      }
      // 接続中と再接続中は重複操作を抑止します。
      const connecting = status === "connecting" || status === "reconnecting";
      customReady.disabled = connecting;
      customStart.disabled = connecting;
      setRankedMoveButtonsDisabled(connecting);
    }),
  );

  const playerRoom = room as HostedDemoPlayerRoom;
  if (mode === "custom") {
    roomUnsubscribers.push(
      playerRoom.onMessage("rps.move", (message) => {
        const move = message.payload.move;
        const sender = message.sender?.participantId;
        if (sender !== undefined && isMove(move)) {
          customMoves.set(sender, move);
          renderCustomResult();
        }
      }),
    );
  }

  customRoomInfo.classList.toggle("hidden", mode !== "custom");
  rankedRoomInfo.classList.toggle("hidden", mode !== "ranked");
  customMoveActions.classList.add("hidden");
  rankedResend.classList.add("hidden");
  rankedResult.textContent = "手を選ぶと、相手の入力を待ちます。";
  renderRoom(room.snapshot);
  renderInviteLink();

  if (mode === "ranked") {
    const matchRoom = room.snapshot.room;
    if (matchRoom.kind === "match") {
      rankedRoomId.textContent = `Match ID: ${matchRoom.matchId}`;
      startRankedPolling(matchRoom.matchId);
    }
  }
  renderControls();
}

function renderRoom(snapshot: RoomSnapshot<HostedDemoApp>): void {
  const room = activeRoom;
  if (room === undefined) {
    return;
  }

  const ownParticipant = snapshot.participants.find(
    (participant) => participant.id === room.participantId,
  );
  const ownReady = ownParticipant?.kind === "player" && ownParticipant.ready;
  customReady.textContent = ownReady ? "準備を解除" : "準備する";
  const playerCount = snapshot.participants.filter(
    (participant) => participant.kind === "player",
  ).length;
  customReady.disabled =
    busy || snapshot.state.status !== "waiting" || activeMode !== "custom";
  customStart.disabled =
    busy ||
    room.role !== "host" ||
    snapshot.state.status !== "waiting" ||
    playerCount < 2 ||
    !snapshot.participants.every(
      (participant) => participant.kind !== "player" || participant.ready,
    );
  customRoomId.textContent = `Room ID: ${snapshot.room.id}`;
  customInvitationCode.textContent =
    snapshot.room.kind === "custom" ? snapshot.room.invitationCode : "------";
  customState.textContent = `Room状態: ${snapshot.state.status} / revision ${snapshot.revision} / 参加 ${playerCount}人`;
  customParticipants.replaceChildren(
    ...snapshot.participants.map((participant) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `ゲスト${participant.id === room.participantId ? "（自分）" : ""}`;
      const state = document.createElement("span");
      state.className = "small muted";
      state.textContent =
        participant.kind === "player"
          ? participant.ready
            ? "準備完了"
            : "待機中"
          : "観戦者";
      item.appendChild(label);
      item.appendChild(state);
      return item;
    }),
  );

  if (activeMode === "custom") {
    const inProgress = snapshot.state.status === "in_progress";
    customMoveActions.classList.toggle("hidden", !inProgress);
  }
}

async function toggleReady(): Promise<void> {
  const room = activeRoom as HostedDemoPlayerRoom | undefined;
  if (room === undefined || activeMode !== "custom" || busy) {
    return;
  }

  const ownParticipant = room.snapshot.participants.find(
    (participant) => participant.id === room.participantId,
  );
  if (ownParticipant?.kind !== "player") {
    return;
  }

  setBusy(true);
  try {
    await room.setReady(!ownParticipant.ready, {
      requestId: createRequestId("custom-ready"),
    });
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function startCustomMatch(): Promise<void> {
  const room = activeRoom;
  if (room === undefined || room.role !== "host" || busy) {
    return;
  }

  const host = room as HostRoom<HostedDemoApp>;
  setBusy(true);
  try {
    await host.startMatch({ requestId: createRequestId("custom-start") });
    setNotice("対戦開始。2人の手を選んでください。", "success");
  } catch (error) {
    showError(error);
    renderRoom(room.snapshot);
  } finally {
    setBusy(false);
  }
}

async function submitCustomMove(move: Move): Promise<void> {
  const room = activeRoom as HostedDemoPlayerRoom | undefined;
  if (room === undefined || activeMode !== "custom" || busy) {
    return;
  }

  setBusy(true);
  try {
    await room.send(
      "rps.move",
      { move },
      { requestId: createRequestId("custom-move") },
    );
    customMoves.set(room.participantId, move);
    renderCustomResult();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function renderCustomResult(): void {
  const room = activeRoom;
  if (room === undefined) {
    return;
  }

  const ownMove = customMoves.get(room.participantId);
  const opponent = room.snapshot.participants.find(
    (participant) =>
      participant.kind === "player" && participant.id !== room.participantId,
  );
  const opponentMove =
    opponent === undefined ? undefined : customMoves.get(opponent.id);
  if (ownMove === undefined || opponentMove === undefined) {
    customResult.textContent =
      ownMove === undefined
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
  if (activeMode !== "ranked" || room?.kind !== "match" || busy) {
    return;
  }

  selectedRankedMove = move;
  setRankedMoveButtonsDisabled(true);
  try {
    const response = await current.request<RpsResultResponse>(
      `/v1/demo/rps/matches/${encodeURIComponent(room.matchId)}/move`,
      {
        method: "POST",
        body: {
          move,
          requestId: createRequestId(resend ? "ranked-resend" : "ranked-move"),
        },
      },
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
      `/v1/demo/rps/matches/${encodeURIComponent(matchId)}`,
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
    rankedResult.textContent =
      response.yourMove === null
        ? "手を選ぶと、相手の入力を待ちます。"
        : `${MOVE_LABELS[response.yourMove]}を送信しました。相手の手を待っています。`;
    return;
  }

  const labels = `${MOVE_LABELS[response.yourMove ?? "rock"]} vs ${MOVE_LABELS[response.opponentMove ?? "rock"]}`;
  const outcome =
    response.result.outcome === "draw"
      ? "引き分け"
      : response.result.outcome === "win"
        ? "あなたの勝ち"
        : "あなたの負け";
  const applied =
    response.result.applied === false
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
  const mode = activeMode;
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
  if (room !== undefined && mode === "ranked") {
    rankedJoin.disabled = false;
  }
  if (showNotice) {
    setNotice("ルームを退出しました。", "success");
  }
  renderControls();
}

async function logout(): Promise<void> {
  await leaveRoom(false);
  await cancelRankedQueue();
  client?.dispose();
  client = undefined;
  try {
    await getSupabase().auth.signOut();
  } catch {
    // 設定なしの表示確認時など、signOut できない場合は無視します。
  }
  sessionPlayer.textContent = "未接続";
  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderControls();
}

function setRankedMoveButtonsDisabled(disabled: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-ranked-move]",
  )) {
    button.disabled = disabled;
  }
}

function getClient(): HostedDemoClient {
  if (client === undefined) {
    throw new Error("セッションが開始されていません。");
  }
  return client;
}

function setNotice(
  message: string,
  tone: "success" | "danger" = "success",
): void {
  notice.textContent = message;
  notice.className = `status ${tone}`;
}

function showError(error: unknown): void {
  if (typeof error === "string") {
    setNotice(error, "danger");
    return;
  }
  const value = error as { readonly message?: unknown };
  setNotice(
    typeof value.message === "string" ? value.message : "通信に失敗しました。",
    "danger",
  );
}

function isCancelled(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === "CANCELLED";
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
