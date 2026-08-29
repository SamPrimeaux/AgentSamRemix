import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RulesSkillsTabId, ModelsTabId } from './useSettingsSections';
import {
  CREATE_SUBAGENT_COMPOSE_MESSAGE,
  IAM_AGENT_CHAT_COMPOSE,
} from '../../../agentChatConstants';
import type {
  AgentsamUserPolicy,
  AgentsSettingsResponse,
  LlmVaultRow,
  SettingsModelsResponse,
  SettingsMcpResponse,
  GitRepo,
} from '../types';

const defaultAgentsPolicy: AgentsamUserPolicy = {
  auto_run_mode: 'allowlist',
  browser_protection: 0,
  mcp_tools_protection: 1,
  file_deletion_protection: 1,
  external_file_protection: 1,
  default_agent_location: 'pane',
  text_size: 'default',
  auto_clear_chat: 0,
  submit_with_mod_enter: 0,
  max_tab_count: 5,
  queue_messages_mode: 'after_current',
  usage_summary_mode: 'auto',
  agent_autocomplete: 1,
  web_search_enabled: 1,
  auto_accept_web_search: 0,
  web_fetch_enabled: 1,
  hierarchical_ignore: 0,
  ignore_symlinks: 0,
  inline_diffs: 1,
  jump_next_diff_on_accept: 1,
  auto_format_on_agent_finish: 0,
  legacy_terminal_tool: 1,
  toolbar_on_selection: 1,
  auto_parse_links: 0,
  themed_diff_backgrounds: 1,
  terminal_hint: 1,
  terminal_preview_box: 1,
  collapse_auto_run_commands: 1,
  voice_submit_keyword: 'submit',
  commit_attribution: 1,
  pr_attribution: 1,
  settings_json: null,
};

export type UseSettingsDataArgs = {
  workspaceId?: string | null;
  activeSection: string;
  rulesSkillsTab: RulesSkillsTabId;
  modelsTab: ModelsTabId;
};

