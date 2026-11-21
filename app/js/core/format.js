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

// Two lines for the status card: `main` is the big one, `detail` sits
// underneath in smaller text ('' when there is nothing to add).
export function formatStatus(status) {
  const line = (...parts) => capitalize(parts.filter(Boolean).join(' · '));
  if (status.feeding) {
    const { side, sideMs } = status.feeding;
    return { main: side ? `Feeding · ${capitalize(SIDE_NAME[side])} ${formatClock(sideMs)}` : 'Feeding · paused', detail: '' };
  }
  const feed = status.lastFeed;
  const fed = feed ? `fed ${feed.agoMs < MIN ? 'just now' : `${formatDuration(feed.agoMs)} ago`}` : null;
  const next = status.nextSide ? `next: ${SIDE_NAME[status.nextSide]}` : null;
  if (status.asleepMs !== null) return { main: `Asleep ${formatDuration(status.asleepMs)}`, detail: line(fed, next) };
  const awake = status.awakeMs !== null ? `awake ${formatDuration(status.awakeMs)}` : null;
  if (fed) return { main: line(fed), detail: line(next, awake) };
  if (awake) return { main: line(awake), detail: '' };
  return { main: 'Nothing logged yet', detail: '' };
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

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

// The day's recap: one tile per logging button, in the same order and colors.
export function formatDayTiles(totals, unit) {
  return [
    { kind: 'breast', value: formatDuration(totals.breastMs), caption: plural(totals.breasts, 'feed'), empty: totals.breasts === 0 },
    { kind: 'bottle', value: formatAmount(totals.bottleMl, unit), caption: plural(totals.bottles, 'bottle'), empty: totals.bottles === 0 },
    { kind: 'sleep', value: formatDuration(totals.sleepMs), caption: plural(totals.sleeps, 'sleep'), empty: totals.sleeps === 0 },
    { kind: 'diaper', value: `${totals.wet} · ${totals.solid}`, caption: 'wet · solid', empty: totals.wet + totals.solid === 0 },
  ];
}

// Next-feed reminder choices, in minutes after the feed ended.
export const REMIND_MINUTES = [30, 60, 90, 120, 150, 180, 210, 240];

export function formatReminder(reminder, now) {
  if (reminder.due) return `Feed due · ${formatTime(reminder.at)}`;
  const left = Math.ceil((reminder.at - now) / MIN) * MIN;
  return `Next feed ${formatTime(reminder.at)} · in ${formatDuration(left)}`;
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
