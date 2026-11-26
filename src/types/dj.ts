export type DeckId = 'A' | 'B';

export type CrossfaderCurve = 'smooth' | 'linear' | 'scratch';

export type SynthTrackPreset =
  | 'deep-house'
  | 'acid-techno'
  | 'breakbeat'
  | 'melodic-techno'
  | 'uk-garage'
  | 'dub-minimal'
  | 'electro-funk'
  | 'peak-trance';

export interface WaveformBin {
  low: number;
  mid: number;
  high: number;
  peak: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  musicalKey: string;
  duration: number;
  source: 'synth' | 'local';
  preset?: SynthTrackPreset;
  crateIds: string[];
  favorite: boolean;
  addedAt: number;
  accentHex: string;
}

export interface HotCue {
  index: number; // 0..3
  time: number | null;
  label: string;
}

export interface EqState {
  high: number; // -24..+12 dB
  mid: number;
  low: number;
  killHigh: boolean;
  killMid: boolean;
  killLow: boolean;
}

export interface DeckState {
  id: DeckId;
  trackId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  pitchPercent: number; // -16..+16
  pitchRange: 8 | 16;
  volume: number; // 0..1
  filter: number; // -1 (LPF) .. 0 (bypass) .. +1 (HPF)
  eq: EqState;
  cuePoint: number;
  hotCues: HotCue[];
  loopActive: boolean;
  loopBeats: number; // 0.5, 1, 2, 4, 8
  loopStart: number;
  loopEnd: number;
  syncLocked: boolean;
  keyLock: boolean;
  vinylMode: boolean;
}

export interface FxState {
  echoEnabled: boolean;
  echoWet: number; // 0..1
  echoFeedback: number; // 0..0.85
  echoBeats: number; // 0.25, 0.5, 0.75, 1
  echoTarget: 'A' | 'B' | 'MASTER';
}

export interface MixerState {
  crossfader: number; // -1 (A) .. 0 (center) .. +1 (B)
  crossfaderCurve: CrossfaderCurve;
  masterGain: number; // 0..1.25
  samplerVolume: number; // 0..1
  autoMixActive: boolean;
  autoMixTarget: DeckId | null;
  autoMixDurationSec: number;
  fx: FxState;
}

export interface Crate {
  id: string;
  name: string;
  isSystem?: boolean;
}

export type SortField = 'addedAt' | 'title' | 'artist' | 'bpm' | 'musicalKey' | 'genre' | 'duration';
export type SortDirection = 'asc' | 'desc';

export type SamplerPadId = 'airhorn' | 'sub-drop' | 'synth-rise' | 'vinyl-stop';

export interface SamplerPadInfo {
  id: SamplerPadId;
  label: string;
  subtitle: string;
  shortcut: string;
}

export interface MeterLevels {
  deckA: number; // 0..1
  deckB: number; // 0..1
  masterL: number; // 0..1
  masterR: number; // 0..1
}
