/**
 * R2 prune job — DISABLED (removed from midnight-UTC cron).
 * Replaced by deploy-time manifest-diff in scripts/r2-dashboard-manifest-reconcile.mjs.
 * Do not re-enable until a manifest-aware replacement exists if this file is reused.
 *
 * Former behavior: kept only the latest N complete dashboard builds.
 * Ran nightly as part of midnight-UTC cron.
 *
 * Strategy: dashboard builds upload under static/dashboard/ (and sandbox test paths).
 * When r2_deploy_manifests is empty, cluster objects by upload time: objects within
 * BUILD_WINDOW_SECONDS of each other in list order (newest first) = one build generation.
 * Keep the KEEP_BUILDS most recent clusters; delete older objects.
 */

const DASHBOARD_BUCKET_BINDING = 'DASHBOARD';

const PRUNE_PREFIXES = ['static/dashboard/', 'static/sandbox/'];

const KEEP_BUILDS = 2;

const BUILD_WINDOW_SECONDS = 1800;

/**
 * @param {any} env
 * @returns {Promise<{ rowsWritten?: number, metadata?: Record<string, unknown>, skipped?: boolean, reason?: string }>}
 */
export async function runR2DashboardPrune(env) {
  if (!env?.[DASHBOARD_BUCKET_BINDING]) {
    return {
      skipped: true,
      reason: 'DASHBOARD binding not available',
      rowsWritten: 0,
      metadata: { skipped: true, reason: 'DASHBOARD binding not available' },
    };
  }

  const bucket = env[DASHBOARD_BUCKET_BINDING];
  /** @type {{ pruned_objects: number, pruned_bytes: number, kept_builds: number, errors: string[], prefixes: Record<string, unknown> }} */
  const results = {
    pruned_objects: 0,
    pruned_bytes: 0,
    kept_builds: 0,
    errors: [],
    prefixes: {},
  };

  for (const prefix of PRUNE_PREFIXES) {
    try {
      const listed = [];
      let cursor = undefined;
      do {
        const page = await bucket.list({ prefix, cursor, limit: 1000 });
        listed.push(...(page.objects || []));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      if (!listed.length) {
        results.prefixes[prefix] = { objects: 0, builds: 0, pruned: 0 };
        continue;
      }

      listed.sort((a, b) => {
        const ta = a.uploaded instanceof Date ? a.uploaded.getTime() : new Date(a.uploaded).getTime();
        const tb = b.uploaded instanceof Date ? b.uploaded.getTime() : new Date(b.uploaded).getTime();
        return tb - ta;
      });

      const builds = [];
      let currentBuild = [];
      let lastTs = null;

      for (const obj of listed) {
        const uploaded = obj.uploaded instanceof Date ? obj.uploaded : new Date(obj.uploaded);
        const ts = uploaded.getTime() / 1000;
        if (lastTs === null || lastTs - ts < BUILD_WINDOW_SECONDS) {
          currentBuild.push(obj);
        } else {
          if (currentBuild.length) builds.push(currentBuild);
          currentBuild = [obj];
        }
        lastTs = ts;
      }
      if (currentBuild.length) builds.push(currentBuild);

      results.kept_builds += Math.min(builds.length, KEEP_BUILDS);

      const toDelete = builds.slice(KEEP_BUILDS).flat();
      let prefixPruned = 0;
      for (const obj of toDelete) {
        try {
          await bucket.delete(obj.key);
          results.pruned_objects += 1;
          prefixPruned += 1;
          results.pruned_bytes += Number(obj.size || 0);
        } catch (e) {
          results.errors.push(`delete ${obj.key}: ${e?.message ?? e}`);
        }
      }
      results.prefixes[prefix] = {
        objects_listed: listed.length,
        build_clusters: builds.length,
        pruned: prefixPruned,
      };
    } catch (e) {
      results.errors.push(`list ${prefix}: ${e?.message ?? e}`);
    }
  }

  return {
    rowsWritten: results.pruned_objects,
    metadata: results,
  };
}
