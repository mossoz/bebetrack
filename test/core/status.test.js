import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, REMIND, reminderDefault } from '../../app/js/core/status.js';
import { formatStatus } from '../../app/js/core/format.js';
import {
  makeBreastManual,
  startBreast,
  pauseBreast,
  stopBreast,
  makeBottle,
  makeSleepManual,
  startSleep,
} from '../../app/js/core/events.js';

const MIN = 60000;
const NOW = Date.UTC(2026, 10, 15, 8, 0);
const status = (events) => formatStatus(computeStatus(events, NOW));

// "Last fed" counts from the start of the feed (spec), so the feed starts 2h10m before NOW.
const leftFeed = () => makeBreastManual(NOW - 130 * MIN, 15, 0);
const sleepEnded40mAgo = () => makeSleepManual(NOW - 100 * MIN, NOW - 40 * MIN);

test('fed, then next side and awake underneath', () => {
  assert.deepEqual(status([leftFeed(), sleepEnded40mAgo()]), { main: 'Fed 2h 10m ago', detail: 'Next: right · awake 40m' });
});

test('a bottle counts as the last feed', () => {
  assert.deepEqual(status([leftFeed(), sleepEnded40mAgo(), makeBottle(90, NOW - 45 * MIN)]), {
    main: 'Fed 45m ago',
    detail: 'Next: right · awake 40m',
  });
});

test('feeding shows the running side clock', () => {
  const feeding = startBreast('L', NOW - 392000);
  assert.deepEqual(status([leftFeed(), feeding]), { main: 'Feeding · Left 6:32', detail: '' });
  assert.deepEqual(status([pauseBreast(feeding, NOW - 1000)]), { main: 'Feeding · paused', detail: '' });
});

test('asleep, with the last feed underneath', () => {
  const s = computeStatus([leftFeed(), startSleep(NOW - 35 * MIN)], NOW);
  assert.equal(s.awakeMs, null);
  assert.equal(s.asleepMs, 35 * MIN);
  assert.deepEqual(formatStatus(s), { main: 'Asleep 35m', detail: 'Fed 2h 10m ago · next: right' });
});

test('just now, and no awake part without sleep', () => {
  assert.deepEqual(status([makeBreastManual(NOW - 30000, 1, 0)]), { main: 'Fed just now', detail: 'Next: right' });
});

test('awake time is left out when sleep does not seem to be logged', () => {
  const longAgo = makeSleepManual(NOW - 6 * 60 * MIN, NOW - 4 * 60 * MIN - MIN); // ended 4h 1m ago
  assert.equal(computeStatus([leftFeed(), longAgo], NOW).awakeMs, null);
  assert.deepEqual(status([leftFeed(), longAgo]), { main: 'Fed 2h 10m ago', detail: 'Next: right' });
  const recent = makeSleepManual(NOW - 6 * 60 * MIN, NOW - 4 * 60 * MIN + MIN); // ended 3h 59m ago
  assert.equal(computeStatus([leftFeed(), recent], NOW).awakeMs, 4 * 60 * MIN - MIN);
});

test('only sleep logged', () => {
  assert.deepEqual(status([sleepEnded40mAgo()]), { main: 'Awake 40m', detail: '' });
});

test('nothing logged', () => {
  assert.deepEqual(status([]), { main: 'Nothing logged yet', detail: '' });
});

test('deleted feeds are ignored', () => {
  const deleted = { ...makeBreastManual(NOW - 60 * MIN, 0, 10), deleted: true };
  assert.deepEqual(status([leftFeed(), deleted]), { main: 'Fed 2h 10m ago', detail: 'Next: right' });
});

test('next side follows the side the last feed ended on', () => {
  const s = computeStatus([makeBreastManual(NOW - 60 * MIN, 10, 5)], NOW);
  assert.equal(s.nextSide, 'L');
});

