import type { MatchmakingSimulationResult } from "./simulator.js";

/** JSON と人が読める要約を同時に取得する結果です。 */
export interface SimulationOutput {
  readonly json: string;
  readonly summary: string;
}

/** シミュレーション結果を再現可能な整形済み JSON へ変換します。 */
export function serializeSimulationResult(
  result: MatchmakingSimulationResult
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** シミュレーション結果を日本語の短い要約へ変換します。 */
export function summarizeSimulation(
  result: MatchmakingSimulationResult
): string {
  const statistics = result.statistics;
  const wait = statistics.waitTimeMs;
  const rating = statistics.ratingDifference;
  const unmatchedPercent = formatNumber(statistics.unmatchedRate * 100, 2);

  return [
    "FlareLobby マッチングシミュレーション",
    `乱数種: ${String(result.seed)} (${result.randomAlgorithm})`,
    `プレイヤー: ${statistics.generatedPlayerCount}人、参加: ${statistics.joinedTicketCount}件`,
    `成立: ${statistics.matchCount}試合 / ${statistics.matchedTicketCount}チケット`,
    `未成立: ${statistics.unmatchedTicketCount}件 (${unmatchedPercent}%)`,
    `待機時間(ms): 平均 ${formatMetric(wait.average)} / p50 ${formatMetric(wait.p50)} / p95 ${formatMetric(wait.p95)} / p99 ${formatMetric(wait.p99)}`,
    `成立時レート差: 平均 ${formatMetric(rating.average)} / p50 ${formatMetric(rating.p50)} / p95 ${formatMetric(rating.p95)}`,
    `状態内訳: 待機 ${statistics.waitingTicketCount}、キャンセル ${statistics.cancelledTicketCount}、期限切れ ${statistics.expiredTicketCount}、未参加 ${statistics.notJoinedPlayerCount}`
  ].join("\n");
}

/** JSON と人が読める要約をまとめて出力します。 */
export function formatSimulationOutput(
  result: MatchmakingSimulationResult
): SimulationOutput {
  return Object.freeze({
    json: serializeSimulationResult(result),
    summary: summarizeSimulation(result)
  });
}

function formatMetric(value: number | null): string {
  return value === null ? "-" : formatNumber(value, 3);
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace(/\.?0+$/, "");
}
