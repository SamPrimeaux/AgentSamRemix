/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Open assistant markdown image preview in Monaco or a new tab.
 */

export function createChatImagePreviewHandler(args: {
  onFileSelect?: (file: { name: string; content: string; originalContent: string }) => void;
  onOpenCodeTab?: () => void;
}) {
  const { onFileSelect, onOpenCodeTab } = args;
  return (src: string) => {
    if (onFileSelect) {
      onOpenCodeTab?.();
      onFileSelect({
        name: 'chat-image-preview.md',
        content: `# Chat image\n\n![preview](${src})\n`,
        originalContent: '',
      });
      return;
    }
    window.open(src, '_blank', 'noopener,noreferrer');
  };
}
