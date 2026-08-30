import type { AgentWorkspaceContextPacket } from '../src/ideWorkspace';

export type DashboardRouteQuickAction = {
  id: string;
  label: string;
  message: string;
  route_key?: string;
  task_type?: string;
};

export type DashboardRouteAgentContext = {
  route_key: string;
  /** When set, composer POSTs this as body.task_type (classifier skipped). */
  task_type?: string;
  context_label: string;
  contextMode: string;
  workspaceContext: Partial<AgentWorkspaceContextPacket>;
  quickActions: DashboardRouteQuickAction[];
};

function normalizePath(pathname: string): string {
  const p = String(pathname || '').trim() || '/dashboard/agent';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/**
 * Route-aware AgentSam context — Cursor-equivalent wiring per /dashboard/* surface.
 */
export function resolveDashboardRouteAgentContext(opts: {
  pathname: string;
  search?: string;
  workspaceId?: string | null;
  activeTab?: string;
  browserUrl?: string | null;
  openFiles?: string[];
  planId?: string | null;
}): DashboardRouteAgentContext {
  const path = normalizePath(opts.pathname);
  const search = opts.search || '';
  const basePacket: Partial<AgentWorkspaceContextPacket> = {
    activeTab: opts.activeTab || 'Workspace',
    browserUrl: opts.browserUrl?.trim() || null,
    openFiles: opts.openFiles || [],
    plan_id: opts.planId || null,
    workflow_run_id: null,
  };

  if (path.startsWith('/dashboard/cms')) {
    return {
      route_key: 'cms',
      context_label: 'CMS',
      contextMode: 'cms',
      workspaceContext: { ...basePacket, activeTab: 'cms', capabilities: ['cms'] },
      quickActions: [],
    };
  }

  if (path.startsWith('/dashboard/designstudio')) {
    return {
      route_key: 'design_studio',
      task_type: 'design_studio_base',
      context_label: 'Design Studio',
      contextMode: 'design_studio',
      workspaceContext: basePacket,
      quickActions: [
        {
          id: 'ds-scene',
          label: 'Scene help',
          message: 'Help me with the active Design Studio scene — materials, lighting, and export.',
          route_key: 'design_studio',
          task_type: 'design_studio_base',
        },
      ],
    };
  }

  if (path.startsWith('/dashboard/draw')) {
    const planMode = (() => {
      try {
        const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        return q.get('from') === 'designstudio' && q.get('mode') === 'plan';
      } catch {
        return false;
      }
    })();
    return {
      route_key: 'visual_canvas',
      task_type: 'visual_canvas',
      context_label: planMode ? 'Draw · Plan sketch' : 'Draw · Excalidraw',
      contextMode: 'visual_canvas',
      workspaceContext: {
        ...basePacket,
        activeTab: 'excalidraw',
        capabilities: ['excalidraw', 'illustration', 'visual_canvas'],
        linked_route: path + (search || ''),
      },
      quickActions: [
        {
          id: 'draw-flowchart',
          label: 'Flowchart',
          message:
            'Help me sketch a flowchart on Excalidraw. Ask 2–4 short questions first, then use illustration_create (engine excalidraw) — never ASCII art.',
          route_key: 'visual_canvas',
          task_type: 'visual_canvas',
        },
        {
          id: 'draw-wireframe',
          label: 'Wireframe',
          message:
            'Help me build a lo-fi UI wireframe on the Draw canvas. Ask which screen and device, then use illustration_create with intent wireframe.',
          route_key: 'visual_canvas',
          task_type: 'visual_canvas',
        },
      ],
    };
  }

  if (path.startsWith('/dashboard/sketch')) {
    return {
      route_key: 'visual_canvas',
      task_type: 'visual_canvas',
      context_label: 'Sketch',
      contextMode: 'visual_canvas',
      workspaceContext: {
        ...basePacket,
        activeTab: 'sketch',
        capabilities: ['sketch', 'wireframe', 'blueprint', 'visual_canvas'],
        linked_route: path + (search || ''),
      },
      quickActions: [
        {
          id: 'sketch-layout',
          label: 'Layout',
          message:
            'Help me build a lo-fi interface in Sketch. Ask which screen and device, then guide the layout on the canvas.',
          route_key: 'visual_canvas',
          task_type: 'visual_canvas',
        },
        {
          id: 'sketch-blueprint',
          label: 'Blueprint',
          message:
            'Help me refine the active floor-plan blueprint in Sketch. Ask what dimensions, rooms, and constraints matter first.',
          route_key: 'visual_canvas',
          task_type: 'visual_canvas',
        },
      ],
    };
  }

  if (path.startsWith('/dashboard/database')) {
    return {
      route_key: 'database_studio',
      context_label: 'Database Studio',
      contextMode: 'database',
      workspaceContext: basePacket,
      quickActions: [
        {
          id: 'db-schema',
          label: 'Schema overview',
          message: 'Summarize the schema for my connected database in this workspace.',
          route_key: 'database_studio',
          task_type: 'database_schema',
        },
      ],
    };
  }

  if (path.startsWith('/dashboard/workflows')) {
    return {
      route_key: 'workflows',
      context_label: 'Workflows',
      contextMode: 'workflows',
      workspaceContext: basePacket,
      quickActions: [],
    };
  }

  if (path.startsWith('/dashboard/agent/editor') || path.startsWith('/dashboard/agent/workspace')) {
    return {
      route_key: 'agent_code',
      context_label: path.startsWith('/dashboard/agent/editor') ? 'Agent · Editor' : 'Agent · Workspace',
      contextMode: 'agent_code',
      workspaceContext: basePacket,
      quickActions: [
        {
          id: 'agent-code-scratch',
          label: 'Scratch file edit',
          message:
            'List files matching a path I specify, then make a small test edit under .scratch/ and show the diff.',
          route_key: 'agent_code',
          task_type: 'code',
        },
      ],
    };
  }

  if (path.startsWith('/dashboard/agent')) {
    return {
      route_key: 'agent_sam',
      context_label: 'Agent Sam',
      contextMode: 'agent',
      workspaceContext: basePacket,
      quickActions: [],
    };
  }

  if (path.startsWith('/dashboard/mail')) {
    return {
      route_key: 'mail_triage',
      context_label: 'Collaborate · Mail',
      contextMode: 'mail',
      workspaceContext: {
        ...basePacket,
        linked_route: path + (search || ''),
        capabilities: ['mail', 'gmail'],
      },
      quickActions: [
        {
          id: 'mail-triage-inbox',
          label: 'Triage inbox',
          message:
            'Triage my visible inbox: what needs a reply, what can wait, and what should I archive?',
          route_key: 'mail_triage',
          task_type: 'mail_triage',
        },
        {
          id: 'mail-summarize-unread',
          label: 'Summarize unread',
          message: 'Summarize my unread inbox messages from the last 24 hours.',
          route_key: 'mail_triage',
          task_type: 'mail_triage',
        },
      ],
    };
  }

  if (path.startsWith('/dashboard/collaborate')) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const seg = params.get('seg');
    const list = params.get('list');
    const project = params.get('project');
    const contextBits = [
      seg === 'tasks' ? 'Tasks workspace' : 'Calendar workspace',
      list ? `list:${list}` : null,
      project ? `project:${project}` : null,
    ].filter(Boolean);
    return {
      route_key: seg === 'tasks' ? 'collaborate_tasks' : 'collaborate_calendar',
      context_label: contextBits.join(' · ') || 'Collaborate',
      contextMode: 'collaborate',
      workspaceContext: {
        ...basePacket,
        linked_route: path + (search || ''),
        capabilities: ['tasks', 'calendar', 'time_insights'],
      },
      quickActions: [
        {
          id: 'colab-idea-to-task',
          label: 'Turn idea into task',
          message:
            'I have a rough idea for work today. Help me turn it into a clear, actionable task with a title, details, and optional due date. Use agentsam_todo_add when ready.',
          route_key: 'collaborate_tasks',
          task_type: 'operate',
        },
        {
          id: 'colab-plan-today',
          label: "Plan today's tasks",
          message:
            "Help me plan today's work: break my goals into 3–5 concrete tasks in My Tasks, suggest projects to link, and note what to time-box on the calendar.",
          route_key: 'collaborate_tasks',
          task_type: 'operate',
        },
        {
          id: 'colab-breakdown',
          label: 'Break down a goal',
          message:
            'Break this goal into subtasks I can track in collaborate tasks. Ask what project they belong to if unclear.',
          route_key: 'collaborate_tasks',
          task_type: 'operate',
        },
      ],
    };
  }

  return {
    route_key: 'dashboard',
    context_label: 'Dashboard',
    contextMode: 'dashboard',
    workspaceContext: basePacket,
    quickActions: [],
  };
}
