import { fetchArtifacts } from '../../../../client-api/artifacts';
import { mapArtifactRecord, sortLibraryItems } from '../mappers';
import type { LibraryListResult, LibraryProvider } from '../types';

export const artifactsProvider: LibraryProvider = {
  source: 'artifacts',
  label: 'My artifacts',
  async list(params) {
    try {
      // User-scoped ARTIFACTS R2 lane (user/{au_*}/…) via /api/agent/artifacts — not workspace-wide.
      const data = await fetchArtifacts({
        limit: 200,
        offset: 0,
        q: params.query?.trim() || undefined,
        session_id: params.sessionId?.trim() || undefined,
        signal: params.signal,
      });
      if (!data.ok) {
        return { items: [], error: data.error || 'Artifacts request failed' };
      }
      const items = sortLibraryItems((data.artifacts || []).map(mapArtifactRecord));
      return { items };
    } catch (e) {
      return {
        items: [],
        error: e instanceof Error ? e.message : 'Artifacts load failed',
      };
    }
  },
};
