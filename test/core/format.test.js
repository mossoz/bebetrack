import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ML_PER_OZ,
  QUICK_AMOUNTS,
  STEP,
  mlToOz,
  ozToMl,
  formatAmount,
  parseAmount,
  formatDuration,
  formatClock,
  formatEventSummary,
  formatTotals,
  formatDayLabel,
  toLocalInput,
  fromLocalInput,
  isFutureTime,
} from '../../app/js/core/format.js';
import {
  makeBreastManual,
  startBreast,
  makeBottle,
  makeDiaper,
  makeSleepManual,
  startSleep,
} from '../../app/js/core/events.js';
import { addDays, startOfDay } from '../../app/js/core/days.js';

const MIN = 60000;
const T = Date.UTC(2026, 10, 15, 3, 0);

test('constants', () => {
  assert.equal(ML_PER_OZ, 29.5735);
  assert.deepEqual(QUICK_AMOUNTS, { ml: [30, 60, 90, 120], oz: [1, 2, 3, 4] });
  assert.deepEqual(STEP, { ml: 10, oz: 0.5 });
});

test('amounts', () => {
  assert.equal(formatAmount(90, 'ml'), '90 ml');
  assert.equal(formatAmount(90, 'oz'), '3 oz');
  assert.equal(formatAmount(100, 'oz'), '3.4 oz');
  assert.equal(ozToMl(4), 118);
  assert.equal(formatAmount(ozToMl(4), 'oz'), '4 oz');
  assert.ok(Math.abs(mlToOz(ML_PER_OZ * 2) - 2) < 1e-9);
});

test('ml amounts show one decimal when there is one', () => {
  assert.equal(formatAmount(30.5, 'ml'), '30.5 ml');
  assert.equal(formatAmount(30.2, 'ml'), '30.2 ml');
  assert.equal(formatAmount(30.2 + 30.1, 'ml'), '60.3 ml');
  assert.equal(formatAmount(120, 'ml'), '120 ml');
});

test('parseAmount reads a typed amount', () => {
  assert.equal(parseAmount('30.5'), 30.5);
  assert.equal(parseAmount('30,5'), 30.5);
  assert.equal(parseAmount(' 30.25 '), 30.3);
  assert.equal(parseAmount('90'), 90);
  assert.equal(parseAmount('90.'), 90);
  assert.equal(parseAmount('.5'), 0.5);
});

test('parseAmount rejects anything that is not a positive amount', () => {
  for (const bad of ['', ' ', 'abc', '0', '0.0', '0.04', '-5', '30.5.1', '1e3', '30 ml']) {
    assert.equal(parseAmount(bad), null, bad);
  }
});

test('formatDuration', () => {
  assert.equal(formatDuration(30000), '0m');
  assert.equal(formatDuration(45 * MIN), '45m');
  assert.equal(formatDuration(130 * MIN), '2h 10m');
  assert.equal(formatDuration(120 * MIN), '2h');
});

test('formatClock', () => {
  assert.equal(formatClock(392000), '6:32');
  assert.equal(formatClock(3723000), '1:02:03');
  assert.equal(formatClock(5000), '0:05');
});

test('formatEventSummary', () => {
  const now = T + 999 * MIN;
  assert.equal(formatEventSummary(makeBreastManual(T, 12, 8), 'ml', now), 'Breast · L 12m R 8m');
  assert.equal(formatEventSummary(makeBreastManual(T, 10, 0), 'ml', now), 'Breast · L 10m');
  assert.equal(formatEventSummary(startBreast('L', T), 'ml', now), 'Breast · feeding now');
  assert.equal(formatEventSummary(makeBottle(90, T), 'ml', now), 'Bottle · 90 ml');
  assert.equal(formatEventSummary(makeBottle(90, T), 'oz', now), 'Bottle · 3 oz');
  assert.equal(formatEventSummary(makeDiaper('wet', T), 'ml', now), 'Diaper · wet');
  assert.equal(formatEventSummary(makeDiaper('solid', T), 'ml', now), 'Diaper · solid');
  assert.equal(formatEventSummary(makeDiaper('both', T), 'ml', now), 'Diaper · wet + solid');
  assert.equal(formatEventSummary(makeSleepManual(T, T + 80 * MIN), 'ml', now), 'Sleep · 1h 20m');
  assert.equal(formatEventSummary(startSleep(T), 'ml', now), 'Sleep · asleep now');
});

test('formatTotals', () => {
  const totals = { feeds: 1, breastMs: 95 * MIN, bottleMl: 240, sleepMs: 800 * MIN, wet: 6, solid: 3 };
  assert.deepEqual(formatTotals(totals, 'ml'), [
    '1 feed',
    '1h 35m breast',
    '240 ml bottle',
    '13h 20m sleep',
    '6 wet',
    '3 solid',
  ]);
  assert.equal(formatTotals({ ...totals, feeds: 8 }, 'ml')[0], '8 feeds');
});

test('formatDayLabel', () => {
  const today = startOfDay(Date.now());
  assert.equal(formatDayLabel(today, today), 'Today');
  assert.equal(formatDayLabel(addDays(today, -1), today), 'Yesterday');
  const older = formatDayLabel(addDays(today, -3), today);
  assert.notEqual(older, 'Today');
  assert.notEqual(older, 'Yesterday');
});

test('datetime-local helpers use local time', () => {
  const ms = new Date(2026, 10, 15, 3, 5).getTime();
  assert.equal(toLocalInput(ms), '2026-11-15T03:05');
  assert.equal(fromLocalInput('2026-11-15T03:05'), ms);
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput('nonsense'), null);
});

test('isFutureTime allows a minute of clock slack', () => {
  const now = 1_000_000;
  assert.equal(isFutureTime(now + 30000, now), false);
  assert.equal(isFutureTime(now - 3600000, now), false);
  assert.equal(isFutureTime(now + 120000, now), true);
});
