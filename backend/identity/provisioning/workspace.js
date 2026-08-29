/**
 * Tenant and personal-workspace provisioning.
 *
 * This module owns only identity-plane tenant/workspace bootstrap. Billing,
 * terminal, BYOK, and model-access policy live in sibling modules.
 */
import { workspaceSlugFromTenantId } from '../workspace/slug.js';

const STARTER_COURSE_ID = 'course-modern-tech-foundations';

/**
 * Ensure auth_users.tenant_id and optional tenants row exist.
 * @returns {Promise<string|null>}
 */
export async function ensureTenantForUser(env, userId, email) {
  if (!env?.DB || !userId) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT tenant_id, email FROM auth_users WHERE id = ? LIMIT 1`,
    ).bind(userId).first();
    if (row?.tenant_id != null && String(row.tenant_id).trim() !== '') {
      return String(row.tenant_id).trim();
    }
    const em = String(email || row?.email || '').trim();
    const local = em.includes('@') ? em.split('@')[0] : em || 'user';
    const tenantId = `tenant_${local.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20)}_${crypto.randomUUID().slice(0, 8)}`;

    const tenantSlug = tenantId.replace(/^tenant_/, '').replace(/[^a-z0-9-]/gi, '-').slice(0, 60) || tenantId;
    try {
      await env.DB.prepare(
        `INSERT INTO tenants
           (id, name, slug, is_active, settings, created_at, updated_at)
         VALUES (?, ?, ?, 1, '{}', unixepoch(), unixepoch())`,
      ).bind(tenantId, em || tenantId, tenantSlug).run();
    } catch {
      try {
        await env.DB.prepare(
          `INSERT INTO tenants
             (id, name, slug, created_at, updated_at)
           VALUES (?, ?, ?, unixepoch(), unixepoch())`,
        ).bind(tenantId, em || tenantId, tenantSlug).run();
      } catch (error) {
        console.warn('[ensureTenantForUser] tenants insert:', error?.message ?? error);
      }
    }

    await env.DB.prepare(
      `UPDATE auth_users SET tenant_id = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(tenantId, userId).run();
    return tenantId;
  } catch (error) {
    console.warn('[ensureTenantForUser]', error?.message ?? error);
    return null;
  }
}

/**
 * Idempotent tenant/workspace/onboarding bootstrap after authentication.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.email]
 * @param {string} [opts.tenantId]
 * @param {string} [opts.planId='free']
 */
