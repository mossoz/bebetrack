// Bottom sheets for logging, timers, editing and settings. One <dialog> is
// reused for all of them. Live sheets (running timers) keep their buttons and
// only update text each second, so a tap never lands on a replaced element.
import { h, clear } from './dom.js';
import { settingsSheet } from './settings.js';
import {
  makeDiaper,
  makeBottle,
  startBreast,
  switchSide,
  pauseBreast,
  stopBreast,
  makeBreastManual,
  startSleep,
  stopSleep,
  makeSleepManual,
  isRunning,
  sideTotals,
  currentSide,
} from '../core/events.js';
import { computeStatus } from '../core/status.js';
import {
  QUICK_AMOUNTS,
  STEP,
  ozToMl,
  mlToOz,
  formatClock,
  formatDuration,
  formatTime,
  toLocalInput,
  fromLocalInput,
} from '../core/format.js';

const MIN = 60000;
const SIDE_NAME = { L: 'Left', R: 'Right' };
const DIAPER_KINDS = [
  ['wet', 'Wet'],
  ['solid', 'Solid'],
  ['both', 'Both'],
];

function timeField(label, ms) {
  const input = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(ms) });
  return { el: h('label', { class: 'field-group' }, h('span', { class: 'label' }, label), input), input };
}

function minutesField(label, initial) {
  const input = h('input', {
    class: 'field number',
    type: 'number',
    inputmode: 'numeric',
    min: '0',
    step: '1',
    value: String(initial),
    'aria-label': label,
  });
  const bump = (d) => {
    input.value = String(Math.max(0, (parseInt(input.value, 10) || 0) + d));
  };
  const el = h(
    'div',
    { class: 'field-group' },
    h('span', { class: 'label' }, label),
    h(
      'div',
      { class: 'stepper' },
      h('button', { class: 'step', type: 'button', 'aria-label': `${label}: less`, onclick: () => bump(-1) }, '−'),
      input,
      h('button', { class: 'step', type: 'button', 'aria-label': `${label}: more`, onclick: () => bump(1) }, '+'),
    ),
  );
  return { el, value: () => Math.max(0, parseInt(input.value, 10) || 0) };
}

