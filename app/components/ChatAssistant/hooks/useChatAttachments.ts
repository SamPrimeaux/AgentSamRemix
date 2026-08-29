/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Composer attachment staging helpers. Mechanical peel from ChatAssistant.tsx.
 */

import type { Dispatch, SetStateAction } from 'react';
import { isImageAttachmentFile, type StagedAttachment } from '../types';
import { isAgentRuntimeDumpText } from '../../../shared/agent-runtime/user-visible-agent-error.js';

export type UseChatAttachmentsArgs = {
  input: string;
  setAttachments: Dispatch<SetStateAction<StagedAttachment[]>>;
  insertAtCursor: (newValue: string, selStart: number, selEnd: number) => void;
  setComposerToast?: (message: string | null) => void;
};

export function useChatAttachments(args: UseChatAttachmentsArgs) {
  const { input, setAttachments, insertAtCursor, setComposerToast } = args;
  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const fileItems: File[] = [];
    for (const item of cd.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) fileItems.push(f);
      }
    }
    if (fileItems.length) {
      e.preventDefault();
      const dt = new DataTransfer();
      fileItems.forEach((f) => dt.items.add(f));
      const allImages = fileItems.every(
        (f) => !String(f.type || '').trim() || String(f.type).startsWith('image/'),
      );
      addFilesFromList(dt.files, allImages);
      return;
    }
    const text = cd.getData('text/plain');
    if (!text) return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    e.preventDefault();
    if (isAgentRuntimeDumpText(text)) {
      const file = new File([text], `pasted-log-${Date.now()}.txt`, { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      addFilesFromList(dt.files, false);
      const note = 'I attached a log from the clipboard.';
      const next = input.slice(0, start) + note + input.slice(end);
      const caret = start + note.length;
      insertAtCursor(next, caret, caret);
      setComposerToast?.('Pasted log attached as a file so it does not fill the chat.');
      return;
    }
    const next = input.slice(0, start) + text + input.slice(end);
    const caret = start + text.length;
    insertAtCursor(next, caret, caret);
  };

  const addFilesFromList = (list: FileList | null, asImage: boolean) => {
    if (!list?.length) return;
    Array.from(list).forEach((file) => {
      const id = crypto.randomUUID();
      const isImg = asImage || isImageAttachmentFile(file);
      const previewUrl = isImg ? URL.createObjectURL(file) : null;
      setAttachments((prev) => [
        ...prev,
        {
          id,
          file,
          type: isImg ? 'image' : 'file',
          previewUrl,
          agentAttachmentId: null,
          // Stage only when Send actually needs a tool byte-handle. A pasted/removed file
          // must not leave KV/R2 residue just because it briefly sat in the composer.
          stageStatus: undefined,
          stageError: null,
        },
      ]);
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const a = prev.find((x) => x.id === id);
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  /** Clears the composer only. Do not revoke blob URLs here — after send they are kept on the user message (`attachmentPreviews`) for history thumbnails. */
  const clearAttachments = () => {
    setAttachments([]);
  };

  return { handleComposerPaste, addFilesFromList, removeAttachment, clearAttachments };
}