// A feed that started 35m ago and ended 20m ago, with a reminder that is
// counted start-to-start (35m + 70m = 1h 45m after it started).
const remindedFeed = () => ({ ...stopBreast(startBreast('L', NOW - 35 * MIN), NOW - 20 * MIN), remindAt: NOW + 70 * MIN });

test('a reminder set after a feed shows until it is due', () => {
  const feed = remindedFeed();
  assert.deepEqual(computeStatus([feed], NOW).reminder, { id: feed.id, from: NOW - 35 * MIN, at: NOW + 70 * MIN, due: false });
  assert.equal(computeStatus([feed], NOW + 70 * MIN).reminder.due, true);
});

test('the next feed clears the reminder', () => {
  const feed = remindedFeed(); // ended NOW - 20m
  assert.equal(computeStatus([feed, makeBottle(60, NOW + 10 * MIN)], NOW + 11 * MIN).reminder, null);
  assert.equal(computeStatus([feed, startBreast('R', NOW - MIN)], NOW).reminder, null);
});

test('a top-up bottle right after the breastfeed keeps the reminder', () => {
  const feed = remindedFeed(); // ended NOW - 20m
  const topUp = makeBottle(30, NOW - 20 * MIN);
  assert.equal(computeStatus([feed, topUp], NOW).reminder.at, NOW + 70 * MIN);
  const lateTopUp = makeBottle(30, NOW + 9 * MIN); // 29m after the feed ended
  assert.equal(computeStatus([feed, lateTopUp], NOW + 10 * MIN).reminder.at, NOW + 70 * MIN);
});

test('no reminder unless one was set', () => {
  assert.equal(computeStatus([leftFeed()], NOW).reminder, null);
  assert.equal(computeStatus([{ ...remindedFeed(), remindAt: null }], NOW).reminder, null);
  assert.equal(computeStatus([], NOW).reminder, null);
});

test('a reminder stays up while baby sleeps', () => {
  const s = computeStatus([remindedFeed(), startSleep(NOW - 10 * MIN)], NOW);
  assert.equal(s.reminder.at, NOW + 70 * MIN);
});

// Reminder durations are counted from the feed's start.
const fedWithReminder = (startMs, minutes) => ({ ...makeBreastManual(startMs, 15, 0), remindAt: startMs + minutes * MIN });

test('reminders start at 2h and step by 30 minutes', () => {
  assert.deepEqual(REMIND, { min: 120, max: 360, step: 30 });
});

test('the first reminder defaults to 2h', () => {
  const ev = makeBreastManual(NOW - 20 * MIN, 15, 0);
  assert.equal(reminderDefault([ev], ev), 120);
  assert.equal(reminderDefault([leftFeed(), ev], ev), 120);
});

test('the next reminder starts from the last one used', () => {
  const earlier = fedWithReminder(NOW - 300 * MIN, 150);
  const older = fedWithReminder(NOW - 600 * MIN, 210);
  const ev = makeBreastManual(NOW - 20 * MIN, 15, 0);
  assert.equal(reminderDefault([older, earlier, ev], ev), 150);
  // A feed whose reminder was cleared is skipped.
  assert.equal(reminderDefault([older, { ...earlier, remindAt: null }, ev], ev), 210);
  assert.equal(reminderDefault([older, { ...earlier, deleted: true }, ev], ev), 210);
});

test('changing a reminder starts from its own duration', () => {
  const earlier = fedWithReminder(NOW - 300 * MIN, 150);
  const ev = fedWithReminder(NOW - 20 * MIN, 240);
  assert.equal(reminderDefault([earlier, ev], ev), 240);
});

test('a remembered duration is rounded to a step and kept within range', () => {
  const ev = makeBreastManual(NOW - 20 * MIN, 15, 0);
  assert.equal(reminderDefault([fedWithReminder(NOW - 300 * MIN, 60), ev], ev), 120);
  assert.equal(reminderDefault([fedWithReminder(NOW - 600 * MIN, 420), ev], ev), 360);
  assert.equal(reminderDefault([fedWithReminder(NOW - 300 * MIN, 160), ev], ev), 150);
});
