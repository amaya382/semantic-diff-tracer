export interface QaContextRef {
  file?: string;
  startLine?: number;
  endLine?: number;
  /** Text the user drag-selected; kept for display and prompt prefixing. */
  selection: string;
}

export interface QaTurn {
  at: string;
  question: string;
  answer: string;
}

export interface QaSection {
  sectionId: string;
  createdAt: string;
  contextRef?: QaContextRef;
  turns: QaTurn[];
  /** Conversation id for follow-up resumes; produced on the first turn. */
  conversationId?: string;
  /**
   * Which parent conversation was forked to seed this section. Kept so the UI
   * can badge Trace-originating threads distinctly and future refresh paths can
   * re-fork the right parent.
   */
  forkOrigin?: 'summary' | 'flow';
}
