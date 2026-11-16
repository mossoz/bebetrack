// Inline line icons (24x24, stroke = currentColor).
import { h } from './dom.js';

const PATHS = {
  breast: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bottle:
    '<path d="M9.5 2.5h5M10.5 2.5v2.5L8.5 8v11.5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V8l-2-3V2.5"/><path d="M8.5 12h7M8.5 16h7"/>',
  sleep: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  diaper: '<path d="M3.5 7.5h17v2.5a8.5 8.5 0 0 1-17 0z"/><path d="M8 7.5v2.5M16 7.5v2.5"/>',
  settings:
    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  prev: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
};

export function icon(name, cls = 'icon') {
  return h('span', {
    class: cls,
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`,
  });
}
