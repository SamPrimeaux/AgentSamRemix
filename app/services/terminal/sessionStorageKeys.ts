/**
 * Browser storage key SSOT — session/project/workspace/repo + related agent context.
 *
 * Rule: declare every key string ONCE here. Readers/writers import from this module
 * (or re-export from a domain helper). Never invent a parallel constant for the same
 * concept in a feature file — that is how sticky-project / ambient-default bugs ship.
 *
 * Lifetime legend:
 *   sessionStorage — tab-scoped; gone on tab close
 *   localStorage   — survives restarts (user prefs / caches)
 *   indexedDB      — File System Access handles (not product workspace ids)
 *
 * --- Cluster audit (2026-08-13) ---
 *
 * PROJECT — two intentional keys, different lifetimes (NOT the same concept):
 *   SESSION_PROJECT_*  — chat-ephemeral bind; wiped by applyFreshChatSessionDefaults
 *   EXECUTION_PROJECT_* — project-activate pin; survives fresh-chat wipe
 *   Do not merge without an explicit product migration.
 *
 * WORKSPACE — genuinely different concepts (badly overlapping names historically):
 *   EXECUTION_WORKSPACE_ID — projects.activate execution lane (sessionStorage)
 *   IAM_WORKSPACE_*        — cached workspace list + user pin (localStorage / legacy ss)
 *   LOCAL_DIR_HANDLE_*     — IndexedDB File System Access handle (NOT a product ws_*)
 *
 * EXEC LANE — dock only:
 *   LS_TERMINAL_WS_PREFS[workspaceId].targetType → exec_lane on chat send
 *   Flat mobile-era exec-lane localStorage mirror is banned (guard:terminal-lane-ssot).
 *
 * FS MODES — D1 feature_flags only:
 *   AGENT_SAM_FS_MODES_FLAG_KEY is the bootstrap feature-flag name (not browser storage)
 */

// ─── Chat session: project bind (ephemeral) ─────────────────────────────────
/** sessionStorage. Active chat project id. Writer: freshChatSession.writeSessionProject. Cleared on fresh chat. */
export const SESSION_PROJECT_ID_KEY = 'iam:session-project-id';
/** sessionStorage. Display name for SESSION_PROJECT_ID_KEY. Writer: freshChatSession.writeSessionProject. */
export const SESSION_PROJECT_NAME_KEY = 'iam:session-project-name';

/** sessionStorage. Enabled MCP/OAuth connector provider keys for this chat. Writer: freshChatSession. */
export const SESSION_CONNECTORS_KEY = 'iam:session-enabled-connectors';
/** sessionStorage. Per-provider enabled tool_key map for this chat. Writer: freshChatSession. */
export const SESSION_TOOLS_KEY = 'iam:session-enabled-tools';

// ─── Project activate: execution pin (survives fresh chat) ───────────────────
/** sessionStorage. Execution workspace from POST /api/projects/:id/activate. Writer: activateProjectWorkContext. */
export const EXECUTION_WORKSPACE_ID_KEY = 'iam:execution-workspace-id';
/** sessionStorage. Project id pin that outlives SESSION_PROJECT_* wipe. Writer: activateProjectWorkContext. */
export const EXECUTION_PROJECT_ID_KEY = 'iam:execution-project-id';
/** sessionStorage. Display name for EXECUTION_PROJECT_ID_KEY. Writer: activateProjectWorkContext. */
export const EXECUTION_PROJECT_NAME_KEY = 'iam:execution-project-name';
/** sessionStorage. github owner/repo from project activate bindings. Writer: activateProjectWorkContext. */
export const EXECUTION_GITHUB_REPO_KEY = 'iam:execution-github-repo';

// ─── Product workspace cache / pin (not execution, not local folder) ─────────
/** sessionStorage legacy + localStorage fallback key for workspace list payload. Writer: iamWorkspaceStorage. */
export const IAM_WORKSPACE_SESSION_KEY = 'iam_workspace';
/** localStorage prefix `iam_workspace_v1:{userId}`. Writer: iamWorkspaceStorage.writeIamWorkspaceSession. */
export const IAM_WORKSPACE_LS_PREFIX = 'iam_workspace_v1';
/** localStorage prefix `iam_workspace_user_pin:{userId}` — WorkspaceLauncher choice. Writer: iamWorkspaceStorage. */
export const IAM_WORKSPACE_USER_PIN_PREFIX = 'iam_workspace_user_pin';

/** localStorage prefix `iam_projects_v1:{workspaceId}`. Writer: iamProjectsCache. */
export const IAM_PROJECTS_CACHE_LS_PREFIX = 'iam_projects_v1';

// ─── Local folder (File System Access) — IndexedDB, not product workspace ───
/** IndexedDB database name for persisted directory handles. Writer: useLocalFsaFolder / localHandleStore. */
export const LOCAL_DIR_HANDLE_IDB_NAME = 'iam-agent-native-workspace-v1';
/** IndexedDB object store for directory handles. */
export const LOCAL_DIR_HANDLE_IDB_STORE = 'handles';
/** IndexedDB key inside LOCAL_DIR_HANDLE_IDB_STORE. Value is FileSystemDirectoryHandle. */
export const LOCAL_DIR_HANDLE_IDB_KEY = 'directory';
/** Legacy IndexedDB store for old D1 workspace-id hints — cleared on disconnect; do not write or create. */
export const LOCAL_DIR_HINT_IDB_STORE = 'workspace_hint';
/** Legacy IndexedDB key inside LOCAL_DIR_HINT_IDB_STORE. */
export const LOCAL_DIR_HINT_IDB_KEY = 'last';
/** localStorage. Display name only for last local folder (no path). Writer: useLocalFsaFolder. */
export const LS_LAST_LOCAL_FOLDER_NAME = 'iam_last_local_folder_name';

