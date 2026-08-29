import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentHomeScene } from './AgentHomeScene';
import { AgentHomeHero } from './AgentHomeHero';
import type { AgentHomeCmsConfig, AgentModeId } from '../../types/agentHomeScene';
import { DEFAULT_AGENT_HOME_CMS, AGENT_MODE_PILLS } from '../../types/agentHomeScene';
import { greetingNameFromDisplay } from '../../lib/agentDayPart';
import { useAgentDayPart } from '../../src/hooks/useAgentDayPart';
import {
  applyAgentHomeCmsToDocument,
  applyDayPartToScene,
  IAM_AGENT_HOME_SCENE_CHANGED,
} from '../../lib/agentHomeSceneResolve';
import { warmAgentChunksForTab } from '../../src/pwa/warmAgentChunks';
import { AGENT_EDITOR_PATH } from '../../lib/agentRoutes';
import { IAM_AGENT_MOBILE_CODE_FOCUS } from '../../agentChatConstants';
import { isPhoneViewport } from '../../lib/breakpoints';
import '../../styles/agent-home-tokens.css';
import '../../styles/agentHomeGlow.css';
import './AgentHome.css';

interface AgentHomeProps {
  displayName?: string | null;
  showHero?: boolean;
  terminalDocked?: boolean;
  onComposerHost?: (el: HTMLDivElement | null) => void;
  onMessagesHost?: (el: HTMLDivElement | null) => void;
  onModeSelect: (mode: AgentModeId) => void;
}

/**
 * Bare `/dashboard/agent` — CMS-backed scene + greeting + mode pills + composer portal host.
 */
export function AgentHome({ displayName, onComposerHost, onMessagesHost, showHero = true, terminalDocked = false, onModeSelect }: AgentHomeProps) {
  const navigate = useNavigate();
  const dayPart = useAgentDayPart();
  const [cms, setCms] = useState<AgentHomeCmsConfig>(DEFAULT_AGENT_HOME_CMS);
  const [sceneSource, setSceneSource] = useState<'default' | 'user' | 'workspace' | 'theme'>('default');
  const [tabHidden, setTabHidden] = useState(
    typeof document !== 'undefined' ? document.hidden : false,
  );

  const name = greetingNameFromDisplay(displayName);

  const loadScene = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/scene', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        cms?: AgentHomeCmsConfig;
        source?: 'default' | 'user' | 'workspace' | 'theme';
      };
      if (data.cms?.version === 1) {
        setCms(data.cms);
        applyAgentHomeCmsToDocument(data.cms);
      }
      if (data.source) setSceneSource(data.source);
    } catch {
      /* keep default */
    }
  }, []);

  useEffect(() => {
    void loadScene();
  }, [loadScene]);

  useEffect(() => {
    const onThemeApplied = () => {
      void loadScene();
    };
    const onScenePreview = (e: Event) => {
      const detail = (e as CustomEvent<{ cms?: AgentHomeCmsConfig }>).detail;
      if (detail?.cms?.version === 1) {
        setCms(detail.cms);
        applyAgentHomeCmsToDocument(detail.cms);
      }
    };
    window.addEventListener('iam:cms-theme-applied', onThemeApplied);
    window.addEventListener(IAM_AGENT_HOME_SCENE_CHANGED, onScenePreview);
    return () => {
      window.removeEventListener('iam:cms-theme-applied', onThemeApplied);
      window.removeEventListener(IAM_AGENT_HOME_SCENE_CHANGED, onScenePreview);
    };
  }, [loadScene]);

  useEffect(() => {
    const handler = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const displayScene = useMemo(
    () => applyDayPartToScene(cms, dayPart, sceneSource === 'theme' ? 'default' : sceneSource),
    [cms, dayPart, sceneSource],
  );

  const handlePillSelect = useCallback(
    (mode: AgentModeId) => {
      const pill = AGENT_MODE_PILLS.find((p) => p.id === mode);
      if (pill?.route) {
        warmAgentChunksForTab('code');
        if (mode === 'code' && isPhoneViewport()) {
          window.dispatchEvent(new CustomEvent(IAM_AGENT_MOBILE_CODE_FOCUS));
        }
        navigate(pill.route || AGENT_EDITOR_PATH);
        return;
      }
      onModeSelect(mode);
    },
    [navigate, onModeSelect],
  );

  const handleModeHover = useCallback(() => {
    warmAgentChunksForTab('code');
    void import('../../routes/AgentEditorRoute').catch(() => {});
  }, []);

  return (
    <div className={`agent-home${terminalDocked ? ' agent-home--terminal-dock' : ''}`}>
      <AgentHomeScene config={displayScene} paused={tabHidden} />

      <main
        className={`agent-home__center${showHero ? '' : ' agent-home__center--chat'}${terminalDocked ? ' agent-home__center--terminal-dock' : ''}`}
      >
        <div
          className={`agent-home__stack${showHero ? ' agent-home__stack--hero' : ' agent-home__stack--chat'}`}
          onPointerEnter={handleModeHover}
        >
          {showHero ? (
            <AgentHomeHero name={name} dayPart={dayPart} onModeSelect={handlePillSelect} />
          ) : null}
          <div
            ref={onMessagesHost}
            className="agent-home__messages-host"
            aria-label="Agent Sam conversation"
          />
          <div className="agent-home__composer-wrap">
            <div className="iam-agent-home-glow" aria-hidden="true" />
            <div
              ref={onComposerHost}
              className="agent-home__composer-host"
              aria-label="Agent Sam command input"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
