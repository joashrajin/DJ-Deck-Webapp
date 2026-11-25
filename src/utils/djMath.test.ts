import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCrossfaderGains,
  calculateEffectiveBpm,
  calculateSyncPitchPercent,
  computeLoopBounds,
  computeWaveformBins,
  estimateBpmFromChannelData,
  filterAndSortTracks,
  formatDuration,
  formatRemaining,
  formatTimecode,
  mapFilterKnob,
} from './djMath';
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
