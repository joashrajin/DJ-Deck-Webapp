import React, { useEffect, useRef } from 'react';
import { ArrowLeftRight, Circle, Download, Square } from 'lucide-react';
import type {
  CrossfaderCurve,
  DeckId,
  DeckState,
  EqState,
  MeterLevels,
  MixerState,
} from '../types/dj';
import { RotaryKnob } from './RotaryKnob';

interface CenterMixerProps {
  deckA: DeckState;
  deckB: DeckState;
  mixer: MixerState;
  isRecording: boolean;
  recordingUrl: string | null;
  getLevels: () => MeterLevels;
  onEqChange: (deckId: DeckId, patch: Partial<EqState>) => void;
  onFilterChange: (deckId: DeckId, value: number) => void;
  onDeckVolumeChange: (deckId: DeckId, value: number) => void;
  onCrossfaderChange: (value: number) => void;
  onCurveChange: (curve: CrossfaderCurve) => void;
  onMasterGainChange: (value: number) => void;
  onTriggerAutoMix: () => void;
  onToggleRecord: () => void;
}

const SEGMENTS = 12;

function formatDb(val: number): string {
  if (Math.abs(val) < 0.2) return '0 dB';
  return `${val > 0 ? '+' : ''}${val.toFixed(0)} dB`;
}

function formatFilter(val: number): string {
  if (Math.abs(val) < 0.03) return 'Flat';
  return val < 0 ? `LPF ${Math.round(Math.abs(val) * 100)}%` : `HPF ${Math.round(val * 100)}%`;
}

