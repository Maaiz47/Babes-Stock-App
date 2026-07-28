/**
 * The audible alarm engine.
 *
 * A module-level singleton built entirely on the Web Audio API — no audio asset
 * to download, no <audio> element to be silenced by the iOS ringer switch, and
 * it can be genuinely loud. Everything is feature-detected and SSR-safe: the
 * module is imported by client components but must survive being evaluated on
 * the server, so nothing touches `window` at module scope except behind a guard.
 *
 * iOS note: audio only works if an AudioContext was created/resumed inside a
 * real user gesture. `unlockAudio()` is that gesture, and it must be called
 * before any alarm can be heard.
 */

export type AlarmSound = 'siren' | 'chime' | 'pulse';

const ALARM_SOUNDS: AlarmSound[] = ['siren', 'chime', 'pulse'];

/** Hard ceiling on the output gain so the speaker never clips into a rattle. */
const MAX_GAIN = 0.9;
/** Gain ramp applied to the start and end of every note — kills the clicks. */
const RAMP_S = 0.03;

/** How often the scheduler wakes up, and how far ahead it schedules. */
const PUMP_MS = 200;
const LOOKAHEAD_S = 0.6;

const SIREN_LOW = 880;
const SIREN_HIGH = 1320;
const SIREN_LEG_S = 0.5;

const CYCLE_S = 2;

interface Note {
  at: number;     // offset from the start of the cycle, seconds
  freq: number;
  dur: number;
  type: OscillatorType;
}

/** 3-note arpeggio, G5 / B5 / E6, repeating every 2s. */
const CHIME_NOTES: Note[] = [
  { at: 0, freq: 784, dur: 0.4, type: 'triangle' },
  { at: 0.18, freq: 988, dur: 0.4, type: 'triangle' },
  { at: 0.36, freq: 1319, dur: 0.55, type: 'triangle' },
];

/** Bursts of four 150ms-on / 150ms-off square beeps every 2s. */
const PULSE_NOTES: Note[] = [0, 0.3, 0.6, 0.9].map(at => ({
  at,
  freq: 1000,
  dur: 0.15,
  type: 'square' as OscillatorType,
}));

// ---------------------------------------------------------------- state

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

let playing = false;
let currentSound: AlarmSound = 'siren';
let currentVolume = 1;

let pumpId: ReturnType<typeof setInterval> | null = null;
/** Absolute AudioContext time the next cycle (or siren leg) starts at. */
let cursor = 0;
let sirenVoice: Voice | null = null;
let sirenHigh = false;
/**
 * Set when the siren's oscillator can no longer be trusted: it reported itself
 * finished while the alarm was still meant to be sounding, or the AudioContext
 * left 'running' underneath it (iOS suspends the context when the screen locks
 * and marks it 'interrupted' for a phone call or a system alarm, and the nodes
 * inside do not reliably survive either).
 *
 * The siren is one long-lived oscillator, so a dead one is silent forever: pump()
 * goes on ramping a node that will never sound again, and `playing` stays true so
 * startAlarm() early-returns. This flag is what makes the rebuild reachable.
 * chime and pulse need none of it — they allocate a fresh oscillator per note.
 */
let sirenStale = false;
const voices = new Set<Voice>();

