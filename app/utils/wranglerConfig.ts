import { RuntimeBinding, D1Binding, KVBinding, R2Binding, DurableObjectBinding, WorkersAIBinding, BrowserBinding, VectorizeBinding, QueueBinding, WorkflowBinding, ServiceBinding, AnalyticsEngineBinding, EnvVarBinding, SecretBinding } from '../types/bindings';

export interface WranglerSyncResult {
  bindings: RuntimeBinding[];
  error: string | null;
  warning?: string;
}

/**
 * Serializes typed RuntimeBinding array into standard Cloudflare `wrangler.jsonc` format
 */
export function generateWranglerJsonc(
  bindings: RuntimeBinding[],
  projectName: string = 'agentsam-worker',
  mainEntry: string = 'src/index.ts',
  compatibilityDate: string = '2026-04-01'
): string {
  const activeBindings = bindings.filter(b => b.enabled);

  const configObj: Record<string, any> = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: projectName,
    main: mainEntry,
    compatibility_date: compatibilityDate,
    compatibility_flags: ['nodejs_compat', 'experimental'],
    observability: {
      enabled: true,
      head_sampling_rate: 1,
    },
  };

  // 1. Workers AI
  const ai = activeBindings.find(b => b.family === 'ai') as WorkersAIBinding | undefined;
  if (ai) {
    configObj.ai = {
      binding: ai.binding || 'AI',
    };
  }

  // 2. Browser / Browser Run
  const browser = activeBindings.find(b => b.family === 'browser') as BrowserBinding | undefined;
  if (browser) {
    configObj.browser = {
      binding: browser.binding || 'MYBROWSER',
    };
  }

  // 3. D1 Databases
  const d1List = activeBindings.filter(b => b.family === 'd1') as D1Binding[];
  if (d1List.length > 0) {
    configObj.d1_databases = d1List.map(d => ({
      binding: d.binding,
      database_name: d.database_name,
      database_id: d.database_id,
      migrations_dir: d.migrations_dir || './d1/migrations',
      ...(d.preview_database_id ? { preview_database_id: d.preview_database_id } : {}),
    }));
  }

  // 4. KV Namespaces
  const kvList = activeBindings.filter(b => b.family === 'kv') as KVBinding[];
  if (kvList.length > 0) {
    configObj.kv_namespaces = kvList.map(k => ({
      binding: k.binding,
      id: k.namespace_id,
      ...(k.preview_id ? { preview_id: k.preview_id } : {}),
    }));
  }

  // 5. R2 Buckets
  const r2List = activeBindings.filter(b => b.family === 'r2') as R2Binding[];
  if (r2List.length > 0) {
    configObj.r2_buckets = r2List.map(r => ({
      binding: r.binding,
      bucket_name: r.bucket_name,
      ...(r.preview_bucket_name ? { preview_bucket_name: r.preview_bucket_name } : {}),
      ...(r.jurisdiction && r.jurisdiction !== 'default' ? { jurisdiction: r.jurisdiction } : {}),
    }));
  }

  // 6. Durable Objects
  const doList = activeBindings.filter(b => b.family === 'durable_object') as DurableObjectBinding[];
  if (doList.length > 0) {
    configObj.durable_objects = {
      bindings: doList.map(d => ({
        name: d.binding,
        class_name: d.class_name,
        ...(d.script_name ? { script_name: d.script_name } : {}),
        ...(d.environment ? { environment: d.environment } : {}),
      })),
    };
  }

  // 7. Vectorize
  const vecList = activeBindings.filter(b => b.family === 'vectorize') as VectorizeBinding[];
  if (vecList.length > 0) {
    configObj.vectorize = vecList.map(v => ({
      binding: v.binding,
      index_name: v.index_name,
    }));
  }

  // 8. Queues
  const queueList = activeBindings.filter(b => b.family === 'queue') as QueueBinding[];
  if (queueList.length > 0) {
    configObj.queues = {
      producers: queueList.filter(q => q.role !== 'consumer').map(q => ({
        binding: q.binding,
        queue: q.queue_name,
      })),
      consumers: queueList.filter(q => q.role === 'consumer').map(q => ({
        queue: q.queue_name,
        max_batch_size: q.max_batch_size || 10,
        max_batch_timeout: q.max_batch_timeout || 5,
      })),
    };
    if (configObj.queues.producers.length === 0) delete configObj.queues.producers;
    if (configObj.queues.consumers.length === 0) delete configObj.queues.consumers;
  }

  // 9. Workflows
  const wfList = activeBindings.filter(b => b.family === 'workflow') as WorkflowBinding[];
  if (wfList.length > 0) {
    configObj.workflows = wfList.map(w => ({
      name: w.name,
      binding: w.binding,
      class_name: w.class_name,
      ...(w.script_name ? { script_name: w.script_name } : {}),
    }));
  }

  // 10. Service Bindings
  const svcList = activeBindings.filter(b => b.family === 'service') as ServiceBinding[];
  if (svcList.length > 0) {
    configObj.services = svcList.map(s => ({
      binding: s.binding,
      service: s.service,
      ...(s.service_environment ? { environment: s.service_environment } : {}),
      ...(s.entrypoint ? { entrypoint: s.entrypoint } : {}),
    }));
  }

  // 11. Analytics Engine
  const aeList = activeBindings.filter(b => b.family === 'analytics_engine') as AnalyticsEngineBinding[];
  if (aeList.length > 0) {
    configObj.analytics_engine_datasets = aeList.map(a => ({
      binding: a.binding,
      dataset: a.dataset,
    }));
  }

  // 12. Environment Variables
  const varsList = activeBindings.filter(b => b.family === 'vars') as EnvVarBinding[];
  if (varsList.length > 0) {
    configObj.vars = {};
    varsList.forEach(v => {
      configObj.vars[v.name || v.binding] = v.value;
    });
  }

  // 13. Secrets (Documented in comments & encrypted vault refs)
  const secretsList = activeBindings.filter(b => b.family === 'secrets') as SecretBinding[];
  
  // Format into clean JSONC with comments
  const formattedJson = JSON.stringify(configObj, null, 2);

  let headerComments = `/**
 * AgentSam Sovereign Cloudflare Worker Configuration
 * Auto-synchronized with Live Bindings & Runtime Engine
 * 
 * Generated: ${new Date().toISOString()}
 * Active Bindings: ${activeBindings.length} (${bindings.length} configured)
 */\n`;

  let result = headerComments + formattedJson;

  if (secretsList.length > 0) {
    result += `\n\n// 🔐 Cloudflare Secrets (Managed via \`wrangler secret put <KEY>\` or Cloudflare Dashboard):\n`;
    secretsList.forEach(s => {
      result += `// - ${s.name || s.binding}: ${s.secret_ref || '[Encrypted in Cloudflare Secret Store]'}\n`;
    });
  }

  return result;
}

