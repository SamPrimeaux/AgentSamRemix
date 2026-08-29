import type { PlatformTicket } from '../../../client-api/tickets';
import type { ClientProjectRow } from '../../../pages/launch-desk/ops-desk-types';

export type ClientWorkNavItem = {
  client_id: string;
  client_name: string;
  project_id?: string | null;
};

const FEATURED_CLIENT_ORDER = [
  'client_companions_cpas',
  'client_fuelnfreetime',
  'client_meauxbility',
];

export function groupClientWorkNav(rows: ClientProjectRow[]): ClientWorkNavItem[] {
  const map = new Map<string, ClientWorkNavItem>();
  for (const row of rows) {
    const clientId = String(row.client_id || '').trim();
    if (!clientId) continue;
    if (map.has(clientId)) continue;
    map.set(clientId, {
      client_id: clientId,
      client_name:
        String(row.client_name || '').trim() ||
        String(row.project_name || '').trim() ||
        clientId.replace(/^client_/, '').replace(/_/g, ' '),
      project_id: row.project_id || null,
    });
  }
  const items = [...map.values()];
  items.sort((a, b) => {
    const ai = FEATURED_CLIENT_ORDER.indexOf(a.client_id);
    const bi = FEATURED_CLIENT_ORDER.indexOf(b.client_id);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.client_name.localeCompare(b.client_name);
  });
  return items;
}

export function clientWorkTaskCounts(tickets: PlatformTicket[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    if (ticket.status === 'shipped' || ticket.status === 'abandoned') continue;
    const clientId = String(ticket.client_id || '').trim();
    if (!clientId) continue;
    counts.set(clientId, (counts.get(clientId) || 0) + 1);
  }
  return counts;
}

export function clientDisplayName(
  clientId: string | null | undefined,
  clients: ClientWorkNavItem[],
): string {
  const id = String(clientId || '').trim();
  if (!id) return 'Client work';
  const row = clients.find((c) => c.client_id === id);
  return row?.client_name || id.replace(/^client_/, '').replace(/_/g, ' ');
}
