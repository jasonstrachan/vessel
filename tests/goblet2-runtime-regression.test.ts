import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const countMatches = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].length;

describe('Goblet 2 runtime export regression guard', () => {
  it('keeps Goblet 2 WebGL brush playback on the same timebase as the CPU path', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('gl.uniform1f(this.uniforms.u_time, timeSeconds);');
    expect(runtime).not.toContain('CC_TIME_MULTIPLIER');
  });

  it('keeps Goblet 2 inline WebGL brush playback on the same timebase as the CPU path', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('uniform1f(this.uniforms.u_time,e)');
    expect(runtime).not.toContain('CC_TIME_MULTIPLIER');
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

  it('keeps Goblet 2 slot-speed brush exports out of the per-pixel speed export path', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("if (colorCycle?.speedMode !== 'buffer') {\n      return false;\n    }");
    expect(runtime).toContain('if (!hasNumericPayload(brushState.speedBuffer)) {\n      return false;\n    }');
    expect(runtime).not.toContain('if (this.isGoblet2 && this.speedBuffer) {');
  });

  it('uses fractional brush sampling with exported phase and flow buffers', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const fillPixelsFromIndicesWithFractionalSpeedFlowPhase = (');
    expect(runtime).toContain('const fillPixelsFromIndicesWithFractionalSlotSpeeds = (');
    expect(runtime).toContain('const rawFlowBuffer = brushState.flowBuffer');
    expect(runtime).toContain('const rawPhaseBuffer = brushState.phaseBuffer');
    expect(runtime).toContain('this.flowBuffer = normalizeFlowBuffer');
    expect(runtime).toContain('this.phaseBuffer = phaseBuffer');
    expect(runtime).toContain('u_phase: gl.getUniformLocation(program, \'u_phase\')');
    expect(runtime).toContain('renderer.setBuffers(\n        indexBuffer,\n        gradientIdBuffer ?? new Uint8Array(expectedLength),\n        speedBuffer ?? new Uint8Array(expectedLength),\n        flowBuffer ?? new Uint8Array(expectedLength).fill(FLOW_MODE_FORWARD),\n        phaseBuffer ?? new Uint8Array(expectedLength)\n      );');
    expect(runtime).not.toContain('if (!this.maybeAdvanceShiftKeysPerPixel(distinct, n))');
  });

  it('loads ZIP binary sidecar payload refs through the numeric buffer resolver', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const inlineRuntime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain("typeof value === 'object' && typeof value.ref === 'string'");
    expect(runtime).toContain("fetch(value.ref, { cache: 'no-store' })");
    expect(runtime).toContain('Failed to load Goblet binary payload');
    expect(runtime).toContain('Goblet binary payload length mismatch');
    expect(inlineRuntime).toContain('Failed to load Goblet binary payload');
    expect(inlineRuntime).toContain('Goblet binary payload length mismatch');
  });

  it('applies exported soft-edge masks as keep-alpha masks in CPU and WebGL playback', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("sem: 'softEdgeMask'");
    expect(runtime).toContain('if (colorCycle.softEdgeMask) {');
    expect(runtime).toContain('await this.applySoftEdgeMask(colorCycle.softEdgeMask);');
    expect(runtime).toContain('applySoftEdgeMaskToAlphaChannel(this.alpha, resized);');
    expect(runtime).toContain('await this.applyWebGLSoftEdgeMask(colorCycle.softEdgeMask);');
    expect(runtime).toContain('alpha *= texture(u_softMask, sampleUV).r;');
    expect(runtime).toContain('renderer.setSoftMaskTexture(null);');
  });

  it('includes soft-edge mask playback support in the inline Goblet 2 runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('sem:"softEdgeMask"');
    expect(runtime).toContain('softEdgeMask');
    expect(runtime).toContain('applySoftEdgeMaskToAlphaChannel');
    expect(runtime).toContain('setSoftMaskTexture');
    expect(runtime).toContain('u_softMask');
  });

  it('does not gate slot-speed brush playback on integer palette shifts', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('fillPixelsFromIndicesWithFractionalSlotSpeeds(');
    expect(runtime).toContain('buildPaletteFractionalShiftLUT256({');
    expect(runtime).toContain("canUseSlots ? '[goblet][profile] renderFrame(slots/fractional-lut)'");
    expect(runtime).not.toContain('if (!this.maybeAdvanceShiftKeysSlotMode(shiftKey, slotSpeedMap, n, canUseSlots))');
  });
});
