// Synthesized sound set. No audio files, so nothing to download and nothing
// the CSP has to allow.
//
// Everything runs through one bus: a gentle compressor so overlapping sounds
// never clip, plus a short synthetic room reverb on a send so tones sit in a
// space instead of beeping in a vacuum. Piece sounds are soft wooden "tocks"
// (a pitched body that drops fast, plus a filtered click), with a little
// random variation so a run of moves doesn't sound like a machine gun.
// Feedback tones are soft bells (a few inharmonic sine partials) instead of
// raw square waves.
import { getPrefs } from './prefs';

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'correct' | 'wrong' | 'win' | 'lose' | 'draw' | 'tick';

interface Bus {
  c: AudioContext;
  dry: GainNode;
  wet: GainNode;
  noise: AudioBuffer;
}

let bus: Bus | null = null;

/** A second of decaying stereo noise: a cheap, convincing small-room impulse. */
function roomImpulse(c: AudioContext, seconds = 0.9): AudioBuffer {
  const n = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3.2;
  }
  return buf;
}

function whiteNoise(c: AudioContext, seconds = 0.5): AudioBuffer {
  const n = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function getBus(): Bus | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!bus) {
    const c = new AudioContext({ latencyHint: 'interactive' });
    const master = c.createGain();
    master.gain.value = 0.85;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    // Take the fizz off the top so nothing sounds digital.
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 9000;
    master.connect(tone).connect(comp).connect(c.destination);

    const dry = c.createGain();
    dry.connect(master);
    const verb = c.createConvolver();
    verb.buffer = roomImpulse(c);
    const wet = c.createGain();
    wet.gain.value = 0.18;
    wet.connect(verb).connect(master);
    bus = { c, dry, wet, noise: whiteNoise(c) };
  }
  if (bus.c.state === 'suspended') bus.c.resume().catch(() => {});
  return bus;
}

/** Sends a node to the dry bus and, scaled by `room`, to the reverb. */
function out(b: Bus, node: AudioNode, room = 0.3) {
  node.connect(b.dry);
  if (room > 0) {
    const send = b.c.createGain();
    send.gain.value = room;
    node.connect(send).connect(b.wet);
  }
}

const vary = (x: number, amount = 0.04) => x * (1 + (Math.random() * 2 - 1) * amount);

/**
 * Wooden piece-on-board knock. `pitch` sets the body (lower = heavier),
 * `weight` the loudness and length.
 */
function tock(b: Bus, t: number, pitch: number, weight = 1) {
  const { c } = b;
  const f = vary(pitch);

  // Body: a sine that drops quickly, like a hollow wooden thud.
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(f * 1.9, t);
  body.frequency.exponentialRampToValueAtTime(f, t + 0.025);
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.32 * weight, t + 0.003);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + 0.05 * weight);
  body.connect(bg);
  out(b, bg, 0.12);
  body.start(t);
  body.stop(t + 0.2 + 0.05 * weight);

  // Contact: a very short band-passed click for the surface of the board.
  const n = c.createBufferSource();
  n.buffer = b.noise;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = vary(2600, 0.08);
  bp.Q.value = 1.4;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.22 * weight, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
  n.connect(bp).connect(ng);
  out(b, ng, 0.08);
  n.start(t, Math.random() * 0.4, 0.04);
}

/** Soft bell: a few slightly inharmonic sine partials with a smooth attack and long tail. */
function bell(b: Bus, t: number, freq: number, opts: { gain?: number; decay?: number; room?: number } = {}) {
  const { c } = b;
  const gain = opts.gain ?? 0.09;
  const decay = opts.decay ?? 0.55;
  const partials: [number, number][] = [
    [1, 1],
    [2.005, 0.28],
    [3.01, 0.08],
  ];
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  out(b, g, opts.room ?? 0.45);
  for (const [ratio, level] of partials) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    const pg = c.createGain();
    pg.gain.value = level;
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

/** A short, low, rounded "nope": a sine sliding down, no buzz. */
function thud(b: Bus, t: number, from: number, to: number, dur: number, gain = 0.16) {
  const { c } = b;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  out(b, g, 0.15);
  o.start(t);
  o.stop(t + dur + 0.03);
}

// Notes (Hz) on a calm pentatonic so combined cues never clash.
const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.51, G4: 392, E4: 329.63, C4: 261.63, A4: 440 };

const PLAYERS: Record<SoundName, (b: Bus, t: number) => void> = {
  move: (b, t) => tock(b, t, 210, 1),
  capture: (b, t) => {
    tock(b, t, 150, 1.4);
    tock(b, t + 0.035, 230, 0.55);
  },
  castle: (b, t) => {
    tock(b, t, 220, 0.45);
    tock(b, t + 0.085, 185, 0.45);
  },
  check: (b, t) => {
    tock(b, t, 200, 1);
    bell(b, t + 0.01, N.E6, { gain: 0.05, decay: 0.45 });
  },
  promote: (b, t) => {
    tock(b, t, 220, 0.8);
    bell(b, t + 0.03, N.G5, { gain: 0.06, decay: 0.4 });
    bell(b, t + 0.11, N.C6, { gain: 0.07, decay: 0.6 });
  },
  correct: (b, t) => {
    bell(b, t, N.E5, { gain: 0.06, decay: 0.35, room: 0.35 });
    bell(b, t + 0.075, N.A5, { gain: 0.07, decay: 0.55, room: 0.35 });
  },
  wrong: (b, t) => thud(b, t, 260, 150, 0.2, 0.32),
  win: (b, t) => {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => bell(b, t + i * 0.085, f, { gain: 0.065, decay: 0.9 + i * 0.15 }));
  },
  lose: (b, t) => {
    [N.A4, N.E4, N.C4].forEach((f, i) => bell(b, t + i * 0.13, f, { gain: 0.07, decay: 0.8, room: 0.5 }));
  },
  draw: (b, t) => {
    bell(b, t, N.G4, { gain: 0.06, decay: 0.6 });
    bell(b, t + 0.16, N.G4, { gain: 0.05, decay: 0.8 });
  },
  tick: (b, t) => bell(b, t, 1568, { gain: 0.06, decay: 0.12, room: 0.1 }),
};

// Two sounds of the same kind fired within a few ms (e.g. a move echoed by
// two listeners) should play once, not phase against each other.
const lastAt: Partial<Record<SoundName, number>> = {};

export function play(name: SoundName) {
  if (!getPrefs().sound) return;
  const b = getBus();
  if (!b) return;
  const now = b.c.currentTime;
  if (now - (lastAt[name] ?? -1) < 0.03) return;
  lastAt[name] = now;
  try {
    // A hair of lookahead so the first envelope point is never in the past.
    PLAYERS[name](b, now + 0.005);
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
  getBus();
}
