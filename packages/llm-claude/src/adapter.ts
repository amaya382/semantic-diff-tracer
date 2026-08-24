import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type {
  Conversation,
  LlmAskInput,
  LlmAskResult,
  LlmProvider,
} from '@semantic-diff-tracer/core';

export interface ClaudeAdapterOptions {
  cwd?: string;
  /**
   * Either an SDK alias (`sonnet` / `opus` / `haiku` / `inherit`) or a full
   * model id. Passed through to the SDK's `Options.model`.
   */
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit' | (string & {});
  pathToClaudeCodeExecutable?: string;
  /**
   * Maps to the SDK's `maxThinkingTokens`. Leave unset to inherit the SDK/CLI
   * default (no explicit cap).
   */
  maxThinkingTokens?: number;
  /**
   * Extra environment variables merged over `process.env` before spawning the
   * CLI. Vertex/Bedrock credentials belong here (`CLAUDE_CODE_USE_VERTEX=1`,
   * `ANTHROPIC_VERTEX_PROJECT_ID=...`, `AWS_*`, etc.) — the adapter pins
   * `settingSources` to `[]` so `~/.claude/settings.json` is never loaded,
   * which means anything that provider auth would normally take from there
   * has to arrive via env instead. OAuth logins keep working because
   * `~/.claude/.credentials.json` is read independently of `settingSources`.
   */
  env?: Record<string, string | undefined>;
  /** Receives the CLI's stderr. Unset means the SDK discards the stream. */
  onStderr?: (chunk: string) => void;
  /**
   * Called once per successful or failed `ask()` with the token counts and
   * duration reported by the CLI's final `result` message. Unset means the
   * usage numbers are dropped. Callers use this to log per-call token spend
   * without pushing the responsibility into the domain layer.
   */
  onUsage?: (usage: LlmCallUsage) => void;
}

export interface LlmCallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Sum of the four counts above — handy when a caller just wants one number. */
  totalTokens: number;
  /** Wall-clock elapsed ms from ask start to the result message. */
  durationMs: number;
  /**
   * API-only elapsed ms as measured by the CLI: excludes tool executions and
   * local scheduling, so it is closer to "time the model was actually working".
   */
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  /** Per-model breakdown, keyed by the SDK's model name. */
  models: Record<string, ModelCallUsage>;
}

export interface ModelCallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

const STDERR_CHUNK_LIMIT = 50;

/**
 * The guide only ever reads the checkout, so the CLI gets a read-only toolset.
 * Anything outside this list would raise a permission request the SDK has no
 * way to answer, and every denial costs one of the turns `maxTurns` allows.
 */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

interface StreamUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface StreamModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

interface StreamMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  num_turns?: number;
  errors?: unknown[];
  permission_denials?: unknown[];
  usage?: StreamUsage;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  modelUsage?: Record<string, StreamModelUsage>;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
}

async function collect(
  stream: AsyncIterable<unknown>,
  stderr: () => string,
): Promise<{ sessionId: string; text: string; result?: StreamMessage }> {
  let sessionId = '';
  let result: StreamMessage | undefined;
  const chunks: string[] = [];
  try {
    for await (const raw of stream) {
      const m = raw as StreamMessage;
      if (m.session_id && !sessionId) sessionId = m.session_id;
      if (m.type === 'result') result = m;
      if (m.type === 'assistant' && m.message?.content) {
        for (const block of m.message.content) {
          if (block.type === 'text' && block.text) chunks.push(block.text);
        }
      }
    }
  } catch (e) {
    throw new Error(describeFailure(e as Error, result, chunks.join(''), stderr()));
  }
  if (result && failed(result)) {
    throw new Error(describeFailure(undefined, result, chunks.join(''), stderr()));
  }
  if (!sessionId) throw new Error('Claude Agent SDK did not emit a session_id');
  return { sessionId, text: chunks.join(''), ...(result ? { result } : {}) };
}

function extractUsage(result: StreamMessage | undefined): LlmCallUsage | undefined {
  if (!result) return undefined;
  const u = result.usage ?? {};
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheCreationInputTokens = u.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = u.cache_read_input_tokens ?? 0;
  const models: Record<string, ModelCallUsage> = {};
  for (const [name, mu] of Object.entries(result.modelUsage ?? {})) {
    models[name] = {
      inputTokens: mu.inputTokens ?? 0,
      outputTokens: mu.outputTokens ?? 0,
      cacheReadInputTokens: mu.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: mu.cacheCreationInputTokens ?? 0,
      costUSD: mu.costUSD ?? 0,
    };
  }
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    durationMs: result.duration_ms ?? 0,
    durationApiMs: result.duration_api_ms ?? 0,
    numTurns: result.num_turns ?? 0,
    totalCostUsd: result.total_cost_usd ?? 0,
    models,
  };
}

function failed(result: StreamMessage): boolean {
  return result.subtype !== 'success' || result.is_error === true;
}

/**
 * The SDK reports a bare exit code, while the reason is spread across the
 * streamed output: the CLI states it in the final `result` message (turn limit,
 * execution error), refusals and auth failures ("Not logged in · Please run
 * /login") arrive as assistant text, and config errors land on stderr. Fold
 * them into one message so a single logged line explains the failure.
 */
function describeFailure(
  error: Error | undefined,
  result: StreamMessage | undefined,
  text: string,
  stderr: string,
): string {
  // The exit code says nothing the result message doesn't say better.
  const parts = [result ? describeResult(result) : (error?.message ?? 'Claude Code failed')];
  const said = tail(text.trim(), 400);
  if (said) parts.push(`Claude Code said: ${said}`);
  const err = tail(stderr.trim(), 400);
  if (err) parts.push(`stderr: ${err}`);
  return parts.join(' — ');
}

