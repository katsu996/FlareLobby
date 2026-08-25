import { describe, expect, it } from "vitest";

import {
  DEFAULT_ELO_INITIAL_RATING,
  DEFAULT_ELO_K_FACTOR,
  DEFAULT_GLICKO2_INITIAL_RATING,
  DEFAULT_GLICKO2_INITIAL_RATING_DEVIATION,
  DEFAULT_GLICKO2_TAU,
  DEFAULT_GLICKO2_VOLATILITY,
  elo,
  glicko2,
} from "../src/index.js";
import type {
  EloOptions,
  Glicko2Options,
  RatingCalculationInput,
  RatingResult,
} from "../src/index.js";

describe("1 対 1 ELO レーティングエンジン", () => {
  it("既定値で同レートの勝敗を計算し、差分合計を 0 にする", () => {
    const engine = elo();
    const calculation = engine.calculate({
      ratingA: DEFAULT_ELO_INITIAL_RATING,
      ratingB: DEFAULT_ELO_INITIAL_RATING,
      result: 1,
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
      result: 0.5,
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
      result: 1,
    });
    const expectedWin = elo().calculate({
      ratingA: 1_500,
      ratingB: 1_200,
      result: 1,
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
      result: 1,
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
      result: 0,
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
      result: 1,
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
      engine.calculate({ ratingA: -1, ratingB: 1_500, result: 1 }),
    ).toThrow("ratingA");
    expect(() =>
      engine.calculate({ ratingA: Number.NaN, ratingB: 1_500, result: 1 }),
    ).toThrow("ratingA");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: Number.POSITIVE_INFINITY,
        result: 1,
      }),
    ).toThrow("ratingB");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: 1_500,
        result: 0.25 as RatingCalculationInput["result"],
      }),
    ).toThrow("result");

    expect(() => elo({ initialRating: -1 })).toThrow("初期レーティング");
    expect(() => elo({ kFactor: 0 })).toThrow("K 係数");
    expect(() => elo({ kFactor: Number.NaN })).toThrow("K 係数");
    expect(() => elo(null as unknown as EloOptions)).toThrow("設定");
    expect(() => elo({ kFactor: "24" as unknown as number })).toThrow(
      "kFactor",
    );
  });
});

