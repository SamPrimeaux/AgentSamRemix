import React, { useCallback, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Download, GraduationCap, Terminal, CheckCircle2, Dot, Circle, PanelRight, X, Pencil, GripVertical, FolderOpen } from 'lucide-react';
import MarkdownContent from './MarkdownContent';
import type {
  AssignmentWithState,
  Course,
  EvidenceFields,
  LearnDashboardResponse,
  Lesson,
  LessonProgress,
  ProgressStatus,
  RubricSchema,
} from './learn.types';
import { useLessonMarkdown } from './hooks/useLessonMarkdown';
import { LessonAssetsView } from './components/LessonAssetsView';

const openGlobalTerminal = () => window.dispatchEvent(new CustomEvent('iam:open-terminal'));
const sendToAgentSam = (message: string) =>
  window.dispatchEvent(new CustomEvent('iam-agent-external-send', { detail: { message } }));

function safeJson<T>(s: any, fallback: T): T {
  try {
    if (s == null) return fallback;
    if (typeof s === 'object') return s as T;
    return JSON.parse(String(s));
  } catch {
    return fallback;
  }
}

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '0%';
  return `${Math.round(Number(n) * 10) / 10}%`;
}

function findNextLesson(course: Course): Lesson | null {
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      if ((lesson.progress?.status || 'not_started') !== 'completed') return lesson;
    }
  }
  return course.modules[0]?.lessons?.[0] ?? null;
}

function statusPip(status: ProgressStatus | 'submitted' | 'graded') {
  if (status === 'graded') return <CheckCircle2 size={14} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} />;
  if (status === 'submitted') return <Dot size={16} style={{ color: 'var(--solar-yellow)', flexShrink: 0 }} />;
  if (status === 'completed') return <CheckCircle2 size={14} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} />;
  if (status === 'in_progress') return <Dot size={16} style={{ color: 'var(--solar-yellow)', flexShrink: 0 }} />;
  return <Circle size={14} style={{ color: 'var(--border-subtle)', flexShrink: 0 }} />;
}

function lessonDerivedStatus(lesson: Lesson) {
  const prog = lesson.progress?.status || 'not_started';
  const asg = lesson.assignments?.[0] || null;
  if (asg?.grade) return 'graded' as const;
  if (asg?.submission?.status === 'submitted') return 'submitted' as const;
  return prog;
}

function SectionTitle({ icon, title, right }: { icon?: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {icon ? <span style={{ color: 'var(--text-muted)' }}>{icon}</span> : null}
      <div
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {title}
      </div>
      <div style={{ marginLeft: 'auto' }}>{right}</div>
    </div>
  );
}

