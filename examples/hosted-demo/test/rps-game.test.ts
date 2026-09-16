import { describe, expect, it } from "vitest";

import {
  createRpsResultId,
  getRpsOutcome,
  isRatingResult,
  isRpsMove,
  resolveRpsResult,
} from "../src/rps-game.js";

describe("公開サンプルのじゃんけん判定", () => {
  it("全ての勝敗を A 側の ELO 結果へ変換する", () => {
    expect(resolveRpsResult("rock", "scissors")).toBe(1);
    expect(resolveRpsResult("paper", "rock")).toBe(1);
    expect(resolveRpsResult("scissors", "paper")).toBe(1);
    expect(resolveRpsResult("scissors", "rock")).toBe(0);
    expect(resolveRpsResult("rock", "paper")).toBe(0);
    expect(resolveRpsResult("paper", "scissors")).toBe(0);
    expect(resolveRpsResult("rock", "rock")).toBe(0.5);
    expect(resolveRpsResult("paper", "paper")).toBe(0.5);
    expect(resolveRpsResult("scissors", "scissors")).toBe(0.5);
  });

  it("スロットごとの表示用勝敗へ変換する", () => {
    expect(getRpsOutcome(1, "A")).toBe("win");
    expect(getRpsOutcome(1, "B")).toBe("lose");
    expect(getRpsOutcome(0, "A")).toBe("lose");
    expect(getRpsOutcome(0, "B")).toBe("win");
    expect(getRpsOutcome(0.5, "A")).toBe("draw");
    expect(getRpsOutcome(0.5, "B")).toBe("draw");
  });

  it("結果再送を収束させる識別子と入力検証を提供する", () => {
    expect(createRpsResultId("match-1")).toBe("hosted-rps-result:match-1");
    expect(isRpsMove("rock")).toBe(true);
    expect(isRpsMove("lizard")).toBe(false);
    expect(isRatingResult(1)).toBe(true);
    expect(isRatingResult(0.5)).toBe(true);
    expect(isRatingResult(0)).toBe(true);
    expect(isRatingResult(2)).toBe(false);
  });
});
