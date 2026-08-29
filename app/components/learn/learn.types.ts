export type ProgressStatus = 'not_started' | 'in_progress' | 'completed';
export type SubmissionStatus = 'draft' | 'submitted' | 'graded' | 'revision_requested';

export interface LearnDashboardResponse {
  ok: boolean;
  viewer?: {
    is_superadmin?: boolean;
  };
  courses: Course[];
  course_modules?: CourseModuleRow[];
  lessons?: Lesson[];
  lesson_assets?: LessonAsset[];
  lesson_versions?: LessonVersion[];
  lesson_progress?: any[];
  course_assignments?: Assignment[];
  course_submissions?: Submission[];
  course_grades?: Grade[];
  course_exports?: CourseExport[];
}

export interface Course {
  id: string;
  org_id: string | null;
  title: string;
  slug: string;
  description: string;
  long_description: string;
  thumbnail_url: string | null;
  category: string | null;
  level: string;
  duration_hours: number | null;
  status: string | null;
  instructor_id: string | null;
  metadata: Record<string, any>;
  enrollment: CourseEnrollment | null;
  progress_summary: CourseProgressSummary;
  modules: CourseModule[];
  assignments: AssignmentWithState[];
  exports: CourseExport[];
  submissions: Submission[];
  grades: Grade[];
}

export interface CourseEnrollment {
  id: string;
  status: string;
  enrollment_type: string;
  progress_percent: number;
  started_at: number | null;
  metadata: Record<string, any>;
}

export interface CourseProgressSummary {
  total_lessons: number;
  completed_lessons: number;
  progress_percent: number;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  description: string;
  order_index: number;
  is_required: number;
  estimated_minutes: number;
  lessons: Lesson[];
  assignments: AssignmentWithState[];
}

export interface CourseModuleRow {
  id: string;
  course_id: string;
  title: string;
  description: string;
  order_index: number;
  is_required: number;
  estimated_minutes: number;
}

export interface LessonProgress {
  status: ProgressStatus;
  completed_at: number | null;
  time_spent_minutes: number;
  token_spend: number;
}

export interface Lesson {
  id: string;
  course_id: string;
  module_id: string;
  title: string;
  slug: string;
  description: string;
  content_type: string;
  content_url: string | null;
  content_text: string | null;
  estimated_minutes: number;
  order_index: number;
  is_required: number;
  is_published: number;
  assets: LessonAsset[];
  progress: LessonProgress;
  assignments: AssignmentWithState[];
  /** Compatibility-only: legacy `course_lessons` fields. */
  type?: string | null;
  sandbox_query?: string | null;
  sandbox_db?: string | null;
}

export interface LessonAsset {
  id: string | null;
  lesson_id: string;
  asset_type: string;
  asset_url: string | null;
  r2_key: string | null;
  r2_bucket: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  order_index: number;
}

export interface LessonVersion {
  id: string;
  lesson_id: string;
  created_at: number;
  // schema may evolve; keep permissive
  [k: string]: any;
}

export interface Assignment {
  id: string;
  course_id: string;
  module_id: string;
  lesson_id: string | null;
  title: string;
  description: string;
  type: string;
  rubric: string;
  max_score: number;
  required_evidence: string;
  due_offset_days: number | null;
  is_graded?: number;
}

export interface Submission {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  user_id: string;
  course_id: string;
  status: SubmissionStatus;
  evidence: string | null;
  submitted_at: number | null;
  time_spent_minutes: number | null;
  token_spend: number | null;
  created_at?: number;
  updated_at?: number;
}

export interface Grade {
  id: string;
  submission_id: string;
  assignment_id: string;
  user_id: string;
  enrollment_id: string;
  score: number | null;
  max_score: number | null;
  rubric_scores: string | null;
  time_score: number | null;
  efficiency_score: number | null;
  graded_by: string | null;
  feedback: string | null;
  graded_at: number | null;
}

export interface CourseExport {
  id: string;
  course_id: string;
  export_type: string;
  file_url: string | null;
  r2_key: string | null;
  r2_bucket: string | null;
  file_size: number | null;
  metadata: Record<string, any>;
  created_by: string | null;
  created_at: number;
}

export interface AssignmentWithState extends Assignment {
  submission: Submission | null;
  grade: Grade | null;
}

export interface EvidenceFields {
  urls: string[];
  notes: string;
  github_commit: string;
}

// Rubric (supports multiple schemas; UI should be defensive)
export interface RubricCriterion {
  name?: string;
  label?: string;
  weight?: number;
  max_score?: number;
  description?: string;
}

export interface RubricSchema {
  scale?: { min?: number; max?: number; step?: number };
  pass_score?: number;
  distinction_score?: number;
  criteria?: RubricCriterion[];
}