export default function LearningOS({ data, onRefresh }: { data: LearnDashboardResponse; onRefresh: () => void }) {
  const courses = data.courses || [];
  const [courseId, setCourseId] = useState<string>(() => courses[0]?.id || '');
  const [lessonId, setLessonId] = useState<string | null>(null);

  const course = useMemo(() => courses.find((c) => c.id === courseId) || courses[0] || null, [courses, courseId]);
  const lesson = useMemo(() => {
    if (!course) return null;
    if (!lessonId) return null;
    for (const m of course.modules) {
      const hit = m.lessons.find((l) => l.id === lessonId);
      if (hit) return hit;
    }
    return null;
  }, [course, lessonId]);

  const selectedLesson = lesson;
  const selectedCourse = course;

  const lessonStartRef = useRef<number | null>(null);

  const postProgress = useCallback(
    async (courseId: string, lesson: Lesson, status: ProgressStatus, extra?: Partial<LessonProgress>) => {
      const elapsed = lessonStartRef.current ? Math.round((Date.now() - lessonStartRef.current) / 60000) : 0;
      const body = {
        course_id: courseId,
        module_id: lesson.module_id,
        lesson_id: lesson.id,
        status,
        time_spent_minutes: extra?.time_spent_minutes != null ? extra.time_spent_minutes : elapsed,
        token_spend: extra?.token_spend ?? 0,
      };
      const r = await fetch('/api/learn/progress', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((x) => x.json()).catch(() => null);
      if (r?.ok) onRefresh();
      return r;
    },
    [onRefresh],
  );

  const postSubmission = useCallback(
    async (courseId: string, assignmentId: string, evidence: EvidenceFields, status: 'draft' | 'submitted') => {
      const elapsed = lessonStartRef.current ? Math.round((Date.now() - lessonStartRef.current) / 60000) : 0;
      const r = await fetch('/api/learn/submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignment_id: assignmentId,
          course_id: courseId,
          evidence,
          status,
          time_spent_minutes: elapsed,
        }),
      }).then((x) => x.json()).catch(() => null);
      if (r?.ok) onRefresh();
      return r;
    },
    [onRefresh],
  );

  // Select sensible defaults
  React.useEffect(() => {
    if (!selectedCourse) return;
    if (!courseId) setCourseId(selectedCourse.id);
  }, [selectedCourse, courseId]);

  const continueLesson = useMemo(() => (selectedCourse ? findNextLesson(selectedCourse) : null), [selectedCourse]);

  if (!selectedCourse) {
    return (
      <div className="learn-shell learn-empty-state">
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>no courses available</div>
      </div>
    );
  }

  const isAdmin = !!data?.viewer?.is_superadmin;
  const [collapsedModules, setCollapsedModules] = useState<Record<string, boolean>>({});
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'read' | 'lab' | 'assets' | 'submit' | 'feedback'>('overview');

  const effectiveTab =
    selectedLesson == null ? 'overview' : activeTab === 'overview' ? 'read' : activeTab;

  const lessonMarkdown = useLessonMarkdown(selectedLesson);

  return (
    <div className="learn-shell learn-layout">
      <aside className="learn-rail" aria-label="Learning navigation">
        <div className="learn-rail__header">
          <div className="learn-rail__title">
            <GraduationCap size={14} style={{ color: 'var(--text-muted)' }} />
            <span>Learning OS</span>
          </div>
          <button className="learn-rail__refresh" onClick={onRefresh}>
            refresh
          </button>
        </div>

        <div className="learn-rail__course">
          <select
            className="learn-select"
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setLessonId(null);
              setResourcesOpen(false);
              setActiveTab('overview');
            }}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          <div className="learn-rail__meta">
            <Badge label={`${selectedCourse.category ?? 'course'} · ${selectedCourse.level}`} />
            <Badge label={`${fmtPct(selectedCourse.progress_summary?.progress_percent)} complete`} />
          </div>

          {continueLesson ? (
            <button
              className="learn-rail__cta"
              onClick={() => {
                setLessonId(continueLesson.id);
                setActiveTab('read');
                lessonStartRef.current = Date.now();
              }}
            >
              <span className="learn-rail__ctaLabel">Continue</span>
              <span className="learn-rail__ctaLesson" title={continueLesson.title}>
                {continueLesson.title}
              </span>
              <ChevronRight size={16} style={{ marginLeft: 'auto', color: 'var(--solar-cyan)' }} />
            </button>
          ) : null}
        </div>

        <nav className="learn-rail__list" aria-label="Modules and lessons">
          {selectedCourse.modules.map((mod) => {
            const lessons = mod.lessons || [];
            const done = lessons.filter((l) => (l.progress?.status || 'not_started') === 'completed').length;
            const isCollapsed = !!collapsedModules[mod.id];
            return (
              <div key={mod.id} className="learn-module">
                <button
                  className="learn-module__header"
                  onClick={() =>
                    setCollapsedModules((p) => ({ ...p, [mod.id]: !p[mod.id] }))
                  }
                >
                  <div className="learn-module__title" title={mod.title}>
                    {mod.title}
                  </div>
                  <div className="learn-module__counts">
                    {done}/{lessons.length}
                  </div>
                </button>

                {!isCollapsed ? (
                  <div className="learn-module__lessons">
                    {lessons.map((l) => {
                      const isActive = l.id === lessonId;
                      const status = lessonDerivedStatus(l);
                      return (
                        <button
                          key={l.id}
                          className={`learn-lesson ${isActive ? 'is-active' : ''}`}
                          onClick={() => {
                            setLessonId(l.id);
                            setActiveTab('read');
                            lessonStartRef.current = Date.now();
                            if (l.progress?.status === 'not_started') {
                              postProgress(selectedCourse.id, l, 'in_progress', { time_spent_minutes: 0 });
                            }
                          }}
                        >
                          {statusPip(status)}
                          <span className="learn-lesson__title" title={l.title}>
                            {l.title}
                          </span>
                          {isAdmin ? (
                            <span className="learn-lesson__admin">
                              <GripVertical size={14} />
                              <Pencil size={13} />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="learn-rail__footer">
          <button
            className="learn-rail__overviewBtn"
            onClick={() => {
              setLessonId(null);
              setActiveTab('overview');
              setResourcesOpen(false);
            }}
          >
            Course overview
          </button>
        </div>
      </aside>

      <main className="learn-workspace">
        <div className="learn-workspace__topbar">
          <div className="learn-workspace__title">
            <BookOpen size={16} style={{ color: 'var(--text-muted)' }} />
            <div className="learn-workspace__titleText">
              <div className="learn-workspace__primary" title={selectedLesson ? selectedLesson.title : selectedCourse.title}>
                {selectedLesson ? selectedLesson.title : selectedCourse.title}
              </div>
              <div className="learn-workspace__secondary">
                {selectedLesson ? selectedCourse.title : `${selectedCourse.modules.length} modules · ${selectedCourse.progress_summary.total_lessons} lessons`}
              </div>
            </div>
          </div>

          <div className="learn-workspace__actions">
            {selectedLesson ? (
              <button
                className="learn-actionBtn learn-actionBtn--muted"
                onClick={() => {
                  const payload = [
                    `Course: ${selectedCourse.title} (${selectedCourse.slug})`,
                    `Module: ${selectedCourse.modules.find((m) => m.id === selectedLesson.module_id)?.title || selectedLesson.module_id}`,
                    `Lesson: ${selectedLesson.title} (${selectedLesson.slug})`,
                    selectedLesson.content_url ? `Content URL: ${selectedLesson.content_url}` : null,
                    selectedLesson.assets?.length ? `Assets: ${selectedLesson.assets.length}` : null,
                  ]
                    .filter(Boolean)
                    .join('\n');
                  sendToAgentSam(`Learning OS context\n\n${payload}`);
                }}
                title="Send lesson context to Agent Sam"
              >
                <FolderOpen size={14} />
                Send context
              </button>
            ) : null}

            {selectedLesson?.sandbox_query ? (
              <button className="learn-actionBtn learn-actionBtn--cyan" onClick={openGlobalTerminal} title="Open terminal">
                <Terminal size={14} />
                Open terminal
              </button>
            ) : null}

            <button
              className="learn-actionBtn learn-actionBtn--muted"
              onClick={() => setResourcesOpen(true)}
              title="Open course resources"
            >
              <PanelRight size={14} />
              Resources
            </button>
          </div>
        </div>

        {selectedLesson ? (
          <div className="learn-tabs" role="tablist" aria-label="Lesson tabs">
            {(['read', 'lab', 'assets', 'submit', 'feedback'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={effectiveTab === t}
                className={`learn-tab ${effectiveTab === t ? 'is-active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        ) : null}

        <div className="learn-workspace__content">
          {!selectedLesson ? (
            <CourseOverview course={selectedCourse} onContinue={() => continueLesson && setLessonId(continueLesson.id)} />
          ) : effectiveTab === 'assets' ? (
            <LessonAssetsView assets={selectedLesson.assets || []} />
          ) : effectiveTab === 'submit' || effectiveTab === 'feedback' ? (
            <div style={{ maxWidth: 900 }}>
              <AssignmentInspector
                course={selectedCourse}
                lesson={selectedLesson}
                onSaveDraft={(assignmentId, evidence) => postSubmission(selectedCourse.id, assignmentId, evidence, 'draft')}
                onSubmit={(assignmentId, evidence) => postSubmission(selectedCourse.id, assignmentId, evidence, 'submitted')}
              />
            </div>
          ) : effectiveTab === 'lab' ? (
            <div style={{ maxWidth: 900 }}>
              <SectionTitle title="Lab" icon={<Terminal size={14} />} />
              {selectedLesson.sandbox_query ? (
                <pre className="learn-pre">
                  <code>{selectedLesson.sandbox_query}</code>
                </pre>
              ) : (
                <div className="learn-muted">No lab instructions attached to this lesson yet.</div>
              )}
            </div>
          ) : (
            <div style={{ maxWidth: 1040 }}>
              <SectionTitle title="Read" icon={<BookOpen size={14} />} />
              {lessonMarkdown.loading ? <div className="learn-muted">Loading lesson content…</div> : null}
              {lessonMarkdown.error ? <div className="learn-error">{lessonMarkdown.error}</div> : null}
              {lessonMarkdown.markdown?.trim() ? (
                <MarkdownContent markdown={lessonMarkdown.markdown} />
              ) : (
                <div className="learn-muted">No lesson content found.</div>
              )}
            </div>
          )}
        </div>

        {resourcesOpen ? (
          <div className="learn-drawerBackdrop" onClick={() => setResourcesOpen(false)} role="presentation">
            <div className="learn-drawer" role="dialog" aria-label="Course resources" onClick={(e) => e.stopPropagation()}>
              <div className="learn-drawer__header">
                <div className="learn-drawer__title">
                  <Download size={14} style={{ color: 'var(--text-muted)' }} /> Course resources
                </div>
                <button className="learn-drawer__close" onClick={() => setResourcesOpen(false)} aria-label="Close resources">
                  <X size={16} />
                </button>
              </div>
              <div className="learn-drawer__body">
                <ExportsLibrary exports={selectedCourse.exports || []} />
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border-subtle)',
        padding: '3px 8px',
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--bg-panel) 80%, transparent)',
      }}
    >
      {label}
    </span>
  );
}

function actionButtonStyle(kind: 'muted' | 'cyan') {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    borderRadius: 10,
    border: '1px solid var(--border-subtle)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    background: 'transparent',
    color: 'var(--text-muted)',
  };
  if (kind === 'cyan') {
    return {
      ...base,
      border: '1px solid color-mix(in srgb, var(--solar-cyan) 65%, var(--border-subtle))',
      color: 'var(--solar-cyan)',
      background: 'color-mix(in srgb, var(--solar-cyan) 10%, transparent)',
    };
  }
  return base;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-panel) 86%, transparent)',
      }}
    >
      {children}
    </div>
  );
}

function CourseOverview({ course, onContinue }: { course: Course; onContinue: () => void }) {
  const totalModules = course.modules.length;
  const totalLessons = course.progress_summary?.total_lessons ?? 0;
  const totalAssignments = course.assignments?.length ?? 0;
  const totalExports = course.exports?.length ?? 0;
  return (
    <div className="learn-course-overview">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-main)', fontWeight: 700 }}>{course.title}</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{course.slug}</span>
      </div>

      {course.long_description ? (
        <div style={{ marginTop: 12 }}>
          <MarkdownContent markdown={course.long_description} />
        </div>
      ) : course.description ? (
        <div style={{ marginTop: 12, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>{course.description}</div>
      ) : null}

      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <Stat label="Modules" value={String(totalModules)} />
        <Stat label="Lessons" value={String(totalLessons)} />
        <Stat label="Assignments" value={String(totalAssignments)} />
        <Stat label="Exports" value={String(totalExports)} />
      </div>

      <div style={{ marginTop: 18 }}>
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Progress: <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{fmtPct(course.progress_summary?.progress_percent)}</span>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <button onClick={onContinue} style={actionButtonStyle('cyan')}>
                <ChevronRight size={14} /> Start / continue
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 18, color: 'var(--text-main)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  );
}

function ExportsLibrary({ exports }: { exports: Course['exports'] }) {
  if (!exports?.length) {
    return (
      <Card>
        <SectionTitle title="Course exports" icon={<Download size={14} />} />
        <div className="learn-resource-list" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No exports attached to this course yet.
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <SectionTitle title="Course exports" icon={<Download size={14} />} />
      <div className="learn-resource-list" style={{ display: 'grid', gap: 8 }}>
        {exports.slice(0, 20).map((ex) => (
          <a
            key={ex.id}
            href={ex.file_url || undefined}
            target={ex.file_url ? '_blank' : undefined}
            rel={ex.file_url ? 'noreferrer' : undefined}
            style={{
              textDecoration: 'none',
              display: 'block',
              padding: '10px 10px',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
            onClick={(e) => {
              if (!ex.file_url) e.preventDefault();
            }}
            title={ex.file_url || undefined}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--solar-cyan)' }}>{ex.export_type}</div>
              <div style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {ex.file_size ? `${Math.round(ex.file_size / 1024)}kb` : ''}
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {ex.file_url ? 'open file' : ex.r2_bucket && ex.r2_key ? `${ex.r2_bucket}/${ex.r2_key}` : 'no file_url'}
            </div>
          </a>
        ))}
      </div>
    </Card>
  );
}

function ProgressSummaryCard({ course, onContinue }: { course: Course; onContinue: () => void }) {
  return (
    <Card>
      <SectionTitle title="Progress" icon={<Dot size={14} />} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 28, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--solar-cyan)' }}>
          {fmtPct(course.progress_summary?.progress_percent)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {course.progress_summary?.completed_lessons ?? 0}/{course.progress_summary?.total_lessons ?? 0} lessons completed
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={onContinue} style={actionButtonStyle('cyan')}>
          <ChevronRight size={14} /> Continue
        </button>
      </div>
    </Card>
  );
}

function AssignmentInspector({
  course,
  lesson,
  onSaveDraft,
  onSubmit,
}: {
  course: Course;
  lesson: Lesson;
  onSaveDraft: (assignmentId: string, evidence: EvidenceFields) => Promise<any>;
  onSubmit: (assignmentId: string, evidence: EvidenceFields) => Promise<any>;
}) {
  const assignment: AssignmentWithState | null = lesson.assignments?.[0] || null;
  if (!assignment) {
    return (
      <Card>
        <SectionTitle title="Assignment" icon={<BookOpen size={14} />} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No assignment attached to this lesson.</div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Tip: attach a `course_assignments.lesson_id` to render an assignment here.
        </div>
      </Card>
    );
  }

  const rubric = safeJson<RubricSchema>(assignment.rubric, {});
  const required = safeJson<any>(assignment.required_evidence, []);
  const requiredLabels: string[] =
    Array.isArray(required) ? required.map((x) => String(x)) : typeof required === 'object' && required ? Object.keys(required) : [];

  const existingEvidence = safeJson<any>(assignment.submission?.evidence, null);
  const prefillUrls = (existingEvidence?.urls && Array.isArray(existingEvidence.urls) ? existingEvidence.urls : []) as string[];
  const prefillNotes = typeof existingEvidence?.notes === 'string' ? existingEvidence.notes : '';
  const prefillCommit = typeof existingEvidence?.github_commit === 'string' ? existingEvidence.github_commit : '';

  const [urls, setUrls] = React.useState<string[]>(() => (requiredLabels.length ? requiredLabels.map((_, i) => prefillUrls[i] || '') : prefillUrls));
  const [notes, setNotes] = React.useState<string>(prefillNotes);
  const [commit, setCommit] = React.useState<string>(prefillCommit);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const evidence: EvidenceFields = useMemo(
    () => ({ urls: urls.filter((u) => u.trim()), notes: notes.trim(), github_commit: commit.trim() }),
    [urls, notes, commit],
  );

  const canSubmit = evidence.urls.length > 0 || !!evidence.notes || !!evidence.github_commit;

  const grade = assignment.grade;
  const submission = assignment.submission;

  return (
    <div className="learn-assignment-panel">
    <Card>
      <SectionTitle title="Assignment" icon={<BookOpen size={14} />} right={<span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>max {assignment.max_score}</span>} />
      <div style={{ fontSize: 14, color: 'var(--text-main)', fontWeight: 700 }}>{assignment.title}</div>
      {assignment.description ? <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{assignment.description}</div> : null}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge label={assignment.type || 'deliverable'} />
        {assignment.due_offset_days != null ? <Badge label={`due day ${assignment.due_offset_days}`} /> : null}
        {submission?.status ? <Badge label={`submission: ${submission.status}`} /> : null}
        {grade?.graded_at ? <Badge label="graded" /> : null}
      </div>

      {rubric && (rubric.criteria?.length || rubric.pass_score != null || rubric.distinction_score != null) ? (
        <div style={{ marginTop: 16 }}>
          <SectionTitle title="Rubric" icon={<Dot size={14} />} />
          <div className="learn-rubric-grid">
            <RubricView rubric={rubric} grade={grade} />
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <SectionTitle title="Evidence" icon={<ChevronRight size={14} />} />
        {requiredLabels.length ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {requiredLabels.map((label, i) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {label}
                </div>
                <input
                  value={urls[i] ?? ''}
                  onChange={(e) =>
                    setUrls((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder={label.toLowerCase().includes('url') ? 'https://' : ''}
                  style={inputStyle()}
                />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No required_evidence labels defined. You can still submit URLs/notes.</div>
        )}

        <div style={{ marginTop: 10 }}>
          <div style={fieldLabelStyle()}>github commit (optional)</div>
          <input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="abc1234 or full URL" style={inputStyle()} />
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={fieldLabelStyle()}>notes</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="context for the reviewer" style={textareaStyle()} />
        </div>
      </div>

      {err ? <div style={{ marginTop: 10, fontSize: 12, color: 'var(--solar-red)', fontFamily: 'var(--font-mono)' }}>{err}</div> : null}

      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const r = await onSaveDraft(assignment.id, evidence);
            if (!r?.ok) setErr(r?.error || 'failed to save draft');
            setBusy(false);
          }}
          disabled={!canSubmit || busy}
          style={{ ...actionButtonStyle('muted'), opacity: !canSubmit || busy ? 0.6 : 1 }}
        >
          Save draft
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const r = await onSubmit(assignment.id, evidence);
            if (!r?.ok) setErr(r?.error || 'submission failed');
            setBusy(false);
          }}
          disabled={!canSubmit || busy}
          style={{ ...actionButtonStyle('cyan'), opacity: !canSubmit || busy ? 0.6 : 1 }}
        >
          Submit
        </button>
      </div>

      {grade ? (
        <div style={{ marginTop: 16 }}>
          <SectionTitle title="Grade" icon={<CheckCircle2 size={14} />} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 30, color: 'var(--solar-cyan)', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
              {grade.score ?? '-'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>/ {grade.max_score ?? assignment.max_score}</div>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {grade.graded_by ? `graded by ${grade.graded_by}` : 'graded'}
            </div>
          </div>
          {grade.feedback ? (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
              {grade.feedback}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>No feedback attached.</div>
          )}
        </div>
      ) : submission?.status === 'submitted' ? (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--solar-yellow)', fontFamily: 'var(--font-mono)' }}>
          submitted · awaiting review
        </div>
      ) : null}
    </Card>
    </div>
  );
}

function RubricView({ rubric, grade }: { rubric: RubricSchema; grade: any }) {
  const criteria = Array.isArray(rubric.criteria) ? rubric.criteria : [];
  const scores = safeJson<Record<string, number>>(grade?.rubric_scores, {});
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {rubric.scale?.min != null || rubric.scale?.max != null ? (
          <Badge label={`scale ${rubric.scale?.min ?? 0}-${rubric.scale?.max ?? 5}`} />
        ) : (
          <Badge label="scale 0-5" />
        )}
        {rubric.pass_score != null ? <Badge label={`pass ${rubric.pass_score}`} /> : null}
        {rubric.distinction_score != null ? <Badge label={`distinction ${rubric.distinction_score}`} /> : null}
      </div>

      {criteria.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['criterion', 'weight', 'max', 'score'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {criteria.map((c, i) => {
              const name = String(c.name || c.label || `criterion_${i}`);
              const max = c.max_score ?? 5;
              const score = scores?.[name];
              return (
                <tr key={name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '7px 8px', color: 'var(--text-main)', fontWeight: 600 }}>{name}</td>
                  <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {c.weight != null ? `${Math.round(c.weight * 100)}%` : '—'}
                  </td>
                  <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{max}</td>
                  <td style={{ padding: '7px 8px', color: score != null ? 'var(--solar-cyan)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {score != null ? String(score) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No rubric criteria configured.</div>
      )}
    </div>
  );
}

function fieldLabelStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '7px 10px',
    fontSize: 12,
    background: 'var(--bg-app)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 10,
    color: 'var(--text-main)',
    fontFamily: 'var(--font-mono)',
    boxSizing: 'border-box',
  };
}

function textareaStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '7px 10px',
    fontSize: 12,
    background: 'var(--bg-app)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 10,
    color: 'var(--text-main)',
    fontFamily: 'var(--font-mono)',
    boxSizing: 'border-box',
    resize: 'vertical',
  };
}

