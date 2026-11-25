import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { FxState, SamplerPadId } from '../types/dj';
import { SAMPLER_PADS } from '../data/seedLibrary';
import { RotaryKnob } from './RotaryKnob';

interface SamplerFxDrawerProps {
  fx: FxState;
  samplerVolume: number;
  onFxChange: (patch: Partial<FxState>) => void;
  onSamplerVolumeChange: (vol: number) => void;
  onTriggerPad: (padId: SamplerPadId) => void;
}

const BEAT_DIVISIONS = [
  { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5 },
  { label: '3/4', value: 0.75 },
  { label: '1/1', value: 1 },
];

export const SamplerFxDrawer: React.FC<SamplerFxDrawerProps> = ({
  fx,
  samplerVolume,
  onFxChange,
  onSamplerVolumeChange,
  onTriggerPad,
}) => {
  const [activePad, setActivePad] = useState<SamplerPadId | null>(null);

  const handlePadClick = (id: SamplerPadId) => {
    setActivePad(id);
    onTriggerPad(id);
    window.setTimeout(() => {
      setActivePad((curr) => (curr === id ? null : curr));
    }, 240);
  };

  return (
    <section
      aria-label="Sampler and Echo Effects Rack"
      className="grid grid-cols-1 lg:grid-cols-12 gap-4 rounded-lg border border-white/[0.08] bg-[#13171F] p-4"
    >
      {/* Beat-Synced Echo FX Unit */}
      <div className="lg:col-span-6 flex flex-col justify-between gap-3 border-b lg:border-b-0 lg:border-r border-white/[0.06] pb-4 lg:pb-0 lg:pr-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">Beat-Synced Echo</h3>
            <p className="text-xs text-slate-400">Tempo-locked feedback delay bus</p>
          </div>

          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Echo routing target"
              className="flex items-center rounded bg-[#0D1016] p-0.5 border border-white/[0.06]"
            >
              {(['A', 'B', 'MASTER'] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => onFxChange({ echoTarget: target })}
                  aria-pressed={fx.echoTarget === target}
                  className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors cursor-pointer ${
                    fx.echoTarget === target
                      ? 'bg-slate-200 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {target === 'MASTER' ? 'Mst' : `Ch ${target}`}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onFxChange({ echoEnabled: !fx.echoEnabled })}
              aria-pressed={fx.echoEnabled}
              className={`rounded border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                fx.echoEnabled
                  ? 'border-sky-400 bg-sky-500 text-slate-950'
                  : 'border-white/15 bg-[#1B202B] text-slate-200 hover:bg-[#242B3A]'
              }`}
            >
              {fx.echoEnabled ? 'FX On' : 'FX Off'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <RotaryKnob
              label="Dry / Wet"
              ariaLabel="Echo dry wet mix"
              value={fx.echoWet}
              min={0}
              max={1}
              defaultValue={0.4}
              step={0.02}
              size="sm"
              accent="sky"
              valueFormatter={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onFxChange({ echoWet: v })}
            />
            <RotaryKnob
              label="Feedback"
              ariaLabel="Echo feedback amount"
              value={fx.echoFeedback}
              min={0}
              max={0.82}
              defaultValue={0.42}
              step={0.02}
              size="sm"
              accent="sky"
              valueFormatter={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onFxChange({ echoFeedback: v })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-slate-400">Beat Division</span>
            <div className="flex items-center gap-1.5">
              {BEAT_DIVISIONS.map((div) => (
                <button
                  key={div.label}
                  type="button"
                  onClick={() => onFxChange({ echoBeats: div.value })}
                  aria-pressed={fx.echoBeats === div.value}
                  className={`h-8 min-w-[42px] rounded border font-mono text-xs font-medium transition-colors cursor-pointer ${
                    fx.echoBeats === div.value
                      ? 'border-sky-400/70 bg-sky-500/20 text-sky-200'
                      : 'border-white/10 bg-[#0D1016] text-slate-300 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {div.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4-Pad Live Performance Sampler */}
      <div className="lg:col-span-6 flex flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">Performance Sampler</h3>
            <p className="text-xs text-slate-400">One-shot synthesized sound FX triggers</p>
          </div>

          <div className="flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <input
              type="range"
              aria-label="Sampler bank volume"
              min={0}
              max={1}
              step={0.02}
              value={samplerVolume}
              onChange={(e) => onSamplerVolumeChange(parseFloat(e.target.value))}
              className="w-24 accent-amber-400 cursor-pointer"
            />
            <span className="font-mono text-[11px] text-slate-400 tabular-nums w-8 text-right">
              {Math.round(samplerVolume * 100)}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SAMPLER_PADS.map((pad) => {
            const isActive = activePad === pad.id;
            return (
              <button
                key={pad.id}
                type="button"
                onClick={() => handlePadClick(pad.id)}
                className={`flex flex-col items-start justify-between rounded-md border p-2.5 text-left transition-all cursor-pointer min-h-[66px] ${
                  isActive
                    ? 'border-amber-400 bg-amber-500/25 text-white scale-[0.98]'
                    : 'border-white/10 bg-[#0D1016] text-slate-200 hover:border-white/25 hover:bg-[#161B26]'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-xs font-semibold">{pad.label}</span>
                  <span className="font-mono text-[10px] text-slate-500">{pad.shortcut}</span>
                </div>
                <span className="text-[11px] text-slate-400">{pad.subtitle}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
