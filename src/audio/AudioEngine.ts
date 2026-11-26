import type {
  CrossfaderCurve,
  DeckId,
  EqState,
  FxState,
  MeterLevels,
  SamplerPadId,
  SynthTrackPreset,
  WaveformBin,
} from '../types/dj';
import {
  calculateCrossfaderGains,
  clamp,
  computeReversedOffset,
  computeScratchStep,
  computeWaveformBins,
  estimateBpmFromChannelData,
  mapFilterKnob,
  pitchPercentToRate,
} from '../utils/djMath';
import { synthesizeSamplerBuffer, synthesizeTrackBuffer } from './synthTracks';
import { getVinylScratchWorkletUrl } from './vinylScratchWorklet';

interface DeckAudioChannel {
  trackId: string | null;
  buffer: AudioBuffer | null;
  reversedBuffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  transportGain: GainNode;
  scratchSource: AudioBufferSourceNode | null;
  scratchWorklet: AudioWorkletNode | null;
  workletTrackId: string | null;
  scratchPresence: BiquadFilterNode;
  scratchGain: GainNode;
  channelGain: GainNode;
  lowEq: BiquadFilterNode;
  midEq: BiquadFilterNode;
  highEq: BiquadFilterNode;
  colorFilter: BiquadFilterNode;
  crossfadeGain: GainNode;
  fxSendGain: GainNode;
  analyser: AnalyserNode;
  analyserData: Uint8Array<ArrayBuffer>;
  isPlaying: boolean;
  isScratching: boolean;
  isReleasingScratch: boolean;
  wasPlayingBeforeScratch: boolean;
  scratchPos: number;
  scratchTargetPos: number;
  scratchVel: number;
  scratchStopTimer: number | null;
  transportStopTimer: number | null;
  offsetSec: number;
  startedAtCtxTime: number;
  playbackRate: number;
  nudgeFactor: number;
  loopActive: boolean;
  loopStart: number;
  loopEnd: number;
  onEndedCallback?: () => void;
}

export class DjAudioEngine {
  private ctx: AudioContext | null = null;
  private decks: Record<DeckId, DeckAudioChannel> | null = null;
  private masterGain: GainNode | null = null;
  private samplerGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterAnalyserL: AnalyserNode | null = null;
  private masterAnalyserR: AnalyserNode | null = null;
  private masterDataL: Uint8Array<ArrayBuffer> | null = null;
  private masterDataR: Uint8Array<ArrayBuffer> | null = null;

  // Echo FX bus
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayWetGain: GainNode | null = null;
  private masterFxSendGain: GainNode | null = null;

  // Caches
  private bufferCache = new Map<string, AudioBuffer>();
  private reversedBufferCache = new Map<string, AudioBuffer>();
  private waveformCache = new Map<string, WaveformBin[]>();
  private samplerCache = new Map<SamplerPadId, AudioBuffer>();

  // Recording
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  // Cached mixer state
  private crossfaderPos = 0;
  private crossfaderCurve: CrossfaderCurve = 'smooth';

  // AudioWorklet vinyl scratch engine state
  private workletLoaded = false;
  private workletInitPromise: Promise<boolean> | null = null;

  private synthHelperCtx: BaseAudioContext | null = null;

