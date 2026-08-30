/**
 * Dashboard mount shim — product browser UI lives in app/frontend/workbench/browser/.
 * @see app/frontend/workbench/browser/peel-manifest.js
 */
export {
  BrowserWorkbench as BrowserView,
  BrowserWorkbench,
  type BrowserWorkbenchProps as BrowserViewProps,
} from '@iam/frontend/workbench/browser';
export { default } from '@iam/frontend/workbench/browser/BrowserWorkbench.tsx';
