import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar } from 'lucide-react';
import { fetchBookingPages, publicBookingPageUrl, toDatetimeLocalValue, toSqlDatetime } from '../launch-desk/ops-desk-types';

export function BookPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [pages, setPages] = useState<Awaited<ReturnType<typeof fetchBookingPages>>>([]);
  const [loading, setLoading] = useState(true);
  const [startLocal, setStartLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const rows = await fetchBookingPages();
        if (!cancelled) setPages(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const page = useMemo(
    () => pages.find((p) => p.slug === slug) ?? null,
    [pages, slug],
  );

  useEffect(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    setStartLocal(toDatetimeLocalValue(d));
  }, [slug]);

  const submit = async () => {
    if (!page || !startLocal || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/book/${encodeURIComponent(page.slug)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_datetime: toSqlDatetime(startLocal) }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; join_url?: string };
      if (!res.ok) {
        setError(j.error || `Booking failed (${res.status})`);
        return;
      }
      setDone(true);
      if (j.join_url) {
        window.setTimeout(() => {
          window.location.href = j.join_url!;
        }, 1200);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="colab-book-page" aria-label="Book a meeting">
      <style>{`
.colab-book-page {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background: var(--dashboard-canvas, #0f1117);
  color: var(--color-main, #e2e8f0);
}
.colab-book-card {
  width: min(440px, 100%);
  padding: 24px;
  border-radius: 12px;
  border: 1px solid var(--dashboard-border, rgba(255,255,255,0.08));
  background: var(--bg-elevated, #1a1f2e);
}
.colab-book-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--color-muted, #94a3b8);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.colab-book-title { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.colab-book-meta { margin: 0 0 16px; font-size: 13px; color: var(--color-muted, #94a3b8); }
.colab-book-label { display: block; font-size: 12px; margin-bottom: 6px; color: var(--color-muted, #94a3b8); }
.colab-book-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.03));
  color: inherit;
  font-size: 14px;
  margin-bottom: 16px;
}
.colab-book-btn {
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: none;
  background: var(--solar-cyan, #22d3ee);
  color: #0f1117;
  font-weight: 600;
  cursor: pointer;
}
.colab-book-btn:disabled { opacity: 0.5; cursor: default; }
.colab-book-error { color: #f87171; font-size: 13px; margin-bottom: 12px; }
.colab-book-success { color: var(--solar-green, #4ade80); font-size: 14px; }
`}</style>
      <div className="colab-book-card">
        <button type="button" className="colab-book-back" onClick={() => navigate('/dashboard/collaborate')}>
          <ArrowLeft size={14} />
          Calendar
        </button>
        {loading ? (
          <p className="colab-book-meta">Loading booking page…</p>
        ) : !page ? (
          <>
            <h1 className="colab-book-title">Booking page not found</h1>
            <p className="colab-book-meta">
              No active page for <code>{slug}</code>.{' '}
              <Link to="/dashboard/collaborate">Return to calendar</Link>
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="colab-book-title">You&apos;re booked</h1>
            <p className="colab-book-success">Opening Meet when ready…</p>
          </>
        ) : (
          <>
            <h1 className="colab-book-title">{page.title}</h1>
            <p className="colab-book-meta">
              {page.duration_min} min
              {page.description ? ` · ${page.description}` : ''}
            </p>
            <label className="colab-book-label" htmlFor="book-start">
              Start time
            </label>
            <input
              id="book-start"
              type="datetime-local"
              className="colab-book-input"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            {error ? <p className="colab-book-error">{error}</p> : null}
            <button type="button" className="colab-book-btn" disabled={busy || !startLocal} onClick={() => void submit()}>
              <Calendar size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {busy ? 'Booking…' : 'Book session'}
            </button>
            <p className="colab-book-meta" style={{ marginTop: 12, fontSize: 11 }}>
              Share link: {publicBookingPageUrl(page.slug)}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default BookPage;
