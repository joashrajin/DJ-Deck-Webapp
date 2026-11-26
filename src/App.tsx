import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Upload, X } from 'lucide-react';
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
  filterSupportedAudioFiles,
  formatDuration,
} from './utils/djMath';
import {
  clearAllPersistedLocalTracks,
  deletePersistedLocalTrack,
  isIndexedDbAvailable,
  loadPersistedLocalTracks,
  savePersistedLocalTracks,
  updatePersistedTrackMeta,
  type StoredLocalTrackRecord,
} from './storage/localTrackStore';

const STORAGE_CRATES_KEY = 'dj_user_crates_v1';
const STORAGE_FAVS_KEY = 'dj_favorites_v1';
const STORAGE_PERSIST_KEY = 'dj_persist_local_audio_v1';

function loadPersistPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_PERSIST_KEY) === 'true' && isIndexedDbAvailable();
  } catch {
    return false;
  }
}

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
    vinylMode: true,
  };
}

function loadSavedCrates(): Crate[] {
  try {
    const raw = localStorage.getItem(STORAGE_CRATES_KEY);
    if (!raw) return DEFAULT_CRATES;
    const parsed = JSON.parse(raw) as Crate[];
    if (!Array.isArray(parsed) || parsed.length < 2) return DEFAULT_CRATES;
    if (!parsed.some((c) => c.id === 'imported')) {
      const allIndex = parsed.findIndex((c) => c.id === 'all');
      const insertAt = allIndex >= 0 ? allIndex + 1 : 0;
      const migrated = [...parsed];
      migrated.splice(insertAt, 0, { id: 'imported', name: 'Imported', isSystem: true });
      return migrated;
    }
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
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [recentlyImportedIds, setRecentlyImportedIds] = useState<string[]>([]);
  const [importVersion, setImportVersion] = useState(0);
  const [importBanner, setImportBanner] = useState<{
    trackIds: string[];
    loadedToDeck: DeckId | null;
  } | null>(null);
  const [persistLocalTracks, setPersistLocalTracks] = useState<boolean>(loadPersistPreference);
  const [savedLocalCount, setSavedLocalCount] = useState(0);
  const [isRestoringSaved, setIsRestoringSaved] = useState(false);
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
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const localBlobsRef = useRef<Map<string, { blob: Blob; fileName: string; mimeType: string }>>(
    new Map()
  );
  const autoMixRafRef = useRef<number | null>(null);

  const trackA = tracks.find((t) => t.id === deckA.trackId) ?? null;
  const trackB = tracks.find((t) => t.id === deckB.trackId) ?? null;

  // Keep canonical and OpenGraph URL aligned with the active deployment origin
  useEffect(() => {
    try {
      const currentUrl = `${window.location.origin}${window.location.pathname}`;
      const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (canonical) canonical.href = currentUrl;
      const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
      if (ogUrl) ogUrl.content = currentUrl;
    } catch {
      // ignore in non-DOM contexts
    }
  }, []);

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

  // Restore opt-in locally saved IndexedDB tracks on reload (using OfflineAudioContext so zero autoplay warnings)
  useEffect(() => {
    if (!persistLocalTracks) return;
    let cancelled = false;

    const restoreSaved = async () => {
      setIsRestoringSaved(true);
      try {
        const records = await loadPersistedLocalTracks();
        if (cancelled || records.length === 0) {
          if (!cancelled) setSavedLocalCount(0);
          return;
        }

        const restoredTracks: Track[] = [];
        const restoredWaveforms: Record<string, WaveformBin[]> = {};

        let firstError: string | null = null;
        for (const rec of records) {
          if (cancelled) return;
          try {
            const decoded = await audioEngine.decodePersistedBlob(rec.id, rec.blob);
            localBlobsRef.current.set(rec.id, {
              blob: rec.blob,
              fileName: rec.fileName,
              mimeType: rec.mimeType,
            });
            restoredWaveforms[rec.id] = decoded.waveform;
            restoredTracks.push({
              id: rec.id,
              title: rec.title,
              artist: rec.artist,
              genre: rec.genre,
              bpm: rec.bpm,
              musicalKey: rec.musicalKey,
              duration: decoded.duration || rec.duration,
              source: 'local',
              crateIds: rec.crateIds ?? [],
              favorite: Boolean(rec.favorite),
              addedAt: rec.addedAt,
              accentHex: rec.accentHex || '#38BDF8',
            });
          } catch (err) {
            if (!firstError) {
              firstError = err instanceof Error ? err.message : String(err);
            }
          }
        }

        if (!cancelled && restoredTracks.length > 0) {
          setWaveforms((prev) => ({ ...prev, ...restoredWaveforms }));
          setTracks((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const uniqueNew = restoredTracks.filter((t) => !existingIds.has(t.id));
            return [...uniqueNew, ...prev];
          });
          setSavedLocalCount(restoredTracks.length);
        } else if (!cancelled && records.length > 0 && firstError) {
          setImportError(`Could not restore saved local tracks: ${firstError}`);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setImportError(`Could not read browser audio storage: ${msg}`);
        }
      } finally {
        if (!cancelled) setIsRestoringSaved(false);
      }
    };

    void restoreSaved();
    return () => {
      cancelled = true;
    };
    // Only run once on initial mount when opt-in preference was enabled in a previous session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const applyTrackToDeck = useCallback(
    (deckId: DeckId, target: Track) => {
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
    [setDeckState]
  );

  const handleLoadDeck = useCallback(
    (deckId: DeckId, trackId: string) => {
      const target = tracks.find((t) => t.id === trackId);
      if (!target) return;
      applyTrackToDeck(deckId, target);
    },
    [tracks, applyTrackToDeck]
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

  const handleScratchStart = useCallback(
    (deckId: DeckId) => {
      const deck = deckId === 'A' ? deckA : deckB;
      const track = deckId === 'A' ? trackA : trackB;
      if (!track) return;
      ensureDeckBufferReady(deckId, track);
      audioEngine.setDeckVolume(deckId, deck.volume);
      audioEngine.setDeckEq(deckId, deck.eq);
      audioEngine.setDeckFilter(deckId, deck.filter);
      audioEngine.setCrossfader(mixer.crossfader, mixer.crossfaderCurve);
      audioEngine.setMasterGain(mixer.masterGain);
      audioEngine.startScratch(deckId);
    },
    [deckA, deckB, trackA, trackB, mixer, ensureDeckBufferReady]
  );

  const handleScratchMove = useCallback(
    (deckId: DeckId, deltaRadians: number, deltaMs: number) => {
      audioEngine.scratchMove(deckId, deltaRadians, deltaMs);
    },
    []
  );

  const handleScratchEnd = useCallback(
    (deckId: DeckId) => {
      const pos = audioEngine.endScratch(deckId);
      setDeckState(deckId, (prev) => ({ ...prev, currentTime: pos }));
    },
    [setDeckState]
  );

  const handleToggleVinylMode = useCallback(
    (deckId: DeckId) => {
      setDeckState(deckId, (prev) => ({ ...prev, vinylMode: !prev.vinylMode }));
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
  const handleToggleFavorite = useCallback(
    (trackId: string) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          const nextFav = !t.favorite;
          if (t.source === 'local' && persistLocalTracks) {
            void updatePersistedTrackMeta(trackId, { favorite: nextFav }).catch(() => {});
          }
          return { ...t, favorite: nextFav };
        })
      );
    },
    [persistLocalTracks]
  );

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

  const handleToggleTrackCrate = useCallback(
    (trackId: string, crateId: string) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          const nextCrates = t.crateIds.includes(crateId) ? [crateId] : [crateId, ...t.crateIds];
          if (t.source === 'local' && persistLocalTracks) {
            void updatePersistedTrackMeta(trackId, { crateIds: nextCrates }).catch(() => {});
          }
          return { ...t, crateIds: nextCrates };
        })
      );
    },
    [persistLocalTracks]
  );

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      setRecentlyImportedIds((prev) => prev.filter((id) => id !== trackId));
      setImportBanner((prev) => {
        if (!prev) return null;
        const remaining = prev.trackIds.filter((id) => id !== trackId);
        return remaining.length > 0 ? { ...prev, trackIds: remaining } : null;
      });
      localBlobsRef.current.delete(trackId);
      audioEngine.removeTrackBuffer(trackId);
      if (persistLocalTracks) {
        void deletePersistedLocalTrack(trackId)
          .then(() => {
            setSavedLocalCount((c) => Math.max(0, c - 1));
          })
          .catch(() => {});
      }
    },
    [persistLocalTracks]
  );

  const handleTogglePersistLocalTracks = useCallback(async () => {
    if (!isIndexedDbAvailable()) {
      setImportError('Local browser storage (IndexedDB) is not available in this browser.');
      return;
    }

    if (!persistLocalTracks) {
      // Opt IN: persist preference and immediately save any local tracks already imported this session
      setPersistLocalTracks(true);
      try {
        localStorage.setItem(STORAGE_PERSIST_KEY, 'true');
      } catch {
        // ignore
      }

      const localTracks = tracks.filter((t) => t.source === 'local');
      const recordsToSave: StoredLocalTrackRecord[] = [];
      for (const t of localTracks) {
        const entry = localBlobsRef.current.get(t.id);
        if (!entry) continue;
        recordsToSave.push({
          id: t.id,
          title: t.title,
          artist: t.artist,
          genre: t.genre,
          bpm: t.bpm,
          musicalKey: t.musicalKey,
          duration: t.duration,
          crateIds: t.crateIds,
          favorite: t.favorite,
          addedAt: t.addedAt,
          accentHex: t.accentHex,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          blob: entry.blob,
        });
      }

      if (recordsToSave.length > 0) {
        try {
          await savePersistedLocalTracks(recordsToSave);
          setSavedLocalCount(recordsToSave.length);
        } catch {
          setImportError('Could not save imported audio to browser storage (storage quota may be full).');
        }
      }
    } else {
      // Opt OUT: clear stored copies in IndexedDB while keeping active session tracks loaded in memory
      setPersistLocalTracks(false);
      try {
        localStorage.setItem(STORAGE_PERSIST_KEY, 'false');
      } catch {
        // ignore
      }
      try {
        await clearAllPersistedLocalTracks();
      } catch {
        // ignore
      }
      setSavedLocalCount(0);
    }
  }, [persistLocalTracks, tracks]);

  const handleClearSavedLocalTracks = useCallback(async () => {
    setPersistLocalTracks(false);
    try {
      localStorage.setItem(STORAGE_PERSIST_KEY, 'false');
    } catch {
      // ignore
    }
    try {
      await clearAllPersistedLocalTracks();
    } catch {
      // ignore
    }
    setSavedLocalCount(0);
  }, []);

  const handleImportFiles = useCallback(
    async (fileList: FileList | File[], targetDeckId?: DeckId) => {
      const files = filterSupportedAudioFiles(fileList);
      if (files.length === 0) {
        setImportError('No supported audio files found (MP3, WAV, OGG, FLAC, M4A, AAC, or WebM).');
        return;
      }

      setImportError(null);
      setIsImporting(true);
      setImportProgress({ current: 0, total: files.length });

      try {
        const newTracks: Track[] = [];
        const newWaveforms: Record<string, WaveformBin[]> = {};
        const recordsToPersist: StoredLocalTrackRecord[] = [];
        const baseTimestamp = Date.now();
        let failedCount = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setImportProgress({ current: i + 1, total: files.length });

          const id = `local-${baseTimestamp}-${i}-${Math.random().toString(36).slice(2, 7)}`;
          const rawBase = file.name.replace(/\.[^.]+$/, '').trim();
          const parts = rawBase.split(/\s+-\s+/);
          const artist =
            parts.length > 1
              ? parts[0].replace(/[_-]+/g, ' ').trim() || 'Local Audio'
              : 'Local Audio';
          const title =
            parts.length > 1
              ? parts.slice(1).join(' - ').replace(/[_]+/g, ' ').trim() || 'Untitled Track'
              : rawBase.replace(/[_-]+/g, ' ').trim() || 'Untitled Track';

          try {
            const rawBytes = await file.arrayBuffer();
            const mimeType = file.type || 'audio/mpeg';
            const standaloneBlob = new Blob([rawBytes], { type: mimeType });
            const decoded = await audioEngine.decodeImportedFile(id, file);
            newWaveforms[id] = decoded.waveform;
            const addedAt = baseTimestamp + i;
            const track: Track = {
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
              addedAt,
              accentHex: '#38BDF8',
            };
            newTracks.push(track);
            localBlobsRef.current.set(id, {
              blob: standaloneBlob,
              fileName: file.name,
              mimeType,
            });

            if (persistLocalTracks) {
              recordsToPersist.push({
                id: track.id,
                title: track.title,
                artist: track.artist,
                genre: track.genre,
                bpm: track.bpm,
                musicalKey: track.musicalKey,
                duration: track.duration,
                crateIds: [],
                favorite: false,
                addedAt,
                accentHex: track.accentHex,
                fileName: file.name,
                mimeType,
                blob: standaloneBlob,
              });
            }
          } catch {
            failedCount++;
          }
        }

        if (newTracks.length === 0) {
          setImportError('Could not decode the selected audio files in this browser.');
          return;
        }

        if (failedCount > 0) {
          setImportError(
            `Imported ${newTracks.length} ${newTracks.length === 1 ? 'track' : 'tracks'}, but ${failedCount} could not be decoded in this browser.`
          );
        }

        setWaveforms((prev) => ({ ...prev, ...newWaveforms }));
        setTracks((prev) => [...newTracks, ...prev]);

        if (persistLocalTracks && recordsToPersist.length > 0) {
          try {
            await savePersistedLocalTracks(recordsToPersist);
            setSavedLocalCount((prev) => prev + recordsToPersist.length);
          } catch {
            setImportError(
              'Tracks imported for this session, but browser storage quota prevented saving them across reloads.'
            );
          }
        }

        const primaryTrack = newTracks[newTracks.length - 1];
        if (targetDeckId && primaryTrack) {
          applyTrackToDeck(targetDeckId, primaryTrack);
        }

        const newIds = newTracks.map((t) => t.id);
        setRecentlyImportedIds(newIds);
        setImportVersion((v) => v + 1);
        setImportBanner({
          trackIds: newIds,
          loadedToDeck: targetDeckId ?? null,
        });
      } finally {
        setIsImporting(false);
        setImportProgress(null);
      }
    },
    [applyTrackToDeck, persistLocalTracks]
  );

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
          if (e.target.files && e.target.files.length > 0) {
            const picked = Array.from(e.target.files);
            e.target.value = '';
            void handleImportFiles(picked);
          }
        }}
      />

      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Import local audio folder"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const picked = Array.from(e.target.files);
            e.target.value = '';
            void handleImportFiles(picked);
          }
        }}
      />

      <TopBar
        showSamplerFx={showSamplerFx}
        persistLocalTracks={persistLocalTracks}
        onToggleSamplerFx={() => setShowSamplerFx((v) => !v)}
        onScrollToConsole={() => scrollToSection('console')}
        onScrollToLibrary={() => scrollToSection('library')}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onTriggerImport={() => fileInputRef.current?.click()}
        onTriggerImportFolder={() => folderInputRef.current?.click()}
        onTogglePersistLocalTracks={() => void handleTogglePersistLocalTracks()}
      />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
        {/* Immediate Top-of-Console Import Status & Quick-Load Banner */}
        {isImporting && (
          <div
            role="status"
            aria-live="polite"
            data-testid="import-status-banner"
            className="flex items-center gap-3 rounded-lg border border-sky-400/35 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-100"
          >
            <Upload className="h-4 w-4 shrink-0 text-sky-400 animate-pulse" aria-hidden="true" />
            <span>
              {importProgress && importProgress.total > 1
                ? `Importing folder/batch: decoding track ${importProgress.current} of ${importProgress.total}...`
                : 'Decoding audio locally and analyzing BPM & waveform...'}
            </span>
          </div>
        )}

        {importError && !isImporting && (
          <div
            role="alert"
            data-testid="import-error-banner"
            className="flex items-center justify-between gap-3 rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-xs text-red-200"
          >
            <span>{importError}</span>
            <button
              type="button"
              onClick={() => setImportError(null)}
              aria-label="Dismiss import error"
              className="p-1 text-red-300 hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {importBanner && !isImporting && (() => {
          const importedList = importBanner.trackIds
            .map((id) => tracks.find((t) => t.id === id))
            .filter((t): t is Track => Boolean(t));
          const primary = importedList[importedList.length - 1];
          if (!primary) return null;
          const isOnA = deckA.trackId === primary.id;
          const isOnB = deckB.trackId === primary.id;

          return (
            <div
              role="status"
              aria-live="polite"
              data-testid="import-confirm-banner"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-400/35 bg-[#111926] px-4 py-3"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-sky-400"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white">
                    {importedList.length === 1
                      ? `Imported “${primary.title}”`
                      : `Imported ${importedList.length} tracks · Latest: “${primary.title}”`}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-300">
                    <span className="font-mono tabular-nums text-sky-300">
                      {primary.bpm.toFixed(0)} BPM
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums">
                      {formatDuration(primary.duration)}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>
                      {importBanner.loadedToDeck
                        ? persistLocalTracks
                          ? `Loaded onto Deck ${importBanner.loadedToDeck} & saved locally in this browser`
                          : `Loaded onto Deck ${importBanner.loadedToDeck} & pinned to Library · Session only (clears on reload)`
                        : persistLocalTracks
                          ? 'Pinned to row #1 of Library (Imported) · Saved locally in this browser'
                          : 'Pinned to row #1 of Library (Imported) · Session only — clears on reload'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleLoadDeck('A', primary.id)}
                  className={`rounded-md border px-3 py-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isOnA
                      ? 'border-sky-400 bg-sky-500 text-slate-950'
                      : 'border-sky-400/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/30'
                  }`}
                >
                  {isOnA ? 'On Deck A' : 'Load Deck A'}
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadDeck('B', primary.id)}
                  className={`rounded-md border px-3 py-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isOnB
                      ? 'border-amber-400 bg-amber-500 text-slate-950'
                      : 'border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/30'
                  }`}
                >
                  {isOnB ? 'On Deck B' : 'Load Deck B'}
                </button>
                {!persistLocalTracks && (
                  <button
                    type="button"
                    onClick={() => void handleTogglePersistLocalTracks()}
                    className="rounded-md border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Remember on reload
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => scrollToSection('library')}
                  className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span>View in Library</span>
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setImportBanner(null)}
                  aria-label="Dismiss import notice"
                  className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })()}

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
              onScratchStart={() => handleScratchStart('A')}
              onScratchMove={(r, ms) => handleScratchMove('A', r, ms)}
              onScratchEnd={() => handleScratchEnd('A')}
              onToggleVinylMode={() => handleToggleVinylMode('A')}
              onNudge={(f) => audioEngine.setDeckNudge('A', f)}
              onPitchChange={(p) => handlePitchChange('A', p)}
              onTogglePitchRange={() => handleTogglePitchRange('A')}
              onHotCueTrigger={(i) => handleHotCueTrigger('A', i)}
              onHotCueClear={(i) => handleHotCueClear('A', i)}
              onToggleLoop={(b) => handleToggleLoop('A', b)}
              onDropAudioFiles={(files) => void handleImportFiles(files, 'A')}
              persistLocalTracks={persistLocalTracks}
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
              onScratchStart={() => handleScratchStart('B')}
              onScratchMove={(r, ms) => handleScratchMove('B', r, ms)}
              onScratchEnd={() => handleScratchEnd('B')}
              onToggleVinylMode={() => handleToggleVinylMode('B')}
              onNudge={(f) => audioEngine.setDeckNudge('B', f)}
              onPitchChange={(p) => handlePitchChange('B', p)}
              onTogglePitchRange={() => handleTogglePitchRange('B')}
              onHotCueTrigger={(i) => handleHotCueTrigger('B', i)}
              onHotCueClear={(i) => handleHotCueClear('B', i)}
              onToggleLoop={(b) => handleToggleLoop('B', b)}
              onDropAudioFiles={(files) => void handleImportFiles(files, 'B')}
              persistLocalTracks={persistLocalTracks}
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
          recentlyImportedIds={recentlyImportedIds}
          importVersion={importVersion}
          isImporting={isImporting}
          importProgress={importProgress}
          importError={importError}
          persistLocalTracks={persistLocalTracks}
          savedLocalCount={savedLocalCount}
          isRestoringSaved={isRestoringSaved}
          onTogglePersistLocalTracks={() => void handleTogglePersistLocalTracks()}
          onClearSavedLocalTracks={() => void handleClearSavedLocalTracks()}
          onLoadDeck={handleLoadDeck}
          onToggleFavorite={handleToggleFavorite}
          onCreateCrate={handleCreateCrate}
          onDeleteCrate={handleDeleteCrate}
          onToggleTrackCrate={handleToggleTrackCrate}
          onDeleteTrack={handleDeleteTrack}
          onImportFiles={(files) => void handleImportFiles(files)}
          onTriggerImport={() => fileInputRef.current?.click()}
          onTriggerImportFolder={() => folderInputRef.current?.click()}
        />
      </main>

      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
