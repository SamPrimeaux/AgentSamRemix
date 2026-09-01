import { useCallback } from 'react';
import { IAM_TERMINAL_CONNECT } from '../../src/lib/openCommandPalette';

/** Opens the dashboard shell terminal drawer (Local lane by default). */
export function useWorkModeShellBridge() {
  const openShellTerminal = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(IAM_TERMINAL_CONNECT, { detail: { target: 'local' } }),
    );
  }, []);

  const runInShellTerminal = useCallback((command: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(IAM_TERMINAL_CONNECT, {
        detail: { target: 'local', command },
      }),
    );
  }, []);

  return { openShellTerminal, runInShellTerminal };
}
