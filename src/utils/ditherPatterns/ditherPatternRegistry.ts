import type { CumulativeThresholdPatternRuntime } from './cumulativeThresholdPattern';

export type DitherPatternRegistry = Readonly<{
  register: (runtime: CumulativeThresholdPatternRuntime) => void;
  unregister: (patternId: string) => void;
  resolve: (patternId: string) => CumulativeThresholdPatternRuntime | null;
  list: () => readonly CumulativeThresholdPatternRuntime[];
  clear: () => void;
}>;

export const createDitherPatternRegistry = (): DitherPatternRegistry => {
  const patterns = new Map<string, CumulativeThresholdPatternRuntime>();
  return {
    register: (runtime) => {
      const existing = patterns.get(runtime.definition.id);
      if (existing && existing.definition.payloadHash !== runtime.definition.payloadHash) {
        throw new Error(`Pattern id ${runtime.definition.id} is already registered with different content.`);
      }
      patterns.set(runtime.definition.id, runtime);
    },
    unregister: (patternId) => {
      patterns.delete(patternId);
    },
    resolve: (patternId) => patterns.get(patternId) ?? null,
    list: () => Array.from(patterns.values()),
    clear: () => {
      patterns.clear();
    },
  };
};

export const localDitherPatternRegistry = createDitherPatternRegistry();
