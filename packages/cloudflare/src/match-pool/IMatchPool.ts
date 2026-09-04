import type {
  MatchmakingPool,
  MatchmakingSearchPolicy,
  NormalizedMatchmakingSearchPolicy,
  MatchmakingTicketId,
} from "@flarelobby/core";
import type {
  MatchPoolInitializationOptions,
  MatchmakingSearchOptions,
  MatchmakingSearchResult,
  MatchmakingMatchIntent,
  MatchmakingMatchProcessingOptions,
  MatchPoolSnapshot,
  MatchmakingMatchResult,
  MatchmakingTicketRecord,
  MatchmakingTicketCreationOptions,
  MatchmakingTicketCancellationOptions,
  MatchmakingTicketEventQueryOptions,
  MatchmakingTicketEvent,
  MatchmakingTicketReservationOptions,
  MatchmakingTicketMatchOptions,
} from "../match-pool.js";
import type { Principal } from "@flarelobby/core";
import type { GatewayPrincipalEnvelope } from "../security.js";

/**
 * MatchPool Durable Object の公開インターフェース。
 *
 * 外部コード（テスト、設定、ブートストラップ）はこのインターフェース経由で
 * MatchPool 機能を利用し、実装クラス `MatchPoolDurableObject` の詳細を知る必要はありません。
 */
export interface IMatchPoolDurableObject {
  /** WebSocket Upgrade / HTTP ハンドラ */
  fetch(request: Request): Promise<Response>;

  /** WebSocket メッセージ受信ハンドラ */
  webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void>;

  /** Alarm ハンドラ（期限処理の実行） */
  alarm(): void | Promise<void>;

