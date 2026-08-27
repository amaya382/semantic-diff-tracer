/**
 * Client-side runtime embedded into the report. Runs against the JSON payload
 * the server emits into `<script id="sdt-payload">` — no network, no LLM. Owns
 * three things:
 *
 * 1. Trace step navigation (Step In/Over/Out/Back) mirroring `stepFlow` in
 *    `packages/core/src/usecases/step-flow.ts`. Kept as its own copy because
 *    the report is a single self-contained HTML file with no module system.
 * 2. Perspective sub-tab switching (Summary / Trace).
 * 3. Theme toggle (system/light/dark), persisted in localStorage per report.
 *
 * A perspective sub-tree lives under `.persp[data-persp-id]`; per-perspective
 * state (trace cursor, history) is scoped to that root.
 */
export function clientScript(): string {
  return `
(function () {
  'use strict';
  var payloadNode = document.getElementById('sdt-payload');
  if (!payloadNode || !payloadNode.textContent) return;
  var payload;
  try { payload = JSON.parse(payloadNode.textContent); } catch (e) { return; }

  var traceState = Object.create(null);
  var byId = Object.create(null);
  (payload.perspectives || []).forEach(function (p) {
    byId[p.id] = p;
    if (p.flow) {
      traceState[p.id] = { cursor: [0], history: [] };
    }
  });

  // ---- theme ----
  var THEME_KEY = 'sdt.report.theme';
  function applyTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
  }
  var storedTheme;
  try { storedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(storedTheme || 'system');
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var toggle = target.closest('[data-theme-set]');
    if (!toggle) return;
    var next = toggle.getAttribute('data-theme-set') || 'system';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e2) {}
    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-theme-set') === next);
    });
  });
  document.querySelectorAll('[data-theme-set]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-theme-set') === (storedTheme || 'system'));
  });

  // ---- perspective sub-tabs ----
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var btn = target.closest('.tab-btn[data-tab]');
    if (!btn) return;
    var root = btn.closest('.persp');
    if (!root) return;
    var name = btn.getAttribute('data-tab');
    root.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    root.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-tab-panel') === name);
    });
  });

  // ---- code-view side toggle ----
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var btn = target.closest('[data-side-set]');
    if (!btn) return;
    var host = btn.closest('.code-view');
    if (!host) return;
    var side = btn.getAttribute('data-side-set');
    host.querySelectorAll('[data-side-set]').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    host.querySelectorAll('[data-side-panel]').forEach(function (p) {
      p.style.display = p.getAttribute('data-side-panel') === side ? '' : 'none';
    });
  });

  // ---- trace navigation ----
  // Mirrors dfsPaths / blockAt / stepFlow from core/usecases/step-flow.ts.
  function dfsPaths(blocks) {
    var out = [];
    function walk(nodes, prefix) {
      for (var i = 0; i < nodes.length; i++) {
        var p = prefix.concat(i);
        out.push(p);
        walk(nodes[i].children || [], p);
      }
    }
    walk(blocks, []);
    return out;
  }
  function blockAt(blocks, path) {
    var siblings = blocks;
    var node;
    for (var i = 0; i < path.length; i++) {
      node = siblings[path[i]];
      if (!node) return undefined;
      siblings = node.children || [];
    }
    return node;
  }
  function pathsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isDescendant(anc, cand) {
    if (cand.length <= anc.length) return false;
    for (var i = 0; i < anc.length; i++) if (anc[i] !== cand[i]) return false;
    return true;
  }
  function stepFlow(blocks, current, action, history) {
    if (action === 'reverse') {
      if (history.length === 0) return {};
      return { next: history[history.length - 1], historyPop: true };
    }
    var flat = dfsPaths(blocks);
    var currentIndex = -1;
    for (var i = 0; i < flat.length; i++) if (pathsEqual(flat[i], current)) { currentIndex = i; break; }
    if (currentIndex < 0) return {};
    if (action === 'in') {
      var cur = blockAt(blocks, current);
      if (cur && (cur.children || []).length > 0) {
        return { next: current.concat(0), historyPush: current };
      }
      // fall through to over
    }
    if (action === 'in' || action === 'over') {
      for (var j = currentIndex + 1; j < flat.length; j++) {
        if (!isDescendant(current, flat[j])) return { next: flat[j], historyPush: current };
      }
      return { historyPush: current };
    }
    if (current.length === 0) return { historyPush: current };
    var parent = current.slice(0, -1);
    for (var k = currentIndex + 1; k < flat.length; k++) {
      if (!isDescendant(parent, flat[k])) return { next: flat[k], historyPush: current };
    }
    return { historyPush: current };
  }

  function pathKey(p) { return p.join('.'); }

  function renderTrace(perspId) {
    var persp = byId[perspId];
    if (!persp || !persp.flow) return;
    var state = traceState[perspId];
    var block = blockAt(persp.flow.blocks, state.cursor);
    var root = document.querySelector('.persp[data-persp-id="' + cssEscape(perspId) + '"]');
    if (!root) return;

    // outline: highlight current
    root.querySelectorAll('.flow-outline .row').forEach(function (row) {
      row.classList.toggle('current', row.getAttribute('data-path') === pathKey(state.cursor));
    });

    // position label
    var flatLen = dfsPaths(persp.flow.blocks).length;
    var flat = dfsPaths(persp.flow.blocks);
    var idx = -1;
    for (var i = 0; i < flat.length; i++) if (pathsEqual(flat[i], state.cursor)) { idx = i; break; }
    var posEl = root.querySelector('[data-trace-position]');
    if (posEl) posEl.textContent = (idx + 1) + ' / ' + flatLen;

    // Reverse button enabled iff history has entries.
    var reverseBtn = root.querySelector('[data-step-action="reverse"]');
    if (reverseBtn) reverseBtn.toggleAttribute('disabled', state.history.length === 0);

    var detail = root.querySelector('[data-trace-detail]');
    if (!detail) return;
    if (!block) {
      detail.innerHTML = '<p class="empty">End of flow.</p>';
      return;
    }
    detail.innerHTML = renderBlockDetail(block);
  }

  function renderBlockDetail(block) {
    var parts = [];
    parts.push('<h3 class="block-title">' + esc(block.title || '') + '</h3>');
    if (block.narrative) parts.push('<p class="block-narrative">' + esc(block.narrative) + '</p>');
    if (block.focal) {
      var kind = block.focal.kind || 'core';
      parts.push('<div class="focal-card focal-' + esc(kind) + '">' +
        '<div class="head"><span class="chip focal focal-' + esc(kind) + '">' + esc(kind) + '</span><span>focal</span></div>' +
        '<div class="reason">' + esc(block.focal.reason || '') + '</div></div>');
    }
    var role = block.role ? '<span class="chip role role-' + esc(block.role) + '">' + esc(block.role) + '</span>' : '';
    var loc = block.focus ? esc(block.focus.file) + ':' + block.focus.startLine + '-' + block.focus.endLine : '';
    parts.push('<div class="card"><h3>Focus ' + role + '</h3>' +
      '<div class="file-header">' + esc(loc) + '</div>' +
      renderCodeView(block) +
      '</div>');
    parts.push(renderVars(block.visibleVars || []));
    parts.push(renderMocks(block.mocks || []));
    parts.push(renderConcerns(block.concerns || []));
    return parts.join('');
  }

  function renderCodeView(block) {
    var hasBefore = block.beforeCode && block.beforeFocus;
    var sideTabs = '';
    if (hasBefore) {
      sideTabs = '<div class="code-side-tabs">' +
        '<button data-side-set="after" class="active">After</button>' +
        '<button data-side-set="before">Before</button></div>';
    }
    var afterHtml = '<pre data-side-panel="after">' + esc(block.code || '') + '</pre>';
    var beforeHtml = hasBefore
      ? '<pre data-side-panel="before" style="display:none">' + esc(block.beforeCode || '') + '</pre>'
      : '';
    return '<div class="code-view">' + sideTabs + afterHtml + beforeHtml + '</div>';
  }

  function renderVars(vars) {
    if (!vars.length) return '<div class="card"><h3>Variables</h3><p class="empty">No values in scope.</p></div>';
    var rows = vars.map(function (v) {
      var note = v.note ? '<div class="note">' + esc(v.note) + '</div>' : '';
      return '<dt>' + esc(v.name) + '</dt><dd>' + esc(v.value) + '</dd>' + note;
    }).join('');
    return '<div class="card"><h3>Variables</h3><dl class="var-list">' + rows + '</dl></div>';
  }

  function renderMocks(mocks) {
    if (!mocks.length) return '';
    var rows = mocks.map(function (m) {
      var value = m.value ? '<div class="mock-body">current: <code>' + esc(m.value) + '</code></div>' : '';
      return '<li class="mock-row"><div class="mock-head">' +
        '<code class="mock-symbol">' + esc(m.symbol || m.id) + '</code>' +
        '<span class="mock-kind ' + esc(m.kind) + '">' + esc(m.kind) + '</span>' +
        '<span class="mock-reason">' + esc(m.reason || '') + '</span>' +
        '</div>' + value + '</li>';
    }).join('');
    return '<div class="card"><h3>Mocks</h3><ul class="mocks-list">' + rows + '</ul></div>';
  }

  function renderConcerns(concerns) {
    if (!concerns.length) return '';
    var rows = concerns.map(function (c) {
      return '<li>' +
        '<span class="chip sev-' + esc(c.severity) + '">' + esc(c.severity) + '</span>' +
        '<span class="msg">' + esc(c.message) + '</span>' +
        '<span class="anchor">' + esc(c.anchor.file + ':' + c.anchor.line) + '</span>' +
        '</li>';
    }).join('');
    return '<div class="card"><h3>Concerns</h3><ul class="concerns">' + rows + '</ul></div>';
  }

  function cssEscape(v) {
    if (window.CSS && CSS.escape) return CSS.escape(v);
    return String(v).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Step button clicks.
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var btn = target.closest('[data-step-action]');
    if (btn) {
      var action = btn.getAttribute('data-step-action');
      var root = btn.closest('.persp');
      if (!root) return;
      var pid = root.getAttribute('data-persp-id');
      var persp = byId[pid];
      if (!persp || !persp.flow) return;
      var st = traceState[pid];
      var result = stepFlow(persp.flow.blocks, st.cursor, action, st.history);
      if (result.historyPush) st.history.push(result.historyPush);
      if (result.historyPop) st.history.pop();
      if (result.next) st.cursor = result.next;
      renderTrace(pid);
      e.preventDefault();
      return;
    }
    // Outline click.
    var row = target.closest('.flow-outline .row[data-path]');
    if (row) {
      var pathAttr = row.getAttribute('data-path');
      var root2 = row.closest('.persp');
      if (!root2) return;
      var pid2 = root2.getAttribute('data-persp-id');
      var st2 = traceState[pid2];
      var newPath = pathAttr.split('.').map(function (n) { return parseInt(n, 10); });
      st2.history.push(st2.cursor);
      st2.cursor = newPath;
      renderTrace(pid2);
    }
  });

  // Keyboard shortcuts (per perspective in view — scoped to focused persp).
  document.addEventListener('keydown', function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    var openTrace = document.querySelector('.persp .tab-btn.active[data-tab="trace"]');
    if (!openTrace) return;
    var root = openTrace.closest('.persp');
    if (!root) return;
    var pid = root.getAttribute('data-persp-id');
    var action = null;
    if (e.key === 'F10' || e.key === 's') action = 'over';
    else if (e.key === 'F11' || e.key === 'i') action = 'in';
    else if (e.key === 'F12' || e.key === 'o') action = 'out';
    else if (e.key === 'b') action = 'reverse';
    if (!action) return;
    e.preventDefault();
    var persp = byId[pid];
    if (!persp || !persp.flow) return;
    var st = traceState[pid];
    var result = stepFlow(persp.flow.blocks, st.cursor, action, st.history);
    if (result.historyPush) st.history.push(result.historyPush);
    if (result.historyPop) st.history.pop();
    if (result.next) st.cursor = result.next;
    renderTrace(pid);
  });

  // Initial render for every perspective with a flow.
  Object.keys(traceState).forEach(renderTrace);

  // Render mermaid diagrams if the browser has a global mermaid (loaded from
  // CDN when present in the head). Without it, the source stays visible as
  // preformatted text — still readable, just unrendered.
  if (window.mermaid && typeof window.mermaid.run === 'function') {
    try { window.mermaid.initialize({ startOnLoad: false, theme: 'default' }); } catch (e) {}
    try { window.mermaid.run({ querySelector: '.mermaid' }); } catch (e) {}
  }
})();
`;
}
