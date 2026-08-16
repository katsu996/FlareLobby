/** シードとして指定できる値です。 */
export type RandomSeed = number | string;

/** 固定乱数アルゴリズムの識別子です。結果の版を意図的に固定します。 */
export const SEEDED_RANDOM_ALGORITHM = "mulberry32-v1" as const;

/** シミュレーションへ注入できる乱数源です。 */
export interface RandomSource {
  readonly algorithm: string;
  next(): number;
  nextInt(maxExclusive: number): number;
  chance(probability: number): boolean;
}

/**
 * 版を固定した Mulberry32 乱数生成器です。
 *
 * シードの文字列表現を FNV-1a で 32 bit 状態へ変換し、実装を更新する場合は
 * `SEEDED_RANDOM_ALGORITHM` の値を変更します。これにより、過去の結果が暗黙に
 * 変化した場合でもシミュレーション結果の版を識別できます。
 */
export class SeededRandom implements RandomSource {
  public readonly algorithm = SEEDED_RANDOM_ALGORITHM;
  public readonly seed: RandomSeed;
  private state: number;

  public constructor(seed: RandomSeed) {
    assertSeed(seed);
    this.seed = seed;
    this.state = hashSeed(`${typeof seed}:${String(seed)}`);
  }

  /** [0, 1) の一様乱数を返します。 */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  }

  /** 0 以上 `maxExclusive` 未満の整数を返します。 */
  public nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(
        "乱数の上限は 1 以上の安全な整数で指定してください。",
      );
    }

    const sampleSpace = 0x1_0000_0000;
    const acceptedLimit = sampleSpace - (sampleSpace % maxExclusive);
    let sample: number;

    do {
      sample = Math.floor(this.next() * sampleSpace);
    } while (sample >= acceptedLimit);

    return sample % maxExclusive;
  }

  /** 指定確率で true を返します。確率 0 と 1 はそれぞれ常に false/true です。 */
  public chance(probability: number): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("乱数の確率は 0 以上 1 以下で指定してください。");
    }

    return this.next() < probability;
  }
}

/** 固定乱数生成器を生成する関数形式のAPIです。 */
export function createSeededRandom(seed: RandomSeed): SeededRandom {
  return new SeededRandom(seed);
}

function assertSeed(seed: RandomSeed): void {
  if (
    (typeof seed !== "number" && typeof seed !== "string") ||
    (typeof seed === "number" && !Number.isSafeInteger(seed)) ||
    (typeof seed === "string" && seed.length === 0)
  ) {
    throw new TypeError(
      "乱数種は空でない文字列または安全な整数で指定してください。",
    );
  }
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash | 0;
}
