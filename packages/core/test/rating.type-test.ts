import type {
  RatingCalculation,
  RatingCalculationInput,
  RatingEngine,
} from "../src/index.js";

const customEngine: RatingEngine = {
  initialRating: 1_000,
  calculate(input: RatingCalculationInput): RatingCalculation {
    return {
      ...input,
      deltaA: 0,
      deltaB: 0,
      updatedRatingA: input.ratingA,
      updatedRatingB: input.ratingB,
    };
  },
};

const calculation = customEngine.calculate({
  ratingA: 1_000,
  ratingB: 1_000,
  result: 0.5,
});

void calculation;
