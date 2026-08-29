/**
 * Cloudflare Container DO — iam-sandbox image (sandbox-go-v1, basic tier).
 * Pool id: inneranimalmedia (matches worker name via CONTAINER_POOL_ID var).
 * Binding: env.MY_CONTAINER
 *
 * Optional R2 FUSE: worker secrets R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY → container env
 * @see https://developers.cloudflare.com/containers/examples/r2-fuse-mount/
 */
import { Container } from '@cloudflare/containers';
import { buildSandboxR2FuseEnvVars } from '../../backend/agentsam/sandbox/r2-fuse-env.js';

export class MyContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  /** Short idle — basic is 1 GiB; avoid aimless GiB-sec when sandbox is unused. */
  sleepAfter = '2m';
  enableInternet = true;
  pingEndpoint = '/health';

  /** @param {DurableObjectState} ctx @param {any} env @param {import('@cloudflare/containers').ContainerOptions} [options] */
  constructor(ctx, env, options) {
    super(ctx, env, options);
    this.envVars = {
      ...buildSandboxR2FuseEnvVars(env),
      ...(options?.envVars ?? {}),
    };
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__admin/destroy' && request.method === 'POST') {
      try {
        await this.destroy();
        return Response.json({ ok: true, destroyed: true });
      } catch (e) {
        return Response.json(
          { ok: false, error: String(e?.message || e).slice(0, 400) },
          { status: 500 },
        );
      }
    }
    return super.fetch(request);
  }
}
