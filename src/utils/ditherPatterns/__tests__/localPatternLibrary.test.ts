import { webcrypto } from 'node:crypto';

import JSZip from 'jszip';

import { hashCumulativeThresholdPayload } from '@/utils/ditherPatterns/cumulativeThresholdPattern';
import { createDitherPatternRegistry } from '@/utils/ditherPatterns/ditherPatternRegistry';
import { createLocalPatternLibrary } from '@/utils/ditherPatterns/localPatternLibrary';
import type {
  LocalPatternLibraryStorage,
  StoredLocalPatternPack,
} from '@/utils/ditherPatterns/localPatternLibraryStorage';
import { parseLocalPatternPack } from '@/utils/ditherPatterns/localPatternPack';

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
});

const buildSyntheticPack = async ({
  packId = 'synthetic-pack',
  patternId = 'synthetic-pattern',
  extraFile = false,
}: {
  packId?: string;
  patternId?: string;
  extraFile?: boolean;
} = {}): Promise<Uint8Array> => {
  const payload = new Uint8Array([16, 96, 176, 255, 32, 112, 192, 255]);
  const payloadHash = await hashCumulativeThresholdPayload(payload);
  const payloadPath = `patterns/${patternId}.thresholds.bin`;
  const manifest = {
    schemaVersion: 1,
    pack: { id: packId, name: 'Synthetic Pack', createdAt: '2026-07-22T00:00:00.000Z' },
    patterns: [{
      id: patternId,
      name: 'Synthetic Pattern',
      kind: 'cumulative-threshold',
      width: 4,
      height: 2,
      coveragePolicy: 'mark-tone-map',
      payloadPath,
      payloadHash,
      toneMap: [
        { maxInput: 0.5, tone: 0.2 },
        { maxInput: 1, tone: 0.8 },
      ],
      privateMetadata: { notes: 'Synthetic fixture only.' },
    }],
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file(payloadPath, payload);
  if (extraFile) zip.file('unexpected.txt', 'no');
  return zip.generateAsync({ type: 'uint8array' });
};

const createMemoryStorage = (): LocalPatternLibraryStorage => {
  const records = new Map<string, StoredLocalPatternPack>();
  return {
    list: async () => Array.from(records.values()),
    get: async (packId) => records.get(packId) ?? null,
    put: async (pack) => {
      records.set(pack.packId, pack);
    },
    remove: async (packId) => {
      records.delete(packId);
    },
  };
};

describe('local pattern packs and library', () => {
  it('strictly validates a data-only synthetic pack', async () => {
    const archive = await buildSyntheticPack();
    const parsed = await parseLocalPatternPack(archive);
    expect(parsed.packId).toBe('synthetic-pack');
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].thresholds).toEqual(
      new Uint8Array([16, 96, 176, 255, 32, 112, 192, 255]),
    );
    await expect(parseLocalPatternPack(await buildSyntheticPack({ extraFile: true })))
      .rejects.toThrow('unexpected file');
  });

  it('installs atomically, hydrates the registry, and exports identical bytes', async () => {
    const archive = await buildSyntheticPack();
    const storage = createMemoryStorage();
    const registry = createDitherPatternRegistry();
    const library = createLocalPatternLibrary({ storage, registry });
    const installed = await library.install(archive);

    expect(installed.packId).toBe('synthetic-pack');
    expect(registry.resolve('synthetic-pattern')).not.toBeNull();
    expect(await library.exportBackup('synthetic-pack')).toEqual(archive);
    registry.clear();
    await library.hydrate();
    expect(registry.resolve('synthetic-pattern')).not.toBeNull();
    await library.remove('synthetic-pack');
    expect(registry.resolve('synthetic-pattern')).toBeNull();
    expect(await library.list()).toEqual([]);
  });

  it('rejects duplicate ids and hashes before changing storage or registry', async () => {
    const storage = createMemoryStorage();
    const registry = createDitherPatternRegistry();
    const library = createLocalPatternLibrary({ storage, registry });
    await library.install(await buildSyntheticPack());
    await expect(library.install(await buildSyntheticPack({ packId: 'second-pack' })))
      .rejects.toThrow('conflicts');
    expect(await library.list()).toHaveLength(1);
    expect(registry.list()).toHaveLength(1);
  });
});
