/**
 * Cloudflare Container DO — iam-cad-worker (CAD toolchain, standard-2+).
 * Binding: env.IAM_CAD_WORKER
 */
import { Container } from '@cloudflare/containers';

export class IamCadWorkerContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  /** Short idle — standard-2 is 6 GiB; do not linger after CAD jobs. */
  sleepAfter = '5m';
  enableInternet = true;
  pingEndpoint = '/health';

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
