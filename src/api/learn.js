/**
 * Learn API
 * Handles /api/learn/* — course dashboard, progress tracking, assignment submission.
 * All routes are auth-gated. All queries are scoped to authUser.id.
 * Zero cross-tenant data exposure.
 */
import {
  getAuthUser,
  jsonResponse,
  fetchAuthUserTenantId,
} from '../core/auth.js';

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(String(text || ''));
  } catch (_) {
    return fallback;
  }
}

const LEARN_TABLES = new Set([
  'courses',
  'course_modules',
  'course_lessons',
  'lessons',
  'lesson_assets',
  'lesson_versions',
  'enrollments',
  'course_progress',
  'course_assignments',
  'course_submissions',
  'course_grades',
  'course_exports',
]);

const __schemaCache = new Map();

async function tableExists(env, tableName) {
  if (!env?.DB) return false;
  if (!LEARN_TABLES.has(tableName)) return false;
  const k = `exists:${tableName}`;
  if (__schemaCache.has(k)) return __schemaCache.get(k);
  try {
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    )
      .bind(tableName)
      .first();
    const ok = !!row?.name;
    __schemaCache.set(k, ok);
    return ok;
  } catch {
    __schemaCache.set(k, false);
    return false;
  }
}

async function tableColumns(env, tableName) {
  if (!env?.DB) return [];
  if (!LEARN_TABLES.has(tableName)) return [];
  const k = `cols:${tableName}`;
  if (__schemaCache.has(k)) return __schemaCache.get(k);
  try {
    const res = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
    const cols = (res?.results || [])
      .map((r) => String(r?.name || '').trim())
      .filter(Boolean);
    __schemaCache.set(k, cols);
    return cols;
  } catch {
    __schemaCache.set(k, []);
    return [];
  }
}

function pickExistingCols(existingCols, desiredCols) {
  const set = new Set((existingCols || []).map((c) => String(c)));
  return (desiredCols || []).filter((c) => set.has(c));
}

/**
 * User ids to match LMS enrollments / progress. Superadmins may have rows keyed by `auth_users.id`
 * (e.g. `au_*`) while the session uses `users.id` (`usr_*`) — include tenant superadmin auth ids.
 */
async function learnEnrollmentUserIds(env, authUser) {
  const ids = new Set();
  const primary = String(authUser?.id || '').trim();
  if (primary) ids.add(primary);
  return [...ids];
}

export async function handleLearnApi(request, url, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/learn/dashboard' && method === 'GET')
    return handleLearnDashboard(request, env, authUser);
  if (path === '/api/learn/progress' && method === 'POST')
    return handleLearnProgress(request, env, authUser);
  if (path === '/api/learn/submit' && method === 'POST')
    return handleLearnSubmit(request, env, authUser);

  return jsonResponse({ error: 'Not found' }, 404);
}

