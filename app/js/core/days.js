// Local-calendar days. A day runs from local midnight to the next local
// midnight, so it can be 23 or 25 hours long around DST changes. An event
// belongs to the day it started, including in that day's totals.
import { durationMs } from './events.js';

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(dayStartMs, n) {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + n);
  return startOfDay(d.getTime());
}

export function eventsForDay(events, dayStartMs) {
  const next = addDays(dayStartMs, 1);
  return events
    .filter((e) => !e.deleted && e.start >= dayStartMs && e.start < next)
    .sort((a, b) => b.start - a.start);
}

export function dayTotals(dayEvents, now) {
  const totals = { feeds: 0, breasts: 0, bottles: 0, sleeps: 0, breastMs: 0, bottleMl: 0, sleepMs: 0, wet: 0, solid: 0 };
  for (const e of dayEvents) {
    if (e.type === 'breast' || e.type === 'bottle') totals.feeds++;
    if (e.type === 'breast') totals.breasts++;
    if (e.type === 'bottle') totals.bottles++;
    if (e.type === 'sleep') totals.sleeps++;
    if (e.type === 'breast') totals.breastMs += durationMs(e, now);
    if (e.type === 'bottle') totals.bottleMl += e.ml;
    if (e.type === 'sleep') totals.sleepMs += durationMs(e, now);
    if (e.type === 'diaper') {
      if (e.diaper === 'wet' || e.diaper === 'both') totals.wet++;
      if (e.diaper === 'solid' || e.diaper === 'both') totals.solid++;
    }
  }
  return totals;
}
