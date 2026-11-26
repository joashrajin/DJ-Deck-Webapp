import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Info,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Crate,
  DeckId,
  SortDirection,
  SortField,
  Track,
} from '../types/dj';
import { filterAndSortTracks, formatDuration } from '../utils/djMath';
import { extractFilesFromDataTransfer } from '../storage/folderDrop';

interface TrackLibraryProps {
  tracks: Track[];
  crates: Crate[];
  activeDeckATrackId: string | null;
  activeDeckBTrackId: string | null;
  recentlyImportedIds: string[];
  importVersion: number;
  isImporting: boolean;
  importProgress: { current: number; total: number } | null;
  importError: string | null;
  persistLocalTracks: boolean;
  savedLocalCount: number;
  isRestoringSaved: boolean;
  onTogglePersistLocalTracks: () => void;
  onClearSavedLocalTracks: () => void;
  onLoadDeck: (deckId: DeckId, trackId: string) => void;
  onToggleFavorite: (trackId: string) => void;
  onCreateCrate: (name: string) => void;
  onDeleteCrate: (crateId: string) => void;
  onToggleTrackCrate: (trackId: string, crateId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onImportFiles: (files: FileList | File[]) => void;
  onTriggerImport: () => void;
  onTriggerImportFolder: () => void;
}

export const TrackLibrary: React.FC<TrackLibraryProps> = ({
  tracks,
  crates,
  activeDeckATrackId,
  activeDeckBTrackId,
  recentlyImportedIds,
  importVersion,
  isImporting,
  importProgress,
  importError,
  persistLocalTracks,
  savedLocalCount,
  isRestoringSaved,
  onTogglePersistLocalTracks,
  onClearSavedLocalTracks,
  onLoadDeck,
  onToggleFavorite,
  onCreateCrate,
  onDeleteCrate,
  onToggleTrackCrate,
  onDeleteTrack,
  onImportFiles,
  onTriggerImport,
  onTriggerImportFolder,
}) => {
  const [selectedCrateId, setSelectedCrateId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [bpmFilter, setBpmFilter] = useState<'all' | 'under-124' | '124-132' | 'over-132'>('all');
  const [sortField, setSortField] = useState<SortField>('addedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Whenever new audio files are imported, clear restrictive filters and pin newest tracks to row #1
  useEffect(() => {
    if (importVersion === 0) return;
    setSearch('');
    setGenreFilter('all');
    setBpmFilter('all');
    setSortField('addedAt');
    setSortDirection('desc');
    setSelectedCrateId((current) => (current === 'imported' ? 'imported' : 'all'));
  }, [importVersion]);

  const [showNewCrateForm, setShowNewCrateForm] = useState(false);
  const [newCrateName, setNewCrateName] = useState('');
  const [crateError, setCrateError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const genres = useMemo(() => {
    const set = new Set<string>();
    tracks.forEach((t) => set.add(t.genre));
    return Array.from(set).sort();
  }, [tracks]);

  const userCrates = useMemo(() => crates.filter((c) => !c.isSystem), [crates]);
  const localTrackCount = useMemo(
    () => tracks.filter((t) => t.source === 'local').length,
    [tracks]
  );

  const visibleTracks = useMemo(
    () =>
      filterAndSortTracks(tracks, {
        search,
        crateId: selectedCrateId,
        genre: genreFilter,
        bpmFilter,
        sortField,
        sortDirection,
      }),
    [tracks, search, selectedCrateId, genreFilter, bpmFilter, sortField, sortDirection]
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'addedAt' ? 'desc' : 'asc');
    }
  };

  const handleCreateCrateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCrateName.trim();
    if (!trimmed) {
      setCrateError('Enter a crate name');
      return;
    }
    if (crates.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setCrateError('Crate already exists');
      return;
    }
    onCreateCrate(trimmed);
    setNewCrateName('');
    setCrateError(null);
    setShowNewCrateForm(false);
  };

  const handleClearFilters = () => {
    setSearch('');
    setGenreFilter('all');
    setBpmFilter('all');
    setSelectedCrateId('all');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    void extractFilesFromDataTransfer(e.dataTransfer).then((files) => {
      if (files.length > 0) {
        onImportFiles(files);
      }
    });
  };

  const countTracksInCrate = (crateId: string) => {
    if (crateId === 'all') return tracks.length;
    if (crateId === 'imported') return tracks.filter((t) => t.source === 'local').length;
    if (crateId === 'favorites') return tracks.filter((t) => t.favorite).length;
    return tracks.filter((t) => t.crateIds.includes(crateId)).length;
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="inline h-3 w-3 ml-1" aria-hidden="true" />
    ) : (
      <ArrowDown className="inline h-3 w-3 ml-1" aria-hidden="true" />
    );
  };

