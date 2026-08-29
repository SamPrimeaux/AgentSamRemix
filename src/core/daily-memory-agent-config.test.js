import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_MEMORY_AGENT_SLUG,
  DailyMemoryAgentConfigError,
  resolveDailyMemoryAgentConfig,
} from '../../backend/jobs/daily-memory-agent-config.js';

function mockEnv(profile) {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              first: async () => profile,
            };
          },
        };
      },
    },
  };
}

test('fails loud when the platform-global daily-memory profile is missing', async () => {
  await assert.rejects(
    () => resolveDailyMemoryAgentConfig(mockEnv(null)),
    (err) => {
      assert.equal(err instanceof DailyMemoryAgentConfigError, true);
      assert.match(err.message, /daily-memory-email/);
      return true;
    },
  );
});

test('fails loud when default_model_id is empty', async () => {
  await assert.rejects(
    () => resolveDailyMemoryAgentConfig(mockEnv({
      id: 'asp_daily_memory_email',
      slug: DAILY_MEMORY_AGENT_SLUG,
      default_model_id: '   ',
      instructions_markdown: 'Write the digest.',
    })),
    /empty default_model_id/,
  );
});

test('uses catalog provider model ID from the subagent profile', async () => {
  const out = await resolveDailyMemoryAgentConfig(
    mockEnv({
      id: 'asp_daily_memory_email',
      slug: DAILY_MEMORY_AGENT_SLUG,
      display_name: 'Daily Memory Email',
      default_model_id: 'gemini-3.7-flash',
      instructions_markdown: 'Quote Day in Code numbers.',
    }),
    {
      loadModelRecord: async (_db, modelKey, source) => {
        assert.equal(modelKey, 'gemini-3.7-flash');
        assert.equal(source, 'daily_memory_agent');
        return { model_key: 'gemini-3.7-flash', provider_model_id: 'gemini-3.7-flash' };
      },
    },
  );
  assert.equal(out.slug, DAILY_MEMORY_AGENT_SLUG);
  assert.equal(out.apiModel, 'gemini-3.7-flash');
  assert.equal(out.catalogModelKey, 'gemini-3.7-flash');
  assert.match(out.instructions, /Day in Code/);
});

test('fails loud when the catalog loader rejects the profile model', async () => {
  await assert.rejects(
    () => resolveDailyMemoryAgentConfig(
      mockEnv({
        id: 'asp_daily_memory_email',
        slug: DAILY_MEMORY_AGENT_SLUG,
        default_model_id: 'not-a-real-model',
        instructions_markdown: 'x',
      }),
      {
        loadModelRecord: async () => {
          throw new Error('MODEL_NOT_FOUND');
        },
      },
    ),
    /not an active catalog model/,
  );
});
