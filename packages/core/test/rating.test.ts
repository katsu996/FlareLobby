import { describe, expect, it } from "vitest";

import {
  DEFAULT_ELO_INITIAL_RATING,
  DEFAULT_ELO_K_FACTOR,
  elo
} from "../src/index.js";
import type { EloOptions, RatingCalculationInput } from "../src/index.js";

describe("1 対 1 ELO レーティングエンジン", () => {
  it("既定値で同レートの勝敗を計算し、差分合計を 0 にする", () => {
    const engine = elo();
    const calculation = engine.calculate({
      ratingA: DEFAULT_ELO_INITIAL_RATING,
      ratingB: DEFAULT_ELO_INITIAL_RATING,
      result: 1
    });

    expect(engine.initialRating).toBe(DEFAULT_ELO_INITIAL_RATING);
    expect(engine.kFactor).toBe(DEFAULT_ELO_K_FACTOR);
    expect(calculation.expectedScoreA).toBe(0.5);
    expect(calculation.expectedScoreB).toBe(0.5);
    expect(calculation.rawDeltaA).toBe(12);
    expect(calculation.deltaA).toBe(12);
    expect(calculation.deltaB).toBe(-12);
    expect(calculation.updatedRatingA).toBe(1512);
    expect(calculation.updatedRatingB).toBe(1488);
    expect(calculation.deltaA + calculation.deltaB).toBe(0);
  });

  it("同レートの引き分けは両者のレートを変更しない", () => {
    const calculation = elo().calculate({
      ratingA: 1_500,
      ratingB: 1_500,
      result: 0.5
    });

    expect(calculation.scoreA).toBe(0.5);
    expect(calculation.scoreB).toBe(0.5);
    expect(calculation.deltaA).toBe(0);
    expect(calculation.deltaB).toBe(0);
    expect(calculation.updatedRatingA).toBe(1_500);
    expect(calculation.updatedRatingB).toBe(1_500);
  });

  it("格上への勝利は格下への勝利より大きな差分になる", () => {
    const upset = elo().calculate({
      ratingA: 1_200,
      ratingB: 1_500,
      result: 1
    });
    const expectedWin = elo().calculate({
      ratingA: 1_500,
      ratingB: 1_200,
      result: 1
    });

    expect(upset.deltaA).toBeGreaterThan(expectedWin.deltaA);
    expect(upset.expectedScoreA).toBeLessThan(0.5);
    expect(expectedWin.expectedScoreA).toBeGreaterThan(0.5);
  });

  it("設定した初期値と K 係数を反映する", () => {
    const engine = elo({ initialRating: 1_200, kFactor: 40 });
    const calculation = engine.calculate({
      ratingA: 1_200,
      ratingB: 1_200,
      result: 1
    });

    expect(engine.initialRating).toBe(1_200);
    expect(engine.kFactor).toBe(40);
    expect(calculation.deltaA).toBe(20);
    expect(calculation.updatedRatingA).toBe(1_220);
    expect(calculation.updatedRatingB).toBe(1_180);
  });

  it("敗北時も勝者と同じ整数差分の反対符号を適用する", () => {
    const engine = elo({ kFactor: 1 });
    const loss = engine.calculate({
      ratingA: 1_500,
      ratingB: 1_500,
      result: 0
    });

    expect(loss.deltaA).toBe(-1);
    expect(loss.deltaB).toBe(1);
    expect(loss.updatedRatingA).toBe(1_499);
    expect(loss.updatedRatingB).toBe(1_501);
    expect(loss.deltaA + loss.deltaB).toBe(0);
  });

  it("計算が決定論的で、極端なレート差でも有限値を返す", () => {
    const input = {
      ratingA: 0,
      ratingB: 4_000,
      result: 1
    } as const;
    const engine = elo();

    expect(engine.calculate(input)).toEqual(engine.calculate(input));
    expect(engine.calculate(input).expectedScoreA).toBeLessThan(0.001);
    expect(Number.isFinite(engine.calculate(input).updatedRatingA)).toBe(true);
    expect(Number.isFinite(engine.calculate(input).updatedRatingB)).toBe(true);
  });

  it("不正なレーティング、結果、設定を明示的に拒否する", () => {
    const engine = elo();

    expect(() =>
      engine.calculate({ ratingA: -1, ratingB: 1_500, result: 1 })
    ).toThrow("ratingA");
    expect(() =>
      engine.calculate({ ratingA: Number.NaN, ratingB: 1_500, result: 1 })
    ).toThrow("ratingA");
    expect(() =>
      engine.calculate({ ratingA: 1_500, ratingB: Number.POSITIVE_INFINITY, result: 1 })
    ).toThrow("ratingB");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: 1_500,
        result: 0.25 as RatingCalculationInput["result"]
      })
    ).toThrow("result");

    expect(() => elo({ initialRating: -1 })).toThrow("初期レーティング");
    expect(() => elo({ kFactor: 0 })).toThrow("K 係数");
    expect(() => elo({ kFactor: Number.NaN })).toThrow("K 係数");
    expect(() => elo(null as unknown as EloOptions)).toThrow("設定");
    expect(() => elo({ kFactor: "24" as unknown as number })).toThrow(
      "kFactor"
    );
  });
});
