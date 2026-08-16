import { describe, expect, it } from "vitest";

import {
  createRpsResultId,
  getRpsOutcome,
  resolveRpsResult,
} from "../src/rps-game.js";

describe("ローカルサンプルのじゃんけん判定", () => {
  it("全ての勝敗を A 側の ELO 結果へ変換する", () => {
    expect(resolveRpsResult("rock", "scissors")).toBe(1);
    expect(resolveRpsResult("paper", "rock")).toBe(1);
    expect(resolveRpsResult("scissors", "paper")).toBe(1);
    expect(resolveRpsResult("scissors", "rock")).toBe(0);
    expect(resolveRpsResult("rock", "paper")).toBe(0);
    expect(resolveRpsResult("paper", "scissors")).toBe(0);
    expect(resolveRpsResult("rock", "rock")).toBe(0.5);
  });

  it("B 側の表示結果を A 側から反転する", () => {
    expect(getRpsOutcome(1, "A")).toBe("win");
    expect(getRpsOutcome(1, "B")).toBe("lose");
    expect(getRpsOutcome(0, "A")).toBe("lose");
    expect(getRpsOutcome(0, "B")).toBe("win");
    expect(getRpsOutcome(0.5, "A")).toBe("draw");
    expect(getRpsOutcome(0.5, "B")).toBe("draw");
  });

  it("同じ Match から安定した結果識別子を作る", () => {
    expect(createRpsResultId("match_123")).toBe("demo-rps-result:match_123");
    expect(createRpsResultId("match_123")).toBe(createRpsResultId("match_123"));
  });
});