export function createSheets({ dialog, store, session, toast, onUnitChange }) {
  let live = null;
  let tick = null;

  function stopLive() {
    live = null;
    clearInterval(tick);
    tick = null;
  }

  function close() {
    stopLive();
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // tap on the backdrop
  });
  dialog.addEventListener('close', stopLive);
  store.subscribe(() => live?.());

  function mount(title, ...body) {
    stopLive();
    clear(dialog);
    dialog.append(
      h(
        'div',
        { class: 'sheet' },
        h(
          'div',
          { class: 'sheet-head' },
          h('h2', null, title),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '✕'),
        ),
        h('div', { class: 'stack' }, ...body),
      ),
    );
    if (!dialog.open) dialog.showModal();
  }

  function mountLive(title, nodes, update) {
    mount(title, ...nodes);
    if (!update()) return close();
    live = () => {
      if (!update()) close();
    };
    tick = setInterval(live, 1000);
  }

  async function save(event, message = 'Saved') {
    const result = await store.save(event);
    toast.show(message, result);
    return result;
  }

  async function remove(id) {
    toast.show('Deleted', await store.remove(id));
  }

  const latest = (type, filter = () => true) =>
    store
      .all()
      .filter((e) => e.type === type && filter(e))
      .sort((a, b) => b.start - a.start)[0];

  function formButtons(submit, event) {
    return [
      h('button', { class: 'btn primary', type: 'button', onclick: submit }, 'Save'),
      event
        ? h('button', {
            class: 'btn danger',
            type: 'button',
            onclick: async () => {
              close();
              await remove(event.id);
            },
          }, 'Delete')
        : null,
    ];
  }

  // ---------- Diaper ----------

  function diaperNew() {
    mount(
      'Diaper',
      h(
        'div',
        { class: 'choices three' },
        DIAPER_KINDS.map(([kind, label]) =>
          h('button', {
            class: 'choice type-diaper',
            type: 'button',
            onclick: async () => {
              close();
              await save(makeDiaper(kind, Date.now()));
            },
          }, label),
        ),
      ),
    );
  }

  function diaperEdit(event) {
    let kind = event.diaper;
    const buttons = DIAPER_KINDS.map(([k, label]) =>
      h('button', {
        class: 'choice type-diaper',
        type: 'button',
        'aria-pressed': String(k === kind),
        onclick: () => {
          kind = k;
          buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(DIAPER_KINDS[i][0] === kind)));
        },
      }, label),
    );
    const time = timeField('Time', event.start);
    const submit = async () => {
      const at = fromLocalInput(time.input.value) ?? event.start;
      close();
      await save({ ...event, diaper: kind, start: at, end: at });
    };
    mount('Edit diaper', h('div', { class: 'choices three' }, buttons), time.el, ...formButtons(submit, event));
  }

  // ---------- Bottle ----------

  function bottleForm(event) {
    const unit = session.loadUnit();
    const startMl = event?.ml ?? latest('bottle')?.ml ?? 90;
    const toUnit = (ml) => (unit === 'oz' ? Math.round(mlToOz(ml) * 10) / 10 : ml);
    let amount = toUnit(startMl);
    let changed = false;
    const readout = h('output', { class: 'readout' });
    const show = () => {
      readout.textContent = `${amount} ${unit}`;
    };
    const set = (value) => {
      amount = Math.max(STEP[unit], Math.round(value * 10) / 10);
      changed = true;
      show();
    };
    show();

    const time = timeField('Time', event?.start ?? Date.now());
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = async () => {
      const ml = !changed ? startMl : unit === 'oz' ? ozToMl(amount) : Math.round(amount);
      const at = fromLocalInput(time.input.value);
      if (at === null) {
        error.textContent = 'Pick a time.';
        return;
      }
      close();
      await save(event ? { ...event, ml, start: at, end: at } : makeBottle(ml, at));
    };

    mount(
      event ? 'Edit bottle' : 'Bottle',
      h(
        'div',
        { class: 'amount' },
        h('button', { class: 'step big', type: 'button', 'aria-label': 'Less', onclick: () => set(amount - STEP[unit]) }, '−'),
        readout,
        h('button', { class: 'step big', type: 'button', 'aria-label': 'More', onclick: () => set(amount + STEP[unit]) }, '+'),
      ),
      h(
        'div',
        { class: 'chips' },
        QUICK_AMOUNTS[unit].map((q) => h('button', { class: 'chip', type: 'button', onclick: () => set(q) }, `${q} ${unit}`)),
      ),
      time.el,
      error,
      ...formButtons(submit, event),
    );
  }

  // ---------- Breastfeeding ----------

  function breastNew() {
    const next = computeStatus(store.all(), Date.now()).nextSide;
    const start = (side) => async () => {
      const { saved } = await save(startBreast(side, Date.now()), 'Started');
      breastRunning(saved.id);
    };
    mount(
      'Breastfeed',
      next ? h('p', { class: 'muted' }, `Next side: ${SIDE_NAME[next].toLowerCase()}`) : null,
      h(
        'div',
        { class: 'choices two' },
        ['L', 'R'].map((s) =>
          h('button', { class: `choice type-breast${s === next ? ' suggested' : ''}`, type: 'button', onclick: start(s) }, SIDE_NAME[s]),
        ),
      ),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => breastForm() }, 'Add past feed'),
    );
  }

  function breastRunning(id) {
    const sideLabel = h('p', { class: 'clock-label' });
    const clock = h('p', { class: 'clock' });
    const detail = h('p', { class: 'muted center' });
    const act = async (fn) => {
      const ev = store.get(id);
      if (ev && isRunning(ev)) await store.save(fn(ev, Date.now()));
    };
    const sideButtons = ['L', 'R'].map((s) =>
      h('button', { class: 'choice type-breast', type: 'button', onclick: () => act((ev, now) => switchSide(ev, s, now)) }, SIDE_NAME[s]),
    );
    const pause = h('button', { class: 'btn', type: 'button', onclick: () => act(pauseBreast) }, 'Pause');
    const stop = h('button', {
      class: 'btn primary',
      type: 'button',
      onclick: async () => {
        const ev = store.get(id);
        close();
        if (ev && isRunning(ev)) await save(stopBreast(ev, Date.now()));
      },
    }, 'Stop');

    const update = () => {
      const ev = store.get(id);
      if (!ev || !isRunning(ev)) return false;
      const now = Date.now();
      const side = currentSide(ev);
      const t = sideTotals(ev, now);
      sideLabel.textContent = side ? `${SIDE_NAME[side]} side` : 'Paused';
      clock.textContent = formatClock(side ? t[side] : t.L + t.R);
      detail.textContent = `Left ${formatDuration(t.L)} · Right ${formatDuration(t.R)} · started ${formatTime(ev.start)}`;
      sideButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(['L', 'R'][i] === side)));
      pause.disabled = !side;
      return true;
    };
    mountLive('Feeding', [sideLabel, clock, detail, h('div', { class: 'choices two' }, sideButtons), h('div', { class: 'row' }, pause, stop)], update);
  }

  function breastForm(event) {
    const t = event ? sideTotals(event, Date.now()) : { L: 0, R: 0 };
    const start = timeField('Started', event?.start ?? Date.now() - 20 * MIN);
    const left = minutesField('Left minutes', Math.round(t.L / MIN));
    const right = minutesField('Right minutes', Math.round(t.R / MIN));
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = async () => {
      const at = fromLocalInput(start.input.value);
      if (at === null) {
        error.textContent = 'Pick a start time.';
        return;
      }
      if (left.value() + right.value() <= 0) {
        error.textContent = 'Add minutes for at least one side.';
        return;
      }
      const built = makeBreastManual(at, left.value(), right.value());
      close();
      await save(event ? { ...built, id: event.id } : built);
    };
    mount(event ? 'Edit breastfeed' : 'Past breastfeed', start.el, left.el, right.el, error, ...formButtons(submit, event));
  }

  // ---------- Sleep ----------

  function sleepNew() {
    mount(
      'Sleep',
      h('button', {
        class: 'choice wide type-sleep',
        type: 'button',
        onclick: async () => {
          const { saved } = await save(startSleep(Date.now()), 'Started');
          sleepRunning(saved.id);
        },
      }, 'Fell asleep now'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => sleepForm() }, 'Add past sleep'),
    );
  }

  function sleepRunning(id) {
    const since = h('p', { class: 'clock-label' });
    const clock = h('p', { class: 'clock' });
    const woke = h('button', {
      class: 'btn primary',
      type: 'button',
      onclick: async () => {
        const ev = store.get(id);
        close();
        if (ev && isRunning(ev)) await save(stopSleep(ev, Date.now()));
      },
    }, 'Woke up');
    const update = () => {
      const ev = store.get(id);
      if (!ev || !isRunning(ev)) return false;
      since.textContent = `Asleep since ${formatTime(ev.start)}`;
      clock.textContent = formatClock(Date.now() - ev.start);
      return true;
    };
    mountLive('Sleeping', [since, clock, woke], update);
  }

  function sleepForm(event) {
    const now = Date.now();
    const start = timeField('Fell asleep', event?.start ?? now - 60 * MIN);
    const end = timeField('Woke up', event?.end ?? now);
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = async () => {
      const a = fromLocalInput(start.input.value);
      const b = fromLocalInput(end.input.value);
      if (a === null || b === null || b <= a) {
        error.textContent = 'Waking up has to be after falling asleep.';
        return;
      }
      close();
      await save(event ? { ...event, start: a, end: b } : makeSleepManual(a, b));
    };
    mount(event ? 'Edit sleep' : 'Past sleep', start.el, end.el, error, ...formButtons(submit, event));
  }

  // ---------- Dispatcher ----------

  return function openSheet(kind, event) {
    if (kind === 'settings') return mount('Settings', ...settingsSheet({ session, onUnitChange, close }));
    if (event && !isRunning(event)) {
      if (event.type === 'diaper') return diaperEdit(event);
      if (event.type === 'bottle') return bottleForm(event);
      if (event.type === 'breast') return breastForm(event);
      if (event.type === 'sleep') return sleepForm(event);
    }
    if (kind === 'breast') {
      const running = event ?? latest('breast', isRunning);
      return running ? breastRunning(running.id) : breastNew();
    }
    if (kind === 'sleep') {
      const running = event ?? latest('sleep', isRunning);
      return running ? sleepRunning(running.id) : sleepNew();
    }
    if (kind === 'bottle') return bottleForm();
    if (kind === 'diaper') return diaperNew();
  };
}
