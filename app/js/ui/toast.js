// A short "Saved · Undo" message instead of "are you sure?" dialogs.
import { h, clear } from './dom.js';

const SHOW_MS = 5000;
const GAP = 12;
// Space a toast needs above a sheet: the status bar or notch, the toast, and gaps.
const ROOM_ABOVE_SHEET = 140;

// Where the toast goes while a sheet is open: just above the sheet, so it never
// covers the sheet's buttons. If the sheet fills the screen, at the very top.
export function toastSpot(sheetTop, viewportHeight) {
  if (sheetTop >= ROOM_ABOVE_SHEET) return { top: '', bottom: `${viewportHeight - sheetTop + GAP}px` };
  return { top: `calc(var(--safe-top) + ${GAP}px)`, bottom: 'auto' };
}

export function createToast(el, store) {
  let timer = null;
  // A sheet can change height after the toast appears (a timer sheet fills in
  // its text right after it opens), so follow it while the toast shows.
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => reattach()) : null;
  let watched = null;

  function watch(sheet) {
    if (watched === sheet) return;
    watcher?.disconnect();
    if (sheet) watcher?.observe(sheet);
    watched = sheet;
  }

  function hide() {
    clearTimeout(timer);
    watch(null);
    el.classList.remove('show');
  }

  // A modal sheet sits in the top layer, so the toast moves into it to stay
  // visible, and sits above it. Without a sheet it goes back to its CSS spot.
  function place() {
    const sheet = document.querySelector('dialog[open]');
    const host = sheet ?? document.body;
    if (el.parentElement !== host) host.append(el);
    const spot = sheet ? toastSpot(sheet.getBoundingClientRect().top, window.innerHeight) : { top: '', bottom: '' };
    el.style.top = spot.top;
    el.style.bottom = spot.bottom;
    watch(sheet);
  }

  function show(message, result) {
    clearTimeout(timer);
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
    place();
    el.classList.add('show');
    timer = setTimeout(hide, SHOW_MS);
  }

  // Called after a sheet opens, closes or changes height.
  function reattach() {
    if (el.classList.contains('show')) place();
  }

  return { show, hide, reattach };
}
