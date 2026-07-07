import fs from 'node:fs';
import path from 'node:path';

import { bakePaletteTable, renderBrushFrame, type Goblet2GradientStop } from '@/lib/colorCycle/goblet2Cpu';
import { applyGradientSeamProfile, type GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

type FixtureThresholds = {
  maxChannelDelta: number;
  maxAlphaDelta: number;
  maxMismatchedPixels: number;
};

type CCFixture = {
  id: string;
  description?: string;
  coverage?: string[];
  width: number;
  height: number;
  timeSeconds: number;
  legacyOffset01?: number;
  speedMin: number;
  speedMax: number;
  paletteSize?: number;
  thresholds: FixtureThresholds;
  brushState: {
    indexBuffer: number[];
    gradientIdBuffer: number[];
    speedBuffer: number[];
    gradientStops: Goblet2GradientStop[];
  };
  slotPalettes?: Array<{ slot: number; stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }>;
};

type CCParityMatrixManifest = {
  version: number;
  semantics: Array<{
    id: string;
    label: string;
    status: 'covered' | 'todo';
    coverage: 'rendered-parity' | 'runtime-regression' | 'source-freshness' | 'export-contract' | 'todo';
    runtimeTargets: Array<'cpu-rendered' | 'gpu-rendered' | 'gpu-regression' | 'viewer-regression' | 'shared-source' | 'export-contract'>;
    witnesses: string[];
    note?: string;
  }>;
};

type CCCrossProductAxes = {
  pixelMode: Array<'static' | 'animated' | 'mixed'>;
  mask: Array<'none' | 'erase' | 'soft-edge'>;
  hiddenLayers: Array<'off' | 'on'>;
  displayFilters: Array<'off' | 'on'>;
  fitMode: Array<'none' | 'contain' | 'cover' | 'fill' | 'tile'>;
  slotCase: Array<'slot-clamp' | 'palette-fallback'>;
};

type CCCrossProductAxisKey = keyof CCCrossProductAxes;

type CCCrossProductCellAxes = {
  [K in CCCrossProductAxisKey]: CCCrossProductAxes[K][number];
};

type CCCrossProductManifest = {
  version: number;
  axes: CCCrossProductAxes;
  coveredCells: Array<{
    id: string;
    axes: CCCrossProductCellAxes;
    witnesses: string[];
    note: string;
  }>;
  todoGroups: Array<{
    id: string;
    axes: { [K in CCCrossProductAxisKey]: CCCrossProductAxes[K] };
    exceptCoveredCells?: boolean;
    reason: string;
  }>;
};

type CCLegacyCorpusManifest = {
  version: number;
  requiredArchives: Array<{
    id: string;
    status: 'covered' | 'todo';
    archivePath?: string;
    expectedOutcome: 'exports-animated' | 'exports-static-with-warning' | 'fails-visibly' | 'todo';
    reason?: string;
  }>;
};

type CCCompatibilityContractManifest = {
  version: number;
  clauses: Array<{
    id: string;
    docSection: string;
    status: 'covered' | 'todo';
    witnesses: string[];
    note?: string;
    reason?: string;
  }>;
};

const REQUIRED_PLAYBACK_SEMANTICS = [
  'speed-decode',
  'frame-phase-shift',
  'slot-clamp',
  'palette-fallback',
  'palette-row-sampling',
  'flow-modes',
  'mask-alpha',
  'fit-modes',
  'hidden-layer-inclusion',
  'display-filters',
] as const;

const COVERED_ENTRY_KNOWN_GAP_PATTERN = /\b(still needs|would still|todo|uncovered|known gap)\b/i;

const EXPECTED_CROSS_PRODUCT_AXES: CCCrossProductAxes = {
  pixelMode: ['static', 'animated', 'mixed'],
  mask: ['none', 'erase', 'soft-edge'],
  hiddenLayers: ['off', 'on'],
  displayFilters: ['off', 'on'],
  fitMode: ['none', 'contain', 'cover', 'fill', 'tile'],
  slotCase: ['slot-clamp', 'palette-fallback'],
};

const CROSS_PRODUCT_AXIS_KEYS = Object.keys(EXPECTED_CROSS_PRODUCT_AXES) as CCCrossProductAxisKey[];

const REQUIRED_LEGACY_ARCHIVE_IDS = [
  'pre-schema-2-vs-archive',
  'c3-style-damaged-vs-archive',
] as const;

const REQUIRED_COMPATIBILITY_CONTRACT_CLAUSES = [
  'scope-brush-mode-playback',
  'scope-recolor-out-of-scope',
  'target-format-schema-version',
  'schema-version-discipline',
  'required-brush-buffers',
  'required-speed-range-scalars',
  'slot-palette-fallback-contract',
  'export-source-selection-order',
  'export-local-no-canonical-mutation',
  'generated-contract-freshness',
  'malformed-schema-2-visible-failure',
  'buffer-index-alpha-zero',
  'buffer-palette-index-base',
  'buffer-slot-row-clamp',
  'buffer-speed-zero-nonzero',
  'speed-decode-formula',
  'frame-offset-and-shift',
  'palette-default-size-256',
  'palette-black-white-runtime-fallback',
  'alpha-sampled-palette-entry',
  'legacy-runtime-defaults',
  'golden-fixture-parity',
  'vessel-reference-path',
] as const;

const clamp01 = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const clamp255 = (value: number): number => {
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded >= 255) return 255;
  return rounded;
};

