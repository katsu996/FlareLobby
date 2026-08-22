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

  it("rejects invalid random seeds", () => {
    for (const seed of ["", 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new SeededRandom(seed)).toThrow(TypeError);
    }
  });
});
