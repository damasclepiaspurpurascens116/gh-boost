// run.js -- entry point

import moment            from "moment";
import { CONFIG }        from "./config.js";
import { buildAllDates } from "./profile.js";
import { git, runCommits, ensureContentFiles } from "./commits.js";
import { runGitHub, resolveRepo }              from "./github.js";

const args  = process.argv.slice(2);
const DRY   = args.includes("--dry");
const RESET = args.includes("--reset");
const NOGH  = args.includes("--no-gh");

// Validate config before doing anything
const validateConfig = () => {
  const { streak, eras, profile, github } = CONFIG;

  if (!Array.isArray(profile) || profile.length === 0)
    throw new Error("config.profile must be a non-empty array.");

  for (const p of profile) {
    if (typeof p.yearsAgo !== "number" || p.yearsAgo < 0)
      throw new Error(`config.profile entry has invalid yearsAgo: ${p.yearsAgo}`);
    if (!eras[p.era])
      throw new Error(`config.profile references unknown era "${p.era}". Valid: new, growing, active`);
  }

  if (streak.enabled) {
    if (!Number.isInteger(streak.days) || streak.days < 1)
      throw new Error(`config.streak.days must be a positive integer, got: ${streak.days}`);
    if (streak.days > 365)
      throw new Error(`config.streak.days (${streak.days}) exceeds one year. That would look very unnatural.`);
    if (!Number.isInteger(streak.maxPerDay) || streak.maxPerDay < 1)
      throw new Error(`config.streak.maxPerDay must be >= 1, got: ${streak.maxPerDay}`);
  }

  for (const [name, era] of Object.entries(eras)) {
    if (era.weekdayChance < 0 || era.weekdayChance > 1)
      throw new Error(`config.eras.${name}.weekdayChance must be between 0 and 1.`);
    const wSum = era.commitWeights.reduce((a, b) => a + b, 0);
    if (wSum < 0.99 || wSum > 1.01)
      throw new Error(`config.eras.${name}.commitWeights must sum to 1.0 (got ${wSum.toFixed(2)}).`);
  }

  // Validate weekend
  if (CONFIG.weekend.saturday < 0 || CONFIG.weekend.saturday > 1 ||
      CONFIG.weekend.sunday   < 0 || CONFIG.weekend.sunday   > 1)
    throw new Error("config.weekend values must be between 0 and 1.");

  // Validate hours
  const hw = CONFIG.hours;
  const hSum = hw.morning.weight + hw.afternoon.weight + hw.evening.weight;
  if (hSum < 0.99 || hSum > 1.01)
    throw new Error(`config.hours weights must sum to 1.0 (got ${hSum.toFixed(2)}).`);
  for (const [band, cfg] of Object.entries(hw)) {
    if (cfg.from >= cfg.to)
      throw new Error(`config.hours.${band}: 'from' (${cfg.from}) must be less than 'to' (${cfg.to}).`);
  }

  if (github?.enabled) {
    if (github.issueCount < 0 || github.prCount < 0)
      throw new Error("config.github.issueCount and prCount must be >= 0.");
    if ((github.apiDelayMs ?? 1200) < 800)
      throw new Error("config.github.apiDelayMs must be >= 800 to avoid rate limits.");
    if (github.issueCount > 30)
      console.warn(`  note: issueCount (${github.issueCount}) exceeds pool of 30 — will be capped.`);
    if (github.prCount > 10)
      console.warn(`  note: prCount (${github.prCount}) exceeds pool of 10 — will be capped.`);
  }

  // Duplicate yearsAgo produces double commits for the same year
  const yrs = profile.map(p => p.yearsAgo);
  if (new Set(yrs).size !== yrs.length)
    throw new Error("config.profile has duplicate yearsAgo values. Each year must appear only once.");
};

// Preflight: verify git and remote before starting a long run
const preflight = async () => {
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo)
    throw new Error("Not a git repository.\nRun: git init");

  const remotes = await git.getRemotes(true).catch(() => []);
  const origin  = remotes.find(r => r.name === "origin");
  if (!origin)
    throw new Error(
      "No git remote named 'origin'.\n" +
      "Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
    );

  if (!origin.refs.fetch.includes("github.com"))
    throw new Error(`Remote 'origin' does not point to GitHub: ${origin.refs.fetch}`);
};

