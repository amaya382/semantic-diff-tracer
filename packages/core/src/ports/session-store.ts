export type SessionScope =
  | { kind: 'base' }
  | { kind: 'perspective'; perspectiveId: string }
  | { kind: 'summary'; perspectiveId: string }
  | { kind: 'qa'; perspectiveId: string; sectionId: string }
  | { kind: 'flow'; perspectiveId: string };

export function sessionKey(prRefKey: string, scope: SessionScope): string {
  switch (scope.kind) {
    case 'base':
      return `${prRefKey}::base`;
    case 'perspective':
      return `${prRefKey}::perspective:${scope.perspectiveId}`;
    case 'summary':
      return `${prRefKey}::summary:${scope.perspectiveId}`;
    case 'qa':
      return `${prRefKey}::qa:${scope.perspectiveId}:${scope.sectionId}`;
    case 'flow':
      return `${prRefKey}::flow:${scope.perspectiveId}`;
  }
}

export interface SessionStorePort {
  get(key: string): Promise<string | undefined>;
  set(key: string, sessionId: string): Promise<void>;
  delete(key: string): Promise<void>;
  listByPrefix(prefix: string): Promise<Array<{ key: string; sessionId: string }>>;
}
