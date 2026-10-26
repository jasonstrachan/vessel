import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

describe('Goblet display filter runtime parity', () => {
  it('scopes the display filter pipeline inside the Goblet 1 inline runtime', () => {
    const runtime = read('public/goblet/goblet-inline.js');

    expect(runtime).toContain(
      '{getSeamlessNoisePatternSize:getSeamlessNoisePatternSize,createTileableNoiseGrid:createTileableNoiseGrid,createDisplayFilterPipelineState:createDisplayFilterPipelineState'
    );
    expect(runtime).toContain(
      'applyDisplayFilterStack:applyDisplayFilterStack,applyAdjustmentEffect:applyAdjustmentEffect}=(()=>{',
    );
  });

  it('includes display filter handling in Goblet 1', () => {
    const runtime = read('public/goblet/goblet.js');

    expect(runtime).toContain('const getGobletDisplayFilters = (metadata) => (');
    expect(runtime).toContain("} from './displayFilterPipeline.js';");
    expect(runtime).toContain('this.displayFilterState = createDisplayFilterPipelineState();');
    expect(runtime).not.toContain('documentSize.width * documentViewportMapping.scaleX');
    expect(runtime).toContain('const filterLengthScale = isFixed ? Math.max(dpr, 1e-4) : 1;');
    expect(runtime).toContain("const transparencyMode = metadata?.settings?.transparencyBackgroundMode === 'gray' ? 'gray' : 'checker';");
    expect(runtime).toContain('paintGobletBackground(ctx, clearWidth, clearHeight, this.metadata);');
    expect(runtime).toContain('paintGobletBackground(filterCtx, clearWidth, clearHeight, this.metadata);');
    expect(runtime).toContain('renderWidth: clearWidth,');
    expect(runtime).toContain('renderHeight: clearHeight,');
    expect(runtime).toContain('visibleRect: {');
    expect(runtime).toContain('width: clearWidth,');
    expect(runtime).toContain('height: clearHeight,');
    expect(runtime).toContain('lengthScale: filterLengthScale');
    expect(runtime).toContain('const finalFilteredCanvas = applyDisplayFilterStack({');
    expect(runtime).toContain('ctx.drawImage(finalFilteredCanvas, 0, 0);');
  });

  it('keeps Goblet 1 static cache and hidden-animation skip in the module runtime', () => {
    const runtime = read('public/goblet/goblet.js');

    expect(runtime).toContain('this.dynamicPlayers = entries\n      .filter((entry) => entry.layer.visible !== false)');
    expect(runtime).toContain('this.sortedLayerEntries = [...entries];');
    expect(runtime).toContain('this.staticLayerEntries = this.sortedLayerEntries.filter((entry) => (');
    expect(runtime).toContain('this.dynamicLayerEntries = this.sortedLayerEntries.filter((entry) => (');
    expect(runtime).toContain('this.staticCompositeLayerKey = JSON.stringify(this.staticLayerEntries.map((entry) => [');
    expect(runtime).toContain('this.staticCompositeCtx = null;');
    expect(runtime).toContain('const staticLayersRequireBackdrop = this.staticLayerEntries.some((entry) => (');
    expect(runtime).toContain("(entry.layer.blendMode ?? 'source-over') !== 'source-over'");
    expect(runtime).toContain('this.canUseStaticComposite = !staticLayersRequireBackdrop;');
    expect(runtime).toContain('getStaticComposite(renderOptions, profile)');
    expect(runtime).toContain('entry.layer.visible !== false && !this.isDynamicEntry(entry)');
    expect(runtime).toContain('let seenDynamicLayer = false;');
    expect(runtime).toContain('if (!this.canUseStaticComposite) {');
    expect(runtime).toContain('const staticEntries = this.staticLayerEntries;');
    expect(runtime).toContain('const key = [');
    expect(runtime).toContain('const cacheCtx = this.staticCompositeCtx ?? canvas.getContext(\'2d\');');
    expect(runtime).toContain('renderCtx.drawImage(staticComposite, 0, 0);');
    expect(runtime).toContain('this.dynamicLayerEntries.forEach((entry, index) => {');
    expect(runtime).toContain('if (diagnosticsEnabled) {\n      const transformBeforeDraw = snapshotTransform(renderCtx);');
    expect(runtime).toContain('if (diagnosticsEnabled) {\n      units = isFixed ? \'backing\' : \'css\';');
  });

  it('does not sample cropped fixed-mode sources through document bounds in Goblet 1', () => {
    const runtime = read('public/goblet/goblet.js');

    expect(runtime).toContain('const sourceMatchesDocument = Math.abs(sourceWidth - documentSize.width) <= 0.5');
    expect(runtime).toContain('(isFixed && sourceMatchesDocument)');
    expect(runtime).toContain('isColorCycleLayer && sourceMatchesDocument');
  });

  it('includes display filter handling in Goblet 2', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const getGobletDisplayFilters = (metadata) => (');
    expect(runtime).toContain("} from './displayFilterPipeline.js';");
    expect(runtime).toContain('this.displayFilterState = createDisplayFilterPipelineState();');
    expect(runtime).not.toContain('documentSize.width * documentViewportMapping.scaleX');
    expect(runtime).toContain('const filterLengthScale = isFixed ? Math.max(dpr, 1e-4) : 1;');
    expect(runtime).toContain("const transparencyMode = metadata?.settings?.transparencyBackgroundMode === 'gray' ? 'gray' : 'checker';");
    expect(runtime).toContain('paintGobletBackground(ctx, clearWidth, clearHeight, this.metadata);');
    expect(runtime).toContain('paintGobletBackground(filterCtx, clearWidth, clearHeight, this.metadata);');
    expect(runtime).toContain('renderWidth: clearWidth,');
    expect(runtime).toContain('renderHeight: clearHeight,');
    expect(runtime).toContain('visibleRect: {');
    expect(runtime).toContain('width: clearWidth,');
    expect(runtime).toContain('height: clearHeight,');
    expect(runtime).toContain('lengthScale: filterLengthScale');
    expect(runtime).toContain('const finalFilteredCanvas = applyDisplayFilterStack({');
    expect(runtime).toContain('ctx.drawImage(finalFilteredCanvas, 0, 0);');
    expect(runtime).toContain('const shouldApplyDirectOverlayFilter = hasEnabledDisplayFiltersInList(');
    expect(runtime).toContain("'direct-overlay-only'");
    expect(runtime).toContain('directOverlayTarget: {');
    expect(runtime).not.toContain('shouldApplyNoiseOnlyFilter');
    expect(runtime).not.toContain('noiseOnlyTarget');
  });

  it('scopes the display filter pipeline inside the Goblet 2 inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain(
      '{getSeamlessNoisePatternSize:getSeamlessNoisePatternSize,createTileableNoiseGrid:createTileableNoiseGrid,createDisplayFilterPipelineState:createDisplayFilterPipelineState'
    );
    expect(runtime).toContain(
      'applyDisplayFilterStack:applyDisplayFilterStack,applyAdjustmentEffect:applyAdjustmentEffect}=(()=>{',
    );
    expect(runtime).toContain('direct-overlay-only');
    expect(runtime).toContain('directOverlayTarget');
  });

  it('generates the clustered Film Noise pipeline for both Goblet runtimes', () => {
    const source = read('src/lib/displayFilterPipeline.js');
    const goblet1Pipeline = read('public/goblet/displayFilterPipeline.js');
    const goblet2Pipeline = read('public/goblet2/displayFilterPipeline.js');

    expect(source).toContain('createFilmGrainPlateModel');
    expect(source).toContain('buildFilmGrainFields');
    expect(source).toContain('rasterizeFilmGrainFields');
    expect(source).toContain('applyFilmGrainOverlay');
    expect(source).not.toContain('getFilmGrainWrappedConnectionSegments');
    expect(source).not.toContain('filmNoiseCombinedField');
    expect(source).not.toContain('filmNoiseImageData');
    expect(goblet1Pipeline).toContain(source);
    expect(goblet2Pipeline).toContain(source);
  });
});

