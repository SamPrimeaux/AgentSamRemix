import React from 'react';
import { ApprovalRequest } from '../../sdk/types';

interface ApprovalGateModalProps {
  request: ApprovalRequest | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export const ApprovalGateModal: React.FC<ApprovalGateModalProps> = ({
  request,
  onApprove,
  onReject,
}) => {
  if (!request) return null;

  const isDestructive = request.riskLevel === 'DESTRUCTIVE';
  const isExternal = request.riskLevel === 'EXTERNAL_EFFECT';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            isDestructive ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
          }`}>
            <span className="material-symbols-outlined text-2xl">
              {isDestructive ? 'delete_forever' : isExternal ? 'public' : 'security'}
            </span>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                isDestructive ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                Safety Approval Required • {request.riskLevel}
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              Permission Required for Tool Execution
            </h3>
            <p className="text-xs text-zinc-300 mt-1">
              Agent Sam is requesting to execute a safety-gated operation on repository workspace.
            </p>
          </div>
        </div>

        {/* Action Summary & Parameters */}
        <div className="p-3.5 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
          <div className="text-xs font-semibold text-zinc-200">
            {request.actionSummary}
          </div>
          <pre className="p-2 bg-zinc-900 border border-zinc-800 rounded font-mono text-[11px] text-zinc-300 overflow-x-auto max-h-36">
            {JSON.stringify(request.parameters, null, 2)}
          </pre>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => onReject(request.id)}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
          >
            Deny & Stop
          </button>
          <button
            type="button"
            onClick={() => onApprove(request.id)}
            className={`px-5 py-2 text-white rounded-xl text-xs font-semibold shadow-lg transition-all flex items-center gap-2 ${
              isDestructive ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30' : 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/30'
            }`}
          >
            <span className="material-symbols-outlined text-base">check</span>
            <span>Authorize Operation</span>
          </button>
        </div>
      </div>
    </div>
  );
};
