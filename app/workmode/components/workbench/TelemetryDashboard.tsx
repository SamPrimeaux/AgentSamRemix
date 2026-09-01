import React from 'react';
import { TelemetryData, calculateCost } from '../../lib/telemetry';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface TelemetryDashboardProps {
  logs: TelemetryData[];
}

export const TelemetryDashboard: React.FC<TelemetryDashboardProps> = ({ logs }) => {
  const chartData = logs.map((log, index) => ({
    name: `Call ${index + 1}`,
    latency: log.latencyMs,
    cost: calculateCost(log.model, log.inputTokens, log.outputTokens)
  }));

  return (
    <div className="p-4 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
      <h2 className="text-lg font-bold">Telemetry Dashboard</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="latency" fill="#8884d8" name="Latency (ms)" />
            <Bar dataKey="cost" fill="#82ca9d" name="Cost ($)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr>
              <th className="p-2">Model</th>
              <th className="p-2">Latency (ms)</th>
              <th className="p-2">Tokens (In/Out)</th>
              <th className="p-2">Cost ($)</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, index) => (
              <tr key={index} className="border-t border-zinc-700">
                <td className="p-2">{log.model}</td>
                <td className="p-2">{log.latencyMs.toFixed(2)}</td>
                <td className="p-2">{log.inputTokens}/{log.outputTokens}</td>
                <td className="p-2">${calculateCost(log.model, log.inputTokens, log.outputTokens).toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
