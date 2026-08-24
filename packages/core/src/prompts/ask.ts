import type { QaContextRef } from '../domain/qa.js';

export const ASK_SYSTEM_PROMPT = `You are answering a reviewer's question about a specific perspective of a pull request. You have access to the perspective's summary and (through parent session) the PR diff. Answer in prose (markdown allowed for lists and code fences); do not emit JSON. Be concrete: name files, lines, and symbols; if you must speculate say so.`;

export function buildAskUserMessage(
  question: string,
  contextRef: QaContextRef | undefined,
): string {
  if (!contextRef) return question.trim();
  const locator =
    contextRef.file && typeof contextRef.startLine === 'number'
      ? contextRef.endLine && contextRef.endLine !== contextRef.startLine
        ? `${contextRef.file}, lines ${contextRef.startLine}-${contextRef.endLine}`
        : `${contextRef.file}, line ${contextRef.startLine}`
      : 'the summary';
  return `I selected the following from ${locator}:

"""
${contextRef.selection.trim()}
"""

Question: ${question.trim()}`;
}

export function buildFollowUpUserMessage(question: string): string {
  return question.trim();
}
