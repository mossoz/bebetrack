// Units, the passphrase (to set up a new phone), and leaving this phone.
import { h } from './dom.js';
import { BUILD } from '../version.js';

export function settingsSheet({ session, onUnitChange, close }) {
  const unitButtons = ['ml', 'oz'].map((unit) =>
    h('button', {
      class: 'segment',
      type: 'button',
      'aria-pressed': String(session.loadUnit() === unit),
      onclick: () => {
        session.saveUnit(unit);
        for (const b of unitButtons) b.setAttribute('aria-pressed', String(b.textContent === unit));
        onUnitChange();
      },
    }, unit),
  );

  const phrase = h('p', { class: 'passphrase small', hidden: true }, session.load()?.passphrase ?? '');
  const reveal = h('button', { class: 'btn', type: 'button' }, 'Show passphrase');
  reveal.addEventListener('click', () => {
    phrase.hidden = !phrase.hidden;
    reveal.textContent = phrase.hidden ? 'Show passphrase' : 'Hide passphrase';
  });

  const leave = h('button', { class: 'btn danger', type: 'button' }, 'Leave on this phone');
  leave.addEventListener('click', () => {
    const ok = window.confirm(
      'This phone will forget the passphrase. Your history stays on the other phone and in storage.',
    );
    if (!ok) return;
    session.clear();
    close();
    location.reload();
  });

  return [
    h('div', { class: 'field-group' }, h('span', { class: 'label' }, 'Bottle amounts'), h('div', { class: 'segmented' }, unitButtons)),
    h('div', { class: 'field-group' },
      h('span', { class: 'label' }, 'Passphrase'),
      h('p', { class: 'muted' }, 'Type it on a new phone to join.'),
      phrase,
      reveal,
    ),
    leave,
    h('p', { class: 'version' }, `Version ${BUILD.startsWith('__') ? 'dev' : BUILD}`),
  ];
}
