import type { SamplerPadId, SynthTrackPreset } from '../types/dj';

const TWO_PI = Math.PI * 2;

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Deterministic pseudo-random noise generator for reproducible hats/snare transients
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

interface PresetConfig {
  bpm: number;
  bars: number;
  rootMidi: number;
  bassPattern: number[]; // 16 steps, -1 = rest
  leadPattern: number[]; // 16 steps, -1 = rest
  chordMidis: number[][];
  kickSteps: number[];
  snareSteps: number[];
  hatSteps: number[];
  acidResonance: number;
  chordBrightness: number;
  swing: number;
  seed: number;
}

const PRESET_CONFIGS: Record<SynthTrackPreset, PresetConfig> = {
  'deep-house': {
    bpm: 122,
    bars: 24,
    rootMidi: 41, // F2
    bassPattern: [0, -1, -1, 0, -1, -1, 3, -1, 5, -1, -1, 3, -1, 0, -1, -1],
    leadPattern: [-1, -1, 12, -1, -1, 15, -1, -1, 17, -1, 15, -1, 12, -1, 10, -1],
    chordMidis: [
      [53, 56, 60, 63],
      [51, 55, 58, 62],
    ],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [2, 6, 10, 14, 15],
    acidResonance: 0.2,
    chordBrightness: 0.45,
    swing: 0.08,
    seed: 101,
  },
  'acid-techno': {
    bpm: 132,
    bars: 24,
    rootMidi: 36, // C2
    bassPattern: [0, 0, 12, 0, 3, -1, 7, 0, 0, 10, 0, 7, 3, 0, -1, 12],
    leadPattern: [12, -1, 15, 19, -1, 12, 24, -1, 15, -1, 19, 15, 12, -1, 10, 12],
    chordMidis: [
      [48, 55, 60],
      [48, 55, 63],
    ],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [0, 2, 3, 6, 8, 10, 11, 14, 15],
    acidResonance: 0.85,
    chordBrightness: 0.7,
    swing: 0.0,
    seed: 202,
  },
  breakbeat: {
    bpm: 128,
    bars: 24,
    rootMidi: 38, // D2
    bassPattern: [0, -1, -1, 0, -1, -1, 5, -1, -1, 3, 0, -1, 7, -1, 5, -1],
    leadPattern: [14, -1, 17, -1, 21, -1, 19, -1, 14, -1, -1, 17, 19, -1, 12, -1],
    chordMidis: [
      [50, 53, 57, 62],
      [48, 52, 55, 60],
    ],
    kickSteps: [0, 6, 10],
    snareSteps: [4, 12, 15],
    hatSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    acidResonance: 0.35,
    chordBrightness: 0.55,
    swing: 0.05,
    seed: 303,
  },
  'melodic-techno': {
    bpm: 126,
    bars: 24,
    rootMidi: 40, // E2
    bassPattern: [0, 0, 0, -1, 0, 0, 3, -1, 5, 5, 5, -1, 3, 3, 2, -1],
    leadPattern: [12, 15, 19, 24, 19, 15, 12, 15, 14, 17, 21, 26, 21, 17, 14, 17],
    chordMidis: [
      [52, 55, 59, 64],
      [50, 54, 57, 62],
    ],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [2, 6, 10, 14],
    acidResonance: 0.45,
    chordBrightness: 0.65,
    swing: 0.02,
    seed: 404,
  },
  'uk-garage': {
    bpm: 130,
    bars: 24,
    rootMidi: 43, // G2
    bassPattern: [0, -1, -1, 3, -1, -1, 5, -1, -1, 0, 7, -1, 5, -1, 3, -1],
    leadPattern: [-1, -1, 15, -1, -1, 19, -1, 17, -1, -1, 15, -1, 12, -1, 15, -1],
    chordMidis: [
      [55, 58, 62, 65],
      [53, 57, 60, 64],
    ],
    kickSteps: [0, 7, 10],
    snareSteps: [4, 12],
    hatSteps: [2, 5, 6, 10, 13, 14],
    acidResonance: 0.3,
    chordBrightness: 0.5,
    swing: 0.16,
    seed: 505,
  },
  'dub-minimal': {
    bpm: 120,
    bars: 24,
    rootMidi: 37, // C#2
    bassPattern: [0, -1, -1, -1, -1, -1, 0, -1, -1, 3, -1, -1, 5, -1, -1, -1],
    leadPattern: [-1, -1, -1, 15, -1, -1, -1, -1, -1, -1, 19, -1, -1, -1, 12, -1],
    chordMidis: [
      [49, 52, 56, 59],
      [49, 52, 56, 61],
    ],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [2, 6, 8, 10, 14],
    acidResonance: 0.25,
    chordBrightness: 0.35,
    swing: 0.06,
    seed: 606,
  },
  'electro-funk': {
    bpm: 118,
    bars: 24,
    rootMidi: 45, // A2
    bassPattern: [0, -1, 0, 3, -1, 5, -1, 7, 0, -1, 3, -1, 5, 7, 10, -1],
    leadPattern: [12, -1, 15, 19, -1, -1, 17, 15, 12, -1, 10, 12, -1, 15, -1, -1],
    chordMidis: [
      [57, 60, 64, 67],
      [55, 59, 62, 65],
    ],
    kickSteps: [0, 3, 8, 10],
    snareSteps: [4, 12],
    hatSteps: [0, 2, 4, 6, 8, 10, 12, 14, 15],
    acidResonance: 0.55,
    chordBrightness: 0.6,
    swing: 0.1,
    seed: 707,
  },
  'peak-trance': {
    bpm: 138,
    bars: 24,
    rootMidi: 42, // F#2
    bassPattern: [0, 12, 0, 12, 0, 12, 0, 12, 3, 15, 3, 15, 5, 17, 5, 17],
    leadPattern: [12, 15, 19, 24, 19, 24, 27, 24, 19, 15, 19, 22, 19, 15, 12, 15],
    chordMidis: [
      [54, 57, 61, 66],
      [52, 56, 59, 64],
    ],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [2, 6, 10, 14, 15],
    acidResonance: 0.5,
    chordBrightness: 0.8,
    swing: 0.0,
    seed: 808,
  },
};

