// Display text. Pure functions; no DOM.
import { isRunning, sideTotals, currentSide, lastSide } from './events.js';
import { addDays } from './days.js';

const MIN = 60000;

export const ML_PER_OZ = 29.5735;
export const QUICK_AMOUNTS = { ml: [30, 60, 90, 120], oz: [1, 2, 3, 4] };
export const STEP = { ml: 10, oz: 0.5 };

export function mlToOz(ml) {
  return ml / ML_PER_OZ;
}

export function ozToMl(oz) {
  return Math.round(oz * ML_PER_OZ);
}

export function formatAmount(ml, unit) {
  if (unit === 'oz') return `${Number(mlToOz(ml).toFixed(1))} oz`;
  return `${Number(ml.toFixed(1))} ml`;
}

// A typed amount such as "30.5" or "30,5", rounded to one decimal.
// Returns null unless it is a plain positive number.
export function parseAmount(text) {
  const t = String(text).trim();
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  const value = Math.round(Number(t.replace(',', '.')) * 10) / 10;
  return value > 0 ? value : null;
}

export function formatDuration(ms) {
  const totalMin = Math.floor(Math.max(0, ms) / MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatClock(ms) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const SIDE_NAME = { L: 'left', R: 'right' };
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatStatus(status, unit) {
  if (status.feeding) {
    const { side, sideMs } = status.feeding;
    return side ? `Feeding · ${capitalize(SIDE_NAME[side])} ${formatClock(sideMs)}` : 'Feeding · paused';
  }
  if (status.asleepMs !== null) return `Asleep ${formatDuration(status.asleepMs)}`;

  const parts = [];
  const feed = status.lastFeed;
  if (feed) {
    const when = feed.agoMs < MIN ? 'just now' : `${formatDuration(feed.agoMs)} ago`;
    let detail = '';
    if (feed.kind === 'breast' && feed.side) detail = ` (${SIDE_NAME[feed.side]})`;
    if (feed.kind === 'bottle') detail = ` (bottle ${formatAmount(feed.ml, unit)})`;
    parts.push(`Last fed ${when}${detail}`);
  }
  if (status.nextSide) parts.push(`next side: ${SIDE_NAME[status.nextSide]}`);
  if (status.awakeMs !== null) parts.push(`awake ${formatDuration(status.awakeMs)}`);
  return parts.length ? capitalize(parts.join(' · ')) : 'Nothing logged yet';
}

const DIAPER_TEXT = { wet: 'wet', solid: 'solid', both: 'wet + solid' };

export function formatEventSummary(ev, unit, now) {
  switch (ev.type) {
    case 'breast': {
      if (isRunning(ev)) return 'Breast · feeding now';
      const totals = sideTotals(ev, now);
      const sides = ['L', 'R']
        .filter((s) => totals[s] > 0)
        .map((s) => `${s} ${formatDuration(totals[s])}`);
      return ['Breast', ...(sides.length ? [sides.join(' ')] : [])].join(' · ');
    }
    case 'bottle':
      return `Bottle · ${formatAmount(ev.ml, unit)}`;
    case 'diaper':
      return `Diaper · ${DIAPER_TEXT[ev.diaper]}`;
    case 'sleep':
      return isRunning(ev) ? 'Sleep · asleep now' : `Sleep · ${formatDuration(ev.end - ev.start)}`;
    default:
      return ev.type;
  }
}

export function formatTotals(totals, unit) {
  return [
    `${totals.feeds} ${totals.feeds === 1 ? 'feed' : 'feeds'}`,
    `${formatDuration(totals.breastMs)} breast`,
    `${formatAmount(totals.bottleMl, unit)} bottle`,
    `${formatDuration(totals.sleepMs)} sleep`,
    `${totals.wet} wet`,
    `${totals.solid} solid`,
  ];
}

export function formatDayLabel(dayStartMs, todayStartMs) {
  if (dayStartMs === todayStartMs) return 'Today';
  if (dayStartMs === addDays(todayStartMs, -1)) return 'Yesterday';
  return new Date(dayStartMs).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// <input type="datetime-local"> works in local wall-clock time, minute precision.
const pad2 = (n) => String(n).padStart(2, '0');

export function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Times more than a minute ahead of the phone's clock are a typo (often AM/PM).
export function isFutureTime(ms, now = Date.now()) {
  return ms > now + 60000;
}

// The running-feed sheet: what is counting, and a caption on each side button
// so it is clear how to resume after a pause or switch sides.
export function breastControls(ev) {
  const side = currentSide(ev);
  const resume = side ? null : (lastSide(ev) ?? 'L');
  return {
    paused: !side,
    label: side ? `${capitalize(SIDE_NAME[side])} side` : 'Paused',
    toggle: side ? 'Pause' : `Resume ${SIDE_NAME[resume]}`,
    sides: ['L', 'R'].map((s) => ({
      side: s,
      name: capitalize(SIDE_NAME[s]),
      pressed: s === side,
      suggested: s === resume,
      caption: s === side ? 'Now' : s === resume ? 'Resume' : 'Switch',
    })),
  };
}
