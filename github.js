// github.js -- creates real issues and merged PRs via the GitHub API

import https      from "https";
import simpleGit  from "simple-git";
import random     from "random";
import { CONFIG } from "./config.js";

const git   = simpleGit();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fisher-Yates shuffle -- unbiased, unlike .sort(() => Math.random() - 0.5)
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Auto-detect owner and repo from git remote, or fall back to env vars
export const resolveRepo = async () => {
  let owner = process.env.GITHUB_OWNER;
  let repo  = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    const remotes = await git.getRemotes(true).catch(() => []);
    const origin  = remotes.find(r => r.name === "origin");
    if (origin) {
      const m = origin.refs.fetch.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (m) { owner = owner || m[1]; repo = repo || m[2]; }
    }
  }

  if (!owner || !repo)
    throw new Error(
      "Cannot detect GitHub owner/repo from remote.\n" +
      "  Fix: git remote set-url origin https://github.com/YOUR_USER/YOUR_REPO.git\n" +
      "  Or set GITHUB_OWNER and GITHUB_REPO environment variables."
    );

  return { owner, repo };
};

// GitHub REST API with automatic retry on rate limits
const api = async (method, path, body, token, retries = 3) => {
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com", path, method,
      headers: {
        "Authorization":        `Bearer ${token}`,
        "User-Agent":           "gh-boost/3.0",
        "Accept":               "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(payload ? {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(payload),
        } : {}),
      },
    }, (res) => {
      let raw = "";
      res.on("data", c => (raw += c));
      res.on("end", async () => {
        try {
          // 429 = primary rate limit. 403 can be secondary rate limit OR auth failure.
          // Only retry 403 if the body mentions rate limiting.
          const isRateLimit = res.statusCode === 429
            || (res.statusCode === 403 && (raw.includes("rate limit") || raw.includes("secondary")));

          if (isRateLimit && retries > 0) {
            const wait = (parseInt(res.headers["retry-after"] ?? "15", 10) + 1) * 1000;
            process.stdout.write(`\n  rate limited, waiting ${Math.round(wait / 1000)}s...\n`);
            await sleep(wait);
            api(method, path, body, token, retries - 1).then(resolve).catch(reject);
            return;
          }

          let parsed;
          try { parsed = JSON.parse(raw); }
          catch { return reject(new Error(`Parse error (${res.statusCode}): ${raw.slice(0, 120)}`)); }

          if (res.statusCode === 403)
            return reject(new Error(
              `GitHub API 403: token may be invalid or missing the 'repo' scope.\n  ${parsed.message ?? ""}`
            ));

          if (res.statusCode >= 400)
            return reject(new Error(
              `GitHub API ${res.statusCode} on ${method} ${path}: ${parsed.message ?? raw.slice(0, 120)}`
            ));

          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
};

// Issue and PR content
const ISSUES = [
  { title: "Add error handling for file write failures",                labels: ["bug", "reliability"], body: "The script silently ignores write errors on data.json. It should exit with a clear message if the write fails." },
  { title: "Support a dry-run flag to preview the commit schedule",     labels: ["enhancement"],        body: "A dry-run mode that prints planned dates and totals without touching the repo would be useful before a long run." },
  { title: "Add an inline progress counter for long runs",              labels: ["enhancement", "ux"],  body: "400+ sequential commits scroll the terminal endlessly. A single overwriting counter like [X/Y] would be far more readable." },
  { title: "Handle git push auth failures with a clear message",        labels: ["bug"],                body: "When push fails due to missing credentials the error is cryptic. Should detect auth issues and print the exact fix command." },
  { title: "Make streak length configurable",                           labels: ["enhancement"],        body: "Exposing streak.days in config.js would make the tool more flexible for different use cases." },
  { title: "Add a reset flag for clean history regeneration",           labels: ["enhancement"],        body: "Running the script twice doubles all commits. An orphan-branch reset flow lets users start from a clean slate." },
  { title: "Expand the commit message pool",                            labels: ["enhancement"],        body: "The message pool cycles visibly on shorter date ranges. Growing to 80-100 entries would reduce visible repetition." },
  { title: "Preflight check: verify remote is reachable before starting", labels: ["reliability"],      body: "The script should confirm the remote exists and accepts pushes before generating hundreds of commits." },
  { title: "Saturday commit rate is unrealistically high",              labels: ["enhancement"],        body: "Real developers commit on Saturdays much less than weekdays. 10-15% would look more natural." },
  { title: "Add resume support for interrupted runs",                   labels: ["enhancement"],        body: "Interrupted runs have no recovery path. A --resume flag that continues from the last committed date would help." },
  { title: "Weight December and January gap probability higher",        labels: ["enhancement"],        body: "Real developers take holidays in December and January. The gap generator should account for this." },
  { title: "Extract file paths to a shared constants block",            labels: ["refactor"],           body: "File paths like ./content/notes.md appear in multiple files. A single export avoids drift." },
  { title: "GITHUB_TOKEN setup instructions are hard to find",          labels: ["docs"],               body: "New users struggle to create a token with the right scope. The README should link directly to the token page." },
  { title: "Orphan branch stays visible on remote after reset",         labels: ["bug"],                body: "The _reset branch is visible on GitHub after a reset run. It should be deleted after force-pushing main." },
  { title: "Add tests for streak and blackout date logic",              labels: ["testing"],            body: "Core date generation has no tests. Streak protection and blackout invariants should be validated." },
  { title: "Support a custom commit message pool via config",           labels: ["enhancement"],        body: "Allow config.messages to override the built-in pool so users can match messages to their own projects." },
  { title: "Show per-year commit breakdown in the summary",             labels: ["ux"],                 body: "The final output shows only a total. A per-year line would make it easier to verify the profile looks right." },
  { title: "Add a GitHub Actions daily cron for automatic streak upkeep", labels: ["enhancement"],      body: "A scheduled workflow running the script daily would maintain the streak without manual work." },
  { title: "Rate limit retry is missing from the API wrapper",          labels: ["reliability"],        body: "The API wrapper does not handle 429 or secondary rate limit 403 responses. High issue counts can hit limits silently." },
  { title: "Allow disabling issues and PRs independently in config",    labels: ["enhancement"],        body: "A single github.enabled flag is too coarse. Users may want commits without PRs, or issues without commits." },
  { title: "Add a seed flag for reproducible date generation",          labels: ["enhancement"],        body: "A --seed flag making the RNG deterministic would help debug edge cases and make demos repeatable." },
  { title: "Improve the error message when git remote is missing",      labels: ["ux"],                 body: "The current error when origin is not set is unclear. Should print the exact git remote command to fix it." },
  { title: "Add CHANGELOG.md to track version history",                 labels: ["docs"],               body: "There is no changelog. Users upgrading from older versions have no way to see what changed." },
  { title: "Make content file mutations pluggable",                     labels: ["enhancement"],        body: "Mutators in commits.js are hardcoded. A config.mutate hook would let advanced users customise what changes per commit." },
  { title: "Cache progress.json in memory to avoid per-commit reads",   labels: ["refactor"],           body: "progress.json is read from disk on every commit. Caching it in memory would eliminate hundreds of redundant reads." },
  { title: "Accept explicit year numbers in the profile config",        labels: ["enhancement"],        body: "yearsAgo is opaque. Accepting { year: 2024 } directly would be clearer and less error-prone for most users." },
  { title: "Add .editorconfig to enforce consistent formatting",        labels: ["chore"],              body: "Without .editorconfig, contributors can introduce inconsistent indentation and line endings." },
  { title: "PR branch names are obviously synthetic",                   labels: ["enhancement"],        body: "All PR branches use the fix/ prefix. Using varied prefixes matching the PR title would look more realistic." },
  { title: "Validate config values before starting a run",              labels: ["reliability"],        body: "Invalid values like streak.days = -1 or commitWeights summing to more than 1 produce garbage output with no warning." },
  { title: "Today commit is always at midnight",                        labels: ["bug"],                body: "The today commit is always stamped at 00:00. It should use the working hours model like every other commit." },
];

const PRS = [
  { title: "feat: inline progress counter and dry-run flag",            prefix: "feat",    body: "Replaces scrolling output with a single overwriting counter. Adds --dry to preview the schedule without committing." },
  { title: "fix: surface file write and push errors clearly",           prefix: "fix",     body: "Wraps file mutations and git operations in try/catch blocks. Prints actionable fix commands for auth and remote errors." },
  { title: "refactor: centralise file paths in a PATHS export",         prefix: "refactor",body: "Extracts all ./content/* path strings into a single PATHS object, imported wherever needed." },
  { title: "feat: reset flag with remote orphan branch cleanup",        prefix: "feat",    body: "Adds orphan-branch reset flow. Deletes the _reset branch from remote after force-pushing main." },
  { title: "fix: reinitialise content files at the start of each run",  prefix: "fix",     body: "Truncates notes.md and snippets.js before each run to prevent unbounded growth." },
  { title: "feat: custom commit message pool via config.messages",      prefix: "feat",    body: "Falls back to the built-in pool when config.messages is unset. Allows per-project message customisation." },
  { title: "docs: rewrite README with copy-paste setup commands",       prefix: "docs",    body: "Rewrites setup as numbered steps with copy-paste commands. Adds direct token link and scope instructions." },
  { title: "fix: delete orphan branch from remote after reset",         prefix: "fix",     body: "Adds git push origin --delete _reset after force-pushing main to avoid remote clutter." },
  { title: "feat: GitHub Actions daily cron for automatic streak",      prefix: "feat",    body: "Adds .github/workflows/daily.yml with a cron trigger to keep the streak alive automatically." },
  { title: "feat: 429 and 403 retry with Retry-After in the API layer", prefix: "feat",    body: "Reads Retry-After on 429 and secondary-rate-limit 403 responses, sleeps, then retries up to 3 times." },
];

const LABELS = [
  { name: "bug",         color: "d73a4a", description: "Something is broken"          },
  { name: "enhancement", color: "a2eeef", description: "New feature or improvement"   },
  { name: "docs",        color: "0075ca", description: "Documentation changes"        },
  { name: "chore",       color: "e4e669", description: "Maintenance and housekeeping" },
  { name: "refactor",    color: "cfd3d7", description: "Code restructuring"           },
  { name: "reliability", color: "f9d0c4", description: "Stability and error handling" },
  { name: "ux",          color: "bfd4f2", description: "User experience"              },
  { name: "testing",     color: "c5def5", description: "Tests and coverage"           },
];

export const runGitHub = async () => {
  const cfg = CONFIG.github;
  if (!cfg?.enabled || (cfg.issueCount === 0 && cfg.prCount === 0)) {
    console.log("  github step skipped.\n");
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log(
      "\n  GITHUB_TOKEN is not set -- skipping issues and PRs.\n\n" +
      "  To enable, set the token before running:\n\n" +
      "    PowerShell :  $env:GITHUB_TOKEN=\"ghp_your_token\"\n" +
      "    CMD        :  set GITHUB_TOKEN=ghp_your_token\n" +
      "    Mac/Linux  :  export GITHUB_TOKEN=ghp_your_token\n\n" +
      "  Create a token at: https://github.com/settings/tokens (repo scope)\n"
    );
    return;
  }

  let owner, repo;
  try { ({ owner, repo } = await resolveRepo()); }
  catch (e) { console.log(`\n  ${e.message}\n`); return; }

  const delay      = Math.max(cfg.apiDelayMs ?? 1200, 800);
  const issueCount = Math.min(cfg.issueCount, ISSUES.length);
  const prCount    = Math.min(cfg.prCount,    PRS.length);

  console.log(`\n  ${owner}/${repo} -- ${issueCount} issues, ${prCount} PRs\n`);

  // Create labels (ignore failures -- they likely already exist)
  process.stdout.write("  setting up labels... ");
  let labelWarning = false;
  for (const lbl of LABELS) {
    const result = await api("POST", `/repos/${owner}/${repo}/labels`, lbl, token).catch(e => e);
    if (result instanceof Error && !result.message.includes("already_exists") && !result.message.includes("422"))
      labelWarning = true;
    await sleep(300);
  }
  console.log(labelWarning ? "done (some labels may not have the right token scope)" : "done");

  // Open issues
  const issuePool    = shuffle(ISSUES).slice(0, issueCount);
  const issueNumbers = [];

  if (issueCount > 0) {
    console.log(`\n  opening ${issueCount} issues...`);
    for (const tpl of issuePool) {
      try {
        const r = await api("POST", `/repos/${owner}/${repo}/issues`,
          { title: tpl.title, body: tpl.body, labels: tpl.labels }, token);
        issueNumbers.push(r.number);
        process.stdout.write(
          `\r    [${issueNumbers.length}/${issueCount}]  #${String(r.number).padEnd(4)} ${tpl.title.slice(0, 55).padEnd(55)}`
        );
      } catch (e) {
        console.log(`\n    issue failed: ${e.message}`);
      }
      await sleep(delay);
    }
    console.log(`\n  ${issueNumbers.length} issues opened\n`);
  }

  // Open and merge PRs
  if (prCount === 0) { console.log("  github step complete.\n"); return; }

  let defaultBranch, baseSha;
  try {
    const rd  = await api("GET", `/repos/${owner}/${repo}`, null, token);
    defaultBranch = rd.default_branch ?? "main";
    const ref = await api("GET", `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, null, token);
    baseSha   = ref.object.sha;
  } catch (e) {
    console.log(`  cannot read repo info: ${e.message}\n`);
    return;
  }

  const prPool     = shuffle(PRS).slice(0, prCount);
  let   issueIdx   = 0;
  let   mergedCount = 0;

  console.log(`  opening and merging ${prCount} PRs...`);

  for (let p = 0; p < prPool.length; p++) {
    const tpl    = prPool[p];
    const branch = `${tpl.prefix}/gh-boost-${p + 1}`;

    // Attach 2-3 closing references if issues are available
    const closing    = issueNumbers.slice(issueIdx, issueIdx + random.int(2, 3));
    issueIdx        += closing.length;
    const closingRef = closing.length > 0
      ? "\n\n" + closing.map(n => `Closes #${n}`).join("\n")
      : "";
    const body = tpl.body + closingRef;

    try {
      await api("POST", `/repos/${owner}/${repo}/git/refs`,
        { ref: `refs/heads/${branch}`, sha: baseSha }, token);
      await sleep(delay);

      const pr = await api("POST", `/repos/${owner}/${repo}/pulls`,
        { title: tpl.title, body, head: branch, base: defaultBranch }, token);
      await sleep(delay);

      // Merge -- don't throw on failure, just note it
      const merged = await api("PUT", `/repos/${owner}/${repo}/pulls/${pr.number}/merge`,
        { merge_method: "squash" }, token).catch(e => e);

      if (!(merged instanceof Error)) {
        mergedCount++;
        // Refresh baseSha after merge -- abort remaining PRs if this fails
        // to avoid creating branches from a stale commit
        const updated = await api("GET",
          `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, null, token).catch(() => null);
        if (updated) {
          baseSha = updated.object.sha;
        } else {
          console.log(`\n  warning: could not refresh base SHA after PR #${pr.number}. Stopping PR creation.`);
          break;
        }
      }

      process.stdout.write(
        `\r    [${p + 1}/${prPool.length}]  #${String(pr.number).padEnd(4)} ${tpl.title.slice(0, 52).padEnd(52)}`
      );
    } catch (e) {
      console.log(`\n    PR ${p + 1} failed: ${e.message}`);
    }

    await sleep(delay * 2);
  }

  console.log(`\n  ${mergedCount} of ${prPool.length} PRs merged\n`);

  // Close any issues that weren't referenced by a PR
  const leftover = issueNumbers.slice(issueIdx);
  if (leftover.length > 0) {
    process.stdout.write(`  closing ${leftover.length} remaining issues...`);
    for (const n of leftover) {
      await api("PATCH", `/repos/${owner}/${repo}/issues/${n}`, { state: "closed" }, token).catch(() => {});
      await sleep(delay);
    }
    console.log(" done\n");
  }

  console.log("  github step complete.\n");
};
