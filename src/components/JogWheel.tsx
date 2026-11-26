import React, { useEffect, useRef, useState } from 'react';
import type { DeckId } from '../types/dj';
import { computeJogDragRadians, formatTimecode } from '../utils/djMath';

const SLIPMAT_A = '/src/assets/images/slipmat_deck_a_1795607953746.jpg';
const SLIPMAT_B = '/src/assets/images/slipmat_deck_b_1795607950856.jpg';

interface JogWheelProps {
  deckId: DeckId;
  isPlaying: boolean;
  vinylMode: boolean;
  effectiveBpm: number;
  duration: number;
  getPosition: () => number;
  onScratchStart: () => void;
  onScratchMove: (deltaRadians: number, deltaMs: number) => void;
  onScratchEnd: () => void;
  onSeekDelta: (deltaSec: number) => void;
  onNudge: (factor: number) => void;
}

export const JogWheel: React.FC<JogWheelProps> = ({
  deckId,
  isPlaying,
  vinylMode,
  effectiveBpm,
  duration,
  getPosition,
  onScratchStart,
  onScratchMove,
  onScratchEnd,
  onSeekDelta,
  onNudge,
}) => {
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const progressArcRef = useRef<SVGCircleElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);
  const [imgError, setImgError] = useState(false);
  const [isGrabbed, setIsGrabbed] = useState(false);

  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastMoveTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  const vinylModeRef = useRef(vinylMode);
  const durationRef = useRef(duration);
  const getPosRef = useRef(getPosition);

  isPlayingRef.current = isPlaying;
  vinylModeRef.current = vinylMode;
  durationRef.current = duration;
  getPosRef.current = getPosition;

  const isDeckA = deckId === 'A';
  const accentStroke = isDeckA ? '#38BDF8' : '#F59E0B';
  const slipmatUrl = isDeckA ? SLIPMAT_A : SLIPMAT_B;

  const radius = 84;
  const circumference = 2 * Math.PI * radius;

  // Smooth 60Hz direct DOM rotation without React state thrashing
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const pos = getPosRef.current();
      const dur = durationRef.current || 1;
      // 33.3 RPM = 200 degrees per second
      const degrees = (pos * 200) % 360;

      if (rotorRef.current) {
        rotorRef.current.style.transform = `rotate(${degrees.toFixed(2)}deg)`;
      }
      if (progressArcRef.current) {
        const ratio = Math.min(1, Math.max(0, pos / dur));
        progressArcRef.current.style.strokeDashoffset = `${circumference * (1 - ratio)}`;
      }
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatTimecode(pos);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [circumference]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsGrabbed(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    lastMoveTimeRef.current = performance.now();

    if (vinylModeRef.current) {
      onScratchStart();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isGrabbed || lastPointerRef.current === null) return;
    const now = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    if (dx === 0 && dy === 0) return;

    // Midpoint relative to platter center for accurate tangential torque
    const rx = (e.clientX + lastPointerRef.current.x) * 0.5 - cx;
    const ry = (e.clientY + lastPointerRef.current.y) * 0.5 - cy;
    const delta = computeJogDragRadians(rx, ry, dx, dy);

    const dtMs = Math.max(4, now - lastMoveTimeRef.current);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    lastMoveTimeRef.current = now;

    if (vinylModeRef.current) {
      onScratchMove(delta, dtMs);
      return;
    }

    if (isPlayingRef.current) {
      // Nudge tempo smoothly while playing in Nudge mode
      const factor = 1 + Math.max(-0.18, Math.min(0.18, delta * 1.4));
      onNudge(factor);
    } else {
      onSeekDelta(delta * 1.1);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isGrabbed) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsGrabbed(false);
    lastPointerRef.current = null;

    if (vinylModeRef.current) {
      onScratchEnd();
    } else {
      onNudge(1);
    }
  };

  return (
    <div className="relative flex items-center justify-center select-none">
      <div
        data-testid={`jogwheel-${deckId}`}
        data-scratching={isGrabbed && vinylMode ? 'true' : 'false'}
        role="group"
        aria-label={`Deck ${deckId} vinyl jog wheel — drag circularly to ${
          vinylMode ? 'scratch' : 'nudge tempo'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative h-[184px] w-[184px] xl:h-[214px] xl:w-[214px] rounded-full bg-[#0D1015] border transition-shadow shadow-[inset_0_2px_10px_rgba(0,0,0,0.85),0_8px_24px_rgba(0,0,0,0.65)] flex items-center justify-center touch-none ${
          isGrabbed
            ? isDeckA
              ? 'cursor-grabbing border-sky-400/70 ring-2 ring-sky-400/30'
              : 'cursor-grabbing border-amber-400/70 ring-2 ring-amber-400/30'
            : 'cursor-grab border-white/10'
        }`}
      >
        {/* Outer SVG progress ring */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
          viewBox="0 0 180 180"
          aria-hidden="true"
        >
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="3.5"
          />
          <circle
            ref={progressArcRef}
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={accentStroke}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
          />
        </svg>

        {/* Rotating Platter */}
        <div
          ref={rotorRef}
          className="relative h-[160px] w-[160px] xl:h-[188px] xl:w-[188px] rounded-full overflow-hidden border border-white/15 bg-[#12151C] will-change-transform"
        >
          {!imgError ? (
            <img
              src={slipmatUrl}
              alt={`Deck ${deckId} vinyl platter`}
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover opacity-90 pointer-events-none"
            />
          ) : (
            <div
              className="h-full w-full rounded-full"
              style={{
                background: `repeating-radial-gradient(circle at center, #181C24 0px, #181C24 3px, #11141B 4px, #11141B 6px)`,
              }}
            />
          )}

          {/* High-contrast cue marker line on platter rim */}
          <div
            className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 h-5 w-1 rounded-full shadow-sm"
            style={{ backgroundColor: accentStroke }}
          />
        </div>

        {/* Fixed Center Studio Readout Hub */}
        <div className="pointer-events-none absolute flex h-[66px] w-[66px] flex-col items-center justify-center rounded-full bg-[#0B0D10]/94 border border-white/15 shadow-inner">
          {isGrabbed && vinylMode ? (
            <span
              className={`font-mono text-[10px] font-bold tracking-wider ${
                isDeckA ? 'text-sky-300' : 'text-amber-300'
              }`}
            >
              SCRATCH
            </span>
          ) : (
            <>
              <span className="font-mono text-xs font-semibold text-white tabular-nums leading-tight">
                {effectiveBpm > 0 ? effectiveBpm.toFixed(1) : '--.-'}
              </span>
              <span className="text-[9px] font-medium text-slate-400 leading-none mt-0.5">
                BPM
              </span>
            </>
          )}
          <span
            ref={timeTextRef}
            className="font-mono text-[10px] text-slate-300 tabular-nums mt-1 leading-none"
          >
            0:00.0
          </span>
        </div>
      </div>
    </div>
  );
};
