export function styles(): string {
  return `
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #57606a;
  --subtle: #656d76;
  --border: #d0d7de;
  --border-strong: #b6bec7;
  --panel: #f6f8fa;
  --panel-2: #eaeef2;
  --accent: #0969da;
  --accent-fg: #ffffff;
  --code-bg: #f6f8fa;
  --code-fg: #24292f;
  --diff-add-bg: #dafbe1;
  --diff-add-fg: #116329;
  --diff-del-bg: #ffebe9;
  --diff-del-fg: #82071e;
  --chip-flow-bg: #4a90e2;
  --chip-contract-bg: #d9822b;
  --chip-structural-bg: #b180d7;
  --chip-surface-bg: var(--panel-2);
  --chip-surface-fg: var(--fg);
  --focal-entry: #1a7f37;
  --focal-core: #bf3989;
  --focal-contract: #9a6700;
  --sev-info: #0969da;
  --sev-warn: #9a6700;
  --sev-error: #cf222e;
  --role-added: #1a7f37;
  --role-modified: #9a6700;
  --role-removed: #cf222e;
  --role-unchanged: var(--muted);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #8b949e;
    --subtle: #7d8590;
    --border: #30363d;
    --border-strong: #484f58;
    --panel: #161b22;
    --panel-2: #1f242c;
    --accent: #4493f8;
    --accent-fg: #0d1117;
    --code-bg: #161b22;
    --code-fg: #c9d1d9;
    --diff-add-bg: #033a1626;
    --diff-add-fg: #56d364;
    --diff-del-bg: #67060c26;
    --diff-del-fg: #f85149;
    --chip-surface-bg: #30363d;
    --chip-surface-fg: #e6edf3;
    --focal-entry: #56d364;
    --focal-core: #f778ba;
    --focal-contract: #e3b341;
    --sev-info: #79c0ff;
    --sev-warn: #e3b341;
    --sev-error: #ff7b72;
    --role-added: #56d364;
    --role-modified: #e3b341;
    --role-removed: #ff7b72;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --bg: #0d1117;
  --fg: #e6edf3;
  --muted: #8b949e;
  --subtle: #7d8590;
  --border: #30363d;
  --border-strong: #484f58;
  --panel: #161b22;
  --panel-2: #1f242c;
  --accent: #4493f8;
  --accent-fg: #0d1117;
  --code-bg: #161b22;
  --code-fg: #c9d1d9;
  --diff-add-bg: #033a1626;
  --diff-add-fg: #56d364;
  --diff-del-bg: #67060c26;
  --diff-del-fg: #f85149;
  --chip-surface-bg: #30363d;
  --chip-surface-fg: #e6edf3;
  --focal-entry: #56d364;
  --focal-core: #f778ba;
  --focal-contract: #e3b341;
  --sev-info: #79c0ff;
  --sev-warn: #e3b341;
  --sev-error: #ff7b72;
  --role-added: #56d364;
  --role-modified: #e3b341;
  --role-removed: #ff7b72;
  color-scheme: dark;
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
}
button {
  font: inherit;
  cursor: pointer;
  color: var(--fg);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
}
button:hover { background: var(--panel-2); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button[disabled] { opacity: 0.5; cursor: not-allowed; }

.shell {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 100vh;
}
.sidebar {
  border-right: 1px solid var(--border);
  background: var(--panel);
  padding: 16px 0;
  position: sticky;
  top: 0;
  align-self: start;
  max-height: 100vh;
  overflow-y: auto;
}
.sidebar h1 {
  margin: 0 16px 4px;
  font-size: 15px;
  letter-spacing: 0.02em;
}
.sidebar .subtitle {
  margin: 0 16px 12px;
  color: var(--muted);
  font-size: 12px;
}
.persp-list { list-style: none; margin: 0; padding: 0; }
.persp-list li a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  color: var(--fg);
  border-left: 3px solid transparent;
}
.persp-list li a:hover { background: var(--panel-2); text-decoration: none; }
.persp-list li a.active { border-left-color: var(--accent); background: var(--panel-2); }
.persp-list .persp-num {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  min-width: 1.6em;
  text-align: right;
}
.persp-list .persp-title { flex: 1; overflow: hidden; text-overflow: ellipsis; }

.main { padding: 24px 32px 64px; max-width: 1080px; }
.header .tldr { font-size: 16px; color: var(--fg); margin: 6px 0 12px; }
.header .meta { color: var(--muted); font-size: 12px; }
.header .meta code { background: var(--panel); padding: 1px 4px; border-radius: 4px; }
.header .reading-order {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 12px 0 0;
  color: var(--fg);
}

.persp {
  margin-top: 40px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.persp-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.persp-header h2 { margin: 0; font-size: 20px; }
.persp .outcome { font-size: 15px; margin: 6px 0 12px; color: var(--fg); }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  line-height: 1.6;
  color: #fff;
  white-space: nowrap;
}
.chip.kind.mode-flow { background: var(--chip-flow-bg); }
.chip.kind.mode-contract { background: var(--chip-contract-bg); }
.chip.kind.mode-structural { background: var(--chip-structural-bg); }
.chip.kind.mode-surface { background: var(--chip-surface-bg); color: var(--chip-surface-fg); }
.chip.focal { color: #fff; }
.chip.focal.focal-entry { background: var(--focal-entry); }
.chip.focal.focal-core { background: var(--focal-core); }
.chip.focal.focal-contract { background: var(--focal-contract); color: #24292f; }
.chip.role { background: var(--panel-2); color: var(--fg); font-variant-caps: all-small-caps; letter-spacing: 0.05em; }
.chip.role.role-added { color: var(--role-added); }
.chip.role.role-modified { color: var(--role-modified); }
.chip.role.role-removed { color: var(--role-removed); }
.chip.sev-info { background: transparent; color: var(--sev-info); border: 1px solid var(--sev-info); }
.chip.sev-warn { background: transparent; color: var(--sev-warn); border: 1px solid var(--sev-warn); }
.chip.sev-error { background: transparent; color: var(--sev-error); border: 1px solid var(--sev-error); }

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin: 16px 0 12px;
}
.tab-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 8px 14px;
  color: var(--muted);
}
.tab-btn:hover { background: var(--panel); color: var(--fg); }
.tab-btn.active { color: var(--fg); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 12px 0;
}
.card h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.card .empty { color: var(--muted); font-style: italic; }

ul.plain { list-style: none; margin: 0; padding: 0; }
ul.plain li + li { margin-top: 6px; }
.watch-item, .test-item { display: flex; gap: 8px; align-items: flex-start; }
.watch-item .anchor, .test-item .anchor { color: var(--muted); font-size: 12px; white-space: nowrap; }
.watch-item .anchor a, .test-item .anchor a { color: var(--muted); }

.visual { margin: 12px 0; }
.visual .caption { color: var(--muted); font-size: 12px; margin: 4px 0 6px; }
.visual pre {
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0;
}
.visual .mermaid {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}
.visual pre.diff .add { color: var(--diff-add-fg); background: var(--diff-add-bg); display: block; }
.visual pre.diff .del { color: var(--diff-del-fg); background: var(--diff-del-bg); display: block; }
.visual pre.diff .hunk { color: var(--muted); display: block; }

.trace-toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  align-items: center;
}
.trace-toolbar .position {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.trace-layout {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 16px;
}
@media (max-width: 900px) {
  .trace-layout { grid-template-columns: 1fr; }
  .shell { grid-template-columns: 1fr; }
  .sidebar { position: static; max-height: none; }
}

.flow-outline {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 8px 0;
  max-height: 60vh;
  overflow-y: auto;
}
.flow-outline ul { list-style: none; margin: 0; padding: 0; }
.flow-outline li { margin: 0; }
.flow-outline .row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  cursor: pointer;
  border-left: 3px solid transparent;
  font-size: 12.5px;
}
.flow-outline .row:hover { background: var(--panel-2); }
.flow-outline .row.current { background: var(--panel-2); border-left-color: var(--accent); }
.flow-outline .row .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-outline .row .row-chips { display: flex; gap: 3px; }
.flow-outline .row .row-chips .chip { padding: 0 5px; font-size: 10px; }

.block-detail .block-title { margin: 0 0 4px; font-size: 16px; }
.block-detail .block-narrative { margin: 0 0 12px; color: var(--fg); }

.code-view {
  background: var(--code-bg);
  color: var(--code-fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
}
.code-view .code-side-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.code-view .code-side-tabs button.active {
  background: var(--panel-2);
  border-color: var(--border-strong);
}
.code-view pre { margin: 0; }
.code-view .file-header { color: var(--muted); font-size: 12px; margin-bottom: 6px; }

.var-list { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; padding: 0; list-style: none; }
.var-list dt { font-family: ui-monospace, monospace; color: var(--fg); }
.var-list dd { margin: 0; font-family: ui-monospace, monospace; color: var(--subtle); word-break: break-all; }
.var-list .note { grid-column: 1 / -1; color: var(--muted); font-size: 12px; padding-left: 8px; }

.mocks-list { list-style: none; margin: 0; padding: 0; }
.mock-row { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; background: var(--panel); }
.mock-row .mock-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mock-row .mock-symbol { font-family: ui-monospace, monospace; font-size: 12.5px; color: var(--fg); }
.mock-row .mock-kind { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.mock-row .mock-kind.stub { background: var(--panel-2); color: var(--accent); }
.mock-row .mock-kind.value { background: var(--panel-2); color: var(--focal-entry); }
.mock-row .mock-kind.skip { background: var(--panel-2); color: var(--sev-warn); }
.mock-row .mock-reason { color: var(--muted); font-size: 12.5px; }
.mock-row .mock-body { margin-top: 6px; color: var(--fg); font-size: 12.5px; }
.mock-row .mock-body code { background: var(--panel-2); padding: 1px 4px; border-radius: 3px; }

.concerns { list-style: none; margin: 0; padding: 0; }
.concerns li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
.concerns li .msg { flex: 1; }
.concerns li .anchor { color: var(--muted); font-size: 12px; white-space: nowrap; }

.focal-card { border-left: 3px solid var(--accent); padding-left: 10px; margin: 8px 0; background: var(--panel); border-radius: 6px; padding: 8px 10px; }
.focal-card.focal-entry { border-left-color: var(--focal-entry); }
.focal-card.focal-core { border-left-color: var(--focal-core); }
.focal-card.focal-contract { border-left-color: var(--focal-contract); }
.focal-card .head { display: flex; gap: 8px; align-items: center; font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.06em; margin-bottom: 4px; }
.focal-card .reason { color: var(--fg); font-size: 13px; }

.incidental {
  margin-top: 48px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  color: var(--muted);
}
.incidental h2 { color: var(--fg); margin: 0 0 8px; font-size: 16px; }
.incidental ul { padding-left: 20px; }
.incidental .category { color: var(--fg); font-weight: 600; }

.top-toc {
  position: sticky;
  top: 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 8px 0;
  margin: -24px -32px 20px;
  padding-left: 32px;
  padding-right: 32px;
  z-index: 2;
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12.5px;
  color: var(--muted);
}
.top-toc .theme-toggle { margin-left: auto; }

@media print {
  .sidebar, .top-toc, .trace-toolbar, .tabs { display: none !important; }
  .tab-panel { display: block !important; }
  .shell { grid-template-columns: 1fr; }
  .main { max-width: none; padding: 0; }
}
`;
}
