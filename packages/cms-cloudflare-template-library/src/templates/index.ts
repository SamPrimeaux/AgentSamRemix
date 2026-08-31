import type { TemplateRegistryEntry } from '../registry/types';
import { templateRegistry } from '../registry';

export type CmsTemplateDefinition = TemplateRegistryEntry;

export const cmsTemplates: readonly CmsTemplateDefinition[] = templateRegistry;
