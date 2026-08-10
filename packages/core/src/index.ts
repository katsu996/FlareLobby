/** JSON として公開できるプリミティブ値です。 */
export type JsonPrimitive = boolean | null | number | string;

/** JSON として公開できるオブジェクトです。 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** JSON として公開できる値です。 */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

/**
 * ネストした設定値を読み取り専用として公開するための型です。
 *
 * 設定、メタデータ、ゲーム固有メッセージの Payload は JSON として
 * 直列化可能な値にしてください。
 */
export type ReadonlyDeep<TValue> = TValue extends JsonPrimitive
  ? TValue
  : TValue extends readonly (infer TItem)[]
    ? readonly ReadonlyDeep<TItem>[]
    : TValue extends object
      ? { readonly [TKey in keyof TValue]: ReadonlyDeep<TValue[TKey]> }
      : never;

/** ISO 8601 形式の UTC 時刻です。 */
export type Timestamp = string;

/** 状態変更ごとに単調増加するルームの版番号です。 */
export type Revision = number;

export type PlayerId = string;
export type PrincipalId = string;
export type RoomId = string;
export type InvitationCode = string;
export type ParticipantId = string;
export type TeamId = string;
export type MatchmakingPoolId = string;
export type MatchmakingTicketId = string;
export type MatchCandidateId = string;
export type MatchId = string;
export type GameId = string;
export type SeasonId = string;
export type MatchMode = string;
export type Region = string;

/** ルームへ参加するゲームプレイヤーです。 */
export interface Player {
  readonly id: PlayerId;
}

/**
 * サーバー側で認証済みの主体です。
 * `playerId` はクライアント申告値ではなく、認証結果から決定します。
 */
export interface Principal {
  readonly id: PrincipalId;
  readonly playerId: PlayerId;
}

/** ルーム内で選択できるチームです。 */
export interface Team {
  readonly id: TeamId;
}

/** プレイヤーとして参加している参加者です。 */
export interface PlayerParticipant {
  readonly kind: "player";
  readonly id: ParticipantId;
  readonly player: Player;
  readonly teamId: TeamId | null;
  readonly ready: boolean;
}

/** 観戦者として参加している参加者です。 */
export interface Spectator {
  readonly kind: "spectator";
  readonly id: ParticipantId;
  readonly player: Player;
}

/** ルームの参加者です。 */
export type Participant = PlayerParticipant | Spectator;

/** カスタムルームの管理操作を行える参加者です。 */
export interface Host {
  readonly participantId: ParticipantId;
  readonly playerId: PlayerId;
}

/** 利用者が指定するルーム設定の既定形です。 */
export type RoomSettings = JsonObject;

/** 利用者が指定するルームメタデータの既定形です。 */
export type RoomMetadata = JsonObject;

/** 利用者が指定するゲーム固有メッセージ定義の既定形です。 */
export type GameMessageMap = {
  readonly [messageName: string]: JsonValue;
};

/**
 * FlareLobby の公開型を利用者のゲーム定義へ結び付ける型契約です。
 *
 * ルーム設定、ルームメタデータ、ゲーム固有メッセージをこの型引数で
 * 指定し、後続の公開 API では同じ `TApp` を渡します。
 */
export interface FlareLobbyApp<
  TSettings extends object = RoomSettings,
  TMetadata extends object = RoomMetadata,
  TMessages extends object = GameMessageMap,
> {
  readonly room: {
    readonly settings: TSettings;
    readonly metadata: TMetadata;
    readonly messages: TMessages;
  };
}

/** 任意の FlareLobby アプリケーション定義を受け入れる内部契約です。 */
export type AnyFlareLobbyApp = FlareLobbyApp<object, object, object>;

/** アプリケーション定義からルーム設定を取り出します。 */
export type AppRoomSettings<TApp extends AnyFlareLobbyApp> =
  TApp["room"]["settings"];

/** アプリケーション定義からルームメタデータを取り出します。 */
export type AppRoomMetadata<TApp extends AnyFlareLobbyApp> =
  TApp["room"]["metadata"];

