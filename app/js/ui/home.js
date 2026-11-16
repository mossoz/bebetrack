// The main screen: status line, the day's totals and timeline, day navigation,
// and the four big logging buttons.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { startOfDay, addDays, eventsForDay, dayTotals } from '../core/days.js';
import { computeStatus } from '../core/status.js';
import { isRunning } from '../core/events.js';
import {
  formatStatus,
  formatTotals,
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

export function renderHome(root, { store, session, openSheet }) {
  let today = startOfDay(Date.now());
  let day = today;

  const label = h('h1', { class: 'day-label' });
  const prev = h('button', { class: 'icon-btn', 'aria-label': 'Previous day' }, icon('prev'));
  const next = h('button', { class: 'icon-btn', 'aria-label': 'Next day' }, icon('next'));
  const settings = h('button', { class: 'icon-btn', 'aria-label': 'Settings' }, icon('settings'));
  const status = h('button', { class: 'status', type: 'button' });
  const totals = h('ul', { class: 'totals', 'aria-label': 'Day totals' });
  const timeline = h('ol', { class: 'timeline', 'aria-label': 'Timeline' });
  const empty = h('p', { class: 'empty' }, 'Nothing logged this day.');
  const content = h('div', { class: 'content' }, status, totals, timeline, empty);

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

    status.hidden = !isToday;
    if (isToday) {
      const s = computeStatus(all, now);
      status.textContent = formatStatus(s, unit);
      status.dataset.state = s.feeding ? 'feeding' : s.asleepMs !== null ? 'asleep' : 'idle';
    }

    const dayEvents = eventsForDay(all, day);
    clear(totals);
    totals.append(...formatTotals(dayTotals(dayEvents, now), unit).map((t) => h('li', null, t)));

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
    timer = setInterval(render, running ? 1000 : 30000);
  }

  store.subscribe(render);
  render();
  return { render };
}
