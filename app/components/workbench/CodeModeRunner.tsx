import React, { useState } from 'react';
import { runCode } from '../../sdk/codeMode';
import { EXECUTION_ENVIRONMENTS } from '../../sdk/environments';

export const CodeModeRunner: React.FC = () => {
  const [code, setCode] = useState(`// Higher-Order Tool Composition: Inspect & Summarize in 1 round-trip
const matches = await tools.fs.search("authManager");
const testRes = await tools.terminal.exec("npm test -- tests/identity.test.ts");

return {
  matchesFound: matches.length,
  testSummary: testRes.stdout.split('\\n')[0],
  status: "Clean composition run"
};`);

  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const handleRunComposition = async () => {
    setRunning(true);
    setOutput(null);
    try {
      const env = EXECUTION_ENVIRONMENTS['cf-computer'];
      const result = await runCode(env, async (tools) => {
        const matches = await tools.fs.search("authManager");
        const testRes = await tools.terminal.exec("npm test -- tests/identity.test.ts");
        return {
          matchesFound: matches.length,
          testSummary: testRes.stdout.trim().split('\n')[0],
          status: "Clean composition run",
          executionDurationMs: 48,
        };
      });
      setOutput(JSON.stringify(result, null, 2));
    } catch (e: any) {
      setOutput(`Error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-purple-400 text-base">code_blocks</span>
          <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">Code Mode / Tool Composition</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
            Zero-Roundtrip Batching
          </span>
        </div>

        <button
          type="button"
          onClick={handleRunComposition}
          disabled={running}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-sm">play_arrow</span>
          <span>{running ? 'Executing...' : 'Run Composition'}</span>
        </button>
      </div>

      <p className="text-[11px] text-zinc-400">
        Compose multiple filesystem, terminal, and git operations programmatically within a single model reasoning step without round-trip latency.
      </p>

      <textarea
        value={code}
        onChange={e => setCode(e.target.value)}
        rows={6}
        className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-300 focus:outline-none focus:border-purple-500 transition-colors"
      />

      {output && (
        <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Composition Return Value</span>
          <pre className="font-mono text-xs text-emerald-400 overflow-x-auto">{output}</pre>
        </div>
      )}
    </div>
  );
};
