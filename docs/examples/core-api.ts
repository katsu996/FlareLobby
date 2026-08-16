import {
  classifyEventRevision,
  decodeServerMessage,
  elo,
  getMatchmakingSearchWidth,
  normalizeMatchmakingSearchPolicy,
} from "@flarelobby/core";

const policy = normalizeMatchmakingSearchPolicy({
  stages: [
    { afterMs: 0, maxRatingDifference: 75 },
    { afterMs: 20_000, maxRatingDifference: 150 },
  ],
  maxRatingDifference: 150,
});

const width = getMatchmakingSearchWidth(policy, 20_000);
const calculation = elo().calculate({
  ratingA: 1_500,
  ratingB: 1_500,
  result: 1,
});
const revision = classifyEventRevision(7, 8);
const decoded = decodeServerMessage(
  JSON.stringify({
    protocolVersion: 1,
    kind: "event",
    event: "room.snapshot",
    revision: 8,
    payload: {},
  }),
  { knownEventTypes: ["room.snapshot"] },
);

void [width, calculation.updatedRatingA, revision, decoded.ok];