  /** Gateway の署名済み主体を検証します */
  resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope,
  ): Promise<Principal | null>;

  /** Pool を初期化します。既に初期化済みの場合は現在の Pool 設定を返します */
  initialize(
    input: MatchPoolInitializationOptions | MatchmakingPool,
  ): Promise<MatchmakingPool>;

  /** initialize() の意味を明示する別名 */
  initializePool(
    input: MatchPoolInitializationOptions | MatchmakingPool,
  ): Promise<MatchmakingPool>;

  /** 現在の Pool 設定を取得します */
  getPool(): Promise<MatchmakingPool | null>;

  /** 現在の検索ポリシーを取得します */
  getSearchPolicy(): Promise<NormalizedMatchmakingSearchPolicy | null>;

  /** 候補探索設定を永続化し、変更後の検索を直ちに起動します */
  configureSearchPolicy(
    searchPolicy: MatchmakingSearchPolicy,
  ): Promise<NormalizedMatchmakingSearchPolicy>;

  /** configureSearchPolicy() の意味を明示する別名 */
  configureMatchmakingSearch(
    searchPolicy: MatchmakingSearchPolicy,
  ): Promise<NormalizedMatchmakingSearchPolicy>;

  /** 現在のスナップショットを取得します */
  getSnapshot(): Promise<MatchPoolSnapshot | null>;

  /** 待機チケットの候補と品質説明を返します（状態変更なし） */
  searchCandidates(
    options?: MatchmakingSearchOptions,
  ): Promise<MatchmakingSearchResult>;

  /** 候補を決定論的に選び、選択済みチケットを原子的に `reserved` へ進めます */
  searchAndReserveCandidates(
    options?: MatchmakingSearchOptions,
  ): Promise<MatchmakingSearchResult>;

  /** searchCandidates() の意味を明示する別名 */
  findCandidates(
    options?: MatchmakingSearchOptions,
  ): Promise<MatchmakingSearchResult>;

  /** searchAndReserveCandidates() の意味を明示する別名 */
  findAndReserveCandidates(
    options?: MatchmakingSearchOptions,
  ): Promise<MatchmakingSearchResult>;

  /** 成立意図を取得します */
  getMatchIntent(
    matchIdOrCandidateId:
      | string
      | { readonly matchId?: string; readonly candidateId?: string },
  ): Promise<MatchmakingMatchIntent | null>;

  /** 未完了の成立意図を、Room 初期化とチケット確定まで進めます */
  processPendingMatches(
    options?: MatchmakingMatchProcessingOptions,
  ): Promise<readonly MatchmakingMatchIntent[]>;

  /** 成立処理を完了し、Room を初期化します */
  settleMatches(
    options: MatchmakingMatchProcessingOptions,
  ): Promise<readonly MatchmakingMatchResult[]>;

  /** マッチメイキング処理全体を実行します（内部用） */
  processMatchmaking(
    options: MatchmakingMatchProcessingOptions,
  ): Promise<readonly MatchmakingMatchResult[]>;

  /** チケットを作成します */
  createTicket(
    options: MatchmakingTicketCreationOptions,
  ): Promise<MatchmakingTicketRecord>;

  /** createTicket() の意味を明示する別名 */
  createMatchmakingTicket(
    options: MatchmakingTicketCreationOptions,
  ): Promise<MatchmakingTicketRecord>;

  /** チケットを取得します */
  getTicket(
    ticketIdOrOptions: string | { readonly ticketId: string },
  ): Promise<MatchmakingTicketRecord | null>;

  /** getTicket() の意味を明示する別名 */
  getMatchmakingTicket(
    ticketIdOrOptions: string | { readonly ticketId: string },
  ): Promise<MatchmakingTicketRecord | null>;

  /** 認証済み主体自身の有効チケットを返します */
  getTicketForPrincipal(options: {
    readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  }): Promise<MatchmakingTicketRecord | null>;

  /** getTicketForPrincipal() の意味を明示する別名 */
  getActiveTicket(options: {
    readonly gatewayPrincipal: GatewayPrincipalEnvelope;
  }): Promise<MatchmakingTicketRecord | null>;

  /** 待機中チケットをキャンセルします */
  cancelTicket(
    options: MatchmakingTicketCancellationOptions,
  ): Promise<MatchmakingTicketRecord>;

  /** cancelTicket() の意味を明示する別名 */
  cancelMatchmakingTicket(
    options: MatchmakingTicketCancellationOptions,
  ): Promise<MatchmakingTicketRecord>;

  /** 2 件の待機チケットを候補として原子的に確保します */
  reserveCandidate(
    options: MatchmakingTicketReservationOptions,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]>;

  /** reserveCandidate() の意味を明示する別名 */
  reserveTickets(
    options: MatchmakingTicketReservationOptions,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]>;

  /** 単一チケットを対象にした候補確保の別名です。候補の 1 件目を返します。 */
  reserveTicket(
    options: MatchmakingTicketReservationOptions,
  ): Promise<MatchmakingTicketRecord>;

  /** 予約済みの候補へ、呼び出し側が生成した成立結果を適用します。 */
  matchCandidate(
    options: MatchmakingTicketMatchOptions,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]>;

  /** matchCandidate() を複数適用します（内部用） */
  matchTickets(
    options: MatchmakingTicketMatchOptions,
  ): Promise<readonly [MatchmakingTicketRecord, MatchmakingTicketRecord]>;

  /** チケットを期限切れにします */
  expireTicket(options: {
    readonly ticketId: MatchmakingTicketId;
    readonly now?: number;
  }): Promise<MatchmakingTicketRecord>;

  /** 期限到達済みの待機チケットをまとめて期限切れへ遷移させます */
  expireDueTickets(now?: number): Promise<readonly MatchmakingTicketRecord[]>;

  /** 次回 Alarm 実行時刻を取得します */
  getNextAlarm(): Promise<number | null>;

  /** チケット状態イベントを取得します。主体は対象チケットの所有者に限ります。 */
  getTicketEvents(
    options: MatchmakingTicketEventQueryOptions,
  ): Promise<readonly MatchmakingTicketEvent[]>;

  /** チケットイベントを一覧します（エイリアス） */
  listTicketEvents(
    options: MatchmakingTicketEventQueryOptions,
  ): Promise<readonly MatchmakingTicketEvent[]>;

  // 型参照用
  readonly [Symbol.toStringTag]?: "IMatchPoolDurableObject";
}
