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
  /** B 側へ適用する整数差分です。ELO では `deltaA` と正負対称で、Glicko-2 では各側の不確実性に応じて独立に決まります。 */
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

/** Glicko-2 エンジンの設定です。 */
export interface Glicko2Options {
  /** 省略時は `1500` です。 */
  readonly initialRating?: number;
  /** 初期レーティング偏差（RD）です。省略時は `350` です。 */
  readonly initialRatingDeviation?: number;
  /** システム定数です。レーティング変動の大きさを制御します。省略時は `0.5` です。 */
  readonly tau?: number;
  /** 初期ボラティリティ（σ）です。省略時は `0.06` です。 */
  readonly volatility?: number;
}

/** Glicko-2 の既定初期レーティングです。 */
export const DEFAULT_GLICKO2_INITIAL_RATING = 1_500;

/** Glicko-2 の既定初期レーティング偏差（RD）です。 */
export const DEFAULT_GLICKO2_INITIAL_RATING_DEVIATION = 350;

/** Glicko-2 の既定システム定数です。 */
export const DEFAULT_GLICKO2_TAU = 0.5;

/** Glicko-2 の既定初期ボラティリティです。 */
export const DEFAULT_GLICKO2_VOLATILITY = 0.06;

/** Glicko-2 の計算で使う Glickman スケールの定数（1 グロスター）です。 */
const GLICKO2_SCALE = 173.71779769170146;

/**
 * Glicko-2 の 1 試合計算入力です。各側の試合前 RD を指定できます。
 * 省略時は設定済みの `initialRatingDeviation` を使います。
 */
export interface Glicko2CalculationInput extends RatingCalculationInput {
  /** A 側の試合前レーティング偏差（RD）です。 */
  readonly deviationA?: number;
  /** B 側の試合前レーティング偏差（RD）です。 */
  readonly deviationB?: number;
}

/** Glicko-2 の詳細な計算過程を含む結果です。 */
export interface Glicko2Calculation extends RatingCalculation {
  /** A 側へ入力された結果を検証可能な形で返します。 */
  readonly scoreA: RatingResult;
  /** A 側の結果から導出した B 側の結果です。 */
  readonly scoreB: RatingResult;
  /** A 側視点の期待勝率です。 */
  readonly expectedScoreA: number;
  /** B 側視点の期待勝率です。 */
  readonly expectedScoreB: number;
  /** A 側の丸める前の更新差分です。 */
  readonly rawDeltaA: number;
  /** B 側の丸める前の更新差分です。 */
  readonly rawDeltaB: number;
  /** A 側の試合前 RD です。 */
  readonly deviationA: number;
  /** B 側の試合前 RD です。 */
  readonly deviationB: number;
  /** A 側の試合後 RD です。 */
  readonly updatedDeviationA: number;
  /** B 側の試合後 RD です。 */
  readonly updatedDeviationB: number;
  /** A 側の試合後ボラティリティです。 */
  readonly updatedVolatilityA: number;
  /** B 側の試合後ボラティリティです。 */
  readonly updatedVolatilityB: number;
  /** この計算で使用したシステム定数です。 */
  readonly tau: number;
}

/** Glicko-2 エンジンの公開契約です。 */
export interface Glicko2Engine extends RatingEngine<Glicko2Calculation> {
  calculate(input: Glicko2CalculationInput): Glicko2Calculation;
  /** 新規プレイヤーへ適用する初期 RD です。 */
  readonly initialRatingDeviation: number;
  readonly tau: number;
  readonly volatility: number;
}

/**
 * Glicko-2（RD とボラティリティ付き）の 1 対 1 レーティングエンジンを作成します。
 *
 * 時刻、乱数、外部状態へ依存せず、同じ入力に対して常に同じ結果を返します。
 * 各側の新レートは相手の状態を用いた Glicko-2 式で独立に求め、丸めは ELO と
 * 同じ「0.5 はゼロから遠い方向」規則を使います。
 */
