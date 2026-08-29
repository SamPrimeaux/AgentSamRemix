import type { LibraryListResult, LibraryProvider, LibraryRail, LibrarySource, ListLibraryParams } from '../types';
import { artifactsProvider } from './artifactsProvider';
import { driveProvider } from './driveProvider';
import { localProvider } from './localProvider';
import { r2Provider } from './r2Provider';

export const LIBRARY_PROVIDERS: Record<LibrarySource, LibraryProvider> = {
  artifacts: artifactsProvider,
  drive: driveProvider,
  r2: r2Provider,
  local: localProvider,
};

const RAIL_SOURCES: Partial<Record<LibraryRail, LibrarySource[]>> = {
  all: ['artifacts', 'drive', 'r2', 'local'],
  artifacts: ['artifacts'],
  projects: [],
  tickets: [],
  drive: ['drive'],
  r2: ['r2'],
  local: ['local'],
  recent: ['artifacts', 'drive', 'r2', 'local'],
  starred: ['artifacts', 'drive', 'r2', 'local'],
  trash: ['artifacts', 'drive', 'r2', 'local'],
};

function filterByRail(items: LibraryListResult['items'], rail: LibraryRail) {
  if (rail === 'starred') return items.filter((i) => i.source === 'drive' || i.starred);
  if (rail === 'trash') return items.filter((i) => i.source === 'drive' || i.trashed);
  if (rail === 'recent') {
    return [...items].sort((a, b) => {
      const ta = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
      const tb = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
      return tb - ta;
    });
  }
  return items;
}

export async function listLibrarySources(params: ListLibraryParams): Promise<{
  items: LibraryListResult['items'];
  errors: string[];
  driveConnected?: boolean;
}> {
  const sources = RAIL_SOURCES[params.rail] ?? ['artifacts'];
  const results = await Promise.all(
    sources.map((source) => LIBRARY_PROVIDERS[source].list(params)),
  );

  const errors = results.map((r) => r.error).filter((e): e is string => !!e);
  let items = results.flatMap((r) => r.items);
  items = filterByRail(items, params.rail);

  const driveConnected = results.find((_, i) => sources[i] === 'drive')?.driveConnected;

  return { items, errors, driveConnected };
}

export { artifactsProvider, driveProvider, localProvider, r2Provider };
