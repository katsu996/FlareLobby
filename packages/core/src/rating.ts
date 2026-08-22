/** レーティング計算における A 側の試合結果です。 */
export type RatingResult = 0 | 0.5 | 1;

/** 2 人のレーティング更新を計算する入力です。 */
export interface RatingCalculationInput {
  /** 対戦相手 A の試合前レーティングです。 */
  readonly ratingA: number;
  /** 対戦相手 B の試合前レーティングです。 */
  readonly ratingB: number;
  /** A 側の結果です。勝利は 1、引き分けは 0.5、敗北は 0 です。 */
  readonly result: RatingResult;
}

/** レーティングエンジンが返すアルゴリズム非依存の計算結果です。 */
export interface RatingCalculation extends RatingCalculationInput {
  /** A 側へ適用する整数差分です。 */
  readonly deltaA: number;
  /** B 側へ適用する整数差分です。`deltaA` と正負対称です。 */
  readonly deltaB: number;
  /** A 側の試合後レーティングです。 */
  readonly updatedRatingA: number;
  /** B 側の試合後レーティングです。 */
  readonly updatedRatingB: number;
}

/** レーティング計算を行う、アルゴリズム差し替え可能な最小契約です。 */
export interface RatingEngine<
  TCalculation extends RatingCalculation = RatingCalculation,
> {
  /** 新規プレイヤーへ適用する初期レーティングです。 */
  readonly initialRating: number;
  calculate(input: RatingCalculationInput): TCalculation;
}

/** ELO エンジンの設定です。 */
export interface EloOptions {
  /** 省略時は `1500` です。 */
  readonly initialRating?: number;
  /** 省略時は `24` です。 */
  readonly kFactor?: number;
}

/** ELO の既定初期レーティングです。 */
export const DEFAULT_ELO_INITIAL_RATING = 1_500;

/** ELO の既定 K 係数です。 */
export const DEFAULT_ELO_K_FACTOR = 24;

/** ELO の詳細な計算過程を含む結果です。 */
export interface EloCalculation extends RatingCalculation {
  /** A 側へ入力された結果を検証可能な形で返します。 */
  readonly scoreA: RatingResult;
  /** A 側の結果から導出した B 側の結果です。 */
  readonly scoreB: RatingResult;
  /** ELO 式で計算した A 側の期待勝率です。 */
  readonly expectedScoreA: number;
  /** A 側の期待勝率の補数である B 側の期待勝率です。 */
  readonly expectedScoreB: number;
  /** 丸める前の A 側の更新差分です。 */
  readonly rawDeltaA: number;
  /** この計算で使用した K 係数です。 */
  readonly kFactor: number;
}

/** ELO エンジンの公開契約です。 */
export interface EloEngine extends RatingEngine<EloCalculation> {
  readonly kFactor: number;
}

/**
 * 標準的な 1 対 1 ELO レーティングエンジンを作成します。
 *
 * ELO は入力値と設定値だけから計算されるため、時刻、乱数、外部状態へ
 * 依存しません。同じ入力に対して常に同じ結果を返します。
 */
export function elo(options: EloOptions = {}): EloEngine {
  const config = normalizeEloOptions(options);

  const engine: EloEngine = {
    initialRating: config.initialRating,
    kFactor: config.kFactor,
    calculate(input: RatingCalculationInput): EloCalculation {
      const normalizedInput = normalizeCalculationInput(input);
      const expectedScoreA = calculateExpectedScore(
        normalizedInput.ratingA,
        normalizedInput.ratingB,
      );
      const expectedScoreB = 1 - expectedScoreA;
      const rawDeltaA =
        config.kFactor * (normalizedInput.result - expectedScoreA);

      if (!Number.isFinite(rawDeltaA)) {
        throw new RangeError(
          "ELO の更新差分が有限の数値にならない入力または設定です。",
        );
      }

      const deltaA = roundDelta(rawDeltaA);
      const deltaB = deltaA === 0 ? 0 : -deltaA;
      const updatedRatingA = normalizedInput.ratingA + deltaA;
      const updatedRatingB = normalizedInput.ratingB + deltaB;

      if (
        !Number.isFinite(updatedRatingA) ||
        !Number.isFinite(updatedRatingB)
      ) {
        throw new RangeError(
          "ELO の更新後レーティングが有限の数値になりません。",
        );
      }

      return Object.freeze({
        ...normalizedInput,
        scoreA: normalizedInput.result,
        scoreB: toRatingResult(1 - normalizedInput.result),
        expectedScoreA,
        expectedScoreB,
        rawDeltaA,
        deltaA,
        deltaB,
        updatedRatingA,
        updatedRatingB,
        kFactor: config.kFactor,
      });
    },
  };

  return Object.freeze(engine);
}

function normalizeEloOptions(options: unknown): {
  readonly initialRating: number;
  readonly kFactor: number;
} {
  if (!isRecord(options)) {
    throw new TypeError("ELO の設定はオブジェクトで指定してください。");
  }

  for (const key of Object.keys(options)) {
    if (key !== "initialRating" && key !== "kFactor") {
      throw new TypeError(`ELO の設定項目を解釈できません: ${key}`);
    }
  }

  const initialRating = readOption(
    options,
    "initialRating",
    DEFAULT_ELO_INITIAL_RATING,
  );
  const kFactor = readOption(options, "kFactor", DEFAULT_ELO_K_FACTOR);

  if (!isFiniteNumber(initialRating) || initialRating < 0) {
    throw new RangeError(
      "初期レーティングは 0 以上の有限な数値で指定してください。",
    );
  }

  if (!isFiniteNumber(kFactor) || kFactor <= 0) {
    throw new RangeError("K 係数は 0 より大きい有限な数値で指定してください。");
  }

  return { initialRating, kFactor };
}

function normalizeCalculationInput(input: unknown): RatingCalculationInput {
  if (!isRecord(input)) {
    throw new TypeError(
      "レーティング計算の入力はオブジェクトで指定してください。",
    );
  }

  const ratingA = input["ratingA"];
  const ratingB = input["ratingB"];
  const result = input["result"];

  if (!isFiniteNumber(ratingA) || ratingA < 0) {
    throw new RangeError("ratingA は 0 以上の有限な数値で指定してください。");
  }

  if (!isFiniteNumber(ratingB) || ratingB < 0) {
    throw new RangeError("ratingB は 0 以上の有限な数値で指定してください。");
  }

  if (!isRatingResult(result)) {
    throw new RangeError(
      "result は勝利の 1、引き分けの 0.5、敗北の 0 のいずれかで指定してください。",
    );
  }

  return { ratingA, ratingB, result };
}

function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function roundDelta(rawDelta: number): number {
  const rounded =
    rawDelta < 0 ? Math.ceil(rawDelta - 0.5) : Math.floor(rawDelta + 0.5);

  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError("ELO の更新差分が安全な整数になりません。");
  }

  return Object.is(rounded, -0) ? 0 : rounded;
}

function toRatingResult(value: number): RatingResult {
  if (!isRatingResult(value)) {
    throw new Error("ELO の内部計算結果が不正です。");
  }

  return value;
}

function readOption(
  options: Record<string, unknown>,
  key: "initialRating" | "kFactor",
  defaultValue: number,
): number {
  if (!Object.prototype.hasOwnProperty.call(options, key)) {
    return defaultValue;
  }

  const value = options[key];

  if (typeof value !== "number") {
    throw new TypeError(`ELO の ${key} は数値で指定してください。`);
  }

  return value;
}

function isRatingResult(value: unknown): value is RatingResult {
  return value === 0 || value === 0.5 || value === 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
