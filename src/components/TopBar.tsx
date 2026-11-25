import React from 'react';
import { Upload } from 'lucide-react';

interface TopBarProps {
  showSamplerFx: boolean;
  onToggleSamplerFx: () => void;
  onScrollToConsole: () => void;
  onScrollToLibrary: () => void;
  onOpenShortcuts: () => void;
  onTriggerImport: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  showSamplerFx,
  onToggleSamplerFx,
  onScrollToConsole,
  onScrollToLibrary,
  onOpenShortcuts,
  onTriggerImport,
}) => {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-white/[0.08] bg-[#0B0D10]/95 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-8 px-4 sm:px-6">
        {/* Zone 1: Single-element brand wordmark */}
        <a
          href="#console"
          onClick={(e) => {
            e.preventDefault();
            onScrollToConsole();
          }}
          className="font-display text-2xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-sm"
        >
          dj
        </a>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400"
        >
          <button
            type="button"
            onClick={onScrollToConsole}
            className="whitespace-nowrap shrink-0 text-slate-200 hover:text-white transition-colors py-1 border-b border-transparent hover:border-slate-500 cursor-pointer"
          >
            Console
          </button>
          <button
            type="button"
            onClick={onToggleSamplerFx}
            aria-pressed={showSamplerFx}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 border-b cursor-pointer ${
              showSamplerFx
                ? 'text-sky-300 border-sky-400'
                : 'text-slate-400 border-transparent hover:text-white hover:border-slate-500'
            }`}
          >
            Sampler &amp; FX
          </button>
          <button
            type="button"
            onClick={onScrollToLibrary}
            className="whitespace-nowrap shrink-0 text-slate-400 hover:text-white transition-colors py-1 border-b border-transparent hover:border-slate-500 cursor-pointer"
          >
            Library
          </button>
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="whitespace-nowrap shrink-0 text-slate-400 hover:text-white transition-colors py-1 border-b border-transparent hover:border-slate-500 cursor-pointer"
          >
            Shortcuts
          </button>
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onTriggerImport}
            className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-white active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Import Audio</span>
          </button>
        </div>
      </div>
    </header>
  );
};
