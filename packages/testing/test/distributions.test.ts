import { describe, expect, it } from "vitest";
import {
  generateSimulationPlayers,
  normalizeNumericDistribution,
  normalizePlayerGenerationOptions,
  normalizeSimulationPlayers,
  normalizeTimestampDistribution,
  sampleNumericDistribution,
  sampleTimestampDistribution,
} from "../src/distributions.js";
import type { RandomSource } from "../src/random.js";

function stubRandomSource(next: () => number): RandomSource {
  return {
    algorithm: "stub",
    next,
    nextInt: (maxExclusive) => Math.floor(next() * maxExclusive),
    chance: (probability) => next() < probability,
  };
}

const random = stubRandomSource(() => 0.5);

describe("シミュレーション分布", () => {
  it("既定のプレイヤー生成設定を正規化して決定論的なプレイヤーを作る", () => {
    const options = normalizePlayerGenerationOptions({
      count: 2,
      idPrefix: "bot-",
      region: "us",
    });
    expect(options.count).toBe(2);
    expect(options.idPrefix).toBe("bot-");
    const players = generateSimulationPlayers(options, random);
    expect(players.map((player) => player.id)).toEqual([
      "bot-0001",
      "bot-0002",
    ]);
    expect(players.every((player) => player.region === "us")).toBe(true);
  });

  it("数値分布の固定値・一様分布・正規分布の境界を正規化してサンプリングする", () => {
    expect(normalizeNumericDistribution({ kind: "fixed", value: 12 })).toEqual({
      kind: "fixed",
      value: 12,
    });
    expect(
      sampleNumericDistribution({ kind: "fixed", value: 12 }, random),
    ).toBe(12);
    expect(
      sampleNumericDistribution({ kind: "uniform", min: 10, max: 20 }, random),
    ).toBe(15);
    expect(
      sampleNumericDistribution(
        { kind: "normal", mean: 50, standardDeviation: 0, min: 0, max: 40 },
        random,
      ),
    ).toBe(40);
  });

  it("数値分布の不正値を拒否する", () => {
    expect(() =>
      normalizeNumericDistribution({ kind: "uniform", min: 4, max: 3 }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeNumericDistribution({
        kind: "normal",
        mean: 1,
        standardDeviation: -1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeNumericDistribution({ kind: "fixed", value: Number.NaN }),
    ).toThrow(RangeError);
  });

  it("時刻分布を正規化し、両端を含む一様サンプリングを行う", () => {
    expect(
      normalizeTimestampDistribution({
        kind: "fixed",
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({ kind: "fixed", at: "2026-01-01T00:00:00.000Z" });
    expect(
      sampleTimestampDistribution(
        {
          kind: "uniform",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-01-01T00:00:00.002Z",
        },
        stubRandomSource(() => 0.999),
      ),
    ).toBe(Date.parse("2026-01-01T00:00:00.002Z"));
    expect(() =>
      normalizeTimestampDistribution({
        kind: "uniform",
        from: "2026-01-02T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(RangeError);
  });

  it("固定プレイヤーをID順に安定化し、重複IDを拒否する", () => {
    const players = normalizeSimulationPlayers([
      {
        id: "z",
        player: { id: "z" },
        rating: 1200,
        joinedAt: "2026-01-02T00:00:00.000Z",
        region: "jp",
        inputMethod: "pad",
      },
      {
        id: "a",
        player: { id: "a" },
        rating: 1500,
        joinedAt: "2026-01-01T00:00:00.000Z",
        region: "us",
        inputMethod: "mouse",
      },
    ]);
    expect(players.map((player) => player.id)).toEqual(["a", "z"]);
    expect(() =>
      normalizeSimulationPlayers([
        {
          id: "same",
          player: { id: "same" },
          rating: 1,
          joinedAt: "2026-01-01T00:00:00.000Z",
          region: "jp",
          inputMethod: "pad",
        },
        {
          id: "same",
          player: { id: "same" },
          rating: 2,
          joinedAt: "2026-01-01T00:00:00.000Z",
          region: "jp",
          inputMethod: "pad",
        },
      ]),
    ).toThrow(RangeError);
  });
});
describe("シミュレーション分布の追加境界", () => {
  it("生成設定の不正な個数・文字列を拒否する", () => {
    expect(normalizePlayerGenerationOptions({ count: 0 }).count).toBe(0);
    expect(() => normalizePlayerGenerationOptions({ idPrefix: "" })).toThrow(
      TypeError,
    );
    expect(() => normalizePlayerGenerationOptions("invalid" as never)).toThrow(
      TypeError,
    );
  });

  it("正規分布のBox-Muller経路を最小値と最大値へクランプする", () => {
    const high = sampleNumericDistribution(
      { kind: "normal", mean: 0, standardDeviation: 10, min: -1, max: 1 },
      stubRandomSource(
        (() => {
          const values = [Number.MIN_VALUE, 0];
          return () => values.shift() ?? 0;
        })(),
      ),
    );
    expect(high).toBe(1);
  });

  it("時刻分布と固定プレイヤーの不正な入力を拒否する", () => {
    expect(() =>
      normalizeTimestampDistribution({ kind: "other" } as never),
    ).toThrow(TypeError);
    expect(() =>
      normalizeSimulationPlayers([
        {
          id: "a",
          player: { id: "other" },
          rating: 1,
          joinedAt: "2026-01-01T00:00:00.000Z",
          region: "jp",
          inputMethod: "pad",
        },
      ]),
    ).toThrow(TypeError);
    expect(() =>
      normalizeSimulationPlayers([
        {
          id: "a",
          player: { id: "a" },
          rating: 1,
          joinedAt: "invalid",
          region: "jp",
          inputMethod: "pad",
        },
      ]),
    ).toThrow(RangeError);
  });
});
describe("シミュレーション分布の形式検証", () => {
  it("不正な分布形式と逆転した正規分布の範囲を拒否する", () => {
    expect(() => normalizeNumericDistribution(null as never)).toThrow(
      TypeError,
    );
    expect(() =>
      normalizeNumericDistribution({
        kind: "normal",
        mean: 0,
        standardDeviation: 1,
        min: 3,
        max: 2,
      }),
    ).toThrow(RangeError);
    expect(() => normalizeTimestampDistribution(null as never)).toThrow(
      TypeError,
    );
  });
});
describe("シミュレーション分布の残る入力検証", () => {
  it("固定プレイヤー配列と未知の数値分布を拒否する", () => {
    expect(() => normalizeSimulationPlayers("invalid" as never)).toThrow(
      TypeError,
    );
    expect(() => normalizeSimulationPlayers([null] as never)).toThrow(
      TypeError,
    );
    expect(() =>
      normalizeNumericDistribution({ kind: "other" } as never),
    ).toThrow(TypeError);
  });
});
describe("シミュレーションプレイヤー生成の境界", () => {
  it("負の生成件数と負の生成レーティングを拒否する", () => {
    expect(() => normalizePlayerGenerationOptions({ count: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      generateSimulationPlayers(
        { count: 1, rating: { kind: "fixed", value: -1 } },
        random,
      ),
    ).toThrow(RangeError);
  });
});