// ---------------------------------------------------------------------------
// GET /api/learn/dashboard
// Returns everything LearnPage needs in a single response.
// ---------------------------------------------------------------------------
async function handleLearnDashboard(_request, env, authUser) {
  if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 500);
  const uidScope = await learnEnrollmentUserIds(env, authUser);

  // Note: even if enrollments are missing, we still return visible courses with default progress.
  const uidPh = uidScope.length ? uidScope.map(() => '?').join(',') : '?';
  const uidScopeBind = uidScope.length ? uidScope : ['__no_user__'];

  // 1) Enrollments (if any)
  const enrollmentRows = await env.DB.prepare(
    `
      SELECT
        e.id            AS enrollment_id,
        e.course_id,
        e.enrollment_type,
        e.status        AS enrollment_status,
        e.progress_percent,
        e.started_at,
        e.metadata      AS enrollment_meta,
        e.user_id       AS enrollment_user_id,
        c.id            AS id,
        c.org_id,
        c.title,
        c.slug,
        c.description,
        c.long_description,
        c.thumbnail_url,
        c.category,
        c.level,
        c.duration_hours,
        c.status,
        c.instructor_id,
        c.metadata
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.user_id IN (${uidPh}) AND e.status = 'active'
      ORDER BY e.created_at ASC
    `,
  )
    .bind(...uidScopeBind)
    .all();

  const enrollments = enrollmentRows.results ?? [];
  const enrolledCourseIds = [...new Set(enrollments.map((e) => String(e.course_id)).filter(Boolean))];

  // 2) Visible courses
  let courseRows;
  if (enrolledCourseIds.length) {
    const cph = enrolledCourseIds.map(() => '?').join(',');
    courseRows = await env.DB.prepare(
      `
        SELECT
          id, org_id, title, slug, description, long_description, thumbnail_url,
          category, level, duration_hours, status, instructor_id, metadata,
          created_at, updated_at, published_at, is_public
        FROM courses
        WHERE id IN (${cph}) OR (COALESCE(is_public, 0) = 1 AND status = 'published')
        ORDER BY COALESCE(published_at, updated_at, created_at) DESC
        LIMIT 250
      `,
    )
      .bind(...enrolledCourseIds)
      .all();
  } else {
    courseRows = await env.DB.prepare(
      `
        SELECT
          id, org_id, title, slug, description, long_description, thumbnail_url,
          category, level, duration_hours, status, instructor_id, metadata,
          created_at, updated_at, published_at, is_public
        FROM courses
        WHERE COALESCE(is_public, 0) = 1 AND status = 'published'
        ORDER BY COALESCE(published_at, updated_at, created_at) DESC
        LIMIT 250
      `,
    ).all();
  }

  const coursesFlat = courseRows?.results ?? [];
  const courseIds = [...new Set(coursesFlat.map((c) => String(c.id)).filter(Boolean))];

  if (!courseIds.length) {
    return jsonResponse({
      ok: true,
      courses: [],
    });
  }

  const ph = courseIds.map(() => '?').join(',');

  // 3–9) Pull the rest of the data, then normalize server-side.
  // Migrated 2026-08-02: `modules`/`lessons` are now the single source of truth.
  // Legacy `course_modules`/`course_lessons` content was migrated in and the
  // dual-schema tableExists()/fallback dance was retired -- see
  // course_modules_backup_20260802 / course_lessons_backup_20260802 for the
  // pre-migration snapshot if anything needs to be cross-checked.
  const hasLessonAssetsTable = await tableExists(env, 'lesson_assets');
  const lessonAssetsCols = hasLessonAssetsTable ? await tableColumns(env, 'lesson_assets') : [];

  const [
    modRows,
    lessonsRows,
    asgRows,
    expRows,
    progRows,
    subRows,
    gradeRows,
  ] = await Promise.all([
    env.DB.prepare(
      `
        SELECT id, course_id, title, description,
               order_index, is_required, estimated_minutes
        FROM modules
        WHERE course_id IN (${ph})
        ORDER BY course_id, order_index ASC
      `,
    )
      .bind(...courseIds)
      .all(),

    env.DB.prepare(
      `
        SELECT id, course_id, module_id, title, slug, description,
               content_type, content_url, content_text, type,
               content, content_format, has_content, sandbox_query, sandbox_db,
               order_index, estimated_minutes, is_required, is_published,
               published_at, created_at, updated_at
        FROM lessons
        WHERE course_id IN (${ph})
        ORDER BY course_id, order_index ASC
      `,
    )
      .bind(...courseIds)
      .all(),

    env.DB.prepare(
      `
        SELECT id, course_id, module_id, lesson_id, title, description,
               type, rubric, max_score, required_evidence, due_offset_days, is_graded
        FROM course_assignments
        WHERE course_id IN (${ph})
      `,
    )
      .bind(...courseIds)
      .all(),

    env.DB.prepare(
      `
        SELECT id, course_id, export_type, file_url, r2_key, r2_bucket,
               file_size, metadata, created_by, created_at
        FROM course_exports
        WHERE course_id IN (${ph})
        ORDER BY created_at DESC
      `,
    )
      .bind(...courseIds)
      .all(),

    env.DB.prepare(
      `
        SELECT enrollment_id, user_id, course_id, lesson_id, module_id, status,
               completed_at, time_spent_minutes, token_spend
        FROM course_progress
        WHERE user_id IN (${uidPh}) AND course_id IN (${ph})
      `,
    )
      .bind(...uidScopeBind, ...courseIds)
      .all(),

    env.DB.prepare(
      `
        SELECT id, assignment_id, enrollment_id, user_id, course_id, status, evidence,
               submitted_at, time_spent_minutes, token_spend
        FROM course_submissions
        WHERE user_id IN (${uidPh}) AND course_id IN (${ph})
      `,
    )
      .bind(...uidScopeBind, ...courseIds)
      .all(),

    env.DB.prepare(
      `
        SELECT id, submission_id, assignment_id, user_id, enrollment_id,
               score, max_score, rubric_scores, time_score, efficiency_score,
               graded_by, feedback, graded_at
        FROM course_grades
        WHERE user_id IN (${uidPh})
      `,
    )
      .bind(...uidScopeBind)
      .all(),
  ]);

  const modulesFlat = modRows?.results ?? [];
  const lessonsRaw = lessonsRows?.results ?? [];
  const assignmentsFlat = asgRows?.results ?? [];
  const exportsFlat = expRows?.results ?? [];
  const progressFlat = progRows?.results ?? [];
  const submissionsFlat = subRows?.results ?? [];
  const gradesFlat = gradeRows?.results ?? [];

  // Normalize lessons to a stable shape. Single source (`lessons`) as of the
  // 2026-08-02 migration -- no more dual-schema merge.
  const lessonsFlat = lessonsRaw
    .map((l) => {
      const id = String(l?.id || '').trim();
      if (!id) return null;
      const slug = String(l?.slug || id).trim();
      // Prefer the new `content` column (migrated from legacy course_lessons);
      // fall back to the older `content_text` column if that's what's set.
      const contentText =
        l?.has_content && l?.content != null && String(l.content).trim() !== ''
          ? String(l.content)
          : (l?.content_text ?? null);
      return {
        id,
        course_id: String(l?.course_id || '').trim(),
        module_id: String(l?.module_id || '').trim(),
        title: l?.title || '',
        slug,
        description: l?.description || '',
        content_type: String(l?.content_format || l?.content_type || 'markdown').toLowerCase(),
        content_url: l?.content_url ?? null,
        content_text: contentText,
        order_index: l?.order_index ?? 0,
        estimated_minutes: l?.estimated_minutes ?? 0,
        is_required: l?.is_required ?? 1,
        is_published: l?.is_published ?? 1,
        assets: [],
        type: l?.type || 'lesson',
        sandbox_query: l?.sandbox_query ?? null,
        sandbox_db: l?.sandbox_db ?? 'd1',
      };
    })
    .filter((l) => l?.course_id);

  // Attach lesson_assets by lesson_id (canonical).
  const assetsFlat = [];
  const lessonIds = lessonsFlat.map((l) => l.id).filter(Boolean);
  if (hasLessonAssetsTable && lessonIds.length) {
    const lph = lessonIds.map(() => '?').join(',');
    const assetSelect = pickExistingCols(lessonAssetsCols, [
      'id',
      'lesson_id',
      'asset_type',
      'asset_url',
      'r2_key',
      'r2_bucket',
      'file_name',
      'file_size',
      'mime_type',
      'order_index',
      'created_at',
      'updated_at',
    ]);
    if (assetSelect.length) {
      try {
        const res = await env.DB.prepare(
          `
            SELECT ${assetSelect.join(', ')}
            FROM lesson_assets
            WHERE lesson_id IN (${lph})
            ORDER BY lesson_id, COALESCE(order_index, 0) ASC
          `,
        )
          .bind(...lessonIds)
          .all();
        assetsFlat.push(...(res?.results ?? []));
      } catch (_) {
        /* ignore */
      }
    }
  }

  const assetsByLesson = new Map();
  for (const a of assetsFlat) {
    const lid = String(a?.lesson_id || '').trim();
    if (!lid) continue;
    if (!assetsByLesson.has(lid)) assetsByLesson.set(lid, []);
    assetsByLesson.get(lid).push({
      id: a?.id ? String(a.id) : null,
      lesson_id: lid,
      asset_type: a?.asset_type ? String(a.asset_type) : 'asset',
      asset_url: a?.asset_url ?? null,
      r2_key: a?.r2_key ?? null,
      r2_bucket: a?.r2_bucket ?? null,
      file_name: a?.file_name ?? null,
      file_size: a?.file_size ?? null,
      mime_type: a?.mime_type ?? null,
      order_index: a?.order_index ?? 0,
    });
  }

  for (const l of lessonsFlat) {
    const lid = String(l.id);
    l.assets = (assetsByLesson.get(lid) || []).slice();
  }

  // Indexes
  const enrollmentByCourseId = new Map();
  for (const e of enrollments) enrollmentByCourseId.set(String(e.course_id), e);

  const modsByCourse = new Map();
  for (const m of modulesFlat) {
    const cid = String(m.course_id);
    if (!modsByCourse.has(cid)) modsByCourse.set(cid, []);
    modsByCourse.get(cid).push(m);
  }

  const lessonsByCourse = new Map();
  const lessonsByModule = new Map();
  for (const l of lessonsFlat) {
    const cid = String(l.course_id);
    const mid = String(l.module_id);
    if (!lessonsByCourse.has(cid)) lessonsByCourse.set(cid, []);
    lessonsByCourse.get(cid).push(l);
    if (!lessonsByModule.has(mid)) lessonsByModule.set(mid, []);
    lessonsByModule.get(mid).push(l);
  }

  const assignmentsByCourse = new Map();
  const assignmentsByLesson = new Map();
  const assignmentsByModule = new Map();
  for (const a of assignmentsFlat) {
    const cid = String(a.course_id);
    const mid = String(a.module_id);
    const lid = a.lesson_id ? String(a.lesson_id) : null;
    if (!assignmentsByCourse.has(cid)) assignmentsByCourse.set(cid, []);
    assignmentsByCourse.get(cid).push(a);
    if (!assignmentsByModule.has(mid)) assignmentsByModule.set(mid, []);
    assignmentsByModule.get(mid).push(a);
    if (lid) {
      if (!assignmentsByLesson.has(lid)) assignmentsByLesson.set(lid, []);
      assignmentsByLesson.get(lid).push(a);
    }
  }

  const exportsByCourse = new Map();
  for (const ex of exportsFlat) {
    const cid = String(ex.course_id);
    if (!exportsByCourse.has(cid)) exportsByCourse.set(cid, []);
    exportsByCourse.get(cid).push(ex);
  }

  const progressByLessonKey = new Map();
  for (const p of progressFlat) {
    const key = `${String(p.course_id)}:${String(p.lesson_id)}`;
    progressByLessonKey.set(key, p);
  }

  const submissionsByAssignment = new Map();
  for (const s of submissionsFlat) submissionsByAssignment.set(String(s.assignment_id), s);

  const gradesByAssignment = new Map();
  for (const g of gradesFlat) gradesByAssignment.set(String(g.assignment_id), g);

  const courses = coursesFlat.map((c) => {
    const cid = String(c.id);
    const enrollment = enrollmentByCourseId.get(cid) || null;
    const courseModules = (modsByCourse.get(cid) || []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const courseLessons = (lessonsByCourse.get(cid) || []).slice();
    const totalLessons = courseLessons.length;
    const completedLessons = courseLessons.filter((l) => {
      const key = `${cid}:${String(l.id)}`;
      return progressByLessonKey.get(key)?.status === 'completed';
    }).length;
    const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100 * 10) / 10 : 0;

    const modules = courseModules.map((m) => {
      const mid = String(m.id);
      const lessons = (lessonsByModule.get(mid) || [])
        .slice()
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        .map((l) => {
          const lid = String(l.id);
          const p = progressByLessonKey.get(`${cid}:${lid}`) || null;
          const attachedAssignments = assignmentsByLesson.get(lid) || [];
          return {
            id: lid,
            course_id: cid,
            module_id: String(l.module_id),
            title: l.title,
            slug: l.slug || lid,
            description: l.description || '',
            content_type: l.content_type || 'markdown',
            content_url: l.content_url ?? null,
            content_text: l.content_text ?? null,
            order_index: l.order_index ?? 0,
            estimated_minutes: l.estimated_minutes ?? 0,
            is_required: l.is_required ?? 1,
            is_published: l.is_published ?? 0,
            assets: Array.isArray(l.assets) ? l.assets : [],
            progress: p
              ? {
                  status: p.status || 'not_started',
                  completed_at: p.completed_at ?? null,
                  time_spent_minutes: p.time_spent_minutes ?? 0,
                  token_spend: p.token_spend ?? 0,
                }
              : {
                  status: 'not_started',
                  completed_at: null,
                  time_spent_minutes: 0,
                  token_spend: 0,
                },
            assignments: attachedAssignments.map((a) => {
              const asgId = String(a.id);
              const submission = submissionsByAssignment.get(asgId) || null;
              const grade = gradesByAssignment.get(asgId) || null;
              return {
                ...a,
                submission,
                grade,
              };
            }),
            type: l.type ?? 'lesson',
            sandbox_query: l.sandbox_query ?? null,
            sandbox_db: l.sandbox_db ?? null,
          };
        });

      const moduleAssignments = assignmentsByModule.get(mid) || [];
      return {
        id: mid,
        course_id: cid,
        title: m.title,
        description: m.description || '',
        order_index: m.order_index ?? 0,
        is_required: m.is_required ?? 1,
        estimated_minutes: m.estimated_minutes ?? 0,
        lessons,
        assignments: moduleAssignments.map((a) => {
          const asgId = String(a.id);
          return {
            ...a,
            submission: submissionsByAssignment.get(asgId) || null,
            grade: gradesByAssignment.get(asgId) || null,
          };
        }),
      };
    });

    const allAssignments = (assignmentsByCourse.get(cid) || []).map((a) => {
      const asgId = String(a.id);
      return {
        ...a,
        submission: submissionsByAssignment.get(asgId) || null,
        grade: gradesByAssignment.get(asgId) || null,
      };
    });

    return {
      id: cid,
      org_id: c.org_id ?? null,
      title: c.title,
      slug: c.slug,
      description: c.description || '',
      long_description: c.long_description || '',
      thumbnail_url: c.thumbnail_url || null,
      category: c.category || null,
      level: c.level || 'beginner',
      duration_hours: c.duration_hours ?? null,
      status: c.status || null,
      instructor_id: c.instructor_id || null,
      metadata: safeJsonParse(c.metadata, {}),
      enrollment: enrollment
        ? {
            id: enrollment.enrollment_id,
            status: enrollment.enrollment_status,
            enrollment_type: enrollment.enrollment_type,
            progress_percent: enrollment.progress_percent ?? progressPercent,
            started_at: enrollment.started_at ?? null,
            metadata: safeJsonParse(enrollment.enrollment_meta, {}),
          }
        : null,
      progress_summary: {
        total_lessons: totalLessons,
        completed_lessons: completedLessons,
        progress_percent: enrollment?.progress_percent ?? progressPercent,
      },
      modules,
      assignments: allAssignments,
      exports: (exportsByCourse.get(cid) || []).map((ex) => ({
        ...ex,
        metadata: safeJsonParse(ex.metadata, {}),
      })),
      submissions: submissionsFlat.filter((s) => String(s.course_id) === cid),
      grades: gradesFlat,
    };
  });

  return jsonResponse({
    ok: true,
    viewer: {
      is_superadmin: false,
    },
    courses,
    course_modules: modulesFlat,
    lessons: lessonsFlat,
    lesson_assets: assetsFlat,
    lesson_versions: [],
    lesson_progress: progressFlat,
    course_assignments: assignmentsFlat,
    course_submissions: submissionsFlat,
    course_grades: gradesFlat,
    course_exports: exportsFlat,
  });
}

