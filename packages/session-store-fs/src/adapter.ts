import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionStorePort } from '@semantic-diff-tracer/core';

interface Snapshot {
  version: 1;
  entries: Record<string, string>;
}

export interface FileSessionStoreOptions {
  filePath: string;
}

export class FileSessionStore implements SessionStorePort {
  private data: Snapshot | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly options: FileSessionStoreOptions) {}

  private async load(): Promise<void> {
    if (this.data) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await fs.readFile(this.options.filePath, 'utf8');
        const parsed = JSON.parse(raw) as Snapshot;
        this.data = parsed.version === 1 ? parsed : { version: 1, entries: {} };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') this.data = { version: 1, entries: {} };
        else throw e;
      }
    })();
    await this.loading;
  }

  private async persist(): Promise<void> {
    if (!this.data) return;
    await fs.mkdir(dirname(this.options.filePath), { recursive: true });
    await fs.writeFile(this.options.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async get(key: string): Promise<string | undefined> {
    await this.load();
    return this.data!.entries[key];
  }

  async set(key: string, sessionId: string): Promise<void> {
    await this.load();
    this.data!.entries[key] = sessionId;
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.load();
    delete this.data!.entries[key];
    await this.persist();
  }

  async listByPrefix(prefix: string): Promise<Array<{ key: string; sessionId: string }>> {
    await this.load();
    return Object.entries(this.data!.entries)
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, sessionId]) => ({ key, sessionId }));
  }
}
