/**
 * Ephemeral browser captures — save to user storage on request (not platform R2 by default).
 */
import { getAuthUser } from '../../identity/index.js';
import { httpJsonResponse as jsonResponse } from '../responses.js';
import {
  loadEphemeralCapture,
  saveBrowserCaptureForUser,
} from '../../browser/capture/storage.js';

export async function handleBrowserCapturesApi(request, url, env) {
  const path = url.pathname.replace(/\/$/, '');
  const pathLower = path.toLowerCase();
  const method = request.method.toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const getMatch = pathLower.match(/^\/api\/browser\/captures\/([^/]+)$/);
  if (method === 'GET' && getMatch) {
    const captureId = decodeURIComponent(getMatch[1]);
    const cached = await loadEphemeralCapture(env, captureId);
    if (!cached) return jsonResponse({ error: 'Capture not found or expired' }, 404);
    return jsonResponse({
      ok: true,
      capture_id: captureId,
      content_type: cached.content_type || 'image/png',
      byte_length: cached.byte_length,
      image_base64: cached.image_base64,
      storage: 'ephemeral',
    });
  }

  if (pathLower === '/api/browser/captures/save' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const out = await saveBrowserCaptureForUser(env, authUser, body);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
