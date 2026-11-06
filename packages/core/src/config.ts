// Tunable defaults from the PRD. One file so they can change during the demo.
export const CONFIG = {
  THRESHOLD: 0.5, // a source type counts as "strong" at or above this score
  MIN_STRONG_TYPES: 2, // block needs this many strong, different source types
  REP_CAP: 100, // reputation at which a report reaches weight 1
  REPORT_EXPIRY_HOURS: 24,
  DEPOSIT_ETH: 0.01,

  // Arkiv entity lifetimes (see arkiv/schema.md). Arkiv counts lifetimes in 2-second blocks and
  // allows at most 7,884,000 blocks (about 182.5 days). Placeholders are marked "tune".
  VERDICT_REFRESH_HOURS: 6, // a source re-extends its verdict while the finding holds
  ATTESTATION_DAYS: 30,
  RULING_DAYS: 90,
  STAKE_DAYS: 30, // tune: "until resolved plus 7 days", set long and extended or left to lapse
  VOTE_DAYS: 7, // tune: "end of round plus grace"
  BOUNTY_DAYS: 60, // tune: "until claimed plus 30 days"
  SNAPSHOT_DAYS: 14, // tune: "keep the latest few"
  REPUTATION_DAYS: 14, // tune: lives with its snapshot
};
