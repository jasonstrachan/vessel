import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';

export interface GobletPublishContext {
  projectId: string;
  projectName: string;
}

export interface GobletPublishResult {
  message: string;
  url?: string;
}

export interface GobletPublisher {
  id: string;
  label: string;
  publish: (
    artifact: GobletArtifact,
    context: GobletPublishContext,
  ) => Promise<GobletPublishResult>;
}

const publishers = new Map<string, GobletPublisher>();
const listeners = new Set<() => void>();

const notifyListeners = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const registerGobletPublisher = (publisher: GobletPublisher): (() => void) => {
  if (!publisher.id.trim() || !publisher.label.trim()) {
    throw new Error('Goblet publishers require an id and label');
  }
  if (publishers.has(publisher.id)) {
    throw new Error(`Goblet publisher "${publisher.id}" is already registered`);
  }
  publishers.set(publisher.id, publisher);
  notifyListeners();
  return () => {
    if (publishers.get(publisher.id) === publisher) {
      publishers.delete(publisher.id);
      notifyListeners();
    }
  };
};

export const getGobletPublishers = (): GobletPublisher[] => Array.from(publishers.values());

export const subscribeGobletPublishers = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
