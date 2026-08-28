import fs from 'node:fs';
import path from 'node:path';

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
    expect(runtime).toContain('sourceViewer?.renderAtTime?.(resolved);');
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
    }
  });
});
