import { deployCmd } from './deploy/index.mjs';

/**
 * Canonical verbs -> handlers. Minimal on purpose — grow deliberately,
 * one real command at a time, never scaffold a verb with no real
 * implementation behind it.
 */
export const COMMANDS = {
  deploy: deployCmd,
};

export const VERB_ALIASES = {};

export const USAGE = `usage: bin/agentsam <verb> [subcommand] [options]

Verbs:
  deploy      full|fast|worker   tsc/build/wrangler deploy — wraps scripts/agentsam-remix

Examples:
  bin/agentsam deploy full
  bin/agentsam deploy fast
  bin/agentsam deploy worker`;

export function usage() {
  console.error(USAGE);
}

export function resolveVerb(verb) {
  if (!verb) return null;
  return VERB_ALIASES[verb] ?? verb;
}
