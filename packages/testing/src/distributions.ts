import type { Player, Timestamp } from "@flarelobby/core";

import { toEpochMilliseconds } from "./clock.js";
import type { RandomSource } from "./random.js";

/** レーティングなどの数値を生成する分布です。 */
export type NumericDistribution =
  | {
      readonly kind: "fixed";
      readonly value: number;
    }
  | {
      readonly kind: "uniform";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "normal";
      readonly mean: number;
      readonly standardDeviation: number;
      readonly min?: number;
      readonly max?: number;
    };

/** 参加時刻を生成する分布です。範囲の端はミリ秒単位で含みます。 */
export type TimestampDistribution =
  | {
      readonly kind: "fixed";
      readonly at: number | Timestamp;
    }
  | {
      readonly kind: "uniform";
      readonly from: number | Timestamp;
      readonly to: number | Timestamp;
    };

/** シミュレーションへ投入するプレイヤーの生成設定です。 */
export interface PlayerGenerationOptions {
  /** 0 人も指定できます。省略時は 0 人です。 */
  readonly count?: number;
  /** 生成 ID の接頭辞です。省略時は `player-` です。 */
  readonly idPrefix?: string;
  /** 省略時は 1500 固定です。 */
  readonly rating?: NumericDistribution;
  /** 省略時は Unix epoch 0 固定です。 */
  readonly joinedAt?: TimestampDistribution;
  /** 省略時は `jp` です。 */
  readonly region?: string;
  /** 省略時は `keyboard_mouse` です。 */
  readonly inputMethod?: string;
}

/** 生成済みプレイヤーです。 */
export interface SimulationPlayer {
  readonly id: string;
  readonly player: Player;
  readonly rating: number;
  readonly joinedAt: Timestamp;
  readonly region: string;
  readonly inputMethod: string;
}

/** 既定値を適用したプレイヤー生成設定です。 */
export interface NormalizedPlayerGenerationOptions {
  readonly count: number;
  readonly idPrefix: string;
  readonly rating: NumericDistribution;
  readonly joinedAt: TimestampDistribution;
  readonly region: string;
  readonly inputMethod: string;
}

/** 生成設定を検証して既定値を適用します。 */
export function normalizePlayerGenerationOptions(
  input: PlayerGenerationOptions = {},
): NormalizedPlayerGenerationOptions {
  if (!isRecord(input)) {
    throw new TypeError("プレイヤー生成設定はオブジェクトで指定してください。");
  }

  const count = (input["count"] as number | undefined) ?? 0;
  if (!isNonNegativeSafeInteger(count)) {
    throw new RangeError(
      "生成するプレイヤー数は 0 以上の安全な整数で指定してください。",
    );
  }

  const idPrefix = (input["idPrefix"] as string | undefined) ?? "player-";
  const region = (input["region"] as string | undefined) ?? "jp";
  const inputMethod =
    (input["inputMethod"] as string | undefined) ?? "keyboard_mouse";

  assertNonEmptyString(idPrefix, "プレイヤー ID の接頭辞");
  assertNonEmptyString(region, "リージョン");
  assertNonEmptyString(inputMethod, "入力方式");

  const rating = normalizeNumericDistribution(
    (input["rating"] as NumericDistribution | undefined) ?? {
      kind: "fixed",
      value: 1_500,
    },
  );
  const joinedAt = normalizeTimestampDistribution(
    (input["joinedAt"] as TimestampDistribution | undefined) ?? {
      kind: "fixed",
      at: 0,
    },
  );

  return Object.freeze({
    count,
    idPrefix,
    rating,
    joinedAt,
    region,
    inputMethod,
  });
}

/** 指定分布からプレイヤーを決定論的に生成します。 */
export function generateSimulationPlayers(
  input: PlayerGenerationOptions = {},
  random: RandomSource,
): readonly SimulationPlayer[] {
  const options = normalizePlayerGenerationOptions(input);
  const players: SimulationPlayer[] = [];
  const playerIds = new Set<string>();

  for (let index = 0; index < options.count; index += 1) {
    const id = `${options.idPrefix}${String(index + 1).padStart(4, "0")}`;
    if (playerIds.has(id)) {
      throw new RangeError(`生成されたプレイヤー ID が重複しています: ${id}`);
    }

    const rating = sampleNumericDistribution(options.rating, random);
    if (!Number.isFinite(rating) || rating < 0) {
      throw new RangeError(
        "生成されたレーティングは 0 以上の有限値である必要があります。",
      );
    }

    const joinedAtMs = sampleTimestampDistribution(options.joinedAt, random);
    const player = Object.freeze({ id });
    players.push(
      Object.freeze({
        id,
        player,
        rating,
        joinedAt: new Date(joinedAtMs).toISOString(),
        region: options.region,
        inputMethod: options.inputMethod,
      }),
    );
    playerIds.add(id);
  }

  return Object.freeze(players);
}