  private getSynthContext(): BaseAudioContext {
    if (this.ctx) return this.ctx;
    if (!this.synthHelperCtx) {
      const OfflineCtx =
        window.OfflineAudioContext ||
        (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      this.synthHelperCtx = new OfflineCtx(2, 1, 44100);
    }
    return this.synthHelperCtx;
  }

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.initGraph(this.ctx);
      // Hydrate any buffers that were pre-loaded before the user's first gesture
      if (this.decks) {
        if (this.pendingTrackIds.A) {
          this.decks.A.trackId = this.pendingTrackIds.A;
          this.decks.A.buffer = this.bufferCache.get(this.pendingTrackIds.A) ?? null;
          this.decks.A.reversedBuffer = this.reversedBufferCache.get(this.pendingTrackIds.A) ?? null;
          this.decks.A.onEndedCallback = this.pendingOnEnded.A;
        }
        if (this.pendingTrackIds.B) {
          this.decks.B.trackId = this.pendingTrackIds.B;
          this.decks.B.buffer = this.bufferCache.get(this.pendingTrackIds.B) ?? null;
          this.decks.B.reversedBuffer = this.reversedBufferCache.get(this.pendingTrackIds.B) ?? null;
          this.decks.B.onEndedCallback = this.pendingOnEnded.B;
        }
      }
      // Eagerly register the vinyl scratch AudioWorklet so scratching is instant
      void this.initScratchWorklets(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private initScratchWorklets(ctx: AudioContext): Promise<boolean> {
    if (this.workletLoaded) return Promise.resolve(true);
    if (this.workletInitPromise) return this.workletInitPromise;
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return Promise.resolve(false);
    }

    this.workletInitPromise = ctx.audioWorklet
      .addModule(getVinylScratchWorkletUrl())
      .then(() => {
        if (!this.decks || this.ctx !== ctx) return false;
        (['A', 'B'] as DeckId[]).forEach((deckId) => {
          const deck = this.decks![deckId];
          const node = new AudioWorkletNode(ctx, 'vinyl-scratch-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          node.connect(deck.scratchPresence);
          node.port.onmessage = (event: MessageEvent) => {
            const msg = event.data;
            if (!msg || !this.decks) return;
            const d = this.decks[deckId];
            if (msg.type === 'pos' && d.isScratching) {
              d.scratchPos = msg.posSec;
              d.scratchVel = msg.velSec;
              d.offsetSec = msg.posSec;
            } else if (msg.type === 'releaseComplete') {
              this.finishScratchRelease(deckId, msg.posSec);
            }
          };
          deck.scratchWorklet = node;
          this.syncWorkletBuffer(deckId);

          // If the user already touched the platter before addModule finished, engage immediately
          if (deck.isScratching && !deck.isReleasingScratch) {
            const now = ctx.currentTime;
            node.port.postMessage({
              type: 'touchStart',
              posSec: deck.scratchPos,
              initialVel: deck.scratchVel,
              wasPlaying: deck.wasPlayingBeforeScratch,
              targetPlaybackRate: deck.playbackRate * deck.nudgeFactor,
            });
            node.port.postMessage({
              type: 'touchMove',
              targetPosSec: deck.scratchTargetPos,
            });
            deck.scratchGain.gain.cancelScheduledValues(now);
            deck.scratchGain.gain.setValueAtTime(deck.scratchGain.gain.value, now);
            deck.scratchGain.gain.linearRampToValueAtTime(1.0, now + 0.006);
          }
        });
        this.workletLoaded = true;
        return true;
      })
      .catch(() => false);

    return this.workletInitPromise;
  }

  private syncWorkletBuffer(deckId: DeckId): void {
    const deck = this.decks?.[deckId];
    if (!deck || !deck.scratchWorklet || !deck.buffer || !deck.trackId) return;
    if (deck.workletTrackId === deck.trackId) return;
    const left = deck.buffer.getChannelData(0);
    const right = deck.buffer.numberOfChannels > 1 ? deck.buffer.getChannelData(1) : left;
    deck.scratchWorklet.port.postMessage({
      type: 'loadBuffer',
      left,
      right,
      sampleRate: deck.buffer.sampleRate,
    });
    deck.workletTrackId = deck.trackId;
  }

  private pendingTrackIds: Record<DeckId, string | null> = { A: null, B: null };
  private pendingOnEnded: Record<DeckId, (() => void) | undefined> = { A: undefined, B: undefined };

  private initGraph(ctx: AudioContext): void {
    const masterBus = ctx.createGain();
    masterBus.gain.value = 1;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.9;

    this.samplerGain = ctx.createGain();
    this.samplerGain.gain.value = 0.75;

    // Echo / Delay FX bus
    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.25;
    this.delayFeedbackGain = ctx.createGain();
    this.delayFeedbackGain.gain.value = 0.42;
    this.delayWetGain = ctx.createGain();
    this.delayWetGain.gain.value = 0.0;
    this.masterFxSendGain = ctx.createGain();
    this.masterFxSendGain.gain.value = 0.0;

    // Delay feedback loop with subtle lowpass tone
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 3400;

    this.delayNode.connect(delayTone);
    delayTone.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    delayTone.connect(this.delayWetGain);
    this.delayWetGain.connect(this.compressor);

    // Master stereo metering split
    const splitter = ctx.createChannelSplitter(2);
    this.masterAnalyserL = ctx.createAnalyser();
    this.masterAnalyserL.fftSize = 256;
    this.masterAnalyserR = ctx.createAnalyser();
    this.masterAnalyserR.fftSize = 256;
    this.masterDataL = new Uint8Array(new ArrayBuffer(this.masterAnalyserL.fftSize));
    this.masterDataR = new Uint8Array(new ArrayBuffer(this.masterAnalyserR.fftSize));

    masterBus.connect(this.compressor);
    masterBus.connect(this.masterFxSendGain);
    this.masterFxSendGain.connect(this.delayNode);
    this.samplerGain.connect(this.compressor);

    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
    this.masterGain.connect(splitter);
    splitter.connect(this.masterAnalyserL, 0);
    splitter.connect(this.masterAnalyserR, 1);

    // Recording destination (graceful if unavailable in headless env)
    if (typeof ctx.createMediaStreamDestination === 'function') {
      this.recordDest = ctx.createMediaStreamDestination();
      this.masterGain.connect(this.recordDest);
    }

    const createDeck = (): DeckAudioChannel => {
      const channelGain = ctx.createGain();
      channelGain.gain.value = 0.85;

      const transportGain = ctx.createGain();
      transportGain.gain.value = 1;
      transportGain.connect(channelGain);

      // Subtle cartridge-style upper-mid presence so vinyl scratches cut cleanly through the mix
      const scratchPresence = ctx.createBiquadFilter();
      scratchPresence.type = 'peaking';
      scratchPresence.frequency.value = 2400;
      scratchPresence.Q.value = 0.85;
      scratchPresence.gain.value = 2.2;

      const scratchGain = ctx.createGain();
      scratchGain.gain.value = 0;
      scratchPresence.connect(scratchGain);
      scratchGain.connect(channelGain);

      const lowEq = ctx.createBiquadFilter();
      lowEq.type = 'lowshelf';
      lowEq.frequency.value = 250;
      lowEq.gain.value = 0;

      const midEq = ctx.createBiquadFilter();
      midEq.type = 'peaking';
      midEq.frequency.value = 1100;
      midEq.Q.value = 1.0;
      midEq.gain.value = 0;

      const highEq = ctx.createBiquadFilter();
      highEq.type = 'highshelf';
      highEq.frequency.value = 3800;
      highEq.gain.value = 0;

      const colorFilter = ctx.createBiquadFilter();
      colorFilter.type = 'allpass';
      colorFilter.frequency.value = 1000;
      colorFilter.Q.value = 0.7;

      const crossfadeGain = ctx.createGain();
      crossfadeGain.gain.value = 0.707;

      const fxSendGain = ctx.createGain();
      fxSendGain.gain.value = 0;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      channelGain.connect(lowEq);
      lowEq.connect(midEq);
      midEq.connect(highEq);
      highEq.connect(colorFilter);
      colorFilter.connect(crossfadeGain);
      crossfadeGain.connect(analyser);
      analyser.connect(masterBus);

      // FX send taps post-filter
      colorFilter.connect(fxSendGain);
      fxSendGain.connect(this.delayNode!);

      return {
        trackId: null,
        buffer: null,
        reversedBuffer: null,
        source: null,
        transportGain,
        scratchSource: null,
        scratchWorklet: null,
        workletTrackId: null,
        scratchPresence,
        scratchGain,
        channelGain,
        lowEq,
        midEq,
        highEq,
        colorFilter,
        crossfadeGain,
        fxSendGain,
        analyser,
        analyserData: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        isPlaying: false,
        isScratching: false,
        isReleasingScratch: false,
        wasPlayingBeforeScratch: false,
        scratchPos: 0,
        scratchTargetPos: 0,
        scratchVel: 0,
        scratchStopTimer: null,
        transportStopTimer: null,
        offsetSec: 0,
        startedAtCtxTime: 0,
        playbackRate: 1,
        nudgeFactor: 1,
        loopActive: false,
        loopStart: 0,
        loopEnd: 0,
      };
    };

    this.decks = {
      A: createDeck(),
      B: createDeck(),
    };

    this.applyCrossfader();
  }

  public getWaveform(trackId: string): WaveformBin[] | null {
    return this.waveformCache.get(trackId) ?? null;
  }

  public hasBuffer(trackId: string): boolean {
    return this.bufferCache.has(trackId);
  }

  public ensureSynthTrack(trackId: string, preset: SynthTrackPreset): { duration: number; waveform: WaveformBin[] } {
    const ctx = this.getSynthContext();
    let buffer = this.bufferCache.get(trackId);
    if (!buffer) {
      buffer = synthesizeTrackBuffer(ctx, preset);
      this.bufferCache.set(trackId, buffer);
    }
    let waveform = this.waveformCache.get(trackId);
    if (!waveform) {
      waveform = computeWaveformBins(buffer.getChannelData(0), 720);
      this.waveformCache.set(trackId, waveform);
    }
    return { duration: buffer.duration, waveform };
  }

  public async decodeImportedFile(
    trackId: string,
    file: File
  ): Promise<{ duration: number; bpm: number; waveform: WaveformBin[] }> {
    const ctx = this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    this.bufferCache.set(trackId, buffer);
    const channelData = buffer.getChannelData(0);
    const waveform = computeWaveformBins(channelData, 720);
    this.waveformCache.set(trackId, waveform);
    const bpm = estimateBpmFromChannelData(channelData, buffer.sampleRate);
    return {
      duration: buffer.duration,
      bpm,
      waveform,
    };
  }

  /**
   * Decodes a locally persisted Blob using OfflineAudioContext so restoring saved
   * IndexedDB tracks on page load never triggers browser AudioContext autoplay warnings.
   */
  public async decodePersistedBlob(
    trackId: string,
    blob: Blob
  ): Promise<{ duration: number; waveform: WaveformBin[] }> {
    const ctx = this.getSynthContext();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    this.bufferCache.set(trackId, buffer);
    const waveform = computeWaveformBins(buffer.getChannelData(0), 720);
    this.waveformCache.set(trackId, waveform);
    return {
      duration: buffer.duration,
      waveform,
    };
  }

  public removeTrackBuffer(trackId: string): void {
    this.bufferCache.delete(trackId);
    this.reversedBufferCache.delete(trackId);
    this.waveformCache.delete(trackId);
  }

  public loadTrackToDeck(
    deckId: DeckId,
    trackId: string,
    preset?: SynthTrackPreset,
    onEnded?: () => void
  ): { duration: number; waveform: WaveformBin[] } | null {
    this.pendingTrackIds[deckId] = trackId;
    this.pendingOnEnded[deckId] = onEnded;

    if (!this.bufferCache.has(trackId) && preset) {
      this.ensureSynthTrack(trackId, preset);
    }

    const buffer = this.bufferCache.get(trackId) ?? null;
    if (!buffer) return null;

    if (this.decks) {
      this.cancelScratch(deckId);
      this.stopSource(deckId);
      const deck = this.decks[deckId];
      deck.trackId = trackId;
      deck.isPlaying = false;
      deck.offsetSec = 0;
      deck.scratchPos = 0;
      deck.scratchTargetPos = 0;
      deck.scratchVel = 0;
      deck.loopActive = false;
      deck.onEndedCallback = onEnded;
      deck.buffer = buffer;
      deck.reversedBuffer = this.reversedBufferCache.get(trackId) ?? null;
      deck.workletTrackId = null;
      this.syncWorkletBuffer(deckId);
    }

    let waveform = this.waveformCache.get(trackId);
    if (!waveform) {
      waveform = computeWaveformBins(buffer.getChannelData(0), 720);
      this.waveformCache.set(trackId, waveform);
    }

    return { duration: buffer.duration, waveform };
  }

  private stopSource(deckId: DeckId): void {
    const deck = this.decks?.[deckId];
    if (!deck || !deck.source) return;
    try {
      deck.source.onended = null;
      deck.source.stop();
      deck.source.disconnect();
    } catch {
      // ignore already stopped node
    }
    deck.source = null;
  }

  private startSourceFromOffset(deckId: DeckId, offsetSec: number): void {
    if (!this.ctx || !this.decks) return;
    const deck = this.decks[deckId];
    if (!deck.buffer) return;

    this.stopSource(deckId);

    const safeOffset = clamp(offsetSec, 0, Math.max(0, deck.buffer.duration - 0.02));
    const source = this.ctx.createBufferSource();
    source.buffer = deck.buffer;
    source.playbackRate.value = deck.playbackRate * deck.nudgeFactor;

    if (deck.loopActive && deck.loopEnd > deck.loopStart + 0.05) {
      source.loop = true;
      source.loopStart = deck.loopStart;
      source.loopEnd = deck.loopEnd;
    } else {
      source.loop = false;
    }

    source.connect(deck.transportGain);
    source.onended = () => {
      if (deck.source === source && deck.isPlaying && !deck.loopActive) {
        deck.isPlaying = false;
        deck.offsetSec = 0;
        deck.source = null;
        deck.onEndedCallback?.();
      }
    };

    source.start(0, safeOffset);
    deck.source = source;
    deck.offsetSec = safeOffset;
    deck.startedAtCtxTime = this.ctx.currentTime;
    deck.isPlaying = true;
  }

  public play(deckId: DeckId): void {
    const ctx = this.ensureContext();
    const deck = this.decks?.[deckId];
    if (!deck || !deck.buffer || deck.isPlaying) return;
    this.cancelScratch(deckId);
    deck.transportGain.gain.cancelScheduledValues(ctx.currentTime);
    deck.transportGain.gain.setValueAtTime(1, ctx.currentTime);
    this.startSourceFromOffset(deckId, deck.offsetSec);
  }

  public pause(deckId: DeckId): number {
    const deck = this.decks?.[deckId];
    if (!deck) return 0;
    const pos = this.getDeckPosition(deckId);
    this.cancelScratch(deckId);
    this.stopSource(deckId);
    deck.isPlaying = false;
    deck.offsetSec = pos;
    return pos;
  }

  public seek(deckId: DeckId, timeSec: number): number {
    const deck = this.decks?.[deckId];
    if (!deck || !deck.buffer) return 0;
    const wasPlaying = deck.isPlaying || (deck.isScratching && deck.wasPlayingBeforeScratch);
    this.cancelScratch(deckId);
    const clamped = clamp(timeSec, 0, Math.max(0, deck.buffer.duration - 0.02));
    deck.offsetSec = clamped;
    if (wasPlaying) {
      if (this.ctx) {
        deck.transportGain.gain.cancelScheduledValues(this.ctx.currentTime);
        deck.transportGain.gain.setValueAtTime(1, this.ctx.currentTime);
      }
      this.startSourceFromOffset(deckId, clamped);
    }
    return clamped;
  }

  private getOrCreateReversedBuffer(trackId: string, forward: AudioBuffer): AudioBuffer {
    const existing = this.reversedBufferCache.get(trackId);
    if (existing) return existing;
    const ctx = this.ensureContext();
    const rev = ctx.createBuffer(forward.numberOfChannels, forward.length, forward.sampleRate);
    for (let ch = 0; ch < forward.numberOfChannels; ch++) {
      const src = forward.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      const last = src.length - 1;
      for (let i = 0; i < src.length; i++) {
        dst[i] = src[last - i];
      }
    }
    this.reversedBufferCache.set(trackId, rev);
    return rev;
  }

  private stopScratchSource(deckId: DeckId): void {
    const deck = this.decks?.[deckId];
    if (!deck) return;
    if (deck.scratchStopTimer !== null) {
      window.clearTimeout(deck.scratchStopTimer);
      deck.scratchStopTimer = null;
    }
    if (deck.scratchSource) {
      try {
        deck.scratchSource.stop();
        deck.scratchSource.disconnect();
      } catch {
        // ignore already stopped
      }
      deck.scratchSource = null;
    }
  }

  private cancelScratch(deckId: DeckId): void {
    const deck = this.decks?.[deckId];
    if (!deck) return;
    if (deck.transportStopTimer !== null) {
      window.clearTimeout(deck.transportStopTimer);
      deck.transportStopTimer = null;
    }
    this.stopScratchSource(deckId);
    deck.scratchWorklet?.port.postMessage({ type: 'cancel' });
    deck.isScratching = false;
    deck.isReleasingScratch = false;
    deck.wasPlayingBeforeScratch = false;
    deck.scratchVel = 0;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setTargetAtTime(0, now, 0.005);
      deck.transportGain.gain.cancelScheduledValues(now);
      deck.transportGain.gain.setTargetAtTime(1, now, 0.005);
    }
  }

  private finishScratchRelease(deckId: DeckId, finalPos: number): void {
    const deck = this.decks?.[deckId];
    if (!deck || !deck.isScratching || !deck.isReleasingScratch) return;

    const resumePlayback = deck.wasPlayingBeforeScratch && Boolean(deck.buffer);
    deck.isScratching = false;
    deck.isReleasingScratch = false;
    deck.wasPlayingBeforeScratch = false;
    deck.scratchPos = finalPos;
    deck.scratchTargetPos = finalPos;
    deck.scratchVel = 0;
    deck.offsetSec = finalPos;

    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (resumePlayback) {
      // Seamless 12ms crossfade back to main transport while worklet holds handoff velocity
      deck.transportGain.gain.cancelScheduledValues(now);
      deck.transportGain.gain.setValueAtTime(0, now);
      this.startSourceFromOffset(deckId, finalPos);
      deck.transportGain.gain.linearRampToValueAtTime(1, now + 0.012);

      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setValueAtTime(deck.scratchGain.gain.value, now);
      deck.scratchGain.gain.linearRampToValueAtTime(0, now + 0.014);
    } else {
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setValueAtTime(deck.scratchGain.gain.value, now);
      deck.scratchGain.gain.linearRampToValueAtTime(0, now + 0.01);
      deck.transportGain.gain.cancelScheduledValues(now);
      deck.transportGain.gain.setValueAtTime(1, now);
    }
  }

  public startScratch(deckId: DeckId): void {
    const ctx = this.ensureContext();
    const deck = this.decks?.[deckId];
    if (!deck || !deck.buffer) return;

    if (deck.transportStopTimer !== null) {
      window.clearTimeout(deck.transportStopTimer);
      deck.transportStopTimer = null;
    }

    // Re-grabbing platter during a backspin/spin-up preserves playing state seamlessly
    const regrabbingDuringRelease = deck.isScratching && deck.isReleasingScratch;
    const currentPos = regrabbingDuringRelease ? deck.scratchPos : this.getDeckPosition(deckId);
    const wasPlaying = regrabbingDuringRelease ? deck.wasPlayingBeforeScratch : deck.isPlaying;
    const initialVel = regrabbingDuringRelease
      ? deck.scratchVel
      : deck.isPlaying
        ? deck.playbackRate * deck.nudgeFactor
        : 0;

    deck.wasPlayingBeforeScratch = wasPlaying;
    deck.scratchPos = currentPos;
    deck.scratchTargetPos = currentPos;
    deck.scratchVel = initialVel;
    deck.offsetSec = currentPos;
    deck.isScratching = true;
    deck.isReleasingScratch = false;

    const now = ctx.currentTime;

    // Click-free 6ms fade down of normal transport before stopping source node
    if (deck.source) {
      deck.transportGain.gain.cancelScheduledValues(now);
      deck.transportGain.gain.setValueAtTime(deck.transportGain.gain.value, now);
      deck.transportGain.gain.linearRampToValueAtTime(0, now + 0.006);
      deck.transportStopTimer = window.setTimeout(() => {
        if (this.decks?.[deckId].isScratching) {
          this.stopSource(deckId);
        }
      }, 14);
    } else {
      deck.transportGain.gain.cancelScheduledValues(now);
      deck.transportGain.gain.setValueAtTime(0, now);
    }

    if (deck.scratchWorklet) {
      this.syncWorkletBuffer(deckId);
      deck.scratchWorklet.port.postMessage({
        type: 'touchStart',
        posSec: currentPos,
        initialVel,
        wasPlaying,
        targetPlaybackRate: deck.playbackRate * deck.nudgeFactor,
      });
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setValueAtTime(deck.scratchGain.gain.value, now);
      deck.scratchGain.gain.linearRampToValueAtTime(1.0, now + 0.006);
      return;
    }

    // Fallback for environments without AudioWorklet
    if (!deck.reversedBuffer && deck.trackId) {
      deck.reversedBuffer = this.getOrCreateReversedBuffer(deck.trackId, deck.buffer);
    }
    this.stopScratchSource(deckId);
    deck.scratchGain.gain.cancelScheduledValues(now);
    deck.scratchGain.gain.setTargetAtTime(0, now, 0.006);
  }

  public scratchMove(deckId: DeckId, deltaRadians: number, deltaMs: number): number {
    const ctx = this.ensureContext();
    const deck = this.decks?.[deckId];
    if (!deck || !deck.buffer || !deck.isScratching) return 0;

    const dur = deck.buffer.duration;
    // 33.3 RPM turntable feel: 1.8s per full revolution
    const deltaSec = (deltaRadians / (Math.PI * 2)) * 1.8;
    const nextTarget = clamp(deck.scratchTargetPos + deltaSec, 0, Math.max(0, dur - 0.02));
    deck.scratchTargetPos = nextTarget;

    if (deck.scratchWorklet) {
      deck.scratchWorklet.port.postMessage({
        type: 'touchMove',
        targetPosSec: nextTarget,
      });
      return deck.scratchPos;
    }

    // Graceful fallback if AudioWorklet is unavailable
    const step = computeScratchStep(deltaRadians, deltaMs);
    const prevPos = deck.scratchPos;
    const nextPos = clamp(prevPos + step.deltaSec, 0, Math.max(0, dur - 0.02));
    deck.scratchPos = nextPos;
    deck.offsetSec = nextPos;

    this.stopScratchSource(deckId);
    const now = ctx.currentTime;
    if (step.direction === 'hold' || step.speed < 0.08) {
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setTargetAtTime(0, now, 0.008);
      return nextPos;
    }

    const useReverse = step.direction === 'reverse';
    const buf = useReverse
      ? deck.reversedBuffer ?? (deck.trackId ? this.getOrCreateReversedBuffer(deck.trackId, deck.buffer) : deck.buffer)
      : deck.buffer;
    const startOffset = useReverse
      ? computeReversedOffset(prevPos, dur)
      : clamp(prevPos, 0, Math.max(0, dur - 0.02));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clamp(step.speed, 0.15, 4.0);
    src.connect(deck.scratchPresence);
    deck.scratchGain.gain.cancelScheduledValues(now);
    deck.scratchGain.gain.setTargetAtTime(0.95, now, 0.006);
    try {
      src.start(0, startOffset, 0.24);
      deck.scratchSource = src;
    } catch {
      src.disconnect();
    }
    deck.scratchStopTimer = window.setTimeout(() => {
      if (!this.ctx || !this.decks) return;
      const d = this.decks[deckId];
      d.scratchGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
      this.stopScratchSource(deckId);
    }, 95);
    return nextPos;
  }

  public endScratch(deckId: DeckId): number {
    const deck = this.decks?.[deckId];
    if (!deck || !deck.isScratching) return 0;

    if (deck.scratchWorklet) {
      deck.isReleasingScratch = true;
      deck.scratchWorklet.port.postMessage({
        type: 'touchEnd',
        wasPlaying: deck.wasPlayingBeforeScratch,
        targetPlaybackRate: deck.playbackRate * deck.nudgeFactor,
      });
      return deck.scratchPos;
    }

    // Fallback release
    const finalPos = deck.scratchPos;
    this.stopScratchSource(deckId);
    if (this.ctx) {
      const now = this.ctx.currentTime;
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setTargetAtTime(0, now, 0.008);
      deck.transportGain.gain.cancelScheduledValues(now);
      deck.transportGain.gain.setValueAtTime(1, now);
    }
    const shouldResume = deck.wasPlayingBeforeScratch && Boolean(deck.buffer);
    deck.isScratching = false;
    deck.isReleasingScratch = false;
    deck.wasPlayingBeforeScratch = false;
    deck.offsetSec = finalPos;

    if (shouldResume) {
      this.startSourceFromOffset(deckId, finalPos);
    }
    return finalPos;
  }

  public getDeckPosition(deckId: DeckId): number {
    if (!this.ctx || !this.decks) return 0;
    const deck = this.decks[deckId];
    if (!deck.buffer) return 0;
    if (deck.isScratching) return deck.scratchPos;
    if (!deck.isPlaying) return deck.offsetSec;

    const elapsed = (this.ctx.currentTime - deck.startedAtCtxTime) * deck.playbackRate * deck.nudgeFactor;
    let pos = deck.offsetSec + elapsed;

    if (deck.loopActive && deck.loopEnd > deck.loopStart + 0.05) {
      const loopLen = deck.loopEnd - deck.loopStart;
      if (pos >= deck.loopEnd) {
        pos = deck.loopStart + ((pos - deck.loopStart) % loopLen);
      }
    }

    return clamp(pos, 0, deck.buffer.duration);
  }

  public setDeckPitch(deckId: DeckId, pitchPercent: number): void {
    if (!this.ctx || !this.decks) return;
    const deck = this.decks[deckId];
    const currentPos = this.getDeckPosition(deckId);
    deck.offsetSec = currentPos;
    deck.startedAtCtxTime = this.ctx.currentTime;
    deck.playbackRate = pitchPercentToRate(pitchPercent);
    if (deck.source) {
      deck.source.playbackRate.setTargetAtTime(
        deck.playbackRate * deck.nudgeFactor,
        this.ctx.currentTime,
        0.015
      );
    }
  }

  public setDeckNudge(deckId: DeckId, factor: number): void {
    if (!this.ctx || !this.decks) return;
    const deck = this.decks[deckId];
    const currentPos = this.getDeckPosition(deckId);
    deck.offsetSec = currentPos;
    deck.startedAtCtxTime = this.ctx.currentTime;
    deck.nudgeFactor = clamp(factor, 0.75, 1.25);
    if (deck.source) {
      deck.source.playbackRate.setTargetAtTime(
        deck.playbackRate * deck.nudgeFactor,
        this.ctx.currentTime,
        0.01
      );
    }
  }

  public setDeckLoop(deckId: DeckId, active: boolean, startSec: number, endSec: number): void {
    const deck = this.decks?.[deckId];
    if (!deck) return;
    deck.loopActive = active;
    deck.loopStart = startSec;
    deck.loopEnd = endSec;
    if (deck.source) {
      deck.source.loop = active && endSec > startSec + 0.05;
      if (deck.source.loop) {
        deck.source.loopStart = startSec;
        deck.source.loopEnd = endSec;
      }
    }
  }

  public setDeckVolume(deckId: DeckId, volume: number): void {
    if (!this.ctx || !this.decks) return;
    this.decks[deckId].channelGain.gain.setTargetAtTime(
      clamp(volume, 0, 1.2),
      this.ctx.currentTime,
      0.012
    );
  }

  public setDeckEq(deckId: DeckId, eq: EqState): void {
    if (!this.ctx || !this.decks) return;
    const deck = this.decks[deckId];
    const now = this.ctx.currentTime;
    deck.lowEq.gain.setTargetAtTime(eq.killLow ? -42 : eq.low, now, 0.015);
    deck.midEq.gain.setTargetAtTime(eq.killMid ? -42 : eq.mid, now, 0.015);
    deck.highEq.gain.setTargetAtTime(eq.killHigh ? -42 : eq.high, now, 0.015);
  }

  public setDeckFilter(deckId: DeckId, value: number): void {
    if (!this.ctx || !this.decks) return;
    const deck = this.decks[deckId];
    const mapped = mapFilterKnob(value);
    const now = this.ctx.currentTime;
    deck.colorFilter.type = mapped.type;
    deck.colorFilter.frequency.setTargetAtTime(mapped.frequency, now, 0.02);
    deck.colorFilter.Q.setTargetAtTime(mapped.q, now, 0.02);
  }

  public setCrossfader(position: number, curve: CrossfaderCurve): void {
    this.crossfaderPos = clamp(position, -1, 1);
    this.crossfaderCurve = curve;
    this.applyCrossfader();
  }

  private applyCrossfader(): void {
    if (!this.ctx || !this.decks) return;
    const { gainA, gainB } = calculateCrossfaderGains(this.crossfaderPos, this.crossfaderCurve);
    const now = this.ctx.currentTime;
    this.decks.A.crossfadeGain.gain.setTargetAtTime(gainA, now, 0.01);
    this.decks.B.crossfadeGain.gain.setTargetAtTime(gainB, now, 0.01);
  }

  public setMasterGain(gain: number): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(clamp(gain, 0, 1.3), this.ctx.currentTime, 0.015);
  }

