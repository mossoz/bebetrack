import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDiaper,
  makeBottle,
  startBreast,
  switchSide,
  pauseBreast,
  resumeBreast,
  stopBreast,
  makeBreastManual,
  startSleep,
  stopSleep,
  makeSleepManual,
  isRunning,
  sideTotals,
  currentSide,
  lastSide,
  durationMs,
  merge,
  isValidEvent,
  editBreast,
  sameEvent,
} from '../../app/js/core/events.js';

const T = Date.UTC(2026, 10, 15, 3, 0);
const MIN = 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('diaper', () => {
  const d = makeDiaper('both', T);
  assert.equal(d.type, 'diaper');
  assert.equal(d.diaper, 'both');
  assert.equal(d.start, T);
  assert.equal(d.end, T);
  assert.equal(d.deleted, false);
  assert.equal(d.updatedAt, 0);
  assert.match(d.id, UUID);
});

test('bottle keeps ml to one decimal', () => {
  const b = makeBottle(30.5, T);
  assert.equal(b.ml, 30.5);
  assert.equal(b.end, T);
  assert.equal(makeBottle(30.24, T).ml, 30.2);
  assert.equal(makeBottle(89.96, T).ml, 90);
});

test('breast timer flow', () => {
  let ev = startBreast('L', T);
  ev = switchSide(ev, 'R', T + 12 * MIN);
  ev = pauseBreast(ev, T + 20 * MIN);
  assert.equal(currentSide(ev), null);
  assert.equal(isRunning(ev), true);
  ev = stopBreast(ev, T + 30 * MIN);
  assert.deepEqual(sideTotals(ev, T + 60 * MIN), { L: 12 * MIN, R: 8 * MIN });
  assert.equal(ev.end, T + 30 * MIN);
  assert.equal(lastSide(ev), 'R');
  assert.equal(currentSide(ev), null);
  assert.equal(isRunning(ev), false);
  assert.equal(durationMs(ev, T + 60 * MIN), 20 * MIN);
});

test('switch to same side is a no-op', () => {
  const ev = switchSide(startBreast('L', T), 'L', T + MIN);
  assert.equal(ev.sides.length, 1);
});

test('switch after pause opens a new segment', () => {
  let ev = pauseBreast(startBreast('L', T), T + 5 * MIN);
  ev = switchSide(ev, 'L', T + 10 * MIN);
  assert.equal(ev.sides.length, 2);
  assert.equal(currentSide(ev), 'L');
  assert.deepEqual(sideTotals(ev, T + 12 * MIN), { L: 7 * MIN, R: 0 });
});

test('makers do not mutate their input', () => {
  const ev = startBreast('L', T);
  const before = structuredClone(ev);
  switchSide(ev, 'R', T + MIN);
  stopBreast(ev, T + 2 * MIN);
  assert.deepEqual(ev, before);
});

test('open segment counts to now', () => {
  const ev = startBreast('L', T);
  assert.equal(sideTotals(ev, T + 5 * MIN).L, 5 * MIN);
  assert.equal(currentSide(ev), 'L');
  assert.equal(isRunning(ev), true);
});

test('manual breast', () => {
  const left = makeBreastManual(T, 10, 0);
  assert.equal(left.sides.length, 1);
  assert.equal(left.sides[0].side, 'L');
  assert.equal(left.end, T + 10 * MIN);
  const both = makeBreastManual(T, 12, 8);
  assert.deepEqual(sideTotals(both, T), { L: 12 * MIN, R: 8 * MIN });
  assert.equal(lastSide(both), 'R');
  assert.equal(isRunning(both), false);
});

test('sleep', () => {
  assert.equal(durationMs(stopSleep(startSleep(T), T + 80 * MIN), T + 999 * MIN), 80 * MIN);
  const running = startSleep(T);
  assert.equal(isRunning(running), true);
  assert.equal(durationMs(running, T + 35 * MIN), 35 * MIN);
  assert.equal(durationMs(makeSleepManual(T, T + 90 * MIN), T), 90 * MIN);
});

test('deleted events are not running', () => {
  assert.equal(isRunning({ ...startSleep(T), deleted: true }), false);
});

test('bottle and diaper have no duration', () => {
  assert.equal(durationMs(makeBottle(90, T), T + MIN), 0);
  assert.equal(isRunning(makeDiaper('wet', T)), false);
});