/**
 * Strips comments from JSONC string safely to allow JSON.parse
 */
export function stripJsoncComments(jsonc: string): string {
  return jsonc
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove multi-line comments
    .replace(/\/\/.*$/gm, '')           // remove single-line comments
    .trim();
}

/**
 * Parses a raw wrangler.jsonc or JSON string back into a typed RuntimeBinding[] array
 */
export function parseWranglerJsoncToBindings(
  rawText: string,
  existingBindings: RuntimeBinding[] = []
): WranglerSyncResult {
  try {
    const stripped = stripJsoncComments(rawText);
    if (!stripped) {
      return { bindings: existingBindings, error: 'Empty configuration text' };
    }

    const data = JSON.parse(stripped);
    const parsed: RuntimeBinding[] = [];

    // 1. AI
    if (data.ai) {
      parsed.push({
        id: `bind-ai-${Date.now()}-1`,
        family: 'ai',
        binding: data.ai.binding || 'AI',
        enabled: true,
        environment: 'all',
        description: 'Workers AI Gateway',
        status: 'active',
        model_routing: 'auto',
      });
    }

    // 2. Browser
    if (data.browser) {
      parsed.push({
        id: `bind-browser-${Date.now()}-1`,
        family: 'browser',
        binding: data.browser.binding || 'MYBROWSER',
        enabled: true,
        environment: 'all',
        description: 'Browser verification lane',
        status: 'active',
        engine: 'kitesurf_worker',
      });
    }

    // 3. D1 Databases
    if (Array.isArray(data.d1_databases)) {
      data.d1_databases.forEach((d: any, idx: number) => {
        parsed.push({
          id: `bind-d1-${Date.now()}-${idx}`,
          family: 'd1',
          binding: d.binding || `DB_${idx + 1}`,
          database_name: d.database_name || 'app_db',
          database_id: d.database_id || '',
          migrations_dir: d.migrations_dir || './d1/migrations',
          preview_database_id: d.preview_database_id,
          enabled: true,
          environment: 'all',
          description: `D1 Database (${d.database_name || d.binding})`,
          status: d.database_id ? 'bound' : 'configured',
        });
      });
    }

    // 4. KV Namespaces
    if (Array.isArray(data.kv_namespaces)) {
      data.kv_namespaces.forEach((k: any, idx: number) => {
        parsed.push({
          id: `bind-kv-${Date.now()}-${idx}`,
          family: 'kv',
          binding: k.binding || `KV_${idx + 1}`,
          namespace_id: k.id || '',
          preview_id: k.preview_id,
          enabled: true,
          environment: 'all',
          description: `KV Namespace (${k.binding})`,
          status: k.id ? 'bound' : 'configured',
        });
      });
    }

    // 5. R2 Buckets
    if (Array.isArray(data.r2_buckets)) {
      data.r2_buckets.forEach((r: any, idx: number) => {
        parsed.push({
          id: `bind-r2-${Date.now()}-${idx}`,
          family: 'r2',
          binding: r.binding || `BUCKET_${idx + 1}`,
          bucket_name: r.bucket_name || '',
          preview_bucket_name: r.preview_bucket_name,
          jurisdiction: r.jurisdiction || 'default',
          enabled: true,
          environment: 'all',
          description: `R2 Bucket (${r.bucket_name || r.binding})`,
          status: r.bucket_name ? 'bound' : 'configured',
        });
      });
    }

    // 6. Durable Objects
    if (data.durable_objects && Array.isArray(data.durable_objects.bindings)) {
      data.durable_objects.bindings.forEach((d: any, idx: number) => {
        parsed.push({
          id: `bind-do-${Date.now()}-${idx}`,
          family: 'durable_object',
          binding: d.name || d.binding || `DO_${idx + 1}`,
          class_name: d.class_name || 'MyDurableObject',
          script_name: d.script_name,
          target_environment: d.environment,
          enabled: true,
          environment: 'all',
          description: `Durable Object (${d.class_name})`,
          status: 'configured',
        });
      });
    }

    // 7. Vectorize
    if (Array.isArray(data.vectorize)) {
      data.vectorize.forEach((v: any, idx: number) => {
        parsed.push({
          id: `bind-vec-${Date.now()}-${idx}`,
          family: 'vectorize',
          binding: v.binding || `VECTOR_${idx + 1}`,
          index_name: v.index_name || '',
          dimensions: 1536,
          metric: 'cosine',
          enabled: true,
          environment: 'all',
          description: `Vectorize Index (${v.index_name || v.binding})`,
          status: v.index_name ? 'bound' : 'configured',
        });
      });
    }

    // 8. Queues
    if (data.queues) {
      if (Array.isArray(data.queues.producers)) {
        data.queues.producers.forEach((q: any, idx: number) => {
          parsed.push({
            id: `bind-q-prod-${Date.now()}-${idx}`,
            family: 'queue',
            binding: q.binding || `QUEUE_${idx + 1}`,
            queue_name: q.queue || '',
            role: 'producer',
            enabled: true,
            environment: 'all',
            description: `Queue Producer (${q.queue})`,
            status: 'bound',
          });
        });
      }
    }

    // 9. Workflows
    if (Array.isArray(data.workflows)) {
      data.workflows.forEach((w: any, idx: number) => {
        parsed.push({
          id: `bind-wf-${Date.now()}-${idx}`,
          family: 'workflow',
          binding: w.binding || `WORKFLOW_${idx + 1}`,
          name: w.name || '',
          class_name: w.class_name || 'MyWorkflow',
          script_name: w.script_name,
          enabled: true,
          environment: 'all',
          description: `Workflow (${w.name})`,
          status: 'configured',
        });
      });
    }

    // 10. Services
    if (Array.isArray(data.services)) {
      data.services.forEach((s: any, idx: number) => {
        parsed.push({
          id: `bind-svc-${Date.now()}-${idx}`,
          family: 'service',
          binding: s.binding || `SERVICE_${idx + 1}`,
          service: s.service || '',
          service_environment: s.environment,
          entrypoint: s.entrypoint,
          enabled: true,
          environment: 'all',
          description: `Service Binding (${s.service})`,
          status: 'bound',
        });
      });
    }

    // 11. Analytics Engine
    if (Array.isArray(data.analytics_engine_datasets)) {
      data.analytics_engine_datasets.forEach((a: any, idx: number) => {
        parsed.push({
          id: `bind-ae-${Date.now()}-${idx}`,
          family: 'analytics_engine',
          binding: a.binding || `AE_${idx + 1}`,
          dataset: a.dataset || '',
          enabled: true,
          environment: 'all',
          description: `Analytics Engine (${a.dataset})`,
          status: 'active',
        });
      });
    }

    // 12. Vars
    if (data.vars && typeof data.vars === 'object') {
      Object.entries(data.vars).forEach(([key, val], idx) => {
        parsed.push({
          id: `bind-var-${Date.now()}-${idx}`,
          family: 'vars',
          binding: key,
          name: key,
          value: String(val),
          enabled: true,
          environment: 'all',
          description: `Environment Variable (${key})`,
          status: 'active',
        });
      });
    }

    // Preserve existing secrets if any (since they are in comments/dashboard)
    const existingSecrets = existingBindings.filter(b => b.family === 'secrets');
    existingSecrets.forEach(s => {
      if (!parsed.some(p => p.binding === s.binding)) {
        parsed.push(s);
      }
    });

    return {
      bindings: parsed,
      error: null,
    };
  } catch (err: any) {
    return {
      bindings: existingBindings,
      error: `Syntax Error in Wrangler Config: ${err.message || String(err)}`,
    };
  }
}
