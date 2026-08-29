import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { platformR2WriteGateResponse } from '../core/r2-storage-scope.js';

/**
 * Handlers for Voxel scenes and Excalidraw state persistence.
 */
export async function handleCanvasApi(request, env) {
    const url = new URL(request.url);
    const pathLower = url.pathname.toLowerCase();
    const method = request.method;

    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    // ── GET /api/draw/load ───────────────────────────────────────────────────
    if (pathLower === '/api/draw/load' && method === 'GET') {
        const projectId = url.searchParams.get('project_id');
        if (!projectId) return jsonResponse({ error: 'project_id required' }, 400);

        try {
            const sceneRow = await env.DB.prepare(
                "SELECT r2_key FROM project_assets WHERE project_id = ? AND generation_type = 'json_scene' ORDER BY created_at DESC LIMIT 1"
            ).bind(projectId).first();

            if (!sceneRow) return jsonResponse({ scene: null });
            
            const obj = await env.ASSETS.get(sceneRow.r2_key);
            if (!obj) return jsonResponse({ scene: null });

            const sceneData = await obj.json();
            return jsonResponse({ scene: sceneData, r2_key: sceneRow.r2_key });
        } catch (e) {
            return jsonResponse({ error: 'Failed to load scene', detail: e.message }, 500);
        }
    }

    // ── POST /api/draw/save ──────────────────────────────────────────────────
    if (pathLower === '/api/draw/save' && method === 'POST') {
        const r2Denied = platformR2WriteGateResponse(authUser);
        if (r2Denied) return r2Denied;

        try {
            const body = await request.json();
            const { scene, projectId, type = 'voxel' } = body;
            
            if (!scene || !projectId) {
                return jsonResponse({ error: 'scene and project_id required' }, 400);
            }

            const sceneId = crypto.randomUUID();
            const r2Key = `draw/scenes/${authUser.id}/${projectId}/${sceneId}.json`;

            // 1. Persist to R2
            await env.ASSETS.put(r2Key, JSON.stringify(scene), {
                customMetadata: { userId: authUser.id, projectId, type }
            });

            // 2. Register in D1
            await env.DB.prepare(
                "INSERT INTO project_assets (project_id, r2_key, generation_type, created_at) VALUES (?, ?, 'json_scene', datetime('now'))"
            ).bind(projectId, r2Key).run();

            return jsonResponse({ ok: true, r2_key: r2Key, scene_id: sceneId });
        } catch (e) {
            return jsonResponse({ error: 'Failed to save scene', detail: e.message }, 500);
        }
    }

    return jsonResponse({ error: 'Canvas route not found' }, 404);
}
