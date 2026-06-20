// ════════════════════════════════════════════════════════
//  gh-boost  ·  config.js
//  ──────────────────────────────────────────────────────
//  The ONLY file you need to edit.
//  Everything else is engine code — leave it alone.
// ════════════════════════════════════════════════════════

export const CONFIG = {

  // ── Profile story ──────────────────────────────────
  //  One entry per year on your graph.
  //  era: "new" | "growing" | "active"
  //    "new"     → sparse start, ramps up mid-year
  //    "growing" → consistent weekdays, vacation gaps
  //    "active"  → most weekdays covered, strong streak
  profile: [
    { yearsAgo: 2, era: "new"     },
    { yearsAgo: 1, era: "growing" },
    { yearsAgo: 0, era: "active"  },  // fills up to today automatically
  ],

  // ── Streak ─────────────────────────────────────────
  //  Consecutive days with no gap, ending yesterday.
  streak: {
    enabled:   true,
    days:      103,   // exact consecutive day count
    maxPerDay: 2,     // 1 or 2 commits per streak day
  },

  // ── Era settings ───────────────────────────────────
  //  weekdayChance    → probability a weekday gets any commit
  //  commitWeights    → [p(1 commit), p(2 commits), p(3 commits)]
  //  earlyMonths      → first N months are extra sparse (new era only)
  //  earlyMonthChance → commit chance in those early months
  eras: {
    new: {
      weekdayChance:    0.48,
      commitWeights:    [0.85, 0.15, 0.00],
      earlyMonths:      3,
      earlyMonthChance: 0.07,
    },
    growing: {
      weekdayChance: 0.66,
      commitWeights: [0.65, 0.30, 0.05],
    },
    active: {
      weekdayChance: 0.80,
      commitWeights: [0.50, 0.37, 0.13],
    },
  },

  // ── Weekend activity ───────────────────────────────
  weekend: {
    saturday: 0.15,   // 15% of Saturdays get 1 commit
    sunday:   0.04,   //  4% of Sundays   get 1 commit
  },

  // ── Natural gaps ───────────────────────────────────
  //  Gaps are calendar-aware — placed where real devs take breaks:
  //    • Late Dec + first days of Jan  (winter holidays)
  //    • 2–3 weeks in Jul–Aug          (summer break)
  //    • 1 week in Mar–Apr             (spring trip)
  //    • 1 week in Sep–Oct             (autumn — 70% chance)
  //    • 2–3 random short breaks       (sick days / life)
  //
  //  Activity clusters into 2–6 day "focus runs" with 1–3 day rests,
  //  and each month gets a density weight (Jan/Dec quiet, Apr/May peak).
  //  All tuned automatically — no params to change here.

  // ── Working hours ──────────────────────────────────
  //  Commits only happen inside this window (24h).
  hours: {
    morning:   { from:  9, to: 13, weight: 0.25 },
    afternoon: { from: 13, to: 19, weight: 0.45 },
    evening:   { from: 19, to: 22, weight: 0.30 },
  },

  // ── GitHub Issues & PRs ────────────────────────────
  //  Creates real issues and merged PRs via the GitHub API.
  //  Both count as contributions on your profile graph.
  //
  //  Requires GITHUB_TOKEN env var with `repo` scope.
  //  Owner/repo are auto-detected from git remote origin.
  github: {
    enabled:    true,
    issueCount: 30,       // issues to open
    prCount:    10,       // PRs to open and merge (each closes 2–3 issues)
    apiDelayMs: 1200,     // ms between API calls — don't go below 800
  },

};