// ---------------------------------------------------------------------------
// POST /api/learn/progress
// Body: { course_id, module_id?, lesson_id, status, time_spent_minutes?, token_spend? }
// ---------------------------------------------------------------------------
async function handleLearnProgress(request, env, authUser) {
  if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 500);
  const uidScope = await learnEnrollmentUserIds(env, authUser);
  if (!uidScope.length) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const { lesson_id, course_id, status } = body || {};
  if (!lesson_id || !course_id || !status)
    return jsonResponse({ error: 'lesson_id, course_id, status required' }, 400);

  const validStatuses = ['not_started', 'in_progress', 'completed'];
  if (!validStatuses.includes(status))
    return jsonResponse({ error: 'Invalid status' }, 400);

  const timeSpent = Number(body.time_spent_minutes) || 0;
  const tokenSpend = Number(body.token_spend) || 0;

  // Validate lesson belongs to course and resolve module_id.
  // Single source (`lessons`) as of the 2026-08-02 migration.
  const lesson = await env.DB.prepare(
    `SELECT id, module_id, course_id FROM lessons WHERE id = ? AND course_id = ? LIMIT 1`,
  )
    .bind(lesson_id, course_id)
    .first();
  if (!lesson) return jsonResponse({ error: 'Lesson not found' }, 404);

  const moduleId = String(body?.module_id || lesson.module_id || '').trim();
  if (!moduleId) return jsonResponse({ error: 'module_id required' }, 400);

  // Ensure enrollment exists (create if missing).
  const primaryUserId = String(authUser?.id || '').trim();
  const tenantId = authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
    ? String(authUser.tenant_id).trim()
    : null;

  let enrollment = await env.DB.prepare(
    `SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(primaryUserId, course_id)
    .first();

  if (!enrollment) {
    const enrId = `enr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    try {
      await env.DB.prepare(
        `INSERT INTO enrollments
           (id, user_id, course_id, tenant_id, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch(), unixepoch())`,
      )
        .bind(enrId, primaryUserId, course_id, tenantId)
        .run();
      enrollment = { id: enrId };
    } catch (_) {
      // Fallback for older schemas missing some columns.
      await env.DB.prepare(
        `INSERT INTO enrollments (user_id, course_id, tenant_id, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', unixepoch(), unixepoch(), unixepoch())`,
      )
        .bind(primaryUserId, course_id, tenantId)
        .run();
      enrollment = await env.DB.prepare(
        `SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
      )
        .bind(primaryUserId, course_id)
        .first();
    }
  }

  const enrollmentId = String(enrollment?.id || '').trim();
  if (!enrollmentId) return jsonResponse({ error: 'Enrollment missing' }, 500);

  // Upsert progress row (keyed by UNIQUE(enrollment_id, lesson_id)).
  const progId = `prg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `
      INSERT OR IGNORE INTO course_progress
        (id, enrollment_id, user_id, course_id, lesson_id, module_id, status,
         completed_at, time_spent_minutes, token_spend, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'not_started',
              NULL, 0, 0, unixepoch(), unixepoch())
    `,
  )
    .bind(progId, enrollmentId, primaryUserId, course_id, lesson_id, moduleId)
    .run();

  await env.DB.prepare(
    `
      UPDATE course_progress
      SET
        status             = ?,
        time_spent_minutes = time_spent_minutes + ?,
        token_spend        = token_spend + ?,
        completed_at       = CASE WHEN ? = 'completed' THEN unixepoch() ELSE completed_at END,
        updated_at         = unixepoch()
      WHERE enrollment_id = ? AND lesson_id = ? AND course_id = ?
    `,
  )
    .bind(status, timeSpent, tokenSpend, status, enrollmentId, lesson_id, course_id)
    .run();

  // Recalculate enrollment progress_percent
  const [completedRow, totalRow] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM course_progress
      WHERE enrollment_id = ? AND course_id = ? AND status = 'completed'
    `).bind(enrollmentId, course_id).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM course_progress
      WHERE enrollment_id = ? AND course_id = ?
    `).bind(enrollmentId, course_id).first(),
  ]);

  const completed = completedRow?.n ?? 0;
  const total = totalRow?.n ?? 1;
  const newPercent = Math.round((completed / total) * 100 * 10) / 10;

  try {
    await env.DB.prepare(
      `UPDATE enrollments SET progress_percent = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
      .bind(newPercent, enrollmentId)
      .run();
  } catch (_) {
    /* ignore if column missing */
  }

  const updated = await env.DB.prepare(
    `
      SELECT enrollment_id, user_id, course_id, lesson_id, module_id, status,
             completed_at, time_spent_minutes, token_spend
      FROM course_progress
      WHERE enrollment_id = ? AND lesson_id = ? AND course_id = ?
      LIMIT 1
    `,
  )
    .bind(enrollmentId, lesson_id, course_id)
    .first();

  return jsonResponse({
    ok: true,
    progress_percent: newPercent,
    progress: updated || null,
  });
}

// ---------------------------------------------------------------------------
// POST /api/learn/submit
// Body: { assignment_id, course_id, evidence: {urls,notes,github_commit}, time_spent_minutes?, token_spend? }
// ---------------------------------------------------------------------------
async function handleLearnSubmit(request, env, authUser) {
  if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 500);
  const uidScope = await learnEnrollmentUserIds(env, authUser);
  if (!uidScope.length) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const { assignment_id, course_id, evidence } = body || {};
  if (!assignment_id || !course_id || !evidence)
    return jsonResponse({ error: 'assignment_id, course_id, evidence required' }, 400);

  // Verify assignment belongs to this course
  const assignment = await env.DB.prepare(
    `SELECT id FROM course_assignments WHERE id = ? AND course_id = ? LIMIT 1`,
  )
    .bind(assignment_id, course_id)
    .first();
  if (!assignment) return jsonResponse({ error: 'Assignment not found' }, 404);

  // Ensure enrollment exists (create if missing) so submissions are tied to an enrollment_id.
  const primaryUserId = String(authUser?.id || '').trim();
  const tenantId = authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
    ? String(authUser.tenant_id).trim()
    : null;
  let enrollment = await env.DB.prepare(
    `SELECT id, user_id FROM enrollments WHERE user_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(primaryUserId, course_id)
    .first();
  if (!enrollment) {
    const enrId = `enr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    try {
      await env.DB.prepare(
        `INSERT INTO enrollments
           (id, user_id, course_id, tenant_id, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch(), unixepoch())`,
      )
        .bind(enrId, primaryUserId, course_id, tenantId)
        .run();
      enrollment = { id: enrId, user_id: primaryUserId };
    } catch (_) {
      await env.DB.prepare(
        `INSERT INTO enrollments (user_id, course_id, tenant_id, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', unixepoch(), unixepoch(), unixepoch())`,
      )
        .bind(primaryUserId, course_id, tenantId)
        .run();
      enrollment = await env.DB.prepare(
        `SELECT id, user_id FROM enrollments WHERE user_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
      )
        .bind(primaryUserId, course_id)
        .first();
    }
  }

  const submissionUserId = String(enrollment?.user_id || authUser.id || '').trim();
  const enrollmentId = String(enrollment?.id || '').trim();
  if (!enrollmentId) return jsonResponse({ error: 'Enrollment missing' }, 500);

  // Check for existing submission
  const existing = await env.DB.prepare(
    `
      SELECT id, status FROM course_submissions
      WHERE enrollment_id = ? AND assignment_id = ? LIMIT 1
    `,
  )
    .bind(enrollmentId, assignment_id)
    .first();

  if (existing?.status === 'graded')
    return jsonResponse({ error: 'Already graded — cannot resubmit' }, 409);

  const evidenceJson = typeof evidence === 'string'
    ? evidence
    : JSON.stringify(evidence);

  const desiredStatusRaw = String(body?.status || 'submitted').trim().toLowerCase();
  const desiredStatus = ['draft', 'submitted'].includes(desiredStatusRaw) ? desiredStatusRaw : 'submitted';

  const timeSpent = Number(body.time_spent_minutes) || 0;
  const tokenSpend = Number(body.token_spend) || 0;

  let submissionId;

  if (existing) {
    // Update/submit
    await env.DB.prepare(`
      UPDATE course_submissions
      SET status = ?, evidence = ?,
          submitted_at = CASE WHEN ? = 'submitted' THEN unixepoch() ELSE submitted_at END,
          time_spent_minutes = ?, token_spend = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(desiredStatus, evidenceJson, desiredStatus, timeSpent, tokenSpend, existing.id).run();
    submissionId = existing.id;
  } else {
    submissionId = 'sub_' + Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (b) => b.toString(16).padStart(2, '0')
    ).join('');

    await env.DB.prepare(`
      INSERT INTO course_submissions
        (id, assignment_id, enrollment_id, user_id, course_id, status,
         evidence, submitted_at, time_spent_minutes, token_spend,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'submitted' THEN unixepoch() ELSE NULL END, ?, ?, unixepoch(), unixepoch())
    `).bind(
      submissionId, assignment_id, enrollmentId,
      submissionUserId, course_id, desiredStatus, evidenceJson, desiredStatus, timeSpent, tokenSpend
    ).run();
  }

  const submission = await env.DB.prepare(
    `SELECT * FROM course_submissions WHERE id = ? LIMIT 1`,
  )
    .bind(submissionId)
    .first();

  return jsonResponse({ ok: true, submission_id: submissionId, submission: submission || null });
}
