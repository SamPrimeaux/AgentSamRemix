/**
 * Deterministic lo-fi wireframe Excalidraw scenes (multi-screen flows).
 * Used by iam.illustration.v1 wireframe lane — never ASCII text previews.
 */

const SOURCE = 'https://inneranimalmedia.com/dashboard/draw';

function djb2(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return Math.abs(h) >>> 0;
}

function elId(prefix, key) {
  return `${prefix}_${djb2(key).toString(16).slice(0, 10)}`;
}

function seedFor(id) {
  return djb2(id) % 1000000000;
}

function baseRect(id, x, y, w, h, bg, stroke = '#4a5568') {
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

function baseText(id, x, y, w, h, text, fontSize = 14, align = 'left', color = '#1a202c') {
  const t = String(text || '');
  return {
    id,
    type: 'text',
    x,
    y,
    width: w,
    height: h,
    text: t,
    fontSize,
    fontFamily: 1,
    textAlign: align,
    verticalAlign: 'top',
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    opacity: 100,
    angle: 0,
    seed: seedFor(id),
    versionNonce: seedFor(`${id}_tn`),
    groupIds: [],
    frameId: null,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    isDeleted: false,
    index: null,
    containerId: null,
    originalText: t,
    lineHeight: 1.25,
  };
}

function lineArrow(id, x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1) || 1;
  const h = Math.abs(y2 - y1) || 1;
  return {
    id,
    type: 'arrow',
    x,
    y,
    width: w,
    height: h,
    strokeColor: '#3182ce',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: seedFor(id),
    versionNonce: seedFor(`${id}_an`),
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    isDeleted: false,
    startBinding: null,
    endBinding: null,
    lastCommittedPoint: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    points: [
      [x1 - x, y1 - y],
      [x2 - x, y2 - y],
    ],
    index: null,
  };
}

/**
 * @param {string} key
 * @param {number} fx frame x
 * @param {number} fy frame y
 * @param {number} fw frame width
 * @param {number} fh frame height
 * @param {string} label
 * @param {Array<{ y: number, h: number, label: string, fill?: string }>} blocks
 */
function pushScreen(elements, key, fx, fy, fw, fh, label, blocks) {
  const pad = 12;
  elements.push(baseRect(elId('wf_frame', key), fx, fy, fw, fh, '#ffffff', '#2d3748'));
  elements.push(baseText(elId('wf_lbl', key), fx, fy - 28, fw, 22, label, 16, 'center', '#2d3748'));

  let y = fy + pad;
  const innerW = fw - pad * 2;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const bh = b.h;
    elements.push(
      baseRect(elId('wf_blk', `${key}_${i}`), fx + pad, y, innerW, bh, b.fill || '#edf2f7', '#a0aec0'),
    );
    if (b.label) {
      elements.push(
        baseText(elId('wf_txt', `${key}_${i}`), fx + pad + 8, y + 6, innerW - 16, bh - 12, b.label, 12),
      );
    }
    y += bh + 8;
  }
}

function isCaseStudiesFlow(brief, title) {
  const blob = `${title}\n${brief}`.toLowerCase();
  return (
    /\bcase stud/i.test(blob) ||
    (/\bindex\b/i.test(blob) && /\bdetail\b/i.test(blob)) ||
    /\bfilter chips\b/i.test(blob) ||
    /\bclient case\b/i.test(blob)
  );
}

