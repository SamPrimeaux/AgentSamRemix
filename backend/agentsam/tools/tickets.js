import { z } from 'zod';
import { tool } from 'ai';
import {
  addTicketNote,
  createTicket,
  getTicket,
  listTickets,
  setTicketStatus,
} from '../../tickets/repository.js';

const ticketStatus = z.enum(['backlog', 'active', 'blocked', 'in_review', 'shipped', 'abandoned']);

export function createAgentSamTicketTool(env, resolveActor) {
  return tool({
    description: 'Read and update the canonical Agent Sam engineering ticket spine in D1. Use one operation at a time. Create is idempotent when dedupKey is supplied; docPath should point at the prose SSOT when one exists.',
    inputSchema: z.object({
      operation: z.enum(['list', 'get', 'create', 'set_status', 'add_note']),
      ticketId: z.string().max(128).optional(),
      title: z.string().max(240).optional(),
      description: z.string().max(20_000).optional(),
      status: ticketStatus.optional(),
      statusReason: z.string().max(1000).optional(),
      project: z.string().max(120).optional(),
      subsystem: z.string().max(120).optional(),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      tags: z.array(z.string().max(80)).max(30).optional(),
      dedupKey: z.string().max(128).optional(),
      docPath: z.string().max(400).optional(),
      query: z.string().max(240).optional(),
      note: z.string().max(4000).optional(),
      commitSha: z.string().max(64).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: async (input) => {
      const actor = await resolveActor();
      switch (input.operation) {
        case 'list':
          return {
            ok: true,
            tickets: await listTickets(env, {
              status: input.status,
              project: input.project,
              subsystem: input.subsystem,
              q: input.query,
              limit: input.limit,
            }),
          };
        case 'get': {
          if (!input.ticketId) return { ok: false, error: 'ticket_id_required' };
          const ticket = await getTicket(env, input.ticketId);
          return ticket ? { ok: true, ticket } : { ok: false, error: 'ticket_not_found' };
        }
        case 'create':
          if (!input.title) return { ok: false, error: 'ticket_title_required' };
          return {
            ok: true,
            ticket: await createTicket(env, {
              title: input.title,
              description: input.description,
              status: input.status,
              status_reason: input.statusReason,
              project: input.project,
              subsystem: input.subsystem,
              priority: input.priority,
              tags: input.tags,
              dedup_key: input.dedupKey,
              doc_path: input.docPath,
            }, actor),
          };
        case 'set_status':
          if (!input.ticketId || !input.status) return { ok: false, error: 'ticket_id_and_status_required' };
          return {
            ok: true,
            ticket: await setTicketStatus(env, input.ticketId, input.status, input.statusReason, actor),
          };
        case 'add_note':
          if (!input.ticketId || !input.note) return { ok: false, error: 'ticket_id_and_note_required' };
          return addTicketNote(env, input.ticketId, input.note, input.commitSha, actor);
        default:
          return { ok: false, error: 'unsupported_ticket_operation' };
      }
    },
  });
}
