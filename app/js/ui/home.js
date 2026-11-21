// The main screen: status line, feed reminder, the day's recap tiles and
// timeline, day navigation, and the four big logging buttons.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { chime } from './chime.js';
import { startOfDay, addDays, eventsForDay, dayTotals } from '../core/days.js';
import { computeStatus } from '../core/status.js';
import { isRunning } from '../core/events.js';
import {
  formatStatus,
  formatDayTiles,
  formatReminder,
  formatEventSummary,
  formatDayLabel,
  formatTime,
} from '../core/format.js';

const KINDS = [
  ['breast', 'Breast'],
  ['bottle', 'Bottle'],
  ['sleep', 'Sleep'],
  ['diaper', 'Diaper'],
];
const SWIPE_PX = 60;
// Chime only when a reminder comes due while the app is on screen, not when
// someone opens the app long after it was due.
const CHIME_WINDOW_MS = 60000;

export function renderHome(root, { store, session, openSheet }) {
  let today = startOfDay(Date.now());
  let day = today;

  const label = h('h1', { class: 'day-label' });
  const prev = h('button', { class: 'icon-btn', 'aria-label': 'Previous day' }, icon('prev'));
  const next = h('button', { class: 'icon-btn', 'aria-label': 'Next day' }, icon('next'));
  const settings = h('button', { class: 'icon-btn', 'aria-label': 'Settings' }, icon('settings'));
  const status = h('button', { class: 'status', type: 'button' });
  const reminderText = h('span', { class: 'reminder-text' });
  const reminderBar = h('button', { class: 'reminder', type: 'button', hidden: true }, icon('bell', 'reminder-icon'), reminderText);
  const totals = h('ul', { class: 'tiles', 'aria-label': 'Day totals' });
  const timeline = h('ol', { class: 'timeline', 'aria-label': 'Timeline' });
  const empty = h('p', { class: 'empty' }, 'Nothing logged this day.');
  const content = h('div', { class: 'content' }, status, reminderBar, totals, timeline, empty);

  const bar = h(
    'nav',
    { class: 'actionbar', 'aria-label': 'Log an event' },
    KINDS.map(([kind, text]) =>
      h('button', { class: `action type-${kind}`, onclick: () => log(kind) }, icon(kind, 'action-icon'), h('span', null, text)),
    ),
  );

  clear(root);
  root.append(
    h('div', { class: 'home' }, h('header', { class: 'topbar' }, prev, label, next, settings), content, bar),
  );

  function goTo(newDay) {
    day = Math.min(newDay, today);
    render();
    content.scrollTop = 0;
  }

  function log(kind) {
    if (day !== today) goTo(today);
    openSheet(kind);
  }

  prev.addEventListener('click', () => goTo(addDays(day, -1)));
  next.addEventListener('click', () => goTo(addDays(day, 1)));
  settings.addEventListener('click', () => openSheet('settings'));

  let touch = null;
  content.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) / 2) return;
    goTo(addDays(day, dx > 0 ? -1 : 1));
  }, { passive: true });

  function render() {
    const now = Date.now();
    const newToday = startOfDay(now);
    if (newToday !== today) {
      if (day === today) day = newToday; // keep following "Today" past midnight
      today = newToday;
    }
    const unit = session.loadUnit();
    const all = store.all();
    const isToday = day === today;

    label.textContent = formatDayLabel(day, today);
    next.disabled = isToday;

    renderTop(all, now, unit);
    const dayEvents = eventsForDay(all, day);

    clear(timeline);
    timeline.append(
      ...dayEvents.map((ev) =>
        h(
          'li',
          { class: `event type-${ev.type}${isRunning(ev) ? ' running' : ''}` },
          h(
            'button',
            { type: 'button', onclick: () => openSheet(ev.type, ev) },
            h('time', { datetime: new Date(ev.start).toISOString() }, formatTime(ev.start)),
            h('span', { class: 'dot' }, icon(ev.type)),
            h('span', { class: 'summary' }, formatEventSummary(ev, unit, now)),
          ),
        ),
      ),
    );
    empty.hidden = dayEvents.length > 0;
    scheduleTick(all.some(isRunning));
  }

  // While a timer runs, only the status line and totals change each second.
  // The timeline stays put so a tap on a row is never lost to a re-render.
  function renderLive() {
    const now = Date.now();
    if (startOfDay(now) !== today) return render();
    const all = store.all();
    renderTop(all, now, session.loadUnit());
    if (!all.some(isRunning)) render();
  }

  // Status line, reminder and the day's tiles: everything above the timeline.
  function renderTop(all, now, unit) {
    const isToday = day === today;
    status.hidden = !isToday;
    let reminder = null;
    if (isToday) {
      const s = computeStatus(all, now);
      status.textContent = formatStatus(s, unit);
      status.dataset.state = s.feeding ? 'feeding' : s.asleepMs !== null ? 'asleep' : 'idle';
      reminder = s.reminder;
    }
    renderReminder(reminder, now);

    const tiles = formatDayTiles(dayTotals(eventsForDay(all, day), now), unit);
    const key = JSON.stringify(tiles);
    if (totals.dataset.key === key) return; // unchanged: leave the DOM alone
    totals.dataset.key = key;
    clear(totals);
    totals.append(
      ...tiles.map((t) =>
        h(
          'li',
          { class: `tile type-${t.kind}${t.empty ? ' zero' : ''}` },
          icon(t.kind, 'tile-icon'),
          h('span', { class: 'tile-value' }, t.value),
          h('span', { class: 'tile-caption' }, t.caption),
        ),
      ),
    );
  }

  let reminderId = null;
  let reminderTimer = null;
  const chimed = new Set();
  function renderReminder(reminder, now) {
    clearTimeout(reminderTimer);
    reminderBar.hidden = !reminder;
    reminderId = reminder?.id ?? null;
    if (!reminder) return;
    reminderText.textContent = formatReminder(reminder, now);
    reminderBar.classList.toggle('due', reminder.due);
    if (!reminder.due) {
      // Re-render the moment it comes due (timers can't wait longer than ~24 days).
      reminderTimer = setTimeout(render, Math.min(reminder.at - now + 50, 2 ** 31 - 1));
      return;
    }
    const key = `${reminder.id}:${reminder.at}`;
    if (chimed.has(key)) return;
    if (now - reminder.at >= CHIME_WINDOW_MS) chimed.add(key); // long past: no sound
    else if (document.visibilityState === 'visible') {
      chimed.add(key);
      chime();
    }
  }

  reminderBar.addEventListener('click', () => {
    const ev = reminderId && store.get(reminderId);
    if (ev) openSheet('reminder', ev);
  });

  status.addEventListener('click', () => {
    if (status.dataset.state === 'feeding') openSheet('breast');
    if (status.dataset.state === 'asleep') openSheet('sleep');
  });

  // Every 30s for "2h 10m ago"; every second while a timer runs.
  let timer = null;
  let fast = null;
  function scheduleTick(running) {
    if (timer && fast === running) return;
    clearInterval(timer);
    fast = running;
    timer = setInterval(running ? renderLive : render, running ? 1000 : 30000);
  }

  store.subscribe(render);
  render();
  return { render };
}
