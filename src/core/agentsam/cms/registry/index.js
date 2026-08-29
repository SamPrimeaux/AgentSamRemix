export {
  CMS_FIELD_KINDS,
  applyCmsFieldValues,
  coerceCmsFieldValue,
  flattenCmsFields,
  getCmsFieldType,
  inferCmsFieldKind,
  listCmsFieldTypes,
  registerCmsFieldType,
} from './fields.js';

export {
  cmsBlockSchemaKey,
  getCmsBlock,
  listCmsBlockVersions,
  listCmsBlocks,
  registerCmsBlock,
} from './blocks.js';

export {
  cmsSectionSchemaKey,
  getCmsSection,
  listCmsSectionVersions,
  listCmsSections,
  registerCmsSection,
} from './sections.js';

export {
  buildCmsSchemaManifest,
  cmsSchemaKey,
  getCmsSchema,
  listCmsSchemas,
} from './schemas.js';

export { validateCmsContent } from './validation.js';

export {
  cmsMigrationKey,
  getCmsMigration,
  listCmsMigrations,
  migrateCmsContent,
  registerCmsMigration,
} from './migrations.js';

export { ensureCmsBuiltinCatalog } from './catalog.js';

import { ensureCmsBuiltinCatalog } from './catalog.js';

/** Load portable proof catalog on first registry import. */
ensureCmsBuiltinCatalog();
