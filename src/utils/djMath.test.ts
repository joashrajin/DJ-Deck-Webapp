import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCrossfaderGains,
  calculateEffectiveBpm,
  calculateSyncPitchPercent,
  computeJogDragRadians,
  computeLoopBounds,
  computeReversedOffset,
  computeScratchStep,
  computeWaveformBins,
  estimateBpmFromChannelData,
  filterAndSortTracks,
  filterSupportedAudioFiles,
  formatDuration,
  formatRemaining,
  formatTimecode,
  mapFilterKnob,
  stepVinylScratchPhysics,
} from './djMath';
import { synthesizeSamplerBuffer } from '../audio/synthTracks';
import type { Track } from '../types/dj';

test('calculateCrossfaderGains computes smooth equal-power curve accurately', () => {
  const fullA = calculateCrossfaderGains(-1, 'smooth');
  assert.equal(fullA.gainA, 1);
  assert.equal(fullA.gainB, 0);

  const center = calculateCrossfaderGains(0, 'smooth');
  assert.ok(Math.abs(center.gainA - Math.SQRT1_2) < 0.002);
  assert.ok(Math.abs(center.gainB - Math.SQRT1_2) < 0.002);

  const fullB = calculateCrossfaderGains(1, 'smooth');
  assert.equal(fullB.gainA, 0);
  assert.equal(fullB.gainB, 1);
});

test('calculateCrossfaderGains computes linear and scratch curves accurately', () => {
  const centerLinear = calculateCrossfaderGains(0, 'linear');
  assert.equal(centerLinear.gainA, 0.5);
  assert.equal(centerLinear.gainB, 0.5);

  const centerScratch = calculateCrossfaderGains(0, 'scratch');
  assert.equal(centerScratch.gainA, 1);
  assert.equal(centerScratch.gainB, 1);

  const edgeScratch = calculateCrossfaderGains(-1, 'scratch');
  assert.equal(edgeScratch.gainA, 1);
  assert.equal(edgeScratch.gainB, 0);
});

test('calculateEffectiveBpm and calculateSyncPitchPercent match tempos cleanly', () => {
  assert.equal(calculateEffectiveBpm(125, 0), 125);
  assert.equal(calculateEffectiveBpm(125, 8), 135);
  assert.equal(calculateEffectiveBpm(125, -4), 120);

  // Sync a 120 BPM track to a 126 BPM target -> +5%
  assert.equal(calculateSyncPitchPercent(120, 126, 16), 5);
  // Clamping respects max pitch range
  assert.equal(calculateSyncPitchPercent(100, 130, 8), 8);
  // Half-time / double-time intelligence: 70 BPM synced to 140 BPM -> 0%
  assert.equal(calculateSyncPitchPercent(70, 140, 16), 0);
});

test('mapFilterKnob maps center to bypass, negative to lowpass, positive to highpass', () => {
  assert.equal(mapFilterKnob(0).type, 'allpass');
  assert.equal(mapFilterKnob(0.01).type, 'allpass');

  const lpf = mapFilterKnob(-0.8);
  assert.equal(lpf.type, 'lowpass');
  assert.ok(lpf.frequency < 1000 && lpf.frequency > 140);

  const hpf = mapFilterKnob(0.8);
  assert.equal(hpf.type, 'highpass');
  assert.ok(hpf.frequency > 1000 && hpf.frequency <= 7500);
});

test('computeLoopBounds aligns loop length to beat duration', () => {
  // At 120 BPM, 1 beat = 0.5s, 4 beats = 2.0s
  const bounds = computeLoopBounds(4.1, 120, 4, 40);
  assert.equal(bounds.start, 4);
  assert.equal(bounds.end, 6);
});

test('timecode formatting handles normal and edge inputs', () => {
  assert.equal(formatTimecode(65.45), '1:05.4');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatRemaining(10, 40), '-0:30.0');
  assert.equal(formatTimecode(-5), '0:00.0');
});

