export type TemplateLayer = 'app' | 'site';
export type TemplateCategory =
  | 'navigation'
  | 'feedback'
  | 'content'
  | 'forms'
  | 'commerce'
  | 'marketing'
  | 'layout'
  | 'developer';

export type ComponentRegistryEntry = {
  id: string;
  name: string;
  layer: TemplateLayer;
  category: TemplateCategory;
  importName: string;
  importPath: string;
  description: string;
  dependencies: string[];
  tags: string[];
  status: 'ready' | 'experimental';
};

export type TemplateRegistryEntry = {
  id: string;
  name: string;
  layer: TemplateLayer;
  description: string;
  componentIds: string[];
  themeId: string;
  tags: string[];
  status: 'ready' | 'experimental';
};