export const CenterMixer: React.FC<CenterMixerProps> = ({
  deckA,
  deckB,
  mixer,
  isRecording,
  recordingUrl,
  getLevels,
  onEqChange,
  onFilterChange,
  onDeckVolumeChange,
  onCrossfaderChange,
  onCurveChange,
  onMasterGainChange,
  onTriggerAutoMix,
  onToggleRecord,
}) => {
  const meterARef = useRef<HTMLDivElement | null>(null);
  const meterBRef = useRef<HTMLDivElement | null>(null);
  const meterMLRef = useRef<HTMLDivElement | null>(null);
  const meterMRRef = useRef<HTMLDivElement | null>(null);
  const getLevelsRef = useRef(getLevels);
  getLevelsRef.current = getLevels;

  // Update LED meter segments directly via RAF for smooth 60fps metering
  useEffect(() => {
    let rafId = 0;

    const paintBar = (container: HTMLDivElement | null, level: number) => {
      if (!container) return;
      const litCount = Math.round(level * SEGMENTS);
      const children = container.children;
      for (let i = 0; i < children.length; i++) {
        const seg = children[i] as HTMLElement;
        // Top-to-bottom DOM order: index 0 is peak (red), bottom is green
        const fromBottom = SEGMENTS - 1 - i;
        const isLit = fromBottom < litCount;
        seg.style.opacity = isLit ? '1' : '0.16';
      }
    };

    const tick = () => {
      const levels = getLevelsRef.current();
      paintBar(meterARef.current, levels.deckA);
      paintBar(meterBRef.current, levels.deckB);
      paintBar(meterMLRef.current, levels.masterL);
      paintBar(meterMRRef.current, levels.masterR);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const renderMeterColumn = (ref: React.RefObject<HTMLDivElement | null>, label: string) => (
    <div className="flex flex-col items-center gap-1" aria-hidden="true">
      <div ref={ref} className="flex flex-col gap-[3px] py-1">
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const fromBottom = SEGMENTS - 1 - i;
          const color =
            fromBottom >= 10
              ? 'bg-red-500'
              : fromBottom >= 7
                ? 'bg-amber-400'
                : 'bg-emerald-500';
          return (
            <span
              key={i}
              className={`block h-[6px] w-2 rounded-[1px] ${color}`}
              style={{ opacity: 0.16 }}
            />
          );
        })}
      </div>
      <span className="font-mono text-[9px] text-slate-500">{label}</span>
    </div>
  );

  const renderEqColumn = (deck: DeckState) => {
    const isA = deck.id === 'A';
    const accent = isA ? 'sky' : 'amber';
    const killActive = isA
      ? 'bg-sky-500/25 border-sky-400 text-sky-200'
      : 'bg-amber-500/25 border-amber-400 text-amber-200';

    const bands: Array<{
      label: string;
      key: 'high' | 'mid' | 'low';
      killKey: 'killHigh' | 'killMid' | 'killLow';
    }> = [
      { label: 'High', key: 'high', killKey: 'killHigh' },
      { label: 'Mid', key: 'mid', killKey: 'killMid' },
      { label: 'Low', key: 'low', killKey: 'killLow' },
    ];

    return (
      <div className="flex flex-col items-center gap-1.5">
        <span
          className={`font-mono text-[10px] font-semibold ${
            isA ? 'text-sky-400' : 'text-amber-400'
          }`}
        >
          CH {deck.id}
        </span>

        {bands.map((band) => {
          const killed = deck.eq[band.killKey];
          return (
            <div key={band.key} className="flex items-center gap-1.5">
              <RotaryKnob
                label={band.label}
                ariaLabel={`Deck ${deck.id} ${band.label} EQ`}
                value={deck.eq[band.key]}
                min={-24}
                max={12}
                defaultValue={0}
                step={0.5}
                bipolar
                size="sm"
                accent={accent}
                disabled={killed}
                valueFormatter={formatDb}
                onChange={(v) => onEqChange(deck.id, { [band.key]: v })}
              />
              <button
                type="button"
                aria-label={`Kill Deck ${deck.id} ${band.label} EQ`}
                aria-pressed={killed}
                title={`Kill ${band.label}`}
                onClick={() => onEqChange(deck.id, { [band.killKey]: !killed })}
                className={`h-6 w-6 rounded border font-mono text-[10px] font-bold transition-colors cursor-pointer ${
                  killed
                    ? killActive
                    : 'border-white/10 bg-[#0E1118] text-slate-400 hover:border-white/25 hover:text-white'
                }`}
              >
                K
              </button>
            </div>
          );
        })}

        {/* Color Filter Knob */}
        <div className="pt-1 border-t border-white/[0.06] w-full flex justify-center">
          <RotaryKnob
            label="Filter"
            ariaLabel={`Deck ${deck.id} color filter`}
            value={deck.filter}
            min={-1}
            max={1}
            defaultValue={0}
            step={0.02}
            bipolar
            size="sm"
            accent={accent}
            valueFormatter={formatFilter}
            onChange={(v) => onFilterChange(deck.id, v)}
          />
        </div>
      </div>
    );
  };

  return (
    <section
      aria-label="Center Studio Mixer"
      className="flex flex-col justify-between gap-2.5 rounded-lg border border-white/[0.08] bg-[#13171F] p-3.5"
    >
      {/* Top Row: Master Gain & Mix Recording */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5">
        <RotaryKnob
          label="Master"
          ariaLabel="Master output gain"
          value={mixer.masterGain}
          min={0}
          max={1.25}
          defaultValue={0.9}
          step={0.02}
          size="sm"
          accent="neutral"
          valueFormatter={(v) => `${Math.round(v * 100)}%`}
          onChange={onMasterGainChange}
        />

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleRecord}
              aria-label={isRecording ? 'Stop mix recording' : 'Record live mix'}
              aria-pressed={isRecording}
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isRecording
                  ? 'border-red-500/70 bg-red-500/20 text-red-200'
                  : 'border-white/15 bg-[#1B202B] text-slate-200 hover:bg-[#242B3A]'
              }`}
            >
              {isRecording ? (
                <>
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                  <span>Stop Rec</span>
                </>
              ) : (
                <>
                  <Circle className="h-3 w-3 fill-red-500 text-red-500" aria-hidden="true" />
                  <span>Rec Mix</span>
                </>
              )}
            </button>

            {recordingUrl && !isRecording && (
              <a
                href={recordingUrl}
                download="dj-live-mix.webm"
                aria-label="Download recorded mix"
                className="inline-flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 whitespace-nowrap"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>Save</span>
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={onTriggerAutoMix}
            aria-label="Auto-Mix crossfade transition"
            aria-pressed={mixer.autoMixActive}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
              mixer.autoMixActive
                ? 'border-sky-400/70 bg-sky-500/20 text-sky-200'
                : 'border-white/10 bg-[#0E1118] text-slate-300 hover:border-white/25 hover:text-white'
            }`}
          >
            <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
            <span>{mixer.autoMixActive ? 'Auto-Mixing...' : 'Auto-Mix 6s'}</span>
          </button>
        </div>
      </div>

      {/* Middle: Dual 3-Band EQ + Filter Columns */}
      <div className="grid grid-cols-2 gap-2 border-b border-white/[0.06] pb-2.5">
        {renderEqColumn(deckA)}
        {renderEqColumn(deckB)}
      </div>

      {/* Channel Volume Faders + Live Stereo VU Meters */}
      <div className="flex items-center justify-between gap-2 px-1">
        {/* Deck A Volume */}
        <div className="flex flex-col items-center gap-1">
          <input
            type="range"
            aria-label="Deck A channel volume"
            min={0}
            max={1}
            step={0.01}
            value={deckA.volume}
            onChange={(e) => onDeckVolumeChange('A', parseFloat(e.target.value))}
            className="dj-vertical-fader h-[88px] w-7"
          />
          <span className="font-mono text-[10px] text-sky-400 tabular-nums">
            {Math.round(deckA.volume * 100)}
          </span>
        </div>

        {/* Real-Time LED VU Meters */}
        <div className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-[#0B0D10] px-2.5 py-1">
          {renderMeterColumn(meterARef, 'A')}
          <div className="flex items-center gap-1 border-x border-white/[0.06] px-2">
            {renderMeterColumn(meterMLRef, 'L')}
            {renderMeterColumn(meterMRRef, 'R')}
          </div>
          {renderMeterColumn(meterBRef, 'B')}
        </div>

        {/* Deck B Volume */}
        <div className="flex flex-col items-center gap-1">
          <input
            type="range"
            aria-label="Deck B channel volume"
            min={0}
            max={1}
            step={0.01}
            value={deckB.volume}
            onChange={(e) => onDeckVolumeChange('B', parseFloat(e.target.value))}
            className="dj-vertical-fader h-[88px] w-7"
          />
          <span className="font-mono text-[10px] text-amber-400 tabular-nums">
            {Math.round(deckB.volume * 100)}
          </span>
        </div>
      </div>

      {/* Bottom: Master Crossfader & Curve Selector */}
      <div className="rounded-md border border-white/[0.06] bg-[#0D1016] px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-400">Crossfader</span>
          <div
            role="group"
            aria-label="Crossfader curve"
            className="flex items-center rounded bg-[#151A24] p-0.5"
          >
            {(['smooth', 'linear', 'scratch'] as CrossfaderCurve[]).map((curve) => (
              <button
                key={curve}
                type="button"
                onClick={() => onCurveChange(curve)}
                aria-pressed={mixer.crossfaderCurve === curve}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize transition-colors cursor-pointer ${
                  mixer.crossfaderCurve === curve
                    ? 'bg-slate-200 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {curve}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onCrossfaderChange(-1)}
            aria-label="Snap crossfader to Deck A"
            className="font-mono text-xs font-bold text-sky-400 hover:text-sky-300 cursor-pointer px-1"
          >
            A
          </button>

          <input
            type="range"
            aria-label="Master crossfader between Deck A and Deck B"
            min={-1}
            max={1}
            step={0.01}
            value={mixer.crossfader}
            onChange={(e) => onCrossfaderChange(parseFloat(e.target.value))}
            onDoubleClick={() => onCrossfaderChange(0)}
            className="dj-crossfader h-9 flex-1"
          />

          <button
            type="button"
            onClick={() => onCrossfaderChange(1)}
            aria-label="Snap crossfader to Deck B"
            className="font-mono text-xs font-bold text-amber-400 hover:text-amber-300 cursor-pointer px-1"
          >
            B
          </button>
        </div>

        <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-slate-500 tabular-nums">
          <span>{Math.round(((1 - mixer.crossfader) / 2) * 100)}% A</span>
          <button
            type="button"
            onClick={() => onCrossfaderChange(0)}
            className="hover:text-slate-200 cursor-pointer"
          >
            Center
          </button>
          <span>{Math.round(((1 + mixer.crossfader) / 2) * 100)}% B</span>
        </div>
      </div>
    </section>
  );
};
