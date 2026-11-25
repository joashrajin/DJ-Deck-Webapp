import React, { useEffect, useRef, useState } from 'react';
import type { DeckId } from '../types/dj';
import { formatTimecode } from '../utils/djMath';

const SLIPMAT_A = '/src/assets/images/slipmat_deck_a_1795607953746.jpg';
const SLIPMAT_B = '/src/assets/images/slipmat_deck_b_1795607950856.jpg';

interface JogWheelProps {
  deckId: DeckId;
  isPlaying: boolean;
  effectiveBpm: number;
  duration: number;
  getPosition: () => number;
  onSeekDelta: (deltaSec: number) => void;
  onNudge: (factor: number) => void;
}

export const JogWheel: React.FC<JogWheelProps> = ({
  deckId,
  isPlaying,
  effectiveBpm,
  duration,
  getPosition,
  onSeekDelta,
  onNudge,
}) => {
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const progressArcRef = useRef<SVGCircleElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);
  const [imgError, setImgError] = useState(false);
  const [isScratching, setIsScratching] = useState(false);

  const lastAngleRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const durationRef = useRef(duration);
  const getPosRef = useRef(getPosition);

  isPlayingRef.current = isPlaying;
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

  const computePointerAngle = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScratching(true);
    lastAngleRef.current = computePointerAngle(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScratching || lastAngleRef.current === null) return;
    const angle = computePointerAngle(e);
    let delta = angle - lastAngleRef.current;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    lastAngleRef.current = angle;

    if (isPlayingRef.current) {
      // Nudge tempo smoothly while playing
      const factor = 1 + Math.max(-0.18, Math.min(0.18, delta * 1.4));
      onNudge(factor);
    } else {
      // Scrub track position precisely when paused
      onSeekDelta(delta * 1.1);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isScratching) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsScratching(false);
      lastAngleRef.current = null;
      onNudge(1);
    }
  };

  return (
    <div className="relative flex items-center justify-center select-none">
      <div
        data-testid={`jogwheel-${deckId}`}
        role="group"
        aria-label={`Deck ${deckId} jog wheel platter — drag to nudge or scrub`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative h-[184px] w-[184px] xl:h-[214px] xl:w-[214px] rounded-full bg-[#0D1015] border border-white/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.85),0_8px_24px_rgba(0,0,0,0.65)] flex items-center justify-center touch-none ${
          isScratching ? 'cursor-grabbing ring-1 ring-white/25' : 'cursor-grab'
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

          {/* High-contrast white cue marker line on platter rim */}
          <div
            className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 h-5 w-1 rounded-full shadow-sm"
            style={{ backgroundColor: accentStroke }}
          />
        </div>

        {/* Fixed Center Studio Readout Hub */}
        <div className="pointer-events-none absolute flex h-[64px] w-[64px] flex-col items-center justify-center rounded-full bg-[#0B0D10]/92 border border-white/15 shadow-inner">
          <span className="font-mono text-xs font-semibold text-white tabular-nums leading-tight">
            {effectiveBpm > 0 ? effectiveBpm.toFixed(1) : '--.-'}
          </span>
          <span className="text-[9px] font-medium text-slate-400 leading-none mt-0.5">BPM</span>
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
