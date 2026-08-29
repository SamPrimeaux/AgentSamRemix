import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveConversationProjectRef } from '../project-bind.js';

/**
 * @param {Record<string, unknown>|null} sessionRow
 * @param {Record<string, { id: string }>|null} [projectsById]
 */
function envWithSession(sessionRow, projectsById = null) {
  return {
    DB: {
      prepare(sql) {
        const q = String(sql).replace(/\s+/g, ' ').trim();
        return {
          bind(...args) {
            return {
              async first() {
                if (q.includes('FROM agentsam_chat_sessions')) {
                  return sessionRow;
                }
                if (q.includes('FROM projects WHERE id = ?')) {
                  const ref = String(args[0] || '');
                  if (projectsById?.[ref]) return projectsById[ref];
                  if (sessionRow?.project_id === ref) return { id: ref };
                  return null;
                }
                return null;
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
}

const base = {
  conversationId: 'conv_1',
  userId: 'user_1',
  tenantId: 'tenant_1',
};

describe('backend/agentsam/sessions/project-bind', () => {
  it('existing conversation project overrides ambient request project', async () => {
    const out = await resolveConversationProjectRef(
      envWithSession({ project_id: 'proj_a' }, { proj_a: { id: 'proj_a' } }),
      { ...base, requestedProjectRef: 'proj_stale' },
    );
    assert.equal(out.projectRef, 'proj_a');
    assert.equal(out.source, 'conversation');
  });

  it('unbound existing conversation stays unbound without explicit request', async () => {
    const out = await resolveConversationProjectRef(envWithSession({ project_id: null }), {
      ...base,
      requestedProjectRef: 'proj_companions_cpas_web',
    });
    assert.equal(out.projectRef, null);
    assert.equal(out.source, 'conversation_unbound');
  });

  it('explicit selection can replace existing conversation project', async () => {
    const out = await resolveConversationProjectRef(
      envWithSession({ project_id: 'proj_a' }, { proj_b: { id: 'proj_b' } }),
      { ...base, requestedProjectRef: 'proj_b', explicit: true },
    );
    assert.equal(out.projectRef, 'proj_b');
    assert.equal(out.source, 'explicit_request');
  });

  it('explicit clear removes existing conversation project', async () => {
    const out = await resolveConversationProjectRef(
      envWithSession({ project_id: 'proj_a' }, { proj_a: { id: 'proj_a' } }),
      { ...base, requestedProjectRef: 'proj_a', explicit: true, clear: true },
    );
    assert.equal(out.projectRef, null);
    assert.equal(out.source, 'explicit_clear');
  });

  it('new conversation binds only on explicit project set', async () => {
    const out = await resolveConversationProjectRef(envWithSession(null), {
      ...base,
      requestedProjectRef: 'proj_companions_cpas_web',
    });
    assert.equal(out.projectRef, null);
    assert.equal(out.source, 'unbound');
    assert.equal(out.conversationFound, false);
  });

  it('preserves sticky project when projects lookup throws', async () => {
    let cleared = false;
    const env = {
      DB: {
        prepare(sql) {
          const q = String(sql).replace(/\s+/g, ' ').trim();
          return {
            bind() {
              return {
                async first() {
                  if (q.includes('FROM agentsam_chat_sessions')) {
                    return { project_id: 'proj_sticky' };
                  }
                  if (q.includes('FROM projects WHERE id = ?')) {
                    throw new Error('d1_overload');
                  }
                  return null;
                },
                async run() {
                  if (q.includes('SET project_id = NULL')) cleared = true;
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    };
    const out = await resolveConversationProjectRef(env, {
      ...base,
      requestedProjectRef: 'proj_other',
    });
    assert.equal(out.projectRef, 'proj_sticky');
    assert.equal(out.source, 'conversation_lookup_failed');
    assert.equal(cleared, false);
  });
});
