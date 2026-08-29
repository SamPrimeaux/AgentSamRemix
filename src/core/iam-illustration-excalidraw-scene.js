import { buildWireframeExcalidrawScene } from './iam-wireframe-excalidraw-scene.js';

const SOURCE = 'https://inneranimalmedia.com/dashboard/draw';

function seedFor(id) {
  let h = 5381;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h) % 1000000000;
}

function baseRect(id, x, y, w, h, bg, stroke = '#7c9cbf') {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    strokeColor: stroke,
    backgroundColor: bg,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: seedFor(id),
    versionNonce: seedFor(`${id}_n`),
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    isDeleted: false,
    index: null,
  };
}

function baseText(id, x, y, w, h, text, fontSize = 20, align = 'left') {
  return {
    id,
    type: 'text',
    x,
    y,
    width: w,
    height: h,
    strokeColor: '#e8eef4',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    angle: 0,
    seed: seedFor(id),
    versionNonce: seedFor(`${id}_v`),
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    isDeleted: false,
    fontSize,
    fontFamily: 1,
    text: String(text || ''),
    textAlign: align,
    verticalAlign: 'top',
    containerId: null,
    originalText: String(text || ''),
    autoResize: true,
    lineHeight: 1.25,
    index: null,
  };
}

/**
 * @param {{ title?: string, brief?: string, intent?: string, payload?: Record<string, unknown>|null }} p
 */
export function buildIllustrationExcalidrawScene(p) {
  const payload = p.payload && typeof p.payload === 'object' ? p.payload : {};
  if (Array.isArray(payload.elements) && payload.elements.length > 0) {
    return {
      type: 'excalidraw',
      version: 2,
      source: SOURCE,
      elements: payload.elements,
      appState: payload.appState && typeof payload.appState === 'object'
        ? payload.appState
        : { theme: 'dark', viewBackgroundColor: '#0b1114', gridSize: null },
      files: payload.files && typeof payload.files === 'object' ? payload.files : {},
    };
  }

  const title = String(p.title || 'Illustration').slice(0, 200);
  const brief = String(p.brief || '').slice(0, 4000);
  const intent = String(p.intent || 'sketch').slice(0, 80);

  if (intent === 'wireframe' || /\bwireframe\b/i.test(brief) || /\blo-?fi\b/i.test(brief)) {
    return buildWireframeExcalidrawScene({ title, brief, intent });
  }

  const elements = [];
  const cardW = 920;
  const M = 48;

  elements.push(baseRect('ill_title_bg', M, M, cardW, 72, '#1a2430', '#4a7ab8'));
  elements.push(baseText('ill_title', M + 16, M + 18, cardW - 32, 40, title, 28, 'left'));

  elements.push(baseRect('ill_meta_bg', M, M + 96, cardW, 40, '#121820', '#3d5c7a'));
  elements.push(
    baseText('ill_meta', M + 12, M + 104, cardW - 24, 24, `intent: ${intent}`, 14, 'left'),
  );

  const briefLines = brief.split('\n');
  const briefH = Math.min(640, Math.max(120, 48 + briefLines.length * 22));
  elements.push(baseRect('ill_brief_bg', M, M + 152, cardW, briefH, '#0f161c', '#2f4858'));
  elements.push(
    baseText('ill_brief', M + 16, M + 168, cardW - 32, briefH - 32, brief || '(add details)', 16, 'left'),
  );

  return {
    type: 'excalidraw',
    version: 2,
    source: SOURCE,
    elements,
    appState: {
      theme: 'dark',
      viewBackgroundColor: '#0b1114',
      gridSize: null,
    },
    files: {},
  };
}