// Pixel-bearing I/O double: only the Canvas primitives used by these 8x8 Grid cases.
class DepthCanvas {
  width = 8;
  height = 8;
  data = new Uint8ClampedArray(0);
  ctx = new DepthContext(this);
  getContext() { return this.ctx; }
  pixels() {
    if (this.data.length !== this.width * this.height * 4) this.data = new Uint8ClampedArray(this.width * this.height * 4);
    return this.data;
  }
  rgba(x: number, y: number) { return [...this.pixels().slice((y * this.width + x) * 4, (y * this.width + x) * 4 + 4)]; }
}
class DepthContext {
  fillStyle: string | DepthCanvas = 'rgba(0,0,0,1)';
  globalCompositeOperation = 'source-over';
  globalAlpha = 1;
  filter = 'none';
  stack: Array<{ style: string | DepthCanvas; op: string; alpha: number }> = [];
  constructor(readonly canvas: DepthCanvas) {}
  setTransform() {}
  translate() {}
  clearRect() { this.canvas.pixels().fill(0); }
  createPattern(c: DepthCanvas) { return c; }
  save() { this.stack.push({ style: this.fillStyle, op: this.globalCompositeOperation, alpha: this.globalAlpha }); }
  restore() {
    const s = this.stack.pop(); if (!s) throw Error('Unbalanced restore');
    this.fillStyle = s.style; this.globalCompositeOperation = s.op; this.globalAlpha = s.alpha;
  }
  paint(x: number, y: number, rgba: number[]) {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const d = this.canvas.pixels(), i = (y * this.canvas.width + x) * 4;
    const sa = rgba[3] / 255 * this.globalAlpha, da = d[i + 3] / 255, a = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      const s = rgba[k] / 255, b = d[i + k] / 255;
      const blend = this.globalCompositeOperation === 'multiply' ? s * b : this.globalCompositeOperation === 'screen' ? s + b - s * b : s;
      d[i + k] = a ? Math.round(((1 - sa) * da * b + (1 - da) * sa * s + sa * da * blend) / a * 255) : 0;
    }
    d[i + 3] = Math.round(a * 255);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const style = this.fillStyle, color = typeof style === 'string' ? style.match(/[\d.]+/g)?.map(Number) : null;
    if (typeof style === 'string' && (!color || color.length < 3)) throw Error('Unsupported boundary color');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const rgba = typeof style === 'string' ? [color![0], color![1], color![2], (color![3] ?? 1) * 255]
        : style.rgba(((xx % style.width) + style.width) % style.width, ((yy % style.height) + style.height) % style.height);
      this.paint(xx, yy, rgba);
    }
  }
  drawImage(c: DepthCanvas, x: number, y: number) {
    for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) this.paint(x + xx, y + yy, c.rgba(xx, yy));
  }
}
type DepthPipeline = { createDisplayFilterPipelineState: () => object; applyDisplayFilterStack: (options: object) => DepthCanvas };
const loadDepthPipeline = (file: string): DepthPipeline => new Function('document',
  `${read(file).replace(/\bexport\s+/g, '')}; return {createDisplayFilterPipelineState, applyDisplayFilterStack};`,
)({ createElement: (tag: string) => { if (tag !== 'canvas') throw Error('Unexpected I/O'); return new DepthCanvas(); } }) as DepthPipeline;