const mod = (value: number, divisor: number): number => {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
};

const parseHexColor = (value: string): { r: number; g: number; b: number; a: number } => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith('#')) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  const hex = trimmed.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
    return { r, g, b, a };
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    return { r, g, b, a };
  }

  return { r: 255, g: 255, b: 255, a: 255 };
};

const normalizeStops = (stops: Goblet2GradientStop[]): Array<{ position: number; rgba: { r: number; g: number; b: number; a: number } }> => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [
      { position: 0, rgba: { r: 0, g: 0, b: 0, a: 255 } },
      { position: 1, rgba: { r: 255, g: 255, b: 255, a: 255 } },
    ];
  }

  const sorted = stops
    .map((entry) => ({
      position: clamp01(typeof entry.position === 'number' ? entry.position : Number(entry.position)),
      rgba: parseHexColor(entry.color),
    }))
    .sort((a, b) => a.position - b.position);

  if (sorted[0].position > 0) {
    sorted.unshift({ position: 0, rgba: sorted[0].rgba });
  }

  const last = sorted[sorted.length - 1];
  if (last.position < 1) {
    sorted.push({ position: 1, rgba: last.rgba });
  }

  if (sorted.length === 1) {
    sorted.push({ position: 1, rgba: sorted[0].rgba });
  }

  return sorted;
};

const sampleStops = (
  normalizedStops: Array<{ position: number; rgba: { r: number; g: number; b: number; a: number } }>,
  position: number,
): { r: number; g: number; b: number; a: number } => {
  const p = clamp01(position);
  for (let i = 0; i < normalizedStops.length - 1; i += 1) {
    const left = normalizedStops[i];
    const right = normalizedStops[i + 1];
    if (p >= left.position && p <= right.position) {
      const span = right.position - left.position;
      const t = span > 0 ? (p - left.position) / span : 0;
      return {
        r: clamp255(left.rgba.r + (right.rgba.r - left.rgba.r) * t),
        g: clamp255(left.rgba.g + (right.rgba.g - left.rgba.g) * t),
        b: clamp255(left.rgba.b + (right.rgba.b - left.rgba.b) * t),
        a: clamp255(left.rgba.a + (right.rgba.a - left.rgba.a) * t),
      };
    }
  }

  return { ...normalizedStops[normalizedStops.length - 1].rgba };
};

const decodeSpeed = (byte: number, speedMin: number, speedMax: number): number => {
  if (!Number.isFinite(byte) || byte <= 0) {
    return 0;
  }
  const normalized = Math.max(0, Math.min(254, Math.round(byte) - 1)) / 254;
  return speedMin + normalized * (speedMax - speedMin);
};

