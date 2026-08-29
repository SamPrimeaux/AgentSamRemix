import type { LucideIcon } from 'lucide-react';
import {
  Database,
  FileText,
  Globe,
  Image,
  Layout,
  Mail,
  Plug,
  Workflow,
} from 'lucide-react';
import type { ArtifactOpenBuilderDetail } from '../agentChatConstants';

export type ArtifactCategoryId =
  | 'web-page'
  | 'react-ui'
  | 'email'
  | 'mcp-surface'
  | 'sql'
  | 'document'
  | 'image'
  | 'workflow';

export type ArtifactCategory = {
  id: ArtifactCategoryId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accent: string;
  seedPrompt: string;
  /** Navigate to Agent workbench and open a tab after seeding chat. */
  openBuilder?: boolean;
  builderTab?: ArtifactOpenBuilderDetail['tab'];
};

export const ARTIFACT_CATEGORIES: ArtifactCategory[] = [
  {
    id: 'web-page',
    title: 'Web page',
    subtitle: 'Landing pages, docs, static HTML',
    icon: Globe,
    accent: 'var(--solar-cyan)',
    seedPrompt:
      'I want to build a new web page artifact. Start with a short intake: goal, audience, and tone — then propose a mobile-first HTML structure we can iterate on.',
    openBuilder: true,
    builderTab: 'code',
  },
  {
    id: 'react-ui',
    title: 'React UI',
    subtitle: 'Components, panels, dashboard views',
    icon: Layout,
    accent: 'var(--solar-green)',
    seedPrompt:
      'I want to create a new React UI artifact for the IAM dashboard. Ask what screen or component we are building, then scaffold a mobile-responsive TSX component.',
    openBuilder: true,
    builderTab: 'code',
  },
  {
    id: 'email',
    title: 'Email',
    subtitle: 'Transactional or campaign templates',
    icon: Mail,
    accent: '#f472b6',
    seedPrompt:
      'Help me draft a new email template artifact. Ask for brand voice, CTA, and audience — output responsive HTML suitable for Resend.',
  },
  {
    id: 'mcp-surface',
    title: 'MCP tool',
    subtitle: 'OAuth-visible tools & handlers',
    icon: Plug,
    accent: '#a78bfa',
    seedPrompt:
      'I want to design a new MCP tool surface for IAM. Interview me on the tool purpose, inputs, and D1 tables — then outline handler_config_json and agentsam_tools rows.',
    openBuilder: true,
    builderTab: 'code',
  },
  {
    id: 'sql',
    title: 'SQL migration',
    subtitle: 'D1 migrations & data fixes',
    icon: Database,
    accent: '#38bdf8',
    seedPrompt:
      'I need a new idempotent D1 migration artifact. Ask what tables or columns change, then draft migrations/###_*.sql with rollback notes.',
    openBuilder: true,
    builderTab: 'code',
  },
  {
    id: 'document',
    title: 'Document',
    subtitle: 'Memos, specs, runbooks',
    icon: FileText,
    accent: 'var(--text-muted)',
    seedPrompt:
      'Let us create a document artifact (memo or spec). Ask for topic and audience, then produce a structured markdown outline I can refine.',
  },
  {
    id: 'image',
    title: 'Creative',
    subtitle: 'Images, visuals, brand assets',
    icon: Image,
    accent: '#fb923c',
    seedPrompt:
      'I want a new creative visual artifact. Ask for subject, style, and aspect ratio — then propose prompts and storage plan (R2 + thumbnail).',
  },
  {
    id: 'workflow',
    title: 'Workflow',
    subtitle: 'Agent Sam automations',
    icon: Workflow,
    accent: '#34d399',
    seedPrompt:
      'Help me design a new Agent Sam workflow artifact. Ask for trigger, steps, and success criteria — map to agentsam_workflows handlers.',
  },
];

export const ARTIFACT_CATEGORY_BY_ID = Object.fromEntries(
  ARTIFACT_CATEGORIES.map((c) => [c.id, c]),
) as Record<ArtifactCategoryId, ArtifactCategory>;
