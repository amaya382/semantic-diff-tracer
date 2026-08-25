export interface LlmAskInput {
  system: string;
  user: string;
  /** Free-form BCP-47-ish language hint; adapters append "Respond in <language>." */
  language?: string;
  signal?: AbortSignal;
  /** Working directory hint for providers that read local files during a turn. */
  cwd?: string;
  /**
   * Cap the number of agent turns (assistant → tool → assistant round-trips).
   * For plan-flow style prompts, a small cap prevents runaway exploration.
   * Adapters that don't run an agentic loop ignore this.
   */
  maxTurns?: number;
  /**
   * Restrict the agent's toolset for this ask. Omit to use the adapter's
   * default read-only set. An empty array means single-shot (no tools).
   */
  tools?: readonly string[];
}

export interface LlmAskResult {
  text: string;
}

/**
 * A live thread of turns with the model. `id` names the persisted state a
 * caller can later hand back to `LlmProvider.resumeConversation` to reopen
 * this same thread; `fork()` branches a new thread whose future turns leave
 * the original untouched.
 *
 * The id is stable across `ask()` calls: once the conversation has been
 * started (either explicitly or by its first `ask()`), the id it exposes is
 * the one to persist. Before the first `ask()` the id may be empty.
 */
export interface Conversation {
  readonly id: string;
  ask(input: LlmAskInput): Promise<LlmAskResult>;
  fork(): Conversation;
}

export interface LlmProvider {
  /** Start a brand-new conversation. The id is fixed once the first ask() completes. */
  startConversation(): Conversation;
  /** Reopen a previously persisted conversation by its id. */
  resumeConversation(id: string): Conversation;
}
