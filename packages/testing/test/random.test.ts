import { describe, expect, it, vi } from "vitest";
import {
  SEEDED_RANDOM_ALGORITHM,
  SeededRandom,
  createSeededRandom,
} from "../src/index.js";

describe("SeededRandom", () => {
  it("uses deterministic sequences and retains its public factory metadata", () => {
    const fromConstructor = new SeededRandom("deterministic-seed");
    const fromFactory = createSeededRandom("deterministic-seed");

    expect(fromFactory.algorithm).toBe(SEEDED_RANDOM_ALGORITHM);
    expect(fromFactory.seed).toBe("deterministic-seed");
    expect([
      fromConstructor.next(),
      fromConstructor.next(),
      fromConstructor.next(),
    ]).toEqual([fromFactory.next(), fromFactory.next(), fromFactory.next()]);
  });

  it("retries the rejected nextInt sample and returns a value in range", () => {
    const random = new SeededRandom(123);
    const next = vi.spyOn(random, "next");
    next
      .mockReturnValueOnce((0x1_0000_0000 - 1) / 0x1_0000_0000)
      .mockReturnValueOnce(0);

    expect(random.nextInt(3)).toBe(0);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("validates probabilities and integer upper bounds", () => {
    const random = new SeededRandom("bounds");

    expect(random.chance(0)).toBe(false);
    expect(random.chance(1)).toBe(true);
    for (const maxExclusive of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => random.nextInt(maxExclusive)).toThrow(RangeError);
    }
    for (const probability of [-0.01, 1.01, Number.NaN]) {
      expect(() => random.chance(probability)).toThrow(RangeError);
    }
  });

  it("rejects upper bounds above 2^32", () => {
    const random = new SeededRandom("bounds");

    expect(() => random.nextInt(0x1_0000_0000 + 1)).toThrow(RangeError);
    expect(random.nextInt(0x1_0000_0000)).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid random seeds", () => {
    for (const seed of ["", 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new SeededRandom(seed)).toThrow(TypeError);
    }
  });

  it("pins the mulberry32-v1 golden sequence (Issue #114)", () => {
    expect(SEEDED_RANDOM_ALGORITHM).toBe("mulberry32-v1");

    // 実装から逆算しない固定値。乱数実装を変更する場合は
    // SEEDED_RANDOM_ALGORITHM の更新が別途必要。
    const deterministic = new SeededRandom("deterministic-seed");
    expect([
      deterministic.next(),
      deterministic.next(),
      deterministic.next(),
      deterministic.next(),
      deterministic.next(),
    ]).toEqual([
      0.9180414152797312, 0.18349388660863042, 0.6602139296010137,
      0.7007444698829204, 0.14016548614017665,
    ]);

    const numeric = new SeededRandom(42);
    expect([
      numeric.next(),
      numeric.next(),
      numeric.next(),
      numeric.next(),
      numeric.next(),
    ]).toEqual([
      0.21143210493028164, 0.383213154040277, 0.6668457593768835,
      0.7374209396075457, 0.4332357682287693,
    ]);

    // 整数化の golden 値（各々 fresh インスタンスの初回呼び出し）。
    expect(new SeededRandom(42).nextInt(100)).toBe(76);
    expect(new SeededRandom(0).nextInt(100)).toBe(21);
    expect(new SeededRandom("deterministic-seed").nextInt(6)).toBe(3);

    // 同じ種は同じ列、異なる種は異なる列になる。
    const replay = new SeededRandom("deterministic-seed");
    expect([replay.next(), replay.next()]).toEqual([
      0.9180414152797312, 0.18349388660863042,
    ]);
    expect(new SeededRandom(43).next()).not.toBe(new SeededRandom(42).next());
  });
});
