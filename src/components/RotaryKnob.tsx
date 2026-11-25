import React, { useRef, useState } from 'react';
import { clamp } from '../utils/djMath';

interface RotaryKnobProps {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  bipolar?: boolean;
  accent?: 'sky' | 'amber' | 'neutral';
  size?: 'sm' | 'md';
  disabled?: boolean;
  valueFormatter?: (v: number) => string;
  onChange: (next: number) => void;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  ariaLabel,
  value,
  min,
  max,
  defaultValue,
  step = 0.5,
  bipolar = false,
  accent = 'neutral',
  size = 'md',
  disabled = false,
  valueFormatter,
  onChange,
}) => {
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(value);

  const norm = clamp((value - min) / (max - min), 0, 1);
  // Sweep from -135deg to +135deg
  const angleDeg = -135 + norm * 270;

  const strokeColor =
    accent === 'sky' ? '#38BDF8' : accent === 'amber' ? '#F59E0B' : '#E2E8F0';

  const dim = size === 'sm' ? 40 : 48;
  const r = size === 'sm' ? 16 : 20;
  const cx = dim / 2;
  const cy = dim / 2;

  const polarToCartesian = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (startAngle: number, endAngle: number) => {
    const s = polarToCartesian(startAngle);
    const e = polarToCartesian(endAngle);
    const sweep = endAngle >= startAngle ? 1 : 0;
    const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
  };

  const defaultNorm = clamp((defaultValue - min) / (max - min), 0, 1);
  const zeroAngle = -135 + defaultNorm * 270;
  const arcStart = bipolar ? Math.min(zeroAngle, angleDeg) : -135;
  const arcEnd = bipolar ? Math.max(zeroAngle, angleDeg) : angleDeg;
  const showActiveArc = Math.abs(arcEnd - arcStart) > 2;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    const deltaY = startYRef.current - e.clientY;
    const range = max - min;
    const sensitivity = e.shiftKey ? 360 : 140;
    const raw = startValRef.current + (deltaY / sensitivity) * range;
    const snapped = Math.round(raw / step) * step;
    onChange(Number(clamp(snapped, min, max).toFixed(3)));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const delta = (max - min) * 0.04 * dir;
    onChange(Number(clamp(value + delta, min, max).toFixed(3)));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Number(clamp(value + step * 2, min, max).toFixed(3)));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Number(clamp(value - step * 2, min, max).toFixed(3)));
    } else if (e.key === 'Home' || e.key === '0') {
      e.preventDefault();
      onChange(defaultValue);
    }
  };

  const formattedValue = valueFormatter ? valueFormatter(value) : value.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={formattedValue}
        title={`${label}: ${formattedValue} (Drag up/down, double-click to reset)`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => !disabled && onChange(defaultValue)}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        className={`relative flex items-center justify-center rounded-full touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-ns-resize'
        }`}
        style={{ width: dim, height: dim }}
      >
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} aria-hidden="true">
          {/* Track background arc */}
          <path
            d={describeArc(-135, 135)}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          {/* Active value arc */}
          {showActiveArc && (
            <path
              d={describeArc(arcStart, arcEnd)}
              fill="none"
              stroke={strokeColor}
              strokeWidth={2.75}
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Machined rotary cap */}
        <div
          className="absolute rounded-full bg-gradient-to-b from-[#2A303D] to-[#141820] border border-white/15 shadow-[0_3px_8px_rgba(0,0,0,0.75)] flex items-start justify-center"
          style={{
            width: dim - 14,
            height: dim - 14,
            transform: `rotate(${angleDeg}deg)`,
          }}
        >
          <span
            className="mt-1 block h-2.5 w-0.5 rounded-full"
            style={{ backgroundColor: strokeColor }}
          />
        </div>
      </div>

      <span className="text-[11px] font-medium text-slate-400 leading-none">{label}</span>
      <span className="font-mono text-[10px] text-slate-500 tabular-nums leading-none">
        {formattedValue}
      </span>
    </div>
  );
};
