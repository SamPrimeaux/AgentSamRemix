import componentRegistryJson from './component-registry.json';
import templateRegistryJson from './template-registry.json';
import type { ComponentRegistryEntry, TemplateRegistryEntry } from './types';

export * from './types';

export const componentRegistry = componentRegistryJson.components as ComponentRegistryEntry[];
export const templateRegistry = templateRegistryJson.templates as TemplateRegistryEntry[];

export function findComponent(id: string): ComponentRegistryEntry | undefined {
  return componentRegistry.find((entry) => entry.id === id);
}

export function findTemplate(id: string): TemplateRegistryEntry | undefined {
  return templateRegistry.find((entry) => entry.id === id);
}

export function componentsForTemplate(id: string): ComponentRegistryEntry[] {
  const template = findTemplate(id);
  if (!template) return [];
  return template.componentIds
    .map((componentId) => findComponent(componentId))
    .filter((entry): entry is ComponentRegistryEntry => Boolean(entry));
}
