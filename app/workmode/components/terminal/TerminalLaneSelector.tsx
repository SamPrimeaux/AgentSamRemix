import React from 'react';
import { 
  Laptop, 
  Server, 
  Cloud, 
  Check, 
  ChevronDown, 
  ShieldCheck, 
  Zap, 
  Radio 
} from 'lucide-react';
import { ExecutionLane } from '../../types';
import { cn } from '../../../lib/utils';

interface TerminalLaneSelectorProps {
  currentLane: ExecutionLane;
  onChangeLane: (lane: ExecutionLane) => void;
  className?: string;
  isCompact?: boolean;
}

export const TerminalLaneSelector: React.FC<TerminalLaneSelectorProps> = ({
  currentLane,
  onChangeLane,
  className,
  isCompact = false
}) => {
  const lanes: { id: ExecutionLane; label: string; sublabel: string; port?: string; icon: any; status: 'connected' | 'standby' }[] = [
    { 
      id: 'local_mac', 
      label: 'Local Mac', 
      sublabel: 'localpty (Port 3099)', 
      port: ':3099', 
      icon: Laptop, 
      status: 'connected' 
    },
    { 
      id: 'gcp_vm', 
      label: 'GCP Cloud VM', 
      sublabel: 'iam-tunnel (Private VPC)', 
      icon: Server, 
      status: 'standby' 
    },
    { 
      id: 'cloud_sandbox', 
      label: 'Cloud Sandbox', 
      sublabel: 'Cloudflare Worker Container', 
      icon: Cloud, 
      status: 'standby' 
    }
  ];

  const current = lanes.find(l => l.id === currentLane) || lanes[0];

  return (
    <div className={cn("relative inline-block", className)}>
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          const isSelected = lane.id === currentLane;
          return (
            <button
              key={lane.id}
              onClick={() => onChangeLane(lane.id)}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5",
                isSelected
                  ? "bg-zinc-800 text-white font-semibold shadow-xs border border-zinc-700/60"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              )}
              title={`${lane.label} - ${lane.sublabel}`}
            >
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                lane.status === 'connected' ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              )} />
              <Icon size={12} className={isSelected ? "text-blue-400" : "text-zinc-400"} />
              <span className="truncate">{lane.label}</span>
              {lane.port && <span className="text-[10px] text-zinc-500 hidden sm:inline">{lane.port}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
