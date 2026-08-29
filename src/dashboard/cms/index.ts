/**
 * Monolith facade — canonical CMS editor lives in @inneranimalmedia/client-cms-editor.
 * Storefront URL fallback for hub pages stays here (worker core fallback).
 */
export {
  CmsEditor,
  mountClientCmsEditor,
} from '../../../packages/client-cms-editor/frontend/src/index';
export type {
  ClientCmsEditorBoot,
} from '../../../packages/client-cms-editor/frontend/src/index';
export * from '../../../packages/client-cms-editor/backend/src/index';