// Print the plan before running
const banner = (entries) => {
  const yr     = moment().year();
  const byYr   = entries.reduce((a, e) => { a[e.year()] = (a[e.year()] || 0) + 1; return a; }, {});
  const labels = { new: "new", growing: "growing", active: "active" };

  console.log("\n  gh-boost  v3.0 -- GitHub Contribution Graph Optimizer\n");

  for (const { yearsAgo, era } of CONFIG.profile) {
    const y = yr - yearsAgo;
    console.log(`  ${y}  ${String(byYr[y] ?? 0).padStart(4)} commits   (${labels[era] ?? era})`);
  }

  if (CONFIG.streak.enabled) {
    const sEnd   = moment().subtract(1, "d");
    const sStart = sEnd.clone().subtract(CONFIG.streak.days - 1, "d");
    console.log(`\n  streak   ${CONFIG.streak.days} days   ${sStart.format("MMM D")} to ${sEnd.format("MMM D, YYYY")}`);
  }

  if (CONFIG.github?.enabled && !NOGH && (CONFIG.github.issueCount > 0 || CONFIG.github.prCount > 0))
    console.log(`  github   ${CONFIG.github.issueCount} issues, ${CONFIG.github.prCount} PRs`);
  else if (!CONFIG.github?.enabled || NOGH)
    console.log("  github   skipped");

  console.log(`\n  total    ${entries.length} commits`);

  if (DRY)   console.log("\n  (dry run -- nothing will be written)");
  if (RESET) console.log("  (reset -- history will be wiped first)");

  console.log();
};

// Wipe all git history and force-push a blank slate
const resetHistory = async () => {
  console.log("  wiping git history...");
  await git.raw(["checkout", "--orphan", "_reset"]);
  await git.raw(["rm", "-rf", "."]).catch(() => {});
  await git.commit("init", { "--allow-empty": null });
  await git.raw(["branch", "-D", "main"]).catch(() => {});
  await git.raw(["branch", "-m", "main"]);
  await git.push(["origin", "main", "--force"]);
  await git.push(["origin", "--delete", "_reset"]).catch(e =>
    console.warn(`  warning: could not delete _reset branch: ${e.message}`)
  );
  console.log("  history cleared.\n");
};

const run = async () => {
  validateConfig();
  await preflight();

  // --reset is not allowed in dry-run mode -- it would wipe real history
  if (RESET && !DRY) await resetHistory();
  else if (RESET && DRY) console.log("  note: --reset is ignored in dry-run mode.\n");

  ensureContentFiles();

  const entries = buildAllDates();
  banner(entries);

  if (DRY) {
    console.log("  dry run complete. re-run without --dry to apply.\n");
    return;
  }

  // Step 1 -- commits
  console.log("  committing...\n");
  await runCommits(entries);

  console.log("\n  pushing...");
  try {
    // Always specify remote and branch, and set upstream on the first push
    // so it works on a fresh clone where no upstream is set yet.
    const pushArgs = RESET
      ? ["origin", "main", "--force"]          // post-reset: remote has orphan history
      : ["origin", "main", "--set-upstream"];  // normal: set upstream if not set
    await git.push(pushArgs);
    console.log("  pushed.\n");
  } catch (err) {
    throw new Error(
      `Push failed: ${err.message}\n` +
      "  Check that your token or SSH key has push access to the remote."
    );
  }

  // Step 2 -- issues and PRs
  if (!NOGH && CONFIG.github?.enabled) await runGitHub();

  // Print final URL
  let username = process.env.GITHUB_OWNER;
  if (!username) {
    try { ({ owner: username } = await resolveRepo()); } catch (_) {}
  }

  console.log("  done.");
  if (username) console.log(`  https://github.com/${username}\n`);
  else          console.log("  check your GitHub profile.\n");
};

run().catch((e) => {
  console.error("\n  error:", e.message ?? e);
  process.exit(1);
});
