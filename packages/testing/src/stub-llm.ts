import type {
  Conversation,
  LlmAskInput,
  LlmAskResult,
  LlmProvider,
} from '@semantic-diff-tracer/core';

export interface StubResponse {
  text: string;
  conversationId?: string;
}

export interface StubLlmOptions {
  /**
   * Map of matcher → response. Each matcher runs against the concatenated
   * `system + '\n\n' + user` string; the first match wins.
   */
  responses: Array<{ match: RegExp | ((input: LlmAskInput) => boolean); response: StubResponse }>;
  /** Fallback response when no matcher matches. Throws if not provided. */
  fallback?: StubResponse;
}

export class StubLlmProvider implements LlmProvider {
  private counter = 0;

  constructor(private readonly options: StubLlmOptions) {}

  startConversation(): Conversation {
    return new StubConversation(this, '');
  }

  resumeConversation(id: string): Conversation {
    return new StubConversation(this, id);
  }

  /** @internal — used by StubConversation to draw synthetic ids. */
  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  /** @internal — matches an ask against the configured responses. */
  match(input: LlmAskInput): StubResponse {
    for (const entry of this.options.responses) {
      const matched =
        entry.match instanceof RegExp
          ? entry.match.test(`${input.system}\n\n${input.user}`)
          : entry.match(input);
      if (matched) return entry.response;
    }
    if (this.options.fallback) return this.options.fallback;
    throw new Error(
      `StubLlmProvider: no matching response for input (system starts with "${input.system.slice(0, 60)}").`,
    );
  }
}

class StubConversation implements Conversation {
  constructor(
    private readonly provider: StubLlmProvider,
    private currentId: string,
  ) {}

  get id(): string {
    return this.currentId;
  }

  async ask(input: LlmAskInput): Promise<LlmAskResult> {
    const response = this.provider.match(input);
    if (response.conversationId) {
      this.currentId = response.conversationId;
    } else if (!this.currentId) {
      this.currentId = this.provider.nextId('stub-conv-');
    }
    return { text: response.text };
  }

  fork(): Conversation {
    return new StubConversation(this.provider, this.provider.nextId(`${this.currentId}-fork`));
  }
}
