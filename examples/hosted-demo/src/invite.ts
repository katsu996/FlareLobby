/**
 * 招待リンク `/#invite=<code>` の検証と参加失敗の区分表示です。
 *
 * 認証 token / joinToken / resumeToken を URL へ載せません。招待コードは
 * 6 文字の英大文字・数字だけを受け付け、DOM へ表示するときは text として
 * 扱います（呼び出し側で `textContent` を使います）。
 */

export const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/u;

const INVITE_FRAGMENT_PATTERN = /^#invite=([A-Za-z0-9]+)$/u;

export type InviteJoinFailure =
  | "invalid"
  | "expired"
  | "full"
  | "finished"
  | "other";

export function isInviteCode(value: unknown): value is string {
  return typeof value === "string" && INVITE_CODE_PATTERN.test(value);
}

/**
 * location.hash から招待コードを取り出します。形式が正しいコードだけを
 * 返し、それ以外は null を返します。
 */
export function parseInviteCodeFromHash(hash: string): string | null {
  const match = INVITE_FRAGMENT_PATTERN.exec(hash.trim());
  if (match?.[1] === undefined) {
    return null;
  }

  const code = match[1].toUpperCase();
  return isInviteCode(code) ? code : null;
}

/** 自サイトの招待リンクを作ります。token 類は含めません。 */
export function buildInviteUrl(origin: string, code: string): string | null {
  if (!isInviteCode(code)) {
    return null;
  }

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = `invite=${code}`;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 招待参加の失敗を画面表示用の区分へ変換します。
 * 無効・期限切れ・満員・終了済みを区別し、詳細は通知文に載せません。
 */
export function classifyInviteJoinError(error: unknown): InviteJoinFailure {
  const code = (error as { readonly code?: unknown }).code;
  switch (code) {
    case "INVALID_PAYLOAD":
    case "NOT_FOUND":
      return "invalid";
    case "TIMEOUT":
    case "CANCELLED":
      return "expired";
    case "ROOM_FULL":
      return "full";
    case "ROOM_FINISHED":
      return "finished";
    default:
      return "other";
  }
}

const INVITE_FAILURE_MESSAGES: Readonly<Record<InviteJoinFailure, string>> = {
  invalid: "招待コードが無効です。リンクを作り直してもらってください。",
  expired: "招待リンクの有効期限が切れています。新しいリンクで試してください。",
  full: "ルームが満員です。ホストに空きの確認を依頼してください。",
  finished: "このルームの対戦は終了しています。新しいルームを作ってください。",
  other: "招待ルームへ参加できませんでした。時間をおいて試してください。",
};

export function describeInviteJoinFailure(kind: InviteJoinFailure): string {
  return INVITE_FAILURE_MESSAGES[kind];
}