test('filterAndSortTracks filters by crate, genre, BPM, search, and sorts cleanly', () => {
  const tracks: Track[] = [
    {
      id: '1',
      title: 'Acid Rain',
      artist: 'Klangwerk',
      genre: 'Techno',
      bpm: 134,
      musicalKey: '8A',
      duration: 42,
      source: 'synth',
      crateIds: ['peak'],
      favorite: true,
      addedAt: 1,
      accentHex: '#38BDF8',
    },
    {
      id: '2',
      title: 'Velvet Horizon',
      artist: 'Sora',
      genre: 'Deep House',
      bpm: 122,
      musicalKey: '4A',
      duration: 48,
      source: 'synth',
      crateIds: ['warmup'],
      favorite: false,
      addedAt: 2,
      accentHex: '#F59E0B',
    },
  ];

  const searchRes = filterAndSortTracks(tracks, {
    search: 'acid',
    crateId: 'all',
    genre: 'all',
    bpmFilter: 'all',
    sortField: 'title',
    sortDirection: 'asc',
  });
  assert.equal(searchRes.length, 1);
  assert.equal(searchRes[0].id, '1');

  const favRes = filterAndSortTracks(tracks, {
    search: '',
    crateId: 'favorites',
    genre: 'all',
    bpmFilter: 'all',
    sortField: 'bpm',
    sortDirection: 'asc',
  });
  assert.equal(favRes.length, 1);
  assert.equal(favRes[0].id, '1');

  const bpmSort = filterAndSortTracks(tracks, {
    search: '',
    crateId: 'all',
    genre: 'all',
    bpmFilter: 'all',
    sortField: 'bpm',
    sortDirection: 'asc',
  });
  assert.equal(bpmSort[0].bpm, 122);
  assert.equal(bpmSort[1].bpm, 134);
});

test('computeWaveformBins and estimateBpmFromChannelData analyze synthetic audio accurately', () => {
  const sampleRate = 22050;
  const durationSec = 8;
  const data = new Float32Array(sampleRate * durationSec);
  // Create strong 128 BPM kick pulses
  const beatSamples = Math.round((60 / 128) * sampleRate);
  for (let i = 0; i < data.length; i++) {
    const pos = i % beatSamples;
    if (pos < 800) {
      data[i] = Math.sin((pos / sampleRate) * 2 * Math.PI * 80) * Math.exp(-pos / 220);
    }
  }

  const bins = computeWaveformBins(data, 64);
  assert.equal(bins.length, 64);
  assert.ok(bins.some((b) => b.peak > 0.8));

  const estBpm = estimateBpmFromChannelData(data, sampleRate);
  assert.ok(Math.abs(estBpm - 128) <= 3, `Expected ~128 BPM, got ${estBpm}`);
});

test('computeScratchStep and computeReversedOffset handle forward, reverse, and hold scratching', () => {
  // Forward spin: +0.35 rad over 30ms -> forward playback
  const fwd = computeScratchStep(0.35, 30);
  assert.equal(fwd.direction, 'forward');
  assert.ok(fwd.deltaSec > 0);
  assert.ok(fwd.speed > 1 && fwd.speed <= 4.2);

  // Reverse pull-back: -0.35 rad over 30ms -> reverse playback
  const rev = computeScratchStep(-0.35, 30);
  assert.equal(rev.direction, 'reverse');
  assert.ok(rev.deltaSec < 0);
  assert.equal(rev.speed, fwd.speed);

  // Hand holding platter still -> hold
  const hold = computeScratchStep(0.001, 30);
  assert.equal(hold.direction, 'hold');
  assert.equal(hold.speed, 0);

  // Reversed offset maps position 10s of a 40s track to 30s
  assert.equal(computeReversedOffset(10, 40), 30);
  assert.equal(computeReversedOffset(0, 40), 39.99);
});

test('filterAndSortTracks pins newly imported tracks to the top and filters Imported crate', () => {
  const tracks: Track[] = [
    {
      id: 'seed-1',
      title: 'Alpha Built-in',
      artist: 'BuiltIn',
      genre: 'House',
      bpm: 122,
      musicalKey: '4A',
      duration: 45,
      source: 'synth',
      crateIds: [],
      favorite: false,
      addedAt: 1000,
      accentHex: '#38BDF8',
    },
    {
      id: 'local-1',
      title: 'Zebra Import',
      artist: 'Local Audio',
      genre: 'Imported',
      bpm: 126,
      musicalKey: '--',
      duration: 180,
      source: 'local',
      crateIds: [],
      favorite: false,
      addedAt: 5000,
      accentHex: '#38BDF8',
    },
  ];

  const newestFirst = filterAndSortTracks(tracks, {
    search: '',
    crateId: 'all',
    genre: 'all',
    bpmFilter: 'all',
    sortField: 'addedAt',
    sortDirection: 'desc',
  });
  assert.equal(newestFirst[0].id, 'local-1');

  const importedOnly = filterAndSortTracks(tracks, {
    search: '',
    crateId: 'imported',
    genre: 'all',
    bpmFilter: 'all',
    sortField: 'addedAt',
    sortDirection: 'desc',
  });
  assert.equal(importedOnly.length, 1);
  assert.equal(importedOnly[0].id, 'local-1');
});

