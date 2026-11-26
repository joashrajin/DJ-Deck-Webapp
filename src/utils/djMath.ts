import type {
  CrossfaderCurve,
  SortDirection,
  SortField,
  Track,
  WaveformBin,
} from '../types/dj';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes Deck A and Deck B linear gain multipliers for crossfader position [-1, 1].
 */
export function calculateCrossfaderGains(
  position: number,
  curve: CrossfaderCurve
): { gainA: number; gainB: number } {
  const x = clamp((position + 1) / 2, 0, 1); // 0 = full A, 0.5 = center, 1 = full B

  if (curve === 'linear') {
    return {
      gainA: Number((1 - x).toFixed(4)),
      gainB: Number(x.toFixed(4)),
    };
  }

  if (curve === 'scratch') {
    // Sharp battle cut: both decks at 100% through center, sharp drop at outer 12%
    const edge = 0.12;
    const gainA = x <= 1 - edge ? 1 : clamp((1 - x) / edge, 0, 1);
    const gainB = x >= edge ? 1 : clamp(x / edge, 0, 1);
    return {
      gainA: Number(gainA.toFixed(4)),
      gainB: Number(gainB.toFixed(4)),
    };
  }

  // Default: smooth equal-power cosine/sine curve
  const gainA = Math.cos(x * Math.PI * 0.5);
  const gainB = Math.sin(x * Math.PI * 0.5);
  return {
    gainA: Number(gainA.toFixed(4)),
    gainB: Number(gainB.toFixed(4)),
  };
}

/**
 * Returns playback rate multiplier (e.g. +8% => 1.08).
 */
export function pitchPercentToRate(pitchPercent: number): number {
  return clamp(1 + pitchPercent / 100, 0.5, 1.5);
}

/**
 * Computes effective BPM given base track BPM and pitch percentage offset.
 */
export function calculateEffectiveBpm(baseBpm: number, pitchPercent: number): number {
  if (baseBpm <= 0) return 0;
  return Number((baseBpm * pitchPercentToRate(pitchPercent)).toFixed(2));
}

/**
 * Computes the pitch percent required on source deck to match target deck's effective BPM.
 * Automatically handles half-time / double-time tempo matching if closer.
 */
export function calculateSyncPitchPercent(
  sourceBaseBpm: number,
  targetEffectiveBpm: number,
  maxRange: number = 16
): number {
  if (sourceBaseBpm <= 0 || targetEffectiveBpm <= 0) return 0;

  let desiredTarget = targetEffectiveBpm;
  const ratio = desiredTarget / sourceBaseBpm;
  if (ratio > 1.5) {
    desiredTarget = targetEffectiveBpm / 2;
  } else if (ratio < 0.65) {
    desiredTarget = targetEffectiveBpm * 2;
  }

  const rawPercent = ((desiredTarget / sourceBaseBpm) - 1) * 100;
  return Number(clamp(rawPercent, -maxRange, maxRange).toFixed(2));
}

/**
 * Maps a bipolar DJ color filter knob (-1..+1) to BiquadFilter parameters.
 * Negative values sweep Lowpass (18kHz down to 140Hz); positive values sweep Highpass (60Hz up to 7.5kHz).
 */
export function mapFilterKnob(value: number): {
  type: 'lowpass' | 'highpass' | 'allpass';
  frequency: number;
  q: number;
} {
  const v = clamp(value, -1, 1);
  if (Math.abs(v) < 0.03) {
    return { type: 'allpass', frequency: 1000, q: 0.7 };
  }

  if (v < 0) {
    // Low-pass sweep: 0 -> 18000 Hz, -1 -> 140 Hz (logarithmic)
    const intensity = Math.abs(v);
    const minFreq = 140;
    const maxFreq = 18000;
    const frequency = maxFreq * Math.pow(minFreq / maxFreq, intensity);
    const q = 0.8 + intensity * 3.8;
    return { type: 'lowpass', frequency: Math.round(frequency), q: Number(q.toFixed(2)) };
  }

  // High-pass sweep: 0 -> 60 Hz, +1 -> 7500 Hz (logarithmic)
  const intensity = v;
  const minFreq = 60;
  const maxFreq = 7500;
  const frequency = minFreq * Math.pow(maxFreq / minFreq, intensity);
  const q = 0.8 + intensity * 3.6;
  return { type: 'highpass', frequency: Math.round(frequency), q: Number(q.toFixed(2)) };
}

