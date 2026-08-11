export {
  VirtualClock,
  addMilliseconds,
  createVirtualClock,
  toEpochMilliseconds
} from "./clock.js";
export type { AdvancingClock, Clock } from "./clock.js";
export {
  SEEDED_RANDOM_ALGORITHM,
  SeededRandom,
  createSeededRandom
} from "./random.js";
export type { RandomSeed, RandomSource } from "./random.js";
export {
  generateSimulationPlayers,
  normalizeNumericDistribution,
  normalizePlayerGenerationOptions,
  normalizeSimulationPlayers,
  normalizeTimestampDistribution,
  sampleNumericDistribution,
  sampleTimestampDistribution
} from "./distributions.js";
export type {
  NormalizedPlayerGenerationOptions,
  NumericDistribution,
  PlayerGenerationOptions,
  SimulationPlayer,
  TimestampDistribution
} from "./distributions.js";
export {
  compareSearchPolicies,
  replaySimulation,
  simulateMatchmaking,
  DEFAULT_SIMULATION_DURATION_MS,
  DEFAULT_SIMULATION_POOL,
  DEFAULT_SIMULATION_TICK_MS,
  MAX_SIMULATION_EVENT_COUNT
} from "./simulator.js";
export type {
  MatchmakingSimulationConfig,
  MatchmakingSimulationReplayConfig,
  MatchmakingSimulationResult,
  NormalizedSimulationCancellationPolicy,
  SimulationCancellationPolicy,
  SimulationDependencies,
  SimulationEvent,
  SimulationEventType,
  SimulationMatchResult,
  SimulationPolicyComparison,
  SimulationPolicyDefinition,
  SimulationPolicyRun,
  SimulationReplay,
  SimulationStatistics,
  SimulationTicketResult,
  SimulationTicketStatus,
  DistributionStatistics
} from "./simulator.js";
export {
  formatSimulationOutput,
  serializeSimulationResult,
  summarizeSimulation
} from "./report.js";
export type { SimulationOutput } from "./report.js";
