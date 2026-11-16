import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus } from '../../app/js/core/status.js';
import { formatStatus } from '../../app/js/core/format.js';
import {
  makeBreastManual,
  startBreast,
  pauseBreast,
  makeBottle,
  makeSleepManual,
  startSleep,
} from '../../app/js/core/events.js';

const MIN = 60000;
const NOW = Date.UTC(2026, 10, 15, 8, 0);
const status = (events) => formatStatus(computeStatus(events, NOW), 'ml');

// "Last fed" counts from the start of the feed (spec), so the feed starts 2h10m before NOW.
const leftFeed = () => makeBreastManual(NOW - 130 * MIN, 15, 0);
const sleepEnded40mAgo = () => makeSleepManual(NOW - 100 * MIN, NOW - 40 * MIN);

test('last fed, next side and awake', () => {
  assert.equal(
    status([leftFeed(), sleepEnded40mAgo()]),
    'Last fed 2h 10m ago (left) · next side: right · awake 40m',
  );
});

test('bottle after a breastfeed', () => {
  assert.equal(
    status([leftFeed(), sleepEnded40mAgo(), makeBottle(90, NOW - 45 * MIN)]),
    'Last fed 45m ago (bottle 90 ml) · next side: right · awake 40m',
  );
});

test('feeding shows the running side clock', () => {
  const feeding = startBreast('L', NOW - 392000);
  assert.equal(status([leftFeed(), feeding]), 'Feeding · Left 6:32');
  assert.equal(status([pauseBreast(feeding, NOW - 1000)]), 'Feeding · paused');
});

test('asleep', () => {
  const s = computeStatus([leftFeed(), startSleep(NOW - 35 * MIN)], NOW);
  assert.equal(s.awakeMs, null);
  assert.equal(s.asleepMs, 35 * MIN);
  assert.equal(formatStatus(s, 'ml'), 'Asleep 35m');
});

test('just now, and no awake part without sleep', () => {
  assert.equal(status([makeBreastManual(NOW - 30000, 1, 0)]), 'Last fed just now (left) · next side: right');
});

test('nothing logged', () => {
  assert.equal(status([]), 'Nothing logged yet');
});

test('deleted feeds are ignored', () => {
  const deleted = { ...makeBreastManual(NOW - 60 * MIN, 0, 10), deleted: true };
  assert.equal(status([leftFeed(), deleted]), 'Last fed 2h 10m ago (left) · next side: right');
});

test('next side follows the side the last feed ended on', () => {
  const s = computeStatus([makeBreastManual(NOW - 60 * MIN, 10, 5)], NOW);
  assert.equal(s.nextSide, 'L');
});
