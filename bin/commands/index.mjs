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
  eval: evalCmd,
  sdk: sdkCmd,
  website: websiteCmd,
};

export const VERB_ALIASES = {};

export const USAGE = `usage: bin/agentsam <verb> [subcommand] [options]

SDK verbs (delegated to @inneranimalmedia/agentsam-sdk):
  context                         Git repository and bridge context
  init                            local-first project scaffold
  start-local                     local PTY server
  tunnel                          expose the local PTY
  identity    preview|init        portable identity setup
  shell                           shell and slash-command information

AgentSamRemix host verbs:
  acp         serve               local stdio ACP bridge to the Agent Sam API
  deploy      full|fast|worker    build and deploy this Worker
  eval        retrieval           evaluate registered retrieval corpora via service principal
  sdk         status              show installed SDK and completed handoffs
  website     sync|watch|status|verify|rollback   WEBSITE_ASSETS releases

Examples:
  bin/agentsam --version
  bin/agentsam context --json
  bin/agentsam identity preview --open
  bin/agentsam acp serve
  bin/agentsam deploy full
  bin/agentsam deploy fast
  bin/agentsam deploy worker
  bin/agentsam eval retrieval --repo SamPrimeaux/AgentSamRemix
  bin/agentsam eval retrieval
  bin/agentsam eval retrieval --all
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
