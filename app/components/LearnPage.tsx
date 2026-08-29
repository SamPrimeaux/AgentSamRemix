import React, { useCallback, useEffect, useState } from 'react';
import LearningOS from './learn/LearningOS';
import type { LearnDashboardResponse } from './learn/learn.types';
import './learn/learn.css';

export default function LearnPage() {
  const [data, setData] = useState<LearnDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/learn/dashboard', { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: LearnDashboardResponse) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="learn-shell learn-loading-state">
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>loading courses...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="learn-shell learn-error-state">
        <div style={{ textAlign: 'center', color: 'var(--solar-red)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          <div>failed to load</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{error}</div>
          <button
            onClick={load}
            style={{
              marginTop: 12,
              padding: '4px 12px',
              fontSize: 12,
              color: 'var(--text-main)',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || !data.courses || data.courses.length === 0) {
    return (
      <div className="learn-shell learn-empty-state">
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>no courses available</div>
        </div>
      </div>
    );
  }

  return (
    <LearningOS data={data} onRefresh={load} />
  );
}

