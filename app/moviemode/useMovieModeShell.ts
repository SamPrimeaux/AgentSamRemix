import { useCallback, useSyncExternalStore } from 'react';

export type MovieModeBinTab =
  | 'media'
  | 'audio'
  | 'text'
  | 'transitions'
  | 'effects'
  | 'stickers'
  | 'templates';

export type MovieModeMediaSource = 'library' | 'stream' | 'uploads';

type ShellState = {
  binTab: MovieModeBinTab;
  mediaSource: MovieModeMediaSource;
  searchQuery: string;
};

let state: ShellState = {
  binTab: 'media',
  mediaSource: 'library',
  searchQuery: '',
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getMovieModeShellState(): ShellState {
  return state;
}

export function setMovieModeBinTab(tab: MovieModeBinTab) {
  state = { ...state, binTab: tab };
  emit();
}

export function setMovieModeMediaSource(source: MovieModeMediaSource) {
  state = { ...state, mediaSource: source };
  emit();
}

export function setMovieModeMediaSearch(query: string) {
  state = { ...state, searchQuery: query };
  emit();
}

export function useMovieModeShell() {
  const snap = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => state,
    () => state,
  );

  const setBinTab = useCallback((tab: MovieModeBinTab) => setMovieModeBinTab(tab), []);
  const setMediaSource = useCallback((source: MovieModeMediaSource) => setMovieModeMediaSource(source), []);
  const setSearchQuery = useCallback((q: string) => setMovieModeMediaSearch(q), []);

  return { ...snap, setBinTab, setMediaSource, setSearchQuery };
}
