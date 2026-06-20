// commits.js -- file mutation + git engine

import jsonfile  from "jsonfile";
import moment    from "moment";
import simpleGit from "simple-git";
import fs        from "fs";

export const git = simpleGit();

// File paths -- single source of truth
export const PATHS = {
  data:     "./data.json",
  notes:    "./content/notes.md",
  progress: "./content/progress.json",
  snippets: "./content/snippets.js",
};

// Module state
let sessionCount   = 0;
let snippetVersion = 0;   // starts at 0 so first append uses index 0
let commitIdx      = 0;
let progressCache  = null;

// Commit message pool -- shuffled once at startup so cycling isn't visible
const MESSAGE_POOL = [
  "fix: edge case in groupBy with null keys",
  "refactor: simplify utility helpers",
  "chore: update dev notes",
  "feat: add parseQuery helper",
  "docs: update progress log",
  "fix: throttle not resetting correctly",
  "refactor: flatten deepClone logic",
  "chore: clean up dead code",
  "fix: capitalize fails on empty string",
  "feat: add randomHex color generator",
  "docs: add usage examples to notes",
  "refactor: consolidate sleep helper",
  "fix: debounce timer leak",
  "chore: update session count",
  "feat: add flatDeep utility",
  "fix: parseQuery drops duplicate keys",
  "refactor: extract constants",
  "chore: minor formatting fixes",
  "docs: clarify throttle vs debounce",
  "fix: groupBy mutates source array",
  "feat: export all helpers from index",
  "chore: log milestone reached",
  "fix: randomHex missing padding",
  "refactor: async sleep returns promise",
  "docs: update dev log entry",
  "chore: bump session tracker",
  "fix: deepClone drops undefined values",
  "refactor: unify error handling",
  "feat: add capitalize edge case handling",
  "chore: sync progress file",
  "fix: retry not awaiting async fn",
  "feat: add memoize with cache expiry",
  "refactor: pipe uses reduceRight",
  "fix: chunk off-by-one on last slice",
  "docs: add examples for omit and pick",
  "feat: clamp helper for number ranges",
  "chore: remove unused imports",
  "fix: once helper leaks closure ref",
  "refactor: move helpers to separate files",
  "docs: add jsdoc to all exports",
  "feat: add toTitleCase helper",
  "fix: unique drops falsy values",
  "refactor: use optional chaining in pick",
  "docs: expand README with examples",
  "fix: pipe breaks on single function",
  "feat: add range helper",
  "chore: run formatter",
  "fix: memoize cache never expires",
  "refactor: rename internal vars for clarity",
  "feat: add zip utility function",
  "fix: flatten does not handle sparse arrays",
  "refactor: group related helpers by category",
  "chore: update jsdoc return types",
  "feat: add identity and noop helpers",
  "fix: clamp does not handle NaN input",
  "docs: add performance notes to memoize",
  "feat: add sum and average helpers",
  "fix: retry leaks promise on success path",
  "refactor: use const assertions in config",
  "chore: add missing semicolons",
  "feat: add shuffle array helper",
];

// Fisher-Yates shuffle -- unbiased
const shuffleArray = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Shuffle on load so the cycling pattern is not visible
const MESSAGES = shuffleArray(MESSAGE_POOL);

const SNIPPETS = [
  `\n// retry v{v}\nexport const retry = async (fn, n = 3) => { for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { if (i === n - 1) throw e; } } };\n`,
  `\n// memoize v{v}\nexport const memoize = (fn) => { const c = new Map(); return (...a) => { const k = JSON.stringify(a); if (!c.has(k)) c.set(k, fn(...a)); return c.get(k); }; };\n`,
  `\n// once v{v}\nexport const once = (fn) => { let d = false, v; return (...a) => { if (!d) { d = true; v = fn(...a); } return v; }; };\n`,
  `\n// pipe v{v}\nexport const pipe = (...fns) => (x) => fns.reduce((v, f) => f(v), x);\n`,
  `\n// chunk v{v}\nexport const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));\n`,
  `\n// omit v{v}\nexport const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));\n`,
  `\n// pick v{v}\nexport const pick = (obj, keys) => Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));\n`,
  `\n// clamp v{v}\nexport const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);\n`,
  `\n// toTitleCase v{v}\nexport const toTitleCase = (s) => s.replace(/\\w\\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase());\n`,
  `\n// unique v{v}\nexport const unique = (arr) => [...new Set(arr)];\n`,
  `\n// range v{v}\nexport const range = (s, e, step = 1) => { const o = []; for (let i = s; i < e; i += step) o.push(i); return o; };\n`,
  `\n// flatten v{v}\nexport const flatten = (arr) => arr.flat(Infinity);\n`,
  `\n// zip v{v}\nexport const zip = (...arrs) => arrs[0].map((_, i) => arrs.map(a => a[i]));\n`,
  `\n// sum v{v}\nexport const sum = (arr) => arr.reduce((a, b) => a + b, 0);\n`,
  `\n// average v{v}\nexport const average = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;\n`,
  `\n// shuffle v{v}\nexport const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);\n`,
];