describe.each(['src/lib/displayFilterPipeline.js', 'public/goblet/displayFilterPipeline.js', 'public/goblet2/displayFilterPipeline.js'])('actual CRT Grid output: %s', file => {
  const render = (p: DepthPipeline, state: object, mask: number, depth: number) => {
    const source = new DepthCanvas(); source.pixels().fill(255); const before = source.pixels().slice();
    const result = p.applyDisplayFilterStack({ sourceCanvas: source, filterState: state, visibleRect: { x: 0, y: 0, width: 8, height: 8 }, displayFilters: [
      { id: 'pixelate', enabled: false, settings: { cellSize: 1 } },
      { id: 'crt-grid', enabled: true, settings: { lineOpacity: mask, lineSpacing: 4, phosphorOpacity: 0, scanlineOpacity: depth } },
    ] });
    expect(source.pixels()).toEqual(before); return result;
  };
  it('depth0 removes horizontal rows while preserving the aperture', () => {
    const p = loadDepthPipeline(file), out = render(p, p.createDisplayFilterPipelineState(), 1, 0);
    expect(out.rgba(1, 3)).toEqual([255, 255, 255, 255]);
    expect(out.rgba(3, 1)).toEqual([127, 127, 127, 255]);
  });
  it('depth1 reaches mask strength and mask0 bypasses', () => {
    const p = loadDepthPipeline(file);
    expect(render(p, p.createDisplayFilterPipelineState(), 1, 1).rgba(1, 3)).toEqual([0, 0, 0, 255]);
    expect(render(p, p.createDisplayFilterPipelineState(), 0, 1).pixels()).toEqual(new Uint8ClampedArray(256).fill(255));
  });
  it('depth and strength multiply at the pixel compositing boundary', () => {
    const p = loadDepthPipeline(file);
    expect(render(p, p.createDisplayFilterPipelineState(), .5, 1).rgba(1, 3)).toEqual([127, 127, 127, 255]);
    expect(render(p, p.createDisplayFilterPipelineState(), 1, .5).rgba(1, 3)).toEqual([127, 127, 127, 255]);
  });
  it('same-state depth0→1→0 rebuilds the pattern', () => {
    const p = loadDepthPipeline(file), state = p.createDisplayFilterPipelineState();
    expect(render(p, state, 1, 0).rgba(1, 3)).toEqual([255, 255, 255, 255]);
    expect(render(p, state, 1, 1).rgba(1, 3)).toEqual([0, 0, 0, 255]);
    expect(render(p, state, 1, 0).rgba(1, 3)).toEqual([255, 255, 255, 255]);
  });
});
