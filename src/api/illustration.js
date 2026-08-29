/**
 * iam.illustration.v1 HTTP surface — POST /api/illustration/create
 */
import { jsonResponse } from '../core/responses.js'; import { resolveRequestContext } from '../../backend/identity/index.js';
import {
  parseIllustrationEnvelope,
  normalizeIllustrationEnvelope,
  validateIllustrationEnvelope,
} from '../core/iam-illustration-v1.js';
import { routeIllustration } from '../core/iam-illustration-router.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleIllustrationApi(request, url, env, ctx) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = (request.method || 'GET').toUpperCase();

  if (path === '/api/illustration/create' && method === 'POST') {
    const reqCtx = await resolveRequestContext(request, env);
    if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await request.json().catch(() => ({}));
    let envelope = parseIllustrationEnvelope(body);
    if (!envelope && body && typeof body === 'object') {
      envelope = parseIllustrationEnvelope({
        schema: 'iam.illustration.v1',
        ...body,
        brief: body.brief ?? body.prompt ?? body.description,
      });
    }
    if (!envelope) {
      return jsonResponse({ error: 'iam.illustration.v1 envelope required' }, 400);
    }

    envelope = normalizeIllustrationEnvelope(envelope, {
      workspaceId: reqCtx.workspaceId,
      tenantId: reqCtx.tenantId,
      userId: reqCtx.userId,
    });

    const valid = validateIllustrationEnvelope(envelope);
    if (!valid.ok) {
      return jsonResponse({ error: valid.errors.join('; ') }, 400);
    }

    const out = await routeIllustration(env, ctx, envelope, {
      userId: reqCtx.userId,
      tenantId: reqCtx.tenantId,
      workspaceId: reqCtx.workspaceId,
      authUser: { id: reqCtx.userId, tenant_id: reqCtx.tenantId },
    });

    if (out?.error || out?.ok === false) {
      return jsonResponse({ error: out.error || 'illustration_create_failed' }, 502);
    }

    return jsonResponse(out);
  }

  return null;
}
