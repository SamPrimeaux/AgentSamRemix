/**
 * Sketch document model + local persistence (templates / agent concepts).
 * v1: localStorage; future: agentsam_artifacts type sketch_studio.
 */
import type { WfElement } from '../draw/wireframe/WireframeStudio';

export type SketchStudioMode = 'sketch' | 'layout' | 'blueprint';

export type SketchDocument = {
  id: string;
  name: string;
  mode: SketchStudioMode;
  elements: WfElement[];
  createdAt: number;
  updatedAt: number;
  source: 'user' | 'agent' | 'preset';
  notes?: string;
};

const STORAGE_KEY = 'iam.sketch.documents.v1';

function readAll(): SketchDocument[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SketchDocument[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(docs: SketchDocument[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(0, 48)));
  } catch {
    /* quota */
  }
}

export function listSketchDocuments(): SketchDocument[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSketchDocument(id: string): SketchDocument | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function saveSketchDocument(input: {
  id?: string;
  name: string;
  mode: SketchStudioMode;
  elements: WfElement[];
  source?: SketchDocument['source'];
  notes?: string;
}): SketchDocument {
  const now = Date.now();
  const docs = readAll();
  const existingIdx = input.id ? docs.findIndex((d) => d.id === input.id) : -1;
  const doc: SketchDocument = {
    id: input.id ?? `sk_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || 'Untitled sketch',
    mode: input.mode,
    elements: input.elements,
    createdAt: existingIdx >= 0 ? docs[existingIdx].createdAt : now,
    updatedAt: now,
    source: input.source ?? 'user',
    notes: input.notes,
  };
  if (existingIdx >= 0) docs[existingIdx] = doc;
  else docs.unshift(doc);
  writeAll(docs);
  return doc;
}

export function deleteSketchDocument(id: string) {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function duplicateSketchDocument(id: string): SketchDocument | null {
  const src = getSketchDocument(id);
  if (!src) return null;
  return saveSketchDocument({
    name: `${src.name} (copy)`,
    mode: src.mode,
    elements: JSON.parse(JSON.stringify(src.elements)) as WfElement[],
    source: src.source,
    notes: src.notes,
  });
}

/** Built-in architectural starter — open floor plan blocks. */
export function blueprintFloorPlanPreset(): WfElement[] {
  const mk = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): WfElement => ({
    id,
    type: 'rect',
    x,
    y,
    w,
    h,
    fill: '#0f172a',
    stroke: '#38bdf8',
    opacity: 0.85,
    radius: 2,
    label,
  });
  return [
    mk('bp-entry', 'Entry', 80, 60, 80, 48),
    mk('bp-living', 'Living', 168, 60, 160, 120),
    mk('bp-kitchen', 'Kitchen', 336, 60, 120, 80),
    mk('bp-bed1', 'Bedroom', 80, 120, 120, 100),
    mk('bp-bed2', 'Primary', 216, 120, 140, 100),
    mk('bp-bath', 'Bath', 368, 152, 72, 68),
  ];
}

export const SKETCH_LOAD_EVENT = 'iam:sketch_load_document';

export function dispatchSketchLoad(detail: {
  elements: WfElement[];
  name?: string;
  mode?: SketchStudioMode;
  documentId?: string;
}) {
  window.dispatchEvent(new CustomEvent(SKETCH_LOAD_EVENT, { detail }));
}
