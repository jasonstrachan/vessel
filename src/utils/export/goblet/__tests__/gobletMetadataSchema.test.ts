import fs from 'node:fs';
import path from 'node:path';

import {
  GOBLET_PROPERTY_MINIFY_MAP,
  GOBLET_PROPERTY_UNMINIFY_MAP,
} from '@/utils/export/goblet/gobletMetadataSchema';
import { __TESTING__ } from '@/utils/export/webglExporter';

const criticalKeys = [
  'brushState',
  'indexBuffer',
  'gradientIdBuffer',
  'gradientDefIdBuffer',
  'speedBuffer',
  'flowBuffer',
  'phaseBuffer',
  'slotPalettes',
  'gradientDefStore',
  'coverageBoundsPx',
  'coverageBoundsSourcePx',
  'alphaMask',
  'softEdgeMask',
];

const readRuntime = (runtime: 'goblet' | 'goblet2'): string => (
  fs.readFileSync(path.join(process.cwd(), 'public', runtime, `${runtime}.js`), 'utf8')
);

describe('goblet metadata schema', () => {
  it('has no duplicate minified keys and supports critical CC fields', () => {
    const minifiedKeys = Object.values(GOBLET_PROPERTY_MINIFY_MAP);

    expect(new Set(minifiedKeys).size).toBe(minifiedKeys.length);
    for (const key of criticalKeys) {
      const minified = GOBLET_PROPERTY_MINIFY_MAP[key as keyof typeof GOBLET_PROPERTY_MINIFY_MAP];
      expect(minified).toBeTruthy();
      expect(GOBLET_PROPERTY_UNMINIFY_MAP[minified]).toBe(key);
    }
  });

  it('minifies through the shared schema', () => {
    expect(__TESTING__.minifyProperties({
      colorCycle: {
        brushState: {
          gradientDefIdBuffer: [1, 2],
          speedBuffer: [3, 4],
        },
      },
    })).toEqual({
      cc: {
        bs: {
          gdib: [1, 2],
          sbf: [3, 4],
        },
      },
    });
  });

  it('keeps Goblet 1 and Goblet 2 runtime unminify maps in contract for critical CC keys', () => {
    for (const runtime of ['goblet', 'goblet2'] as const) {
      const source = readRuntime(runtime);
      for (const key of criticalKeys) {
        const minified = GOBLET_PROPERTY_MINIFY_MAP[key as keyof typeof GOBLET_PROPERTY_MINIFY_MAP];
        expect(source).toContain(`${minified}: '${key}'`);
      }
    }
  });
});
