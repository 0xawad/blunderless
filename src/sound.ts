// Tiny synthesized sound set. No audio files, so nothing to load and nothing
// the CSP has to allow. Everything is a short envelope on an oscillator or
// a burst of filtered noise.
import { getPrefs } from './prefs';

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'correct' | 'wrong' | 'win' | 'lose' | 'draw' | 'tick';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(c: AudioContext, freq: number, start: number, dur: number, gain = 0.2, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(c.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** A short, dull wooden knock: filtered noise with a fast decay. */
function knock(c: AudioContext, start: number, cutoff: number, dur: number, gain: number) {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(start);
}

const PLAYERS: Record<SoundName, (c: AudioContext, t: number) => void> = {
  move: (c, t) => {
    knock(c, t, 1200, 0.08, 0.5);
    tone(c, 180, t, 0.07, 0.08, 'triangle');
  },
  capture: (c, t) => {
    knock(c, t, 700, 0.14, 0.7);
    tone(c, 110, t, 0.12, 0.12, 'triangle');
  },
  castle: (c, t) => {
    knock(c, t, 1200, 0.07, 0.45);
    knock(c, t + 0.09, 1200, 0.07, 0.4);
  },
  check: (c, t) => {
    knock(c, t, 1000, 0.08, 0.4);
    tone(c, 880, t, 0.18, 0.08);
    tone(c, 1320, t + 0.02, 0.16, 0.05);
  },
  promote: (c, t) => {
    tone(c, 660, t, 0.1, 0.1);
    tone(c, 880, t + 0.08, 0.14, 0.1);
    tone(c, 1320, t + 0.16, 0.22, 0.1);
  },
  correct: (c, t) => {
    tone(c, 740, t, 0.09, 0.09);
    tone(c, 1110, t + 0.07, 0.16, 0.09);
  },
  wrong: (c, t) => {
    tone(c, 220, t, 0.14, 0.12, 'square');
    tone(c, 196, t + 0.1, 0.18, 0.1, 'square');
  },
  win: (c, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.09, 0.3, 0.1));
  },
  lose: (c, t) => {
    [440, 392, 330, 262].forEach((f, i) => tone(c, f, t + i * 0.12, 0.3, 0.09, 'triangle'));
  },
  draw: (c, t) => {
    tone(c, 523, t, 0.25, 0.08);
    tone(c, 523, t + 0.2, 0.3, 0.08);
  },
  tick: (c, t) => tone(c, 1500, t, 0.03, 0.04),
};

export function play(name: SoundName) {
  if (!getPrefs().sound) return;
  const c = audio();
  if (!c) return;
  try {
    PLAYERS[name](c, c.currentTime);
  } catch {
    /* audio not available */
  }
}

/** Picks the right sound for a move that just happened. */
export function playMove(opts: { capture?: boolean; check?: boolean; castle?: boolean; promote?: boolean; mate?: boolean }) {
  if (opts.mate) return play('check');
  if (opts.promote) return play('promote');
  if (opts.check) return play('check');
  if (opts.capture) return play('capture');
  if (opts.castle) return play('castle');
  play('move');
}

/** Browsers need a user gesture before audio starts; call this from any click. */
export function unlockAudio() {
  audio();
}