export function glicko2(options: Glicko2Options = {}): Glicko2Engine {
  const config = normalizeGlicko2Options(options);

  const engine: Glicko2Engine = {
    initialRating: config.initialRating,
    initialRatingDeviation: config.initialRatingDeviation,
    tau: config.tau,
    volatility: config.volatility,
    calculate(input: Glicko2CalculationInput): Glicko2Calculation {
      const normalizedInput = normalizeGlicko2CalculationInput(input, config);

      const updateA = applyGlicko2Update(
        normalizedInput.ratingA,
        normalizedInput.deviationA,
        config.volatility,
        normalizedInput.ratingB,
        normalizedInput.deviationB,
        normalizedInput.result,
        config.tau,
      );
      const updateB = applyGlicko2Update(
        normalizedInput.ratingB,
        normalizedInput.deviationB,
        config.volatility,
        normalizedInput.ratingA,
        normalizedInput.deviationA,
        toRatingResult(1 - normalizedInput.result),
        config.tau,
      );

      const deltaA = roundDelta(updateA.rawDelta);
      const deltaB = roundDelta(updateB.rawDelta);
      const updatedRatingA = normalizedInput.ratingA + deltaA;
      const updatedRatingB = normalizedInput.ratingB + deltaB;

      if (
        !Number.isFinite(updatedRatingA) ||
        !Number.isFinite(updatedRatingB)
      ) {
        throw new RangeError(
          "Glicko-2 の更新後レーティングが有限の数値になりません。",
        );
      }

      return Object.freeze({
        ratingA: normalizedInput.ratingA,
        ratingB: normalizedInput.ratingB,
        result: normalizedInput.result,
        scoreA: normalizedInput.result,
        scoreB: toRatingResult(1 - normalizedInput.result),
        expectedScoreA: updateA.expectedScore,
        expectedScoreB: updateB.expectedScore,
        rawDeltaA: updateA.rawDelta,
        rawDeltaB: updateB.rawDelta,
        deviationA: normalizedInput.deviationA,
        deviationB: normalizedInput.deviationB,
        updatedDeviationA: updateA.updatedDeviation,
        updatedDeviationB: updateB.updatedDeviation,
        updatedVolatilityA: updateA.updatedVolatility,
        updatedVolatilityB: updateB.updatedVolatility,
        deltaA,
        deltaB,
        updatedRatingA,
        updatedRatingB,
        tau: config.tau,
      });
    },
  };

  return Object.freeze(engine);
}

interface NormalizedGlicko2Options {
  readonly initialRating: number;
  readonly initialRatingDeviation: number;
  readonly tau: number;
  readonly volatility: number;
}

function normalizeGlicko2Options(options: unknown): NormalizedGlicko2Options {
  if (!isRecord(options)) {
    throw new TypeError("Glicko-2 の設定はオブジェクトで指定してください。");
  }

  for (const key of Object.keys(options)) {
    if (
      key !== "initialRating" &&
      key !== "initialRatingDeviation" &&
      key !== "tau" &&
      key !== "volatility"
    ) {
      throw new TypeError(`Glicko-2 の設定項目を解釈できません: ${key}`);
    }
  }

  const initialRating = readOption(
    options,
    "initialRating",
    DEFAULT_GLICKO2_INITIAL_RATING,
  );
  const initialRatingDeviation = readOption(
    options,
    "initialRatingDeviation",
    DEFAULT_GLICKO2_INITIAL_RATING_DEVIATION,
  );
  const tau = readOption(options, "tau", DEFAULT_GLICKO2_TAU);
  const volatility = readOption(
    options,
    "volatility",
    DEFAULT_GLICKO2_VOLATILITY,
  );

  if (!isFiniteNumber(initialRating) || initialRating < 0) {
    throw new RangeError(
      "初期レーティングは 0 以上の有限な数値で指定してください。",
    );
  }

  if (!isFiniteNumber(initialRatingDeviation) || initialRatingDeviation <= 0) {
    throw new RangeError(
      "初期レーティング偏差は 0 より大きい有限な数値で指定してください。",
    );
  }

  if (!isFiniteNumber(tau) || tau <= 0) {
    throw new RangeError("tau は 0 より大きい有限な数値で指定してください。");
  }

  if (!isFiniteNumber(volatility) || volatility <= 0) {
    throw new RangeError(
      "volatility は 0 より大きい有限な数値で指定してください。",
    );
  }

  return { initialRating, initialRatingDeviation, tau, volatility };
}

