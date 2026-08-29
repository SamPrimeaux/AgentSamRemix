/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ambient surface context refs + listeners (Browser / Database / Design Studio / Mail / FS).
 * Peel A5 — mechanical extract from ChatAssistant.tsx.
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import { getDatabaseSurfaceContext } from '../../../src/lib/databaseStudioEvents';

export type ChatSurfaceRefs = {
  browserSurfaceRef: MutableRefObject<Record<string, unknown> | null>;
  databaseSurfaceRef: MutableRefObject<Record<string, unknown> | null>;
  designStudioSurfaceRef: MutableRefObject<Record<string, unknown> | null>;
  mailSurfaceRef: MutableRefObject<Record<string, unknown> | null>;
  fsChangeScopeRef: MutableRefObject<Record<string, unknown> | null>;
};

export function useChatSurfaceContext(conversationId: string): ChatSurfaceRefs {
  const browserSurfaceRef = useRef<Record<string, unknown> | null>(null);
  const databaseSurfaceRef = useRef<Record<string, unknown> | null>(null);
  const designStudioSurfaceRef = useRef<Record<string, unknown> | null>(null);
  const mailSurfaceRef = useRef<Record<string, unknown> | null>(null);
  const fsChangeScopeRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const onSurface = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (d && typeof d === 'object') browserSurfaceRef.current = d;
    };
    const onDatabaseSurface = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (d && typeof d === 'object') databaseSurfaceRef.current = d;
    };
    const onDesignStudioSurface = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (d && typeof d === 'object') designStudioSurfaceRef.current = d;
    };
    const onMailSurface = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (d && typeof d === 'object') mailSurfaceRef.current = d;
    };
    const onFsChangeScope = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (d && typeof d === 'object' && d.kind === 'fs_change_scope') {
        fsChangeScopeRef.current = d;
      }
    };
    window.addEventListener('iam-browser-surface-context', onSurface as EventListener);
    window.addEventListener('iam-database-surface-context', onDatabaseSurface as EventListener);
    window.addEventListener('iam-designstudio-surface-context', onDesignStudioSurface as EventListener);
    window.addEventListener('iam-mail-surface-context', onMailSurface as EventListener);
    window.addEventListener('iam-fs-change-scope', onFsChangeScope as EventListener);
    // Studio may have published before this panel mounted — hydrate from singleton.
    if (window.location.pathname.startsWith('/dashboard/database')) {
      const snap = getDatabaseSurfaceContext();
      if (snap && typeof snap === 'object') databaseSurfaceRef.current = snap as Record<string, unknown>;
    }
    return () => {
      window.removeEventListener('iam-browser-surface-context', onSurface as EventListener);
      window.removeEventListener('iam-database-surface-context', onDatabaseSurface as EventListener);
      window.removeEventListener(
        'iam-designstudio-surface-context',
        onDesignStudioSurface as EventListener,
      );
      window.removeEventListener('iam-mail-surface-context', onMailSurface as EventListener);
      window.removeEventListener('iam-fs-change-scope', onFsChangeScope as EventListener);
    };
  }, []);

  useEffect(() => {
    // Surface payloads are ambient UI state, not conversation-scoped. Drop them on
    // thread switches so Design Studio / mail / DB context cannot ride into an
    // unrelated chat turn — then rehydrate Database Studio from the live singleton
    // when still on /dashboard/database.
    browserSurfaceRef.current = null;
    databaseSurfaceRef.current = null;
    designStudioSurfaceRef.current = null;
    mailSurfaceRef.current = null;
    fsChangeScopeRef.current = null;
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard/database')) {
      const snap = getDatabaseSurfaceContext();
      if (snap && typeof snap === 'object') databaseSurfaceRef.current = snap as Record<string, unknown>;
    }
  }, [conversationId]);

  return {
    browserSurfaceRef,
    databaseSurfaceRef,
    designStudioSurfaceRef,
    mailSurfaceRef,
    fsChangeScopeRef,
  };
}
