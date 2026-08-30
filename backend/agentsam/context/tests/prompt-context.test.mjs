import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchActiveProjectContextBlocks } from '../prompt-context.js';

function explicitProjectEnv() {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        const q = String(sql).replace(/\s+/g, ' ').trim();
        calls.push(q);
        if (q.startsWith('PRAGMA table_info(agentsam_project_context)')) {
          return {
            async all() {
              return { results: [{ name: 'updated_at' }] };
            },
          };
        }
        return {
          bind(...args) {
            return {
              async all() {
                assert.equal(args[0], 'ws_alpha');
                assert.deepEqual(args.slice(1), ['proj_alpha', 'proj_alpha']);
                return {
                  results: [
                    {
                      id: 'ctx_alpha',
                      project_name: 'Alpha',
                      project_key: 'proj_alpha',
                      description: 'Explicit project context',
                      goals: null,
                      constraints: null,
                      current_blockers: null,
                      priority: 50,
                      status: 'active',
                    },
                  ],
                };
              },
            };
          },
        };
      },
    },
  };
  return { env, calls };
}

describe('backend/agentsam/context/prompt-context', () => {
  it('returns zero project context when only workspace scope is known', async () => {
    let prepared = 0;
    const env = {
      DB: {
        prepare() {
          prepared += 1;
          throw new Error('project context should not touch D1 without an explicit ref');
        },
      },
    };

    const blocks = await fetchActiveProjectContextBlocks(env, {
      workspaceId: 'ws_alpha',
    });

    assert.deepEqual(blocks, []);
    assert.equal(prepared, 0);
  });

  it('loads only the explicitly referenced project', async () => {
    const { env, calls } = explicitProjectEnv();
    const blocks = await fetchActiveProjectContextBlocks(env, {
      workspaceId: 'ws_alpha',
      projectRef: 'proj_alpha',
    });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].id, 'ctx_alpha');
    assert.match(blocks[0].text, /Explicit project context/);
    assert.equal(calls.some((q) => q.includes('project_key = ? OR id = ?')), true);
  });
});
