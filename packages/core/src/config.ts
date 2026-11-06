// Tunable defaults from the PRD. One file so they can change during the demo.
export const CONFIG = {
  THRESHOLD: 0.5, // a source type counts as "strong" at or above this score
  MIN_STRONG_TYPES: 2, // block needs this many strong, different source types
  REP_CAP: 100, // reputation at which a report reaches weight 1
  REPORT_EXPIRY_HOURS: 24,
  DEPOSIT_ETH: 0.01,
};
