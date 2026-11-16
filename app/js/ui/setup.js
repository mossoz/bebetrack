// First open: start a new shared log, or join one with the passphrase.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { deriveSecrets, normalizePassphrase } from '../core/crypto.js';
import { generatePassphrase, isStrongEnough, MIN_LENGTH } from '../core/passphrase.js';
import { claimSpace, checkSpace } from '../data/remote.js';

const TIMEOUT_MS = 15000;

const MESSAGES = {
  taken: 'This Bebetrack is already set up with a different passphrase. Use Join, or see the README to start over.',
  mismatch: "That passphrase doesn't match. Check the words and try again.",
  offline: "Couldn't reach the server. Setup needs a connection.",
  weak: `Use at least ${MIN_LENGTH} characters.`,
};

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

function brand() {
  return h('div', { class: 'brand' }, icon('sleep', 'brand-mark'), h('h1', null, 'Bebetrack'));
}

export function renderSetup(root, { db, onReady }) {
  const show = (...children) => {
    clear(root);
    root.append(h('section', { class: 'setup' }, ...children));
  };

  async function unlock(passphrase, button, errorEl, mode) {
    errorEl.textContent = '';
    if (!navigator.onLine) {
      errorEl.textContent = MESSAGES.offline;
      return;
    }
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Unlocking…';
    try {
      const secrets = await deriveSecrets(passphrase);
      if (mode === 'start') {
        await withTimeout(claimSpace(db, secrets.spaceId, secrets.spaceHash));
      } else if (!(await withTimeout(checkSpace(db, secrets.spaceId)))) {
        errorEl.textContent = MESSAGES.mismatch;
        return;
      }
      onReady({
        passphrase: normalizePassphrase(passphrase),
        keyB64: secrets.keyB64,
        spaceId: secrets.spaceId,
      });
    } catch (e) {
      if (e.message === 'space-taken') {
        errorEl.textContent = MESSAGES.taken;
      } else {
        console.error('bebetrack: setup failed', e);
        errorEl.textContent = MESSAGES.offline;
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function welcome() {
    show(
      brand(),
      h('p', { class: 'lede' }, 'One baby log, shared by both your phones. Only the two of you can read it.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: startNew }, 'Start new'),
        h('button', { class: 'btn', onclick: join }, 'Join with a passphrase'),
      ),
    );
  }

  function startNew() {
    let words = generatePassphrase();
    let custom = false;
    const phrase = h('p', { class: 'passphrase', 'aria-live': 'polite' }, words);
    const own = h('input', {
      class: 'field',
      type: 'text',
      autocapitalize: 'none',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: 'Your own passphrase',
      'aria-label': 'Your own passphrase',
      hidden: true,
    });
    const error = h('p', { class: 'error', role: 'alert' });
    const go = h('button', { class: 'btn primary' }, 'I saved it, start');
    const shuffle = h('button', { class: 'btn ghost' }, 'New words');
    const toggle = h('button', { class: 'link' }, 'Use my own instead');

    shuffle.addEventListener('click', () => {
      words = generatePassphrase();
      phrase.textContent = words;
    });
    toggle.addEventListener('click', () => {
      custom = !custom;
      own.hidden = !custom;
      phrase.hidden = custom;
      shuffle.hidden = custom;
      toggle.textContent = custom ? 'Suggest words instead' : 'Use my own instead';
      if (custom) own.focus();
    });
    go.addEventListener('click', () => {
      const chosen = custom ? own.value : words;
      if (custom && !isStrongEnough(chosen)) {
        error.textContent = MESSAGES.weak;
        return;
      }
      unlock(chosen, go, error, 'start');
    });

    show(
      brand(),
      h('h2', null, 'Your passphrase'),
      h('p', { class: 'muted' }, 'Both phones use it to unlock the log. Type it on the other phone to join.'),
      phrase,
      own,
      h('div', { class: 'row' }, shuffle, toggle),
      h('p', { class: 'warning' },
        "If you both lose this passphrase, your history can't be recovered. Write it down somewhere safe.",
      ),
      error,
      h('div', { class: 'stack' }, go, h('button', { class: 'btn ghost', onclick: welcome }, 'Back')),
    );
  }

  function join() {
    const input = h('input', {
      class: 'field',
      type: 'text',
      autocapitalize: 'none',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: 'five words from the other phone',
      'aria-label': 'Passphrase',
    });
    const error = h('p', { class: 'error', role: 'alert' });
    const go = h('button', { class: 'btn primary' }, 'Join');
    const submit = () => {
      if (!input.value.trim()) return;
      unlock(input.value, go, error, 'join');
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

    show(
      brand(),
      h('h2', null, 'Join'),
      h('p', { class: 'muted' }, 'Type the passphrase shown on the other phone.'),
      input,
      error,
      h('div', { class: 'stack' }, go, h('button', { class: 'btn ghost', onclick: welcome }, 'Back')),
    );
    input.focus();
  }

  welcome();
}

export function renderNotConfigured(root) {
  clear(root);
  root.append(
    h('section', { class: 'setup' }, brand(), h('p', { class: 'lede' }, "Bebetrack isn't configured yet. See the README.")),
  );
}
