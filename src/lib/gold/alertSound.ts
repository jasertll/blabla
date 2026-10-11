// Short two-tone chime for live buy/sell alerts. The AudioContext is
// created/resumed once, at toggle-on time (a real user gesture — the
// click that enables alerts), and reused for every later chime, since
// browser autoplay policy only requires the context to have been
// unlocked inside SOME prior user gesture on the page — not that every
// individual play() call be one. Later chimes fire from a polling timer,
// which is never itself a gesture.
let ctx: AudioContext | null = null;

export function unlockAlertAudio(): void {
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  if (!ctx) ctx = new AudioCtx();
  ctx.resume().catch(() => {});
}

function tone(context: AudioContext, freq: number, startAt: number, durationSec: number, gainPeak: number) {
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

// Buy: rising two-note (C5 -> G5). Sell: falling two-note (G5 -> C5) —
// audibly distinct without needing to look at the screen.
export function playAlertChime(direction: "buy" | "sell"): void {
  if (typeof window === "undefined" || !ctx) return;
  const t = ctx.currentTime;
  const [f1, f2] = direction === "buy" ? [523.25, 783.99] : [783.99, 523.25];
  tone(ctx, f1, t, 0.18, 0.18);
  tone(ctx, f2, t + 0.16, 0.22, 0.18);
}
