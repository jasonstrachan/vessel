import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';

export interface GobletTestContext {
  projectId: string;
  projectName: string;
}

export interface GobletTestResult {
  message: string;
  url: string;
}

export interface GobletTester {
  id: string;
  label: string;
  actionLabel?: string;
  canTest?: (artifact: GobletArtifact) => boolean;
  unavailableReason?: string;
  test: (
    artifact: GobletArtifact,
    context: GobletTestContext,
  ) => Promise<GobletTestResult>;
}

const testers = new Map<string, GobletTester>();
const listeners = new Set<() => void>();

const notifyListeners = (): void => {
  for (const listener of listeners) listener();
};

export const registerGobletTester = (tester: GobletTester): (() => void) => {
  if (!tester.id.trim() || !tester.label.trim()) {
    throw new Error('Goblet testers require an id and label');
  }
  if (testers.has(tester.id)) {
    throw new Error(`Goblet tester "${tester.id}" is already registered`);
  }
  testers.set(tester.id, tester);
  notifyListeners();
  return () => {
    if (testers.get(tester.id) === tester) {
      testers.delete(tester.id);
      notifyListeners();
    }
  };
};

export const getGobletTesters = (): GobletTester[] => Array.from(testers.values());

export const subscribeGobletTesters = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
