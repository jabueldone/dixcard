/** Hardcoded game timings in milliseconds. Restart the server after changing these. */
export const GAME_TIMERS = {

  // Set either player-action limit to 0 to wait indefinitely.
  submissionTimeLimitMs: 60 * 1000,
  votingTimeLimitMs: 60 * 1000,
  scoringDurationMs: 60 * 1000,
  nextRoundDelayMs: 60 * 1000,

  gardenAnimation: {
    initialDelayMs: 650,
    stoneHopIntervalMs: 310,
    betweenPlayersDelayMs: 220,
    completionBufferMs: 200,
  },
} as const;