/** アプリケーション定義からゲーム固有メッセージ定義を取り出します。 */
export type AppGameMessages<TApp extends AnyFlareLobbyApp> =
  TApp["room"]["messages"];

declare const flarelobbyAppType: unique symbol;

/** 公開型からアプリケーション定義を復元するための型専用の関連付けです。 */
interface AppBound<TApp extends AnyFlareLobbyApp> {
  readonly [flarelobbyAppType]?: TApp;
}

/** カスタムルームの公開情報です。 */
export interface CustomRoom<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends AppBound<TApp> {
  readonly id: RoomId;
  readonly kind: "custom";
  readonly invitationCode: InvitationCode;
  readonly visibility: "public" | "unlisted";
  readonly settings: ReadonlyDeep<AppRoomSettings<TApp>>;
  readonly metadata: ReadonlyDeep<AppRoomMetadata<TApp>>;
}

/** マッチング成立時に作成される対戦ルームの公開情報です。 */
export interface MatchRoom<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends AppBound<TApp> {
  readonly id: RoomId;
  readonly kind: "match";
  readonly matchId: MatchId;
  readonly pool: MatchmakingPool;
  readonly settings: ReadonlyDeep<AppRoomSettings<TApp>>;
  readonly metadata: ReadonlyDeep<AppRoomMetadata<TApp>>;
}

/** カスタムルームまたは対戦ルームです。 */
export type Room<TApp extends AnyFlareLobbyApp = FlareLobbyApp> =
  | CustomRoom<TApp>
  | MatchRoom<TApp>;

/** ルームのライフサイクル状態です。 */
export type RoomStatus = "waiting" | "preparing" | "in_progress" | "finished";

/** 待機中のルーム状態です。 */
export interface WaitingRoomState {
  readonly status: "waiting";
}

/** 開始準備中のルーム状態です。 */
export interface PreparingRoomState {
  readonly status: "preparing";
  readonly preparationStartedAt: Timestamp;
}

/** 対戦中のルーム状態です。 */
export interface InProgressRoomState {
  readonly status: "in_progress";
  readonly startedAt: Timestamp;
}

/** 終了済みのルーム状態です。 */
export interface FinishedRoomState {
  readonly status: "finished";
  readonly finishedAt: Timestamp;
}

/** 状態ごとに必須項目を区別できるルーム状態です。 */
export type RoomState =
  | WaitingRoomState
  | PreparingRoomState
  | InProgressRoomState
  | FinishedRoomState;

/** すべてのルームスナップショットに共通する読み取り専用の状態です。 */
export interface RoomSnapshotBase<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends AppBound<TApp> {
  /** 状態変更ごとに増加する版番号です。 */
  readonly revision: Revision;
  readonly state: RoomState;
  readonly participants: readonly Participant[];
  readonly teams: readonly Team[];
}

/** カスタムルームの読み取り専用スナップショットです。 */
export interface CustomRoomSnapshot<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends RoomSnapshotBase<TApp> {
  readonly room: CustomRoom<TApp>;
  readonly host: Host;
}

/** 対戦ルームの読み取り専用スナップショットです。 */
export interface MatchRoomSnapshot<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends RoomSnapshotBase<TApp> {
  readonly room: MatchRoom<TApp>;
}

/** 読み取り専用のルーム状態です。 */
export type RoomSnapshot<TApp extends AnyFlareLobbyApp = FlareLobbyApp> =
  | CustomRoomSnapshot<TApp>
  | MatchRoomSnapshot<TApp>;

/** 同一ルールで候補探索を行う待機集合です。 */
export interface MatchmakingPool {
  readonly id: MatchmakingPoolId;
  readonly gameId: GameId;
  readonly seasonId: SeasonId;
  readonly mode: MatchMode;
  readonly region: Region;
}

/** プールとプレイヤーに対応する現在のレーティングです。 */
export interface Rating {
  readonly playerId: PlayerId;
  readonly poolId: MatchmakingPoolId;
  readonly value: number;
}

