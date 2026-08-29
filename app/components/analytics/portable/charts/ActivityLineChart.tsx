import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type ActivityPoint = { day: string; runs?: number; daily_cost?: number };

type Props = {
  data: ActivityPoint[];
  dataKey: 'runs' | 'daily_cost';
  stroke?: string;
  height?: number;
};

/** Portable line chart — contract with cms-editor ActivityLineChart */
export function ActivityLineChart({
  data,
  dataKey,
  stroke = '#38bdf8',
  height = 200,
}: Props) {
  if (!data.length) {
    return <p className="text-[12px] text-muted">No activity in window.</p>;
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={stroke}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
