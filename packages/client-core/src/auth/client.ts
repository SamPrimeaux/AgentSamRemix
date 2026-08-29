import type { SessionUser } from '../../../platform-contracts/src/index';
import { createApiClient, type ApiClientOptions } from '../api/fetch';

export function createAuthClient(options: ApiClientOptions = {}) {
  const api = createApiClient(options);
  return {
    async getSessionUser(): Promise<SessionUser> {
      const payload = await api.json<Record<string, unknown>>('/api/auth/me');
      const nested = payload.user ?? payload.me;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as SessionUser;
      }
      return payload as SessionUser;
    },
  };
}
