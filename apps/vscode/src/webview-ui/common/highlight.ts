import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';

const registered = new Set<string>();

function ensure(name: string, lang: (hljs: unknown) => unknown): void {
  if (registered.has(name)) return;
  hljs.registerLanguage(name, lang as never);
  registered.add(name);
}

ensure('typescript', typescript);
ensure('javascript', javascript);
ensure('python', python);
ensure('go', go);
ensure('rust', rust);
ensure('css', css);
ensure('xml', xml);
ensure('bash', bash);
ensure('json', json);
ensure('yaml', yaml);
ensure('markdown', markdown);
ensure('diff', diff);

const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  css: 'css',
  scss: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
};

export function languageForFile(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXT_MAP[ext];
}

/** Highlight one line at a time so we can preserve per-line DOM (gutter etc). */
export function highlightLine(text: string, language: string | undefined): string {
  if (!language) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

/**
 * VSCode-theme-tuned styles. Uses `--vscode-charts-*` and a few
 * hand-picked hues so both light and dark themes remain readable.
 */
export function highlightCss(): string {
  return `
    .code-line .hljs-keyword,
    .code-line .hljs-selector-tag,
    .code-line .hljs-literal,
    .code-line .hljs-built_in { color: var(--vscode-charts-purple, #c586c0); }
    .code-line .hljs-string,
    .code-line .hljs-attr,
    .code-line .hljs-template-string { color: var(--vscode-charts-orange, #ce9178); }
    .code-line .hljs-number,
    .code-line .hljs-bullet,
    .code-line .hljs-symbol { color: var(--vscode-charts-yellow, #b5cea8); }
    .code-line .hljs-comment,
    .code-line .hljs-quote { color: var(--vscode-charts-green, #6a9955); font-style: italic; }
    .code-line .hljs-title,
    .code-line .hljs-name,
    .code-line .hljs-selector-id,
    .code-line .hljs-selector-class,
    .code-line .hljs-tag { color: var(--vscode-charts-blue, #4ec9b0); }
    .code-line .hljs-function,
    .code-line .hljs-title.function_ { color: var(--vscode-charts-blue, #dcdcaa); }
    .code-line .hljs-variable,
    .code-line .hljs-attribute { color: var(--vscode-charts-lines-1, #9cdcfe); }
    .code-line .hljs-type { color: var(--vscode-charts-blue, #4ec9b0); }
    .code-line .hljs-params { color: inherit; }
    .code-line .hljs-meta { color: var(--vscode-descriptionForeground, #999); }
    .code-line .hljs-addition { color: var(--vscode-gitDecoration-addedResourceForeground, #6a9955); }
    .code-line .hljs-deletion { color: var(--vscode-gitDecoration-deletedResourceForeground, #c586c0); }
  `;
}