  public setSamplerVolume(vol: number): void {
    if (!this.ctx || !this.samplerGain) return;
    this.samplerGain.gain.setTargetAtTime(clamp(vol, 0, 1), this.ctx.currentTime, 0.015);
  }

  public setFxState(fx: FxState, masterBpm: number): void {
    if (
      !this.ctx ||
      !this.decks ||
      !this.delayNode ||
      !this.delayFeedbackGain ||
      !this.delayWetGain ||
      !this.masterFxSendGain
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const safeBpm = masterBpm > 50 ? masterBpm : 124;
    const delayTime = clamp((60 / safeBpm) * fx.echoBeats, 0.06, 1.5);

    this.delayNode.delayTime.setTargetAtTime(delayTime, now, 0.03);
    this.delayFeedbackGain.gain.setTargetAtTime(clamp(fx.echoFeedback, 0, 0.85), now, 0.02);
    this.delayWetGain.gain.setTargetAtTime(fx.echoEnabled ? clamp(fx.echoWet, 0, 1) : 0, now, 0.02);

    this.decks.A.fxSendGain.gain.setTargetAtTime(
      fx.echoEnabled && fx.echoTarget === 'A' ? 1 : 0,
      now,
      0.02
    );
    this.decks.B.fxSendGain.gain.setTargetAtTime(
      fx.echoEnabled && fx.echoTarget === 'B' ? 1 : 0,
      now,
      0.02
    );
    this.masterFxSendGain.gain.setTargetAtTime(
      fx.echoEnabled && fx.echoTarget === 'MASTER' ? 0.85 : 0,
      now,
      0.02
    );
  }

  public triggerSampler(padId: SamplerPadId): void {
    const ctx = this.ensureContext();
    if (!this.samplerGain) return;
    let buf = this.samplerCache.get(padId);
    if (!buf) {
      buf = synthesizeSamplerBuffer(ctx, padId);
      this.samplerCache.set(padId, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.samplerGain);
    src.start(0);
  }

  private computeRmsLevel(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): number {
    analyser.getByteTimeDomainData(data);
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rms = Math.sqrt(sumSq / data.length);
    return clamp(rms * 2.6, 0, 1);
  }

  public getLevels(): MeterLevels {
    if (
      !this.decks ||
      !this.masterAnalyserL ||
      !this.masterAnalyserR ||
      !this.masterDataL ||
      !this.masterDataR
    ) {
      return { deckA: 0, deckB: 0, masterL: 0, masterR: 0 };
    }
    return {
      deckA:
        this.decks.A.isPlaying || this.decks.A.isScratching
          ? this.computeRmsLevel(this.decks.A.analyser, this.decks.A.analyserData)
          : 0,
      deckB:
        this.decks.B.isPlaying || this.decks.B.isScratching
          ? this.computeRmsLevel(this.decks.B.analyser, this.decks.B.analyserData)
          : 0,
      masterL: this.computeRmsLevel(this.masterAnalyserL, this.masterDataL),
      masterR: this.computeRmsLevel(this.masterAnalyserR, this.masterDataR),
    };
  }

  public startRecording(): boolean {
    this.ensureContext();
    if (!this.recordDest || typeof MediaRecorder === 'undefined') return false;
    try {
      this.recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      this.mediaRecorder = new MediaRecorder(this.recordDest.stream, { mimeType });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.start(250);
      return true;
    } catch {
      return false;
    }
  }

  public stopRecording(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        this.mediaRecorder = null;
        resolve(url);
      };
      this.mediaRecorder.stop();
    });
  }
}

export const audioEngine = new DjAudioEngine();
