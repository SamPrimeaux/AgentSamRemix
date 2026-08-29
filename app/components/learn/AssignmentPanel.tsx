import React, { useState, useRef } from 'react';
import type { Assignment, Submission, Grade, RubricCriterion, EvidenceFields } from './learn.types';

interface Props {
  assignment: Assignment;
  submission?: Submission;
  grade?: Grade;
  onSubmit: (assignmentId: string, evidence: object, timeSpent: number) => Promise<any>;
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export default function AssignmentPanel({ assignment, submission, grade, onSubmit }: Props) {
  const rubric = safeJson<{ criteria: RubricCriterion[] }>(assignment.rubric, { criteria: [] });
  const required = safeJson<string[]>(assignment.required_evidence, []);

  const [urls, setUrls] = useState<string[]>(required.map(() => ''));
  const [notes, setNotes] = useState('');
  const [commit, setCommit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startRef = useRef(Date.now());

  const canSubmit = urls.some((u) => u.trim()) || notes.trim() || commit.trim();

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const elapsed = Math.round((Date.now() - startRef.current) / 60000);
    const evidence: EvidenceFields = {
      urls: urls.filter((u) => u.trim()),
      notes: notes.trim(),
      github_commit: commit.trim(),
    };
    const result = await onSubmit(assignment.id, evidence, elapsed);
    if (!result?.ok) setSubmitError(result?.error ?? 'submission failed');
    setSubmitting(false);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          lineHeight: 1.75,
          marginBottom: 24,
          whiteSpace: 'pre-wrap',
        }}
      >
        {assignment.description}
      </div>

      {rubric.criteria.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 8,
            }}
          >
            grading rubric
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['criterion', 'weight', 'max', 'description'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      color: 'var(--text-muted)',
                      fontWeight: 400,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rubric.criteria.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--text-main)' }}>{c.name}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--solar-cyan)', fontFamily: 'var(--font-mono)' }}>
                    {Math.round(c.weight * 100)}%
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {c.max_score}
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>
                    {c.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {grade && (
        <div
          style={{
            padding: 16,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 28, fontWeight: 500, color: 'var(--solar-cyan)', fontFamily: 'var(--font-mono)' }}>
              {grade.score}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>/ {grade.max_score}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              graded by {grade.graded_by}
            </span>
          </div>
          {(() => {
            const scores = safeJson<Record<string, number>>(grade.rubric_scores, {});
            return Object.entries(scores).map(([name, score]) => {
              const criterion = rubric.criteria.find((c) => c.name === name);
              const max = criterion?.max_score ?? 100;
              return (
                <div key={name} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginBottom: 2,
                    }}
                  >
                    <span>{name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {score}/{max}
                    </span>
                  </div>
                  <div style={{ height: 3, background: 'var(--border-subtle)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        background: 'var(--solar-cyan)',
                        width: `${Math.min((score / max) * 100, 100)}%`,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>
              );
            });
          })()}
          {grade.feedback && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: 'var(--bg-app)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.6,
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {grade.feedback}
            </div>
          )}
        </div>
      )}

      {submission && !grade && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 12,
            color: 'var(--solar-yellow)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          submitted · awaiting review
        </div>
      )}

      {!grade && (
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            {submission ? 'update submission' : 'submit evidence'}
          </div>

          {required.map((label, i) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>
                {label}
              </div>
              <input
                type="text"
                placeholder={label.includes('url') || label.includes('URL') ? 'https://' : ''}
                value={urls[i] ?? ''}
                onChange={(e) =>
                  setUrls((prev) => {
                    const n = [...prev];
                    n[i] = e.target.value;
                    return n;
                  })
                }
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 12,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  color: 'var(--text-main)',
                  fontFamily: 'var(--font-mono)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>
              github commit (optional)
            </div>
            <input
              type="text"
              placeholder="abc1234 or full URL"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 12,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>
              notes
            </div>
            <textarea
              rows={3}
              placeholder="anything the grader should know"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 12,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {submitError && (
            <div style={{ fontSize: 12, color: 'var(--solar-red)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{
              padding: '7px 18px',
              fontSize: 13,
              background: canSubmit && !submitting ? 'var(--solar-cyan)' : 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              color: canSubmit && !submitting ? 'var(--bg-app)' : 'var(--text-muted)',
              cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-mono)',
              transition: 'all 0.15s',
            }}
          >
            {submitting ? 'submitting...' : submission ? 'resubmit' : 'submit'}
          </button>
        </div>
      )}
    </div>
  );
}

