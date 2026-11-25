import React, { useEffect, useRef } from 'react';
import { Pause, Play, RefreshCw, Repeat, RotateCcw } from 'lucide-react';
import type { DeckId, DeckState, Track, WaveformBin } from '../types/dj';
import {
  calculateEffectiveBpm,
  formatRemaining,
  formatTimecode,
} from '../utils/djMath';
import { JogWheel } from './JogWheel';

interface DeckPanelProps {
  deck: DeckState;
  track: Track | null;
  waveform: WaveformBin[] | null;
  getPosition: () => number;
  onTogglePlay: () => void;
  onCue: () => void;
  onSync: () => void;
  onSeek: (timeSec: number) => void;
  onSeekDelta: (deltaSec: number) => void;
  onNudge: (factor: number) => void;
  onPitchChange: (pitchPercent: number) => void;
  onTogglePitchRange: () => void;
  onHotCueTrigger: (index: number) => void;
  onHotCueClear: (index: number) => void;
  onToggleLoop: (beats?: number) => void;
}

const LOOP_OPTIONS = [0.5, 1, 2, 4, 8];

export const DeckPanel: React.FC<DeckPanelProps> = ({
  deck,
  track,
  waveform,
  getPosition,
  onTogglePlay,
  onCue,
  onSync,
  onSeek,
  onSeekDelta,
  onNudge,
  onPitchChange,
  onTogglePitchRange,
  onHotCueTrigger,
  onHotCueClear,
  onToggleLoop,
}) => {
  const isDeckA = deck.id === 'A';
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const remainingRef = useRef<HTMLSpanElement | null>(null);
  const playheadBarRef = useRef<HTMLDivElement | null>(null);

  const effectiveBpm = track ? calculateEffectiveBpm(track.bpm, deck.pitchPercent) : 0;

  const getPosRef = useRef(getPosition);
  const durationRef = useRef(deck.duration);
  getPosRef.current = getPosition;
  durationRef.current = deck.duration;

  // Render static overview waveform whenever track waveform changes
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 34;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0D1016';
    ctx.fillRect(0, 0, w, h);

    if (!waveform || waveform.length === 0) return;

    const step = w / waveform.length;
    const midY = h / 2;
    ctx.fillStyle = isDeckA ? 'rgba(56, 189, 248, 0.72)' : 'rgba(245, 158, 11, 0.72)';

    for (let i = 0; i < waveform.length; i += 2) {
      const bin = waveform[i];
      const barH = Math.max(2, bin.peak * (h * 0.44));
      ctx.fillRect(i * step, midY - barH, Math.max(1, step * 1.4), barH * 2);
    }
  }, [waveform, isDeckA]);

  // Update playhead bar and timecodes smoothly via RAF
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const pos = getPosRef.current();
      const dur = durationRef.current || 1;
      if (elapsedRef.current) {
        elapsedRef.current.textContent = formatTimecode(pos);
      }
      if (remainingRef.current) {
        remainingRef.current.textContent = formatRemaining(pos, dur);
      }
      if (playheadBarRef.current) {
        const pct = Math.min(100, Math.max(0, (pos / dur) * 100));
        playheadBarRef.current.style.transform = `translateX(${pct}%)`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleOverviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!deck.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * deck.duration);
  };

  const accentText = isDeckA ? 'text-sky-400' : 'text-amber-400';
  const accentBgActive = isDeckA
    ? 'bg-sky-500 text-slate-950 border-sky-400'
    : 'bg-amber-500 text-slate-950 border-amber-400';
  const accentSoftActive = isDeckA
    ? 'bg-sky-500/20 text-sky-200 border-sky-400/60'
    : 'bg-amber-500/20 text-amber-200 border-amber-400/60';

  return (
    <section
      aria-label={`Deck ${deck.id}`}
      data-testid={`deck-${deck.id}`}
      data-playing={deck.isPlaying ? 'true' : 'false'}
      className="flex flex-col justify-between gap-3.5 rounded-lg border border-white/[0.08] bg-[#13171F] p-4"
    >
      {/* Track Info Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className={`font-mono font-semibold ${accentText}`}>DECK {deck.id}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{track ? track.genre : 'Empty Deck'}</span>
            {track && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300">{track.musicalKey}</span>
              </>
            )}
          </div>
          <h2 className="mt-1 truncate font-display text-lg font-semibold text-white">
            {track ? track.title : 'Load a track from Library'}
          </h2>
          <p className="truncate text-xs text-slate-400">
            {track ? track.artist : 'Click Load A or Load B on any track below'}
          </p>
        </div>

        {/* BPM & Timecode Block */}
        <div className="shrink-0 text-right">
          <div className="font-mono text-xl font-bold text-white tabular-nums leading-none">
            {effectiveBpm > 0 ? effectiveBpm.toFixed(1) : '--.-'}
            <span className="ml-1 text-[11px] font-medium text-slate-400">BPM</span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-2 font-mono text-[11px] tabular-nums">
            <span ref={elapsedRef} className="text-slate-200">
              0:00.0
            </span>
            <span className="text-slate-600">/</span>
            <span ref={remainingRef} className="text-slate-400">
              -0:00.0
            </span>
          </div>
        </div>
      </div>

      {/* Full-Track Overview Scrubber */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Deck ${deck.id} track position overview`}
        aria-valuemin={0}
        aria-valuemax={Math.round(deck.duration)}
        aria-valuenow={Math.round(deck.currentTime)}
        onClick={handleOverviewClick}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeekDelta(2);
          if (e.key === 'ArrowLeft') onSeekDelta(-2);
        }}
        className="relative h-9 w-full overflow-hidden rounded border border-white/[0.08] bg-[#0D1016] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <canvas ref={overviewCanvasRef} className="block h-full w-full pointer-events-none" />

        {/* Cue & Hot Cue markers on overview */}
        {deck.duration > 0 &&
          deck.hotCues.map((cue) =>
            cue.time !== null ? (
              <div
                key={cue.index}
                className="pointer-events-none absolute top-0 bottom-0 w-0.5"
                style={{
                  left: `${(cue.time / deck.duration) * 100}%`,
                  backgroundColor: isDeckA ? '#38BDF8' : '#F59E0B',
                }}
              />
            ) : null
          )}

        {/* Moving playhead line */}
        <div
          ref={playheadBarRef}
          className="pointer-events-none absolute inset-0 w-full will-change-transform"
          style={{ transform: 'translateX(0%)' }}
        >
          <div className="h-full w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
        </div>
      </div>

      {/* Platter + Tempo Pitch Strip */}
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex-1 flex justify-center">
          <JogWheel
            deckId={deck.id}
            isPlaying={deck.isPlaying}
            effectiveBpm={effectiveBpm}
            duration={deck.duration}
            getPosition={getPosition}
            onSeekDelta={onSeekDelta}
            onNudge={onNudge}
          />
        </div>

        {/* Pitch / Tempo Fader Column */}
        <div className="flex flex-col items-center gap-2 rounded-md border border-white/[0.06] bg-[#0E1118] px-2.5 py-2.5 w-[78px] shrink-0">
          <div className="flex items-center justify-between w-full">
            <span className="text-[10px] font-medium text-slate-400">Tempo</span>
            <button
              type="button"
              onClick={onTogglePitchRange}
              aria-label={`Deck ${deck.id} toggle pitch range`}
              className="font-mono text-[10px] text-slate-300 hover:text-white cursor-pointer"
            >
              ±{deck.pitchRange}%
            </button>
          </div>

          <div className="relative flex h-[112px] items-center justify-center">
            <input
              type="range"
              aria-label={`Deck ${deck.id} pitch tempo slider`}
              min={-deck.pitchRange}
              max={deck.pitchRange}
              step={0.1}
              value={deck.pitchPercent}
              onChange={(e) => onPitchChange(parseFloat(e.target.value))}
              className="dj-vertical-fader h-[108px] w-7"
            />
          </div>

          <div className="flex items-center gap-1 w-full justify-between">
            <button
              type="button"
              onMouseDown={() => onNudge(0.95)}
              onMouseUp={() => onNudge(1)}
              onMouseLeave={() => onNudge(1)}
              aria-label={`Deck ${deck.id} pitch bend down`}
              className="h-6 flex-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs font-mono text-slate-200 cursor-pointer"
            >
              -
            </button>
            <button
              type="button"
              onClick={() => onPitchChange(0)}
              aria-label={`Deck ${deck.id} reset pitch to zero`}
              title="Reset pitch to 0.0%"
              className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={() => onNudge(1.05)}
              onMouseUp={() => onNudge(1)}
              onMouseLeave={() => onNudge(1)}
              aria-label={`Deck ${deck.id} pitch bend up`}
              className="h-6 flex-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs font-mono text-slate-200 cursor-pointer"
            >
              +
            </button>
          </div>

          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
            {deck.pitchPercent > 0 ? '+' : ''}
            {deck.pitchPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Transport Controls: Play/Pause, Cue, Sync */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!track}
          aria-label={deck.isPlaying ? `Pause Deck ${deck.id}` : `Play Deck ${deck.id}`}
          className={`flex h-11 items-center justify-center gap-2 rounded-md border text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap ${
            deck.isPlaying
              ? accentBgActive
              : 'border-white/15 bg-[#1B202B] text-white hover:bg-[#242B3A]'
          }`}
        >
          {deck.isPlaying ? (
            <>
              <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>Playing</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>Play</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onCue}
          disabled={!track}
          aria-label={`Cue Deck ${deck.id}`}
          className="flex h-11 items-center justify-center rounded-md border border-white/15 bg-[#1B202B] text-xs font-semibold text-slate-100 hover:bg-[#242B3A] active:bg-white/20 transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap"
        >
          Cue
        </button>

        <button
          type="button"
          onClick={onSync}
          disabled={!track}
          aria-label={`Sync Deck ${deck.id} BPM`}
          aria-pressed={deck.syncLocked}
          className={`flex h-11 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap ${
            deck.syncLocked
              ? accentSoftActive
              : 'border-white/15 bg-[#1B202B] text-slate-200 hover:bg-[#242B3A]'
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sync</span>
        </button>
      </div>

      {/* Hot Cues (4 Pads) + Auto-Loop Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-white/[0.06]">
        {/* Hot Cues */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Hot Cues</span>
            <span className="text-[10px] text-slate-500">Shift-click clears</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {deck.hotCues.map((cue) => {
              const isSet = cue.time !== null;
              return (
                <button
                  key={cue.index}
                  type="button"
                  disabled={!track}
                  aria-label={`Deck ${deck.id} Hot Cue ${cue.index + 1}${
                    isSet ? ` at ${formatTimecode(cue.time!)}` : ' empty'
                  }`}
                  onClick={(e) => {
                    if (e.shiftKey && isSet) {
                      onHotCueClear(cue.index);
                    } else {
                      onHotCueTrigger(cue.index);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (isSet) onHotCueClear(cue.index);
                  }}
                  className={`flex h-10 flex-col items-center justify-center rounded border text-[11px] font-mono transition-all cursor-pointer disabled:opacity-40 ${
                    isSet
                      ? accentSoftActive
                      : 'border-white/10 bg-[#0E1118] text-slate-400 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  <span className="font-semibold leading-none">{cue.index + 1}</span>
                  <span className="mt-0.5 text-[9px] tabular-nums opacity-80 leading-none">
                    {isSet ? formatTimecode(cue.time!) : 'Set'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Auto-Loop */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Auto Loop</span>
            <button
              type="button"
              disabled={!track}
              onClick={() => onToggleLoop()}
              aria-label={`Toggle Deck ${deck.id} loop`}
              aria-pressed={deck.loopActive}
              className={`inline-flex items-center gap-1 text-[10px] font-medium cursor-pointer disabled:opacity-40 ${
                deck.loopActive ? accentText : 'text-slate-400 hover:text-white'
              }`}
            >
              <Repeat className="h-3 w-3" aria-hidden="true" />
              <span>{deck.loopActive ? 'Active' : 'Off'}</span>
            </button>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {LOOP_OPTIONS.map((beats) => {
              const selected = deck.loopActive && deck.loopBeats === beats;
              return (
                <button
                  key={beats}
                  type="button"
                  disabled={!track}
                  aria-label={`Deck ${deck.id} ${beats} beat loop`}
                  aria-pressed={selected}
                  onClick={() => onToggleLoop(beats)}
                  className={`h-10 rounded border font-mono text-[11px] font-medium transition-all cursor-pointer disabled:opacity-40 ${
                    selected
                      ? accentBgActive
                      : 'border-white/10 bg-[#0E1118] text-slate-300 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {beats === 0.5 ? '1/2' : beats}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
