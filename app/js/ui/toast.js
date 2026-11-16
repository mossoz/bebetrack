// A short "Saved · Undo" message instead of "are you sure?" dialogs.
import { h, clear } from './dom.js';

const SHOW_MS = 5000;

export function createToast(el, store) {
  let timer = null;

  function hide() {
    clearTimeout(timer);
    el.classList.remove('show');
  }

  function show(message, result) {
    clearTimeout(timer);
    // A modal sheet sits in the top layer; move the toast into it so it stays visible.
    const host = document.querySelector('dialog[open]') ?? document.body;
    if (el.parentElement !== host) host.append(el);
    clear(el);
    el.append(h('span', null, message));
    if (result) {
      el.append(
        h('button', {
          class: 'toast-undo',
          type: 'button',
          onclick: async () => {
            hide();
            await store.undo(result);
            show('Undone');
          },
        }, 'Undo'),
      );
    }
    el.classList.add('show');
    timer = setTimeout(hide, SHOW_MS);
  }

  function reattach() {
    if (!el.classList.contains('show')) return;
    const host = document.querySelector('dialog[open]') ?? document.body;
    if (el.parentElement !== host) host.append(el);
  }

  return { show, hide, reattach };
}