// ---------------------------------------------------------------- plumbing

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** True when this browser can make a sound at all. */
export function isAudioSupported(): boolean {
  return audioContextCtor() !== null;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    watchContextState(ctx);
    return ctx;
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

/**
 * Follow the context in and out of 'running'.
 *
 * Leaving it is the moment a running oscillator can be killed without any event
 * at all; coming back is the moment to rebuild. This fires for interruptions the
 * page never sees as a visibilitychange — a phone call answered with the app
 * still on screen, for one.
 */
function watchContextState(c: AudioContext): void {
  if (typeof c.addEventListener !== 'function') return;
  c.addEventListener('statechange', () => {
    if (!playing) return;
    if (!isRunning(c)) {
      if (currentSound === 'siren') sirenStale = true;
      return;
    }
    resumePlayback();
  });
}

function clampVolume(volume: number): number {
  const v = Number.isFinite(volume) ? volume : 1;
  return Math.max(0, Math.min(1, v)) * MAX_GAIN;
}

/**
 * Kept as its own function so TypeScript does not narrow `state` away across the
 * awaits in resumeContext(): the whole point is that it changes underneath us.
 */
function isRunning(c: AudioContext): boolean {
  return c.state === 'running';
}

/** Nudge a suspended (or iOS-"interrupted") context back to life. */
async function resumeContext(): Promise<boolean> {
  const c = ensureContext();
  if (!c) return false;
  if (isRunning(c)) return true;
  try {
    await c.resume();
  } catch {
    /* a resume outside a gesture is allowed to fail */
  }
  return isRunning(c);
}

/**
 * Must be called from inside a user gesture (a tap handler). Creates/resumes the
 * AudioContext and plays one silent sample, which is the only thing that
 * persuades iOS to let the page make noise later.
 */
export async function unlockAudio(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const c = ensureContext();
  if (!c) return false;

  await resumeContext();

  try {
    const buffer = c.createBuffer(1, 1, c.sampleRate);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(0);
  } catch {
    /* the silent ping is a formality; the resume above is what matters */
  }

  unlocked = isRunning(c);
  return unlocked;
}

/** Whether audio has been unlocked in this page load. */
export function isAudioUnlocked(): boolean {
  if (!ctx) return false;
  return unlocked && isRunning(ctx);
}

/** Coerce a free-text settings value into a sound we can actually play. */
export function normalizeAlarmSound(value: string | null | undefined): AlarmSound {
  const v = (value ?? '').toLowerCase() as AlarmSound;
  return ALARM_SOUNDS.includes(v) ? v : 'siren';
}

// ---------------------------------------------------------------- scheduling

function scheduleNote(c: AudioContext, out: GainNode, note: Note, startAt: number): void {
  const gain = c.createGain();
  const end = startAt + note.dur;
  // Ramp in and out so every note starts and stops silently instead of clicking.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1, startAt + RAMP_S);
  gain.gain.setValueAtTime(1, Math.max(startAt + RAMP_S, end - RAMP_S));
  gain.gain.linearRampToValueAtTime(0, end);

  const osc = c.createOscillator();
  osc.type = note.type;
  osc.frequency.setValueAtTime(note.freq, startAt);
  osc.connect(gain);
  gain.connect(out);
  osc.start(startAt);
  osc.stop(end + 0.02);

  const voice: Voice = { osc, gain };
  voices.add(voice);
  osc.onended = () => {
    voices.delete(voice);
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      /* already torn down */
    }
  };
}

function startSiren(c: AudioContext, out: GainNode, startAt: number): void {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1, startAt + RAMP_S);

  const osc = c.createOscillator();
  // Sawtooth is the classic emergency timbre — far harder to sleep through
  // than a sine at the same level.
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(SIREN_LOW, startAt);
  osc.connect(gain);
  gain.connect(out);
  osc.start(startAt);

  const voice: Voice = { osc, gain };
  sirenVoice = voice;
  sirenHigh = false;
  sirenStale = false;

  // Liveness. Nothing stops this oscillator while the alarm is meant to sound —
  // our own teardown clears `sirenVoice` first, so the identity check below is
  // false for it. Reaching this with the reference still pointing at us therefore
  // means something *else* ended the node, i.e. the audio session was
  // interrupted. Dropping the reference and flagging it is what lets pump() and
  // resumePlayback() notice and build a new voice.
  osc.onended = () => {
    if (sirenVoice === voice) {
      sirenVoice = null;
      if (playing && currentSound === 'siren') sirenStale = true;
    }
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      /* already torn down */
    }
  };
}

