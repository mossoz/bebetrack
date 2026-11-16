// Runs under TZ=America/New_York (set by the npm test script).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDay, addDays, eventsForDay, dayTotals } from '../../app/js/core/days.js';
import {
  makeDiaper,
  makeBottle,
  makeBreastManual,
  makeSleepManual,
  startSleep,
} from '../../app/js/core/events.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const local = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min).getTime();
const NOV14 = local(2026, 10, 14);
const NOV15 = local(2026, 10, 15);

test('runs in New York time', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/New_York');
});

test('startOfDay', () => {
  assert.equal(startOfDay(local(2026, 10, 15, 14, 30)), NOV15);
});

test('DST spring forward', () => {
  const day = startOfDay(local(2026, 2, 8, 12));
  assert.equal(addDays(day, 1) - day, 23 * HOUR);
});

test('DST fall back', () => {
  const day = startOfDay(local(2026, 10, 1, 12));
  assert.equal(addDays(day, 1) - day, 25 * HOUR);
});

test('addDays goes backwards too', () => {
  assert.equal(addDays(NOV15, -1), NOV14);
});

test('boundaries', () => {
  const before = makeDiaper('wet', local(2026, 10, 14, 23, 59));
  const first = makeDiaper('wet', NOV15);
  const last = makeDiaper('wet', local(2026, 10, 15, 23, 59));
  const ids = eventsForDay([before, first, last], NOV15).map((e) => e.id);
  assert.deepEqual(ids.sort(), [first.id, last.id].sort());
});

test('sleep across midnight belongs to the start day', () => {
  const sleep = makeSleepManual(local(2026, 10, 14, 23), local(2026, 10, 15, 2));
  const day14 = eventsForDay([sleep], NOV14);
  assert.deepEqual(day14.map((e) => e.id), [sleep.id]);
  assert.deepEqual(eventsForDay([sleep], NOV15), []);
  assert.equal(dayTotals(day14, NOV15).sleepMs, 3 * HOUR);
});

test('order is newest first', () => {
  const a = makeDiaper('wet', local(2026, 10, 15, 1));
  const b = makeBottle(90, local(2026, 10, 15, 9));
  const c = makeDiaper('solid', local(2026, 10, 15, 5));
  assert.deepEqual(eventsForDay([a, b, c], NOV15).map((e) => e.id), [b.id, c.id, a.id]);
});

test('deleted excluded', () => {
  const gone = { ...makeDiaper('wet', local(2026, 10, 15, 8)), deleted: true };
  assert.deepEqual(eventsForDay([gone], NOV15), []);
});

test('totals', () => {
  const at = (h) => local(2026, 10, 15, h);
  const events = [
    makeBreastManual(at(1), 12, 8),
    makeBottle(90, at(4)),
    makeBottle(60, at(7)),
    makeDiaper('wet', at(2)),
    makeDiaper('solid', at(3)),
    makeDiaper('both', at(5)),
    makeSleepManual(at(8), at(8) + 80 * MIN),
  ];
  assert.deepEqual(dayTotals(events, at(12)), {
    feeds: 3,
    breastMs: 20 * MIN,
    bottleMl: 150,
    sleepMs: 80 * MIN,
    wet: 2,
    solid: 2,
  });
});

test('running sleep counts up to now', () => {
  const sleep = startSleep(local(2026, 10, 15, 10));
  assert.equal(dayTotals([sleep], local(2026, 10, 15, 10, 45)).sleepMs, 45 * MIN);
});
