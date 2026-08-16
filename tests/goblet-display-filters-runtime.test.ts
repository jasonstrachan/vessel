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