export function useSettingsData({
  workspaceId,
  activeSection,
  rulesSkillsTab,
  modelsTab: _modelsTab,
}: UseSettingsDataArgs) {
  void _modelsTab;
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePlan, setProfilePlan] = useState<string | null>(null);
  const [workerBaseUrl, setWorkerBaseUrl] = useState('');

  const [settingsModels, setSettingsModels] = useState<SettingsModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [mcpToggleError, setMcpToggleError] = useState<Record<string, string | null>>({});

  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<any | null>(null);
  const [skillDraft, setSkillDraft] = useState<any>({});

  const [subagentsLoading, setSubagentsLoading] = useState(false);
  const [subagentsError, setSubagentsError] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<any[]>([]);
  const [editingSubagentId, setEditingSubagentId] = useState<string | null>(null);
  const [subagentDraft, setSubagentDraft] = useState<any>({});

  const [commandsLoading2, setCommandsLoading2] = useState(false);
  const [commandsError2, setCommandsError2] = useState<string | null>(null);
  const [commands2, setCommands2] = useState<any[]>([]);
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);

  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<any>({});

  const [workspaceLoading2, setWorkspaceLoading2] = useState(false);
  const [workspaceError2, setWorkspaceError2] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<any | null>(null);
  const [reindexBusy, setReindexBusy] = useState<'ast' | 'chunks' | 'both' | null>(null);
  const [reindexPhase, setReindexPhase] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [reindexPct, setReindexPct] = useState(0);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const reindexAbortRef = useRef(false);

  const [hooksLoading2, setHooksLoading2] = useState(false);
  const [hooksError2, setHooksError2] = useState<string | null>(null);
  const [hooksData, setHooksData] = useState<{ hooks: any[]; executions: any[] } | null>(null);
  const [newHookOpen, setNewHookOpen] = useState(false);
  const [newHookDraft, setNewHookDraft] = useState({
    trigger: 'pre_tool_call',
    command: '',
    provider: 'system',
  });

  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);

  const [user, setUser] = useState<{
    email?: string | null;
    passwordMethod?: string;
    passwordUpdatedAt?: string | null;
    provider?: string | null;
  } | null>(null);

  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usagePage, setUsagePage] = useState(1);
  const [usageProvider, setUsageProvider] = useState('');
  const [usageModel, setUsageModel] = useState('');
  const [usageData, setUsageData] = useState<any | null>(null);

  const [billingPlans, setBillingPlans] = useState<any[]>([]);
  const [billingCoupons, setBillingCoupons] = useState<any[]>([]);
  const [billingPlansLoading, setBillingPlansLoading] = useState(false);
  const [billingPlansError, setBillingPlansError] = useState<string | null>(null);
  const [activeSubscription, setActiveSubscription] = useState<any | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [billingInvoices, setBillingInvoices] = useState<any[]>([]);
  const [billingInvoicesLoading, setBillingInvoicesLoading] = useState(false);
  const [billingInvoicesError, setBillingInvoicesError] = useState<string | null>(null);

  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [notifyPrefs, setNotifyPrefs] = useState<Record<string, string>>({});

  const [budgetMonthlyLimit, setBudgetMonthlyLimit] = useState<string>('');
  const [budgetHardStop, setBudgetHardStop] = useState(false);

  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsSaving, setAgentsSaving] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsWorkspaceId, setAgentsWorkspaceId] = useState<string>('');
  const [agentsPolicy, setAgentsPolicy] = useState<AgentsamUserPolicy | null>(null);
  const [agentsCommands, setAgentsCommands] = useState<string[]>([]);
  const [agentsDomains, setAgentsDomains] = useState<string[]>([]);
  const [agentsMcp, setAgentsMcp] = useState<Array<{ tool_key: string; notes?: string | null }>>([]);
  const [agentsMcpGroups, setAgentsMcpGroups] = useState<
    AgentsSettingsResponse['mcp_tool_groups']
  >([]);
  const [agentsMcpGroupPrefs, setAgentsMcpGroupPrefs] = useState<Record<string, string>>({});
  const [agentsSubagents, setAgentsSubagents] = useState<Array<Record<string, unknown>>>([]);

  const [newCommand, setNewCommand] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newToolKey, setNewToolKey] = useState('');

  const [settingsMcp, setSettingsMcp] = useState<SettingsMcpResponse | null>(null);

  const [repos, setRepos] = useState<GitRepo[]>([]);

  const [llmKeys, setLlmKeys] = useState<LlmVaultRow[]>([]);
  const [llmBusy, setLlmBusy] = useState<string | null>(null);
  const [vaultProvider, setVaultProvider] = useState<
    'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY'
  >('OPENAI_API_KEY');
  const [vaultKeyValue, setVaultKeyValue] = useState('');

  const tierPatchTimers = useRef<Record<string, number>>({});

  const patchProfile = useCallback(
    async (updates: Array<{ setting_key: string; setting_value: string }>) => {
      const r = await fetch('/api/settings/profile', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      return j;
    },
    [],
  );

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const r = await fetch('/api/settings/skills', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setSkills(Array.isArray(j.skills) ? j.skills : []);
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Failed to load skills');
      setSkills([]);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const loadSubagents = useCallback(async () => {
    setSubagentsLoading(true);
    setSubagentsError(null);
    try {
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      const r = await fetch(`/api/settings/subagents${qp}`, { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setSubagents(Array.isArray(j.subagents) ? j.subagents : []);
    } catch (e) {
      setSubagentsError(e instanceof Error ? e.message : 'Failed to load subagents');
      setSubagents([]);
    } finally {
      setSubagentsLoading(false);
    }
  }, [workspaceId]);

  const loadCommands2 = useCallback(async () => {
    setCommandsLoading2(true);
    setCommandsError2(null);
    try {
      const r = await fetch('/api/settings/commands', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setCommands2(Array.isArray(j.commands) ? j.commands : []);
    } catch (e) {
      setCommandsError2(e instanceof Error ? e.message : 'Failed to load commands');
      setCommands2([]);
    } finally {
      setCommandsLoading2(false);
    }
  }, []);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      const r = await fetch(`/api/settings/rules${qp}`, { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg =
          typeof j.error === 'string'
            ? j.error
            : r.status === 500
              ? 'Server error loading rules'
              : `Load failed (${r.status})`;
        throw new Error(msg);
      }
      setRules(Array.isArray(j.rules) ? j.rules : []);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : 'Failed to load rules');
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, [workspaceId]);

  const loadWorkspace = useCallback(async () => {
    setWorkspaceLoading2(true);
    setWorkspaceError2(null);
    try {
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      const r = await fetch(`/api/settings/workspace${qp}`, { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setWorkspaceData(j);
    } catch (e) {
      setWorkspaceError2(e instanceof Error ? e.message : 'Failed to load workspace');
      setWorkspaceData(null);
    } finally {
      setWorkspaceLoading2(false);
    }
  }, [workspaceId]);

  const patchWorkspaceCmsPipeline = useCallback(
    async (partial: Record<string, unknown>) => {
      const ws = workspaceId?.trim();
      if (!ws) throw new Error('No active workspace');
      const r = await fetch(`/api/settings/workspace?workspace_id=${encodeURIComponent(ws)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: ws, cms_pipeline: partial }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      await loadWorkspace();
      return j;
    },
    [workspaceId, loadWorkspace],
  );

  const loadHooks = useCallback(async () => {
    setHooksLoading2(true);
    setHooksError2(null);
    try {
      const r = await fetch('/api/settings/hooks', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setHooksData({
        hooks: Array.isArray(j.hooks) ? j.hooks : [],
        executions: Array.isArray(j.executions) ? j.executions : [],
      });
    } catch (e) {
      setHooksError2(e instanceof Error ? e.message : 'Failed to load hooks');
      setHooksData({ hooks: [], executions: [] });
    } finally {
      setHooksLoading2(false);
    }
  }, []);

  const loadSecurity = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const [sessR, findR] = await Promise.all([
        fetch('/api/settings/security/sessions', { credentials: 'same-origin' }),
        fetch('/api/settings/security/findings', { credentials: 'same-origin' }),
      ]);
      const sessJ = await sessR.json().catch(() => ({}));
      const findJ = await findR.json().catch(() => ({}));
      if (!sessR.ok)
        throw new Error(typeof sessJ.error === 'string' ? sessJ.error : `Load failed (${sessR.status})`);
      setSessions(Array.isArray(sessJ.sessions) ? sessJ.sessions : []);
      setFindings(Array.isArray(findJ.findings) ? findJ.findings : []);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : 'Failed to load security');
      setSessions([]);
      setFindings([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async (page: number, provider: string, model: string) => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const qp = new URLSearchParams({ page: String(page || 1) });
      if (provider) qp.set('provider', provider);
      if (model) qp.set('model', model);
      const r = await fetch(`/api/settings/usage?${qp.toString()}`, { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setUsageData(j);
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : 'Failed to load usage');
      setUsageData(null);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadBillingPlans = useCallback(async () => {
    setBillingPlansLoading(true);
    setBillingPlansError(null);
    try {
      const r = await fetch('/api/billing/plans', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setBillingPlans(Array.isArray(j.plans) ? j.plans : []);
      setBillingCoupons(Array.isArray(j.coupons) ? j.coupons : []);
    } catch (e) {
      setBillingPlansError(e instanceof Error ? e.message : 'Failed to load plans');
      setBillingPlans([]);
      setBillingCoupons([]);
    } finally {
      setBillingPlansLoading(false);
    }
  }, []);

  const loadBillingSubscription = useCallback(async () => {
    setSubscriptionLoading(true);
    try {
      const r = await fetch('/api/billing/subscription', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) {
        setActiveSubscription(null);
        return;
      }
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setActiveSubscription(j.subscription ?? null);
    } catch {
      setActiveSubscription(null);
    } finally {
      setSubscriptionLoading(false);
    }
  }, []);

  const loadBillingInvoices = useCallback(async () => {
    setBillingInvoicesLoading(true);
    setBillingInvoicesError(null);
    try {
      const r = await fetch('/api/billing/invoices', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setBillingInvoices(Array.isArray(j.invoices) ? j.invoices : []);
    } catch (e) {
      setBillingInvoicesError(e instanceof Error ? e.message : 'Failed to load invoices');
      setBillingInvoices([]);
    } finally {
      setBillingInvoicesLoading(false);
    }
  }, []);

  const startCheckout = useCallback(async (planId: string, billingPeriod?: string) => {
    setUsageError(null);
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, billing_period: billingPeriod || 'monthly' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Checkout failed (${r.status})`);
      const checkoutUrl = typeof j.checkout_url === 'string' ? j.checkout_url : '';
      if (checkoutUrl) window.location.href = checkoutUrl;
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : 'Checkout failed');
    }
  }, []);

  const openBillingPortal = useCallback(async () => {
    setUsageError(null);
    try {
      const r = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Portal failed (${r.status})`);
      const portalUrl = typeof j.portal_url === 'string' ? j.portal_url : '';
      if (portalUrl) window.location.href = portalUrl;
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : 'Portal failed');
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotifyLoading(true);
    setNotifyError(null);
    try {
      const r = await fetch('/api/settings/notifications', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      const prefs =
        j &&
        typeof j === 'object' &&
        (j as any).extra &&
        typeof (j as any).extra === 'object' &&
        (j as any).extra.preferences &&
        typeof (j as any).extra.preferences === 'object'
          ? ((j as any).extra.preferences as Record<string, string>)
          : {};
      setNotifyPrefs(prefs);
      const email =
        typeof (j as any)?.extra?.notification_email === 'string'
          ? String((j as any).extra.notification_email).trim()
          : '';
      if (email) setProfileEmail(email);
    } catch (e) {
      setNotifyError(e instanceof Error ? e.message : 'Failed to load notifications');
      setNotifyPrefs({});
    } finally {
      setNotifyLoading(false);
    }
  }, []);

  const loadAgentsSettings = useCallback(async (wsId: string | null | undefined) => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const qp = wsId && wsId.trim() ? `?workspace_id=${encodeURIComponent(wsId.trim())}` : '';
      const r = await fetch(`/api/settings/agents${qp}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(await r.text());
      const d = (await r.json()) as AgentsSettingsResponse;
      setAgentsWorkspaceId(String(d.workspace_id || wsId || '').trim());
      setAgentsPolicy(
        d.policy && typeof d.policy === 'object'
          ? { ...defaultAgentsPolicy, ...d.policy }
          : { ...defaultAgentsPolicy },
      );
      setAgentsCommands(Array.isArray(d.allowlists?.commands) ? d.allowlists.commands : []);
      setAgentsDomains(Array.isArray(d.allowlists?.domains) ? d.allowlists.domains : []);
      setAgentsMcp(Array.isArray(d.allowlists?.mcp) ? d.allowlists.mcp : []);
      setAgentsMcpGroups(Array.isArray(d.mcp_tool_groups) ? d.mcp_tool_groups : []);
      setAgentsMcpGroupPrefs(
        d.mcp_group_preferences && typeof d.mcp_group_preferences === 'object'
          ? d.mcp_group_preferences
          : {},
      );
      setAgentsSubagents(Array.isArray(d.subagents) ? d.subagents : []);
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : 'Failed to load Agents settings');
      setAgentsPolicy({ ...defaultAgentsPolicy });
      setAgentsCommands([]);
      setAgentsDomains([]);
      setAgentsMcp([]);
      setAgentsMcpGroups([]);
      setAgentsMcpGroupPrefs({});
      setAgentsSubagents([]);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const patchAgentsSubagent = useCallback(
    async (id: string, body: { is_active?: boolean; default_model_id?: string | null }) => {
      const ws = agentsWorkspaceId?.trim() || workspaceId?.trim() || '';
      const r = await fetch(`/api/settings/agents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, workspace_id: ws }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadAgentsSettings(ws || workspaceId);
    },
    [agentsWorkspaceId, workspaceId, loadAgentsSettings],
  );

  const refreshLlmKeys = useCallback(() => {
    fetch('/api/vault/llm-keys', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { keys?: LlmVaultRow[] }) => setLlmKeys(Array.isArray(d.keys) ? d.keys : []))
      .catch(() => setLlmKeys([]));
  }, []);

  const loadModelsSettings = useCallback(async (wsId: string | null | undefined) => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const qp = wsId && wsId.trim() ? `?workspace_id=${encodeURIComponent(wsId.trim())}` : '';
      const r = await fetch(`/api/settings/models${qp}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(await r.text());
      const d = (await r.json()) as SettingsModelsResponse;
      setSettingsModels(d && typeof d === 'object' ? d : null);
    } catch (e) {
      setSettingsModels(null);
      setModelsError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const modelOptions = useMemo(() => {
    const rows = settingsModels?.models || [];
    return rows.map((m) => ({ id: String(m.id), name: String(m.name || m.id) }));
  }, [settingsModels?.models]);

  const patchTierDebounced = useCallback((tierId: string, patch: Record<string, unknown>) => {
    if (!tierId) return;
    const prev = tierPatchTimers.current[tierId];
    if (prev) window.clearTimeout(prev);
    tierPatchTimers.current[tierId] = window.setTimeout(() => {
      void (async () => {
        try {
          await fetch(`/api/settings/models/tiers/${encodeURIComponent(tierId)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        } catch {
          /* reload on tab change */
        }
      })();
    }, 400);
  }, []);

  const toggleModelField = useCallback(
    async (modelId: string, field: 'is_active' | 'show_in_picker', value: boolean) => {
      if (!settingsModels) return;
      const prev = settingsModels;
      setSettingsModels({
        ...prev,
        models: prev.models.map((m) => (m.id === modelId ? { ...m, [field]: value ? 1 : 0 } : m)),
      });
      try {
        const r = await fetch(`/api/settings/models/${encodeURIComponent(modelId)}/toggle`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value ? 1 : 0 }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      } catch (e) {
        setSettingsModels(prev);
        setModelsError(e instanceof Error ? e.message : 'Save failed');
      }
    },
    [settingsModels],
  );

  const loadMcpSettings = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/mcp', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(await r.text());
      const d = (await r.json()) as SettingsMcpResponse;
      setSettingsMcp(d && typeof d === 'object' ? d : null);
    } catch {
      setSettingsMcp(null);
    }
  }, []);

  const removeLlmKey = async (id: string) => {
    setLlmBusy(id);
    try {
      await fetch(`/api/vault/llm-keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      refreshLlmKeys();
    } catch {
      /* ignore */
    } finally {
      setLlmBusy(null);
    }
  };

  const saveVaultKeyFromSecurity = async () => {
    const value = vaultKeyValue.trim();
    if (!value) return;
    setLlmBusy(vaultProvider);
    try {
      const r = await fetch('/api/vault/store', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_name: vaultProvider, value }),
      });
      if (r.ok) {
        setVaultKeyValue('');
        refreshLlmKeys();
      }
    } catch {
      /* ignore */
    } finally {
      setLlmBusy(null);
    }
  };

  const patchSkillActive = useCallback(
    async (skillId: string, v: boolean, prev: any[]) => {
      try {
        await fetch(`/api/settings/skills/${encodeURIComponent(String(skillId))}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: v ? 1 : 0 }),
        });
      } catch {
        setSkills(prev);
      }
    },
    [],
  );

  const patchSubagentActive = useCallback(
    async (id: string, v: boolean, prev: any[]) => {
      try {
        const ws = workspaceId?.trim();
        const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
        await fetch(`/api/settings/subagents/${encodeURIComponent(String(id))}${qp}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: v ? 1 : 0 }),
        });
      } catch {
        setSubagents(prev);
      }
    },
    [workspaceId],
  );

  const patchCommandActive = useCallback(
    async (id: string, v: boolean, prev: any[]) => {
      try {
        await fetch(`/api/settings/commands/${encodeURIComponent(id)}/toggle`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: v ? 1 : 0 }),
        });
      } catch {
        setCommands2(prev);
      }
    },
    [],
  );

  const patchRuleActive = useCallback(
    async (id: string, v: boolean, prev: any[]) => {
      try {
        const ws = workspaceId?.trim();
        const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
        const res = await fetch(`/api/settings/rules/${encodeURIComponent(String(id))}${qp}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: v ? 1 : 0 }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Update failed');
      } catch {
        setRules(prev);
      }
    },
    [workspaceId],
  );

  const openNewRuleDrawer = useCallback(() => {
    setRuleDraft({
      title: '',
      body_markdown: '',
      apply_mode: 'always',
      globs: '',
    });
    setRuleDrawerOpen(true);
  }, []);

  const openEditRuleDrawer = useCallback((r: any) => {
    setRuleDraft({
      id: r.id,
      title: r.title || '',
      body_markdown: r.body_markdown || '',
      apply_mode: r.apply_mode || 'always',
      globs: r.globs || '',
      version: r.version || 1,
    });
    setRuleDrawerOpen(true);
  }, []);

  const saveRuleDrawer = useCallback(async () => {
    try {
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      const payload = {
        title: String(ruleDraft.title || '').trim() || 'Untitled rule',
        body_markdown: ruleDraft.body_markdown || '',
        apply_mode: ruleDraft.apply_mode || 'always',
        globs: ruleDraft.globs || '',
      };
      if (ruleDraft.id) {
        const r = await fetch(
          `/api/settings/rules/${encodeURIComponent(String(ruleDraft.id))}${qp}`,
          {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      } else {
        const r = await fetch(`/api/settings/rules${qp}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Create failed (${r.status})`);
      }
      setRuleDrawerOpen(false);
      await loadRules();
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : 'Save failed');
    }
  }, [ruleDraft, workspaceId, loadRules]);

  const deleteRule = useCallback(
    async (id: string) => {
      if (!window.confirm('Deactivate this rule? You can re-enable it from the list if needed.')) return;
      try {
        const ws = workspaceId?.trim();
        const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
        const r = await fetch(`/api/settings/rules/${encodeURIComponent(id)}${qp}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Delete failed');
        await loadRules();
      } catch (e) {
        setRulesError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [workspaceId, loadRules],
  );

  const saveSkillDrawer = useCallback(async () => {
    try {
      const payload = {
        name: String(skillDraft.name || '').trim(),
        description: skillDraft.description || '',
        content_markdown: skillDraft.content_markdown || '',
        slash_trigger: skillDraft.slash_trigger || '',
        globs: skillDraft.globs || '',
        always_apply: skillDraft.always_apply ? 1 : 0,
        tags: skillDraft.tags || '',
      };
      if (!payload.name) throw new Error('Name required');
      if (editingSkill?.id) {
        const r = await fetch(`/api/settings/skills/${encodeURIComponent(String(editingSkill.id))}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      } else {
        const r = await fetch('/api/settings/skills', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      }
      setSkillDrawerOpen(false);
      await loadSkills();
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Save failed');
    }
  }, [editingSkill?.id, skillDraft, loadSkills]);

  const closeSubagentEdit = useCallback(() => {
    setEditingSubagentId(null);
    setSubagentDraft({});
  }, []);

  const openEditSubagent = useCallback((sa: Record<string, unknown>) => {
    const id = String(sa.id || '').trim();
    if (!id) return;
    setEditingSubagentId(id);
    setSubagentDraft({ ...sa });
  }, []);

  const startCreateSubagent = useCallback(() => {
    setSubagentsError(null);
    setEditingSubagentId('__new__');
    setSubagentDraft({
      id: '',
      slug: '',
      display_name: '',
      description: '',
      instructions_markdown: '',
      default_model_id: '',
      personality_tone: 'professional',
      sandbox_mode: 'workspace-write',
      model_reasoning_effort: 'medium',
      access_mode: 'read_write',
      allowed_tool_globs: '',
      tool_profile_key: '',
      agent_type: 'custom',
      is_active: 1,
    });
  }, []);

  const startCreateSubagentViaChat = useCallback(() => {
    closeSubagentEdit();
    const message = CREATE_SUBAGENT_COMPOSE_MESSAGE;
    const cursor = message.length;
    window.dispatchEvent(
      new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
        detail: {
          message,
          selectionStart: cursor,
          selectionEnd: cursor,
          ensureAgentPanel: true,
          send: false,
        },
      }),
    );
  }, [closeSubagentEdit]);

  const deleteSubagent = useCallback(
    async (idRaw: string) => {
      const id = String(idRaw || '').trim();
      if (!id || id === '__new__') return;
      if (!window.confirm('Delete this subagent permanently? Past run history is kept.')) return;
      setSubagentsError(null);
      try {
        const ws = workspaceId?.trim();
        const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
        const r = await fetch(`/api/settings/subagents/${encodeURIComponent(id)}${qp}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Delete failed (${r.status})`);
        if (editingSubagentId === id) closeSubagentEdit();
        await loadSubagents();
        void loadAgentsSettings(workspaceId);
      } catch (e) {
        setSubagentsError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [workspaceId, editingSubagentId, closeSubagentEdit, loadSubagents, loadAgentsSettings],
  );

  const saveSubagentEdit = useCallback(async () => {
    try {
      setSubagentsError(null);
      const isCreate = editingSubagentId === '__new__' || !String(subagentDraft.id || editingSubagentId || '').trim();
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      const display_name = String(subagentDraft.display_name || '').trim();
      if (!display_name) throw new Error('Display name required');
      const globsRaw = subagentDraft.allowed_tool_globs;
      let allowed_tool_globs: string | null = null;
      if (Array.isArray(globsRaw)) {
        allowed_tool_globs = JSON.stringify(globsRaw);
      } else if (globsRaw != null && String(globsRaw).trim()) {
        const s = String(globsRaw).trim();
        allowed_tool_globs = s.startsWith('[') ? s : JSON.stringify(s.split(/[\s,]+/).filter(Boolean));
      }
      const payload: Record<string, unknown> = {
        display_name,
        description: subagentDraft.description || '',
        instructions_markdown: subagentDraft.instructions_markdown || '',
        default_model_id: subagentDraft.default_model_id || null,
        personality_tone: subagentDraft.personality_tone || 'professional',
        sandbox_mode: subagentDraft.sandbox_mode || 'workspace-write',
        model_reasoning_effort: subagentDraft.model_reasoning_effort || 'medium',
        access_mode: subagentDraft.access_mode === 'read_only' ? 'read_only' : 'read_write',
        allowed_tool_globs,
        tool_profile_key:
          subagentDraft.tool_profile_key != null && String(subagentDraft.tool_profile_key).trim()
            ? String(subagentDraft.tool_profile_key).trim()
            : null,
      };
      const slugRaw = String(subagentDraft.slug || '').trim();
      if (slugRaw) payload.slug = slugRaw;

      if (isCreate) {
        const r = await fetch(`/api/settings/subagents${qp}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Create failed (${r.status})`);
        closeSubagentEdit();
        await loadSubagents();
        return;
      }

      const id = String(subagentDraft.id || editingSubagentId || '').trim();
      if (!id) throw new Error('No subagent selected');
      const r = await fetch(`/api/settings/subagents/${encodeURIComponent(id)}${qp}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      closeSubagentEdit();
      await loadSubagents();
    } catch (e) {
      setSubagentsError(e instanceof Error ? e.message : 'Save failed');
    }
  }, [subagentDraft, editingSubagentId, workspaceId, loadSubagents, closeSubagentEdit]);

  const saveAgentsPolicy = useCallback(async () => {
    if (!agentsPolicy) return;
    setAgentsSaving(true);
    setAgentsError(null);
    try {
      const r = await fetch('/api/settings/agents/policy', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: agentsWorkspaceId || (workspaceId || ''),
          policy: agentsPolicy,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json().catch(() => null);
      const fresh = d?.policy && typeof d.policy === 'object' ? d.policy : null;
      if (fresh) setAgentsPolicy({ ...defaultAgentsPolicy, ...fresh });
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setAgentsSaving(false);
    }
  }, [agentsPolicy, agentsWorkspaceId, workspaceId]);

  const addAgentsCommandValue = useCallback(
    async (command: string) => {
      const v = String(command || '').trim();
      if (!v) return;
      setAgentsError(null);
      const r = await fetch('/api/settings/agents/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: agentsWorkspaceId || (workspaceId || ''), command: v }),
      });
      if (!r.ok) throw new Error(await r.text());
      setAgentsCommands((p) => Array.from(new Set([...p, v])).sort());
    },
    [agentsWorkspaceId, workspaceId],
  );

  const addAgentsCommand = useCallback(async () => {
    const v = newCommand.trim();
    if (!v) return;
    try {
      await addAgentsCommandValue(v);
      setNewCommand('');
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : 'Failed to add command');
    }
  }, [newCommand, addAgentsCommandValue]);

  const addAgentsCommandsBulk = useCallback(
    async (commands: string[]) => {
      const unique = Array.from(
        new Set(commands.map((c) => String(c || '').trim()).filter(Boolean)),
      );
      if (!unique.length) return;
      try {
        setAgentsError(null);
        for (const cmd of unique) {
          await addAgentsCommandValue(cmd);
        }
      } catch (e) {
        setAgentsError(e instanceof Error ? e.message : 'Failed to add commands');
        throw e;
      }
    },
    [addAgentsCommandValue],
  );

  const removeAgentsCommand = useCallback(
    async (c: string) => {
      try {
        setAgentsError(null);
        const r = await fetch(`/api/settings/agents/commands/${encodeURIComponent(c)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error(await r.text());
        setAgentsCommands((p) => p.filter((x) => x !== c));
      } catch (e) {
        setAgentsError(e instanceof Error ? e.message : 'Failed to remove command');
      }
    },
    [],
  );

  const addAgentsDomain = useCallback(async () => {
    const v = newDomain.trim();
    if (!v) return;
    try {
      setAgentsError(null);
      const r = await fetch('/api/settings/agents/domains', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: agentsWorkspaceId || (workspaceId || ''), host: v }),
      });
      if (!r.ok) throw new Error(await r.text());
      setAgentsDomains((p) => Array.from(new Set([...p, v])).sort());
      setNewDomain('');
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : 'Failed to add domain');
    }
  }, [newDomain, agentsWorkspaceId, workspaceId]);

  const removeAgentsDomain = useCallback(
    async (h: string) => {
      try {
        setAgentsError(null);
        const r = await fetch(`/api/settings/agents/domains/${encodeURIComponent(h)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error(await r.text());
        setAgentsDomains((p) => p.filter((x) => x !== h));
      } catch (e) {
        setAgentsError(e instanceof Error ? e.message : 'Failed to remove domain');
      }
    },
    [],
  );

  const addAgentsMcp = useCallback(async () => {
    const tool_key = newToolKey.trim();
    if (!tool_key) return;
    try {
      setAgentsError(null);
      const r = await fetch('/api/settings/agents/mcp', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: agentsWorkspaceId || (workspaceId || ''),
          tool_key,
          notes: '',
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setAgentsMcp((p) => [...p, { tool_key, notes: '' }].sort((a, b) => a.tool_key.localeCompare(b.tool_key)));
      setNewToolKey('');
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : 'Failed to add MCP tool');
    }
  }, [newToolKey, agentsWorkspaceId, workspaceId]);

  const removeAgentsMcp = useCallback(
    async (tool_key: string) => {
      try {
        setAgentsError(null);
        const r = await fetch(`/api/settings/agents/mcp/${encodeURIComponent(tool_key)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error(await r.text());
        setAgentsMcp((p) => p.filter((t) => t.tool_key !== tool_key));
      } catch (e) {
        setAgentsError(e instanceof Error ? e.message : 'Failed to remove MCP tool');
      }
    },
    [],
  );

  const saveAgentsMcpGroupPreferences = useCallback(
    async (groupPreferences: Record<string, string>) => {
      try {
        setAgentsError(null);
        const r = await fetch('/api/settings/agents/mcp/preferences', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: agentsWorkspaceId || (workspaceId || ''),
            group_preferences: groupPreferences,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
        await loadAgentsSettings(agentsWorkspaceId || workspaceId);
      } catch (e) {
        setAgentsError(e instanceof Error ? e.message : 'Failed to save MCP tool preferences');
      }
    },
    [agentsWorkspaceId, workspaceId, loadAgentsSettings],
  );

  const toggleMcpRegisteredTool = useCallback(
    async (id: string, v: boolean, prevEnabled: boolean) => {
      setMcpToggleError((p) => ({ ...p, [id]: null }));
      setSettingsMcp((p) =>
        p
          ? {
              ...p,
              tools: (p.tools || []).map((x: any) =>
                String(x?.id) === id ? { ...x, enabled: v ? 1 : 0 } : x,
              ),
            }
          : p,
      );
      try {
        const r = await fetch(`/api/settings/mcp/tools/${encodeURIComponent(id)}/toggle`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: v ? 1 : 0 }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      } catch (e) {
        setSettingsMcp((p) =>
          p
            ? {
                ...p,
                tools: (p.tools || []).map((x: any) =>
                  String(x?.id) === id ? { ...x, enabled: prevEnabled ? 1 : 0 } : x,
                ),
              }
            : p,
        );
        setMcpToggleError((p) => ({
          ...p,
          [id]: e instanceof Error ? e.message : 'Save failed',
        }));
      }
    },
    [],
  );

  const postWorkspaceReindex = useCallback(async (mode: 'ast' | 'chunks' | 'both' = 'ast') => {
    reindexAbortRef.current = false;
    setReindexBusy(mode);
    setReindexMsg(mode === 'ast' ? 'Re-indexing AST…' : 'Queuing chunk reindex…');
    setReindexPct(mode === 'ast' ? 1 : 0);
    setReindexPhase('running');
    const pollId =
      mode === 'ast'
        ? window.setInterval(() => {
            void (async () => {
              try {
                const ws = workspaceId?.trim();
                const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
                const r = await fetch(`/api/settings/workspace/code-index-status${qp}`, {
                  credentials: 'same-origin',
                });
                const j = (await r.json().catch(() => ({}))) as {
                  chunk_index?: { job?: { progress_percent?: number } };
                };
                const jobPct = Number(j.chunk_index?.job?.progress_percent);
                if (Number.isFinite(jobPct) && jobPct > 0) {
                  setReindexPct((prev) => Math.max(prev, Math.min(100, jobPct)));
                }
              } catch {
                /* ignore poll errors */
              }
            })();
          }, 2500)
        : 0;
    try {
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      if (mode === 'chunks') {
        const res = await fetch(`/api/settings/workspace/reindex${qp}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || j.ok === false) {
          setReindexPhase('error');
          setReindexMsg(typeof j.error === 'string' ? j.error : 'Chunk reindex failed');
          return;
        }
        setReindexPhase('ok');
        setReindexPct(100);
        setReindexMsg('Chunk reindex queued');
        return;
      }

      let resume = true;
      let guard = 0;
      let embedded = 0;
      let cancelled = false;
      while (resume && guard < 80) {
        if (reindexAbortRef.current) {
          cancelled = true;
          break;
        }
        guard += 1;
        const res = await fetch(`/api/settings/workspace/reindex${qp}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'ast' }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          ast?: {
            run?: {
              complete?: boolean;
              resume?: boolean;
              cancelled?: boolean;
              embedded?: number;
              offset?: number;
              total?: number;
            };
          };
        };
        if (reindexAbortRef.current || j.ast?.run?.cancelled) {
          cancelled = true;
          break;
        }
        if (!res.ok || j.ok === false) {
          setReindexPhase('error');
          setReindexMsg(typeof j.error === 'string' ? j.error : 'AST reindex failed');
          return;
        }
        const run = j.ast?.run;
        embedded += Number(run?.embedded) || 0;
        const total = Number(run?.total) || 0;
        const offset = Number(run?.offset) || 0;
        const pct = total > 0 ? Math.min(100, Math.round((offset / total) * 100)) : run?.complete ? 100 : 5;
        setReindexPct((prev) => Math.max(prev, pct));
        setReindexMsg(
          run?.complete
            ? `Done · ${embedded} symbols`
            : `Embedding… ${offset}/${total || '—'} (${pct}%)`,
        );
        resume = !!run?.resume && !run?.complete;
        if (run?.complete) break;
      }
      if (cancelled || reindexAbortRef.current) {
        setReindexPhase('idle');
        setReindexMsg(`Cancelled · progress kept (${embedded} embedded this run)`);
        return;
      }
      setReindexPhase('ok');
      setReindexPct(100);
      setReindexMsg(`AST updated · ${embedded} symbols this run`);
    } catch (e) {
      setReindexPhase('error');
      setReindexMsg(e instanceof Error ? e.message : 'Reindex failed');
    } finally {
      if (pollId) window.clearInterval(pollId);
      reindexAbortRef.current = false;
      setReindexBusy(null);
      void loadWorkspace();
    }
  }, [workspaceId, loadWorkspace]);

  const cancelWorkspaceReindex = useCallback(async () => {
    if (reindexBusy !== 'ast') return;
    reindexAbortRef.current = true;
    setReindexMsg('Cancelling…');
    try {
      const ws = workspaceId?.trim();
      const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';
      await fetch(`/api/settings/workspace/reindex/cancel${qp}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'cancelled_from_settings' }),
      });
    } catch {
      /* loop stops on next check */
    }
  }, [reindexBusy, workspaceId]);

  const patchHookActive = useCallback(
    async (hookId: string, v: boolean, prev: { hooks: any[]; executions: any[] } | null) => {
      setHooksData((p) =>
        p
          ? {
              ...p,
              hooks: p.hooks.map((x) =>
                String(x.id) === String(hookId) ? { ...x, is_active: v ? 1 : 0 } : x,
              ),
            }
          : p,
      );
      try {
        await fetch(`/api/settings/hooks/${encodeURIComponent(String(hookId))}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: v ? 1 : 0 }),
        });
      } catch {
        setHooksData(prev);
      }
    },
    [],
  );

  const deleteHook = useCallback(async (hookId: string, prev: { hooks: any[]; executions: any[] } | null) => {
    setHooksData((p) => (p ? { ...p, hooks: p.hooks.filter((x) => String(x.id) !== String(hookId)) } : p));
    try {
      await fetch(`/api/settings/hooks/${encodeURIComponent(String(hookId))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {
      setHooksData(prev);
    }
  }, []);

  const createHook = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/hooks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newHookDraft }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
      setNewHookOpen(false);
      setNewHookDraft({ trigger: 'pre_tool_call', command: '', provider: 'system' });
      await loadHooks();
    } catch (e) {
      setHooksError2(e instanceof Error ? e.message : 'Save failed');
    }
  }, [newHookDraft, loadHooks]);

  const revokeSession = useCallback(
    async (sessionId: string, prev: any[]) => {
      try {
        await fetch(`/api/settings/security/sessions/${encodeURIComponent(String(sessionId))}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
      } catch {
        setSessions(prev);
      }
    },
    [],
  );

  const revokeOtherSessions = useCallback(async () => {
    const toRevoke = sessions.slice(1);
    for (const s of toRevoke) {
      await fetch(`/api/settings/security/sessions/${encodeURIComponent(String(s.id))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      }).catch(() => null);
    }
    void loadSecurity();
  }, [sessions, loadSecurity]);

  useEffect(() => {
    const opt = { credentials: 'same-origin' as const };
    fetch('/api/settings/profile', opt)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          display_name?: string;
          email?: string;
          plan?: string | null;
          worker_base_url?: string;
          flat?: { display_name?: string; primary_email?: string };
        } | null) => {
          if (!d || typeof d !== 'object') return;
          const email = String(d.email ?? d.flat?.primary_email ?? '').trim();
          const dn = String(d.display_name ?? d.flat?.display_name ?? '').trim();
          const planRaw =
            d.plan != null && String(d.plan).trim() !== '' ? String(d.plan).trim().toLowerCase() : null;
          setProfileEmail(email);
          setProfileDisplayName(dn || (email.includes('@') ? email.split('@')[0] : email) || '');
          setProfilePlan(planRaw);
          setWorkerBaseUrl(typeof d.worker_base_url === 'string' ? d.worker_base_url.trim() : '');
        },
      )
      .catch(() => {
        setProfileEmail('');
        setProfileDisplayName('');
        setProfilePlan(null);
        setWorkerBaseUrl('');
      });

    fetch('/api/auth/me', opt)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Record<string, unknown> | null) => {
        if (!d || typeof d !== 'object') {
          setUser(null);
          return;
        }
        setUser({
          email: d.email != null ? String(d.email) : null,
          passwordMethod:
            d.passwordMethod != null && String(d.passwordMethod).trim() !== ''
              ? String(d.passwordMethod)
              : undefined,
          passwordUpdatedAt: d.passwordUpdatedAt != null ? String(d.passwordUpdatedAt) : null,
          provider: d.provider != null ? String(d.provider) : null,
        });
      })
      .catch(() => setUser(null));

    refreshLlmKeys();

    fetch('/api/integrations/github/repos', opt)
      .then((r) => r.json())
      .then((d: unknown) => {
        if (!Array.isArray(d)) {
          setRepos([]);
          return;
        }
        setRepos(
          d.map((r: Record<string, unknown>, i: number) => ({
            id: typeof r.id === 'number' ? r.id : i,
            repo_full_name: String(r.full_name || r.name || `repo_${i}`),
            repo_url: String(r.html_url || ''),
            default_branch: String(r.default_branch || 'main'),
            cloudflare_worker_name: '',
            is_active: 1,
          })),
        );
      })
      .catch(() => setRepos([]));
  }, [refreshLlmKeys]);

  useEffect(() => {
    if (activeSection !== 'Agents') return;
    void loadAgentsSettings(workspaceId);
  }, [activeSection, workspaceId, loadAgentsSettings]);

  useEffect(() => {
    if (activeSection !== 'AI Models') return;
    void loadModelsSettings(workspaceId);
  }, [activeSection, workspaceId, loadModelsSettings]);

  useEffect(() => {
    if (activeSection !== 'Tools & MCP') return;
    void loadMcpSettings();
  }, [activeSection, loadMcpSettings]);

  useEffect(() => {
    if (activeSection !== 'Rules & Skills') return;
    if (rulesSkillsTab === 'skills') void loadSkills();
    if (rulesSkillsTab === 'subagents') void loadSubagents();
    if (rulesSkillsTab === 'commands') void loadCommands2();
    if (rulesSkillsTab === 'rules') void loadRules();
  }, [activeSection, rulesSkillsTab, loadSkills, loadSubagents, loadCommands2, loadRules]);

  useEffect(() => {
    if (activeSection !== 'Workspace') return;
    void loadWorkspace();
  }, [activeSection, workspaceId, loadWorkspace]);

  useEffect(() => {
    if (activeSection !== 'Hooks') return;
    void loadHooks();
  }, [activeSection, loadHooks]);

  useEffect(() => {
    if (activeSection !== 'Security') return;
    void loadSecurity();
  }, [activeSection, loadSecurity]);

  useEffect(() => {
    if (activeSection !== 'Plan & Usage') return;
    void loadUsage(usagePage, usageProvider, usageModel);
    void loadNotifications();
    void loadBillingPlans();
    void loadBillingSubscription();
    void loadBillingInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror legacy panel
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'Notifications') return;
    void loadNotifications();
  }, [activeSection, loadNotifications]);

  return {
    defaultAgentsPolicy,

    profileDisplayName,
    profileEmail,
    profilePlan,
    workerBaseUrl,

    settingsModels,
    setSettingsModels,
    modelsLoading,
    modelsError,
    mcpToggleError,
    setMcpToggleError,
    modelOptions,
    patchTierDebounced,
    toggleModelField,
    loadModelsSettings,

    skillsLoading,
    skillsError,
    skills,
    setSkills,
    skillDrawerOpen,
    setSkillDrawerOpen,
    editingSkill,
    setEditingSkill,
    skillDraft,
    setSkillDraft,
    patchSkillActive,
    saveSkillDrawer,

    subagentsLoading,
    subagentsError,
    subagents,
    setSubagents,
    editingSubagentId,
    subagentDraft,
    setSubagentDraft,
    openEditSubagent,
    closeSubagentEdit,
    patchSubagentActive,
    startCreateSubagent,
    startCreateSubagentViaChat,
    deleteSubagent,
    saveSubagentEdit,

    commandsLoading2,
    commandsError2,
    commands2,
    setCommands2,
    expandedCommandId,
    setExpandedCommandId,
    patchCommandActive,

    rulesLoading,
    rulesError,
    rules,
    setRules,
    ruleDrawerOpen,
    setRuleDrawerOpen,
    ruleDraft,
    setRuleDraft,
    patchRuleActive,
    openNewRuleDrawer,
    openEditRuleDrawer,
    saveRuleDrawer,
    deleteRule,

    workspaceLoading2,
    workspaceError2,
    workspaceData,
    postWorkspaceReindex,
    cancelWorkspaceReindex,
    reindexBusy,
    reindexPhase,
    reindexPct,
    reindexMsg,
    patchWorkspaceCmsPipeline,

    hooksLoading2,
    hooksError2,
    hooksData,
    setHooksData,
    newHookOpen,
    setNewHookOpen,
    newHookDraft,
    setNewHookDraft,
    patchHookActive,
    deleteHook,
    createHook,

    sessionsLoading,
    sessionsError,
    sessions,
    setSessions,
    findings,
    loadSecurity,
    revokeSession,
    revokeOtherSessions,

    usageLoading,
    usageError,
    setUsageError,
    usagePage,
    setUsagePage,
    usageProvider,
    setUsageProvider,
    usageModel,
    setUsageModel,
    usageData,
    loadUsage,

    billingPlans,
    billingCoupons,
    billingPlansLoading,
    billingPlansError,
    activeSubscription,
    subscriptionLoading,
    billingInvoices,
    billingInvoicesLoading,
    billingInvoicesError,
    loadBillingPlans,
    loadBillingSubscription,
    loadBillingInvoices,
    startCheckout,
    openBillingPortal,

    notifyLoading,
    notifyError,
    notifyPrefs,
    setNotifyPrefs,
    budgetMonthlyLimit,
    setBudgetMonthlyLimit,
    budgetHardStop,
    setBudgetHardStop,
    patchProfile,
    loadNotifications,

    agentsLoading,
    agentsSaving,
    agentsError,
    agentsWorkspaceId,
    agentsPolicy,
    setAgentsPolicy,
    agentsCommands,
    agentsDomains,
    agentsMcp,
    agentsMcpGroups,
    agentsMcpGroupPrefs,
    setAgentsMcpGroupPrefs,
    saveAgentsMcpGroupPreferences,
    newCommand,
    setNewCommand,
    newDomain,
    setNewDomain,
    newToolKey,
    setNewToolKey,
    loadAgentsSettings,
    saveAgentsPolicy,
    addAgentsCommand,
    addAgentsCommandsBulk,
    removeAgentsCommand,
    addAgentsDomain,
    removeAgentsDomain,
    addAgentsMcp,
    removeAgentsMcp,
    agentsSubagents,
    patchAgentsSubagent,

    settingsMcp,
    setSettingsMcp,
    loadMcpSettings,
    toggleMcpRegisteredTool,

    repos,

    llmKeys,
    llmBusy,
    vaultProvider,
    setVaultProvider,
    vaultKeyValue,
    setVaultKeyValue,
    removeLlmKey,
    saveVaultKeyFromSecurity,
    refreshLlmKeys,

    user,
  };
}

export type SettingsPanelModel = ReturnType<typeof useSettingsData>;