/**
 * Computes sample-accurate loop start and end times anchored to the nearest beat.
 */
export function computeLoopBounds(
  currentTime: number,
  bpm: number,
  beats: number,
  duration: number
): { start: number; end: number } {
  if (duration <= 0) return { start: 0, end: 0 };
  const safeBpm = bpm > 40 ? bpm : 120;
  const beatDuration = 60 / safeBpm;
  const loopLength = beatDuration * beats;

  // Snap start down to nearest half-beat for tight phrasing
  const snappedStart = Math.max(0, Math.floor(currentTime / (beatDuration / 2)) * (beatDuration / 2));
  const start = clamp(snappedStart, 0, Math.max(0, duration - 0.1));
  const end = clamp(start + loopLength, Math.min(duration, start + 0.1), duration);

  return {
    start: Number(start.toFixed(4)),
    end: Number(end.toFixed(4)),
  };
}

/**
 * Formats seconds as M:SS.d (for DJ timecode display).
 */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

/**
 * Formats track duration cleanly as M:SS.
 */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats remaining time as -M:SS.d.
 */
export function formatRemaining(current: number, duration: number): string {
  const rem = Math.max(0, duration - current);
  return `-${formatTimecode(rem)}`;
}

export interface TrackQueryOptions {
  search: string;
  crateId: string; // 'all' | 'favorites' | 'imported' | custom crate id
  genre: string; // 'all' | specific genre
  bpmFilter: 'all' | 'under-124' | '124-132' | 'over-132';
  sortField: SortField;
  sortDirection: SortDirection;
}

/**
 * Filters and sorts the DJ track library deterministically.
 */
