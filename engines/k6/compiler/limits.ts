/** Hard compiler bounds; generation sources also constrain structural collections and numbers. */
export const limits = Object.freeze({ durationMs: 86_400_000, graceMs: 3_600_000,
  executionMs: 172_800_000, rampStages: 128, inputBytes: 1_048_576 });