// ─── GitHub / repo context (chat) ───────────────────────────────────────────
/**
 * localStorage key prefix for chat GitHub context.
 * Per-ws: `${LS_GH_REPO}:{user}:{ws}` · per-chat: `...:chat:{conversationId}`.
 * Writer: ChatAssistant/types writeChatGithubContext.
 */
export const LS_GH_REPO = 'iam-chat-github-repo-context';
/** sessionStorage. Cached GitHub repos list for chat repo picker. Writer: repoPickerCache. */
export const CHAT_GH_REPOS_CACHE_KEY = 'iam-chat-gh-repos-cache-v1';
/** localStorage. Rate-limit backoff until (epoch ms) for GitHub repos fetch. Writer: GitHubExplorer. */
export const GITHUB_REPOS_RL_UNTIL_KEY = 'iam_github_repos_rl_until';
/** sessionStorage. Last git status payload for status bar. Writer: iamGitStatusCache. */
export const IAM_GIT_STATUS_SESSION_KEY = 'iam_git_status';

// ─── Agent chat prefs / thread ──────────────────────────────────────────────
/** localStorage. Persisted Agent Sam conversation id. Writer: App / ChatAssistant / openAgentConversation. */
export const LS_AGENT_CHAT_CONVERSATION_ID = 'iam-agent-chat-conversation-id';
/** localStorage. Composer model key (or AUTO_MODEL_KEY). Writer: ChatAssistant. */
export const LS_AGENT_CHAT_MODEL_KEY = 'iam-agent-chat-model-key';
/** localStorage. Agent / Ask / Plan mode. Writer: ChatAssistant. */
export const LS_AGENT_CHAT_MODE = 'iam-agent-chat-mode';
/** sessionStorage. In-tab chat message draft cache. Writer: App. */
export const SS_AGENT_CHAT_MESSAGES = 'iam-agent-chat-messages-v1';
/** localStorage prefix for composer sources — built by composerSourcesStorageKey(). Writer: composerSourcesStorage. */
export const COMPOSER_SOURCES_KEY_PREFIX = 'iam-chat-composer-sources:v1';
/** localStorage. Voice prefs JSON. Writer: voiceOptions. */
export const VOICE_PREFS_STORAGE_KEY = 'iam_agent_sam_voice_prefs_v1';
/** sessionStorage prefix `iam-chat-outbox-cursor:{turnId}`. Writer: chatTurnOutbox. */
export const CHAT_OUTBOX_CURSOR_SS_PREFIX = 'iam-chat-outbox-cursor:';

// ─── Agent Sam Files pane ───────────────────────────────────────────────────
/** localStorage. Active FS source tab (local|github|r2|…). Writer: agentSamFilesystemTypes.persistAgentSamFsSource. */
export const AGENT_SAM_FS_SOURCE_STORAGE_KEY = 'iam_agent_sam_fs_source_v1';
/**
 * D1 / session feature_flags key for Files|Changes|Snapshot chrome.
 * Not a browser storage write key — name must match bootstrap feature_flags.
 * Reader: agentSamFilesystemTypes.isAgentSamFsModesEnabled.
 */
export const AGENT_SAM_FS_MODES_FLAG_KEY = 'agent_sam_fs_modes_v1';
/** localStorage. Inspection pane width px. Writer: AgentSamFilesystemView. */
export const AGENT_SAM_FS_INSPECTION_WIDTH_KEY = 'iam_agent_sam_fs_inspection_width_v1';

// ─── Terminal workspace prefs (dock lane SSOT) ───────────────────────────────
/** localStorage. Terminal connection prefs JSON incl. targetType per workspace. Writer: terminalWorkspacePrefs. */
export const LS_TERMINAL_WS_PREFS = 'iam_terminal_ws_prefs_v1';
/**
 * localStorage. Per-browser PTY client id (not a lane, not a user id).
 * Writer: ptyClientId.getOrCreatePtyClientId. Isolates phone vs desk DOs.
 */
export const LS_PTY_CLIENT_ID = 'iam_pty_client_id_v1';

// ─── PWA / SW (shared across register + warm) ───────────────────────────────
/** localStorage. Last applied SW cache_bust. Writer: registerServiceWorker / vite inject. */
export const CACHE_BUST_STORAGE_KEY = 'iam_sw_cache_bust';
/** sessionStorage. Tier-2 tab list from SW manifest. Writer: registerServiceWorker. Reader: warmAgentChunks. */
export const TIER2_TABS_SESSION_KEY = 'iam_sw_tier2_tabs';
/** sessionStorage. Current dashboard git sha for freshness checks. Writer: ensureFreshDashboardBundle. */
export const SESSION_DASHBOARD_SHA_KEY = 'iam_dashboard_git_sha';
/** localStorage (+ sessionStorage mirror). Dismissed remote sha for update banner. Writer: ensureFreshDashboardBundle. */
export const DISMISSED_REMOTE_SHA_KEY = 'iam_pwa_update_dismissed_sha';
/** localStorage (+ sessionStorage mirror). User chose "later" on PWA update. Writer: ensureFreshDashboardBundle. iOS PWA drops sessionStorage when backgrounded. */
export const DISMISSED_PWA_UPDATE_ANY_KEY = 'iam_pwa_update_later';
/** localStorage. PWA install coach dismissed. Writer: pwaPlatform. */
export const PWA_INSTALL_COACH_DISMISS_KEY = 'iam_pwa_install_coach_dismissed';
