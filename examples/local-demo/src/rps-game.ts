import type { RatingResult } from "@flarelobby/core";

/** サンプルで利用するじゃんけんの手です。 */
export const RPS_MOVES = Object.freeze(["rock", "paper", "scissors"] as const);

export type RpsMove = (typeof RPS_MOVES)[number];

export type RpsOutcome = "win" | "draw" | "lose";

const RPS_RESULT_ID_PREFIX = "demo-rps-result:";

/** じゃんけんの勝敗を A 側の得点（1 / 0.5 / 0）で返します。 */
export function resolveRpsResult(moveA: RpsMove, moveB: RpsMove): RatingResult {
  if (moveA === moveB) {
    return 0.5;
  }

  return (moveA === "rock" && moveB === "scissors") ||
    (moveA === "paper" && moveB === "rock") ||
    (moveA === "scissors" && moveB === "paper")
    ? 1
    : 0;
}

/** A 側の結果を指定したスロットから見た表示用の勝敗へ変換します。 */
export function getRpsOutcome(
  result: RatingResult,
  slot: "A" | "B",
): RpsOutcome {
  if (result === 0.5) {
    return "draw";
  }

  const won = slot === "A" ? result === 1 : result === 0;
  return won ? "win" : "lose";
}

/** 同じ Match の結果再送を一つの結果行へ収束させる識別子です。 */
export function createRpsResultId(matchId: string): string {
  return `${RPS_RESULT_ID_PREFIX}${matchId}`;
}

export function isRpsMove(value: unknown): value is RpsMove {
  return (
    typeof value === "string" &&
    (RPS_MOVES as readonly string[]).includes(value)
  );
}

export function isRatingResult(value: unknown): value is RatingResult {
  return value === 0 || value === 0.5 || value === 1;
}
