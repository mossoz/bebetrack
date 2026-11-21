// The event model. Every function is pure and returns a new object.
//
// Event = {
//   id, type: 'breast' | 'bottle' | 'sleep' | 'diaper',
//   start: ms, end: ms | null,              // null = still running (breast, sleep)
//   sides?: [{ side: 'L' | 'R', start, end | null }],   // breast only
//   ml?: number,                            // bottle only, to 0.1 ml
//   remindAt?: number | null,               // breast only: next-feed reminder time
//   diaper?: 'wet' | 'solid' | 'both',      // diaper only
//   deleted: boolean, updatedAt: number     // updatedAt is stamped by EventStore.save
// }

const MIN = 60000;
const TYPES = ['breast', 'bottle', 'sleep', 'diaper'];
const SIDES = ['L', 'R'];
const DIAPERS = ['wet', 'solid', 'both'];

function base(type, start, end) {
  return { id: crypto.randomUUID(), type, start, end, deleted: false, updatedAt: 0 };
}

export function makeDiaper(kind, at) {
  return { ...base('diaper', at, at), diaper: kind };
}

export function makeBottle(ml, at) {
  return { ...base('bottle', at, at), ml: Math.round(ml * 10) / 10 };
}

export function startBreast(side, at) {
  return { ...base('breast', at, null), sides: [{ side, start: at, end: null }] };
}

function closeOpenSegment(sides, at) {
  return sides.map((s) => (s.end === null ? { ...s, end: at } : s));
}

export function switchSide(ev, side, at) {
  if (currentSide(ev) === side) return ev;
  return { ...ev, sides: [...closeOpenSegment(ev.sides, at), { side, start: at, end: null }] };
}

export function pauseBreast(ev, at) {
  return { ...ev, sides: closeOpenSegment(ev.sides, at) };
}

// Continue a paused feed on the side it was paused on.
export function resumeBreast(ev, at) {
  if (currentSide(ev)) return ev;
  return switchSide(ev, lastSide(ev) ?? 'L', at);
}

export function stopBreast(ev, at) {
  return { ...ev, sides: closeOpenSegment(ev.sides, at), end: at };
}

function sequentialSides(start, minutesBySide, order) {
  const sides = [];
  let t = start;
  for (const side of order) {
    const minutes = minutesBySide[side];
    if (minutes > 0) {
      sides.push({ side, start: t, end: t + minutes * MIN });
      t += minutes * MIN;
    }
  }
  return { sides, end: t };
}

export function makeBreastManual(start, leftMin, rightMin, firstSide = 'L') {
  const order = firstSide === 'R' ? ['R', 'L'] : ['L', 'R'];
  const { sides, end } = sequentialSides(start, { L: leftMin, R: rightMin }, order);
  return { ...base('breast', start, end), sides };
}

// Edit a finished breastfeed. Unchanged minutes keep the exact segments
// (shifted if the start moved), so the side it ended on never flips.
export function editBreast(ev, start, leftMin, rightMin) {
  const totals = sideTotals(ev, ev.end ?? ev.start);
  if (Math.round(totals.L / MIN) === leftMin && Math.round(totals.R / MIN) === rightMin) {
    const delta = start - ev.start;
    return {
      ...ev,
      start,
      end: ev.end === null ? null : ev.end + delta,
      sides: ev.sides.map((s) => ({ ...s, start: s.start + delta, end: s.end === null ? null : s.end + delta })),
    };
  }
  const order = [...new Set([...[...ev.sides].sort((a, b) => a.start - b.start).map((s) => s.side), 'L', 'R'])];
  const { sides, end } = sequentialSides(start, { L: leftMin, R: rightMin }, order);
  return { ...ev, start, end, sides };
}

export function startSleep(at) {
  return base('sleep', at, null);
}

export function stopSleep(ev, at) {
  return { ...ev, end: at };
}

export function makeSleepManual(start, end) {
  return base('sleep', start, end);
}

export function isRunning(ev) {
  return (ev.type === 'breast' || ev.type === 'sleep') && ev.end === null && !ev.deleted;
}

export function sideTotals(ev, now) {
  const totals = { L: 0, R: 0 };
  for (const s of ev.sides ?? []) totals[s.side] += (s.end ?? now) - s.start;
  return totals;
}

export function currentSide(ev) {
  return ev.sides?.find((s) => s.end === null)?.side ?? null;
}

export function lastSide(ev) {
  let latest = null;
  for (const s of ev.sides ?? []) if (!latest || s.start >= latest.start) latest = s;
  return latest?.side ?? null;
}

export function durationMs(ev, now) {
  if (ev.type === 'breast') {
    const t = sideTotals(ev, now);
    return t.L + t.R;
  }
  if (ev.type === 'sleep') return (ev.end ?? now) - ev.start;
  return 0;
}

// Stable text for an event (sorted keys), so two phones compare content the same way.
export function canonical(ev) {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
        : v;
  return JSON.stringify(sort(ev));
}

export function sameEvent(a, b) {
  return canonical(a) === canonical(b);
}

// Newer updatedAt wins. A tie is broken by content, so both phones pick the same winner.
export function merge(current, incoming) {
  if (!current) return incoming;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt ? incoming : current;
  return canonical(incoming) > canonical(current) ? incoming : current;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x) => x === null || isNum(x);

export function isValidEvent(x) {
  if (!x || typeof x !== 'object') return false;
  if (typeof x.id !== 'string' || !TYPES.includes(x.type)) return false;
  if (!isNum(x.start) || !isNumOrNull(x.end) || typeof x.deleted !== 'boolean' || !isNum(x.updatedAt)) {
    return false;
  }
  switch (x.type) {
    case 'bottle':
      return isNum(x.ml);
    case 'diaper':
      return DIAPERS.includes(x.diaper);
    case 'breast':
      return (
        (x.remindAt === undefined || isNumOrNull(x.remindAt)) &&
        Array.isArray(x.sides) &&
        x.sides.every((s) => s && SIDES.includes(s.side) && isNum(s.start) && isNumOrNull(s.end))
      );
    default:
      return true;
  }
}
