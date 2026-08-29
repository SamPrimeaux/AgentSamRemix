/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chat layout visibility / portal / placeholder flags.
 */

import { isAgentCenterChatHome } from '../../../lib/agentRoutes';
import type { AgentMode } from '../types';

export function deriveChatLayoutFlags(args: {
  isNarrow: boolean;
  mobileHubTab: string;
  mobileThreadTab: string;
  conversationId: string;
  mobileAgentHomeMode: boolean;
  showEmptyThreadPlaceholder: boolean;
  atmosphericHomeMode: boolean;
  composerPortalTarget: HTMLElement | null | undefined;
  messagesPortalTarget: HTMLElement | null | undefined;
  locationPathname: string;
  locationSearch: string;
  mode: AgentMode;
  composerPlaceholderOverride?: string | null;
  githubRepoContext: string | null;
  githubContextActive: boolean;
  chatGithubFilePath: string | null;
}) {
  const {
    isNarrow, mobileHubTab, mobileThreadTab, conversationId, mobileAgentHomeMode,
    showEmptyThreadPlaceholder, atmosphericHomeMode, composerPortalTarget, messagesPortalTarget,
    locationPathname, locationSearch, mode, composerPlaceholderOverride,
    githubRepoContext, githubContextActive, chatGithubFilePath,
  } = args;

  const mobileAgentsThread = isNarrow && mobileHubTab === 'agents';
  const mobileActiveAgentThread = mobileAgentsThread && Boolean(conversationId.trim());
  const showMobileHubNav = false;

  const messagesVisible =
    !mobileAgentHomeMode &&
    (!isNarrow || (mobileHubTab === 'agents' && mobileThreadTab === 'chat'));
  const contextTabVisible =
    isNarrow && mobileHubTab === 'agents' && mobileThreadTab === 'context';

  const composerVisible =
    !isNarrow || (mobileHubTab === 'agents' && mobileThreadTab === 'chat');
  const composerPortaled = Boolean(atmosphericHomeMode && composerPortalTarget);
  const centerChatComposerColumn =
    !composerPortaled &&
    !isNarrow &&
    isAgentCenterChatHome(locationPathname, locationSearch);
  const desktopStartupCenterMode =
    centerChatComposerColumn &&
    showEmptyThreadPlaceholder &&
    !conversationId.trim();
  const designStudioPortalStartup =
    atmosphericHomeMode &&
    composerPortaled &&
    showEmptyThreadPlaceholder &&
    !conversationId.trim();
  const entryPortalStartup = designStudioPortalStartup;
  const hideOverlayMessagesForPortalStartup =
    entryPortalStartup || (composerPortaled && showEmptyThreadPlaceholder);
  const composerFlexOrder = desktopStartupCenterMode
    ? ''
    : mobileAgentHomeMode
      ? 'order-3'
      : 'order-5';
  const mobileGithubActive = githubContextActive && Boolean(githubRepoContext?.trim());
  const showMobileRepoConnector =
    isNarrow &&
    mobileThreadTab === 'chat' &&
    composerVisible &&
    mobileGithubActive &&
    (mobileAgentsThread || atmosphericHomeMode);
  const mobileRepoConnectorLabel = mobileGithubActive ? 'GitHub' : 'Connect GitHub repository';
  const messagesPortaled = Boolean(
    atmosphericHomeMode &&
      messagesPortalTarget &&
      messagesVisible &&
      !showEmptyThreadPlaceholder,
  );
  const modeComposerPlaceholder =
    mode === 'ask'
      ? 'Ask anything — read-only, no edits or deploys'
      : mode === 'plan'
        ? 'Describe what to design — Plan mode will not build yet'
        : mode === 'debug'
          ? 'Describe the bug — evidence first, then a targeted fix'
          : mode === 'multitask'
            ? 'Describe work to run in parallel workstreams'
            : mobileAgentHomeMode
              ? 'What should we work on?'
              : 'Tell Agent Sam what to do';
  const composerPlaceholder = composerPlaceholderOverride ?? modeComposerPlaceholder;

  return {
    mobileAgentsThread, mobileActiveAgentThread, showMobileHubNav, messagesVisible,
    contextTabVisible, composerVisible, composerPortaled, centerChatComposerColumn,
    desktopStartupCenterMode, designStudioPortalStartup, entryPortalStartup,
    hideOverlayMessagesForPortalStartup, composerFlexOrder, showMobileRepoConnector,
    mobileRepoConnectorLabel, messagesPortaled, composerPlaceholder,
  };
}
