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
  resumeBreast,
  stopBreast,
  makeBreastManual,
  editBreast,
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
  REMIND_MINUTES,
  STEP,
  ozToMl,
  mlToOz,
  parseAmount,
  breastControls,
  formatClock,
  formatDuration,
  formatTime,
  toLocalInput,
  fromLocalInput,
  isFutureTime,
} from '../core/format.js';

const MIN = 60000;
const SIDE_NAME = { L: 'Left', R: 'Right' };
const FUTURE = 'That time is in the future.';
const DIAPER_KINDS = [
  ['wet', 'Wet'],
  ['solid', 'Solid'],
  ['both', 'Both'],
];

function timeField(label, ms) {
  const input = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(ms), max: toLocalInput(Date.now()) });
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
    toast.reattach(); // keep a showing toast visible after the sheet closes
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
    toast.reattach(); // clearing the dialog removed a toast that was showing in it
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
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = async () => {
      const at = fromLocalInput(time.input.value) ?? event.start;
      if (isFutureTime(at)) {
        error.textContent = FUTURE;
        return;
      }
      close();
      await save({ ...event, diaper: kind, start: at, end: at });
    };
    mount('Edit diaper', h('div', { class: 'choices three' }, buttons), time.el, error, ...formButtons(submit, event));
  }

  // ---------- Bottle ----------

  function bottleForm(event) {
    const unit = session.loadUnit();
    const startMl = event?.ml ?? latest('bottle')?.ml ?? 90;
    const toUnit = (ml) => (unit === 'oz' ? Math.round(mlToOz(ml) * 10) / 10 : ml);
    let amount = toUnit(startMl); // null while the typed text is not an amount
    let changed = false;
    const error = h('p', { class: 'error', role: 'alert' });
    // Tap the number to type an exact amount such as 30.5; − / + and the chips still work.
    const input = h('input', {
      class: 'readout-input',
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': `Amount in ${unit}`,
      value: String(amount),
      onfocus: () => input.select(),
      oninput: () => {
        fit();
        amount = parseAmount(input.value);
        changed = true;
        error.textContent = '';
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') input.blur();
      },
    });
    const fit = () => {
      input.style.width = `${Math.max(2, input.value.length) + 0.5}ch`;
    };
    fit();
    const readout = h('label', { class: 'readout' }, input, h('span', { class: 'readout-unit' }, unit));
    const set = (value) => {
      const next = Math.round(value * 10) / 10;
      if (!(next > 0)) return;
      amount = next;
      changed = true;
      input.value = String(amount);
      fit();
      error.textContent = '';
    };

    const time = timeField('Time', event?.start ?? Date.now());
    const submit = async () => {
      if (amount === null) {
        error.textContent = `Enter an amount, like ${unit === 'oz' ? '2.5' : '30.5'}.`;
        input.focus();
        return;
      }
      const ml = !changed ? startMl : unit === 'oz' ? ozToMl(amount) : amount;
      const at = fromLocalInput(time.input.value);
      if (at === null) {
        error.textContent = 'Pick a time.';
        return;
      }
      if (isFutureTime(at)) {
        error.textContent = FUTURE;
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
        h('button', { class: 'step big', type: 'button', 'aria-label': 'Less', onclick: () => set((amount ?? 0) - STEP[unit]) }, '−'),
        readout,
        h('button', { class: 'step big', type: 'button', 'aria-label': 'More', onclick: () => set((amount ?? 0) + STEP[unit]) }, '+'),
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
    // Each side button carries a caption (Now / Switch / Resume) so it is clear
    // how to carry on after a pause or change sides.
    const captions = { L: h('span', { class: 'choice-caption' }), R: h('span', { class: 'choice-caption' }) };
    const sideButtons = ['L', 'R'].map((s) =>
      h(
        'button',
        { class: 'choice type-breast', type: 'button', onclick: () => act((ev, now) => switchSide(ev, s, now)) },
        h('span', { class: 'choice-name' }, SIDE_NAME[s]),
        captions[s],
      ),
    );
    // Pause while a side is counting; Resume (the paused side) while paused.
    const toggle = h('button', {
      class: 'btn',
      type: 'button',
      onclick: () => act((ev, now) => (currentSide(ev) ? pauseBreast(ev, now) : resumeBreast(ev, now))),
    });
    const stop = h('button', {
      class: 'btn primary',
      type: 'button',
      onclick: async () => {
        const ev = store.get(id);
        if (!ev || !isRunning(ev)) return close();
        const { saved } = await save(stopBreast(ev, Date.now()));
        reminderForm(saved.id); // "Remind me?" for the next feed
      },
    }, 'Stop');

    const update = () => {
      const ev = store.get(id);
      if (!ev || !isRunning(ev)) return false;
      const now = Date.now();
      const side = currentSide(ev);
      const t = sideTotals(ev, now);
      const view = breastControls(ev);
      sideLabel.textContent = view.label;
      clock.textContent = formatClock(side ? t[side] : t.L + t.R);
      clock.classList.toggle('paused', view.paused);
      detail.textContent = `Left ${formatDuration(t.L)} · Right ${formatDuration(t.R)} · started ${formatTime(ev.start)}`;
      view.sides.forEach((v, i) => {
        sideButtons[i].setAttribute('aria-pressed', String(v.pressed));
        sideButtons[i].classList.toggle('resume', v.suggested);
        captions[v.side].textContent = v.caption;
      });
      toggle.textContent = view.toggle;
      return true;
    };
    mountLive('Feeding', [sideLabel, clock, detail, h('div', { class: 'choices two' }, sideButtons), h('div', { class: 'row' }, toggle, stop)], update);
  }

  // Next-feed reminder, counted start-to-start: from when this feed began.
  // Shown after Stop, and from the reminder bar on the home screen to change
  // or clear it. Times already past are greyed out.
  function reminderForm(id) {
    const ev = store.get(id);
    if (!ev || ev.deleted || isRunning(ev)) return close();
    const from = ev.start;
    const now = Date.now();
    const hasReminder = typeof ev.remindAt === 'number';
    const apply = async (remindAt, message) => {
      const current = store.get(id);
      close();
      if (current && !current.deleted && !isRunning(current)) await save({ ...current, remindAt }, message);
    };
    const chips = REMIND_MINUTES.map((minutes) => {
      const at = from + minutes * MIN;
      return h(
        'button',
        {
          class: `chip remind${at === ev.remindAt ? ' selected' : ''}`,
          type: 'button',
          disabled: at <= now,
          onclick: () => apply(at, `Reminder ${formatTime(at)}`),
        },
        h('span', { class: 'chip-main' }, formatDuration(minutes * MIN)),
        h('span', { class: 'chip-time' }, formatTime(at)),
      );
    });
    mount(
      hasReminder ? 'Feed reminder' : 'Remind me?',
      h('p', { class: 'muted' }, `Next feed, counted from the start of this one (${formatTime(from)}).`),
      h('div', { class: 'chips' }, chips),
      hasReminder
        ? h('button', { class: 'btn', type: 'button', onclick: () => apply(null, 'Reminder cleared') }, 'Clear reminder')
        : h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'No reminder'),
    );
  }

  function breastForm(event) {
    const t = event ? sideTotals(event, Date.now()) : { L: 0, R: 0 };
    const start = timeField('Started', event?.start ?? Date.now() - 20 * MIN);
    const left = minutesField('Left minutes', Math.round(t.L / MIN));
    const right = minutesField('Right minutes', Math.round(t.R / MIN));
    const error = h('p', { class: 'error', role: 'alert' });

    // A past feed with both sides: which one came first decides "next side".
    let firstSide = computeStatus(store.all(), Date.now()).nextSide ?? 'L';
    const firstButtons = ['L', 'R'].map((side) =>
      h('button', {
        class: 'segment',
        type: 'button',
        'aria-pressed': String(side === firstSide),
        onclick: () => {
          firstSide = side;
          firstButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(['L', 'R'][i] === firstSide)));
        },
      }, SIDE_NAME[side]),
    );
    const firstChoice = event
      ? null
      : h('div', { class: 'field-group' }, h('span', { class: 'label' }, 'Started on'), h('div', { class: 'segmented' }, firstButtons));

    const submit = async () => {
      const at = fromLocalInput(start.input.value);
      if (at === null) {
        error.textContent = 'Pick a start time.';
        return;
      }
      if (isFutureTime(at)) {
        error.textContent = FUTURE;
        return;
      }
      if (left.value() + right.value() <= 0) {
        error.textContent = 'Add minutes for at least one side.';
        return;
      }
      const built = event
        ? editBreast(event, at, left.value(), right.value())
        : makeBreastManual(at, left.value(), right.value(), firstSide);
      close();
      await save(built);
    };
    mount(
      event ? 'Edit breastfeed' : 'Past breastfeed',
      start.el,
      firstChoice,
      left.el,
      right.el,
      error,
      ...formButtons(submit, event),
    );
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
      if (isFutureTime(b)) {
        error.textContent = FUTURE;
        return;
      }
      close();
      await save(event ? { ...event, start: a, end: b } : makeSleepManual(a, b));
    };
    mount(event ? 'Edit sleep' : 'Past sleep', start.el, end.el, error, ...formButtons(submit, event));
  }

  // ---------- Dispatcher ----------

  return function openSheet(kind, event) {
    if (kind === 'reminder') return reminderForm(event.id);
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
