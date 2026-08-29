/** Meshy balance fetch for Design Studio header pill. */

export type MeshyBalanceResponse = {
  balance?: number;
  stub?: boolean;
  key_source?: 'byok' | 'platform' | 'none';
  message?: string;
};

export async function fetchMeshyBalance(): Promise<MeshyBalanceResponse> {
  const res = await fetch('/api/cad/meshy/balance', { credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as MeshyBalanceResponse & { error?: string };
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data;
}
