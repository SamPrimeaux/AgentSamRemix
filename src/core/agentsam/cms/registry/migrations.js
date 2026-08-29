/**
 * CMS content-model migrations between registered schema versions.
 *
 * Fail loud when a path is missing — never invent a silent no-op upgrade.
 */

/** @type {Map<string, Readonly<{ type: string, fromVersion: number, toVersion: number, migrate: Function }>>} */
const migrations = new Map();

/**
 * @param {string} type
 * @param {number} fromVersion
 * @param {number} toVersion
 */
export function cmsMigrationKey(type, fromVersion, toVersion) {
  const t = String(type || '').trim();
  if (!t) throw new TypeError('CMS migration type is required');
  const from = Number(fromVersion);
  const to = Number(toVersion);
  if (!Number.isInteger(from) || from < 1) throw new TypeError(`Invalid fromVersion: ${fromVersion}`);
  if (!Number.isInteger(to) || to < 1) throw new TypeError(`Invalid toVersion: ${toVersion}`);
  if (from === to) throw new TypeError('fromVersion and toVersion must differ');
  return `${t}:${from}->${to}`;
}

/**
 * @param {{
 *   type: string,
 *   fromVersion: number,
 *   toVersion: number,
 *   migrate: (data: Record<string, unknown>) => Record<string, unknown>,
 * }} definition
 */
export function registerCmsMigration(definition = {}) {
  const type = String(definition.type || '').trim();
  const fromVersion = Number(definition.fromVersion);
  const toVersion = Number(definition.toVersion);
  if (typeof definition.migrate !== 'function') {
    throw new TypeError(`CMS migration for ${type} requires migrate()`);
  }
  const key = cmsMigrationKey(type, fromVersion, toVersion);
  if (migrations.has(key)) throw new Error(`CMS migration already registered: ${key}`);
  const frozen = Object.freeze({
    type,
    fromVersion,
    toVersion,
    migrate: definition.migrate,
  });
  migrations.set(key, frozen);
  return frozen;
}

/** @param {string} type @param {number} fromVersion @param {number} toVersion */
export function getCmsMigration(type, fromVersion, toVersion) {
  try {
    return migrations.get(cmsMigrationKey(type, fromVersion, toVersion)) || null;
  } catch {
    return null;
  }
}

export function listCmsMigrations() {
  return Array.from(migrations.values());
}

/**
 * @param {string} type
 * @param {unknown} data
 * @param {{ fromVersion: number, toVersion: number }} versions
 * @returns {{ ok: true, data: Record<string, unknown>, fromVersion: number, toVersion: number } | { ok: false, error: string }}
 */
export function migrateCmsContent(type, data, versions) {
  const fromVersion = Number(versions?.fromVersion);
  const toVersion = Number(versions?.toVersion);
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) {
    return { ok: false, error: 'version_required' };
  }
  if (fromVersion === toVersion) {
    const value = data && typeof data === 'object' && !Array.isArray(data)
      ? /** @type {Record<string, unknown>} */ (data)
      : {};
    return { ok: true, data: value, fromVersion, toVersion };
  }
  const migration = getCmsMigration(type, fromVersion, toVersion);
  if (!migration) {
    return { ok: false, error: `migration_not_found:${String(type)}:${fromVersion}->${toVersion}` };
  }
  const input = data && typeof data === 'object' && !Array.isArray(data)
    ? /** @type {Record<string, unknown>} */ (data)
    : {};
  const next = migration.migrate({ ...input });
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    return { ok: false, error: 'migration_returned_invalid_data' };
  }
  return { ok: true, data: next, fromVersion, toVersion };
}