const samplePalette = (params: {
  palette: Uint8Array;
  paletteSize: number;
  slot: number;
  position: number;
}): { r: number; g: number; b: number; a: number } => {
  const { palette, paletteSize, slot, position } = params;
  const wrapped = mod(position, paletteSize);
  const lower = Math.floor(wrapped);
  const upper = (lower + 1) % paletteSize;
  const t = wrapped - lower;
  const lowerBase = (slot * paletteSize + lower) * 4;
  const upperBase = (slot * paletteSize + upper) * 4;
  return {
    r: clamp255(palette[lowerBase] + (palette[upperBase] - palette[lowerBase]) * t),
    g: clamp255(palette[lowerBase + 1] + (palette[upperBase + 1] - palette[lowerBase + 1]) * t),
    b: clamp255(palette[lowerBase + 2] + (palette[upperBase + 2] - palette[lowerBase + 2]) * t),
    a: clamp255(palette[lowerBase + 3] + (palette[upperBase + 3] - palette[lowerBase + 3]) * t),
  };
};

const buildReferencePaletteTable = (
  slotPalettes: Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }> | null,
  fallbackGradient: Goblet2GradientStop[],
  paletteSize: number,
  slotCount: number,
): Uint8Array => {
  const data = new Uint8Array(Math.max(1, paletteSize) * Math.max(1, slotCount) * 4);
  const fallbackStops = normalizeStops(fallbackGradient);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const slotPalette = slotPalettes?.get(slot);
    const normalized = slotPalette ? normalizeStops(slotPalette.stops) : fallbackStops;
    for (let i = 0; i < paletteSize; i += 1) {
      const t = paletteSize === 1 ? 0 : i / (paletteSize - 1);
      const c = sampleStops(normalized, t);
      const base = (slot * paletteSize + i) * 4;
      data[base] = c.r;
      data[base + 1] = c.g;
      data[base + 2] = c.b;
      data[base + 3] = c.a;
    }
    applyGradientSeamProfile(data, {
      paletteSize,
      seamProfile: slotPalette?.seamProfile,
      offset: slot * paletteSize * 4,
    });
  }
  return data;
};

const renderVesselReferenceFrame = (params: {
  indexBuffer: Uint8Array;
  gradientIdBuffer: Uint8Array;
  speedBuffer: Uint8Array;
  fallbackGradient: Goblet2GradientStop[];
  slotPalettes: Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }> | null;
  paletteSize: number;
  slotCount: number;
  speedMin: number;
  speedMax: number;
  timeSeconds: number;
  legacyOffset01: number;
}): Uint8ClampedArray => {
  const {
    indexBuffer,
    gradientIdBuffer,
    speedBuffer,
    fallbackGradient,
    slotPalettes,
    paletteSize,
    slotCount,
    speedMin,
    speedMax,
    timeSeconds,
    legacyOffset01,
  } = params;

  const palette = buildReferencePaletteTable(slotPalettes, fallbackGradient, paletteSize, slotCount);
  const output = new Uint8ClampedArray(indexBuffer.length * 4);

  for (let i = 0; i < indexBuffer.length; i += 1) {
    const index = indexBuffer[i] ?? 0;
    const outIndex = i * 4;

    if (index === 0) {
      output[outIndex + 3] = 0;
      continue;
    }

    const slot = Math.min(gradientIdBuffer[i] ?? 0, slotCount - 1);
    const speedByte = speedBuffer[i] ?? 0;
    const shift = speedByte === 0
      ? -legacyOffset01 * paletteSize
      : -((timeSeconds * decodeSpeed(speedByte, speedMin, speedMax)) % 1) * paletteSize;

    const baseIndex = Math.max(0, Math.min(paletteSize - 1, index - 1));
    const shifted = mod(baseIndex + shift, paletteSize);
    const sampled = samplePalette({ palette, paletteSize, slot, position: shifted });

    output[outIndex] = sampled.r;
    output[outIndex + 1] = sampled.g;
    output[outIndex + 2] = sampled.b;
    output[outIndex + 3] = sampled.a;
  }

  return output;
};

