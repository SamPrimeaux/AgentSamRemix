import { createApiClient, type ApiClientOptions } from '../api/fetch';

export type TicketStatus = 'backlog' | 'active' | 'blocked' | 'in_review' | 'shipped' | 'abandoned';
export type TicketSurface = 'platform' | 'collaborate';
export type TicketSummary = {
  id: string;
  title: string;
  description?: string | null;
  status: TicketStatus;
  priority?: string | null;
  project?: string | null;
  surface?: TicketSurface;
  updated_at?: number | null;
  due_at?: number | null;
};

export function createWorkClient(options: ApiClientOptions = {}) {
  const api = createApiClient(options);
  return {
    async listTickets(input: { surface?: TicketSurface; limit?: number } = {}): Promise<TicketSummary[]> {
      const query = new URLSearchParams();
      if (input.surface) query.set('surface', input.surface);
      query.set('limit', String(input.limit || 30));
      const payload = await api.json<{ tickets?: TicketSummary[] }>(`/api/tickets?${query.toString()}`);
      return Array.isArray(payload.tickets) ? payload.tickets : [];
    },
  };
}