/** 1 対 1 の成立候補です。 */
export interface MatchCandidate {
  readonly id: MatchCandidateId;
  readonly pool: MatchmakingPool;
  readonly ticketIds: readonly [MatchmakingTicketId, MatchmakingTicketId];
  readonly createdAt: Timestamp;
}

/** 候補から生成された対戦ルームの成立結果です。 */
export interface MatchResult<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends AppBound<TApp> {
  readonly matchId: MatchId;
  readonly candidate: MatchCandidate;
  readonly room: MatchRoom<TApp>;
  readonly createdAt: Timestamp;
}

/** マッチングチケットのライフサイクル状態です。 */
export type MatchmakingTicketStatus =
  | "creating"
  | "waiting"
  | "reserved"
  | "matched"
  | "cancelled"
  | "expired";

/** すべてのマッチングチケットに共通する公開情報です。 */
export interface MatchmakingTicketBase<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends AppBound<TApp> {
  readonly id: MatchmakingTicketId;
  readonly pool: MatchmakingPool;
  readonly player: Player;
  readonly rating: Rating;
  readonly createdAt: Timestamp;
}

/** 作成中のマッチングチケットです。 */
export interface CreatingMatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends MatchmakingTicketBase<TApp> {
  readonly status: "creating";
}

/** 待機中のマッチングチケットです。 */
export interface WaitingMatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends MatchmakingTicketBase<TApp> {
  readonly status: "waiting";
  readonly queuedAt: Timestamp;
}

/** 候補確保中のマッチングチケットです。 */
export interface ReservedMatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends MatchmakingTicketBase<TApp> {
  readonly status: "reserved";
  readonly candidate: MatchCandidate;
  readonly reservedAt: Timestamp;
}

/** 成立済みのマッチングチケットです。 */
export interface MatchedMatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends MatchmakingTicketBase<TApp> {
  readonly status: "matched";
  readonly result: MatchResult<TApp>;
  readonly matchedAt: Timestamp;
}

/** キャンセル済みのマッチングチケットです。 */
export interface CancelledMatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends MatchmakingTicketBase<TApp> {
  readonly status: "cancelled";
  readonly cancelledAt: Timestamp;
}

/** 期限切れのマッチングチケットです。 */
export interface ExpiredMatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> extends MatchmakingTicketBase<TApp> {
  readonly status: "expired";
  readonly expiredAt: Timestamp;
}

/** 状態ごとに必須項目を区別できるマッチングチケットです。 */
export type MatchmakingTicket<
  TApp extends AnyFlareLobbyApp = FlareLobbyApp,
> =
  | CreatingMatchmakingTicket<TApp>
  | WaitingMatchmakingTicket<TApp>
  | ReservedMatchmakingTicket<TApp>
  | MatchedMatchmakingTicket<TApp>
  | CancelledMatchmakingTicket<TApp>
  | ExpiredMatchmakingTicket<TApp>;

/** ゲーム固有メッセージの名前です。 */
export type GameMessageName<TApp extends AnyFlareLobbyApp> = Extract<
  keyof AppGameMessages<TApp>,
  string
>;

/** 指定したゲーム固有メッセージの Payload です。 */
export type GameMessagePayload<
  TApp extends AnyFlareLobbyApp,
  TName extends GameMessageName<TApp>,
> = ReadonlyDeep<AppGameMessages<TApp>[TName]>;

/** 名前と Payload の対応を保持したゲーム固有メッセージです。 */
export type GameMessage<TApp extends AnyFlareLobbyApp = FlareLobbyApp> = {
  [TName in GameMessageName<TApp>]: AppBound<TApp> & {
    readonly name: TName;
    readonly payload: GameMessagePayload<TApp, TName>;
  };
}[GameMessageName<TApp>];

/** 公開型に結び付いた FlareLobby アプリケーション定義を取り出します。 */
export type InferFlareLobbyApp<TPublicType> =
  TPublicType extends AppBound<infer TApp> ? TApp : never;

export * from "./protocol.js";
