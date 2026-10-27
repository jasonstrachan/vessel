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
  'adjustmentGroups',
  'adjustment',
  'effect',
  'targetLayerIds',
];

const readRuntime = (runtime: 'goblet' | 'goblet2'): string => (
  fs.readFileSync(path.join(process.cwd(), 'public', runtime, `${runtime}.js`), 'utf8')
);

describe('goblet metadata schema', () => {
  describe.each(['goblet', 'goblet2'] as const)('%s actual metadata decoder', (runtime) => {
    const loadDecoder = () => {
      const source = readRuntime(runtime);
      const map = source.match(/const PROPERTY_UNMINIFY_MAP = (\{[\s\S]*?\n\});/);
      const start = source.indexOf('const expandMinifiedProperties =');
      const end = source.indexOf("\nif (typeof window", start);
      if (!map || start < 0 || end < 0) throw new Error('Actual runtime metadata decoder missing');
      return new Function(`const PROPERTY_UNMINIFY_MAP = ${map[1]};\n${source.slice(start, end).replace('export const expandVesselMetadata', 'const expandVesselMetadata')}\nreturn { map: PROPERTY_UNMINIFY_MAP, expand: expandVesselMetadata };`)() as {
        map: Record<string, string>;
        expand: (value: unknown) => unknown;
      };
    };

    it('decodes every canonical schema alias without claiming renderer feature support', () => {
      const decoder = loadDecoder();
      expect(Object.fromEntries(Object.keys(GOBLET_PROPERTY_UNMINIFY_MAP).map(key => [key, decoder.map[key]]))).toEqual(GOBLET_PROPERTY_UNMINIFY_MAP);
      expect(decoder.map.plc).toBe('placement');
      const original = Object.fromEntries(Object.keys(GOBLET_PROPERTY_MINIFY_MAP).map(key => [key, `literal-${key}`]));
      expect(decoder.expand(__TESTING__.minifyProperties(original))).toEqual(original);
    });

    it('preserves nested presentation, image assets, unknown fields and unminified metadata', () => {
      const decoder = loadDecoder();
      const original = {
        format: 'vessel',
        settings: { htmlTitle: 'Literal title', htmlBackgroundColor: '#123456', futureSetting: { literal: 17 } },
        layers: [{ paintedSize: { width: 128, height: 96 }, futureLayerField: ['unchanged'] }],
        uiImageAssets: [{ assetId: 'image-1', naturalWidth: 64, naturalHeight: 48, createdAt: 3, updatedAt: 7 }],
        unknownExtension: { literal: true },
      };
      const compact = __TESTING__.minifyProperties(original);
      const before = JSON.stringify(compact);
      expect(decoder.expand(compact)).toEqual(original);
      expect(JSON.stringify(compact)).toBe(before);
      expect(decoder.expand(original)).toBe(original);
    });
  });

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

  it('keeps Renderer v1 cursor hand state compact and decodable', () => {
    expect(__TESTING__.minifyProperties({
      automation: {
        objects: [{ id: 'cursor', kind: 'cursor', hand: true }],
        tracks: [{
          targetId: 'cursor',
          property: 'hand',
          keyframes: [{ time: 0, value: true }],
        }],
      },
    })).toEqual({
      au: {
        obj: [{ i: 'cursor', k: 'cursor', hd: true }],
        trk: [{
          tid: 'cursor',
          pr: 'hand',
          kf: [{ tm: 0, val: true }],
        }],
      },
    });
    expect(GOBLET_PROPERTY_UNMINIFY_MAP.hd).toBe('hand');
    expect(readRuntime('goblet2')).toContain("hd: 'hand'");
  });

  it('keeps Goblet runtimes in contract for their supported minified fields', () => {
    for (const runtime of ['goblet', 'goblet2'] as const) {
      const source = readRuntime(runtime);
      for (const key of criticalKeys) {
        if (
          runtime === 'goblet'
          && ['adjustmentGroups', 'adjustment', 'effect', 'targetLayerIds'].includes(key)
        ) {
          continue;
        }
        const minified = GOBLET_PROPERTY_MINIFY_MAP[key as keyof typeof GOBLET_PROPERTY_MINIFY_MAP];
        expect(source).toContain(`${minified}: '${key}'`);
      }
    }
  });
});
