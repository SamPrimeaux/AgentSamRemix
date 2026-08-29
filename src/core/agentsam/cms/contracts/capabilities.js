/** Canonical CMS capabilities shared by human and agent surfaces. */

const DEFINITIONS = [
  ['site.read', 'read', 'site'],
  ['page.list', 'read', 'page'],
  ['page.read', 'read', 'page'],
  ['page.create', 'write', 'page'],
  ['page.update', 'write', 'page'],
  ['page.archive', 'destructive', 'page'],
  ['page.restore', 'write', 'page'],
  ['section.list', 'read', 'section'],
  ['section.read', 'read', 'section'],
  ['section.create', 'write', 'section'],
  ['section.update', 'write', 'section'],
  ['section.reorder', 'write', 'section'],
  ['section.remove', 'destructive', 'section'],
  ['block.list', 'read', 'block'],
  ['block.read', 'read', 'block'],
  ['block.create', 'write', 'block'],
  ['block.update', 'write', 'block'],
  ['block.reorder', 'write', 'block'],
  ['block.remove', 'destructive', 'block'],
  ['asset.list', 'read', 'asset'],
  ['asset.read', 'read', 'asset'],
  ['theme.read', 'read', 'theme'],
  ['theme.update', 'write', 'theme'],
  ['preview.read', 'read', 'preview'],
  ['revision.list', 'read', 'revision'],
  ['revision.restore', 'destructive', 'revision'],
  ['publish.page', 'publish', 'page'],
  ['publish.verify', 'read', 'page'],
];

export const CMS_CAPABILITIES = Object.freeze(Object.fromEntries(
  DEFINITIONS.map(([key, risk, resource]) => [key, Object.freeze({ key, risk, resource })]),
));
export const CMS_CAPABILITY_KEYS = Object.freeze(Object.keys(CMS_CAPABILITIES));

export function getCmsCapability(key) {
  return CMS_CAPABILITIES[String(key || '').trim()] || null;
}

export function isCmsCapabilityAllowed(key) {
  return getCmsCapability(key) != null;
}

export function cmsCapabilityRequiresApproval(key) {
  const risk = getCmsCapability(key)?.risk;
  return risk === 'destructive' || risk === 'publish';
}

export function buildCmsCapabilityManifest() {
  return CMS_CAPABILITY_KEYS.map((key) => CMS_CAPABILITIES[key]);
}
