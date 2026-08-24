export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: {
    class?: string;
    text?: string;
    html?: string;
    attrs?: Record<string, string>;
    dataset?: Record<string, string>;
    children?: (Node | string)[];
    onClick?: (e: MouseEvent) => void;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
  }
  if (opts.children) {
    for (const c of opts.children) node.append(c);
  }
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  return node;
}

/** Minimal safe-ish markdown → HTML renderer for chat answers.
 *  Handles: paragraphs, `code`, ```fences```, **bold**, *italic*, headings, `-` lists.
 *  Not a general-purpose renderer — good enough for Claude's Q&A replies. */
export function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md);
  // fenced code blocks first
  const withFences = escaped.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_all, _lang, body) => `<pre class="code"><code>${body}</code></pre>`,
  );
  const lines = withFences.split(/\n/);
  const out: string[] = [];
  let inList = false;
  let inPara = false;
  const flushPara = () => {
    if (inPara) {
      out.push('</p>');
      inPara = false;
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      flushPara();
      closeList();
      const level = line.match(/^(#+)/)![1]!.length;
      const text = line.replace(/^#+\s+/, '');
      out.push(`<h${Math.min(level + 2, 6)}>${inlineMd(text)}</h${Math.min(level + 2, 6)}>`);
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineMd(line.replace(/^-\s+/, ''))}</li>`);
      continue;
    }
    if (line.startsWith('<pre')) {
      flushPara();
      closeList();
      out.push(line);
      continue;
    }
    if (!inPara) {
      out.push('<p>');
      inPara = true;
    }
    out.push(inlineMd(line));
    out.push(' ');
  }
  flushPara();
  closeList();
  return out.join('');
}

function inlineMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

export function empty(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
