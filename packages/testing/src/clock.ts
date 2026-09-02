import type { Timestamp } from "@flarelobby/core";

/** 時刻を外部時計なしで読み取るための最小契約です。 */
export interface Clock {
  /** Unix epoch milliseconds を返します。 */
  now(): number;
  /** 現在時刻を ISO 8601 UTC 文字列で返します。 */
  nowTimestamp(): Timestamp;
}

/** シミュレーションから時刻を進められる時計の契約です。 */
export interface AdvancingClock extends Clock {
  /** 現在時刻から指定したミリ秒だけ進めます。 */
  advanceBy(milliseconds: number): number;
  /** 時計を指定時刻まで進めます。過去へは戻せません。 */
  advanceTo(value: number | Timestamp): number;
}

/**
 * 単調に進む仮想時計です。
 *
 * `Date.now()` を呼び出さないため、同じイベント列を同じ順序で処理できます。
 * 時刻の単位はすべて Unix epoch milliseconds です。
 */
export class VirtualClock implements AdvancingClock {
  private currentTimeMs: number;

  public constructor(initialTime: number | Timestamp = 0) {
    this.currentTimeMs = toEpochMilliseconds(initialTime);
  }

  public now(): number {
    return this.currentTimeMs;
  }

  public nowTimestamp(): Timestamp {
    return new Date(this.currentTimeMs).toISOString();
  }

  public advanceBy(milliseconds: number): number {
    if (!isNonNegativeSafeInteger(milliseconds)) {
      throw new RangeError(
        "仮想時計を進めるミリ秒は 0 以上の安全な整数で指定してください。",
      );
    }

    return this.advanceTo(addMilliseconds(this.currentTimeMs, milliseconds));
  }

  public advanceTo(value: number | Timestamp): number {
    const nextTimeMs = toEpochMilliseconds(value);

    if (nextTimeMs < this.currentTimeMs) {
      throw new RangeError("仮想時計を過去へ戻すことはできません。");
    }

    this.currentTimeMs = nextTimeMs;
    return this.currentTimeMs;
  }
}

/** 仮想時計を生成する関数形式のAPIです。 */
export function createVirtualClock(
  initialTime: number | Timestamp = 0,
): VirtualClock {
  return new VirtualClock(initialTime);
}

/** Unix epoch milliseconds または ISO 8601 UTC 文字列を数値へ変換します。 */
export function toEpochMilliseconds(value: number | Timestamp): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || !isValidDateMilliseconds(value)) {
      throw new RangeError(
        "時刻は有効な日付範囲内の安全な整数で指定してください。",
      );
    }

    return value;
  }

  if (typeof value !== "string") {
    throw new TypeError(
      "時刻は Unix epoch milliseconds または文字列で指定してください。",
    );
  }

  if (!value.endsWith("Z")) {
    throw new RangeError(
      "時刻の文字列は UTC を表す ISO 8601 形式（末尾が Z）で指定してください。",
    );
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed) || !isValidDateMilliseconds(parsed)) {
    throw new RangeError("時刻の ISO 8601 文字列が不正です。");
  }

  return parsed;
}

/** 安全なミリ秒加算を行います。 */
export function addMilliseconds(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    !isValidDateMilliseconds(left) ||
    !isNonNegativeSafeInteger(right) ||
    !isValidDateMilliseconds(left + right)
  ) {
    throw new RangeError("時刻の加算結果が有効な日付範囲を超えています。");
  }

  return left + right;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidDateMilliseconds(value: number): boolean {
  return Number.isFinite(new Date(value).getTime());
}
