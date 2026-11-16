import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toastSpot } from '../../app/js/ui/toast.js';

test('while a sheet is open the toast sits just above it', () => {
  // A running breastfeed sheet starts 428px down an 844px screen.
  assert.deepEqual(toastSpot(428, 844), { top: '', bottom: '428px' });
});

test('a sheet that fills the screen pushes the toast to the top', () => {
  assert.deepEqual(toastSpot(70, 844), { top: 'calc(var(--safe-top) + 12px)', bottom: 'auto' });
});
