import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Deck A',
    items: [
      { keys: 'Space', desc: 'Play / Pause Deck A' },
      { keys: 'Q', desc: 'Cue Deck A' },
      { keys: 'S', desc: 'Sync Deck A to Deck B' },
      { keys: '1 – 4', desc: 'Trigger / Set Hot Cues 1–4' },
    ],
  },
  {
    title: 'Deck B',
    items: [
      { keys: 'Shift + Space', desc: 'Play / Pause Deck B' },
      { keys: 'P', desc: 'Cue Deck B' },
      { keys: 'K', desc: 'Sync Deck B to Deck A' },
      { keys: '7 – 0', desc: 'Trigger / Set Hot Cues 1–4' },
    ],
  },
  {
    title: 'Mixer & Sampler',
    items: [
      { keys: '← / →', desc: 'Nudge Crossfader toward Deck A / B' },
      { keys: 'C', desc: 'Center Crossfader' },
      { keys: 'F1 – F4', desc: 'Trigger Sampler Pads 1–4' },
      { keys: 'Esc', desc: 'Close modal dialogs' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-white/15 bg-[#13171F] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <h2 id="shortcuts-dialog-title" className="font-display text-base font-semibold text-white">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="rounded p-1 text-slate-400 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{group.title}</h3>
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li key={item.keys} className="flex flex-col gap-0.5 text-xs">
                    <kbd className="w-fit rounded border border-white/15 bg-[#0B0D10] px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                      {item.keys}
                    </kbd>
                    <span className="text-slate-400">{item.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
