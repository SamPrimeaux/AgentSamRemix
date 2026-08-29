/**
 * Compatibility facade for the historical Studio CMS import path.
 * Canonical editor API + types live in @inneranimalmedia/client-cms-editor/backend.
 */
export {
  activateCmsEditorTheme as activateTheme,
  createCmsEditorPage as createPage,
  createCmsEditorSection as createSection,
  getCmsEditorAssets as getAssets,
  getCmsEditorBootstrap as getBootstrap,
  getCmsEditorContacts as getContacts,
  getCmsEditorPagePreview as getPagePreview,
  getCmsEditorTemplates as getTemplates,
  publishCmsEditorPage as publishPage,
  renameCmsEditorSection as renameSection,
  reorderCmsEditorSections as reorderSections,
  saveCmsEditorPageMeta as savePageMeta,
  saveCmsEditorSection as saveSection,
  saveCmsEditorThemeVars as saveThemeVars,
  setCmsEditorSectionVisibility as setSectionVisibility,
} from '@inneranimalmedia/client-cms-editor/backend';
export type {
  CmsEditorBlock as StudioBlock,
  CmsEditorPage as StudioPage,
  CmsEditorSection as StudioSection,
  CmsEditorSite as StudioSite,
} from '@inneranimalmedia/client-cms-editor/backend';