describe("1 対 1 Glicko-2 レーティングエンジン", () => {
  it("既定値を公開し、RD を縮めながら勝敗を反映する", () => {
    const engine = glicko2();

    expect(engine.initialRating).toBe(DEFAULT_GLICKO2_INITIAL_RATING);
    expect(engine.initialRatingDeviation).toBe(
      DEFAULT_GLICKO2_INITIAL_RATING_DEVIATION,
    );
    expect(engine.tau).toBe(DEFAULT_GLICKO2_TAU);
    expect(engine.volatility).toBe(DEFAULT_GLICKO2_VOLATILITY);

    const calculation = engine.calculate({
      ratingA: 1_500,
      ratingB: 1_500,
      result: 0.5,
    });

    // 引き分けで同条件ならレートは動かず、RD だけが縮む。
    expect(calculation.updatedRatingA).toBe(1_500);
    expect(calculation.updatedRatingB).toBe(1_500);
    expect(calculation.deltaA).toBe(0);
    expect(calculation.deltaB).toBe(0);
    expect(calculation.expectedScoreA).toBeCloseTo(0.5, 12);
    expect(calculation.expectedScoreB).toBeCloseTo(0.5, 12);
    expect(calculation.updatedDeviationA).toBeCloseTo(290.319, 4);
    expect(calculation.updatedDeviationB).toBeCloseTo(290.319, 4);
    expect(calculation.deviationA).toBe(350);
    expect(calculation.deviationB).toBe(350);
  });

  it("高 RD の敗者と低 RD の勝者の更新を既知値どおりに計算する", () => {
    // 独立実装（glicko2 npm 0.10.0）で確認した参照値を使う。
    const loss = glicko2().calculate({
      ratingA: 1_500,
      deviationA: 200,
      ratingB: 1_400,
      deviationB: 30,
      result: 0,
    });

    expect(loss.expectedScoreA).toBeCloseTo(0.63947, 5);
    expect(loss.rawDeltaA).toBeCloseTo(-112.74236, 4);
    expect(loss.deltaA).toBe(-113);
    expect(loss.updatedRatingA).toBe(1_387);
    expect(loss.updatedDeviationA).toBeCloseTo(175.4027, 4);
    expect(loss.updatedVolatilityA).toBeCloseTo(0.06000085, 8);
    expect(loss.deltaB).toBe(3);
    expect(loss.updatedRatingB).toBe(1_403);
    expect(loss.updatedDeviationB).toBeCloseTo(31.6703, 4);
  });

  it("入力を入れ替えると各側の更新が対応関係になる", () => {
    const engine = glicko2();
    const forward = engine.calculate({
      ratingA: 1_550,
      deviationA: 50,
      ratingB: 1_700,
      deviationB: 300,
      result: 1,
    });
    const backward = engine.calculate({
      ratingA: 1_700,
      deviationA: 300,
      ratingB: 1_550,
      deviationB: 50,
      result: 0,
    });

    // A/B 入れ替えでは rawDelta も入れ替わる。
    expect(backward.rawDeltaB).toBeCloseTo(forward.rawDeltaA, 12);
    expect(backward.rawDeltaA).toBeCloseTo(forward.rawDeltaB, 12);
    expect(backward.updatedDeviationB).toBeCloseTo(
      forward.updatedDeviationA,
      12,
    );
    expect(backward.updatedDeviationA).toBeCloseTo(
      forward.updatedDeviationB,
      12,
    );
    expect(forward.deltaA).toBe(7);
    expect(forward.deltaB).toBe(-223);
    // Glicko-2 では両側の差分合計は 0 にならない。
    expect(forward.deltaA + forward.deltaB).not.toBe(0);
  });

  it("連戦で RD が単調に縮小し、結果を状態へ反映できる", () => {
    const engine = glicko2({
      initialRating: 1_500,
      initialRatingDeviation: 350,
    });
    let rating = engine.initialRating;
    let deviation = engine.initialRatingDeviation;
    const deviations: number[] = [deviation];

    for (let game = 0; game < 5; game += 1) {
      const calculation = engine.calculate({
        ratingA: rating,
        deviationA: deviation,
        ratingB: 1_500,
        deviationB: 350,
        result: 1,
      });
      rating = calculation.updatedRatingA;
      deviation = calculation.updatedDeviationA;
      deviations.push(deviation);
    }

    for (let index = 1; index < deviations.length; index += 1) {
      expect(deviations[index]!).toBeLessThan(deviations[index - 1]!);
    }
    expect(rating).toBeGreaterThan(engine.initialRating);
  });

  it("設定した初期 RD・tau・volatility を公開する", () => {
    const engine = glicko2({
      initialRating: 1_200,
      initialRatingDeviation: 270,
      tau: 0.9,
      volatility: 0.05,
    });

    expect(engine.initialRatingDeviation).toBe(270);
    expect(engine.tau).toBe(0.9);
    expect(engine.volatility).toBe(0.05);

    const calculation = engine.calculate({
      ratingA: 1_200,
      ratingB: 1_200,
      result: 0.5,
    });
    expect(calculation.deviationA).toBe(270);
    expect(calculation.tau).toBe(0.9);
  });

  it("不正なレーティング、RD、設定を明示的に拒否する", () => {
    const engine = glicko2();

    expect(() =>
      engine.calculate({ ratingA: -1, ratingB: 1_500, result: 1 }),
    ).toThrow("ratingA");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: 1_500,
        result: -1 as RatingResult,
        deviationA: 200,
      }),
    ).toThrow("result");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: 1_500,
        result: 1,
        deviationA: -1,
      }),
    ).toThrow("deviationA");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: 1_500,
        result: 1,
        deviationA: Number.NaN,
      } as RatingCalculationInput & { deviationA?: number }),
    ).toThrow("deviationA");
    expect(() =>
      engine.calculate({
        ratingA: 1_500,
        ratingB: 1_500,
        result: 1,
        extra: 1,
      } as RatingCalculationInput),
    ).toThrow("解釈できません");

    expect(() => glicko2({ initialRatingDeviation: 0 })).toThrow(
      "初期レーティング偏差",
    );
    expect(() => glicko2({ tau: 0 })).toThrow("tau");
    expect(() => glicko2({ volatility: 0 })).toThrow("volatility");
    expect(() => glicko2({ kFactor: 24 } as unknown as Glicko2Options)).toThrow(
      "解釈できません",
    );
    expect(() => glicko2(null as unknown as Glicko2Options)).toThrow("設定");
  });
});
