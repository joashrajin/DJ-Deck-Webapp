import React, { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from './audio/AudioEngine';
import { CenterMixer } from './components/CenterMixer';
import { DeckPanel } from './components/DeckPanel';
import { DualWaveformStrip } from './components/DualWaveformStrip';
import { SamplerFxDrawer } from './components/SamplerFxDrawer';
import { ShortcutsModal } from './components/ShortcutsModal';
import { TopBar } from './components/TopBar';
import { TrackLibrary } from './components/TrackLibrary';
import { DEFAULT_CRATES, SEED_TRACKS } from './data/seedLibrary';
import type {
  Crate,
  CrossfaderCurve,
  DeckId,
  DeckState,
  EqState,
  FxState,
  MixerState,
  SamplerPadId,
  Track,
  WaveformBin,
} from './types/dj';
import {
  calculateEffectiveBpm,
  calculateSyncPitchPercent,
  clamp,
  computeLoopBounds,
} from './utils/djMath';

const STORAGE_CRATES_KEY = 'dj_user_crates_v1';
const STORAGE_FAVS_KEY = 'dj_favorites_v1';

function createInitialDeck(id: DeckId, track: Track | null): DeckState {
  return {
    id,
    trackId: track?.id ?? null,
    isPlaying: false,
    isLoading: false,
    currentTime: 0,
    duration: track?.duration ?? 0,
    pitchPercent: 0,
    pitchRange: 8,
    volume: 0.85,
    filter: 0,
    eq: {
      high: 0,
      mid: 0,
      low: 0,
      killHigh: false,
      killMid: false,
      killLow: false,
    },
    cuePoint: 0,
    hotCues: [
      { index: 0, time: track ? 0 : null, label: 'Intro' },
      { index: 1, time: track ? Number((track.duration * 0.25).toFixed(2)) : null, label: 'Groove' },
      { index: 2, time: track ? Number((track.duration * 0.5).toFixed(2)) : null, label: 'Break' },
      { index: 3, time: null, label: 'Set' },
    ],
    loopActive: false,
    loopBeats: 4,
    loopStart: 0,
    loopEnd: 0,
    syncLocked: false,
    keyLock: true,
  };
}

function loadSavedCrates(): Crate[] {
  try {
    const raw = localStorage.getItem(STORAGE_CRATES_KEY);
    if (!raw) return DEFAULT_CRATES;
    const parsed = JSON.parse(raw) as Crate[];
    if (!Array.isArray(parsed) || parsed.length < 2) return DEFAULT_CRATES;
    return parsed;
  } catch {
    return DEFAULT_CRATES;
  }
}

function loadInitialTracks(): Track[] {
  try {
    const rawFavs = localStorage.getItem(STORAGE_FAVS_KEY);
    if (!rawFavs) return SEED_TRACKS;
    const favSet = new Set<string>(JSON.parse(rawFavs) as string[]);
    return SEED_TRACKS.map((t) => ({ ...t, favorite: favSet.has(t.id) }));
  } catch {
    return SEED_TRACKS;
  }
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>(loadInitialTracks);
  const [crates, setCrates] = useState<Crate[]>(loadSavedCrates);

  const [deckA, setDeckA] = useState<DeckState>(() => createInitialDeck('A', SEED_TRACKS[0]));
  const [deckB, setDeckB] = useState<DeckState>(() => createInitialDeck('B', SEED_TRACKS[1]));

  const [waveforms, setWaveforms] = useState<Record<string, WaveformBin[]>>({});
  const [showSamplerFx, setShowSamplerFx] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);

  const [mixer, setMixer] = useState<MixerState>({
    crossfader: 0,
    crossfaderCurve: 'smooth',
    masterGain: 0.9,
    samplerVolume: 0.75,
    autoMixActive: false,
    autoMixTarget: null,
    autoMixDurationSec: 6,
    fx: {
      echoEnabled: false,
      echoWet: 0.38,
      echoFeedback: 0.42,
      echoBeats: 0.5,
      echoTarget: 'MASTER',
    },
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoMixRafRef = useRef<number | null>(null);

  const trackA = tracks.find((t) => t.id === deckA.trackId) ?? null;
  const trackB = tracks.find((t) => t.id === deckB.trackId) ?? null;

  // Persist user crates & favorites
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CRATES_KEY, JSON.stringify(crates));
    } catch {
      // ignore storage quota errors
    }
  }, [crates]);

  useEffect(() => {
    try {
      const favIds = tracks.filter((t) => t.favorite).map((t) => t.id);
      localStorage.setItem(STORAGE_FAVS_KEY, JSON.stringify(favIds));
    } catch {
      // ignore
    }
  }, [tracks]);

  const setDeckState = useCallback(
    (deckId: DeckId, updater: (prev: DeckState) => DeckState) => {
      if (deckId === 'A') setDeckA(updater);
      else setDeckB(updater);
    },
    []
  );

  // Pre-synthesize the two initial loaded deck tracks so waveforms render immediately
  useEffect(() => {
    const loadInitialDeckAudio = (deckId: DeckId, track: Track) => {
      if (!track.preset) return;
      const result = audioEngine.loadTrackToDeck(deckId, track.id, track.preset, () => {
        setDeckState(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
      });
      if (result) {
        setWaveforms((prev) => ({ ...prev, [track.id]: result.waveform }));
        setDeckState(deckId, (prev) => ({ ...prev, duration: result.duration }));
      }
    };

    try {
      loadInitialDeckAudio('A', SEED_TRACKS[0]);
      loadInitialDeckAudio('B', SEED_TRACKS[1]);
    } catch {
      // If AudioContext creation is restricted before gesture, it initializes lazily on first play
    }
  }, [setDeckState]);

  const ensureDeckBufferReady = useCallback(
    (deckId: DeckId, track: Track | null) => {
      if (!track) return false;
      if (!audioEngine.hasBuffer(track.id) && track.preset) {
        const loaded = audioEngine.loadTrackToDeck(deckId, track.id, track.preset, () => {
          setDeckState(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
        });
        if (loaded) {
          setWaveforms((prev) => ({ ...prev, [track.id]: loaded.waveform }));
          setDeckState(deckId, (prev) => ({ ...prev, duration: loaded.duration }));
          return true;
        }
      }
      return audioEngine.hasBuffer(track.id);
    },
    [setDeckState]
  );

  const handleLoadDeck = useCallback(
    (deckId: DeckId, trackId: string) => {
      const target = tracks.find((t) => t.id === trackId);
      if (!target) return;

      const loaded = audioEngine.loadTrackToDeck(deckId, target.id, target.preset, () => {
        setDeckState(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
      });

      if (loaded) {
        setWaveforms((prev) => ({ ...prev, [target.id]: loaded.waveform }));
      }

      const dur = loaded?.duration ?? target.duration;
      setDeckState(deckId, (prev) => ({
        ...prev,
        trackId: target.id,
        isPlaying: false,
        currentTime: 0,
        duration: dur,
        pitchPercent: 0,
        cuePoint: 0,
        loopActive: false,
        loopStart: 0,
        loopEnd: 0,
        syncLocked: false,
        hotCues: [
          { index: 0, time: 0, label: 'Intro' },
          { index: 1, time: Number((dur * 0.25).toFixed(2)), label: 'Groove' },
          { index: 2, time: Number((dur * 0.5).toFixed(2)), label: 'Break' },
          { index: 3, time: null, label: 'Set' },
        ],
      }));

      audioEngine.setDeckPitch(deckId, 0);
    },
    [tracks, setDeckState]
  );

  const handleTogglePlay = useCallback(
    (deckId: DeckId) => {
      const deck = deckId === 'A' ? deckA : deckB;
      const track = deckId === 'A' ? trackA : trackB;
      if (!track) return;

      ensureDeckBufferReady(deckId, track);

      if (deck.isPlaying) {
        const pos = audioEngine.pause(deckId);
        setDeckState(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: pos }));
      } else {
        audioEngine.setDeckVolume(deckId, deck.volume);
        audioEngine.setDeckEq(deckId, deck.eq);
        audioEngine.setDeckFilter(deckId, deck.filter);
        audioEngine.setDeckPitch(deckId, deck.pitchPercent);
        audioEngine.setCrossfader(mixer.crossfader, mixer.crossfaderCurve);
        audioEngine.setMasterGain(mixer.masterGain);
        audioEngine.play(deckId);
        setDeckState(deckId, (prev) => ({ ...prev, isPlaying: true }));
      }
    },
    [deckA, deckB, trackA, trackB, mixer, ensureDeckBufferReady, setDeckState]
  );

  const handleCue = useCallback(
    (deckId: DeckId) => {
      const deck = deckId === 'A' ? deckA : deckB;
      const track = deckId === 'A' ? trackA : trackB;
      if (!track) return;

      ensureDeckBufferReady(deckId, track);

      if (deck.isPlaying) {
        audioEngine.pause(deckId);
        const targetPos = audioEngine.seek(deckId, deck.cuePoint);
        setDeckState(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: targetPos }));
      } else {
        const pos = audioEngine.getDeckPosition(deckId);
        if (Math.abs(pos - deck.cuePoint) > 0.25) {
          setDeckState(deckId, (prev) => ({ ...prev, cuePoint: pos }));
        } else {
          const resetPos = audioEngine.seek(deckId, deck.cuePoint);
          setDeckState(deckId, (prev) => ({ ...prev, currentTime: resetPos }));
        }
      }
    },
    [deckA, deckB, trackA, trackB, ensureDeckBufferReady, setDeckState]
  );

  const handleSync = useCallback(
    (deckId: DeckId) => {
      const sourceDeck = deckId === 'A' ? deckA : deckB;
      const targetDeck = deckId === 'A' ? deckB : deckA;
      const sourceTrack = deckId === 'A' ? trackA : trackB;
      const targetTrack = deckId === 'A' ? trackB : trackA;
      if (!sourceTrack || !targetTrack) return;

      const targetEffBpm = calculateEffectiveBpm(targetTrack.bpm, targetDeck.pitchPercent);
      const neededPitch = calculateSyncPitchPercent(
        sourceTrack.bpm,
        targetEffBpm,
        Math.max(sourceDeck.pitchRange, 16)
      );
      const nextRange: 8 | 16 = Math.abs(neededPitch) > 8 ? 16 : sourceDeck.pitchRange;

      audioEngine.setDeckPitch(deckId, neededPitch);
      setDeckState(deckId, (prev) => ({
        ...prev,
        pitchPercent: neededPitch,
        pitchRange: nextRange,
        syncLocked: true,
      }));
    },
    [deckA, deckB, trackA, trackB, setDeckState]
  );

  const handleSeek = useCallback(
    (deckId: DeckId, timeSec: number) => {
      const pos = audioEngine.seek(deckId, timeSec);
      setDeckState(deckId, (prev) => ({ ...prev, currentTime: pos }));
    },
    [setDeckState]
  );

  const handleSeekDelta = useCallback(
    (deckId: DeckId, deltaSec: number) => {
      const current = audioEngine.getDeckPosition(deckId);
      const pos = audioEngine.seek(deckId, current + deltaSec);
      setDeckState(deckId, (prev) => ({ ...prev, currentTime: pos }));
    },
    [setDeckState]
  );

  const handlePitchChange = useCallback(
    (deckId: DeckId, pitchPercent: number) => {
      audioEngine.setDeckPitch(deckId, pitchPercent);
      setDeckState(deckId, (prev) => ({
        ...prev,
        pitchPercent,
        syncLocked: false,
      }));
    },
    [setDeckState]
  );

  const handleTogglePitchRange = useCallback(
    (deckId: DeckId) => {
      setDeckState(deckId, (prev) => {
        const nextRange: 8 | 16 = prev.pitchRange === 8 ? 16 : 8;
        const clamped = clamp(prev.pitchPercent, -nextRange, nextRange);
        audioEngine.setDeckPitch(deckId, clamped);
        return { ...prev, pitchRange: nextRange, pitchPercent: clamped };
      });
    },
    [setDeckState]
  );

  const handleHotCueTrigger = useCallback(
    (deckId: DeckId, index: number) => {
      const deck = deckId === 'A' ? deckA : deckB;
      const track = deckId === 'A' ? trackA : trackB;
      if (!track) return;
      ensureDeckBufferReady(deckId, track);

      const cue = deck.hotCues[index];
      if (!cue) return;

      if (cue.time === null) {
        const nowPos = Number(audioEngine.getDeckPosition(deckId).toFixed(2));
        setDeckState(deckId, (prev) => ({
          ...prev,
          hotCues: prev.hotCues.map((c) => (c.index === index ? { ...c, time: nowPos } : c)),
        }));
      } else {
        const pos = audioEngine.seek(deckId, cue.time);
        if (!deck.isPlaying) {
          audioEngine.play(deckId);
        }
        setDeckState(deckId, (prev) => ({ ...prev, isPlaying: true, currentTime: pos }));
      }
    },
    [deckA, deckB, trackA, trackB, ensureDeckBufferReady, setDeckState]
  );

  const handleHotCueClear = useCallback(
    (deckId: DeckId, index: number) => {
      setDeckState(deckId, (prev) => ({
        ...prev,
        hotCues: prev.hotCues.map((c) => (c.index === index ? { ...c, time: null } : c)),
      }));
    },
    [setDeckState]
  );

  const handleToggleLoop = useCallback(
    (deckId: DeckId, beats?: number) => {
      const deck = deckId === 'A' ? deckA : deckB;
      const track = deckId === 'A' ? trackA : trackB;
      if (!track) return;

      const nextBeats = beats ?? deck.loopBeats;
      const shouldActivate = beats !== undefined ? !(deck.loopActive && deck.loopBeats === beats) : !deck.loopActive;

      if (shouldActivate) {
        const pos = audioEngine.getDeckPosition(deckId);
        const effBpm = calculateEffectiveBpm(track.bpm, deck.pitchPercent);
        const { start, end } = computeLoopBounds(pos, effBpm, nextBeats, deck.duration);
        audioEngine.setDeckLoop(deckId, true, start, end);
        setDeckState(deckId, (prev) => ({
          ...prev,
          loopActive: true,
          loopBeats: nextBeats,
          loopStart: start,
          loopEnd: end,
        }));
      } else {
        audioEngine.setDeckLoop(deckId, false, 0, 0);
        setDeckState(deckId, (prev) => ({
          ...prev,
          loopActive: false,
          loopStart: 0,
          loopEnd: 0,
        }));
      }
    },
    [deckA, deckB, trackA, trackB, setDeckState]
  );

  // Mixer handlers
  const handleEqChange = useCallback(
    (deckId: DeckId, patch: Partial<EqState>) => {
      setDeckState(deckId, (prev) => {
        const nextEq = { ...prev.eq, ...patch };
        audioEngine.setDeckEq(deckId, nextEq);
        return { ...prev, eq: nextEq };
      });
    },
    [setDeckState]
  );

  const handleFilterChange = useCallback(
    (deckId: DeckId, value: number) => {
      audioEngine.setDeckFilter(deckId, value);
      setDeckState(deckId, (prev) => ({ ...prev, filter: value }));
    },
    [setDeckState]
  );

  const handleDeckVolumeChange = useCallback(
    (deckId: DeckId, volume: number) => {
      audioEngine.setDeckVolume(deckId, volume);
      setDeckState(deckId, (prev) => ({ ...prev, volume }));
    },
    [setDeckState]
  );

  const cancelAutoMix = useCallback(() => {
    if (autoMixRafRef.current !== null) {
      cancelAnimationFrame(autoMixRafRef.current);
      autoMixRafRef.current = null;
    }
  }, []);

  const handleCrossfaderChange = useCallback(
    (value: number) => {
      cancelAutoMix();
      const clamped = clamp(value, -1, 1);
      setMixer((prev) => {
        audioEngine.setCrossfader(clamped, prev.crossfaderCurve);
        return { ...prev, crossfader: clamped, autoMixActive: false, autoMixTarget: null };
      });
    },
    [cancelAutoMix]
  );

  const handleCurveChange = useCallback((curve: CrossfaderCurve) => {
    setMixer((prev) => {
      audioEngine.setCrossfader(prev.crossfader, curve);
      return { ...prev, crossfaderCurve: curve };
    });
  }, []);

  const handleMasterGainChange = useCallback((masterGain: number) => {
    audioEngine.setMasterGain(masterGain);
    setMixer((prev) => ({ ...prev, masterGain }));
  }, []);

  const handleTriggerAutoMix = useCallback(() => {
    if (mixer.autoMixActive) {
      cancelAutoMix();
      setMixer((prev) => ({ ...prev, autoMixActive: false, autoMixTarget: null }));
      return;
    }

    const targetDeck: DeckId = mixer.crossfader <= 0 ? 'B' : 'A';
    const targetVal = targetDeck === 'B' ? 1 : -1;
    const startVal = mixer.crossfader;
    const durationMs = mixer.autoMixDurationSec * 1000;

    // Auto-start target deck if paused so the mix seamlessly brings it in
    const targetDeckState = targetDeck === 'A' ? deckA : deckB;
    const targetTrack = targetDeck === 'A' ? trackA : trackB;
    if (!targetDeckState.isPlaying && targetTrack) {
      ensureDeckBufferReady(targetDeck, targetTrack);
      audioEngine.play(targetDeck);
      setDeckState(targetDeck, (prev) => ({ ...prev, isPlaying: true }));
    }

    setMixer((prev) => ({ ...prev, autoMixActive: true, autoMixTarget: targetDeck }));
    const startedAt = performance.now();

    const step = (now: number) => {
      const t = clamp((now - startedAt) / durationMs, 0, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const nextPos = Number((startVal + (targetVal - startVal) * eased).toFixed(3));

      setMixer((prev) => {
        audioEngine.setCrossfader(nextPos, prev.crossfaderCurve);
        return {
          ...prev,
          crossfader: nextPos,
          autoMixActive: t < 1,
          autoMixTarget: t < 1 ? targetDeck : null,
        };
      });

      if (t < 1) {
        autoMixRafRef.current = requestAnimationFrame(step);
      } else {
        autoMixRafRef.current = null;
      }
    };

    autoMixRafRef.current = requestAnimationFrame(step);
  }, [mixer, deckA, deckB, trackA, trackB, cancelAutoMix, ensureDeckBufferReady, setDeckState]);

  const handleFxChange = useCallback(
    (patch: Partial<FxState>) => {
      setMixer((prev) => {
        const nextFx = { ...prev.fx, ...patch };
        const refBpm =
          nextFx.echoTarget === 'A'
            ? trackA?.bpm ?? 124
            : nextFx.echoTarget === 'B'
              ? trackB?.bpm ?? 124
              : trackA?.bpm ?? trackB?.bpm ?? 124;
        audioEngine.setFxState(nextFx, refBpm);
        return { ...prev, fx: nextFx };
      });
    },
    [trackA, trackB]
  );

  const handleSamplerVolumeChange = useCallback((samplerVolume: number) => {
    audioEngine.setSamplerVolume(samplerVolume);
    setMixer((prev) => ({ ...prev, samplerVolume }));
  }, []);

  const handleTriggerSampler = useCallback((padId: SamplerPadId) => {
    audioEngine.triggerSampler(padId);
  }, []);

  const handleToggleRecord = useCallback(async () => {
    if (isRecording) {
      const url = await audioEngine.stopRecording();
      setIsRecording(false);
      if (url) {
        setRecordingUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      }
    } else {
      const started = audioEngine.startRecording();
      if (started) {
        setIsRecording(true);
      }
    }
  }, [isRecording]);

  // Library & Crates Handlers
  const handleToggleFavorite = useCallback((trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, favorite: !t.favorite } : t))
    );
  }, []);

  const handleCreateCrate = useCallback((name: string) => {
    const id = `crate-${Date.now()}`;
    setCrates((prev) => [...prev, { id, name }]);
  }, []);

  const handleDeleteCrate = useCallback((crateId: string) => {
    setCrates((prev) => prev.filter((c) => c.id !== crateId));
    setTracks((prev) =>
      prev.map((t) => ({ ...t, crateIds: t.crateIds.filter((id) => id !== crateId) }))
    );
  }, []);

  const handleToggleTrackCrate = useCallback((trackId: string, crateId: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? {
              ...t,
              crateIds: t.crateIds.includes(crateId) ? [crateId] : [crateId, ...t.crateIds],
            }
          : t
      )
    );
  }, []);

  const handleDeleteTrack = useCallback((trackId: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);

  const handleImportFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i.test(f.name)
    );
    if (files.length === 0) {
      setImportError('Please select a valid audio file (MP3, WAV, OGG, FLAC, or M4A).');
      return;
    }

    setImportError(null);
    setIsImporting(true);

    try {
      const newTracks: Track[] = [];
      const newWaveforms: Record<string, WaveformBin[]> = {};

      for (const file of files) {
        const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        const parts = cleanName.split(' - ');
        const artist = parts.length > 1 ? parts[0].trim() : 'Local Audio';
        const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : cleanName || 'Untitled Track';

        const decoded = await audioEngine.decodeImportedFile(id, file);
        newWaveforms[id] = decoded.waveform;
        newTracks.push({
          id,
          title,
          artist,
          genre: 'Imported',
          bpm: decoded.bpm,
          musicalKey: '--',
          duration: decoded.duration,
          source: 'local',
          crateIds: [],
          favorite: false,
          addedAt: Date.now(),
          accentHex: '#38BDF8',
        });
      }

      setWaveforms((prev) => ({ ...prev, ...newWaveforms }));
      setTracks((prev) => [...newTracks, ...prev]);
    } catch {
      setImportError('Could not decode one of the audio files in this browser.');
    } finally {
      setIsImporting(false);
    }
  }, []);

  // Keyboard performance shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay(e.shiftKey ? 'B' : 'A');
      } else if (e.key === 'q' || e.key === 'Q') {
        handleCue('A');
      } else if (e.key === 'p' || e.key === 'P') {
        handleCue('B');
      } else if (e.key === 's' || e.key === 'S') {
        handleSync('A');
      } else if (e.key === 'k' || e.key === 'K') {
        handleSync('B');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleCrossfaderChange(mixer.crossfader - 0.12);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleCrossfaderChange(mixer.crossfader + 0.12);
      } else if (e.key === 'c' || e.key === 'C') {
        handleCrossfaderChange(0);
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        handleHotCueTrigger('A', Number(e.key) - 1);
      } else if (['7', '8', '9', '0'].includes(e.key)) {
        const idx = e.key === '0' ? 3 : Number(e.key) - 7;
        handleHotCueTrigger('B', idx);
      } else if (e.key === 'F1') {
        e.preventDefault();
        handleTriggerSampler('airhorn');
      } else if (e.key === 'F2') {
        e.preventDefault();
        handleTriggerSampler('sub-drop');
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleTriggerSampler('synth-rise');
      } else if (e.key === 'F4') {
        e.preventDefault();
        handleTriggerSampler('vinyl-stop');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleTogglePlay,
    handleCue,
    handleSync,
    handleCrossfaderChange,
    handleHotCueTrigger,
    handleTriggerSampler,
    mixer.crossfader,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAutoMix();
    };
  }, [cancelAutoMix]);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#0B0D10] text-[#F3F5F8] flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className="sr-only"
        aria-label="Import local audio files"
        onChange={(e) => {
          if (e.target.files) {
            void handleImportFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <TopBar
        showSamplerFx={showSamplerFx}
        onToggleSamplerFx={() => setShowSamplerFx((v) => !v)}
        onScrollToConsole={() => scrollToSection('console')}
        onScrollToLibrary={() => scrollToSection('library')}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onTriggerImport={() => fileInputRef.current?.click()}
      />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
        {/* Parallel Dual-Deck Master Waveform Strip */}
        <section id="console" aria-label="Dual Deck Console" className="flex flex-col gap-4">
          <DualWaveformStrip
            deckA={deckA}
            deckB={deckB}
            trackABpm={trackA ? calculateEffectiveBpm(trackA.bpm, deckA.pitchPercent) : 0}
            trackBBpm={trackB ? calculateEffectiveBpm(trackB.bpm, deckB.pitchPercent) : 0}
            waveformA={trackA ? waveforms[trackA.id] ?? null : null}
            waveformB={trackB ? waveforms[trackB.id] ?? null : null}
            getPosition={(id) => audioEngine.getDeckPosition(id)}
            onSeek={handleSeek}
          />

          {/* Hardware Console Grid: Deck A | Center Mixer | Deck B */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_316px_minmax(0,1fr)] gap-4 items-stretch">
            <DeckPanel
              deck={deckA}
              track={trackA}
              waveform={trackA ? waveforms[trackA.id] ?? null : null}
              getPosition={() => audioEngine.getDeckPosition('A')}
              onTogglePlay={() => handleTogglePlay('A')}
              onCue={() => handleCue('A')}
              onSync={() => handleSync('A')}
              onSeek={(t) => handleSeek('A', t)}
              onSeekDelta={(d) => handleSeekDelta('A', d)}
              onNudge={(f) => audioEngine.setDeckNudge('A', f)}
              onPitchChange={(p) => handlePitchChange('A', p)}
              onTogglePitchRange={() => handleTogglePitchRange('A')}
              onHotCueTrigger={(i) => handleHotCueTrigger('A', i)}
              onHotCueClear={(i) => handleHotCueClear('A', i)}
              onToggleLoop={(b) => handleToggleLoop('A', b)}
            />

            <CenterMixer
              deckA={deckA}
              deckB={deckB}
              mixer={mixer}
              isRecording={isRecording}
              recordingUrl={recordingUrl}
              getLevels={() => audioEngine.getLevels()}
              onEqChange={handleEqChange}
              onFilterChange={handleFilterChange}
              onDeckVolumeChange={handleDeckVolumeChange}
              onCrossfaderChange={handleCrossfaderChange}
              onCurveChange={handleCurveChange}
              onMasterGainChange={handleMasterGainChange}
              onTriggerAutoMix={handleTriggerAutoMix}
              onToggleRecord={handleToggleRecord}
            />

            <DeckPanel
              deck={deckB}
              track={trackB}
              waveform={trackB ? waveforms[trackB.id] ?? null : null}
              getPosition={() => audioEngine.getDeckPosition('B')}
              onTogglePlay={() => handleTogglePlay('B')}
              onCue={() => handleCue('B')}
              onSync={() => handleSync('B')}
              onSeek={(t) => handleSeek('B', t)}
              onSeekDelta={(d) => handleSeekDelta('B', d)}
              onNudge={(f) => audioEngine.setDeckNudge('B', f)}
              onPitchChange={(p) => handlePitchChange('B', p)}
              onTogglePitchRange={() => handleTogglePitchRange('B')}
              onHotCueTrigger={(i) => handleHotCueTrigger('B', i)}
              onHotCueClear={(i) => handleHotCueClear('B', i)}
              onToggleLoop={(b) => handleToggleLoop('B', b)}
            />
          </div>
        </section>

        {/* Mobile-only quick access for Sampler & FX and Shortcuts */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSamplerFx((v) => !v)}
            aria-pressed={showSamplerFx}
            className={`flex-1 rounded-md border py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
              showSamplerFx
                ? 'border-sky-400/70 bg-sky-500/20 text-sky-200'
                : 'border-white/10 bg-[#13171F] text-slate-200'
            }`}
          >
            {showSamplerFx ? 'Hide Sampler & FX' : 'Sampler & FX'}
          </button>
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="rounded-md border border-white/10 bg-[#13171F] px-4 py-2.5 text-xs font-semibold text-slate-200 cursor-pointer"
          >
            Shortcuts
          </button>
        </div>

        {/* Toggleable Sampler & Beat-Synced FX Rack */}
        {showSamplerFx && (
          <SamplerFxDrawer
            fx={mixer.fx}
            samplerVolume={mixer.samplerVolume}
            onFxChange={handleFxChange}
            onSamplerVolumeChange={handleSamplerVolumeChange}
            onTriggerPad={handleTriggerSampler}
          />
        )}

        {/* Track Library & Crate Manager */}
        <TrackLibrary
          tracks={tracks}
          crates={crates}
          activeDeckATrackId={deckA.trackId}
          activeDeckBTrackId={deckB.trackId}
          isImporting={isImporting}
          importError={importError}
          onLoadDeck={handleLoadDeck}
          onToggleFavorite={handleToggleFavorite}
          onCreateCrate={handleCreateCrate}
          onDeleteCrate={handleDeleteCrate}
          onToggleTrackCrate={handleToggleTrackCrate}
          onDeleteTrack={handleDeleteTrack}
          onImportFiles={handleImportFiles}
          onTriggerImport={() => fileInputRef.current?.click()}
        />
      </main>

      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
