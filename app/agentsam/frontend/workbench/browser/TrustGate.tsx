/** @license SPDX-License-Identifier: Apache-2.0 */
import React, { useState } from 'react';
import {
  CheckCircle, Globe, HardDrive, Shield, ShieldCheck, ChevronRight,
} from 'lucide-react';
import { originOf, type TrustRequest } from './types.ts';

export const PermissionGate: React.FC<{
  request: TrustRequest;
  onDeny:        () => void;
  onAllowOnce:   () => void;
  onAlwaysAllow: () => void;
}> = ({ request, onDeny, onAllowOnce, onAlwaysAllow }) => {
  const origin = originOf(request.url);
  const [step, setStep] = useState<1 | 2>(1);
  const [selection, setSelection] = useState<'session' | 'persistent' | null>(null);

  const applySelection = () => {
    if (selection === 'persistent') onAlwaysAllow();
    else if (selection === 'session') onAllowOnce();
  };

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[440px] max-w-[calc(100vw-24px)] rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] px-6 pt-6 pb-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
              Inner Animal Media — Browser access
            </p>
            <p className="text-[10px] font-mono text-muted">
              Step {step} of 2
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
              <Globe size={20} className="text-[var(--color-primary)]" />
            </div>
            <div className="flex-1 border-t border-dashed border-[var(--border-subtle)] opacity-70" />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-hover)]">
              <ShieldCheck size={20} className="text-main" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-[16px] font-semibold text-main">
              Allow browser access to this origin?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Same approval flow as MCP OAuth: review the destination, then grant session or persistent trust before Browser Run live view or automation tools run.
            </p>
          </div>
        </div>

        <div className="p-5">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  Requested origin
                </div>
                <div className="mt-2 break-all text-[12px] font-mono text-main">
                  {origin}
                </div>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSelection('session')}
                  className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selection === 'session'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)]">
                    {selection === 'session' ? (
                      <CheckCircle size={12} className="text-[var(--color-primary)]" />
                    ) : (
                      <Shield size={12} className="text-muted" />
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[12px] font-semibold text-main">
                      Allow for this session
                    </span>
                    <span className="mt-1 block text-[11px] text-muted">
                      Browser navigation stays enabled until this dashboard session ends.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelection('persistent')}
                  className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selection === 'persistent'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)]">
                    {selection === 'persistent' ? (
                      <CheckCircle size={12} className="text-[var(--color-primary)]" />
                    ) : (
                      <HardDrive size={12} className="text-muted" />
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[12px] font-semibold text-main">
                      Always allow this origin
                    </span>
                    <span className="mt-1 block text-[11px] text-muted">
                      Save this origin to the trusted list for future browser actions.
                    </span>
                  </span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={onDeny}
                  className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-[12px] font-semibold text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selection}
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2 text-[12px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Review access
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  Origin
                </div>
                <div className="mt-2 break-all text-[12px] font-mono text-main">
                  {origin}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  Grant scope
                </div>
                <div className="mt-2 text-[12px] font-semibold text-main">
                  {selection === 'persistent' ? 'Persistent trusted origin' : 'Session-only browser access'}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {selection === 'persistent'
                    ? 'This origin will be saved in your trusted browser origins list.'
                    : 'This origin will only be allowed for the current dashboard session.'}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 text-[11px] leading-relaxed text-muted">
                Browser trust only controls where the embedded browser can navigate. Risky actions inside the page still require their own tool approvals.
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-4 py-2 text-[12px] font-semibold text-main transition-colors hover:bg-[var(--bg-panel)]"
                >
                  Edit
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onDeny}
                    className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-[12px] font-semibold text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applySelection}
                    className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Authorize
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { PermissionGate as TrustGate };
