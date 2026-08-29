/** @license SPDX-License-Identifier: Apache-2.0 */
export const PICKER_CLEANUP_SCRIPT = `
(function() {
  if (window.__iamPickerTeardown) { window.__iamPickerTeardown(); return; }
  window.__iamPickerActive = false;
  document.getElementById('__iam-picker-overlay')?.remove();
})();
`;

/** Same-origin iframe: report SPA + history navigations to parent URL bar. */
export const NAVIGATION_SYNC_SCRIPT = `
(function() {
  if (window.__iamNavBridgeActive) return;
  window.__iamNavBridgeActive = true;
  function notify() {
    try {
      window.parent.postMessage({
        type: 'iam-navigation',
        url: location.href,
        title: document.title || ''
      }, '*');
    } catch (e) {}
  }
  notify();
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  var push = history.pushState;
  var replace = history.replaceState;
  history.pushState = function() {
    var r = push.apply(this, arguments);
    notify();
    return r;
  };
  history.replaceState = function() {
    var r = replace.apply(this, arguments);
    notify();
    return r;
  };
})();
`;

export const PICKER_SCRIPT = `
(function() {
  if (window.__iamPickerTeardown) window.__iamPickerTeardown();
  window.__iamPickerActive = true;
  let lastEl = null;
  const overlay = document.createElement('div');
  overlay.id = '__iam-picker-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #3a9fe8;background:rgba(58,159,232,0.08);z-index:2147483647;transition:all 0.08s;border-radius:2px;';
  document.body.appendChild(overlay);

  function classText(el) {
    if (!el || el.className == null) return '';
    const c = el.className;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.baseVal) return c.baseVal;
    return String(c);
  }

  function getPath(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      let sel = (node.tagName || 'div').toLowerCase();
      if (node.id) sel += '#' + node.id;
      else {
        const cls = classText(node).trim().split(/\\s+/)[0];
        if (cls) sel += '.' + cls;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function onOver(e) {
    const el = e.target;
    if (!el || el === overlay) return;
    lastEl = el;
    const r = el.getBoundingClientRect();
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = lastEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const styles = {};
    ['color','background-color','font-size','font-family','font-weight',
     'display','position','width','height','margin','padding','border',
     'flex','flex-direction','gap','border-radius','box-shadow','opacity',
     'z-index','overflow','cursor','text-align','line-height'].forEach(p => {
      const v = cs.getPropertyValue(p);
      if (v) styles[p] = v;
    });
    window.parent.postMessage({
      type: 'iam-element-selected',
      element: {
        tag: (el.tagName || '').toLowerCase(),
        id: el.id || null,
        className: classText(el) || null,
        html: (el.outerHTML || '').slice(0, 3000),
        path: getPath(el),
        styles,
        boundingBox: { top: r.top, left: r.left, width: r.width, height: r.height },
      }
    }, '*');
  }

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('click', onClick, true);

  window.__iamPickerTeardown = function() {
    window.__iamPickerActive = false;
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('click', onClick, true);
    overlay.remove();
  };
})();
`;

/** MYBROWSER: element at viewport coordinates (cross-origin iframe — no inject into iframe). */
export function pickAtPointExpression(x: number, y: number): string {
  const xi = Math.max(0, Math.round(x));
  const yi = Math.max(0, Math.round(y));
  return `
(function(x, y) {
  function classText(el) {
    if (!el || el.className == null) return '';
    const c = el.className;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.baseVal) return c.baseVal;
    return String(c);
  }
  function getPath(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      let sel = (node.tagName || 'div').toLowerCase();
      if (node.id) sel += '#' + node.id;
      else {
        const cls = classText(node).trim().split(/\\s+/)[0];
        if (cls) sel += '.' + cls;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  const el = document.elementFromPoint(x, y);
  if (!el || el === document.documentElement || el === document.body) return null;
  const r = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  const styles = {};
  ['color','background-color','font-size','font-family','font-weight',
   'display','position','width','height','margin','padding'].forEach(p => {
    const v = cs.getPropertyValue(p);
    if (v) styles[p] = v;
  });
  return {
    element: {
      tag: (el.tagName || '').toLowerCase(),
      id: el.id || null,
      className: classText(el) || null,
      html: (el.outerHTML || '').slice(0, 3000),
      path: getPath(el),
      styles,
      boundingBox: { top: r.top, left: r.left, width: r.width, height: r.height },
    },
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
  };
})(${xi}, ${yi})
`.trim();
}

export type PickerHighlightRect = { top: number; left: number; width: number; height: number };
