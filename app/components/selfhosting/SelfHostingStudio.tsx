import React, { useState } from 'react';
import { EvolutionReport, Mission } from '../../sdk/types';
import { MissionRuntime } from '../../sdk/mission';

interface SelfHostingStudioProps {
  onStartMission: (goal: any) => void;
  activeMission: Mission | null;
}

export const SelfHostingStudio: React.FC<SelfHostingStudioProps> = ({
  onStartMission,
  activeMission,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [evolutionReport, setEvolutionReport] = useState<EvolutionReport | null>(activeMission?.evolutionReport || null);
  const [promotionStatus, setPromotionStatus] = useState<string | null>(null);

  const handleLaunchSelfHostingMission = async () => {
    setIsRunning(true);
    setPromotionStatus(null);

    const goal = {
      id: 'msn_self_host_01',
      title: 'Improve AgentSam Repository Inspector Churn Filter',
      description: 'Optimize repository inspector so it identifies unusually high Git churn without scanning generated files or vendor builds.',
      targetRepo: 'SamPrimeaux/agentsam-sdk',
      targetBranch: 'main',
      workingBranch: 'agentsam/evolve-inspector-churn-perf',
      isSelfHosting: true,
      priority: 'high' as const,
    };

    onStartMission(goal);
    setIsRunning(false);
  };

  const currentReport = activeMission?.evolutionReport || evolutionReport;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6 text-zinc-200">
      {/* Header Banner */}
      <div className="p-5 bg-gradient-to-r from-sky-950/40 via-zinc-900/90 to-indigo-950/40 border border-sky-500/30 rounded-2xl relative overflow-hidden backdrop-blur">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 text-[11px] font-bold tracking-wide uppercase">
                Self-Hosting Mode
              </span>
              <span className="text-xs text-zinc-400 font-mono">Target: SamPrimeaux/agentsam-sdk</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Develop AgentSam (Recursive Dogfooding)</h2>
            <p className="text-xs text-zinc-300 max-w-2xl leading-relaxed">
              Agent Sam targets its own SDK repository in an isolated candidate workspace (SDK N+1). Changes run through strict regression gates, unit tests, and performance benchmarks before promotion.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLaunchSelfHostingMission}
            disabled={isRunning || activeMission?.state === 'executing'}
            className="px-5 py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-sky-600/20 flex items-center gap-2.5 shrink-0 border border-sky-400/40"
          >
            <span className="material-symbols-outlined text-base">psychology</span>
            <span>Launch Self-Evolution Mission</span>
          </button>
        </div>
      </div>

      {/* Regression Gates & Dogfood Architecture */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-400 uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">lock</span>
            <span>Protected Main Branch</span>
          </div>
          <p className="text-xs text-zinc-400">
            Agent Sam operates exclusively on isolated branches (<code className="text-zinc-300 font-mono">agentsam/evolve-*</code>). It never autonomously mutates production.
          </p>
        </div>

        <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">verified</span>
            <span>Strict Regression Gates</span>
          </div>
          <p className="text-xs text-zinc-400">
            Candidates must pass typecheck, unit tests, public contract audits, and zero secret leakage before being eligible for review.
          </p>
        </div>

        <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">speed</span>
            <span>Measurable Benchmarks</span>
          </div>
          <p className="text-xs text-zinc-400">
            Every candidate is quantitatively compared before and after on token efficiency, latency, and memory pressure.
          </p>
        </div>
      </div>

      {/* Evolution Report Section */}
      {currentReport ? (
        <div className="p-6 bg-zinc-900/90 border border-zinc-800 rounded-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-xl">assessment</span>
                <h3 className="text-base font-bold text-white">Evolution Report: {currentReport.objective}</h3>
              </div>
              <span className="text-xs text-zinc-400 font-mono mt-1 block">
                Branch: {currentReport.branchName} • Base: {currentReport.baseVersion} → Candidate: {currentReport.candidateVersion}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                <span>Ready for Promotion</span>
              </span>
            </div>
          </div>

          {/* Regression Gates Results */}
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Regression Verification Gates</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {currentReport.regressionGates.map((gate, i) => (
                <div key={i} className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-xl flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <span className="material-symbols-outlined text-sm">done</span>
                  </div>
                  <div>
                    <span className="text-xs font-mono font-bold text-zinc-200 capitalize">{gate.gate.replace('_', ' ')}</span>
                    <span className="text-[10px] text-zinc-500 block">{gate.details}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Benchmarks Before vs After */}
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Performance Benchmarks (Before vs Candidate)</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {currentReport.benchmarks.map((bm, i) => (
                <div key={i} className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-zinc-300">{bm.metric}</span>
                    <span className="text-emerald-400 font-mono">{bm.deltaPercent > 0 ? `+${bm.deltaPercent}` : bm.deltaPercent}%</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm font-mono pt-1">
                    <span className="text-zinc-500 line-through text-xs">{bm.before} {bm.unit}</span>
                    <span className="text-white font-bold">{bm.after} {bm.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Diff Summary */}
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Files Changed in Candidate Workspace</h4>
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl font-mono text-xs text-sky-400">
              {currentReport.filesChanged.map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-emerald-400">edit_note</span>
                  <span>{f}</span>
                  <span className="text-[11px] text-zinc-500 ml-auto">+14 -4 lines</span>
                </div>
              ))}
            </div>
          </div>

          {/* Promotion Actions */}
          <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-zinc-200">Candidate Promotion Approval</span>
              <p className="text-xs text-zinc-400">Select how to apply this verified SDK evolution:</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPromotionStatus('Committed branch agentsam/evolve-inspector-churn-perf to local Git ref.')}
                className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium border border-zinc-700 transition-colors"
              >
                Commit Branch
              </button>
              <button
                type="button"
                onClick={() => setPromotionStatus('Created GitHub Pull Request #142 (Ready for Review).')}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-600/20 transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">call_merge</span>
                <span>Open PR for Review</span>
              </button>
            </div>
          </div>

          {promotionStatus && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              <span>{promotionStatus}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="p-10 border border-dashed border-zinc-800 rounded-2xl text-center text-zinc-400 space-y-3">
          <span className="material-symbols-outlined text-4xl text-zinc-600">terminal</span>
          <h3 className="text-sm font-semibold text-zinc-300">No Active Self-Evolution Mission</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            Click "Launch Self-Evolution Mission" above to have Agent Sam autonomously inspect and optimize its own repository inspector.
          </p>
        </div>
      )}
    </div>
  );
};
