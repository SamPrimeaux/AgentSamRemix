import type { ActiveFile, ActiveFileSourceType } from '../../types';
import { detectFileKind, isBinaryFile, truncateContentForMonaco } from './fileKind';

const BINARY_PREVIEW_MESSAGE = 'Binary file — preview not available in the editor.';

/** Infer Save target from open metadata when caller omitted source_type. */
export function inferActiveFileSourceType(file: ActiveFile): ActiveFileSourceType {
  if (file.source_type) return file.source_type;
  const wp = typeof file.workspacePath === 'string' ? file.workspacePath : '';
  if (wp.startsWith('mcp_tool:')) return 'mcp_tool';
  if (wp.startsWith('plan_d1:') || wp.startsWith('plan:')) return 'plan_d1';
  // Plan monaco drafts use agent-draft: — still Local-bound when a relative path is present.
  if (wp.startsWith('agent-draft:')) return 'local';
  if (file.driveFileId) return 'drive';
  if (file.r2Key) return 'r2';
  if (file.githubRepo && file.githubPath) return 'github';
  if (file.handle || wp) return 'local';
  return 'ephemeral';
}

/**
 * One pointer per tab: stamp source_type and clear every other destination's ids.
 * Save and chat active_file_* both derive from this object — never leave Local+GitHub both live.
 */
export function stampActiveFileBinding(file: ActiveFile): ActiveFile {
  const source_type = inferActiveFileSourceType(file);
  const base: ActiveFile = { ...file, source_type };

  if (source_type === 'local') {
    return {
      ...base,
      githubRepo: undefined,
      githubPath: undefined,
      githubSha: undefined,
      githubBranch: undefined,
      r2Key: undefined,
      r2Bucket: undefined,
      driveFileId: undefined,
    };
  }
  if (source_type === 'github') {
    return {
      ...base,
      handle: undefined,
      workspacePath: undefined,
      r2Key: undefined,
      r2Bucket: undefined,
      driveFileId: undefined,
    };
  }
  if (source_type === 'r2') {
    return {
      ...base,
      handle: undefined,
      workspacePath: undefined,
      githubRepo: undefined,
      githubPath: undefined,
      githubSha: undefined,
      githubBranch: undefined,
      driveFileId: undefined,
    };
  }
  if (source_type === 'drive') {
    return {
      ...base,
      handle: undefined,
      workspacePath: undefined,
      githubRepo: undefined,
      githubPath: undefined,
      githubSha: undefined,
      githubBranch: undefined,
      r2Key: undefined,
      r2Bucket: undefined,
    };
  }
  // mcp_tool / plan_d1 / ephemeral — strip remote destinations so Save cannot misfire.
  return {
    ...base,
    handle: undefined,
    githubRepo: undefined,
    githubPath: undefined,
    githubSha: undefined,
    githubBranch: undefined,
    r2Key: undefined,
    r2Bucket: undefined,
    driveFileId: undefined,
  };
}

/** Tool-result tabs are not repo/local files — Save must refuse. */
export function isNonPersistableEditorBuffer(file: ActiveFile): boolean {
  const name = String(file.name || '').trim();
  if (/^agent_output_/i.test(name)) return true;
  const wp = typeof file.workspacePath === 'string' ? file.workspacePath : '';
  if (/^agent_output_/i.test(wp.split('/').pop() || '')) return true;
  if (inferActiveFileSourceType(file) === 'ephemeral' && !file.handle && !wp) return true;
  return false;
}

/** Gate explorer/chat opens so Monaco never receives binary bodies or misclassified SQL dumps. */
export function prepareActiveFileForEditor(file: ActiveFile): ActiveFile {
  const stamped = stampActiveFileBinding(file);
  const source_type = stamped.source_type || inferActiveFileSourceType(stamped);
  const kind =
    stamped.fileKind ||
    (stamped.isImage
      ? 'image'
      : stamped.isBinary
        ? 'binary'
        : detectFileKind({
            name: stamped.name,
            key: stamped.r2Key,
            contentType: stamped.contentType,
            size: stamped.size,
          }));

  // Chat/agent opens often carry a string body with a weird ext (e.g. *.python).
  // Prefer opening as text over the binary gate when we already have content.
  const hasTextBody = typeof stamped.content === 'string' && stamped.content.length > 0;
  const treatAsText =
    (kind === 'text' || (kind === 'unknown' && hasTextBody)) &&
    !isBinaryFile(stamped.name, stamped.size ?? null);

  if (treatAsText) {
    const originalContent = stamped.originalContent ?? stamped.content;
    const { content, truncated, originalSize } = truncateContentForMonaco(stamped.content ?? '');
    if (truncated) {
      return {
        ...stamped,
        source_type,
        fileKind: 'truncated',
        content,
        originalContent,
        originalSize: originalSize ?? stamped.originalSize,
        isBinary: false,
      };
    }
    return {
      ...stamped,
      source_type,
      fileKind: 'text',
      originalContent,
      content,
      isBinary: false,
    };
  }

  const previewKind = kind === 'text' ? 'binary' : kind === 'unknown' ? 'binary' : kind;

  return {
    ...stamped,
    source_type,
    fileKind: previewKind,
    content: '',
    originalContent: '',
    isBinary: true,
    isImage: previewKind === 'image',
    binaryMessage: stamped.binaryMessage ?? BINARY_PREVIEW_MESSAGE,
  };
}