test('merge', () => {
  const base = makeBottle(90, T);
  const older = { ...base, ml: 60, updatedAt: 1 };
  const newer = { ...base, ml: 120, updatedAt: 2 };
  assert.equal(merge(older, newer), newer);
  assert.equal(merge(newer, older), newer);
  assert.equal(merge(undefined, older), older);
});

test('merge breaks ties the same way on both phones', () => {
  const base = makeBottle(90, T);
  const a = { ...base, ml: 120, updatedAt: 2 };
  const b = { ...base, ml: 30, updatedAt: 2 };
  assert.deepEqual(merge(a, b), merge(b, a));
  const same = { ...a };
  assert.equal(merge(a, same), a);
});

test('sameEvent compares content, not key order', () => {
  const a = makeBottle(90, T);
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(sameEvent(a, reordered), true);
  assert.equal(sameEvent(a, { ...a, ml: 91 }), false);
});

// A timed feed that went Right, then Left: it ended on Left.
function rightThenLeft() {
  let ev = startBreast('R', T);
  ev = switchSide(ev, 'L', T + 5 * MIN);
  return stopBreast(ev, T + 12 * MIN);
}

test('editing a feed without changing minutes keeps its sides and order', () => {
  const ev = rightThenLeft();
  const edited = editBreast(ev, ev.start, 7, 5);
  assert.deepEqual(edited.sides, ev.sides);
  assert.equal(lastSide(edited), 'L');
  assert.equal(edited.id, ev.id);
});

test('editing only the start shifts the whole feed', () => {
  const ev = rightThenLeft();
  const edited = editBreast(ev, ev.start + 10 * MIN, 7, 5);
  assert.equal(edited.start, T + 10 * MIN);
  assert.equal(edited.end, T + 22 * MIN);
  assert.deepEqual(edited.sides.map((s) => s.side), ['R', 'L']);
  assert.equal(edited.sides[0].start, T + 10 * MIN);
});

test('changing minutes keeps the original side order', () => {
  const edited = editBreast(rightThenLeft(), T, 8, 5);
  assert.deepEqual(edited.sides.map((s) => s.side), ['R', 'L']);
  assert.deepEqual(sideTotals(edited, T), { L: 8 * MIN, R: 5 * MIN });
  assert.equal(lastSide(edited), 'L');
  assert.equal(edited.end, T + 13 * MIN);
});

test('a past feed can start on the right', () => {
  const ev = makeBreastManual(T, 10, 5, 'R');
  assert.deepEqual(ev.sides.map((s) => s.side), ['R', 'L']);
  assert.equal(lastSide(ev), 'L');
});

test('isValidEvent', () => {
  const all = [
    makeDiaper('wet', T),
    makeBottle(90, T),
    startBreast('L', T),
    stopBreast(startBreast('R', T), T + MIN),
    makeBreastManual(T, 5, 5),
    startSleep(T),
    makeSleepManual(T, T + MIN),
  ];
  for (const ev of all) assert.equal(isValidEvent(ev), true, ev.type);
  assert.equal(isValidEvent({}), false);
  assert.equal(isValidEvent(null), false);
  assert.equal(isValidEvent({ ...makeBottle(90, T), type: 'pumping' }), false);
  assert.equal(isValidEvent({ ...makeDiaper('wet', T), diaper: 'green' }), false);
  assert.equal(isValidEvent({ ...makeBottle(90, T), ml: 'lots' }), false);
  assert.equal(isValidEvent({ ...startBreast('L', T), sides: [{ side: 'X', start: T, end: null }] }), false);
});

test('a breastfeed may carry a reminder time', () => {
  const fed = stopBreast(startBreast('L', T), T + 15 * MIN);
  assert.equal(isValidEvent({ ...fed, remindAt: T + 135 * MIN }), true);
  assert.equal(isValidEvent({ ...fed, remindAt: null }), true);
  assert.equal(isValidEvent({ ...fed, remindAt: 'soon' }), false);
});

test('resume continues the side that was paused', () => {
  let ev = switchSide(startBreast('L', T), 'R', T + 5 * MIN);
  ev = pauseBreast(ev, T + 9 * MIN);
  const resumed = resumeBreast(ev, T + 15 * MIN);
  assert.equal(currentSide(resumed), 'R');
  assert.deepEqual(resumed.sides.at(-1), { side: 'R', start: T + 15 * MIN, end: null });
  assert.deepEqual(sideTotals(resumed, T + 16 * MIN), { L: 5 * MIN, R: 5 * MIN });
});

test('resume does nothing while a side is counting', () => {
  const ev = startBreast('L', T);
  assert.equal(resumeBreast(ev, T + MIN), ev);
});
