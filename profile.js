// profile.js -- date generation engine

import moment from "moment";
import random from "random";
import { CONFIG } from "./config.js";

// Working hours -- weighted toward afternoon
const pickHour = () => {
  const { morning, afternoon, evening } = CONFIG.hours;
  const r = Math.random();
  if (r < morning.weight)                    return random.int(morning.from,   morning.to   - 1);
  if (r < morning.weight + afternoon.weight) return random.int(afternoon.from, afternoon.to - 1);
  return                                            random.int(evening.from,   evening.to   - 1);
};

const addDay = (entries, day, count) => {
  // Pick independent hours spread through the working day to avoid bunching
  const hours = new Set();
  while (hours.size < count) hours.add(pickHour());
  const sorted = [...hours].sort((a, b) => a - b);
  sorted.forEach((h, c) =>
    entries.push(day.clone().hour(h).minute(random.int(0, 59)).second(c * 20))
  );
};

// Build calendar-aware blackout ranges for a year.
// Gaps are placed where real developers actually take time off.
const buildBlackouts = (year, totalDays) => {
  const out  = new Set();
  const jan1 = moment(`${year}-01-01`);

  const markRange = (startDate, lenDays) => {
    const offset = startDate.diff(jan1, "d");
    for (let i = 0; i < lenDays; i++) {
      const d = offset + i;
      if (d >= 0 && d < totalDays) out.add(d);
    }
  };

  // Winter holidays -- late Dec of this year
  markRange(moment(`${year}-12-20`), random.int(8, 11));

  // Early January -- slow start after the holidays
  markRange(jan1, random.int(3, 6));

  // Summer break -- somewhere in July or August, 14-22 days
  // Clamp to totalDays so we never black out future dates on current-year runs
  const summerStart = moment(`${year}-07-01`).add(random.int(0, 40), "d");
  markRange(summerStart, random.int(14, 22));

  // Spring trip -- somewhere in March or April, 7-12 days
  const springStart = moment(`${year}-03-10`).add(random.int(0, 45), "d");
  markRange(springStart, random.int(7, 12));

  // Autumn trip -- September or October, 5-10 days, only 70% of years
  if (Math.random() < 0.70) {
    const autumnStart = moment(`${year}-09-05`).add(random.int(0, 40), "d");
    markRange(autumnStart, random.int(5, 10));
  }

  // Random sick / burnout / life breaks: 2-3 per year, 4-8 days
  const used = new Set(out);
  for (let s = 0; s < random.int(2, 3); s++) {
    const len = random.int(4, 8);
    let start = random.int(0, totalDays - 10);
    for (let tries = 0; tries < 25; tries++) {
      let ok = true;
      for (let i = 0; i < len; i++) if (used.has(start + i)) { ok = false; break; }
      if (ok) break;
      start = random.int(0, totalDays - 10);
    }
    for (let i = 0; i < len && start + i < totalDays; i++) {
      out.add(start + i);
      used.add(start + i);
    }
  }

  return out;
};

// Month-level density -- some months are naturally more active
const MONTH_DENSITY = [
  0.55,  // Jan
  0.75,  // Feb
  0.85,  // Mar
  0.90,  // Apr
  0.95,  // May
  0.90,  // Jun
  0.65,  // Jul
  0.60,  // Aug
  0.85,  // Sep
  0.90,  // Oct
  0.88,  // Nov
  0.50,  // Dec
];

// Work-run state machine.
// Real developers code in focus runs (2-6 days) with short rests in between,
// producing the characteristic clusters visible on real contribution graphs.
class WorkRunState {
  constructor(era) {
    this.era      = era;
    this.inRun    = true;
    this.runLeft  = random.int(2, { new: 4, growing: 5, active: 6 }[era] ?? 5);
    this.restLeft = 0;
  }

