import React, { useEffect, useRef } from 'react';
import type { DeckId, DeckState, WaveformBin } from '../types/dj';

interface DualWaveformStripProps {
  deckA: DeckState;
  deckB: DeckState;
  trackABpm: number;
  trackBBpm: number;
  waveformA: WaveformBin[] | null;
  waveformB: WaveformBin[] | null;
  getPosition: (deckId: DeckId) => number;
  onSeek: (deckId: DeckId, timeSec: number) => void;
}

const WINDOW_SECONDS = 12; // Visible zoomed window around center playhead

export const DualWaveformStrip: React.FC<DualWaveformStripProps> = ({
  deckA,
  deckB,
  trackABpm,
  trackBBpm,
  waveformA,
  waveformB,
  getPosition,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({
    deckA,
    deckB,
    trackABpm,
    trackBBpm,
    waveformA,
    waveformB,
    getPosition,
  });
  propsRef.current = {
    deckA,
    deckB,
    trackABpm,
    trackBBpm,
    waveformA,
    waveformB,
    getPosition,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;

    const drawDeckLane = (
      laneY: number,
      laneH: number,
      deck: DeckState,
      bpm: number,
      bins: WaveformBin[] | null,
      pos: number,
      isDeckA: boolean
    ) => {
      const width = canvas.clientWidth;
      const centerX = width * 0.5;
      const centerY = laneY + laneH * 0.5;
      const dur = deck.duration || 1;
      const pxPerSec = width / WINDOW_SECONDS;

      // Subtle lane background
      ctx.fillStyle = isDeckA ? '#0D1117' : '#101218';
      ctx.fillRect(0, laneY, width, laneH);

      // Loop region highlight
      if (deck.loopActive && deck.loopEnd > deck.loopStart) {
        const x1 = centerX + (deck.loopStart - pos) * pxPerSec;
        const x2 = centerX + (deck.loopEnd - pos) * pxPerSec;
        ctx.fillStyle = isDeckA ? 'rgba(56, 189, 248, 0.16)' : 'rgba(245, 158, 11, 0.16)';
        ctx.fillRect(x1, laneY, x2 - x1, laneH);
        ctx.strokeStyle = isDeckA ? 'rgba(56, 189, 248, 0.65)' : 'rgba(245, 158, 11, 0.65)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, laneY + 0.5, x2 - x1, laneH - 1);
      }

      // Beatgrid vertical ticks
      if (bpm > 40) {
        const beatSec = 60 / bpm;
        const startSec = Math.max(0, pos - WINDOW_SECONDS * 0.55);
        const endSec = Math.min(dur, pos + WINDOW_SECONDS * 0.55);
        const firstBeat = Math.floor(startSec / beatSec);
        const lastBeat = Math.ceil(endSec / beatSec);

        for (let b = firstBeat; b <= lastBeat; b++) {
          const t = b * beatSec;
          const x = centerX + (t - pos) * pxPerSec;
          const isDownbeat = b % 4 === 0;
          ctx.fillStyle = isDownbeat ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
          ctx.fillRect(Math.round(x), laneY, 1, laneH);
        }
      }

      // Waveform bars
      if (bins && bins.length > 0 && dur > 0) {
        const barWidth = 2;
        const barStep = 3;
        const maxHalfH = laneH * 0.42;

        for (let x = 0; x < width; x += barStep) {
          const t = pos + (x - centerX) / pxPerSec;
          if (t < 0 || t > dur) continue;
          const binIdx = Math.min(bins.length - 1, Math.max(0, Math.floor((t / dur) * bins.length)));
          const bin = bins[binIdx];
          const h = Math.max(2, bin.peak * maxHalfH);
          const isPast = x < centerX;

          // Spectral tinting balanced with Deck A (cyan) vs Deck B (amber) identity
          if (isDeckA) {
            const alpha = isPast ? 0.42 : 0.92;
            const r = Math.round(35 + bin.high * 90);
            const g = Math.round(145 + bin.mid * 75);
            const b = Math.round(220 + bin.low * 35);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          } else {
            const alpha = isPast ? 0.42 : 0.92;
            const r = Math.round(230 + bin.low * 25);
            const g = Math.round(135 + bin.mid * 65);
            const b = Math.round(25 + bin.high * 75);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          }

          ctx.fillRect(x, centerY - h, barWidth, h * 2);
        }
      }

      // Hot cue markers
      for (const cue of deck.hotCues) {
        if (cue.time === null) continue;
        const x = centerX + (cue.time - pos) * pxPerSec;
        if (x < 0 || x > width) continue;
        ctx.fillStyle = isDeckA ? '#38BDF8' : '#F59E0B';
        ctx.fillRect(Math.round(x), laneY, 1.5, laneH);
        ctx.fillRect(Math.round(x), laneY, 14, 13);
        ctx.fillStyle = '#0B0D10';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillText(String(cue.index + 1), Math.round(x) + 4, laneY + 10);
      }

      // Lane label on left
      ctx.fillStyle = 'rgba(11, 13, 16, 0.78)';
      ctx.fillRect(8, laneY + 6, 48, 16);
      ctx.fillStyle = isDeckA ? '#38BDF8' : '#F59E0B';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(isDeckA ? 'DECK A' : 'DECK B', 14, laneY + 17);
    };

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.save();
      ctx.scale(dpr, dpr);

      const {
        deckA: a,
        deckB: b,
        trackABpm: bpmA,
        trackBBpm: bpmB,
        waveformA: wfA,
        waveformB: wfB,
        getPosition: getPos,
      } = propsRef.current;

      const halfH = Math.floor(h / 2);
      drawDeckLane(0, halfH - 1, a, bpmA, wfA, getPos('A'), true);
      drawDeckLane(halfH + 1, h - halfH - 1, b, bpmB, wfB, getPos('B'), false);

      // Center horizontal divider
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(0, halfH - 1, w, 2);

      // Master center playhead needle across both lanes
      const centerX = Math.round(w * 0.5);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(centerX - 1, 0, 2, h);

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const deckId: DeckId = relY < rect.height / 2 ? 'A' : 'B';
    const currentPos = getPosition(deckId);
    const pxPerSec = rect.width / WINDOW_SECONDS;
    const deltaSec = (relX - rect.width * 0.5) / pxPerSec;
    onSeek(deckId, Math.max(0, currentPos + deltaSec));
  };

  return (
    <div className="relative w-full rounded-lg border border-white/[0.08] bg-[#0D1016] overflow-hidden">
      <canvas
        ref={canvasRef}
        data-testid="dual-waveform-canvas"
        onClick={handleClick}
        aria-label="Parallel Deck A and Deck B scrolling waveforms — click to seek"
        className="block h-[112px] w-full cursor-crosshair"
      />
    </div>
  );
};
