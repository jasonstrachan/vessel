import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const countMatches = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].length;

describe('Goblet 2 runtime export regression guard', () => {
  it('keeps the viewer-only CC time multiplier in the module runtime', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const CC_TIME_MULTIPLIER = 3.0;');
    expect(runtime).toContain('gl.uniform1f(this.uniforms.u_time, timeSeconds * CC_TIME_MULTIPLIER);');
  });

  it('keeps the viewer-only CC time multiplier in the inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('uniform1f(this.uniforms.u_time,3*e)');
  });

  it('scopes the inlined display filter pipeline to avoid helper name collisions', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain(
      '{getSeamlessNoisePatternSize:getSeamlessNoisePatternSize,createTileableNoiseGrid:createTileableNoiseGrid,createDisplayFilterPipelineState:createDisplayFilterPipelineState'
    );
    expect(runtime).toContain('applyDisplayFilterStack:applyDisplayFilterStack}=(()=>{');
  });

  it('does not duplicate the colliding clamp01 helper at top level in the inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(countMatches(runtime, /\bfunction clamp01\b/g)).toBe(1);
    expect(countMatches(runtime, /\bconst clamp01\b/g)).toBe(0);
  });

  it('advances brush color-cycle playback directly by deltaSeconds in the module runtime', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('this.baseTimeSeconds += deltaSeconds;');
    expect(runtime).toContain('this.legacyOffset01 = wrap01(this.legacyOffset01 + deltaSeconds * (this.legacySpeedCps || 0));');
    expect(runtime).not.toContain('this.frameAccumulator += deltaSeconds;');
  });

  it('advances brush color-cycle playback directly by deltaSeconds in the inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('this.baseTimeSeconds+=e');
    expect(runtime).toContain('this.legacyOffset01=wrap01(this.legacyOffset01+e*(this.legacySpeedCps||0))');
    expect(runtime).not.toContain('this.frameAccumulator+=e');
  });

  it('sizes recolor playback from exported recolor dimensions in the module runtime', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('Number.isFinite(recolorSettings?.width) ? recolorSettings.width : this.canvas.width');
    expect(runtime).toContain('Number.isFinite(recolorSettings?.height) ? recolorSettings.height : this.canvas.height');
    expect(runtime).toContain('this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight');
  });

  it('keeps hidden animated layers out of the Goblet 2 animation loop', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('this.dynamicPlayers = entries\n      .filter((entry) => entry.layer.visible !== false)');
    expect(runtime).toContain('this.dynamicPlayerSet = new Set(this.dynamicPlayers);');
  });

  it('does not sample cropped fixed-mode sources through document bounds', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const sourceMatchesDocument = Math.abs(sourceWidth - documentSize.width) <= 0.5');
    expect(runtime).toContain('(isFixed && sourceMatchesDocument)');
    expect(runtime).toContain('isColorCycleLayer && sourceMatchesDocument');
    expect(runtime).not.toContain('(\n        isFixed\n        || (isColorCycleLayer');
  });

  it('caches static Goblet 2 layers before painting dynamic layers', () => {
    const runtime = read('public/goblet2/goblet2.js');

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

  it('profiles Goblet 2 render phases without requiring diagnostics logging', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("window.localStorage.getItem('vesselGobletProfile') === 'true';");
    expect(runtime).toContain('`static=${(renderProfile.staticMs ?? 0).toFixed(2)}ms`');
    expect(runtime).toContain('`dynamic=${(renderProfile.dynamicMs ?? 0).toFixed(2)}ms`');
    expect(runtime).toContain('`filter=${(renderProfile.filterMs ?? 0).toFixed(2)}ms`');
    expect(runtime).toContain('`blit=${(renderProfile.blitMs ?? 0).toFixed(2)}ms`');
  });

  it('keeps Goblet 2 slot-speed brush exports out of the per-pixel speed path', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("if (colorCycle?.speedMode !== 'buffer') {\n      return false;\n    }");
    expect(runtime).toContain('if (!hasNumericPayload(brushState.speedBuffer)) {\n      return false;\n    }');
    expect(runtime).not.toContain('if (this.isGoblet2 && this.speedBuffer) {');
  });
});
