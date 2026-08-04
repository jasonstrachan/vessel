import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const countMatches = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].length;
type ApplyGradientSeamProfileToRgba = (
  palette: Uint8Array,
  params: { paletteSize: number; seamProfile?: 'hard' | 'soft'; offset?: number },
) => void;

const loadRuntimeSeamProfileHelper = (runtime: string): ApplyGradientSeamProfileToRgba => {
  const start = runtime.indexOf('const SOFT_SEAM_BLEND_RATIO =');
  const end = runtime.indexOf('\nconst normalizeSlotSpeeds =', start);
  if (start < 0 || end < 0) {
    throw new Error('Unable to locate Goblet 2 gradient seam helper');
  }
  const helperSource = runtime.slice(start, end);
  return new Function(`${helperSource}\nreturn applyGradientSeamProfileToRgba;`)() as ApplyGradientSeamProfileToRgba;
};

describe('Goblet 2 runtime export regression guard', () => {
  it('keeps Goblet 2 WebGL brush playback on the same timebase as the CPU path', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('gl.uniform1f(this.uniforms.u_time, timeSeconds);');
    expect(runtime).not.toContain('CC_TIME_MULTIPLIER');
  });

  it('sizes Goblet 2 WebGL palette tables for high exported slot ids', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('GOBLET_MAX_SLOT_ID,');
    expect(runtime).toContain('const MAX_EXPORTED_SLOT_ID = GOBLET_MAX_SLOT_ID;');
    expect(runtime).toContain('getHighestPaletteSlot(slotGradients) + 1');
    expect(runtime).toContain('gl.uniform1i(this.uniforms.u_slotCount, this.slotCount);');
  });

  it('applies exported gradient seam profiles in WebGL and CPU brush playback', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const inlineRuntime = read('public/goblet2/goblet2-inline.js');
    const applyGradientSeamProfileToRgba = loadRuntimeSeamProfileHelper(runtime);

    const paletteSize = 16;
    const rowLength = paletteSize * 4;
    const palette = new Uint8Array(rowLength * 2);
    palette.fill(17, 0, rowLength);
    for (let index = 0; index < paletteSize; index += 1) {
      const offset = rowLength + index * 4;
      palette[offset] = index * 10;
      palette[offset + 1] = index * 10;
      palette[offset + 2] = index * 10;
      palette[offset + 3] = 255;
    }
    applyGradientSeamProfileToRgba(palette, {
      paletteSize,
      seamProfile: 'soft',
      offset: rowLength,
    });

    expect(Array.from(palette.slice(0, rowLength))).toEqual(new Array(rowLength).fill(17));
    expect(Array.from(palette.slice(rowLength + 13 * 4, rowLength + 13 * 4 + 4))).toEqual([130, 130, 130, 255]);
    expect(Array.from(palette.slice(rowLength + 14 * 4, rowLength + 14 * 4 + 4))).toEqual([70, 70, 70, 255]);
    expect(Array.from(palette.slice(rowLength + 15 * 4, rowLength + 15 * 4 + 4))).toEqual([0, 0, 0, 255]);

    const hardPalette = Uint8Array.from({ length: rowLength }, (_, index) => index);
    const hardBefore = hardPalette.slice();
    applyGradientSeamProfileToRgba(hardPalette, { paletteSize, seamProfile: 'hard' });
    expect(hardPalette).toEqual(hardBefore);

    expect(runtime).toContain('const normalizeSlotSeamProfiles = (slotPalettes) => {');
    expect(runtime).toContain('const normalizeGradientDefPalettes = (gradientDefStore) => {');
    expect(runtime).toContain('const applyGradientSeamProfileToRgba = (palette, {');
    expect(runtime).toContain('this.slotSeamProfiles = normalizeSlotSeamProfiles(colorCycle.slotPalettes);');
    expect(runtime).toContain('slotSeamProfiles?.get(slot),');
    expect(runtime).toContain('writePaletteRow(row, defGradients.get(defId), defSeamProfiles?.get(defId));');
    expect(runtime).toContain('buildDiscretePalette32FromGradient(stops, this._basePaletteSize, seamProfile)');
    expect(countMatches(runtime, /applyGradientSeamProfileToRgba\(/g)).toBe(2);
    expect(inlineRuntime).toContain('seamProfile');
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
    expect(runtime).toContain('getNoiseOnlyDisplayFilter:getNoiseOnlyDisplayFilter');
    expect(runtime).toContain('ensureDisplayNoiseOverlay:ensureDisplayNoiseOverlay');
    expect(runtime).toContain('applyDisplayNoiseOverlay:applyDisplayNoiseOverlay');
    expect(runtime).toContain('applyDisplayFilterStack:applyDisplayFilterStack}=(()=>{');
  });

  it('keeps the shared direct-overlay contract and legacy Noise-only selector', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const inlineRuntime = read('public/goblet2/goblet2-inline.js');
    const gobletPipeline = read('public/goblet2/displayFilterPipeline.js');
    const legacyPipeline = read('public/goblet/displayFilterPipeline.js');

    expect(gobletPipeline).toContain('export const getNoiseOnlyDisplayFilter = (filters) => {');
    expect(gobletPipeline).toContain('export const getDirectOverlayDisplayFilter = (filters) => {');
    expect(gobletPipeline).toContain('export const ensureDisplayNoiseOverlay = ({');
    expect(gobletPipeline).toContain('export const applyDisplayNoiseOverlay = ({');
    expect(legacyPipeline).toBe(gobletPipeline);

    expect(runtime).toContain("hasEnabledDisplayFiltersInList(\n      displayFilters,\n      'direct-overlay-only',");
    expect(runtime).toContain('const shouldUseDisplayFilterPipeline =');
    expect(runtime).toContain('} else if (shouldApplyDirectOverlayFilter) {');
    expect(runtime).toContain('directOverlayTarget: {');
    expect(inlineRuntime).toContain('"direct-overlay-only"');
    expect(inlineRuntime).toContain('directOverlayTarget');
    expect(inlineRuntime).toContain('"noise-only"');
    expect(inlineRuntime).toContain('getNoiseOnlyDisplayFilter:getNoiseOnlyDisplayFilter');
    expect(inlineRuntime).toContain('ensureDisplayNoiseOverlay:ensureDisplayNoiseOverlay');
    expect(inlineRuntime).toContain('applyDisplayNoiseOverlay:applyDisplayNoiseOverlay');
  });

  it('keeps the deterministic four-pass CRT renderer in both Goblet pipelines', () => {
    const sourcePipeline = read('src/lib/displayFilterPipeline.js');
    const gobletPipeline = read('public/goblet2/displayFilterPipeline.js');
    const legacyPipeline = read('public/goblet/displayFilterPipeline.js');
    const inlineRuntime = read('public/goblet2/goblet2-inline.js');

    expect(gobletPipeline).toBe(sourcePipeline);
    expect(legacyPipeline).toBe(sourcePipeline);
    expect(sourcePipeline).toContain('const CRT_ANALOG_FRAGMENT_SHADER =');
    expect(sourcePipeline).toContain('export const applyCrtWebGLFilter = ({');
    expect(sourcePipeline).toContain('const CRT_STATIC_SIGNAL_SEED = 41.73;');
    expect(sourcePipeline).not.toContain('Date.now()');
    expect(sourcePipeline).not.toContain('uniform float u_time');
    expect(inlineRuntime).toContain('CRT analog signal pass');
    expect(inlineRuntime).toContain('41.73');
  });

  it('keeps the separate deterministic five-pass NTSE CRT renderer in both Goblet pipelines', () => {
    const sourcePipeline = read('src/lib/displayFilterPipeline.js');
    const gobletPipeline = read('public/goblet2/displayFilterPipeline.js');
    const legacyPipeline = read('public/goblet/displayFilterPipeline.js');
    const inlineRuntime = read('public/goblet2/goblet2-inline.js');

    expect(gobletPipeline).toBe(sourcePipeline);
    expect(legacyPipeline).toBe(sourcePipeline);
    expect(sourcePipeline).toContain('const NTSE_CRT_ANALOG_FRAGMENT_SHADER =');
    expect(sourcePipeline).toContain('const NTSE_CRT_DOWNSCALE_FRAGMENT_SHADER =');
    expect(sourcePipeline).toContain('export const applyNtseCrtWebGLFilter = ({');
    expect(sourcePipeline).toContain('const NTSE_CRT_STATIC_SIGNAL_SEED = 73.19;');
    expect(sourcePipeline).toContain("getDisplayFilterByIdFromList(displayFilters, 'ntse-crt')");
    expect(sourcePipeline).toContain('float sourceTopY = floor((scanlineIndex + 0.5) * scanlineSize);');
    expect(sourcePipeline).toContain('float sourceBottomY = floor((scanlineIndex + 1.5) * scanlineSize);');
    expect(sourcePipeline).not.toContain('float phase = signalPosition.y - signalPixel.y;');
    expect(inlineRuntime).toContain('NTSE CRT analog signal pass');
    expect(inlineRuntime).toContain('NTSE CRT 320px signal downscale pass');
    expect(inlineRuntime).toContain('73.19');
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

  it('keeps Goblet 2 profiling opt-in and exposes a read-only dump without persistent console output', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("new URLSearchParams(window.location.search).get('gobletProfile') === '1'");
    expect(runtime).toContain("window.localStorage?.getItem('vesselGobletProfile') === 'true'");
    expect(runtime).toContain('window.__VESSEL_DUMP_GOBLET_PROFILE__ = () => (');
    expect(runtime).not.toContain('[goblet][profile]');
  });

  it('routes Goblet 2 slot-speed brush exports through the WebGL speed texture path', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("const speedMode = colorCycle?.speedMode === 'slot' ? 'slot' : colorCycle?.speedMode === 'buffer' ? 'buffer' : null;");
    expect(runtime).toContain("if (speedMode !== 'buffer' && !slotSpeedMap) {");
    expect(runtime).toContain('uniform float u_slotSpeeds[256];');
    expect(runtime).toContain('phase = u_time * u_slotSpeeds[int(min(slot, uint(255)))];');
    expect(runtime).toContain('renderer.setSlotSpeeds(slotSpeedData);');
    expect(runtime).not.toContain('synthesizeSlotSpeedBuffer');
    expect(runtime).not.toContain('if (this.isGoblet2 && this.speedBuffer) {');
  });

  it('validates Goblet 2 brush payloads against the shared required-buffer contract before playback', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const inlineRuntime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain("import {\n  GOBLET_BRUSH_MASK_FIELDS,\n  GOBLET_BRUSH_REQUIRED_BUFFERS,\n  GOBLET_BRUSH_REQUIRED_SCALARS,\n  GOBLET_COLOR_CYCLE_BRUSH_MODE,\n  GOBLET2_FORMAT,\n  GOBLET2_LEGACY_SCHEMA_VERSION,\n  GOBLET2_SCHEMA_VERSION,\n} from './gobletPayloadContract.js';");
    expect(runtime).toContain('for (const bufferContract of GOBLET_BRUSH_REQUIRED_BUFFERS) {');
    expect(runtime).toContain('for (const scalarContract of GOBLET_BRUSH_REQUIRED_SCALARS) {');
    expect(runtime).toContain('for (const maskField of GOBLET_BRUSH_MASK_FIELDS) {');
    expect(runtime).toContain('gobletPayloadLengthMatches');
    expect(runtime).toContain('length-${name}-${resolved.length}-expected-${expectedElements}');
    expect(runtime).toContain('missing-${name}');
    expect(runtime).toContain('length-${maskField}-${resolved.length}-expected-${expectedElements}');
    expect(runtime).toContain('mode-${colorCycle?.mode ?? \'missing\'}-expected-${GOBLET_COLOR_CYCLE_BRUSH_MODE}');
    expect(runtime).toContain('await assertGobletBrushPayloadContract(colorCycle, brushState);');
    expect(runtime).toContain('assertGobletMetadataContract(expanded);');
    expect(runtime).toContain('Goblet2 metadata failed contract validation');
    expect(runtime).toContain('isGobletPayloadContractError(error)');
    expect(runtime).toContain('Goblet2 brush payload failed contract validation');
    expect(inlineRuntime).toContain('Goblet2 metadata failed contract validation');
    expect(inlineRuntime).toContain('Goblet2 brush payload failed contract validation');
  });

  it('keeps schema-2 strict payload validation separate from legacy Goblet2 format tolerance', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('this.isGoblet2 = options?.schemaVersion >= GOBLET2_SCHEMA_VERSION;');
    expect(runtime).not.toContain("options?.schemaVersion >= GOBLET2_SCHEMA_VERSION || options?.format === 'vessel-goblet2'");
  });

  it('uses fractional brush sampling with exported phase and flow buffers', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const fillPixelsFromIndicesWithFractionalSpeedFlowPhase = (');
    expect(runtime).toContain('const fillPixelsFromIndicesWithFractionalSlotSpeeds = (');
    expect(runtime).toContain('const rawFlowBuffer = brushState.flowBuffer');
    expect(runtime).toContain('const rawPhaseBuffer = brushState.phaseBuffer');
    expect(runtime).toContain('this.flowBuffer = normalizeGobletFlowBuffer');
    expect(runtime).toContain('const flowBuffer = normalizeGobletFlowBuffer');
    expect(runtime).toContain('this.phaseBuffer = phaseBuffer');
    expect(runtime).toContain('u_phase: gl.getUniformLocation(program, \'u_phase\')');
    expect(runtime).toContain('u_paletteRow: gl.getUniformLocation(program, \'u_paletteRow\')');
    expect(runtime).toContain('gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, paletteRowBuffer);');
    expect(runtime).toContain('renderer.setBuffers(\n        indexBuffer,\n        gradientIdBuffer ?? new Uint8Array(expectedLength),\n        paletteRowBuffer,\n        speedBuffer ?? new Uint8Array(expectedLength),\n        flowBuffer ?? new Uint8Array(expectedLength).fill(FLOW_MODE_FORWARD),\n        phaseBuffer ?? new Uint8Array(expectedLength)\n      );');
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
    expect(runtime).toContain('await this.applySoftEdgeMask(colorCycle.softEdgeMask, resolvedSoftEdgeMask);');
    expect(runtime).toContain('hasAnyMaskValue(resized)');
    expect(runtime).toContain('Ignoring empty soft-edge mask');
    expect(runtime).toContain('applySoftEdgeMaskToAlphaChannel(this.alpha, resized);');
    expect(runtime).toContain('await this.applyWebGLSoftEdgeMask(colorCycle.softEdgeMask, resolvedSoftEdgeMask);');
    expect(runtime).toContain('Ignoring empty WebGL soft-edge mask');
    expect(runtime).toContain('alpha *= texture(u_softMask, sampleUV).r;');
    expect(runtime).toContain('renderer.setSoftMaskTexture(null);');
  });

  it('preserves zero alpha in CPU brush fill paths', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const legacyRuntime = read('public/goblet/goblet.js');
    const playbackMath = read('src/lib/colorCycle/gobletPlaybackMath.js');

    expect(runtime).not.toContain('alpha[aIdx] ||');
    expect(runtime).toContain("} from './gobletPlaybackMath.js';");
    expect(runtime).toContain('resolveGobletIndexedAlphaByte(alpha, aIdx, effective)');
    expect(runtime).toContain('resolveGobletAlphaByte(alpha, aIdx, 255)');
    expect(legacyRuntime).not.toContain('alpha[aIdx] ||');
    expect(legacyRuntime).toContain("} from './gobletPlaybackMath.js';");
    expect(legacyRuntime).toContain('resolveGobletIndexedAlphaByte(alpha, aIdx, effective)');
    expect(legacyRuntime).toContain('resolveGobletAlphaByte(alpha, aIdx, 255)');
    expect(playbackMath).toContain('alpha?.[alphaIndex] ?? fallbackAlpha');
    expect(playbackMath).toContain('effectiveIndex !== 0 ? 255 : 0');
  });

  it('uses the shared generated playback math for speed-byte decode', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const legacyRuntime = read('public/goblet/goblet.js');
    const playbackMath = read('src/lib/colorCycle/gobletPlaybackMath.js');
    const generatedPlaybackMath = read('public/goblet2/gobletPlaybackMath.js');
    const legacyGeneratedPlaybackMath = read('public/goblet/gobletPlaybackMath.js');

    expect(runtime).toContain('decodeColorCycleSpeedByte,');
    expect(runtime).toContain(
      'decodeColorCycleSpeedByte(speedByte, speedMin, speedMax, DEFAULT_SPEED_MIN, DEFAULT_SPEED_MAX)'
    );
    expect(runtime).not.toContain('const decodeColorCycleSpeedByte = (byte, minSpeed, maxSpeed)');

    expect(legacyRuntime).toContain('decodeColorCycleSpeedByte,');
    expect(legacyRuntime).toContain(
      'decodeColorCycleSpeedByte(sb, this.speedMin, this.speedMax, DEFAULT_SPEED_MIN, DEFAULT_SPEED_MAX)'
    );
    expect(legacyRuntime).not.toContain('const decodeColorCycleSpeedByte = (byte, minSpeed, maxSpeed)');

    expect(playbackMath).toContain('export const GOBLET_SPEED_BYTE_RANGE = 254;');
    expect(playbackMath).toContain('export const decodeColorCycleSpeedByte = (');
    expect(generatedPlaybackMath).toBe(
      `// Auto-generated by scripts/build-goblet-runtime.mjs. Do not edit directly.\n${playbackMath}`
    );
    expect(legacyGeneratedPlaybackMath).toBe(generatedPlaybackMath);
  });

  it('uses the shared generated playback math for flow-mode semantics', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const legacyRuntime = read('public/goblet/goblet.js');
    const playbackMath = read('src/lib/colorCycle/gobletPlaybackMath.js');

    expect(runtime).toContain('resolveGobletFlowMode,');
    expect(runtime).toContain('normalizeGobletFlowBuffer,');
    expect(runtime).toContain('hasGobletNonForwardFlow,');
    expect(runtime).toContain('getGobletFlowModeIndex,');
    expect(runtime).not.toContain('const resolveFlowMode = (flowBits)');
    expect(runtime).not.toContain('const normalizeFlowBuffer = (flowBuffer');
    expect(runtime).not.toContain('const hasNonForwardFlow = (flowBuffer)');

    expect(legacyRuntime).toContain('resolveGobletFlowMode,');
    expect(legacyRuntime).toContain('getGobletFlowModeIndex,');
    expect(legacyRuntime).not.toContain('const resolveFlowMode = (flowBits)');

    expect(playbackMath).toContain('export const GOBLET_FLOW_MODE_FORWARD = 1;');
    expect(playbackMath).toContain('export const GOBLET_FLOW_MODE_REVERSE = 2;');
    expect(playbackMath).toContain('export const GOBLET_FLOW_MODE_PINGPONG = 3;');
    expect(playbackMath).toContain('export const resolveGobletFlowMode = (flowMode) => {');
    expect(playbackMath).toContain('export const normalizeGobletFlowBuffer = (');
  });

  it('uses the shared generated playback math for phase and palette-position semantics', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const legacyRuntime = read('public/goblet/goblet.js');
    const playbackMath = read('src/lib/colorCycle/gobletPlaybackMath.js');

    expect(runtime).toContain('resolveGobletPhase01,');
    expect(runtime).toContain('resolveGobletPalettePosition,');
    expect(runtime).toContain('wrapGobletPhase01,');
    expect(runtime).toContain('const phase = resolveGobletPhase01(basePhase, phaseByte);');
    expect(runtime).toContain('const position = resolveGobletPalettePosition(baseIndex, phase, flowMode, n);');
    expect(runtime).not.toContain('const foldPingpongPhase = (phase)');
    expect(runtime).not.toContain('const resolvePalettePosition = (baseIndex, phase, flowMode, paletteSize)');
    expect(runtime).not.toContain('phase %= 1;');

    expect(legacyRuntime).toContain('wrapGobletPhase01,');
    expect(legacyRuntime).toContain('const off = wrapGobletPhase01(offset01);');
    expect(legacyRuntime).not.toContain('let off = offset01 % 1;');

    expect(playbackMath).toContain('export const wrapGobletPhase01 = (phase) => {');
    expect(playbackMath).toContain('export const resolveGobletPhase01 = (basePhase, phaseByte = 0) => (');
    expect(playbackMath).toContain('export const foldGobletPingpongPhase = (phase) => {');
    expect(playbackMath).toContain('export const resolveGobletPalettePosition = (');
  });

  it('uses the shared generated playback math for slot and palette-index clamping', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const legacyRuntime = read('public/goblet/goblet.js');
    const playbackMath = read('src/lib/colorCycle/gobletPlaybackMath.js');

    expect(runtime).toContain('GOBLET_MAX_SLOT_ID,');
    expect(runtime).toContain('clampGobletSlotId,');
    expect(runtime).toContain('resolveGobletGradientSlot,');
    expect(runtime).toContain('resolveGobletPaletteIndex,');
    expect(runtime).toContain('const MAX_EXPORTED_SLOT_ID = GOBLET_MAX_SLOT_ID;');
    expect(runtime).toContain('map.set(clampGobletSlotId(slot), speed);');
    expect(runtime).toContain('const effective = resolveGobletPaletteIndex(rawIndex, paletteSize, subtractOne);');
    expect(runtime).toContain('const slot = resolveGobletGradientSlot(gid, FLOW_SLOT_MASK);');
    expect(runtime).not.toContain('Math.max(0, Math.min(MAX_EXPORTED_SLOT_ID');

    expect(legacyRuntime).toContain('clampGobletSlotId,');
    expect(legacyRuntime).toContain('map.set(clampGobletSlotId(slot), speed);');
    expect(legacyRuntime).not.toContain('Math.max(0, Math.min(255, Math.round(slot)))');

    expect(playbackMath).toContain('export const GOBLET_MAX_SLOT_ID = 255;');
    expect(playbackMath).toContain('export const clampGobletSlotId = (slot, maxSlotId = GOBLET_MAX_SLOT_ID) => {');
    expect(playbackMath).toContain('export const resolveGobletGradientSlot = (gradientId, flowSlotMask = GOBLET_MAX_SLOT_ID) => (');
    expect(playbackMath).toContain('export const resolveGobletPaletteRow = (');
    expect(playbackMath).toContain('export const resolveGobletPaletteIndex = (');
  });

  it('uses the shared generated playback math for palette fallback and gradient sampling', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const legacyRuntime = read('public/goblet/goblet.js');
    const playbackMath = read('src/lib/colorCycle/gobletPlaybackMath.js');

    expect(runtime).toContain('normalizeGobletGradientStops,');
    expect(runtime).toContain('normalizeGobletSlotPalettes,');
    expect(runtime).toContain('sampleGobletGradient,');
    expect(runtime).toContain('parseGobletColor,');
    expect(runtime).toContain('const normalizeGradientStops = normalizeGobletGradientStops;');
    expect(runtime).toContain('const normalizeSlotPalettes = normalizeGobletSlotPalettes;');
    expect(runtime).toContain('const sampleGradient = sampleGobletGradient;');
    expect(runtime).not.toContain('const normalizeGradientStops = (stops)');
    expect(runtime).not.toContain('const normalizeSlotPalettes = (slotPalettes, fallbackGradient)');
    expect(runtime).not.toContain('const sampleGradient = (gradient, position)');
    expect(runtime).not.toContain('DEFAULT_GRADIENT');

    expect(legacyRuntime).toContain('normalizeGobletGradientStops,');
    expect(legacyRuntime).toContain('normalizeGobletSlotPalettes,');
    expect(legacyRuntime).toContain('sampleGobletGradient,');
    expect(legacyRuntime).toContain('parseGobletColor,');
    expect(legacyRuntime).not.toContain('const normalizeGradientStops = (stops)');
    expect(legacyRuntime).not.toContain('DEFAULT_GRADIENT');

    expect(playbackMath).toContain('export const normalizeGobletGradientStops = (stops) => {');
    expect(playbackMath).toContain('const DEFAULT_GOBLET_GRADIENT = [');
    expect(playbackMath).toContain("{ position: 0, rgba: parseGobletColor('#000000') }");
    expect(playbackMath).toContain("{ position: 1, rgba: parseGobletColor('#ffffff') }");
    expect(playbackMath).toContain('return cloneGobletGradient(DEFAULT_GOBLET_GRADIENT);');
    expect(playbackMath).toContain('stop?.rgba && typeof stop.rgba === \'object\'');
    expect(playbackMath).toContain('export const normalizeGobletSlotPalettes = (slotPalettes, fallbackGradient) => {');
    expect(playbackMath).toContain('export const sampleGobletGradient = (gradient, position) => {');
    expect(runtime).toContain('const DEFAULT_PALETTE_SIZE = 256;');
    expect(runtime).toContain('this.cycleColors = DEFAULT_PALETTE_SIZE;');
    expect(runtime).toContain('paletteSize: DEFAULT_PALETTE_SIZE');
  });

  it('keeps the empty soft-edge mask guard on soft-edge paths only', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const alphaMaskSection = runtime.slice(
      runtime.indexOf('async applyAlphaMask(maskConfig'),
      runtime.indexOf('async applySoftEdgeMask(maskConfig')
    );
    const softEdgeSection = runtime.slice(
      runtime.indexOf('async applySoftEdgeMask(maskConfig'),
      runtime.indexOf('async applyWebGLAlphaMask(maskConfig')
    );

    expect(alphaMaskSection).not.toContain('Ignoring empty soft-edge mask');
    expect(alphaMaskSection).not.toContain('hasAnyMaskValue(resized)');
    expect(softEdgeSection).toContain('hasAnyMaskValue(resized)');
    expect(softEdgeSection).toContain('Ignoring empty soft-edge mask');
  });

  it('includes soft-edge mask playback support in the inline Goblet 2 runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('sem:"softEdgeMask"');
    expect(runtime).toContain('softEdgeMask');
    expect(runtime).toContain('hasAnyMaskValue');
    expect(runtime).toContain('applySoftEdgeMaskToAlphaChannel');
    expect(runtime).toContain('setSoftMaskTexture');
    expect(runtime).toContain('u_softMask');
  });

  it('does not gate slot-speed brush playback on integer palette shifts', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('fillPixelsFromIndicesWithFractionalSlotSpeeds(');
    expect(runtime).toContain('buildPaletteFractionalShiftLUT256({');
    expect(runtime).toContain('fillPixelsFromIndicesWithGradientIds(');
    expect(runtime).not.toContain('if (!this.maybeAdvanceShiftKeysSlotMode(shiftKey, slotSpeedMap, n, canUseSlots))');
  });

  it('gates adaptive CPU scaling behind confirmed coarse-pointer WebGL fallback and hysteresis', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain("this.renderScale = this._halfResPreference === 'true' ? 0.5 : 1;");
    expect(runtime).toContain('this._webglInitAttempted = true;');
    expect(runtime).toContain('this._webglInitFailed = true;');
    expect(runtime).toContain('this._adaptiveScaleEnabled = this._halfResPreference === null && matchesCoarsePointer();');
    expect(runtime).toContain('const slowWindow = averageFillMs > 20 || observedFps < 45;');
    expect(runtime).toContain('const fastWindow = averageFillMs < 12 && observedFps > 55;');
    expect(runtime).toContain('this._slowWindowCount >= 3');
    expect(runtime).toContain('this._fastWindowCount >= 5');
    expect(runtime).toContain('nowMs - this._lastScaleTransitionMs >= 30_000');
    expect(runtime).toContain('await this.initialize({ allowWebGL: false });');
  });

  it('freezes only color-cycle playback while adaptive scaling reinitializes', () => {
    const runtime = read('public/goblet2/goblet2.js');
    const sequentialStart = runtime.indexOf('class SequentialLayerPlayer');
    const colorCycleStart = runtime.indexOf('class ColorCycleLayerPlayer');
    const colorCycleEnd = runtime.indexOf('// Vessel viewer core', colorCycleStart);
    const sequentialPlayer = runtime.slice(sequentialStart, colorCycleStart);
    const colorCyclePlayer = runtime.slice(colorCycleStart, colorCycleEnd);

    expect(sequentialPlayer).toContain('if (!this.hasAnimation()) {');
    expect(sequentialPlayer).not.toContain('this._isReinitializing');
    expect(colorCyclePlayer).toContain(
      'if (this._destroyed || this._isReinitializing || !this.hasAnimation()) {',
    );
  });

  it('centralizes animation eligibility and caps coarse-pointer fixed backing stores', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('canRunAnimation() {');
    expect(runtime).toContain('reconcileAnimationLoop() {');
    expect(runtime).toContain("document.addEventListener('visibilitychange', this.handleVisibilityChange)");
    expect(runtime).toContain('new IntersectionObserver(this.handleIntersectionChange, { threshold: 0 })');
    expect(runtime).toContain('const MAX_MOBILE_FIXED_DPR = 2;');
    expect(runtime).toContain('const MAX_MOBILE_FIXED_BACKING_PIXELS = 4_194_304;');
    expect(runtime).toContain('const lutsBySlot = this._fractionalLutsBySlot;');
    expect(runtime).not.toContain('const lutsBySlot = new Map();');
  });
});