// Initialise or re-initialise all content files.
// Called after --reset wipes the working tree, and on a fresh clone.
export const ensureContentFiles = () => {
  // Reset in-memory state so a second run (or post-reset run) starts clean
  sessionCount   = 0;
  snippetVersion = 0;
  commitIdx      = 0;
  progressCache  = null;

  try {
    if (!fs.existsSync("./content")) fs.mkdirSync("./content", { recursive: true });

    // Always recreate notes and snippets from scratch to avoid unbounded growth
    fs.writeFileSync(PATHS.notes, "# Dev Notes\n\n> Daily log.\n\n## Log\n\n");

    fs.writeFileSync(PATHS.snippets,
`// snippets.js -- utility helpers

export const debounce   = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const throttle   = (fn, ms) => { let l = 0; return (...a) => { const n = Date.now(); if (n - l >= ms) { l = n; return fn(...a); } }; };
export const deepClone  = (o) => JSON.parse(JSON.stringify(o));
export const capitalize = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
export const sleep      = (ms) => new Promise(r => setTimeout(r, ms));
export const groupBy    = (arr, key) => arr.reduce((a, i) => { (a[i[key]] = a[i[key]] || []).push(i); return a; }, {});
export const randomHex  = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
export const parseQuery = (qs) => Object.fromEntries(new URLSearchParams(qs));
`);

    progressCache = { totalSessions: 0, lastUpdated: "", milestones: [] };
    fs.writeFileSync(PATHS.progress, JSON.stringify(progressCache, null, 2));
    jsonfile.writeFileSync(PATHS.data, { date: moment().format(), session: 0 });
  } catch (e) {
    throw new Error(`Failed to initialise content files: ${e.message}`);
  }
};

// File mutators -- wrapped in try/catch so a transient disk error doesn't crash the run
const updateNotes = (date) => {
  sessionCount++;
  try {
    fs.appendFileSync(PATHS.notes,
      `- **${moment(date).format("YYYY-MM-DD")}** -- session ${sessionCount}\n`);
  } catch (e) { console.warn(`\n  warning: could not write notes: ${e.message}`); }
};

const flushProgress = (date) => {
  progressCache.totalSessions = sessionCount;
  progressCache.lastUpdated   = moment(date).format("YYYY-MM-DD");
  if (sessionCount > 0 && sessionCount % 30 === 0)
    progressCache.milestones.push({ session: sessionCount, date: progressCache.lastUpdated });
  try {
    fs.writeFileSync(PATHS.progress, JSON.stringify(progressCache, null, 2));
  } catch (e) { console.warn(`\n  warning: could not write progress: ${e.message}`); }
};

const updateSnippets = () => {
  try {
    fs.appendFileSync(
      PATHS.snippets,
      SNIPPETS[snippetVersion % SNIPPETS.length].replace("{v}", snippetVersion + 1)
    );
  } catch (e) { console.warn(`\n  warning: could not write snippets: ${e.message}`); }
  snippetVersion++;
};

const mutate = (date, idx) => {
  try {
    jsonfile.writeFileSync(PATHS.data, { date: moment(date).format(), session: sessionCount });
  } catch (e) { console.warn(`\n  warning: could not write data.json: ${e.message}`); }
  switch (idx % 4) {
    case 0: updateNotes(date); flushProgress(date); break;
    case 1: updateSnippets();                        break;
    case 2: updateNotes(date);                       break;
    case 3: updateSnippets(); flushProgress(date);   break;
  }
};

// Commit using simple-git v3 promise API.
// Sequential for-loop -- no stack overflow risk on large entry sets.
export const runCommits = async (entries) => {
  const total   = entries.length;
  const lineW   = process.stdout.columns || 120;   // clear full terminal width

  for (let i = 0; i < total; i++) {
    const date      = entries[i];
    const formatted = moment(date).format();
    const msg       = MESSAGES[commitIdx % MESSAGES.length];

    mutate(date, commitIdx);

    // Overwrite the line and pad to terminal width to clear any residual chars
    const line = `  [${String(i + 1).padStart(4)}/${total}]  ${moment(date).format("YYYY-MM-DD")}  ${msg}`;
    process.stdout.write(`\r${line.padEnd(lineW)}`);

    commitIdx++;

    try {
      await git.add(["./content/", PATHS.data]);
      await git.commit(msg, ["./content/", PATHS.data], { "--date": formatted, "--allow-empty": null });
    } catch (e) {
      process.stdout.write("\n");
      throw new Error(`Commit failed at entry ${i + 1} (${moment(date).format("YYYY-MM-DD")}): ${e.message}`);
    }
  }

  process.stdout.write(`\r${"".padEnd(lineW)}\r`);  // clear progress line
};
