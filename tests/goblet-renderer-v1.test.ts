import fs from 'node:fs';
import path from 'node:path';

import {
  assertDynamicFeatureManifestComplete,
  encodeRendererV1DataChannels,
} from '@/utils/export/goblet/gobletExporter';
import type { WebGLExportMetadata } from '@/utils/export/goblet/gobletTypes';

const read = (relativePath: string): string => (
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
);

describe('Goblet Renderer v1 scene runtime', () => {
  it('uses one exported scene runtime in the exact Goblet 2 artifact', () => {
    const viewer = read('public/goblet2/index.html');
    const runtime = read('public/goblet2/goblet2.js');

    expect(viewer).toContain('mountGobletRendererV1,');
    expect(viewer).toContain('const rendererV1 = mountGobletRendererV1(current, canvas);');
    expect(viewer).toContain('await rendererV1?.ready;');
    expect(viewer).not.toContain('const mountAutomation = (metadata) => {');
    expect(runtime).toContain('export const mountGobletRendererV1 = (metadata, sourceCanvas) => {');
    expect(runtime).toContain("state.kind === 'artwork'");
    expect(runtime).toContain('drawContext.drawImage(\n        sourceCanvas,');
    expect(runtime).toContain('sourceViewer?.setExternalClockActive?.(true);');
    expect(runtime).toContain('sourceViewer?.renderAtTime?.(sourcePlaybackTime);');
  });

  it('supports hierarchy, local clips, shared resources, and symbol instances', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const schema = read('src/utils/export/goblet/gobletMetadataSchema.ts');

    expect(runtime).toContain('parent.children.push(state);');
    expect(runtime).toContain('drawContext.translate(-(Number(state.anchorX) || 0)');
    expect(runtime).toContain('imageResources.get(String(source.resourceId || \'\'))');
    expect(runtime).toContain("state.kind === 'instance'");
    expect(runtime).toContain('symbols.get(String(state.symbolId || \'\'))');
    expect(runtime).toContain("sourceCanvas.dataset.vesselLayerOverlays === 'true'");
    expect(runtime).toContain('detail: { immediate: true, owner: overlay }');
    expect(schema).toContain("resources: 'res'");
    expect(schema).toContain("resourceId: 'rid'");
    expect(schema).toContain("symbols: 'sym'");
    expect(schema).toContain("parentId: 'pid'");
    expect(schema).toContain("layerId: 'lid'");
    expect(schema).toContain("anchorX: 'ax'");
    expect(schema).toContain("sourceX: 'srx'");
    expect(schema).toContain("loopDurationSeconds: 'lds'");
    expect(schema).toContain("requirements: 'req'");
    expect(schema).toContain("objectId: 'oid'");
    expect(schema).toContain("trackProperties: 'tpr'");
    expect(schema).toContain("masks: 'msk'");
    expect(schema).toContain("maskId: 'mid'");
    expect(schema).toContain("dataChannels: 'dch'");
    expect(schema).toContain("dataChannelId: 'dcid'");
    expect(schema).toContain("valueScale: 'vsc'");
  });

  it('keeps the compact scene vocabulary decodable in both Goblet runtimes', () => {
    for (const relativePath of ['public/goblet/goblet.js', 'public/goblet2/goblet2.js']) {
      const runtime = read(relativePath);
      expect(runtime).toContain("res: 'resources'");
      expect(runtime).toContain("rid: 'resourceId'");
      expect(runtime).toContain("sym: 'symbols'");
      expect(runtime).toContain("sid: 'symbolId'");
      expect(runtime).toContain("pid: 'parentId'");
      expect(runtime).toContain("lid: 'layerId'");
      expect(runtime).toContain("ax: 'anchorX'");
      expect(runtime).toContain("ay: 'anchorY'");
      expect(runtime).toContain("srx: 'sourceX'");
      expect(runtime).toContain("lds: 'loopDurationSeconds'");
      expect(runtime).toContain("req: 'requirements'");
      expect(runtime).toContain("oid: 'objectId'");
      expect(runtime).toContain("tpr: 'trackProperties'");
      expect(runtime).toContain("msk: 'masks'");
      expect(runtime).toContain("mid: 'maskId'");
      expect(runtime).toContain("dch: 'dataChannels'");
      expect(runtime).toContain("dcid: 'dataChannelId'");
      expect(runtime).toContain("vsc: 'valueScale'");
    }
  });

  it('keeps masks, isolated groups, and embedded data in the frozen runtime', () => {
    const runtime = read('public/goblet2/goblet2.js');
    expect(runtime).toContain('const buildRendererV1Masks =');
    expect(runtime).toContain("? 'destination-out'");
    expect(runtime).toContain(": 'destination-in'");
    expect(runtime).toContain("state.kind === 'group' && (opacity !== 1");
    expect(runtime).toContain('const dataChannels = new Map(');
    expect(runtime).toContain("track.property === 'playbackTime'");
  });

  it('compacts long numeric channels into deterministic float32 payloads', () => {
    const values = Array.from({ length: 64 }, (_, index) => Math.fround(index / 7));
    const metadata = {
      automation: {
        schemaVersion: 1,
        durationSeconds: 1,
        dataChannels: [{ id: 'motion', values, intervalSeconds: 1 / 60 }],
        objects: [{ id: 'shape', kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: '#000' }],
        tracks: [{ targetId: 'shape', property: 'x', dataChannelId: 'motion' }],
      },
    } as WebGLExportMetadata;

    const compact = encodeRendererV1DataChannels(metadata);
    const channel = compact.automation?.dataChannels?.[0];
    expect(channel).toMatchObject({
      id: 'motion',
      encoding: 'f32le-base64',
      sampleCount: values.length,
    });
    expect(channel?.values).toBeUndefined();
    expect(encodeRendererV1DataChannels(compact)).toEqual(compact);

    const precise = encodeRendererV1DataChannels({
      ...metadata,
      automation: {
        ...metadata.automation!,
        dataChannels: [{ id: 'motion', values: [
          0, 1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1,
        ], intervalSeconds: 1 / 60 }],
      },
    });
    expect(precise.automation?.dataChannels?.[0]?.values).toBeDefined();
  });

  it('fails export when an authored Studio requirement is absent or unresolved', () => {
    const metadata = {
      dynamicFeatures: {
        schemaVersion: 1,
        authored: ['studio:ui-shape-playback-v1'],
        compiled: ['studio:ui-shape-playback-v1'],
        requirements: [{
          featureId: 'studio:ui-shape-playback-v1',
          objects: [
            { objectId: 'ui-playback:cursor:1', trackProperties: ['pressed', 'y', 'x'] },
            { objectId: 'ui-playback:cursor:0', trackProperties: ['pressed', 'y', 'x'] },
          ],
        }],
      },
      automation: {
        schemaVersion: 1,
        durationSeconds: 1,
        objects: [{ id: 'ui-playback:cursor:0', kind: 'cursor', x: 0, y: 0 }],
        tracks: [],
      },
    } as WebGLExportMetadata;

    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Dynamic feature objects were not compiled: studio:ui-shape-playback-v1:ui-playback:cursor:1.',
    );
    metadata.automation!.objects.push({ id: 'ui-playback:cursor:1', kind: 'cursor', x: 0, y: 0 });
    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Dynamic feature object studio:ui-shape-playback-v1:ui-playback:cursor:0 is missing tracks: pressed, x, y.',
    );
    for (const targetId of ['ui-playback:cursor:0', 'ui-playback:cursor:1']) {
      metadata.automation!.tracks.push(
        { targetId, property: 'x', keyframes: [{ time: 0, value: 0 }] },
        { targetId, property: 'y', keyframes: [{ time: 0, value: 0 }] },
        { targetId, property: 'pressed', keyframes: [{ time: 0, value: false }] },
      );
    }
    expect(() => assertDynamicFeatureManifestComplete(metadata)).not.toThrow();
    expect(metadata.dynamicFeatures?.requirements?.[0]?.objects).toEqual([
      { objectId: 'ui-playback:cursor:0', trackProperties: ['pressed', 'x', 'y'] },
      { objectId: 'ui-playback:cursor:1', trackProperties: ['pressed', 'x', 'y'] },
    ]);

    metadata.dynamicFeatures!.requirements = [];
    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Dynamic features have no object requirements: studio:ui-shape-playback-v1.',
    );
  });

  it('fails export when masks or embedded data would be silently omitted', () => {
    const metadata = {
      dynamicFeatures: {
        schemaVersion: 1,
        authored: ['renderer-v1:test-scene-v1'],
        compiled: ['renderer-v1:test-scene-v1'],
      },
      automation: {
        schemaVersion: 1,
        durationSeconds: 1,
        masks: [{
          id: 'reveal', dataUrl: 'data:image/png;base64,AAAA',
          x: 0, y: 0, width: 1, height: 1,
        }],
        dataChannels: [{ id: 'motion', values: [0, 1], intervalSeconds: 1 }],
        objects: [{ id: 'shape', kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: '#000' }],
        tracks: [],
      },
    } as WebGLExportMetadata;

    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Renderer v1 has unused masks: reveal.',
    );
    metadata.automation!.objects[0]!.maskId = 'reveal';
    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Renderer v1 has unused data channels: motion.',
    );
    metadata.automation!.tracks.push({
      targetId: 'reveal', property: 'x', dataChannelId: 'motion',
    });
    expect(() => assertDynamicFeatureManifestComplete(metadata)).not.toThrow();
  });
});