/** 固定シナリオのプレイヤー配列を検証し、順序を安定化します。 */
export function normalizeSimulationPlayers(
  input: readonly SimulationPlayer[],
): readonly SimulationPlayer[] {
  if (!Array.isArray(input)) {
    throw new TypeError("固定プレイヤーは配列で指定してください。");
  }

  const playerIds = new Set<string>();
  const players = input.map((item) => {
    if (!isRecord(item)) {
      throw new TypeError("固定プレイヤーの形式が不正です。");
    }

    const id = item["id"];
    const player = item["player"];
    const rating = item["rating"];
    const joinedAt = item["joinedAt"];
    const region = item["region"];
    const inputMethod = item["inputMethod"];

    if (
      !isNonEmptyString(id) ||
      !isRecord(player) ||
      player["id"] !== id ||
      !isFiniteNonNegativeNumber(rating) ||
      !isTimestampValue(joinedAt) ||
      !isNonEmptyString(region) ||
      !isNonEmptyString(inputMethod)
    ) {
      throw new TypeError("固定プレイヤーの形式または値が不正です。");
    }

    if (playerIds.has(id)) {
      throw new RangeError(`固定プレイヤー ID が重複しています: ${id}`);
    }

    const joinedAtMs = toEpochMilliseconds(joinedAt);
    playerIds.add(id);
    return Object.freeze({
      id,
      player: Object.freeze({ id }),
      rating,
      joinedAt: new Date(joinedAtMs).toISOString(),
      region,
      inputMethod,
    });
  });

  players.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(players);
}

/** 数値分布を検証してコピーします。 */
export function normalizeNumericDistribution(
  input: NumericDistribution,
): NumericDistribution {
  if (!isRecord(input) || typeof input.kind !== "string") {
    throw new TypeError("数値分布の形式が不正です。");
  }

  if (input.kind === "fixed") {
    assertFiniteNumber(input.value, "固定値");
    return Object.freeze({ kind: "fixed", value: input.value });
  }

  if (input.kind === "uniform") {
    assertFiniteNumber(input.min, "一様分布の最小値");
    assertFiniteNumber(input.max, "一様分布の最大値");
    if (input.min > input.max) {
      throw new RangeError("一様分布の最小値は最大値以下で指定してください。");
    }

    return Object.freeze({
      kind: "uniform",
      min: input.min,
      max: input.max,
    });
  }

  if (input.kind === "normal") {
    assertFiniteNumber(input.mean, "正規分布の平均");
    assertFiniteNumber(input.standardDeviation, "正規分布の標準偏差");
    if (input.standardDeviation < 0) {
      throw new RangeError("正規分布の標準偏差は 0 以上で指定してください。");
    }

    const min = input.min;
    const max = input.max;
    if (min !== undefined) {
      assertFiniteNumber(min, "正規分布の最小値");
    }
    if (max !== undefined) {
      assertFiniteNumber(max, "正規分布の最大値");
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new RangeError("正規分布の最小値は最大値以下で指定してください。");
    }

    return Object.freeze({
      kind: "normal",
      mean: input.mean,
      standardDeviation: input.standardDeviation,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    });
  }

  throw new TypeError("対応していない数値分布です。");
}

/** 数値分布から 1 件の値を生成します。正規分布は Box-Muller-v1 です。 */
export function sampleNumericDistribution(
  input: NumericDistribution,
  random: RandomSource,
): number {
  const distribution = normalizeNumericDistribution(input);

  if (distribution.kind === "fixed") {
    return distribution.value;
  }

  if (distribution.kind === "uniform") {
    return (
      distribution.min + (distribution.max - distribution.min) * random.next()
    );
  }

  if (distribution.standardDeviation === 0) {
    return clamp(distribution.mean, distribution.min, distribution.max);
  }

  const first = Math.max(random.next(), Number.MIN_VALUE);
  const second = random.next();
  const standardNormal =
    Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  const value =
    distribution.mean + distribution.standardDeviation * standardNormal;

  return clamp(value, distribution.min, distribution.max);
}

/** 時刻分布を検証してコピーします。 */
export function normalizeTimestampDistribution(
  input: TimestampDistribution,
): TimestampDistribution {
  if (!isRecord(input) || typeof input.kind !== "string") {
    throw new TypeError("時刻分布の形式が不正です。");
  }

  if (input.kind === "fixed") {
    const at = toEpochMilliseconds(input.at);
    return Object.freeze({ at: new Date(at).toISOString(), kind: "fixed" });
  }

  if (input.kind === "uniform") {
    const from = toEpochMilliseconds(input.from);
    const to = toEpochMilliseconds(input.to);
    if (from > to) {
      throw new RangeError("時刻分布の from は to 以下で指定してください。");
    }

    return Object.freeze({
      kind: "uniform",
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
  }

  throw new TypeError("対応していない時刻分布です。");
}

/** 時刻分布からミリ秒単位の時刻を生成します。 */
export function sampleTimestampDistribution(
  input: TimestampDistribution,
  random: RandomSource,
): number {
  const distribution = normalizeTimestampDistribution(input);

  if (distribution.kind === "fixed") {
    return toEpochMilliseconds(distribution.at);
  }

  const from = toEpochMilliseconds(distribution.from);
  const to = toEpochMilliseconds(distribution.to);
  return from + Math.floor((to - from + 1) * random.next());
}

function clamp(
  value: number,
  min: number | undefined,
  max: number | undefined,
): number {
  const lowerBound = min === undefined ? value : Math.max(value, min);
  return max === undefined ? lowerBound : Math.min(lowerBound, max);
}

function assertFiniteNumber(
  value: unknown,
  name: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name}は有限の数値で指定してください。`);
  }
}

function assertNonEmptyString(
  value: unknown,
  name: string,
): asserts value is string {
  if (!isNonEmptyString(value)) {
    throw new TypeError(`${name}は空でない文字列で指定してください。`);
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestampValue(value: unknown): value is Timestamp {
  return typeof value === "string" && value.length > 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
