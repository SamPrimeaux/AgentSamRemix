/**
 * Dashboard mount shim — product browser UI lives in app/agentsam/frontend/workbench/browser/.
 * @see app/agentsam/frontend/workbench/browser/peel-manifest.js
 */
export {
  BrowserWorkbench as BrowserView,
  BrowserWorkbench,
  type BrowserWorkbenchProps as BrowserViewProps,
} from '@iam/agentsam/frontend/workbench/browser';
export { default } from '@iam/agentsam/frontend/workbench/browser/BrowserWorkbench.tsx';
