/**
 * Deterministic Excalidraw scene from agentsam_plans + agentsam_plan_tasks (no AI).
 * @see https://github.com/excalidraw/excalidraw/blob/master/src/packages/excalidraw/types.ts
 */

const SOURCE = 'https://inneranimalmedia.com/dashboard/agent';

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

function parseJsonArr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map((x) => String(x).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function planGoalLine(plan) {
  if (!plan) return '';
  const mb = plan.morning_brief;
  if (mb && typeof mb === 'string') {
    try {
      const o = JSON.parse(mb);
      if (o && typeof o.goal === 'string' && o.goal.trim()) return o.goal.trim().slice(0, 240);
    } catch {
      /* fall through */
    }
    return mb.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  if (plan.session_notes) return String(plan.session_notes).replace(/\s+/g, ' ').trim().slice(0, 240);
  return '';
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

function baseText(id, x, y, w, h, text, fontSize = 16, align = 'left') {
  return {
    id,
    type: 'text',
    x,
    y,
    width: w,
    height: h,
    text,
    fontSize,
    fontFamily: 1,
    textAlign: align,
    verticalAlign: 'top',
    strokeColor: '#e8eef2',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 1,
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
    originalText: text,
    lineHeight: 1.25,
  };
}

function lineArrow(id, x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1) || 1;
  const h = Math.abs(y2 - y1) || 1;
  const px0 = x1 - x;
  const py0 = y1 - y;
  const px1 = x2 - x;
  const py1 = y2 - y;
  return {
    id,
    type: 'arrow',
    x,
    y,
    width: w,
    height: h,
    strokeColor: '#6eb5ff',
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
      [px0, py0],
      [px1, py1],
    ],
    index: null,
  };
}

/**
 * @param {{ plan: Record<string, unknown>, tasks: Array<Record<string, unknown>> }} p
 */
export function buildExcalidrawPlanScene(p) {
  const plan = p.plan || {};
  const rawTasks = Array.isArray(p.tasks) ? [...p.tasks] : [];
  rawTasks.sort((a, b) => {
    const oa = Number(a.order_index) || 0;
    const ob = Number(b.order_index) || 0;
    return oa - ob;
  });

  const planId = String(plan.id || 'plan');
  const title = String(plan.title || 'Plan').slice(0, 200);
  const goal = planGoalLine(plan);
  const planType = String(plan.plan_type || '').slice(0, 48);
  const planRisk = String(plan.risk_level || 'low').toLowerCase();
  const planNeedsApproval = Number(plan.requires_approval || 0) === 1;

  const elements = [];

  const CARD_W = 280;
  const CARD_H = 108;
  const COL_GAP = 36;
  const ROW_GAP = 40;
  const M = 48;
  const TOP = 52;

  const titleBg = elId('tbg', planId);
  elements.push(baseRect(titleBg, M, TOP, 720, 96, '#152028', '#4a90c8'));
  elements.push(
    baseText(elId('tt', planId), M + 16, TOP + 12, 688, 36, title, 24, 'left'),
  );
  const sub = [planType && `Type: ${planType}`, goal && `Goal: ${goal}`].filter(Boolean).join('\n');
  if (sub) {
    elements.push(baseText(elId('ts', planId), M + 16, TOP + 52, 688, 40, sub, 15, 'left'));
  }

  const cols = 3;
  const posByTaskId = new Map();
  let maxBottom = TOP + 96 + ROW_GAP;

  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];
    const tid = String(t.id || `idx_${i}`);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = M + col * (CARD_W + COL_GAP);
    const y = TOP + 96 + ROW_GAP + row * (CARD_H + ROW_GAP);
    maxBottom = Math.max(maxBottom, y + CARD_H);
    posByTaskId.set(tid, { x, y, cx: x + CARD_W / 2, cy: y + CARD_H / 2, bottom: y + CARD_H, top: y });

    const bg = '#1a222a';
    const rid = elId('rc', `${planId}_${tid}`);
    elements.push(baseRect(rid, x, y, CARD_W, CARD_H, bg, '#5a7a9a'));

    const st = String(t.status || 'todo');
    const cat = String(t.category || '');
    const pri = String(t.priority || '');
    const trisk = String(t.risk_level || 'low').toLowerCase();
    const appr = Number(t.requires_approval || 0) === 1;
    const head = `${i + 1}. ${String(t.title || 'Task').slice(0, 80)}`;
    const meta = [`${st}${cat ? ` · ${cat}` : ''}${pri ? ` · ${pri}` : ''}`];
    if (trisk !== 'low') meta.push(`risk: ${trisk}`);
    if (appr) meta.push('approval required');
    if (t.blocked_reason) meta.push(`blocked: ${String(t.blocked_reason).slice(0, 120)}`);

    elements.push(baseText(elId('tx', `${planId}_${tid}`), x + 12, y + 10, CARD_W - 24, CARD_H - 20, `${head}\n${meta.join(' · ')}`, 15, 'left'));
  }

  const rightX = M + cols * (CARD_W + COL_GAP) + 24;
  let ry = TOP + 96 + ROW_GAP;
  const rail = [];

  if (planRisk !== 'low' || planNeedsApproval) {
    const lines = [];
    if (planRisk !== 'low') lines.push(`Plan risk: ${planRisk}`);
    if (planNeedsApproval) lines.push('Plan requires approval');
    rail.push(lines.join('\n'));
  }

  for (const t of rawTasks) {
    const trisk = String(t.risk_level || 'low').toLowerCase();
    const appr = Number(t.requires_approval || 0) === 1;
    const st = String(t.status || '').toLowerCase();
    const br = t.blocked_reason ? String(t.blocked_reason).trim() : '';
    if (trisk === 'low' && !appr && st !== 'blocked' && !br) continue;
    const bits = [`${String(t.title || 'Task').slice(0, 60)}`];
    if (trisk !== 'low') bits.push(`risk: ${trisk}`);
    if (appr) bits.push('approval');
    if (st === 'blocked') bits.push('BLOCKED');
    if (br) bits.push(br.slice(0, 160));
    rail.push(bits.join('\n'));
  }

  if (rail.length) {
    const rw = 260;
    const rh = 28 + rail.length * 52;
    const rid = elId('rail', planId);
    elements.push(baseRect(rid, rightX, ry, rw, rh, '#241a1f', '#c97a8a'));
    elements.push(baseText(elId('railt', planId), rightX + 10, ry + 8, rw - 20, rh - 16, `Risks / approvals\n${rail.join('\n---\n')}`, 14, 'left'));
    ry += rh + ROW_GAP;
    maxBottom = Math.max(maxBottom, ry);
  }

  const routes = new Set();
  const files = new Set();
  const tables = new Set();
  for (const t of rawTasks) {
    for (const x of parseJsonArr(t.routes_involved)) routes.add(x);
    for (const x of parseJsonArr(t.files_involved)) files.add(x);
    for (const x of parseJsonArr(t.tables_involved)) tables.add(x);
  }

  let fy = maxBottom + 32;
  const footW = 1000;
  const pushFooter = (label, items) => {
    if (!items.length) return;
    const text = `${label}\n${items.slice(0, 24).join('\n')}${items.length > 24 ? '\n…' : ''}`;
    const fh = 36 + Math.min(items.length, 24) * 18;
    const fid = elId('ft', `${planId}_${label}`);
    elements.push(baseRect(fid, M, fy, footW, fh, '#121820', '#3d5c7a'));
    elements.push(baseText(elId('ftx', `${planId}_${label}`), M + 12, fy + 8, footW - 24, fh - 16, text, 14, 'left'));
    fy += fh + 16;
  };

  pushFooter('Routes', [...routes]);
  pushFooter('Files', [...files]);
  pushFooter('Tables', [...tables]);

  for (const t of rawTasks) {
    const tid = String(t.id || '');
    const deps = parseJsonArr(t.depends_on);
    const toPos = posByTaskId.get(tid);
    if (!toPos) continue;
    for (const d of deps) {
      const fromPos = posByTaskId.get(String(d).trim());
      if (!fromPos) continue;
      const ax = fromPos.cx;
      const ay = fromPos.bottom;
      const bx = toPos.cx;
      const by = toPos.top;
      elements.push(lineArrow(elId('dep', `${tid}_${d}`), ax, ay, bx, by));
    }
  }

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
