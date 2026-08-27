import { describe, expect, it } from 'vitest';
import type {
  Flow,
  IncidentalChange,
  PerspectiveDraft,
  PerspectiveSet,
  PrMeta,
  SummaryPayload,
} from '@semantic-diff-tracer/core';
import { renderReport } from './index.js';

const meta: PrMeta = {
  title: 'Add SSO login',
  body: 'Adds a SAML SSO login flow.',
  author: 'octo',
  url: 'https://github.com/octo/repo/pull/42',
  baseRef: 'main',
  headRef: 'sso-login',
};

const persp: PerspectiveDraft = {
  id: 'sso',
  title: 'SSO login flow',
  outcome: 'Users can sign in with the corporate SAML IdP.',
  hunkRefs: [{ file: 'src/auth/sso.ts', hunkIndex: 0 }],
  kind: 'feature',
};

const summary: SummaryPayload = {
  summary: {
    perspectiveId: 'sso',
    outcome: 'Users can sign in with the corporate SAML IdP.',
    tests: [{ file: 'src/auth/sso.test.ts', line: 12, description: 'happy path' }],
    watchFor: [
      { note: 'Session TTL is now 8h — check downstream refresh assumptions.' },
      {
        anchor: { file: 'src/auth/sso.ts', line: 42 },
        note: 'The IdP callback path is now hard-coded; migration required.',
      },
    ],
    visuals: [
      {
        kind: 'mermaid',
        source: 'sequenceDiagram\nUser->>App: click login\nApp->>IdP: redirect',
        caption: 'SSO login handshake',
      },
    ],
  },
  hunkRefs: persp.hunkRefs,
};

const flow: Flow = {
  flowId: 'flow-sso',
  perspectiveId: 'sso',
  blocks: [
    {
      id: 'b1',
      title: 'Entry: handleLogin',
      narrative: 'User clicks the "Login with SSO" button.',
      focus: { file: 'src/auth/sso.ts', startLine: 10, endLine: 20 },
      code: 'export async function handleLogin() {\n  // ...\n}',
      role: 'added',
      visibleVars: [{ name: 'redirectUri', value: '"/callback"' }],
      mocks: [],
      concerns: [],
      focal: { kind: 'entry', reason: 'Reviewer starts here' },
      children: [
        {
          id: 'b1a',
          title: 'Redirect to IdP',
          narrative: 'Builds the SAML AuthnRequest and redirects the browser.',
          focus: { file: 'src/auth/sso.ts', startLine: 22, endLine: 35 },
          code: 'const url = buildAuthnRequest(...)\nreturn Response.redirect(url);',
          role: 'added',
          visibleVars: [],
          mocks: [
            {
              id: 'm1',
              symbol: 'buildAuthnRequest',
              file: 'src/auth/saml.ts',
              kind: 'stub',
              reason: 'Not the focus of this flow',
              editable: true,
              userOverridden: false,
            },
          ],
          concerns: [],
          children: [],
        },
      ],
    },
    {
      id: 'b2',
      title: 'Callback: verify assertion',
      narrative: 'Verifies the SAML assertion signature and issues the session.',
      focus: { file: 'src/auth/sso.ts', startLine: 60, endLine: 80 },
      code: '// verify + issue session',
      role: 'added',
      visibleVars: [],
      mocks: [],
      concerns: [
        {
          id: 'c1',
          severity: 'warn',
          message: 'Signature verification uses the first cert only.',
          anchor: { file: 'src/auth/sso.ts', line: 65 },
        },
      ],
      children: [],
    },
  ],
  allMocks: [
    {
      id: 'm1',
      symbol: 'buildAuthnRequest',
      file: 'src/auth/saml.ts',
      kind: 'stub',
      reason: 'Not the focus of this flow',
      editable: true,
      userOverridden: false,
    },
  ],
};

const incidental: IncidentalChange[] = [
  { category: 'rename', hunkRefs: [{ file: 'src/legacy/oauth.ts', hunkIndex: 0 }], note: 'Renamed for clarity.' },
];

const perspectives: PerspectiveSet = {
  tldr: 'Adds SAML SSO to the login flow.',
  perspectives: [persp],
  incidental,
  readingOrder: 'Read the callback first; the entry is thin.',
};

describe('renderReport', () => {
  const html = renderReport({
    meta,
    perspectives,
    bundles: [{ perspective: persp, summary, flow }],
    generatedAt: new Date('2026-08-27T00:00:00.000Z'),
    language: 'en',
    includeMermaidCdn: true,
  });

  it('emits a full HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Add SSO login</title>');
    expect(html).toContain(meta.author);
    expect(html).toContain('Users can sign in with the corporate SAML IdP.');
  });

  it('renders the sidebar and perspective section', () => {
    expect(html).toContain('SSO login flow');
    expect(html).toContain('feature'); // chip label
    expect(html).toContain('data-persp-id="sso"');
  });

  it('includes Summary content', () => {
    expect(html).toContain('Watch for');
    expect(html).toContain('Session TTL is now 8h');
    expect(html).toContain('happy path');
  });

  it('renders mermaid as source, upgradable by the client', () => {
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('sequenceDiagram');
  });

  it('embeds the flow into a machine-readable payload', () => {
    expect(html).toContain('id="sdt-payload"');
    // Block title and narrative reach the client through the payload only —
    // ensure they made it in.
    expect(html).toContain('Callback: verify assertion');
    expect(html).toContain('Verifies the SAML assertion');
  });

  it('renders the trace outline with a step toolbar', () => {
    expect(html).toContain('data-step-action="in"');
    expect(html).toContain('data-step-action="reverse"');
    expect(html).toContain('data-trace-detail');
    expect(html).toContain('data-path="0"'); // top-level block
    expect(html).toContain('data-path="0.0"'); // nested child
  });

  it('lists incidental changes', () => {
    expect(html).toContain('Incidental changes');
    expect(html).toContain('rename');
    expect(html).toContain('Renamed for clarity.');
  });

  it('references the Mermaid CDN', () => {
    expect(html).toContain('cdn.jsdelivr.net/npm/mermaid');
  });

  it('omits the CDN when disabled', () => {
    const withoutCdn = renderReport({
      meta,
      perspectives,
      bundles: [{ perspective: persp, summary, flow }],
      generatedAt: new Date('2026-08-27T00:00:00.000Z'),
      language: 'en',
      includeMermaidCdn: false,
    });
    expect(withoutCdn).not.toContain('cdn.jsdelivr.net');
  });
});
