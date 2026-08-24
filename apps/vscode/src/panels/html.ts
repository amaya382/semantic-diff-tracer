export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

/** JSON safe to embed inside a `<script type="application/json">` block. */
export function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function randomNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
}
