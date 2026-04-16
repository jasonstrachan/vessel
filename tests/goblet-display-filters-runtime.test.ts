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
    expect(runtime).toContain('applyDisplayFilterStack:applyDisplayFilterStack}=(()=>{');
  });

  it('includes display filter handling in Goblet 1', () => {
    const runtime = read('public/goblet/goblet.js');

    expect(runtime).toContain('const getGobletDisplayFilters = (metadata) => (');
    expect(runtime).toContain("} from './displayFilterPipeline.js';");
    expect(runtime).toContain('this.displayFilterState = createDisplayFilterPipelineState();');
    expect(runtime).toContain('const computeDocumentViewportMapping = (metadata, canvasWidth, canvasHeight) => {');
    expect(runtime).toContain('documentSize.width * documentViewportMapping.scaleX');
    expect(runtime).toContain('const filterLengthScale = Math.max(');
    expect(runtime).toContain("const transparencyMode = metadata?.settings?.transparencyBackgroundMode === 'gray' ? 'gray' : 'checker';");
    expect(runtime).toContain('paintGobletBackground(ctx, clearWidth, clearHeight, this.metadata);');
    expect(runtime).toContain('paintGobletBackground(filterCtx, documentSize.width, documentSize.height, this.metadata);');
    expect(runtime).toContain('visibleRect: {');
    expect(runtime).toContain('lengthScale: filterLengthScale');
    expect(runtime).toContain('const finalFilteredCanvas = applyDisplayFilterStack({');
  });

  it('includes display filter handling in Goblet 2', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const getGobletDisplayFilters = (metadata) => (');
    expect(runtime).toContain("} from './displayFilterPipeline.js';");
    expect(runtime).toContain('this.displayFilterState = createDisplayFilterPipelineState();');
    expect(runtime).toContain('const computeDocumentViewportMapping = (metadata, canvasWidth, canvasHeight) => {');
    expect(runtime).toContain('documentSize.width * documentViewportMapping.scaleX');
    expect(runtime).toContain('const filterLengthScale = Math.max(');
    expect(runtime).toContain("const transparencyMode = metadata?.settings?.transparencyBackgroundMode === 'gray' ? 'gray' : 'checker';");
    expect(runtime).toContain('paintGobletBackground(ctx, clearWidth, clearHeight, this.metadata);');
    expect(runtime).toContain('paintGobletBackground(filterCtx, documentSize.width, documentSize.height, this.metadata);');
    expect(runtime).toContain('visibleRect: {');
    expect(runtime).toContain('lengthScale: filterLengthScale');
    expect(runtime).toContain('const finalFilteredCanvas = applyDisplayFilterStack({');
  });

  it('scopes the display filter pipeline inside the Goblet 2 inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain(
      '{getSeamlessNoisePatternSize:getSeamlessNoisePatternSize,createTileableNoiseGrid:createTileableNoiseGrid,createDisplayFilterPipelineState:createDisplayFilterPipelineState'
    );
    expect(runtime).toContain('applyDisplayFilterStack:applyDisplayFilterStack}=(()=>{');
  });
});