  tick() {
    if (this.inRun) {
      this.runLeft--;
      if (this.runLeft <= 0) {
        this.restLeft = random.int(1, 3);
        this.inRun    = false;
      }
      return true;
    } else {
      this.restLeft--;
      if (this.restLeft <= 0) {
        this.runLeft = random.int(2, { new: 4, growing: 5, active: 6 }[this.era] ?? 5);
        this.inRun   = true;
      }
      return false;
    }
  }
}

const pickCount = (era) => {
  const [w1, w2] = CONFIG.eras[era].commitWeights;
  const r = Math.random();
  if (r < w1)      return 1;
  if (r < w1 + w2) return 2;
  return 3;
};

export const buildAllDates = () => {
  const entries     = [];
  const currentYear = moment().year();
  const streakOn    = CONFIG.streak.enabled;
  const streakEnd   = moment().subtract(1, "d").startOf("day");
  const streakStart = streakEnd.clone().subtract(CONFIG.streak.days - 1, "d");

  for (const { yearsAgo, era } of CONFIG.profile) {
    const year   = currentYear - yearsAgo;
    const yStart = moment(`${year}-01-01`).startOf("day");
    const yEnd   = yearsAgo === 0
      ? moment().startOf("day")
      : moment(`${year}-12-31`).startOf("day");

    const totalDays        = yEnd.diff(yStart, "d") + 1;
    const blackout         = buildBlackouts(year, totalDays);
    const eraCfg           = CONFIG.eras[era];
    const earlyMonthCutoff = (eraCfg.earlyMonths ?? 0) * 30;
    const workRun          = new WorkRunState(era);

    let day = yStart.clone(), offset = 0;

    while (day.isSameOrBefore(yEnd, "day")) {
      const inStreak = streakOn
        && day.isSameOrAfter(streakStart)
        && day.isSameOrBefore(streakEnd);

      if (!inStreak && !blackout.has(offset)) {
        const dow   = day.day();
        const month = day.month();
        let   n     = 0;

        if (dow === 0) {
          // Sunday -- almost never
          if (Math.random() < CONFIG.weekend.sunday) n = 1;

        } else if (dow === 6) {
          // Saturday -- rare
          if (Math.random() < CONFIG.weekend.saturday) n = 1;

        } else if (offset < earlyMonthCutoff) {
          // Early months of "new" era -- very sparse
          if (Math.random() < (eraCfg.earlyMonthChance ?? 0.06)) n = 1;

        } else {
          // Normal weekday -- work-run state + month density
          const activeChance = eraCfg.weekdayChance * (MONTH_DENSITY[month] ?? 0.80);
          const inActiveRun  = workRun.tick();

          if (inActiveRun && Math.random() < activeChance) {
            n = pickCount(era);
          } else if (!inActiveRun && Math.random() < 0.08) {
            // Occasional commit on a rest day
            n = 1;
          }
        }

        if (n > 0) addDay(entries, day, n);
      }

      day.add(1, "d");
      offset++;
    }
  }

  // Streak -- guaranteed consecutive days, no gaps, no blackouts
  if (streakOn) {
    let sd = streakStart.clone();
    while (sd.isSameOrBefore(streakEnd, "day")) {
      // Mostly 1 commit, occasionally 2 -- never 3 during a streak (looks too uniform)
      addDay(entries, sd, Math.random() < 0.62 ? 1 : Math.min(CONFIG.streak.maxPerDay, 2));
      sd.add(1, "d");
    }
  }

  // Today -- one commit at a natural hour to keep the streak active.
  // Only add if today is not already covered by the streak window.
  const today = moment().startOf("day");
  const todayInStreak = streakOn
    && today.isSameOrAfter(streakStart)
    && today.isSameOrBefore(streakEnd);

  if (!todayInStreak) {
    const todayHour = pickHour();
    entries.push(today.clone().hour(todayHour).minute(random.int(0, 59)).second(0));
  }

  return entries.sort((a, b) => a.valueOf() - b.valueOf());
};
