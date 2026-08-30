import { deployCmd } from './deploy/index.mjs';
import { acpCmd } from './acp/index.mjs';
import { websiteCmd } from './website/index.mjs';
import { sdkCmd } from './sdk/index.mjs';
import { evalCmd } from './eval/index.mjs';

/**
 * Canonical verbs -> handlers. Minimal on purpose — grow deliberately,
 * one real command at a time, never scaffold a verb with no real
 * implementation behind it.
 */
export const COMMANDS = {
  acp: acpCmd,
  deploy: deployCmd,
  sdk: sdkCmd,
  website: websiteCmd,
};

export const VERB_ALIASES = {};

export const USAGE = `usage: bin/agentsam <verb> [subcommand] [options]

Verbs:
  acp         serve              local stdio ACP bridge to the Agent Sam API
  deploy      full|fast|worker   tsc/build/wrangler deploy — uses bin/deploy
  sdk         status             show SDK dependency + portable bin/lib handoffs
  website     sync|watch|status|verify|rollback   hash-driven WEBSITE_ASSETS releases

Examples:
  bin/agentsam acp serve
  bin/agentsam deploy full
  bin/agentsam deploy fast
  bin/agentsam deploy worker
  bin/agentsam sdk status
  bin/agentsam website sync
  bin/agentsam website watch
  bin/agentsam website status`;

export function usage() {
  console.error(USAGE);
}

export function resolveVerb(verb) {
  if (!verb) return null;
  return VERB_ALIASES[verb] ?? verb;
}
