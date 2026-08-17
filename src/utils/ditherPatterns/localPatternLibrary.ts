import { localDitherPatternRegistry, type DitherPatternRegistry } from './ditherPatternRegistry';
import { parseLocalPatternPack } from './localPatternPack';
import {
  createIndexedDbLocalPatternStorage,
  type LocalPatternLibraryStorage,
  type StoredLocalPatternPack,
} from './localPatternLibraryStorage';

export type LocalPatternPackSummary = Readonly<{
  packId: string;
  name: string;
  contentHash: string;
  patterns: readonly Readonly<{
    id: string;
    name: string;
    payloadHash: string;
  }>[];
}>;

const toSummary = (pack: StoredLocalPatternPack): LocalPatternPackSummary => ({
  packId: pack.packId,
  name: pack.name,
  contentHash: pack.contentHash,
  patterns: pack.patterns.map(({ definition }) => ({
    id: definition.id,
    name: definition.name,
    payloadHash: definition.payloadHash,
  })),
});

export const createLocalPatternLibrary = ({
  storage = createIndexedDbLocalPatternStorage(),
  registry = localDitherPatternRegistry,
}: {
  storage?: LocalPatternLibraryStorage;
  registry?: DitherPatternRegistry;
} = {}) => ({
  hydrate: async (): Promise<readonly LocalPatternPackSummary[]> => {
    const packs = await storage.list();
    registry.clear();
    for (const pack of packs) {
      for (const pattern of pack.patterns) {
        registry.register(pattern);
      }
    }
    return packs.map(toSummary);
  },
  list: async (): Promise<readonly LocalPatternPackSummary[]> =>
    (await storage.list()).map(toSummary),
  install: async (archive: Uint8Array | ArrayBuffer): Promise<LocalPatternPackSummary> => {
    const parsed = await parseLocalPatternPack(archive);
    const existingPacks = await storage.list();
    const identical = existingPacks.find((pack) => (
      pack.packId === parsed.packId && pack.contentHash === parsed.contentHash
    ));
    if (identical) {
      for (const pattern of identical.patterns) {
        registry.register(pattern);
      }
      return toSummary(identical);
    }
    for (const existing of existingPacks) {
      if (existing.packId === parsed.packId) continue;
      const existingIds = new Set(existing.patterns.map(({ definition }) => definition.id));
      const existingHashes = new Set(existing.patterns.map(({ definition }) => definition.payloadHash));
      for (const pattern of parsed.patterns) {
        if (existingIds.has(pattern.definition.id) || existingHashes.has(pattern.definition.payloadHash)) {
          throw new Error('Pattern pack conflicts with an installed local pattern.');
        }
      }
    }
    const previous = existingPacks.find((pack) => pack.packId === parsed.packId);
    const stored: StoredLocalPatternPack = {
      packId: parsed.packId,
      name: parsed.name,
      contentHash: parsed.contentHash,
      archiveBytes: new Uint8Array(parsed.archiveBytes),
      patterns: parsed.patterns.map((pattern) => ({
        definition: pattern.definition,
        thresholds: new Uint8Array(pattern.thresholds),
      })),
    };
    await storage.put(stored);
    for (const pattern of previous?.patterns ?? []) {
      registry.unregister(pattern.definition.id);
    }
    for (const pattern of parsed.patterns) {
      registry.register(pattern);
    }
    return toSummary(stored);
  },
  remove: async (packId: string): Promise<void> => {
    const pack = await storage.get(packId);
    await storage.remove(packId);
    for (const pattern of pack?.patterns ?? []) {
      registry.unregister(pattern.definition.id);
    }
  },
  exportBackup: async (packId: string): Promise<Uint8Array> => {
    const pack = await storage.get(packId);
    if (!pack) {
      throw new Error('Local pattern pack is not installed.');
    }
    return new Uint8Array(pack.archiveBytes);
  },
});

export const localPatternLibrary = createLocalPatternLibrary();