/**
 * Generates a rich, club-ready stereo AudioBuffer purely client-side so the DJ app
 * requires zero server bandwidth or storage for built-in tracks.
 */
export function synthesizeTrackBuffer(
  ctx: BaseAudioContext,
  preset: SynthTrackPreset
): AudioBuffer {
  const cfg = PRESET_CONFIGS[preset];
  const sampleRate = ctx.sampleRate;
  const beatDur = 60 / cfg.bpm;
  const stepDur = beatDur / 4;
  const barDur = beatDur * 4;
  const totalDuration = cfg.bars * barDur;
  const totalSamples = Math.floor(totalDuration * sampleRate);

  const buffer = ctx.createBuffer(2, totalSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const rand = createRng(cfg.seed);

  const totalSteps = cfg.bars * 16;

  // Render bar-by-bar with realistic DJ arrangement phrasing:
  // Bars 0-3: Intro (kick + hats + sparse bass)
  // Bars 4-11: Main Groove A (full drums + bass + chords)
  // Bars 12-15: Breakdown (no kick, sweeping synth lead + chords + riser)
  // Bars 16-21: Peak Drop (full drums + acid/lead + chords)
  // Bars 22-23: DJ Outro (clean drums + bass for easy beatmatching)
  for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
    const bar = Math.floor(stepIdx / 16);
    const stepInBar = stepIdx % 16;
    const isIntro = bar < 4;
    const isBreakdown = bar >= 12 && bar < 16;
    const isDrop = bar >= 16 && bar < 22;
    const isOutro = bar >= 22;

    const swingOffset = stepInBar % 2 === 1 ? cfg.swing * stepDur : 0;
    const stepStartSec = stepIdx * stepDur + swingOffset;
    const startSample = Math.floor(stepStartSec * sampleRate);

    // 1. Punchy Analog Kick
    if (!isBreakdown && cfg.kickSteps.includes(stepInBar)) {
      const kickLen = Math.min(Math.floor(0.24 * sampleRate), totalSamples - startSample);
      for (let i = 0; i < kickLen; i++) {
        const t = i / sampleRate;
        const pitchEnv = 46 + 125 * Math.exp(-t * 36);
        const phase = TWO_PI * (46 * t + (125 / 36) * (1 - Math.exp(-t * 36)));
        const amp = Math.exp(-t * 11.5);
        const click = t < 0.004 ? Math.sin(TWO_PI * 1400 * t) * 0.25 : 0;
        const val = Math.tanh((Math.sin(phase) * amp + click) * 1.35) * 0.58;
        left[startSample + i] += val;
        right[startSample + i] += val;
      }
    }

    // 2. Crisp Clap / Snare
    if (!isIntro && cfg.snareSteps.includes(stepInBar)) {
      const snareLen = Math.min(Math.floor(0.16 * sampleRate), totalSamples - startSample);
      let lp = 0;
      for (let i = 0; i < snareLen; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 24) * (isBreakdown ? 0.55 : 1);
        const noise = rand();
        lp = lp * 0.5 + noise * 0.5;
        const body = Math.sin(TWO_PI * 195 * t) * Math.exp(-t * 35) * 0.4;
        const val = ((noise - lp * 0.3) * 0.34 + body) * env;
        left[startSample + i] += val * 0.96;
        right[startSample + i] += val * 1.04;
      }
    }

    // 3. Stereo Hi-Hats
    if (cfg.hatSteps.includes(stepInBar)) {
      const isOpen = stepInBar === 2 || stepInBar === 10;
      const decay = isOpen ? 18 : 65;
      const hatLen = Math.min(Math.floor((isOpen ? 0.14 : 0.045) * sampleRate), totalSamples - startSample);
      let prev = 0;
      const panL = stepInBar % 4 === 2 ? 0.72 : 1.0;
      const panR = stepInBar % 4 === 2 ? 1.0 : 0.72;
      for (let i = 0; i < hatLen; i++) {
        const t = i / sampleRate;
        const n = rand();
        const hp = n - prev * 0.85;
        prev = n;
        const env = Math.exp(-t * decay) * (isBreakdown ? 0.45 : 0.24);
        left[startSample + i] += hp * env * panL;
        right[startSample + i] += hp * env * panR;
      }
    }

    // 4. Rolling Sub / Acid Bassline
    const bassSemi = cfg.bassPattern[stepInBar];
    if (bassSemi >= 0) {
      const freq = midiToFreq(cfg.rootMidi + bassSemi);
      const noteLen = Math.min(Math.floor(stepDur * 1.15 * sampleRate), totalSamples - startSample);
      const barSweep = 0.35 + 0.65 * Math.abs(Math.sin((bar / 8) * Math.PI));
      const cutoff = 0.05 + cfg.acidResonance * 0.28 * barSweep;
      let lp = 0;
      let bp = 0;
      const bassGain = isBreakdown ? 0.2 : 0.38;

      for (let i = 0; i < noteLen; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 200) * Math.exp(-t * 9.5);
        const saw = ((t * freq) % 1) * 2 - 1;
        const sub = Math.sin(TWO_PI * freq * t);
        // Simple resonant 2-pole filter
        const f = Math.min(0.45, cutoff * (0.4 + env * 1.4));
        const res = cfg.acidResonance * 0.7;
        bp += f * (saw - lp - res * bp);
        lp += f * bp;
        const sample = (sub * 0.55 + lp * 0.65) * env * bassGain;
        left[startSample + i] += sample;
        right[startSample + i] += sample;
      }
    }

    // 5. Harmonic Chord Stabs (on beat 1 and syncopated beat 3.5)
    if (!isIntro && !isOutro && (stepInBar === 0 || stepInBar === 6)) {
      const chord = cfg.chordMidis[bar % cfg.chordMidis.length];
      const stabLen = Math.min(Math.floor(beatDur * 1.6 * sampleRate), totalSamples - startSample);
      const chordGain = isBreakdown ? 0.14 : 0.11;
      for (let i = 0; i < stabLen; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 80) * Math.exp(-t * (isBreakdown ? 2.4 : 4.2));
        let sumL = 0;
        let sumR = 0;
        for (let c = 0; c < chord.length; c++) {
          const f = midiToFreq(chord[c]);
          const detune = 1 + (c - 1.5) * 0.0028;
          const oscL = Math.sin(TWO_PI * f * t) + cfg.chordBrightness * 0.25 * Math.sin(TWO_PI * f * 2 * t);
          const oscR = Math.sin(TWO_PI * f * detune * t) + cfg.chordBrightness * 0.25 * Math.sin(TWO_PI * f * 2 * detune * t);
          sumL += oscL;
          sumR += oscR;
        }
        const norm = (chordGain * env) / chord.length;
        left[startSample + i] += sumL * norm;
        right[startSample + i] += sumR * norm;
      }
    }

    // 6. Melodic Arpeggio / Synth Hook during Breakdown & Peak Drop
    const leadSemi = cfg.leadPattern[stepInBar];
    if ((isBreakdown || isDrop) && leadSemi >= 0) {
      const freq = midiToFreq(cfg.rootMidi + 12 + leadSemi);
      const leadLen = Math.min(Math.floor(stepDur * 1.8 * sampleRate), totalSamples - startSample);
      const stereoPan = stepInBar % 2 === 0 ? 0.82 : 1.18;
      for (let i = 0; i < leadLen; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 140) * Math.exp(-t * 7.5);
        const tri = 2 * Math.abs(2 * ((t * freq) % 1) - 1) - 1;
        const sq = Math.sin(TWO_PI * freq * t) >= 0 ? 0.35 : -0.35;
        const val = (tri * 0.65 + sq * 0.35) * env * (isDrop ? 0.17 : 0.14);
        left[startSample + i] += val * stereoPan;
        right[startSample + i] += val * (2 - stereoPan);
      }
    }
  }

  // Soft-clip master limiter to guarantee clean 0dB headroom
  for (let i = 0; i < totalSamples; i++) {
    left[i] = Math.tanh(left[i] * 0.95);
    right[i] = Math.tanh(right[i] * 0.95);
  }

  return buffer;
}

