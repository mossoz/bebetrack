// A soft chime for a due feed reminder. It only plays while the app is open on
// screen: phones pause web apps in the background. Browsers also only allow
// sound after a tap, so every tap in the app keeps the audio unlocked.
let ctx = null;

export function unlockChime() {
  const unlock = () => {
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state !== 'running') ctx.resume();
    } catch {
      // No Web Audio: the reminder still shows on screen.
    }
  };
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
}

export function chime() {
  try {
    navigator.vibrate?.([200, 120, 200]);
  } catch {
    // Vibration is optional.
  }
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') ctx.resume();
    const start = ctx.currentTime + 0.05;
    // Two rising notes, played twice.
    [0, 0.9].forEach((offset) =>
      [660, 880].forEach((freq, i) => {
        const t = start + offset + i * 0.3;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      }),
    );
  } catch {
    // Sound is best effort.
  }
}