function normalizeGlicko2CalculationInput(
  input: unknown,
  config: NormalizedGlicko2Options,
): {
  ratingA: number;
  ratingB: number;
  result: RatingResult;
  deviationA: number;
  deviationB: number;
} {
  const base = normalizeCalculationInput(input);

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key !== "ratingA" &&
      key !== "ratingB" &&
      key !== "result" &&
      key !== "deviationA" &&
      key !== "deviationB"
    ) {
      throw new TypeError(`Glicko-2 の計算入力を解釈できません: ${key}`);
    }
  }

  const deviationA = readDeviation(record["deviationA"], config, "deviationA");
  const deviationB = readDeviation(record["deviationB"], config, "deviationB");

  return { ...base, deviationA, deviationB };
}

function readDeviation(
  value: unknown,
  config: NormalizedGlicko2Options,
  key: string,
): number {
  if (value === undefined) {
    return config.initialRatingDeviation;
  }

  if (!isFiniteNumber(value) || value < 0) {
    throw new RangeError(`${key} は 0 以上の有限な数値で指定してください。`);
  }

  return value;
}

interface Glicko2SideUpdate {
  readonly rawDelta: number;
  readonly expectedScore: number;
  readonly updatedDeviation: number;
  readonly updatedVolatility: number;
}

/** 片側のプレイヤーを相手の状態で更新する Glicko-2 単一試合計算です。 */
function applyGlicko2Update(
  rating: number,
  deviation: number,
  volatility: number,
  opponentRating: number,
  opponentDeviation: number,
  score: RatingResult,
  tau: number,
): Glicko2SideUpdate {
  const mu = (rating - 1_500) / GLICKO2_SCALE;
  const phi = deviation / GLICKO2_SCALE;
  const opponentMu = (opponentRating - 1_500) / GLICKO2_SCALE;
  const opponentPhi = opponentDeviation / GLICKO2_SCALE;

  const gFactor = glicko2G(opponentPhi);
  const expectedScore = 1 / (1 + Math.exp(-gFactor * (mu - opponentMu)));
  const variance =
    1 / (gFactor * gFactor * expectedScore * (1 - expectedScore));
  const delta = variance * gFactor * (score - expectedScore);

  const updatedVolatility = computeGlicko2Volatility(
    Math.log(volatility * volatility),
    delta * delta,
    phi * phi,
    variance,
    tau,
  );

  const prePhi = Math.sqrt(phi * phi + updatedVolatility * updatedVolatility);
  const updatedPhi = 1 / Math.sqrt(1 / (prePhi * prePhi) + 1 / variance);
  const updatedMu =
    mu + updatedPhi * updatedPhi * gFactor * (score - expectedScore);

  const rawDelta = GLICKO2_SCALE * updatedMu - (rating - 1_500);

  if (!Number.isFinite(rawDelta)) {
    throw new RangeError(
      "Glicko-2 の更新差分が有限の数値にならない入力または設定です。",
    );
  }

  return {
    rawDelta,
    expectedScore,
    updatedDeviation: GLICKO2_SCALE * updatedPhi,
    updatedVolatility,
  };
}

function glicko2G(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/**
 * Glickman 論文ステップ 5 の Illinois 法によるボラティリティ推定です。
 * 収束判定には論文例と同じ epsilon = 0.000001 を使います。
 */
function computeGlicko2Volatility(
  logVolatilitySquared: number,
  deltaSquared: number,
  phiSquared: number,
  variance: number,
  tau: number,
): number {
  const epsilon = 0.000001;

  const f = (x: number): number => {
    const expX = Math.exp(x);
    return (
      (expX * (deltaSquared - phiSquared - variance - expX)) /
        (2 * (phiSquared + variance + expX) ** 2) -
      (x - logVolatilitySquared) / (tau * tau)
    );
  };

  let a = logVolatilitySquared;
  let b: number;
  if (deltaSquared > phiSquared + variance) {
    b = Math.log(deltaSquared - phiSquared - variance);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    b = a - k * tau;
  }

  let fA = f(a);
  let fB = f(b);

  while (Math.abs(b - a) > epsilon) {
    const c = a + ((a - b) * fA) / (fB - fA);
    const fC = f(c);

    if (fC * fB <= 0) {
      a = b;
      fA = fB;
    } else {
      fA /= 2;
    }

    b = c;
    fB = fC;
  }

  return Math.exp(a / 2);
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
  key: string,
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