const renderVesselEditorFrame = (params: {
  width: number;
  height: number;
  indexBuffer: Uint8Array;
  gradientIdBuffer: Uint8Array;
  speedBuffer: Uint8Array;
  fallbackGradient: Goblet2GradientStop[];
  slotPalettes: Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }> | null;
  timeSeconds: number;
  legacyOffset01: number;
}): Uint8ClampedArray => {
  const animator = new ColorCycleAnimator({
    width: params.width,
    height: params.height,
    gradientStops: params.fallbackGradient,
    forceCanvas2D: true,
  });
  params.slotPalettes?.forEach((entry, slot) => {
    animator.setGradientSlot(slot, entry.stops, entry.seamProfile);
  });
  animator.setIndexBufferFromArray(
    params.indexBuffer,
    params.gradientIdBuffer,
    params.speedBuffer,
  );
  (animator as unknown as {
    renderFrame(offset?: number, baseTimeOverride?: number): void;
  }).renderFrame(params.legacyOffset01, params.timeSeconds);
  return new Uint8ClampedArray(animator.getImageData().data);
};

const loadFixtures = (): CCFixture[] => {
  const fixtureDir = path.resolve(process.cwd(), 'tests/fixtures/cc');
  return fs
    .readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.json') && !file.endsWith('.manifest.json'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(fixtureDir, file), 'utf8');
      return JSON.parse(raw) as CCFixture;
    });
};

const loadParityMatrixManifest = (): CCParityMatrixManifest => {
  const manifestPath = path.resolve(process.cwd(), 'tests/fixtures/cc/parity-matrix.manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CCParityMatrixManifest;
};

const loadCrossProductManifest = (): CCCrossProductManifest => {
  const manifestPath = path.resolve(process.cwd(), 'tests/fixtures/cc/parity-cross-product.manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CCCrossProductManifest;
};

const loadLegacyCorpusManifest = (): CCLegacyCorpusManifest => {
  const manifestPath = path.resolve(process.cwd(), 'tests/fixtures/goblet2/legacy-corpus.manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CCLegacyCorpusManifest;
};

const loadCompatibilityContractManifest = (): CCCompatibilityContractManifest => {
  const manifestPath = path.resolve(process.cwd(), 'tests/fixtures/cc/compatibility-contract.manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CCCompatibilityContractManifest;
};

const loadPackageScripts = (): Record<string, string> => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
};

const diffFrames = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) {
    return {
      maxChannelDelta: Number.POSITIVE_INFINITY,
      maxAlphaDelta: Number.POSITIVE_INFINITY,
      mismatchedPixels: Number.POSITIVE_INFINITY,
    };
  }

  let maxChannelDelta = 0;
  let maxAlphaDelta = 0;
  let mismatchedPixels = 0;

  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const da = Math.abs(a[i + 3] - b[i + 3]);

    const maxRgb = Math.max(dr, dg, db);
    maxChannelDelta = Math.max(maxChannelDelta, maxRgb);
    maxAlphaDelta = Math.max(maxAlphaDelta, da);

    if (maxRgb > 0 || da > 0) {
      mismatchedPixels += 1;
    }
  }

  return { maxChannelDelta, maxAlphaDelta, mismatchedPixels };
};

const makeCellKey = (axes: CCCrossProductCellAxes): string => (
  CROSS_PRODUCT_AXIS_KEYS.map((axis) => `${axis}:${axes[axis]}`).join('|')
);

const expandCrossProductCells = (axes: CCCrossProductAxes): CCCrossProductCellAxes[] => {
  let cells: CCCrossProductCellAxes[] = [{} as CCCrossProductCellAxes];
  CROSS_PRODUCT_AXIS_KEYS.forEach((axis) => {
    cells = cells.flatMap((cell) => axes[axis].map((value) => ({
      ...cell,
      [axis]: value,
    }) as CCCrossProductCellAxes));
  });
  return cells;
};

const groupContainsCell = (
  group: CCCrossProductManifest['todoGroups'][number],
  cell: CCCrossProductCellAxes,
): boolean => (
  CROSS_PRODUCT_AXIS_KEYS.every((axis) => group.axes[axis].includes(cell[axis] as never))
);

const CELL_ID_PIXEL_MODE_PREFIXES: Record<CCCrossProductCellAxes['pixelMode'], string> = {
  static: 'static-',
  animated: 'animated-',
  mixed: 'mixed-',
};

