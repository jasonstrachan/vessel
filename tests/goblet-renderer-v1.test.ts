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
    expect(runtime).not.toContain('studio:txt-shape-playback-v1');
    expect(runtime).not.toContain('studio:ui-shape-playback-v1');
    expect(runtime).not.toContain('txt-playback:');
    expect(runtime).not.toContain('ui-playback:');
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
    expect(schema).toContain("rasterLayerIds: 'rli'");
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
      expect(runtime).toContain("rli: 'rasterLayerIds'");
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

  it('accepts a future Studio feature through generic scene requirements', () => {
    const metadata = {
      dynamicFeatures: {
        schemaVersion: 1,
        authored: ['studio:future-brush-v1'],
        compiled: ['studio:future-brush-v1'],
        requirements: [{
          featureId: 'studio:future-brush-v1',
          objects: [
            { objectId: 'future-brush:actor:1', trackProperties: ['visible', 'y', 'x'] },
            { objectId: 'future-brush:actor:0', trackProperties: ['visible', 'y', 'x'] },
          ],
        }],
      },
      automation: {
        schemaVersion: 1,
        durationSeconds: 1,
        objects: [{
          id: 'future-brush:actor:0', kind: 'rect', x: 0, y: 0,
          width: 1, height: 1, fill: '#000000',
        }],
        tracks: [],
      },
    } as WebGLExportMetadata;

    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Dynamic feature objects were not compiled: studio:future-brush-v1:future-brush:actor:1.',
    );
    metadata.automation!.objects.push({
      id: 'future-brush:actor:1', kind: 'rect', x: 0, y: 0,
      width: 1, height: 1, fill: '#000000',
    });
    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Dynamic feature object studio:future-brush-v1:future-brush:actor:0 is missing tracks: visible, x, y.',
    );
    for (const targetId of ['future-brush:actor:0', 'future-brush:actor:1']) {
      metadata.automation!.tracks.push(
        { targetId, property: 'x', keyframes: [{ time: 0, value: 0 }] },
        { targetId, property: 'y', keyframes: [{ time: 0, value: 0 }] },
        { targetId, property: 'visible', keyframes: [{ time: 0, value: true }] },
      );
    }
    expect(() => assertDynamicFeatureManifestComplete(metadata)).not.toThrow();
    expect(metadata.dynamicFeatures?.requirements?.[0]?.objects).toEqual([
      { objectId: 'future-brush:actor:0', trackProperties: ['visible', 'x', 'y'] },
      { objectId: 'future-brush:actor:1', trackProperties: ['visible', 'x', 'y'] },
    ]);

    metadata.dynamicFeatures!.requirements = [];
    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Dynamic features have no object requirements: studio:future-brush-v1.',
    );
  });

  it('accepts a future Studio feature through the raster-tape fallback', () => {
    const metadata = {
      layers: [{
        id: 'future-raster-tape',
        assets: {
          textureFrames: [
            'data:image/png;base64,frame-a',
            'data:image/png;base64,frame-b',
          ],
          textureFrameMap: [0, 1],
        },
        sequential: { fps: 12, totalFrames: 2, durationSeconds: 1 / 6, perfectLoop: true },
      }],
      dynamicFeatures: {
        schemaVersion: 1,
        authored: ['goblet:raster-tape-v1', 'studio:future-raster-brush-v1'],
        compiled: ['goblet:raster-tape-v1', 'studio:future-raster-brush-v1'],
        requirements: [{
          featureId: 'studio:future-raster-brush-v1',
          rasterLayerIds: ['future-raster-tape'],
        }],
      },
    } as WebGLExportMetadata;

    expect(() => assertDynamicFeatureManifestComplete(metadata)).not.toThrow();
    expect(metadata.dynamicFeatures?.requirements).toEqual([{
      featureId: 'studio:future-raster-brush-v1',
      rasterLayerIds: ['future-raster-tape'],
    }]);

    metadata.layers[0]!.assets!.textureFrames = [];
    expect(() => assertDynamicFeatureManifestComplete(metadata)).toThrow(
      'Native dynamic features do not match artwork data: goblet:raster-tape-v1.',
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
