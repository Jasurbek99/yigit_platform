// One shared context for the page's lifetime: browsers cap how many a page may create.
let audioContext: AudioContext | null = null;

function chime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  [880, 1175].forEach((frequency, i) => {
    const start = now + i * 0.15;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

/**
 * Short two-tone chime, synthesised — no audio file to ship.
 *
 * Browsers refuse audio until the user has clicked or typed on the page at
 * least once. Before that we skip instead of queueing: a suspended context
 * would otherwise play the stale chime on the user's first click.
 */
export function playNotificationSound(): void {
  try {
    if (typeof AudioContext === 'undefined') return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    audioContext ??= new AudioContext();
    const ctx = audioContext;
    ctx.resume().then(() => chime(ctx), () => {});
  } catch {
    // Sound is a nicety — the toast and the bell still carry the notification.
  }
}