export async function provisionUserWorkspace(
  env,
  { userId, email, tenantId: tenantIdOpt = null, planId = 'free' },
) {
  if (!env?.DB || !userId) {
    return { workspaceId: null, provisioned: false, reason: 'no_db_or_user' };
  }

  const em = String(email || '').trim();
  let tenantId = tenantIdOpt != null && String(tenantIdOpt).trim() !== ''
    ? String(tenantIdOpt).trim()
    : null;
  if (!tenantId) tenantId = await ensureTenantForUser(env, userId, em);
  if (!tenantId) {
    const row = await env.DB.prepare(
      `SELECT tenant_id FROM auth_users WHERE id = ? LIMIT 1`,
    ).bind(userId).first();
    tenantId = row?.tenant_id != null ? String(row.tenant_id).trim() : null;
  }
  if (!tenantId) return { workspaceId: null, provisioned: false, reason: 'no_tenant' };

  const wsSlug = workspaceSlugFromTenantId(tenantId);
  let hadExistingWs = false;

  try {
    let existingWs = null;
    try {
      existingWs = await env.DB.prepare(
        `SELECT id FROM agentsam_workspace WHERE tenant_id = ? LIMIT 1`,
      ).bind(tenantId).first();
    } catch {
      existingWs = null;
    }
    const workspaceId = existingWs?.id ? String(existingWs.id) : wsSlug;
    hadExistingWs = !!existingWs?.id;

    if (!existingWs?.id) {
      const displayName = `${em.split('@')[0]?.replace(/[^a-z0-9\s]/gi, ' ')?.trim() || 'My'} Workspace`;
      try {
        await env.DB.prepare(
          `INSERT INTO agentsam_workspace
             (id, workspace_slug, tenant_id, name, root_path, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 'active', datetime('now'), datetime('now'))`,
        ).bind(workspaceId, wsSlug, tenantId, displayName).run();
      } catch {
        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO workspaces
               (id, name, handle, status, category, created_at)
             VALUES (?, ?, ?, 'active', 'personal', unixepoch())`,
          ).bind(workspaceId, displayName, wsSlug.replace(/^ws_/, '')).run();
        } catch {}
        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO agentsam_workspace
               (id, tenant_id, display_name, created_at, updated_at)
             VALUES (?, ?, ?, unixepoch(), unixepoch())`,
          ).bind(workspaceId, tenantId, displayName).run();
        } catch {
          try {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO agentsam_workspace
                 (workspace_id, display_name, created_at)
               VALUES (?, ?, unixepoch())`,
            ).bind(workspaceId, displayName).run();
          } catch (error) {
            console.warn('[provisionUserWorkspace] agentsam_workspace:', error?.message ?? error);
          }
        }
      }
    }

    const existingTw = await env.DB.prepare(
      `SELECT id FROM tenant_workspaces
       WHERE tenant_id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(tenantId, workspaceId).first();
    if (!existingTw) {
      const twId = `tws_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      try {
        await env.DB.prepare(
          `INSERT INTO tenant_workspaces
             (id, tenant_id, workspace_id, role, is_default, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 'owner', 1, 1, unixepoch(), unixepoch())`,
        ).bind(twId, tenantId, workspaceId).run();
      } catch {
        try {
          await env.DB.prepare(
            `INSERT INTO tenant_workspaces
               (tenant_id, workspace_id, role, is_default, is_active, created_at, updated_at)
             VALUES (?, ?, 'owner', 1, 1, unixepoch(), unixepoch())`,
          ).bind(tenantId, workspaceId).run();
        } catch (error) {
          console.warn('[provisionUserWorkspace] tenant_workspaces:', error?.message ?? error);
        }
      }
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members
         (workspace_id, tenant_id, user_id, role, is_active, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', 1, datetime('now'), unixepoch(), unixepoch())`,
    ).bind(workspaceId, tenantId, userId).run();

    const existingSub = await env.DB.prepare(
      `SELECT id FROM billing_subscriptions WHERE tenant_id = ? LIMIT 1`,
    ).bind(tenantId).first();
    if (!existingSub) {
      try {
        await env.DB.prepare(
          `INSERT INTO billing_subscriptions
             (tenant_id, stripe_subscription_id, plan_id, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', unixepoch(), unixepoch())`,
        ).bind(tenantId, `internal_${tenantId}`, planId).run();
      } catch (error) {
        console.warn('[provisionUserWorkspace] billing_subscriptions:', error?.message ?? error);
      }
    }

    const onboardProbe = await env.DB.prepare(
      `SELECT id FROM onboarding_state WHERE tenant_id = ? LIMIT 1`,
    ).bind(tenantId).first();
    if (!onboardProbe) {
      const completedSteps = JSON.stringify(['auth', 'create_tenant']);
      let onboardOk = false;
      try {
        await env.DB.prepare(
          `INSERT INTO onboarding_state
             (tenant_id, user_id, current_step, completed_steps_json, workspace_id, started_at, updated_at)
           VALUES (?, ?, 'choose_preset', ?, ?, unixepoch(), unixepoch())`,
        ).bind(tenantId, userId, completedSteps, workspaceId).run();
        onboardOk = true;
      } catch {
        // Older schemas use the step_key shape below.
      }
      if (!onboardOk) {
        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO onboarding_state
               (id, tenant_id, step_key, status, meta_json, completed_at, created_at, updated_at)
             VALUES (?, ?, 'choose_preset', 'pending', ?, NULL, unixepoch(), unixepoch())`,
          ).bind(
            `obst_${tenantId}_choose_preset`.slice(0, 120),
            tenantId,
            JSON.stringify({ user_id: userId, email: em, workspace_id: workspaceId }),
          ).run();
        } catch (error) {
          console.warn('[provisionUserWorkspace] onboarding_state:', error?.message ?? error);
        }
      }
    }

    const existingEnroll = await env.DB.prepare(
      `SELECT id FROM enrollments
       WHERE user_id = ? AND course_id = ? LIMIT 1`,
    ).bind(userId, STARTER_COURSE_ID).first();
    if (!existingEnroll) {
      const enrId = `enr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      try {
        await env.DB.prepare(
          `INSERT INTO enrollments
             (id, org_id, user_id, course_id, tenant_id, status, started_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch(), unixepoch())`,
        ).bind(enrId, tenantId, userId, STARTER_COURSE_ID, tenantId).run();
      } catch {
        try {
          await env.DB.prepare(
            `INSERT INTO enrollments
               (id, org_id, user_id, course_id, tenant_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())`,
          ).bind(enrId, tenantId, userId, STARTER_COURSE_ID, tenantId).run();
        } catch (error) {
          console.warn('[provisionUserWorkspace] enrollments:', error?.message ?? error);
        }
      }
    }

    return { workspaceId, tenantId, provisioned: !hadExistingWs };
  } catch (error) {
    console.warn('[provisionUserWorkspace]', error?.message ?? error);
    return { workspaceId: null, provisioned: false, reason: String(error?.message || error) };
  }
}
