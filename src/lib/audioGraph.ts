import type { EqualizerPreset } from "../store/audioSettings";
import { EQUALIZER_PRESETS } from "../store/audioSettings";

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const Q = 1.41;

interface AudioChannel {
  ctx: AudioContext | null;
  source: MediaElementAudioSourceNode | null;
  filters: BiquadFilterNode[];
  preGain: GainNode | null;
  postGain: GainNode | null;
  el: HTMLAudioElement | null;
}

let _a: AudioChannel = emptyChannel();
let _b: AudioChannel = emptyChannel();
let _active: "a" | "b" = "a";

function emptyChannel(): AudioChannel {
  return { ctx: null, source: null, filters: [], preGain: null, postGain: null, el: null };
}

function buildChannel(audio: HTMLAudioElement, ch: AudioChannel): AudioContext {
  if (ch.ctx && ch.el === audio) {
    return ch.ctx;
  }
  teardownChannel(ch);

  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor({ latencyHint: "playback" });
  const source = ctx.createMediaElementSource(audio);

  const preGain = ctx.createGain();
  const postGain = ctx.createGain();
  postGain.gain.value = 1;

  const filters: BiquadFilterNode[] = EQ_FREQUENCIES.map((freq) => {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = freq;
    f.Q.value = Q;
    f.gain.value = 0;
    return f;
  });

  let last: AudioNode = source;
  for (const f of filters) {
    last.connect(f);
    last = f;
  }
  last.connect(preGain);
  preGain.connect(postGain);
  postGain.connect(ctx.destination);

  ch.ctx = ctx;
  ch.source = source;
  ch.filters = filters;
  ch.preGain = preGain;
  ch.postGain = postGain;
  ch.el = audio;
  return ctx;
}

function teardownChannel(ch: AudioChannel) {
  try { ch.source?.disconnect(); } catch { /* ignore */ }
  for (const f of ch.filters) {
    try { f.disconnect(); } catch { /* ignore */ }
  }
  try { ch.preGain?.disconnect(); } catch { /* ignore */ }
  try { ch.postGain?.disconnect(); } catch { /* ignore */ }
  if (ch.ctx && ch.ctx.state !== "closed") {
    ch.ctx.close().catch(() => { /* ignore */ });
  }
  Object.assign(ch, emptyChannel());
}

export function initAudioGraph(audio: HTMLAudioElement): AudioContext {
  const ctx = buildChannel(audio, _a);
  _active = "a";
  return ctx;
}

/** Initialize the second (off) channel used for crossfade. */
export function initSecondaryAudio(audio: HTMLAudioElement): AudioContext {
  return buildChannel(audio, _b);
}

export function disposeAudioGraph(): void {
  teardownChannel(_a);
  teardownChannel(_b);
  _active = "a";
}

export function setEqualizerGains(gains: number[]): void {
  for (const ch of [_a, _b]) {
    if (!ch.filters.length || !ch.ctx) continue;
    for (let i = 0; i < ch.filters.length; i++) {
      const g = gains[i] ?? 0;
      ch.filters[i].gain.setTargetAtTime(g, ch.ctx.currentTime, 0.02);
    }
  }
}

export function setEqualizerPreset(preset: EqualizerPreset): void {
  setEqualizerGains(EQUALIZER_PRESETS[preset]);
}

export function isAudioGraphBuilt(): boolean {
  return _a.ctx !== null;
}

export async function ensureAudioContextResumed(): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (_a.ctx && _a.ctx.state === "suspended") {
    tasks.push(_a.ctx.resume().catch(() => { /* ignore */ }));
  }
  if (_b.ctx && _b.ctx.state === "suspended") {
    tasks.push(_b.ctx.resume().catch(() => { /* ignore */ }));
  }
  await Promise.all(tasks);
}

/**
 * Set the post-gain on a specific channel (0..1). Used for crossfade and
 * sleep-timer fades. If no graph is attached to that channel, no-op.
 */
export function setChannelGain(channel: "a" | "b", value: number, rampSeconds = 0.05): number {
  const ch = channel === "a" ? _a : _b;
  if (!ch.postGain || !ch.ctx) return 0;
  const t = ch.ctx.currentTime;
  ch.postGain.gain.setTargetAtTime(value, t, rampSeconds);
  return t;
}

export function setOutputGain(value: number, rampSeconds = 0.05): number {
  return setChannelGain(_active, value, rampSeconds);
}

/** Swap the active channel. Returns the new active channel id. */
export function swapActiveChannel(): "a" | "b" {
  _active = _active === "a" ? "b" : "a";
  return _active;
}

export function getActiveChannel(): "a" | "b" {
  return _active;
}

export function getAudioContext(): AudioContext | null {
  return _a.ctx;
}