function describeResult(result: StreamMessage): string {
  const parts: string[] = [];
  if (result.subtype === 'error_max_turns') {
    parts.push(`Claude Code hit its turn limit after ${result.num_turns ?? '?'} turns`);
  } else if (result.subtype === 'success') {
    // A "successful" turn whose last assistant message is an API error.
    parts.push('Claude Code returned an API error');
  } else {
    parts.push(`Claude Code ended with ${result.subtype ?? 'an unknown result'}`);
  }
  const errors = (result.errors ?? []).map((e) => String(e)).filter(Boolean);
  if (errors.length > 0) parts.push(errors.join('; '));
  const denials = result.permission_denials?.length ?? 0;
  if (denials > 0) parts.push(`${denials} tool call(s) denied for want of permission`);
  return parts.join(': ');
}

function tail(value: string, max: number): string {
  return value.length <= max ? value : `…${value.slice(-max)}`;
}

export class ClaudeLlmProvider implements LlmProvider {
  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  startConversation(): Conversation {
    return new ClaudeConversation(this.options, { resumeId: undefined, forkOnNext: false });
  }

  resumeConversation(id: string): Conversation {
    return new ClaudeConversation(this.options, { resumeId: id, forkOnNext: false });
  }
}

interface ConversationInitialState {
  /** SDK `resume` value for the next ask, or undefined for a fresh conversation. */
  resumeId: string | undefined;
  /** When true, the next ask also sets `forkSession: true`, branching a new thread. */
  forkOnNext: boolean;
}

class ClaudeConversation implements Conversation {
  private currentId = '';
  private resumeId: string | undefined;
  private forkOnNext: boolean;

  constructor(
    private readonly options: ClaudeAdapterOptions,
    init: ConversationInitialState,
  ) {
    this.resumeId = init.resumeId;
    this.forkOnNext = init.forkOnNext;
    if (init.resumeId) this.currentId = init.resumeId;
  }

  get id(): string {
    return this.currentId;
  }

  fork(): Conversation {
    // A fork branches from *this* conversation's current head. If we've never
    // asked yet, we still resume from whatever id seeded us; if we have, the
    // last ask's session id supersedes it.
    const parent = this.currentId || this.resumeId;
    if (!parent) {
      throw new Error(
        'Claude adapter: cannot fork a conversation that has neither been resumed nor asked yet.',
      );
    }
    return new ClaudeConversation(this.options, { resumeId: parent, forkOnNext: true });
  }

  async ask(input: LlmAskInput): Promise<LlmAskResult> {
    const sdkOptions: Options = {};
    const cwd = input.cwd ?? this.options.cwd;
    if (cwd) sdkOptions.cwd = cwd;
    if (this.resumeId) {
      sdkOptions.resume = this.resumeId;
      if (this.forkOnNext) sdkOptions.forkSession = true;
    }
    if (input.system && input.system.length > 0) sdkOptions.systemPrompt = input.system;
    if (typeof input.maxTurns === 'number' && input.maxTurns > 0) {
      sdkOptions.maxTurns = input.maxTurns;
    }
    this.applyStaticOptions(sdkOptions);

    const user = input.language
      ? `${input.user}\n\nRespond in ${input.language}.`
      : input.user;

    const stderrChunks: string[] = [];
    sdkOptions.stderr = (chunk: string) => {
      // A long turn can emit unbounded stderr; only the tail is diagnostic.
      stderrChunks.push(chunk);
      if (stderrChunks.length > STDERR_CHUNK_LIMIT) stderrChunks.shift();
      this.options.onStderr?.(chunk);
    };

    const stream = query({ prompt: user, options: sdkOptions });
    const collected = await collect(
      stream as unknown as AsyncIterable<unknown>,
      () => stderrChunks.join(''),
    );
    if (this.options.onUsage) {
      const usage = extractUsage(collected.result);
      if (usage) this.options.onUsage(usage);
    }
    // Once we've asked, the CLI's session id is authoritative; subsequent asks
    // resume from *it* rather than the id we were seeded with, and we don't
    // fork a second time even if this conversation was born from fork().
    this.currentId = collected.sessionId;
    this.resumeId = collected.sessionId;
    this.forkOnNext = false;
    return { text: collected.text };
  }

  private applyStaticOptions(sdkOptions: Options): void {
    // Restrict the toolset *and* pre-allow it: `tools` keeps Bash and the edit
    // tools out of the model's hands, `allowedTools` keeps the survivors from
    // stalling on a permission prompt nobody is there to answer.
    sdkOptions.tools = [...READ_ONLY_TOOLS];
    sdkOptions.allowedTools = [...READ_ONLY_TOOLS];
    // Isolation mode: no `settings.json` is loaded, so the caller's
    // `~/.claude/CLAUDE.md`, hooks, permissions, and enabled plugins never
    // reach the child. Provider auth comes from `.credentials.json` (loaded
    // independently) or from the `env` option below.
    sdkOptions.settingSources = [];
    if (this.options.env) {
      sdkOptions.env = { ...process.env, ...this.options.env };
    }
    if (this.options.model) sdkOptions.model = this.options.model;
    if (this.options.pathToClaudeCodeExecutable) {
      sdkOptions.pathToClaudeCodeExecutable = this.options.pathToClaudeCodeExecutable;
    }
    if (typeof this.options.maxThinkingTokens === 'number' && this.options.maxThinkingTokens > 0) {
      sdkOptions.maxThinkingTokens = this.options.maxThinkingTokens;
    }
  }
}