function buildCaseStudiesFlowScene(title, brief) {
  const elements = [];
  const M = 48;
  const TOP = 56;
  const desktopW = 400;
  const desktopH = 480;
  const mobileW = 240;
  const mobileH = 480;
  const gap = 72;

  elements.push(baseText(elId('wf_title', 'flow'), M, 16, 1200, 32, title || 'Case Studies Wireframe Flow', 22));
  if (brief) {
    elements.push(baseText(elId('wf_sub', 'flow'), M, 40, 900, 20, brief.slice(0, 120), 11, 'left', '#718096'));
  }

  const x1 = M;
  const x2 = x1 + desktopW + gap;
  const x3 = x2 + desktopW + gap;
  const y0 = TOP;

  pushScreen(elements, 'index', x1, y0, desktopW, desktopH, 'SCREEN 1 — INDEX', [
    { y: 0, h: 36, label: 'Top nav — logo | Case Studies | Contact', fill: '#e2e8f0' },
    { y: 0, h: 72, label: 'Hero — headline + subcopy', fill: '#f7fafc' },
    { y: 0, h: 28, label: 'Filters: All | Strategy | Design | Build', fill: '#edf2f7' },
    { y: 0, h: 88, label: 'Card — logo + outcome metric', fill: '#ffffff' },
    { y: 0, h: 88, label: 'Card — logo + outcome metric', fill: '#ffffff' },
    { y: 0, h: 88, label: 'Card — logo + outcome metric', fill: '#ffffff' },
  ]);

  pushScreen(elements, 'detail', x2, y0, desktopW, desktopH, 'SCREEN 2 — DETAIL', [
    { y: 0, h: 36, label: 'Top nav', fill: '#e2e8f0' },
    { y: 0, h: 100, label: 'Split hero — visual | headline + KPI', fill: '#f7fafc' },
    { y: 0, h: 56, label: 'Problem', fill: '#edf2f7' },
    { y: 0, h: 56, label: 'Approach', fill: '#edf2f7' },
    { y: 0, h: 56, label: 'Results + metrics', fill: '#edf2f7' },
    { y: 0, h: 48, label: 'Testimonial quote', fill: '#ffffff' },
    { y: 0, h: 44, label: 'Related cases row', fill: '#e2e8f0' },
  ]);

  pushScreen(elements, 'mobile', x3, y0, mobileW, mobileH, 'SCREEN 3 — MOBILE', [
    { y: 0, h: 32, label: 'Nav + menu', fill: '#e2e8f0' },
    { y: 0, h: 72, label: 'Stacked hero', fill: '#f7fafc' },
    { y: 0, h: 64, label: 'Outcome card', fill: '#ffffff' },
    { y: 0, h: 64, label: 'Outcome card', fill: '#ffffff' },
    { y: 0, h: 64, label: 'Outcome card', fill: '#ffffff' },
    { y: 0, h: 40, label: 'Sticky CTA — Start a project', fill: '#cbd5e0' },
  ]);

  const midY = y0 + desktopH / 2;
  elements.push(lineArrow(elId('wf_a1', 'flow'), x1 + desktopW + 8, midY, x2 - 8, midY));
  elements.push(lineArrow(elId('wf_a2', 'flow'), x2 + desktopW + 8, midY, x3 - 8, midY));

  return wrapScene(elements);
}

function buildGenericFlowScene(title, brief) {
  const elements = [];
  const M = 48;
  const w = 360;
  const h = 420;
  const gap = 64;
  elements.push(baseText(elId('wf_title', 'gen'), M, 16, 800, 28, title || 'Wireframe Flow', 20));

  const screens = [
    { key: 'a', label: 'SCREEN A', blocks: [{ h: 40, label: 'Header / nav' }, { h: 120, label: 'Primary content' }, { h: 80, label: 'Secondary block' }] },
    { key: 'b', label: 'SCREEN B', blocks: [{ h: 40, label: 'Header / nav' }, { h: 160, label: 'Detail / form' }, { h: 60, label: 'Actions / CTA' }] },
  ];

  let x = M;
  const y0 = 56;
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    pushScreen(
      elements,
      s.key,
      x,
      y0,
      w,
      h,
      s.label,
      s.blocks.map((b) => ({ y: 0, h: b.h, label: b.label, fill: '#edf2f7' })),
    );
    if (i < screens.length - 1) {
      elements.push(lineArrow(elId('wf_ga', String(i)), x + w + 8, y0 + h / 2, x + w + gap - 8, y0 + h / 2));
    }
    x += w + gap;
  }

  if (brief) {
    elements.push(baseText(elId('wf_brief', 'gen'), M, y0 + h + 32, 800, 60, brief.slice(0, 280), 11, 'left', '#718096'));
  }

  return wrapScene(elements);
}

function wrapScene(elements) {
  return {
    type: 'excalidraw',
    version: 2,
    source: SOURCE,
    elements,
    appState: {
      theme: 'light',
      viewBackgroundColor: '#f8fafc',
      gridSize: null,
    },
    files: {},
  };
}

/**
 * @param {{ title?: string, brief?: string, intent?: string }} p
 */
export function buildWireframeExcalidrawScene(p) {
  const title = String(p.title || 'Wireframe').slice(0, 200);
  const brief = String(p.brief || '').slice(0, 4000);
  if (isCaseStudiesFlow(brief, title)) {
    return buildCaseStudiesFlowScene(title, brief);
  }
  return buildGenericFlowScene(title, brief);
}
