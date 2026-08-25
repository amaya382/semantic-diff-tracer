import * as vscode from 'vscode';
import {
  ClaudeLlmProvider,
  clampFlowMaxTurns,
  formatUsageForLog,
  resolveClaudeExecutable,
} from '@semantic-diff-tracer/llm-claude';
import type { ClaudeAdapterOptions } from '@semantic-diff-tracer/llm-claude';
import type { Conversation, LlmProvider, LoggerPort } from '@semantic-diff-tracer/core';

const MISSING_EXECUTABLE_MESSAGE =
  'Semantic Diff Tracer: the claude CLI was not found. Install Claude Code, or set ' +
  '"sdt.claudeExecutable" to its absolute path.';

type ModelAlias = 'sonnet' | 'opus' | 'haiku' | 'inherit';

function resolveModel(choice: string): ModelAlias | string | undefined {
  if (!choice || choice === 'default') return undefined;
  if (choice === 'sonnet' || choice === 'opus' || choice === 'haiku' || choice === 'inherit') {
    return choice;
  }
  return choice;
}

function resolveEnv(raw: unknown): Record<string, string> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const entries: [string, string][] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, value } = item as { name?: unknown; value?: unknown };
    if (typeof name === 'string' && name.length > 0 && typeof value === 'string') {
      entries.push([name, value]);
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function buildClaudeProvider(cwd: string, logger?: LoggerPort): LlmProvider {
  // Env vars win over user settings so launch.json profiles can pin a fast
  // model for the dev host without touching global preferences.
  const config = vscode.workspace.getConfiguration('sdt');
  const claudeExec = resolveClaudeExecutable(config.get<string>('claudeExecutable', ''));
  if (!claudeExec) return missingExecutableProvider();
  const modelChoice = process.env['SDT_CLAUDE_MODEL'] ?? config.get<string>('claudeModel', 'sonnet');
  const modelSource = process.env['SDT_CLAUDE_MODEL'] ? 'env' : 'settings';
  const model = resolveModel(modelChoice);
  const env = resolveEnv(config.get('environmentVariables'));
  const opts: ClaudeAdapterOptions = {
    cwd,
    pathToClaudeCodeExecutable: claudeExec,
  };
  if (env) opts.env = env;
  if (model) opts.model = model;
  if (logger) {
    logger.info('llm', 'config', {
      model: model ?? 'default (SDK inherits)',
      modelSource,
    });
    opts.onStderr = (chunk) => logger.warn('llm', 'claude stderr', { chunk: chunk.trim() });
    opts.onUsage = (usage) => {
      logger.info('llm', 'tokens', {
        configuredModel: model ?? 'default',
        ...formatUsageForLog(usage),
      });
    };
  }
  return new ClaudeLlmProvider(opts);
}

/**
 * Stands in when no CLI can be found, so the failure surfaces as one readable
 * message per attempted operation instead of an SDK spawn error.
 */
function missingExecutableProvider(): LlmProvider {
  const conversation: Conversation = {
    id: '',
    async ask() {
      throw new Error(MISSING_EXECUTABLE_MESSAGE);
    },
    fork() {
      return conversation;
    },
  };
  return {
    startConversation: () => conversation,
    resumeConversation: () => conversation,
  };
}

/** Read the free-form language hint appended to every LLM prompt. Empty string means no hint. */
export function readLanguageHint(): string {
  const config = vscode.workspace.getConfiguration('sdt');
  return (config.get<string>('language', 'en') || '').trim();
}

export function readDefaultBaseBranch(): string {
  const config = vscode.workspace.getConfiguration('sdt');
  return config.get<string>('defaultBaseBranch', 'main');
}

export function readFlowMaxTurns(): number {
  const config = vscode.workspace.getConfiguration('sdt');
  return clampFlowMaxTurns(config.get<number>('flowMaxTurns', 5));
}
