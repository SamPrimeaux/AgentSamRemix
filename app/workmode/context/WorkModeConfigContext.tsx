import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { AppConfig, ModelChoice } from '../types';

/**
 * Resolves initial configuration by inspecting client-accessible environment variables
 * (with Vite `import.meta.env` support) and applying deterministic production defaults.
 */
export function getEnvironmentConfig(): AppConfig {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : ({} as any);

  const envMode: 'development' | 'production' | 'test' | 'preview' = 
    env.MODE === 'test' ? 'test' :
    env.MODE === 'development' || env.DEV ? 'development' :
    'production';

  return {
    appTitle: env.VITE_APP_TITLE || 'Agent Sam Work Mode - Execution Agent',
    appName: env.VITE_APP_NAME || 'Agent Sam',
    agentName: env.VITE_AGENT_NAME || env.VITE_APP_NAME || 'Agent Sam',
    agentRole: env.VITE_AGENT_ROLE || 'Lead Execution & Full-Stack Orchestrator',
    agentInitials: env.VITE_AGENT_INITIALS || 'AS',
    developerName: env.VITE_USER_NAME || 'Developer',
    developerInitials: env.VITE_USER_INITIALS || 'DV',
    developerEmail: env.VITE_USER_EMAIL || 'info@inneranimals.com',
    organization: env.VITE_ORGANIZATION || 'inneranimals',
    activeTenant: env.VITE_TENANT_ID || 'org_main',
    defaultBranch: env.VITE_DEFAULT_BRANCH || 'main',
    defaultPath: env.VITE_DEFAULT_WORKSPACE_PATH || 'backend/agentsam',
    execOsPort: Number(env.VITE_EXECOS_PORT) || 3099,
    execOsTunnelUrl: env.VITE_EXECOS_TUNNEL_URL || 'https://user-hosted-tunnel.agentsam.dev',
    execOsWorkerUrl: env.VITE_EXECOS_WORKER_URL || 'https://api.agentsam.dev/agent',
    macUsername: env.VITE_EXECOS_MAC_USER || 'developer',
    clientBrandName: env.VITE_CLIENT_BRAND_NAME || 'Apex Dynamics',
    clientTagline: env.VITE_CLIENT_TAGLINE || 'Precision AI Execution for Visionary Enterprises',
    clientMission: env.VITE_CLIENT_MISSION || 'Empowering ambitious teams to turn bold creative concepts into production-grade digital reality in seconds.',
    defaultModel: (env.VITE_DEFAULT_MODEL as ModelChoice) || 'gemini-3.5-flash',
    edgeRegion: env.VITE_EDGE_REGION || 'iad1 (US East)',
    apiBaseUrl: env.VITE_API_BASE_URL || '/api',
    environment: envMode,
  };
}

const STORAGE_KEY = 'agentsam_dynamic_config_overrides';

interface ConfigurationContextType {
  config: AppConfig;
  updateConfig: (updates: Partial<AppConfig>) => void;
  resetConfig: () => void;
  setActiveTenant: (tenant: string) => void;
  setActiveBranch: (branch: string) => void;
  setActivePath: (path: string) => void;
  updateDeveloperProfile: (name: string, email: string, initials?: string) => void;
}

const ConfigurationContext = createContext<ConfigurationContextType | null>(null);

export interface WorkModeConfigProviderProps {
  children: ReactNode;
  initialOverrides?: Partial<AppConfig>;
}

export const WorkModeConfigProvider: React.FC<WorkModeConfigProviderProps> = ({ 
  children,
  initialOverrides 
}) => {
  const [config, setConfig] = useState<AppConfig>(() => {
    const base = getEnvironmentConfig();
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          return { ...base, ...parsed, ...initialOverrides };
        }
      } catch (err) {
        console.warn('Failed to parse cached configuration overrides', err);
      }
    }
    return { ...base, ...initialOverrides };
  });

  const updateConfig = (updates: Partial<AppConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
      } catch {}
      return next;
    });
  };

  const resetConfig = () => {
    const base = getEnvironmentConfig();
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
    setConfig(base);
  };

  const setActiveTenant = (activeTenant: string) => {
    updateConfig({ activeTenant });
  };

  const setActiveBranch = (defaultBranch: string) => {
    updateConfig({ defaultBranch });
  };

  const setActivePath = (defaultPath: string) => {
    updateConfig({ defaultPath });
  };

  const updateDeveloperProfile = (name: string, email: string, initials?: string) => {
    const derivedInitials = initials || name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'DV';
    updateConfig({
      developerName: name,
      developerEmail: email,
      developerInitials: derivedInitials,
    });
  };

  const contextValue = useMemo<ConfigurationContextType>(() => ({
    config,
    updateConfig,
    resetConfig,
    setActiveTenant,
    setActiveBranch,
    setActivePath,
    updateDeveloperProfile
  }), [config]);

  return (
    <ConfigurationContext.Provider value={contextValue}>
      {children}
    </ConfigurationContext.Provider>
  );
};

export function useWorkModeConfig(): ConfigurationContextType {
  const context = useContext(ConfigurationContext);
  if (!context) {
    // Fallback if rendered outside provider
    const fallbackConfig = getEnvironmentConfig();
    return {
      config: fallbackConfig,
      updateConfig: () => {},
      resetConfig: () => {},
      setActiveTenant: () => {},
      setActiveBranch: () => {},
      setActivePath: () => {},
      updateDeveloperProfile: () => {},
    };
  }
  return context;
}

export function useAppConfig(): AppConfig {
  return useWorkModeConfig().config;
}