/**
 * Fade out and discard the siren voice. Safe to call on a node that is already
 * dead, and safe to call when there is no voice at all.
 */
function killSirenVoice(at: number): void {
  const voice = sirenVoice;
  // Cleared first: this tells the liveness handler in startSiren that the
  // teardown was ours and not an interruption.
  sirenVoice = null;
  sirenStale = false;
  if (!voice) return;

  const { osc, gain } = voice;
  try {
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(gain.gain.value, at);
    gain.gain.linearRampToValueAtTime(0, at + RAMP_S);
    osc.stop(at + RAMP_S + 0.02);
  } catch {
    /* already stopped */
  }
  osc.onended = () => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      /* already torn down */
    }
  };
}

/**
 * Replace the siren oscillator with a fresh one without interrupting the alarm.
 *
 * This is the recovery path for an audio-session interruption. It cannot go
 * through startAlarm(): that early-returns while `playing` is still true and the
 * sound has not changed, which is exactly the state an interruption leaves
 * behind.
 */
function rebuildSiren(): void {
  const c = ctx;
  const out = master;
  if (!playing || currentSound !== 'siren' || !c || !out) return;

  // A rebuild is only worth anything on a running context. If the resume did not
  // take, leave the flag set so the next pump (or the next resume) tries again
  // rather than building a node inside the interruption.
  if (!isRunning(c)) {
    sirenStale = true;
    return;
  }

  killSirenVoice(c.currentTime);
  cursor = c.currentTime + 0.05;
  startSiren(c, out, cursor);
  pump();
}

/**
 * Pick the alarm back up after the context was suspended, interrupted, or the
 * tab was away. Re-anchors the scheduler (a suspended context's clock stops, so
 * the old cursor is in the past) and rebuilds the siren when it is not known to
 * be alive.
 */
function resumePlayback(): void {
  const c = ctx;
  if (!playing || !c || !master) return;

  cursor = c.currentTime + 0.05;

  // Re-assert the output level. A gain ramp scheduled before an interruption
  // does not always survive it, and coming back at zero gain is the same thing
  // as not coming back at all.
  const target = clampVolume(currentVolume);
  try {
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(master.gain.value, c.currentTime);
    master.gain.linearRampToValueAtTime(target, c.currentTime + RAMP_S);
  } catch {
    master.gain.value = target;
  }

  if (currentSound === 'siren' && (sirenStale || !sirenVoice)) {
    rebuildSiren();
    return;
  }
  pump();
}

/**
 * The lookahead scheduler. setInterval alone is far too jittery for audio, so it
 * only decides *what* to queue; the AudioContext clock decides *when* it sounds.
 */
function pump(): void {
  const c = ctx;
  const out = master;
  if (!playing || !c || !out) return;

  const now = c.currentTime;
  // A backgrounded tab throttles this interval to once a minute or worse. Without
  // this re-anchor the loops below would queue every missed cycle at once and
  // dump them out simultaneously.
  if (cursor < now) cursor = now + 0.05;

  const horizon = now + LOOKAHEAD_S;

  if (currentSound === 'siren') {
    // Never touch the siren while the context is not running: its clock is
    // frozen, and a node built inside an iOS interruption can be born dead. The
    // next pump after the context comes back rebuilds it — as do the resume
    // handlers at the bottom of this file, which get there sooner.
    if (!isRunning(c)) return;
    // A voice that did not survive an interruption must be replaced before
    // anything else is scheduled onto it — ramping a dead oscillator is silence.
    // rebuildSiren() clears the flag and installs a live voice, so this cannot
    // recurse.
    if (sirenStale) {
      rebuildSiren();
      return;
    }
    if (!sirenVoice) startSiren(c, out, cursor);
    const osc = sirenVoice?.osc;
    if (!osc) return;
    while (cursor < horizon) {
      sirenHigh = !sirenHigh;
      // A continuous two-tone sweep: 0.5s up, 0.5s down, forever.
      osc.frequency.linearRampToValueAtTime(sirenHigh ? SIREN_HIGH : SIREN_LOW, cursor + SIREN_LEG_S);
      cursor += SIREN_LEG_S;
    }
    return;
  }

  const notes = currentSound === 'chime' ? CHIME_NOTES : PULSE_NOTES;
  while (cursor < horizon) {
    for (const note of notes) scheduleNote(c, out, note, cursor + note.at);
    cursor += CYCLE_S;
  }
}