const CELL_ID_FIT_MODE_PREFIXES: Record<CCCrossProductCellAxes['fitMode'], string> = {
  none: 'rendered-fit-mode-none-',
  contain: 'rendered-fit-mode-contain-',
  cover: 'rendered-fit-mode-cover-',
  fill: 'rendered-fit-mode-fill-',
  tile: 'rendered-fit-mode-tile-',
};

const assertCoveredCellIdMatchesExplicitAxes = (
  cell: CCCrossProductManifest['coveredCells'][number],
): void => {
  const explicitPixelMode = Object.entries(CELL_ID_PIXEL_MODE_PREFIXES)
    .find(([, prefix]) => cell.id.startsWith(prefix))?.[0];
  if (explicitPixelMode) {
    expect(cell.axes.pixelMode).toBe(explicitPixelMode);
  }

  const explicitFitMode = Object.entries(CELL_ID_FIT_MODE_PREFIXES)
    .find(([, prefix]) => cell.id.startsWith(prefix))?.[0];
  if (explicitFitMode) {
    expect(cell.axes.fitMode).toBe(explicitFitMode);
  }
};

describe('Color cycle runtime parity (Vessel reference vs Goblet2 CPU)', () => {
  const fixtures = loadFixtures();
  const manifest = loadParityMatrixManifest();
  const crossProductManifest = loadCrossProductManifest();
  const legacyCorpusManifest = loadLegacyCorpusManifest();
  const compatibilityContractManifest = loadCompatibilityContractManifest();
  const packageScripts = loadPackageScripts();
  const namedParityCommand = packageScripts['test:cc-runtime-parity'] ?? '';
  const namedGpuParityCommand = packageScripts['test:cc-runtime-gpu-parity'] ?? '';
  const namedRuntimeFreshnessCommand = packageScripts['verify:goblet-runtime'] ?? '';

  it('loads at least one CC fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('keeps the Problem 2 playback semantic coverage matrix explicit', () => {
    expect(manifest.version).toBe(1);
    const byId = new Map(manifest.semantics.map((entry) => [entry.id, entry]));

    REQUIRED_PLAYBACK_SEMANTICS.forEach((semantic) => {
      const entry = byId.get(semantic);
      expect(entry).toBeDefined();
      expect(entry?.label).toEqual(expect.any(String));
      expect(entry?.status === 'covered' || entry?.status === 'todo').toBe(true);
      expect(entry?.coverage).toEqual(expect.any(String));
      expect(entry?.runtimeTargets.length).toBeGreaterThan(0);
      expect(entry?.witnesses.length).toBeGreaterThan(0);

      entry?.witnesses.forEach((witness) => {
        expect(fs.existsSync(path.resolve(process.cwd(), witness))).toBe(true);
        if (witness.endsWith('.test.ts')) {
          expect(namedParityCommand).toContain(witness);
        }
        if (witness.endsWith('.spec.ts')) {
          expect(namedGpuParityCommand).toContain(witness);
        }
        if (witness === 'scripts/build-align-fit.mjs') {
          expect(namedRuntimeFreshnessCommand).toContain('build:align-fit -- --check');
        }
        if (witness === 'scripts/build-goblet-runtime.mjs') {
          expect(namedRuntimeFreshnessCommand).toContain('build-goblet-runtime.mjs --check --target=all');
        }
      });
    });

    const unknownEntries = manifest.semantics
      .map((entry) => entry.id)
      .filter((id) => !REQUIRED_PLAYBACK_SEMANTICS.includes(id as typeof REQUIRED_PLAYBACK_SEMANTICS[number]));
    expect(unknownEntries).toEqual([]);
  });

  it('does not mark manifest entries covered while describing known gaps', () => {
    manifest.semantics.forEach((entry) => {
      if (entry.status === 'covered') {
        expect(entry.note ?? '').not.toMatch(COVERED_ENTRY_KNOWN_GAP_PATTERN);
      }
    });
    crossProductManifest.coveredCells.forEach((cell) => {
      expect(cell.note ?? '').not.toMatch(COVERED_ENTRY_KNOWN_GAP_PATTERN);
    });
  });

  it('has rendered parity fixtures for the CPU playback semantics', () => {
    const renderedParitySemantics = manifest.semantics
      .filter((entry) => entry.runtimeTargets.includes('cpu-rendered'))
      .map((entry) => entry.id);
    const fixtureCoverage = new Set(fixtures.flatMap((fixture) => fixture.coverage ?? []));

    renderedParitySemantics.forEach((semantic) => {
      expect(fixtureCoverage.has(semantic)).toBe(true);
    });
  });

  it('pins the Vessel reference side to the editor ColorCycleAnimator playback path', () => {
    const editorPathFixtures = fixtures.filter((fixture) => (
      fixture.coverage?.includes('vessel-reference-path')
    ));
    expect(editorPathFixtures.map((fixture) => fixture.id)).toEqual([
      'vessel-editor-reference-path',
    ]);

    editorPathFixtures.forEach((fixture) => {
      const pixelCount = fixture.width * fixture.height;
      const indexBuffer = Uint8Array.from(fixture.brushState.indexBuffer);
      const gradientIdBuffer = Uint8Array.from(fixture.brushState.gradientIdBuffer);
      const speedBuffer = Uint8Array.from(fixture.brushState.speedBuffer);
      expect(indexBuffer).toHaveLength(pixelCount);
      expect(gradientIdBuffer).toHaveLength(pixelCount);
      expect(speedBuffer).toHaveLength(pixelCount);

      const slotPalettes = fixture.slotPalettes
        ? new Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }>(
            fixture.slotPalettes.map((entry) => [
              entry.slot,
              { stops: entry.stops, seamProfile: entry.seamProfile },
            ]),
          )
        : null;
      const paletteSize = Math.max(1, Math.round(fixture.paletteSize ?? 256));
      const editorSlotCount = 256;
      const gobletPalette = bakePaletteTable(
        slotPalettes,
        fixture.brushState.gradientStops,
        paletteSize,
        editorSlotCount,
      );

      const gobletFrame = renderBrushFrame({
        indexBuffer,
        gradientIdBuffer,
        speedBuffer,
        paletteTable: gobletPalette,
        speedMin: fixture.speedMin,
        speedMax: fixture.speedMax,
        timeSeconds: fixture.timeSeconds,
        legacyOffset01: fixture.legacyOffset01 ?? 0,
      });
      const vesselFrame = renderVesselEditorFrame({
        width: fixture.width,
        height: fixture.height,
        indexBuffer,
        gradientIdBuffer,
        speedBuffer,
        fallbackGradient: fixture.brushState.gradientStops,
        slotPalettes,
        timeSeconds: fixture.timeSeconds,
        legacyOffset01: fixture.legacyOffset01 ?? 0,
      });

      const deltas = diffFrames(vesselFrame, gobletFrame);
      expect(deltas.maxChannelDelta).toBeLessThanOrEqual(fixture.thresholds.maxChannelDelta);
      expect(deltas.maxAlphaDelta).toBeLessThanOrEqual(fixture.thresholds.maxAlphaDelta);
      expect(deltas.mismatchedPixels).toBeLessThanOrEqual(fixture.thresholds.maxMismatchedPixels);
    });
  });

  it('keeps GPU rendered parity status tied to the browser witness', () => {
    const gpuRenderedSemantics = manifest.semantics
      .filter((entry) => entry.runtimeTargets.includes('gpu-rendered'))
      .map((entry) => entry.id);

    expect(gpuRenderedSemantics).toEqual([
      'speed-decode',
      'frame-phase-shift',
      'slot-clamp',
      'palette-fallback',
      'palette-row-sampling',
      'flow-modes',
      'mask-alpha',
      'fit-modes',
      'display-filters',
    ]);
    manifest.semantics.forEach((entry) => {
      if (entry.runtimeTargets.includes('gpu-rendered')) {
        expect(entry.witnesses.some((witness) => (
          witness.endsWith('.spec.ts') &&
          namedGpuParityCommand.includes(witness)
        ))).toBe(true);
      }
      if (entry.runtimeTargets.includes('gpu-regression')) {
        expect(entry.witnesses.some((witness) => witness.includes('goblet2-runtime-regression'))).toBe(true);
      }
    });
  });

  it('keeps the Problem 2 cross-product matrix explicit', () => {
    expect(crossProductManifest.version).toBe(1);
    expect(crossProductManifest.axes).toEqual(EXPECTED_CROSS_PRODUCT_AXES);

    const allCells = expandCrossProductCells(crossProductManifest.axes);
    expect(allCells).toHaveLength(360);

    const coveredCellKeys = new Set<string>();
    const coveredCellIds = new Set<string>();
    crossProductManifest.coveredCells.forEach((cell) => {
      expect(cell.id).toEqual(expect.any(String));
      expect(coveredCellIds.has(cell.id)).toBe(false);
      coveredCellIds.add(cell.id);
      assertCoveredCellIdMatchesExplicitAxes(cell);
      expect(cell.note).toEqual(expect.any(String));
      CROSS_PRODUCT_AXIS_KEYS.forEach((axis) => {
        expect(crossProductManifest.axes[axis]).toContain(cell.axes[axis] as never);
      });
      cell.witnesses.forEach((witness) => {
        expect(fs.existsSync(path.resolve(process.cwd(), witness))).toBe(true);
        if (witness.endsWith('.test.ts')) {
          expect(namedParityCommand).toContain(witness);
        }
        if (witness.endsWith('.spec.ts')) {
          expect(namedGpuParityCommand).toContain(witness);
        }
      });
      coveredCellKeys.add(makeCellKey(cell.axes));
    });

    crossProductManifest.todoGroups.forEach((group) => {
      expect(group.id).toEqual(expect.any(String));
      expect(group.reason).toMatch(/Problem 2 TODO:/);
      CROSS_PRODUCT_AXIS_KEYS.forEach((axis) => {
        expect(group.axes[axis].length).toBeGreaterThan(0);
        group.axes[axis].forEach((value) => {
          expect(crossProductManifest.axes[axis]).toContain(value as never);
        });
      });
    });

    const missingCells = allCells.filter((cell) => {
      const key = makeCellKey(cell);
      if (coveredCellKeys.has(key)) {
        return false;
      }
      return !crossProductManifest.todoGroups.some((group) => groupContainsCell(group, cell));
    });
    expect(missingCells).toEqual([]);

    const coveredButStillTodo = allCells.filter((cell) => {
      const key = makeCellKey(cell);
      return coveredCellKeys.has(key) && crossProductManifest.todoGroups.some((group) => (
        !group.exceptCoveredCells && groupContainsCell(group, cell)
      ));
    });
    expect(coveredButStillTodo).toEqual([]);
  });

  it('keeps the Problem 2 real legacy .vs corpus gap explicit', () => {
    expect(legacyCorpusManifest.version).toBe(1);

    const byId = new Map(legacyCorpusManifest.requiredArchives.map((entry) => [entry.id, entry]));
    REQUIRED_LEGACY_ARCHIVE_IDS.forEach((id) => {
      const entry = byId.get(id);
      expect(entry).toBeDefined();
      expect(entry?.status === 'covered' || entry?.status === 'todo').toBe(true);

      if (entry?.status === 'covered') {
        expect(entry.archivePath).toEqual(expect.any(String));
        expect(entry.archivePath).toMatch(/\.vs$/);
        expect(fs.existsSync(path.resolve(process.cwd(), entry.archivePath as string))).toBe(true);
        expect(entry.expectedOutcome).not.toBe('todo');
      } else {
        expect(entry?.archivePath).toBeUndefined();
        expect(entry?.expectedOutcome).toBe('todo');
        expect(entry?.reason ?? '').toMatch(/Problem 2 TODO:/);
      }
    });

    const unknownEntries = legacyCorpusManifest.requiredArchives
      .map((entry) => entry.id)
      .filter((id) => !REQUIRED_LEGACY_ARCHIVE_IDS.includes(id as typeof REQUIRED_LEGACY_ARCHIVE_IDS[number]));
    expect(unknownEntries).toEqual([]);
  });

  it('keeps every compatibility-contract prose clause covered or explicitly tracked', () => {
    expect(compatibilityContractManifest.version).toBe(1);

    const byId = new Map(compatibilityContractManifest.clauses.map((entry) => [entry.id, entry]));
    REQUIRED_COMPATIBILITY_CONTRACT_CLAUSES.forEach((id) => {
      const entry = byId.get(id);
      expect(entry).toBeDefined();
      expect(entry?.docSection).toEqual(expect.any(String));
      expect(entry?.status === 'covered' || entry?.status === 'todo').toBe(true);

      if (entry?.status === 'covered') {
        expect(entry.witnesses.length).toBeGreaterThan(0);
        expect(entry.note ?? '').not.toMatch(COVERED_ENTRY_KNOWN_GAP_PATTERN);
        entry.witnesses.forEach((witness) => {
          expect(fs.existsSync(path.resolve(process.cwd(), witness))).toBe(true);
          if (witness.endsWith('.test.ts')) {
            expect(namedParityCommand).toContain(witness);
          }
          if (witness.endsWith('.spec.ts')) {
            expect(namedGpuParityCommand).toContain(witness);
          }
          if (witness === 'scripts/build-goblet-runtime.mjs') {
            expect(namedRuntimeFreshnessCommand).toContain('build-goblet-runtime.mjs --check --target=all');
          }
        });
      } else {
        expect(entry?.witnesses).toEqual([]);
        expect(entry?.reason ?? '').toMatch(/Problem 2 TODO:/);
      }
    });

    const unknownEntries = compatibilityContractManifest.clauses
      .map((entry) => entry.id)
      .filter((id) => !REQUIRED_COMPATIBILITY_CONTRACT_CLAUSES.includes(id as typeof REQUIRED_COMPATIBILITY_CONTRACT_CLAUSES[number]));
    expect(unknownEntries).toEqual([]);
  });

  fixtures.forEach((fixture) => {
    it(`keeps parity for fixture: ${fixture.id}`, () => {
      const pixelCount = fixture.width * fixture.height;
      expect(fixture.brushState.indexBuffer).toHaveLength(pixelCount);
      expect(fixture.brushState.gradientIdBuffer).toHaveLength(pixelCount);
      expect(fixture.brushState.speedBuffer).toHaveLength(pixelCount);

      const indexBuffer = Uint8Array.from(fixture.brushState.indexBuffer);
      const gradientIdBuffer = Uint8Array.from(fixture.brushState.gradientIdBuffer);
      const speedBuffer = Uint8Array.from(fixture.brushState.speedBuffer);
      const slotPalettes = fixture.slotPalettes
        ? new Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }>(
            fixture.slotPalettes.map((entry) => [
              entry.slot,
              { stops: entry.stops, seamProfile: entry.seamProfile },
            ]),
          )
        : null;

      const paletteSize = Math.max(1, Math.round(fixture.paletteSize ?? 256));
      const highestSlotInPalettes = fixture.slotPalettes?.reduce((max, entry) => Math.max(max, entry.slot), 0) ?? 0;
      const slotCount = Math.max(1, highestSlotInPalettes + 1);

      const gobletPalette = bakePaletteTable(
        slotPalettes,
        fixture.brushState.gradientStops,
        paletteSize,
        slotCount,
      );

      const frameTimes = [fixture.timeSeconds, fixture.timeSeconds + 0.5];
      frameTimes.forEach((timeSeconds) => {
        const gobletFrame = renderBrushFrame({
          indexBuffer,
          gradientIdBuffer,
          speedBuffer,
          paletteTable: gobletPalette,
          speedMin: fixture.speedMin,
          speedMax: fixture.speedMax,
          timeSeconds,
          legacyOffset01: fixture.legacyOffset01 ?? 0,
        });

        const vesselFrame = renderVesselReferenceFrame({
          indexBuffer,
          gradientIdBuffer,
          speedBuffer,
          fallbackGradient: fixture.brushState.gradientStops,
          slotPalettes,
          paletteSize,
          slotCount,
          speedMin: fixture.speedMin,
          speedMax: fixture.speedMax,
          timeSeconds,
          legacyOffset01: fixture.legacyOffset01 ?? 0,
        });

        const deltas = diffFrames(vesselFrame, gobletFrame);
        expect(deltas.maxChannelDelta).toBeLessThanOrEqual(fixture.thresholds.maxChannelDelta);
        expect(deltas.maxAlphaDelta).toBeLessThanOrEqual(fixture.thresholds.maxAlphaDelta);
        expect(deltas.mismatchedPixels).toBeLessThanOrEqual(fixture.thresholds.maxMismatchedPixels);
      });
    });
  });
});