export function filterAndSortTracks(tracks: Track[], options: TrackQueryOptions): Track[] {
  const q = options.search.trim().toLowerCase();

  const filtered = tracks.filter((track) => {
    if (options.crateId === 'favorites' && !track.favorite) {
      return false;
    }
    if (options.crateId === 'imported' && track.source !== 'local') {
      return false;
    }
    if (
      options.crateId !== 'all' &&
      options.crateId !== 'favorites' &&
      options.crateId !== 'imported' &&
      !track.crateIds.includes(options.crateId)
    ) {
      return false;
    }

    if (options.genre !== 'all' && track.genre !== options.genre) {
      return false;
    }

    if (options.bpmFilter === 'under-124' && track.bpm >= 124) return false;
    if (options.bpmFilter === '124-132' && (track.bpm < 124 || track.bpm > 132)) return false;
    if (options.bpmFilter === 'over-132' && track.bpm <= 132) return false;

    if (q.length > 0) {
      const haystack =
        `${track.title} ${track.artist} ${track.genre} ${track.musicalKey} ${track.bpm}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  const dir = options.sortDirection === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    switch (options.sortField) {
      case 'addedAt':
        return (a.addedAt - b.addedAt) * dir;
      case 'bpm':
        return (a.bpm - b.bpm) * dir;
      case 'duration':
        return (a.duration - b.duration) * dir;
      case 'artist':
        return a.artist.localeCompare(b.artist) * dir;
      case 'genre':
        return a.genre.localeCompare(b.genre) * dir;
      case 'musicalKey':
        return a.musicalKey.localeCompare(b.musicalKey) * dir;
      case 'title':
      default:
        return a.title.localeCompare(b.title) * dir;
    }
  });
}

/**
 * Computes multi-band waveform peaks (low/mid/high energy proxy) from PCM Float32Array
 * using lightweight 1-pole filters so it runs instantaneously in the browser.
 */
export function computeWaveformBins(channelData: Float32Array, numBins: number): WaveformBin[] {
  if (channelData.length === 0 || numBins <= 0) return [];
  const samplesPerBin = Math.max(1, Math.floor(channelData.length / numBins));
  const bins: WaveformBin[] = new Array(numBins);

  let lpState = 0;
  let hpPrev = 0;
  let maxPeak = 0.001;

  for (let i = 0; i < numBins; i++) {
    const start = i * samplesPerBin;
    const end = Math.min(channelData.length, start + samplesPerBin);
    // Stride to keep CPU cost tiny even on 10-minute imported MP3s
    const stride = Math.max(1, Math.floor((end - start) / 180));

    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let peak = 0;
    let count = 0;

    for (let s = start; s < end; s += stride) {
      const sample = channelData[s];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;

      // Lightweight spectral band estimators
      lpState = lpState * 0.88 + sample * 0.12;
      const hp = sample - hpPrev;
      hpPrev = sample;
      const mid = sample - lpState - hp * 0.4;

      lowSum += Math.abs(lpState);
      midSum += Math.abs(mid);
      highSum += Math.abs(hp);
      count++;
    }

    const inv = count > 0 ? 1 / count : 0;
    if (peak > maxPeak) maxPeak = peak;

    bins[i] = {
      low: lowSum * inv,
      mid: midSum * inv,
      high: highSum * inv,
      peak,
    };
  }

  // Normalize peaks cleanly to 0..1
  const norm = 1 / maxPeak;
  for (let i = 0; i < numBins; i++) {
    const b = bins[i];
    b.peak = clamp(b.peak * norm, 0.04, 1);
    b.low = clamp(b.low * norm * 2.4, 0, 1);
    b.mid = clamp(b.mid * norm * 2.2, 0, 1);
    b.high = clamp(b.high * norm * 2.8, 0, 1);
  }

  return bins;
}

/**
 * Estimates BPM of an imported audio buffer using energy onset autocorrelation
 * constrained to typical DJ tempo range (85..170 BPM).
 */
export function estimateBpmFromChannelData(channelData: Float32Array, sampleRate: number): number {
  if (channelData.length < sampleRate * 2 || sampleRate <= 0) return 124;

  // Analyze up to the first 30 seconds in 23ms frames
  const maxSamples = Math.min(channelData.length, sampleRate * 30);
  const hop = Math.max(256, Math.floor(sampleRate * 0.023));
  const frameCount = Math.floor(maxSamples / hop);
  const energies = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const offset = f * hop;
    let sum = 0;
    const step = 4;
    for (let i = 0; i < hop; i += step) {
      const v = channelData[offset + i] || 0;
      sum += v * v;
    }
    energies[f] = Math.sqrt(sum / (hop / step));
  }

  // Onset envelope (positive first difference)
  const onsets = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    const diff = energies[f] - energies[f - 1];
    onsets[f] = diff > 0 ? diff : 0;
  }

  const framesPerSec = sampleRate / hop;
  const minLag = Math.floor((60 / 168) * framesPerSec);
  const maxLag = Math.ceil((60 / 88) * framesPerSec);

  let bestLag = Math.round((60 / 124) * framesPerSec);
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < frameCount - lag; i++) {
      score += onsets[i] * onsets[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestScore <= 0.0001) return 124;

  let bpm = (60 * framesPerSec) / bestLag;
  while (bpm < 90) bpm *= 2;
  while (bpm > 165) bpm /= 2;
  return Math.round(bpm);
}

/**
 * Converts platter angular movement (radians over deltaMs) into vinyl scratch
 * position delta (seconds), playback speed multiplier, and direction.
 * Uses 33.3 RPM turntable feel (1.8 seconds per full 2π revolution).
 */
export function computeScratchStep(
  deltaRadians: number,
  deltaMs: number
): {
  deltaSec: number;
  speed: number;
  direction: 'forward' | 'reverse' | 'hold';
} {
  const secPerRev = 1.8;
  const deltaSec = (deltaRadians / (Math.PI * 2)) * secPerRev;
  const dtSec = Math.max(0.008, deltaMs / 1000);
  const rawVelocity = deltaSec / dtSec;
  const clampedVel = clamp(rawVelocity, -4.2, 4.2);

  if (Math.abs(clampedVel) < 0.08) {
    return {
      deltaSec: Number(deltaSec.toFixed(4)),
      speed: 0,
      direction: 'hold',
    };
  }

  return {
    deltaSec: Number(deltaSec.toFixed(4)),
    speed: Number(Math.abs(clampedVel).toFixed(3)),
    direction: clampedVel > 0 ? 'forward' : 'reverse',
  };
}

/**
 * Maps a forward playhead timestamp into the corresponding offset inside
 * a time-reversed AudioBuffer.
 */
export function computeReversedOffset(forwardPos: number, duration: number): number {
  if (duration <= 0) return 0;
  return Number(clamp(duration - forwardPos, 0, Math.max(0, duration - 0.01)).toFixed(4));
}

/**
 * Computes smooth angular displacement (radians) on a jog wheel from pointer position
 * relative to wheel center (rx, ry) and pointer delta (dx, dy) in pixels.
 * Uses tangential torque projection with a minimum effective radius to avoid angular
 * spikes near the center hub, and supports intuitive straight up/down baby-scratching
 * along the platter rim as well as circular rotation.
 */
export function computeJogDragRadians(
  rx: number,
  ry: number,
  dx: number,
  dy: number
): number {
  const dist = Math.hypot(rx, ry);
  if (dist < 18) {
    // Near the center hub, map horizontal/vertical scrub smoothly without angle flips
    return clamp((dx - dy) / 56, -0.75, 0.75);
  }
  const effectiveR = Math.max(48, dist);
  // Screen-space clockwise cross product: rx * dy - ry * dx
  const rawRad = (rx * dy - ry * dx) / (effectiveR * effectiveR);
  return clamp(rawRad, -0.85, 0.85);
}

/**
 * Pure reference step of the critically-damped vinyl scratch spring-damper physics
 * used by the AudioWorklet, enabling deterministic unit testing of forward/reverse
 * sweeps and zero-crossing smoothness.
 */
export function stepVinylScratchPhysics(
  posSec: number,
  targetPosSec: number,
  velSec: number,
  dtSec: number,
  omega: number = 130,
  zeta: number = 0.96
): { posSec: number; velSec: number } {
  const err = targetPosSec - posSec;
  const accel = omega * omega * err - 2 * zeta * omega * velSec;
  const nextVel = clamp(velSec + accel * dtSec, -6.5, 6.5);
  const nextPos = Math.max(0, posSec + nextVel * dtSec);
  return { posSec: nextPos, velSec: nextVel };
}

const SUPPORTED_AUDIO_EXT_RE = /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i;

/**
 * Checks whether a file name or MIME type corresponds to a browser-decodable audio file
 * while ignoring hidden macOS/system files (e.g. .DS_Store, ._track.mp3) during folder imports.
 */
export function isSupportedAudioFile(file: { name: string; type?: string }): boolean {
  const baseName = file.name.split('/').pop() ?? file.name;
  if (!baseName || baseName.startsWith('.')) return false;
  if (file.type && file.type.startsWith('audio/')) return true;
  return SUPPORTED_AUDIO_EXT_RE.test(baseName);
}

/**
 * Filters a batch of files (such as from a folder import) down to supported audio files
 * sorted naturally by name.
 */
export function filterSupportedAudioFiles<T extends { name: string; type?: string }>(
  files: Iterable<T>
): T[] {
  return Array.from(files)
    .filter((f) => isSupportedAudioFile(f))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}



