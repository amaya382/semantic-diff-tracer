import type { SessionStorePort } from '@semantic-diff-tracer/core';

export class MemorySessionStore implements SessionStorePort {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }
  async set(key: string, sessionId: string): Promise<void> {
    this.data.set(key, sessionId);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async listByPrefix(prefix: string): Promise<Array<{ key: string; sessionId: string }>> {
    return Array.from(this.data.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, sessionId]) => ({ key, sessionId }));
  }
}
