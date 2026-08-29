/**
 * Assert PRODUCTION_WORKER_BINDINGS matches wrangler.production.toml resource IDs.
 * Used by sync script and unit tests — not called from the Worker runtime.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_WORKER_BINDINGS } from './worker-bindings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} [tomlPath] */
export function readWranglerProductionToml(tomlPath = join(ROOT, 'wrangler.production.toml')) {
  return readFileSync(tomlPath, 'utf8');
}

/** @param {string} toml */
export function assertWorkerBindingsMatchWrangler(toml) {
  const catalog = PRODUCTION_WORKER_BINDINGS;
  const errors = [];

  const mustInclude = [
    [catalog.d1[0].database_id, 'D1 database_id'],
    [catalog.hyperdrive[0].id, 'Hyperdrive id'],
    [catalog.kv[0].namespace_id, 'KV namespace_id'],
    [catalog.kv[1].namespace_id, 'SESSION_CACHE namespace_id'],
    [catalog.vpc_services[0].service_id, 'PTY_SERVICE service_id'],
    [catalog.queues[0].queue, 'MY_QUEUE id'],
    [catalog.pipelines[0].stream, 'INNERANIMALPRO_STREAM id'],
    [catalog.containers[0].image.split('@sha256:')[1], 'MyContainer digest'],
  ];

  for (const [needle, label] of mustInclude) {
    if (!toml.includes(needle)) {
      errors.push(`wrangler.production.toml missing ${label}: ${needle}`);
    }
  }

  const bindingChecks = [
    ...catalog.d1.map((r) => r.binding),
    ...catalog.hyperdrive.map((r) => r.binding),
    ...catalog.r2.map((r) => r.binding),
    ...catalog.kv.map((r) => r.binding),
    ...catalog.vectorize.map((r) => r.binding),
    ...catalog.services.map((r) => r.binding),
    ...catalog.vpc_services.map((r) => r.binding),
    ...catalog.queues.map((r) => r.binding),
    ...catalog.analytics_engine.map((r) => r.binding),
    ...catalog.pipelines.map((r) => r.binding),
    ...catalog.durable_objects.map((r) => r.name),
  ];

  for (const binding of bindingChecks) {
    if (!toml.includes(`binding = "${binding}"`) && !toml.includes(`name = "${binding}"`)) {
      errors.push(`wrangler.production.toml missing binding name: ${binding}`);
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return {
    ok: true,
    worker_name: catalog.worker_name,
    counts: {
      d1: catalog.d1.length,
      hyperdrive: catalog.hyperdrive.length,
      r2: catalog.r2.length,
      kv: catalog.kv.length,
      vectorize: catalog.vectorize.length,
      services: catalog.services.length,
      durable_objects: catalog.durable_objects.length,
      containers: catalog.containers.length,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const toml = readWranglerProductionToml();
  const result = assertWorkerBindingsMatchWrangler(toml);
  console.log(JSON.stringify(result, null, 2));
}