/**
 * Generates instant one-shot DJ Sampler SFX buffers client-side.
 */
export function synthesizeSamplerBuffer(
  ctx: BaseAudioContext,
  padId: SamplerPadId
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const rand = createRng(999 + padId.length * 37);

  if (padId === 'airhorn') {
    const dur = 0.85;
    const len = Math.floor(dur * sampleRate);
    const buf = ctx.createBuffer(2, len, sampleRate);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    const freqs = [440, 554.37, 659.25, 880];
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const stutter = t < 0.11 || (t > 0.15 && t < 0.25) || t > 0.29 ? 1 : 0.08;
      const env = Math.min(1, t * 120) * Math.exp(-Math.max(0, t - 0.3) * 4.5) * stutter;
      let sum = 0;
      for (const f of freqs) {
        const mod = f * (1 + 0.008 * Math.sin(TWO_PI * 22 * t));
        sum += ((t * mod) % 1) * 2 - 1;
      }
      const val = Math.tanh((sum / freqs.length) * 1.8) * env * 0.45;
      l[i] = val;
      r[i] = val * 0.98;
    }
    return buf;
  }

  if (padId === 'sub-drop') {
    const dur = 1.4;
    const len = Math.floor(dur * sampleRate);
    const buf = ctx.createBuffer(2, len, sampleRate);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const freq = 32 + 120 * Math.exp(-t * 3.8);
      phase += (TWO_PI * freq) / sampleRate;
      const env = Math.min(1, t * 90) * Math.exp(-t * 2.1);
      const val = Math.tanh(Math.sin(phase) * 1.4) * env * 0.72;
      l[i] = val;
      r[i] = val;
    }
    return buf;
  }

  if (padId === 'synth-rise') {
    const dur = 1.8;
    const len = Math.floor(dur * sampleRate);
    const buf = ctx.createBuffer(2, len, sampleRate);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    let phase = 0;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const p = t / dur;
      const freq = 220 * Math.pow(6, p);
      phase += (TWO_PI * freq) / sampleRate;
      const n = rand();
      lp = lp * (0.94 - p * 0.7) + n * (0.06 + p * 0.7);
      const env = Math.pow(p, 1.4) * (1 - Math.max(0, (p - 0.92) / 0.08));
      const val = (Math.sin(phase) * 0.25 + (n - lp) * 0.45) * env * 0.55;
      l[i] = val * (0.8 + 0.2 * Math.sin(TWO_PI * 4 * t));
      r[i] = val * (0.8 - 0.2 * Math.sin(TWO_PI * 4 * t));
    }
    return buf;
  }

  // vinyl-stop
  const dur = 0.75;
  const len = Math.floor(dur * sampleRate);
  const buf = ctx.createBuffer(2, len, sampleRate);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const p = t / dur;
    const freq = 420 * Math.pow(1 - p, 2.2) + 28;
    phase += (TWO_PI * freq) / sampleRate;
    const env = (1 - p) * 0.6;
    const tone = Math.sin(phase) * 0.5 + Math.sin(phase * 1.5) * 0.3 + rand() * 0.06;
    const val = Math.tanh(tone * 1.4) * env;
    l[i] = val;
    r[i] = val;
  }
  return buf;
}
