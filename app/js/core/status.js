// The 3am status line: what's running, when baby last ate, which side is next,
// and how long baby has been awake.
import { isRunning, currentSide, sideTotals, lastSide } from './events.js';

const OPPOSITE = { L: 'R', R: 'L' };
const latestByStart = (events) => events.reduce((a, b) => (!a || b.start > a.start ? b : a), null);

export function computeStatus(events, now) {
  const live = events.filter((e) => !e.deleted);

  const runningFeed = latestByStart(live.filter((e) => e.type === 'breast' && isRunning(e)));
  let feeding = null;
  if (runningFeed) {
    const side = currentSide(runningFeed);
    feeding = { side, sideMs: side ? sideTotals(runningFeed, now)[side] : 0 };
  }

  const runningSleep = latestByStart(live.filter((e) => e.type === 'sleep' && isRunning(e)));
  const asleepMs = runningSleep ? now - runningSleep.start : null;

  const feed = latestByStart(live.filter((e) => e.type === 'breast' || e.type === 'bottle'));
  let lastFeed = null;
  if (feed) {
    lastFeed = { agoMs: now - feed.start, kind: feed.type };
    if (feed.type === 'breast') lastFeed.side = lastSide(feed);
    if (feed.type === 'bottle') lastFeed.ml = feed.ml;
  }

  const breast = latestByStart(live.filter((e) => e.type === 'breast' && lastSide(e)));
  const nextSide = breast ? OPPOSITE[lastSide(breast)] : null;

  let awakeMs = null;
  if (!runningSleep) {
    const ends = live.filter((e) => e.type === 'sleep' && e.end !== null).map((e) => e.end);
    if (ends.length) awakeMs = now - Math.max(...ends);
  }

  return { feeding, asleepMs, lastFeed, nextSide, awakeMs };
}
