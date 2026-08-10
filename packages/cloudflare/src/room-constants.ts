/** 終了済みルームを削除するまでの既定保持期間です。 */
export const DEFAULT_FINISHED_ROOM_RETENTION_MS = 24 * 60 * 60 * 1_000;

/** 再接続に利用できるトークンの既定有効期間です。 */
export const DEFAULT_RESUME_TOKEN_TTL_MS = 30 * 60 * 1_000;

/** 通信切断後に参加状態を保持する既定猶予期間です。 */
export const DEFAULT_DISCONNECT_GRACE_PERIOD_MS = 30 * 1_000;

/** Room に保持するイベント履歴の既定件数です。 */
export const DEFAULT_EVENT_HISTORY_LIMIT = 128;

/** 処理済みコマンド結果を保持する既定期間です。 */
export const DEFAULT_PROCESSED_COMMAND_RETENTION_MS = 10 * 60 * 1_000;
