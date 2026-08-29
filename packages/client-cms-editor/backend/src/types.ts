export type CmsEditorZone = 'HEADER' | 'BODY' | 'FOOTER' | 'TEMPLATE';
export type CmsEditorStatus = 'live' | 'draft' | 'new';
export type CmsEditorTargetKind = 'page' | 'section' | 'block';

export type CmsEditorBlock = {
  id: string;
  sectionId: string;
  type: string;
  visible: boolean;
  data: Record<string, any>;
  sortOrder: number;
};

export type CmsEditorSection = {
  id: string;
  name: string;
  type: string;
  zone: CmsEditorZone;
  visible: boolean;
  color: string;
  fields: Record<string, any>;
  css?: Record<string, any>;
  blocks: CmsEditorBlock[];
};

export type CmsEditorPage = {
  id: string;
  title: string;
  slug: string;
  status: CmsEditorStatus;
  type: string;
  parent?: string;
  sections: CmsEditorSection[];
  metaTitle: string;
  metaDescription: string;
};

export type CmsEditorSite = {
  id: string;
  name: string;
  initials: string;
  domain: string;
  edited: string;
  color: string;
  pages: CmsEditorPage[];
};

export type CmsEditorSelection = {
  kind: CmsEditorTargetKind;
  pageId: string | null;
  sectionId: string | null;
  blockId: string | null;
  fieldPath: string | null;
};

export const emptyCmsEditorSelection = (): CmsEditorSelection => ({
  kind: 'page', pageId: null, sectionId: null, blockId: null, fieldPath: null,
});