  return (
    <section
      id="library"
      aria-label="Track Library and Crate Manager"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`rounded-lg border bg-[#13171F] overflow-hidden transition-colors ${
        isDragOver ? 'border-sky-400 bg-sky-500/5' : 'border-white/[0.08]'
      }`}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Left Sidebar: Crates & Playlists */}
        <aside className="lg:col-span-3 xl:col-span-2 border-b lg:border-b-0 lg:border-r border-white/[0.08] bg-[#0F131A] p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-white">Crates</h2>
            <button
              type="button"
              onClick={() => {
                setShowNewCrateForm((v) => !v);
                setCrateError(null);
              }}
              aria-label="Create new crate"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New</span>
            </button>
          </div>

          {showNewCrateForm && (
            <form onSubmit={handleCreateCrateSubmit} className="mb-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newCrateName}
                  onChange={(e) => {
                    setNewCrateName(e.target.value);
                    setCrateError(null);
                  }}
                  placeholder="Crate name..."
                  aria-label="New crate name"
                  className="w-full rounded border border-white/15 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-white cursor-pointer shrink-0"
                >
                  Add
                </button>
              </div>
              {crateError && <p className="text-[11px] text-red-400">{crateError}</p>}
            </form>
          )}

          <ul className="space-y-1" role="list">
            {crates.map((crate) => {
              const selected = selectedCrateId === crate.id;
              const count = countTracksInCrate(crate.id);
              return (
                <li key={crate.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCrateId(crate.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`flex flex-1 items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white/[0.1] text-white'
                        : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {crate.id === 'favorites' ? (
                        <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                      ) : crate.id === 'imported' ? (
                        <Upload className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{crate.name}</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums ml-2">
                      {count}
                    </span>
                  </button>

                  {!crate.isSystem && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedCrateId === crate.id) setSelectedCrateId('all');
                        onDeleteCrate(crate.id);
                      }}
                      aria-label={`Delete crate ${crate.name}`}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 text-slate-500 hover:text-red-400 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 pt-3 border-t border-white/[0.06] space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onTriggerImport}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/15 bg-[#161B24] px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-[#1E2532] hover:text-white transition-colors cursor-pointer"
              >
                <Upload className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Files</span>
              </button>
              <button
                type="button"
                onClick={onTriggerImportFolder}
                data-testid="import-folder-btn"
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-sky-400/35 bg-sky-500/10 px-2 py-1.5 text-[11px] font-medium text-sky-200 hover:bg-sky-500/20 hover:text-white transition-colors cursor-pointer"
              >
                <FolderInput className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Folder</span>
              </button>
            </div>

            <div className="rounded-md border border-white/[0.08] bg-[#0B0D10] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
                  <HardDrive className="h-3 w-3 text-slate-400 shrink-0" aria-hidden="true" />
                  <span>Remember on reload</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={persistLocalTracks}
                  data-testid="persist-local-toggle"
                  onClick={onTogglePersistLocalTracks}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                    persistLocalTracks
                      ? 'border-sky-400 bg-sky-500'
                      : 'border-white/15 bg-[#1B202B]'
                  }`}
                >
                  <span className="sr-only">Remember imported tracks across reloads</span>
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      persistLocalTracks ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">
                {persistLocalTracks
                  ? 'On · Imported songs save locally in your browser (IndexedDB) and never leave your device.'
                  : 'Off · Imported songs stay in memory for this session only and clear on reload.'}
              </p>
              {savedLocalCount > 0 && (
                <button
                  type="button"
                  onClick={onClearSavedLocalTracks}
                  data-testid="clear-saved-local-btn"
                  className="w-full rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-slate-300 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 transition-colors cursor-pointer"
                >
                  Clear saved storage ({savedLocalCount})
                </button>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Drop audio files or whole folders onto Deck A/B to load immediately, or anywhere here to add to your library.
            </p>
          </div>
        </aside>

        {/* Right Main Library Table */}
        <div className="lg:col-span-9 xl:col-span-10 flex flex-col">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, artist, genre, key, BPM..."
                aria-label="Search track library"
                className="w-full rounded-md border border-white/10 bg-[#0B0D10] py-1.5 pl-8 pr-8 text-xs text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by genre"
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="rounded-md border border-white/10 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-400 focus:outline-none cursor-pointer"
              >
                <option value="all">All Genres</option>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by BPM range"
                value={bpmFilter}
                onChange={(e) =>
                  setBpmFilter(e.target.value as 'all' | 'under-124' | '124-132' | 'over-132')
                }
                className="rounded-md border border-white/10 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-400 focus:outline-none cursor-pointer"
              >
                <option value="all">All BPM</option>
                <option value="under-124">Under 124 BPM</option>
                <option value="124-132">124 – 132 BPM</option>
                <option value="over-132">Over 132 BPM</option>
              </select>

              <button
                type="button"
                onClick={() => handleSort('addedAt')}
                aria-pressed={sortField === 'addedAt'}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  sortField === 'addedAt'
                    ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                    : 'border-white/10 bg-[#0B0D10] text-slate-300 hover:border-white/25 hover:text-white'
                }`}
              >
                Recent{renderSortIcon('addedAt')}
              </button>

              <span className="font-mono text-xs text-slate-400 tabular-nums pl-1">
                {visibleTracks.length} {visibleTracks.length === 1 ? 'track' : 'tracks'}
              </span>
            </div>
          </div>

          {importError && (
            <div
              role="alert"
              className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200"
            >
              {importError}
            </div>
          )}

          {isImporting && (
            <div className="border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-200">
              {importProgress && importProgress.total > 1
                ? `Decoding local audio (${importProgress.current} of ${importProgress.total}) & analyzing BPM...`
                : 'Decoding local audio & analyzing BPM and waveform...'}
            </div>
          )}

          {isRestoringSaved && (
            <div className="border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-200">
              Restoring your saved local tracks from browser storage...
            </div>
          )}

          {!isRestoringSaved && (localTrackCount > 0 || selectedCrateId === 'imported') && (
            <div
              data-testid="session-storage-notice"
              className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-[11px] ${
                persistLocalTracks
                  ? 'border-sky-400/20 bg-sky-500/[0.07] text-sky-200'
                  : 'border-amber-400/20 bg-amber-500/[0.07] text-amber-200/95'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {persistLocalTracks ? (
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden="true" />
                ) : (
                  <Info className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                )}
                <span>
                  {persistLocalTracks
                    ? `Saved locally in this browser (${savedLocalCount} stored) — stays private on your device and reloads automatically.`
                    : 'Session-only audio: imported songs stay in local browser memory (never uploaded) and clear automatically on reload.'}
                </span>
              </span>

              <div className="flex items-center gap-2 shrink-0">
                {!persistLocalTracks ? (
                  <button
                    type="button"
                    onClick={onTogglePersistLocalTracks}
                    className="rounded border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/25 transition-colors cursor-pointer"
                  >
                    Remember on reload
                  </button>
                ) : (
                  savedLocalCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearSavedLocalTracks}
                      className="rounded border border-white/15 bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-slate-200 hover:border-red-400/40 hover:text-red-200 transition-colors cursor-pointer"
                    >
                      Clear saved
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* High-Density Sortable Data Grid */}
          <div className="overflow-x-auto">
            {visibleTracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <p className="text-sm font-medium text-slate-200">
                  {selectedCrateId === 'imported' && localTrackCount === 0
                    ? 'No imported songs yet'
                    : 'No matching tracks found'}
                </p>
                <p className="max-w-md text-xs text-slate-400">
                  {selectedCrateId === 'imported' && localTrackCount === 0
                    ? persistLocalTracks
                      ? 'Import individual MP3/WAV/OGG/FLAC files or an entire music folder. Tracks will be saved locally in this browser.'
                      : 'Import individual MP3/WAV/OGG/FLAC files or an entire music folder. Turn on “Remember on reload” to keep them saved locally in your browser.'
                    : 'Adjust your crate or search filters, or import local audio files from your device.'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                  {selectedCrateId !== 'imported' && (
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="rounded-md border border-white/15 bg-[#1B202B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#242B3A] cursor-pointer"
                    >
                      Clear filters
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onTriggerImport}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-white cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import Files</span>
                  </button>
                  <button
                    type="button"
                    onClick={onTriggerImportFolder}
                    className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 cursor-pointer"
                  >
                    <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import Folder</span>
                  </button>
                </div>
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-[#0F131A] text-[11px] font-medium text-slate-400">
                    <th className="w-9 py-2.5 pl-4 pr-1">
                      <span className="sr-only">Favorite</span>
                    </th>
                    <th className="py-2.5 px-2">
                      <button
                        type="button"
                        onClick={() => handleSort('title')}
                        className="hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Title / Artist{renderSortIcon('title')}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 hidden sm:table-cell">
                      <button
                        type="button"
                        onClick={() => handleSort('genre')}
                        className="hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Genre{renderSortIcon('genre')}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('bpm')}
                        className="hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        BPM{renderSortIcon('bpm')}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 text-center hidden md:table-cell">
                      <button
                        type="button"
                        onClick={() => handleSort('musicalKey')}
                        className="hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Key{renderSortIcon('musicalKey')}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 text-right hidden md:table-cell">
                      <button
                        type="button"
                        onClick={() => handleSort('duration')}
                        className="hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Time{renderSortIcon('duration')}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 hidden xl:table-cell">Crate</th>
                    <th className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">Load Deck</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {visibleTracks.map((track) => {
                    const isOnA = activeDeckATrackId === track.id;
                    const isOnB = activeDeckBTrackId === track.id;
                    const isRecent = recentlyImportedIds.includes(track.id);
                    return (
                      <tr
                        key={track.id}
                        data-track-id={track.id}
                        data-recent-import={isRecent ? 'true' : 'false'}
                        className={`transition-colors hover:bg-white/[0.03] ${
                          isRecent
                            ? 'bg-sky-500/[0.08]'
                            : isOnA || isOnB
                              ? 'bg-white/[0.025]'
                              : ''
                        }`}
                      >
                        <td
                          className={`py-2.5 pl-4 pr-1 ${
                            isRecent ? 'border-l-2 border-l-sky-400' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onToggleFavorite(track.id)}
                            aria-label={`${track.favorite ? 'Remove' : 'Add'} ${track.title} ${
                              track.favorite ? 'from' : 'to'
                            } favorites`}
                            aria-pressed={track.favorite}
                            className="p-1 text-slate-500 hover:text-amber-400 cursor-pointer"
                          >
                            <Star
                              className={`h-3.5 w-3.5 ${
                                track.favorite ? 'fill-amber-400 text-amber-400' : ''
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                        </td>

                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-100">
                                {track.title}
                              </div>
                              <div className="truncate text-[11px] text-slate-400">
                                {track.artist}
                                {isRecent ? (
                                  <span className="text-sky-300 font-medium">
                                    {' '}
                                    · Just imported ·{' '}
                                    {persistLocalTracks ? 'Saved in browser' : 'Clears on reload'}
                                  </span>
                                ) : track.source === 'local' ? (
                                  <span
                                    className={
                                      persistLocalTracks ? 'text-sky-300/90' : 'text-amber-300/90'
                                    }
                                  >
                                    {' '}
                                    ·{' '}
                                    {persistLocalTracks
                                      ? 'Saved in browser'
                                      : 'Session only (clears on reload)'}
                                  </span>
                                ) : (
                                  ''
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-slate-400 hidden sm:table-cell whitespace-nowrap">
                          {track.genre}
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono font-medium text-slate-200 tabular-nums whitespace-nowrap">
                          {track.bpm.toFixed(0)}
                        </td>

                        <td className="py-2.5 px-2 text-center font-mono text-slate-300 hidden md:table-cell whitespace-nowrap">
                          {track.musicalKey}
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono text-slate-400 tabular-nums hidden md:table-cell whitespace-nowrap">
                          {formatDuration(track.duration)}
                        </td>

                        <td className="py-2.5 px-2 hidden xl:table-cell">
                          <select
                            aria-label={`Assign ${track.title} to crate`}
                            value={track.crateIds[0] ?? ''}
                            onChange={(e) => {
                              if (e.target.value) {
                                onToggleTrackCrate(track.id, e.target.value);
                              }
                            }}
                            className="rounded border border-white/10 bg-[#0B0D10] px-2 py-1 text-[11px] text-slate-300 focus:border-sky-400 focus:outline-none cursor-pointer"
                          >
                            <option value="">Unassigned</option>
                            {userCrates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onLoadDeck('A', track.id)}
                              aria-label={`Load ${track.title} to Deck A`}
                              className={`rounded border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                                isOnA
                                  ? 'border-sky-400 bg-sky-500 text-slate-950'
                                  : 'border-sky-500/35 bg-sky-500/10 text-sky-300 hover:bg-sky-500/25'
                              }`}
                            >
                              {isOnA ? 'Deck A' : 'Load A'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onLoadDeck('B', track.id)}
                              aria-label={`Load ${track.title} to Deck B`}
                              className={`rounded border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                                isOnB
                                  ? 'border-amber-400 bg-amber-500 text-slate-950'
                                  : 'border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/25'
                              }`}
                            >
                              {isOnB ? 'Deck B' : 'Load B'}
                            </button>
                            {track.source === 'local' && (
                              <button
                                type="button"
                                onClick={() => onDeleteTrack(track.id)}
                                aria-label={`Delete imported track ${track.title}`}
                                className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