function teardownVoices(at: number): void {
  for (const voice of voices) {
    try {
      voice.osc.stop(at);
    } catch {
      /* already stopped */
    }
  }
  voices.clear();

  killSirenVoice(at);
}

// ---------------------------------------------------------------- public API

/**
 * Start looping the given pattern. Keeps going until `stopAlarm()` is called.
 * Calling it again while ringing just updates the volume (or swaps the pattern).
 */
export function startAlarm(sound: AlarmSound, volume: number): void {
  if (typeof window === 'undefined') return;

  const c = ensureContext();
  if (!c || !master) return;

  const target = clampVolume(volume);
  currentVolume = volume;

  if (playing && sound === currentSound) {
    // Same alarm already ringing — just follow the new volume.
    try {
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.linearRampToValueAtTime(target, c.currentTime + RAMP_S);
    } catch {
      /* ignore */
    }
    return;
  }

  if (playing) stopAlarm();

  currentSound = sound;
  playing = true;

  // The context may be suspended (autoplay policy, or the phone was locked).
  // Fire and forget: if it resumes, the queued notes are already waiting.
  void resumeContext();

  try {
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(0, c.currentTime);
    master.gain.linearRampToValueAtTime(target, c.currentTime + RAMP_S);
  } catch {
    master.gain.value = target;
  }

  cursor = c.currentTime + 0.05;
  sirenHigh = false;
  sirenStale = false;

  pump();
  if (pumpId !== null) clearInterval(pumpId);
  pumpId = setInterval(pump, PUMP_MS);
}

/**
 * Stop everything. Idempotent.
 *
 * The AudioContext is deliberately NOT closed: on iOS closing it throws away the
 * unlock, and the next alarm would be silent with no gesture available to fix it.
 */
export function stopAlarm(): void {
  if (pumpId !== null) {
    clearInterval(pumpId);
    pumpId = null;
  }
  playing = false;

  const c = ctx;
  if (c && master) {
    const now = c.currentTime;
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + RAMP_S);
    } catch {
      master.gain.value = 0;
    }
    teardownVoices(now + RAMP_S + 0.01);
  } else {
    voices.clear();
    sirenVoice = null;
    sirenStale = false;
  }

  // Cancel any vibration still running from vibratePattern().
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}

export function isAlarmPlaying(): boolean {
  return playing;
}

/** Buzz the phone. Silently does nothing where vibration is unsupported (iOS). */
export function vibratePattern(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate([400, 200, 400, 200, 400]);
  } catch {
    /* some browsers throw when the page is hidden */
  }
}

// ---------------------------------------------------------------- re-arm

/**
 * Coming back to a backgrounded tab, the AudioContext is very often suspended —
 * on iOS it is suspended the moment the phone locks. If an alarm is supposed to
 * be ringing, bring it back rather than leaving her staring at a silent overlay.
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const c = ctx;
    if (!c) return;

    // Read the state BEFORE resuming. A context that is not running right now was
    // suspended or interrupted while the tab was away, and iOS can take the siren
    // oscillator down with it without ever firing 'ended'. Flagging it here is
    // what guarantees the rebuild below actually happens, rather than resuming
    // into a node that will never make another sound.
    if (playing && currentSound === 'siren' && !isRunning(c)) sirenStale = true;

    void resumeContext().then(() => resumePlayback());
  });
}
