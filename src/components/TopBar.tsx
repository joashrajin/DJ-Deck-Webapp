import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileAudio, FolderOpen, HardDrive, Upload } from 'lucide-react';

interface TopBarProps {
  showSamplerFx: boolean;
  persistLocalTracks: boolean;
  onToggleSamplerFx: () => void;
  onScrollToConsole: () => void;
  onScrollToLibrary: () => void;
  onOpenShortcuts: () => void;
  onTriggerImport: () => void;
  onTriggerImportFolder: () => void;
  onTogglePersistLocalTracks: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  showSamplerFx,
  persistLocalTracks,
  onToggleSamplerFx,
  onScrollToConsole,
  onScrollToLibrary,
  onOpenShortcuts,
  onTriggerImport,
  onTriggerImportFolder,
  onTogglePersistLocalTracks,
}) => {
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const triggerBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!importMenuOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImportMenuOpen(false);
        triggerBtnRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [importMenuOpen]);

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

        {/* Zone 3: Single primary action with clear Files / Folder menu */}
        <div ref={menuContainerRef} className="relative flex items-center shrink-0">
          <button
            ref={triggerBtnRef}
            type="button"
            onClick={() => setImportMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={importMenuOpen}
            aria-controls="topbar-import-menu"
            data-testid="topbar-import-btn"
            title="Import audio files or an entire music folder from your device"
            className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-white active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Import Audio / Folder</span>
            <span className="sm:hidden">Import</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-600 transition-transform ${
                importMenuOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>

          {importMenuOpen && (
            <div
              id="topbar-import-menu"
              role="menu"
              aria-label="Import local audio options"
              data-testid="topbar-import-menu"
              className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-white/15 bg-[#13171F] p-1.5 shadow-2xl shadow-black/70 z-50"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="topbar-import-files-item"
                onClick={() => {
                  setImportMenuOpen(false);
                  onTriggerImport();
                }}
                className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-white/[0.08] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-[#0B0D10] text-slate-200">
                  <FileAudio className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">Import Audio Files</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
                    Choose one or more MP3, WAV, FLAC, M4A, or OGG tracks
                  </div>
                </div>
              </button>

              <button
                type="button"
                role="menuitem"
                data-testid="topbar-import-folder-item"
                onClick={() => {
                  setImportMenuOpen(false);
                  onTriggerImportFolder();
                }}
                className="mt-0.5 flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-sky-500/15 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-sky-400/35 bg-sky-500/10 text-sky-300">
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-sky-200">Import Entire Folder</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
                    Load every audio track from a folder &amp; subfolders at once
                  </div>
                </div>
              </button>

              <div className="my-1.5 border-t border-white/[0.08]" />

              <div className="flex items-center justify-between gap-2 rounded-md px-3 py-2 bg-[#0D1016]">
                <div className="flex items-center gap-2 min-w-0">
                  <HardDrive
                    className={`h-3.5 w-3.5 shrink-0 ${
                      persistLocalTracks ? 'text-sky-400' : 'text-slate-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-200">Remember on reload</div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {persistLocalTracks ? 'Saved locally in browser' : 'Clears when page reloads'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={persistLocalTracks}
                  aria-label="Remember imported tracks across reloads"
                  onClick={onTogglePersistLocalTracks}
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    persistLocalTracks ? 'bg-sky-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      persistLocalTracks ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <p className="px-3 pt-2 pb-1 text-[10px] leading-relaxed text-slate-500">
                100% local on your device. You can also drag files or folders straight onto Deck A, Deck B, or the Library.
              </p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