test('computeJogDragRadians handles rim rotation, vertical baby-scratch, and center hub without spikes', () => {
  // At 3 o'clock (rx=70, ry=0), dragging down (dy=+14) is clockwise (+0.2 rad)
  const cw = computeJogDragRadians(70, 0, 0, 14);
  assert.ok(cw > 0.15 && cw < 0.25);

  // Dragging up at 3 o'clock is counter-clockwise (reverse)
  const ccw = computeJogDragRadians(70, 0, 0, -14);
  assert.ok(ccw < -0.15 && ccw > -0.25);

  // Near center hub (rx=2, ry=1), large movement never spikes past clamp
  const center = computeJogDragRadians(2, 1, 20, 0);
  assert.ok(center > 0 && center <= 0.75);
});

test('stepVinylScratchPhysics smoothly accelerates forward, reverses through zero, and settles on hold', () => {
  let pos = 5.0;
  let vel = 0;
  const dt = 1 / 48000;

  // Push target forward by 0.25s and simulate 25ms
  for (let i = 0; i < 1200; i++) {
    const next = stepVinylScratchPhysics(pos, 5.25, vel, dt);
    pos = next.posSec;
    vel = next.velSec;
  }
  assert.ok(vel > 0.5, 'Should accelerate forward');
  assert.ok(pos > 5.05, 'Should advance toward forward target');

  // Reverse target behind current position (baby scratch pull-back)
  let crossedZero = false;
  for (let i = 0; i < 1800; i++) {
    const prevVel = vel;
    const next = stepVinylScratchPhysics(pos, 4.85, vel, dt);
    pos = next.posSec;
    vel = next.velSec;
    if (prevVel > 0 && vel <= 0) crossedZero = true;
  }
  assert.ok(crossedZero, 'Velocity should smoothly cross zero into reverse');
  assert.ok(vel < -0.2, 'Should move in reverse');
});

test('filterSupportedAudioFiles filters out system/non-audio files and sorts naturally', () => {
  const files = [
    { name: '.DS_Store', type: '' },
    { name: '._Track 1.mp3', type: 'audio/mpeg' },
    { name: 'cover.jpg', type: 'image/jpeg' },
    { name: '10 - Peak Hour.mp3', type: 'audio/mpeg' },
    { name: '2 - Warmup.wav', type: 'audio/wav' },
    { name: '1 - Intro.flac', type: '' },
  ];
  const result = filterSupportedAudioFiles(files);
  assert.deepEqual(
    result.map((f) => f.name),
    ['1 - Intro.flac', '2 - Warmup.wav', '10 - Peak Hour.mp3']
  );
});

test('synthesizeSamplerBuffer airhorn renders bounded stereo 3-blast signal with echo tail', () => {
  const sampleRate = 44100;
  const mockCtx = {
    sampleRate,
    createBuffer(channels: number, length: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch],
      };
    },
  } as unknown as BaseAudioContext;

  const buf = synthesizeSamplerBuffer(mockCtx, 'airhorn');
  assert.equal(buf.numberOfChannels, 2);
  assert.ok(buf.duration >= 1.4);

  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);

  let maxAbs = 0;
  for (let i = 0; i < left.length; i++) {
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
    maxAbs = Math.max(maxAbs, Math.abs(left[i]), Math.abs(right[i]));
  }
  assert.ok(maxAbs > 0.45 && maxAbs <= 1.0, `Expected strong bounded output, got ${maxAbs}`);

  // Confirm RMS energy during blast 1 (0.06s), blast 3 (0.60s), and echo tail (1.15s)
  const rmsAt = (sec: number) => {
    const start = Math.floor(sec * sampleRate);
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += left[start + i] ** 2;
    return Math.sqrt(sum / 400);
  };
  assert.ok(rmsAt(0.06) > 0.15, 'Blast 1 should be loud');
  assert.ok(rmsAt(0.6) > 0.15, 'Blast 3 sustain should be loud');
  assert.ok(rmsAt(1.15) > 0.01 && rmsAt(1.15) < rmsAt(0.6), 'Echo tail should decay cleanly');
});




