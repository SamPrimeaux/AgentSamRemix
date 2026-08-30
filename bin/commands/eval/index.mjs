import { execFileSync } from 'node:child_process';
import { createBridgeClient } from '../../lib/bridge-client.mjs';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

export function repoFullNameFromRemote(remote) {
  const value = trim(remote).replace(/\/+$/, '');
  if (!value) return '';
  const ssh = value.match(/^[^@]+@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh) return ssh[1].replace(/\.git$/, '');
  try {
    const url = new URL(value);
    return url.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  } catch {
    return '';
  }
}

export function inferRepoFullName(cwd = process.cwd(), execFile = execFileSync) {
  try {
    const remote = execFile('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return repoFullNameFromRemote(remote);
  } catch {
    return '';
  }
}

export function parseRetrievalEvalArgs(args, options = {}) {
  let repoFullName = '';
  let all = false;
  let json = false;
  const queries = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo') {
      repoFullName = trim(args[++index]);
      if (!repoFullName) throw new Error('--repo requires owner/name');
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--query') {
      const query = trim(args[++index]);
      if (!query) throw new Error('--query requires text');
      queries.push(query);
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`unknown eval retrieval option: ${arg}`);
    }
  }

  if (all && repoFullName) throw new Error('--repo and --all are mutually exclusive');
  if (!all && !repoFullName) {
    repoFullName = (options.inferRepoFullName || inferRepoFullName)(options.cwd);
  }
  if (!all && !repoFullName) {
    throw new Error('repo_not_resolved: pass --repo owner/name or configure git remote origin');
  }
  return { repoFullName, all, queries, json };
}

function printHuman(result, write = console.log) {
  write(`retrieval eval ${result.ok ? 'passed' : 'failed'}`);
  write(`run: ${result.runId || 'not-started'}`);
  write(`corpora: ${Number(result.corpusCount) || 0}  cases: ${Number(result.passed) || 0}/${Number(result.totalCases) || 0}`);
  for (const corpus of result.results || []) {
    write(`\n${corpus.repoFullName} @ ${corpus.generationId}`);
    for (const row of corpus.cases || []) {
      const status = row.ok ? 'ok' : 'fail';
      write(`  ${status}  ${Math.round(Number(row.totalRetrievalMs) || 0)}ms  chunks=${row.selectedChunks}  ${row.query}`);
      if (row.error) write(`       error=${row.error}`);
      if (row.warnings?.length) write(`       warnings=${row.warnings.join(',')}`);
    }
  }
}

export async function runRetrievalEval(args, options = {}) {
  const parsed = parseRetrievalEvalArgs(args, options);
  const client = options.client || createBridgeClient(options.clientOptions);
  const result = await client.post('/api/agent/retrieval/eval', {
    ...(parsed.all ? { all: true } : { repoFullName: parsed.repoFullName }),
    ...(parsed.queries.length ? { queries: parsed.queries } : {}),
  });
  if (parsed.json) (options.write || console.log)(JSON.stringify(result, null, 2));
  else printHuman(result, options.write || console.log);
  return result;
}

export function evalCmd(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'retrieval') {
    console.error('usage: bin/agentsam eval retrieval [--repo owner/name | --all] [--query text] [--json]');
    process.exitCode = 2;
    return;
  }
  return runRetrievalEval(rest);
}
