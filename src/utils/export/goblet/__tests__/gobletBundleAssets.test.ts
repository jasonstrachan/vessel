import JSZip from 'jszip';

import { createSingleFileGobletHtml } from '@/utils/export/goblet/gobletHtmlBuilder';
import { createGobletZipBlob } from '@/utils/export/goblet/gobletZipBuilder';

const templateHtml = [
  '<!DOCTYPE html>',
  '<html>',
  '<body>',
  '<canvas id="app"></canvas>',
  '<script type="module">',
  "import { renderVesselWebGL } from './goblet2.js';",
  '</script>',
  '</body>',
  '</html>',
].join('\n');

const alignRuntime = [
  'export const normalizeAlignment = () => ({});',
  'export const computeLayerTransform = () => ({});',
  'export const computeLayerDestination = () => ({});',
].join('\n');

const displayFilterRuntime = [
  'export const getSeamlessNoisePatternSize = () => 1;',
  'export const createTileableNoiseGrid = () => [];',
  'export const createDisplayFilterPipelineState = () => ({});',
  'export const getNextFilterWorkCanvas = (currentCanvas) => currentCanvas;',
  'export const ensureDisplayFilterCanvas = () => null;',
  'export const clearDisplayFilterCanvas = () => null;',
  'export const getDisplayFilterByIdFromList = () => undefined;',
  'export const hasEnabledDisplayFiltersInList = () => false;',
  'export const applyDisplayFilterStack = ({ sourceCanvas }) => sourceCanvas;',
].join('\n');

const payloadContractRuntime = [
  "export const GOBLET2_FORMAT = 'vessel-goblet2';",
  'export const GOBLET2_SCHEMA_VERSION = 2;',
  'export const GOBLET2_LEGACY_SCHEMA_VERSION = 1;',
  'export const GOBLET_BRUSH_REQUIRED_BUFFERS = [];',
  'export const GOBLET_BRUSH_REQUIRED_SCALARS = [];',
  'export const GOBLET_BRUSH_MASK_FIELDS = [];',
  "export const GOBLET_COLOR_CYCLE_BRUSH_MODE = 'brush';",
  "export const GOBLET_COLOR_CYCLE_RECOLOR_MODE = 'recolor';",
].join('\n');

const playbackMathRuntime = [
  'export const GOBLET_SPEED_BYTE_RANGE = 255;',
  'export const GOBLET_FLOW_MODE_LEGACY = 0;',
  'export const GOBLET_FLOW_MODE_FORWARD = 1;',
  'export const GOBLET_FLOW_MODE_REVERSE = 2;',
  'export const GOBLET_FLOW_MODE_PINGPONG = 3;',
  'export const GOBLET_MAX_SLOT_ID = 255;',
  'export const decodeColorCycleSpeedByte = () => 1;',
  'export const resolveGobletFlowMode = () => 1;',
  'export const getGobletFlowModeIndex = () => 0;',
  'export const hasGobletNonForwardFlow = () => false;',
  'export const normalizeGobletFlowBuffer = () => new Uint8Array();',
  'export const wrapGobletPhase01 = () => 0;',
  'export const resolveGobletPhase01 = () => 0;',
  'export const foldGobletPingpongPhase = () => 0;',
  'export const resolveGobletPalettePosition = () => 0;',
  'export const clampGobletSlotId = () => 0;',
  'export const resolveGobletGradientSlot = () => 0;',
  'export const resolveGobletPaletteRow = () => 0;',
  'export const resolveGobletPaletteIndex = () => 0;',
  'export const clampGobletByte = () => 0;',
  'export const parseGobletColor = () => [0, 0, 0, 255];',
  'export const normalizeGobletGradientStops = () => [];',
  'export const normalizeGobletSlotPalettes = () => [];',
  'export const sampleGobletGradient = () => [0, 0, 0, 255];',
  'export const resolveGobletAlphaByte = () => 255;',
  'export const resolveGobletIndexedAlphaByte = () => 255;',
  'export const resizeGobletAlphaMaskBuffer = () => null;',
  'export const applyGobletEraseMaskToAlphaChannel = () => {};',
  'export const applyGobletSoftEdgeMaskToAlphaChannel = () => {};',
  'export const hasAnyGobletMaskValue = () => false;',
  'export const hasVisibleGobletAlpha = () => true;',
].join('\n');

describe('Goblet bundle runtime assets', () => {
  it('packages the Goblet2 payload contract module in ZIP bundles', async () => {
    const zipBlob = await createGobletZipBlob({
      indexHtml: templateHtml,
      metadataFilename: 'payload.json',
      metadataJson: '{"format":"vessel-goblet2"}',
      diagnosticsEnabled: false,
      runtimeAsset: 'goblet2.js',
      runtimeJs: "import { GOBLET2_FORMAT } from './gobletPayloadContract.js';",
      alignJs: alignRuntime,
      displayFilterJs: displayFilterRuntime,
      payloadContractJs: payloadContractRuntime,
      playbackMathJs: playbackMathRuntime,
      numJs: 'export const toNum = () => 0;',
      inflateJs: 'export const inflateRaw = () => new Uint8Array();',
      minify: false,
    });

    const zip = await JSZip.loadAsync(zipBlob);
    await expect(zip.file('gobletPayloadContract.js')?.async('string')).resolves.toContain('GOBLET2_FORMAT');
    expect(zip.file('goblet2.js')).not.toBeNull();
  });

  it('inlines the Goblet2 payload contract in fallback single-file HTML', () => {
    const runtime = [
      "import { GOBLET2_FORMAT } from './gobletPayloadContract.js';",
      "import { decodeColorCycleSpeedByte } from './gobletPlaybackMath.js';",
      'export async function renderVesselWebGL() {',
      '  return { format: GOBLET2_FORMAT, speed: decodeColorCycleSpeedByte(255) };',
      '}',
      'export const expandVesselMetadata = (metadata) => metadata;',
    ].join('\n');

    const html = createSingleFileGobletHtml(
      templateHtml,
      runtime,
      './goblet2.js',
      alignRuntime,
      displayFilterRuntime,
      payloadContractRuntime,
      playbackMathRuntime,
      'export const toNum = () => 0;',
      'export const inflateRaw = () => new Uint8Array();',
      '{"format":"vessel-goblet2"}',
      false,
      {
        log: jest.fn(),
        warn: jest.fn(),
      }
    );

    expect(html).toContain("GOBLET2_FORMAT = 'vessel-goblet2'");
    expect(html).not.toContain('./gobletPayloadContract.js');
    expect(html).not.toContain('./gobletPlaybackMath.js');
  });
});
