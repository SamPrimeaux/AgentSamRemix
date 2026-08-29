/**
 * Agent Sam SDK - Canonical Root Export
 * @package @inneranimalmedia/agentsam-sdk
 * @version 2.0.0-alpha.identity.11
 */

export * from './types';
export * from './identity';
export * from './repository';
export * from './environments';
export * from './tools';
export * from './mission';
export * from './codeMode';

import { createIdentityClient } from './identity';
import { RepositoryIntelligence } from './repository';
import { MissionRuntime } from './mission';
import { ToolExecutor } from './tools';
import { EXECUTION_ENVIRONMENTS } from './environments';
import { runCode } from './codeMode';

export class AgentSamSDK {
  readonly version = '2.0.0-alpha.identity.11';
  readonly identity = createIdentityClient();
  readonly repository = new RepositoryIntelligence();
  readonly mission = new MissionRuntime();
  readonly tools = new ToolExecutor();
  readonly environments = EXECUTION_ENVIRONMENTS;
  readonly runCode = runCode;
}

export const sam = new AgentSamSDK();
export default sam;
