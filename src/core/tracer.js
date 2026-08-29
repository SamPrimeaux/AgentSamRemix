import { scheduleAgentsamErrorLog } from './agentsam-ops-ledger.js';

/** Default Wrangler `name` — used as OTLP worker_name for rollup dimensions. */
const DEFAULT_WORKER_NAME = 'inneranimalmedia';

function isOtlpTelemetryDebug(env) {
  const v = env?.MCP_TELEMETRY_DEBUG ?? env?.DEBUG_OTLP;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/**
 * OTLP insert failures: debug → stderr; production → agentsam_error_log (no spam).
 * @param {any} env
 * @param {any} ctx
 * @param {unknown} err
 * @param {{ tenant_id?: string, workspace_id?: string, operation_name?: string|null, worker_name?: string|null }} meta
 */
function reportOtlpTraceWriteFailure(env, ctx, err, meta) {
  const msg = err != null && typeof err === 'object' && 'message' in err ? String(err.message) : String(err || 'unknown');
  if (isOtlpTelemetryDebug(env)) {
    console.error('[OTLP-FAIL]', msg);
    return;
  }
  const tid = meta?.tenant_id != null ? String(meta.tenant_id).trim() : '';
  const wid = meta?.workspace_id != null ? String(meta.workspace_id).trim() : '';
  if (env?.DB && tid && wid && ctx?.waitUntil) {
    scheduleAgentsamErrorLog(env, ctx, {
      workspaceId: wid,
      tenantId: tid,
      errorCode: 'otlp_insert_failed',
      errorType: 'otlp_traces',
      errorMessage: msg.slice(0, 8000),
      source: 'recordSpan',
      contextJson: JSON.stringify({
        operation_name: meta?.operation_name ?? null,
        worker_name: meta?.worker_name ?? null,
      }),
    });
    return;
  }
  console.warn('[OTLP-FAIL]', msg);
}

const OTLP_COLS = `id, tenant_id, workspace_id, trace_id, span_id, parent_span_id,
  operation_name, service_name, worker_name, kind,
  status_code, status_message,
  start_time_unix_nano, end_time_unix_nano,
  attributes_json, events_json, resource_json,
  binding_type, binding_name,
  http_method, http_status, http_url,
  d1_query, d1_rows_read, d1_rows_written,
  r2_operation, r2_bucket, r2_key,
  do_class, do_method, batch_id`;

/**
 * Fire-and-forget insert into otlp_traces (migration 285 schema).
 *
 * @param {any} env
 * @param {any} ctx - ExecutionContext with optional waitUntil (may be null)
 * @param {object} span
 * @param {string} [span.tenant_id]
 * @param {string} [span.workspace_id]
 * @param {string} span.operation_name
 * @param {string} [span.kind='internal']
 * @param {string} [span.status_code='ok']
 * @param {string|null} [span.status_message]
 * @param {number} span.start_time_unix_nano
 * @param {number} span.end_time_unix_nano
 * @param {string|null} [span.attributes_json]
 * @param {string} [span.worker_name]
 * @param {string} [span.service_name]
 */
export function recordSpan(env, ctx, span) {
  if (!env?.DB || !span?.operation_name) return;
  const tenantId =
    span.tenant_id != null && String(span.tenant_id).trim() !== ''
      ? String(span.tenant_id).trim()
      : '';
  const workspaceId =
    span.workspace_id != null && String(span.workspace_id).trim() !== ''
      ? String(span.workspace_id).trim()
      : '';
  if (!tenantId || !workspaceId) return;

  const traceId = span.trace_id != null ? String(span.trace_id).replace(/-/g, '') : crypto.randomUUID().replace(/-/g, '');
  const spanId = span.span_id != null ? String(span.span_id).replace(/-/g, '') : crypto.randomUUID().replace(/-/g, '');
  const id =
    span.id != null && String(span.id).trim() !== ''
      ? String(span.id).trim()
      : `otp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const workerName =
    span.worker_name != null && String(span.worker_name).trim() !== ''
      ? String(span.worker_name).trim()
      : typeof env?.name === 'string' && env.name.trim()
        ? env.name.trim()
        : DEFAULT_WORKER_NAME;
  const serviceName =
    span.service_name != null && String(span.service_name).trim() !== ''
      ? String(span.service_name).trim()
      : 'inneranimalmedia';
  const kind = span.kind != null ? String(span.kind) : 'internal';
  const statusCode = span.status_code != null ? String(span.status_code) : 'ok';
  const startNs = Number(span.start_time_unix_nano);
  const endNs = Number(span.end_time_unix_nano);
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs)) return;

  const row = [
    id,
    tenantId,
    workspaceId,
    traceId,
    spanId,
    span.parent_span_id != null ? String(span.parent_span_id) : null,
    String(span.operation_name).slice(0, 500),
    serviceName,
    workerName,
    kind,
    statusCode,
    span.status_message != null ? String(span.status_message).slice(0, 2000) : null,
    Math.floor(startNs),
    Math.floor(endNs),
    span.attributes_json != null ? String(span.attributes_json) : null,
    span.events_json != null ? String(span.events_json) : null,
    span.resource_json != null ? String(span.resource_json) : null,
    span.binding_type != null ? String(span.binding_type) : null,
    span.binding_name != null ? String(span.binding_name) : null,
    span.http_method != null ? String(span.http_method) : null,
    span.http_status != null && Number.isFinite(Number(span.http_status)) ? Number(span.http_status) : null,
    span.http_url != null ? String(span.http_url).slice(0, 2000) : null,
    span.d1_query != null ? String(span.d1_query).slice(0, 2000) : null,
    span.d1_rows_read != null && Number.isFinite(Number(span.d1_rows_read)) ? Number(span.d1_rows_read) : null,
    span.d1_rows_written != null && Number.isFinite(Number(span.d1_rows_written)) ? Number(span.d1_rows_written) : null,
    span.r2_operation != null ? String(span.r2_operation) : null,
    span.r2_bucket != null ? String(span.r2_bucket) : null,
    span.r2_key != null ? String(span.r2_key).slice(0, 1000) : null,
    span.do_class != null ? String(span.do_class) : null,
    span.do_method != null ? String(span.do_method) : null,
    span.batch_id != null ? String(span.batch_id) : null,
  ];

  const ph = row.map(() => '?').join(',');
  const meta = {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    operation_name: String(span.operation_name).slice(0, 500),
    worker_name: workerName,
  };
  const p = env.DB.prepare(`INSERT OR IGNORE INTO otlp_traces (${OTLP_COLS.replace(/\s+/g, ' ')}) VALUES (${ph})`)
    .bind(...row)
    .run()
    .catch((e) => reportOtlpTraceWriteFailure(env, ctx, e, meta));

  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

export function createTracer(env, ctx) {
  const traceId = crypto.randomUUID().replace(/-/g, '');
  const batchId = crypto.randomUUID().replace(/-/g, '');
  const spans = [];

  function span(operationName, kind = 'internal') {
    const spanId = crypto.randomUUID().replace(/-/g, '');
    const startNs = Date.now() * 1_000_000;
    let extra = {};
    const s = {
      setD1(query, rowsRead, rowsWritten) {
        extra = {
          d1_query: (query || '').slice(0, 2000),
          d1_rows_read: rowsRead ?? 0,
          d1_rows_written: rowsWritten ?? 0,
        };
        return s;
      },
      setR2(op, bucket, key) {
        extra = { r2_operation: op, r2_bucket: bucket, r2_key: key };
        return s;
      },
      setHttp(method, url, status) {
        extra = {
          http_method: method,
          http_url: (url || '').slice(0, 2000),
          http_status: status,
        };
        return s;
      },
      setDO(cls, method) {
        extra = { do_class: cls, do_method: method };
        return s;
      },
      end(statusCode = 'ok', message) {
        const endNs = Date.now() * 1_000_000;
        const tid =
          ctx?.tenant_id != null && String(ctx.tenant_id).trim() !== '' ? String(ctx.tenant_id).trim() : '';
        const wid =
          ctx?.workspace_id != null && String(ctx.workspace_id).trim() !== ''
            ? String(ctx.workspace_id).trim()
            : '';
        if (!tid || !wid) return s;
        spans.push({
          id: `otp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
          tenant_id: tid,
          workspace_id: wid,
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: null,
          operation_name: operationName,
          service_name: 'inneranimalmedia',
          worker_name: typeof env?.name === 'string' && env.name.trim() ? env.name.trim() : DEFAULT_WORKER_NAME,
          kind,
          status_code: statusCode,
          status_message: message || null,
          start_time_unix_nano: startNs,
          end_time_unix_nano: endNs,
          attributes_json: null,
          events_json: null,
          resource_json: null,
          binding_type: null,
          binding_name: null,
          http_method: extra.http_method ?? null,
          http_status: extra.http_status ?? null,
          http_url: extra.http_url ?? null,
          d1_query: extra.d1_query ?? null,
          d1_rows_read: extra.d1_rows_read ?? null,
          d1_rows_written: extra.d1_rows_written ?? null,
          r2_operation: extra.r2_operation ?? null,
          r2_bucket: extra.r2_bucket ?? null,
          r2_key: extra.r2_key ?? null,
          do_class: extra.do_class ?? null,
          do_method: extra.do_method ?? null,
          batch_id: batchId,
        });
        return s;
      },
      spanId,
      traceId,
      batchId,
    };
    return s;
  }

  async function flush() {
    if (!spans.length || !env?.DB) return;
    const ph = spans.map(() => `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).join(',');
    const vals = spans.flatMap((s) => [
      s.id,
      s.tenant_id,
      s.workspace_id,
      s.trace_id,
      s.span_id,
      s.parent_span_id,
      s.operation_name,
      s.service_name,
      s.worker_name,
      s.kind,
      s.status_code,
      s.status_message,
      s.start_time_unix_nano,
      s.end_time_unix_nano,
      s.attributes_json,
      s.events_json,
      s.resource_json,
      s.binding_type,
      s.binding_name,
      s.http_method,
      s.http_status,
      s.http_url,
      s.d1_query,
      s.d1_rows_read,
      s.d1_rows_written,
      s.r2_operation,
      s.r2_bucket,
      s.r2_key,
      s.do_class,
      s.do_method,
      s.batch_id,
    ]);
    const s0 = spans[0];
    const batchMeta = {
      tenant_id: s0?.tenant_id,
      workspace_id: s0?.workspace_id,
      operation_name: 'otlp.batch_flush',
      worker_name: s0?.worker_name,
    };
    ctx?.waitUntil(
      env.DB.prepare(`INSERT OR IGNORE INTO otlp_traces (${OTLP_COLS.replace(/\s+/g, ' ')}) VALUES ${ph}`)
        .bind(...vals)
        .run()
        .catch((e) => reportOtlpTraceWriteFailure(env, ctx, e, batchMeta)),
    );
  }

  return { span, flush, traceId, batchId };
}
