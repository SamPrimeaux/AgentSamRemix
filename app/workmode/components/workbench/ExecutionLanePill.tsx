import React from 'react';
import { Laptop, Cloud, Layers, ShieldCheck, AlertTriangle } from 'lucide-react';
import { ExecOsLocalLaneStatus } from '../../types';
import { cn } from '../../../lib/utils';

interface ExecutionLanePillProps {
  status: ExecOsLocalLaneStatus;
  onClick: () => void;
}

export const ExecutionLanePill: React.FC<ExecutionLanePillProps> = ({
  status,
  onClick
}) => {
  const getIcon = () => {
    switch (status.activeLane) {
      case 'local_mac':
        return <Laptop size={14} className="text-emerald-400" />;
      case 'gcp_vm':
        return <Cloud size={14} className="text-blue-400" />;
      case 'cloud_sandbox':
        return <Layers size={14} className="text-purple-400" />;
    }
  };

  const getLabel = () => {
    switch (status.activeLane) {
      case 'local_mac':
        return 'Local Mac';
      case 'gcp_vm':
        return 'GCP VM';
      case 'cloud_sandbox':
        return 'Sandbox';
    }
  };

  return (
    <button
      onClick={onClick}
      aria-label="Execution Lane & PM2 Diagnostics"
      className="h-12 px-3.5 sm:px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center gap-2 text-white/80 hover:text-white transition-all text-xs font-semibold shadow-sm"
    >
      <div className="flex items-center gap-1.5">
        {getIcon()}
        <span className="hidden sm:inline font-medium">{getLabel()}</span>
        <span className="text-[10px] font-mono text-emerald-400 font-semibold">{status.latencyMs}ms</span>
      </div>

      {!status.isEcosystemSanitized ? (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold border border-amber-500/30">
          <AlertTriangle size={10} />
          <span className="hidden md:inline">Sanitize</span>
        </span>
      ) : (
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      )}
    </button>
  );
};
