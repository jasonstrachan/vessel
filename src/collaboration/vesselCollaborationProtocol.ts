import type {
  VesselCollaborationRuntimeFence,
  VesselCollaborationRuntimeIdentity,
} from './vesselCollaborationRuntimeIdentity';

export interface VesselCollaborationPoint {
  x: number;
  y: number;
  pressure?: number;
}

export type VesselCollaborationCapturePolicy =
  | 'none'
  | 'final-thumbnail'
  | 'each-thumbnail'
  | 'full';

interface VesselCollaborationCaptureOptions {
  capture?: VesselCollaborationCapturePolicy;
  thumbnailMaxSize?: number;
  runtimeFence?: VesselCollaborationRuntimeFence;
}

export type VesselCollaborationDitherAlgorithm =
  | 'floyd-steinberg'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'burkes'
  | 'sierra-3'
  | 'sierra-2'
  | 'sierra-lite'
  | 'atkinson'
  | 'bayer'
  | 'blue-noise'
  | 'void-and-cluster'
  | 'pattern';

export type VesselCollaborationPatternStyle =
  | 'dots'
  | 'lines'
  | 'vertical-lines'
  | 'horizontal-lines'
  | 'crosshatch'
  | 'diagonal'
  | 'ascii'
  | 'tone-adaptive';

export type VesselCollaborationGradientSource = 'manual' | 'fg' | 'sampled';
export type VesselCollaborationEraserTip = 'square' | 'round' | 'diamond5';
export type VesselCollaborationConstructionPhase =
  | 'primary'
  | 'medium'
  | 'focal'
  | 'revision';

const MAX_PRIORITY_MASK_PIXELS = 4_000_000;

export interface VesselCollaborationGradientStop {
  position: number;
  color: string;
  opacity?: number;
}

interface VesselCollaborationStrokeOperation {
  action: 'stroke';
  id?: string;
  basedOnRevision?: number;
  parentMassId?: string;
  sourceRegionId?: string;
  points: VesselCollaborationPoint[];
  tool?: 'brush' | 'eraser';
  pointsPerFrame?: number;
  phase?: VesselCollaborationConstructionPhase;
}

interface VesselCollaborationShapeOperation {
  action: 'shape';
  id?: string;
  basedOnRevision?: number;
  parentMassId?: string;
  sourceRegionId?: string;
  points: VesselCollaborationPoint[];
  direction?: VesselCollaborationPoint[];
  pointsPerFrame?: number;
  phase?: VesselCollaborationConstructionPhase;
}

interface VesselCollaborationSetBrushOperation {
  action: 'set-brush';
  settings: {
    size?: number;
    opacity?: number;
    color?: string;
    spacing?: number;
    ditherEnabled?: boolean;
    ditherAlgorithm?: VesselCollaborationDitherAlgorithm;
    patternStyle?: VesselCollaborationPatternStyle;
    fillResolution?: number;
    pressureLinkedFillResolution?: boolean;
    pressureLinkedFillMaxResolution?: number;
    ditherBackgroundFill?: boolean;
    ditherGradBgFill?: boolean;
    ditherPaletteSpread?: number;
    ditherPatternDiversity?: number;
    ditherPhaseJitter?: number;
    ccGradientRangeContrast?: number;
    ccSampledSoftSeamEnabled?: boolean;
    lostEdge?: number;
    pxlEdge?: boolean;
    colorCycleSpeed?: number;
    gradientBands?: number;
    colorCycleFillMode?: 'concentric' | 'linear' | 'stroke';
    ccGradientDrawingShape?:
      | 'freehand'
      | 'rectangle'
      | 'ellipse'
      | 'line'
      | 'triangle'
      | 'polygon'
      | 'click-line';
    colorCycleStampDitherEnabled?: boolean;
    colorCycleStampDitherPixelSize?: number;
    colorCycleStampDitherPressureLinked?: boolean;
    colorCycleStampDitherBgFill?: boolean;
    colorCycleStampShape?:
      | 'square'
      | 'round'
      | 'triangle'
      | 'diamond'
      | 'diamond5'
      | 'diamond7'
      | 'diamond9'
      | 'checkered';
  };
}

interface VesselCollaborationSetPaletteOperation {
  action: 'set-palette';
  foreground?: string;
  background?: string;
  activeSlot?: 'foreground' | 'background';
  swap?: boolean;
}

interface VesselCollaborationSetGradientSourceOperation {
  action: 'set-gradient-source';
  source: VesselCollaborationGradientSource;
}

interface VesselCollaborationSetGradientOperation {
  action: 'set-gradient';
  stops?: VesselCollaborationGradientStop[];
  foreground?: {
    lightness?: number;
    hueShift?: number;
    saturationShift?: number;
    opacity?: number;
    stopCount?: number;
  };
  resetSample?: boolean;
}

interface VesselCollaborationSetEraserOperation {
  action: 'set-eraser';
  settings: {
    size?: number;
    opacity?: number;
    linkSizeToBrush?: boolean;
    tip?: VesselCollaborationEraserTip;
  };
}

interface VesselCollaborationCheckpointOperation {
  action: 'checkpoint';
  name: string;
  capture?: 'final-thumbnail' | 'full';
  thumbnailMaxSize?: number;
}

interface VesselCollaborationCreateLayerOperation {
  action: 'create-layer';
  layerType: 'normal' | 'color-cycle';
  name?: string;
}

interface VesselCollaborationSetLayerVisibilityOperation {
  action: 'set-layer-visibility';
  layerId: string;
  visible: boolean;
}

export type VesselCollaborationBatchOperation =
  | VesselCollaborationStrokeOperation
  | VesselCollaborationShapeOperation
  | VesselCollaborationCheckpointOperation
  | VesselCollaborationCreateLayerOperation
  | { action: 'set-tool'; tool: 'brush' | 'eraser' }
  | { action: 'set-brush-preset'; presetId: string }
  | VesselCollaborationSetBrushOperation
  | VesselCollaborationSetPaletteOperation
  | VesselCollaborationSetGradientSourceOperation
  | VesselCollaborationSetGradientOperation
  | VesselCollaborationSetEraserOperation
  | VesselCollaborationSetLayerVisibilityOperation
  | { action: 'set-active-layer'; layerId: string };

export type VesselCollaborationArtworkOperation = Exclude<
  VesselCollaborationBatchOperation,
  | VesselCollaborationCreateLayerOperation
  | VesselCollaborationSetLayerVisibilityOperation
  | { action: 'set-active-layer'; layerId: string }
>;

type WithCaptureOptions<T> = T & VesselCollaborationCaptureOptions;

export type VesselCollaborationCommand =
  | WithCaptureOptions<{ id: string; action: 'observe' }>
  | WithCaptureOptions<{
      id: string;
      action: 'new-project';
      width: number;
      height: number;
      name?: string;
    }>
  | WithCaptureOptions<{ id: string; action: 'open-project'; fileName: string; dataBase64: string }>
  | WithCaptureOptions<{
      id: string;
      action: 'import-reference-image';
      fileName: string;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      dataBase64: string;
      fit?: 'contain' | 'cover' | 'stretch';
    }>
  | WithCaptureOptions<{ id: string } & VesselCollaborationStrokeOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationShapeOperation>
  | WithCaptureOptions<{ id: string; action: 'set-tool'; tool: 'brush' | 'eraser' }>
  | WithCaptureOptions<{ id: string; action: 'set-brush-preset'; presetId: string }>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetBrushOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetPaletteOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetGradientSourceOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetGradientOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetEraserOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationCreateLayerOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetLayerVisibilityOperation>
  | {
      id: string;
      action: 'batch';
      operations: VesselCollaborationBatchOperation[];
      capture?: VesselCollaborationCapturePolicy;
      thumbnailMaxSize?: number;
      runtimeFence?: VesselCollaborationRuntimeFence;
    }
  | {
      id: string;
      action: 'artwork-job';
      operations: VesselCollaborationArtworkOperation[];
      priorityCoverage?: VesselCollaborationPriorityCoverageRequest;
      capture?: Exclude<VesselCollaborationCapturePolicy, 'each-thumbnail'>;
      thumbnailMaxSize?: number;
      runtimeFence?: VesselCollaborationRuntimeFence;
    }
  | WithCaptureOptions<{
      id: string;
      action: 'wait-for-frame';
      afterRevision: number;
      timeoutMs?: number;
    }>
  | WithCaptureOptions<{ id: string; action: 'set-active-layer'; layerId: string }>
  | WithCaptureOptions<{ id: string; action: 'undo' | 'redo' }>
  | WithCaptureOptions<{ id: string; action: 'save'; filename?: string }>;

export interface VesselCollaborationFrame {
  mimeType: 'image/png';
  kind: 'thumbnail' | 'full';
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  dataUrl: string;
}

export interface VesselCollaborationPriorityCoverageRequest {
  priorityMaskId: string;
  priorityMaskFingerprint: string;
  coverageBaselineRevision: number;
  width: number;
  height: number;
  spans: Array<{ y: number; xStart: number; xEndExclusive: number }>;
}

export interface VesselCollaborationPriorityCoverageEvidence {
  priorityMaskId: string;
  priorityMaskFingerprint: string;
  maskPixels: number;
  uniqueMeaningfullyChangedPixels: number;
  cumulativePercentage: number;
  baselineRevision: number;
  currentRevision: number;
}

export interface VesselCollaborationMarkEvidence {
  layerId: string;
  documentVersion: number;
  documentVersionDelta: number;
  markType: 'stroke' | 'shape';
  phase: VesselCollaborationConstructionPhase | null;
  status: 'committed' | 'rejected';
  changedPixels: number;
  normalizedCoverage: number;
  dirtyRevisionDelta: number;
  affectedBounds?: { x: number; y: number; width: number; height: number };
  changedChannels: Array<'paint' | 'gradient' | 'speed' | 'flow' | 'phase'>;
  strokeSpan?: number;
  rejectionReason?:
    | 'no-authored-delta'
    | 'unpublished-canonical-delta'
    | 'invalid-geometry';
}

export interface VesselCollaborationProfile {
  mutationMs: number;
  presentationMs: number;
  captureMs: number;
  totalMs: number;
  operations?: Array<{
    index: number;
    operationId?: string;
    action: VesselCollaborationBatchOperation['action'];
    mutationMs: number;
    revision: number;
    markEvidence?: VesselCollaborationMarkEvidence;
  }>;
}

export type VesselCollaborationExecutionEvent =
  | {
      type: 'validated';
      totalOperations: number;
    }
  | {
      type: 'progress';
      completedOperations: number;
      totalOperations: number;
      revision: number;
      markEvidence?: VesselCollaborationMarkEvidence;
    }
  | {
      type: 'checkpoint';
      operationIndex: number;
      checkpointName: string;
      checkpointId: string;
      completedOperations: number;
      totalOperations: number;
      revision: number;
      frame: VesselCollaborationFrame;
      priorityCoverage?: VesselCollaborationPriorityCoverageEvidence;
    };

export interface VesselCollaborationOutcomeSummary {
  transport: 'accepted';
  execution: 'completed' | 'cancelled' | 'failed';
  evidence: 'valid' | 'deficient' | 'unverifiable';
  checkpoint: 'valid' | 'missing' | 'invalid';
  attemptedShapes: number;
  committedShapes: number;
  rejectedShapes: number;
  attemptedStrokes: number;
  committedStrokes: number;
  rejectedStrokes: number;
  changedPixels: number;
}

export interface VesselCollaborationResult {
  ok: boolean;
  commandId: string;
  action: VesselCollaborationCommand['action'];
  revision: number;
  checkpointId?: string | null;
  committedOperationIds?: string[];
  priorityCoverage?: VesselCollaborationPriorityCoverageEvidence;
  runtime?: VesselCollaborationRuntimeIdentity;
  outcome?: VesselCollaborationOutcomeSummary;
  state?: {
    project: { id: string; name: string; width: number; height: number } | null;
    activeLayerId: string | null;
    referenceLayerId: string | null;
    preferReferenceSampling: boolean;
    currentTool: string;
    currentBrushPresetId: string | null;
    currentBrushCapabilities: {
      canDither: boolean;
      forceDither: boolean;
    };
    availableBrushPresets: Array<{
      id: string;
      name: string;
      category: string;
      isCustomBrush: boolean;
    }>;
    palette: {
      foreground: string;
      background: string;
      activeSlot: 'foreground' | 'background';
    };
    gradient: {
      source: VesselCollaborationGradientSource;
      stops: VesselCollaborationGradientStop[];
      foreground: {
        lightness: number;
        hueShift: number;
        saturationShift: number;
        opacity: number;
        stopCount: number;
      };
      sampleCount: number;
    };
    colorCycle: {
      hasContent: boolean;
      gradientDefinitionCount: number;
      sampledGradientDefinitionCount: number;
      sampledPaintedPixelCount: number;
      latestSampledGradient: {
        id: number;
        stopCount: number;
        uniqueColorCount: number;
        stops: VesselCollaborationGradientStop[];
      } | null;
    } | null;
    brush: {
      size: number;
      opacity: number;
      color: string;
      spacing: number;
      shapeEnabled: boolean;
      ditherEnabled: boolean;
      ditherAlgorithm: string | null;
      patternStyle: string | null;
      fillResolution: number | null;
      pressureLinkedFillResolution: boolean;
      pressureLinkedFillMaxResolution: number | null;
      ditherBackgroundFill: boolean;
      ditherGradBgFill: boolean;
      ditherPaletteSpread: number;
      ditherPatternDiversity: number;
      ditherPhaseJitter: number;
      ccGradientRangeContrast: number;
      ccSampledSoftSeamEnabled: boolean;
      lostEdge: number;
      pxlEdge: boolean;
      colorCycleSpeed: number | null;
      gradientBands: number | null;
      colorCycleFillMode: string | null;
      ccGradientDrawingShape: string | null;
      colorCycleStampDitherEnabled: boolean;
      colorCycleStampDitherPixelSize: number | null;
      colorCycleStampDitherPressureLinked: boolean;
      colorCycleStampDitherBgFill: boolean;
      colorCycleStampShape: string | null;
    };
    eraser: {
      size: number;
      opacity: number;
      linkSizeToBrush: boolean;
      tip: VesselCollaborationEraserTip;
    };
    dirtyRevision: number;
    layers: Array<{
      id: string;
      name: string;
      type: string;
      visible: boolean;
      locked: boolean;
      opacity: number;
    }>;
  };
  frame?: VesselCollaborationFrame;
  frames?: Array<{
    operationIndex: number;
    revision: number;
    checkpointName?: string;
    checkpointId?: string;
    frame: VesselCollaborationFrame;
    priorityCoverage?: VesselCollaborationPriorityCoverageEvidence;
  }>;
  profile?: VesselCollaborationProfile;
  completedOperations?: number;
  cancelled?: boolean;
  markEvidence?: VesselCollaborationMarkEvidence;
  timedOut?: boolean;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
};

const requireFiniteNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
};

const requireBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
};

const requireInteger = (value: unknown, field: string): number => {
  const number = requireFiniteNumber(value, field);
  if (!Number.isInteger(number)) {
    throw new Error(`${field} must be an integer`);
  }
  return number;
};

const requireHexColor = (value: unknown, field: string): string => {
  const color = requireString(value, field);
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error(`${field} must be a six-digit hex color`);
  }
  return color;
};

const requireNumberInRange = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number => {
  const number = requireFiniteNumber(value, field);
  if (number < minimum || number > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return number;
};

const requireIntegerInRange = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number => {
  const number = requireInteger(value, field);
  if (number < minimum || number > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return number;
};

const DITHER_ALGORITHMS = new Set<VesselCollaborationDitherAlgorithm>([
  'floyd-steinberg',
  'jarvis-judice-ninke',
  'stucki',
  'burkes',
  'sierra-3',
  'sierra-2',
  'sierra-lite',
  'atkinson',
  'bayer',
  'blue-noise',
  'void-and-cluster',
  'pattern',
]);

const PATTERN_STYLES = new Set<VesselCollaborationPatternStyle>([
  'dots',
  'lines',
  'vertical-lines',
  'horizontal-lines',
  'crosshatch',
  'diagonal',
  'ascii',
  'tone-adaptive',
]);

const CC_GRADIENT_DRAWING_SHAPES = new Set([
  'freehand',
  'rectangle',
  'ellipse',
  'line',
  'triangle',
  'polygon',
  'click-line',
]);

const CC_STAMP_SHAPES = new Set([
  'square',
  'round',
  'triangle',
  'diamond',
  'diamond5',
  'diamond7',
  'diamond9',
  'checkered',
]);

const ERASER_TIPS = new Set<VesselCollaborationEraserTip>([
  'square',
  'round',
  'diamond5',
]);

const MAX_PROJECT_BASE64_CHARS = 24 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = 16 * 1024 * 1024;
const MAX_BATCH_OPERATIONS = 100;
const MAX_BATCH_POINTS = 50000;
const MAX_ARTWORK_JOB_OPERATIONS = 2000;
const MAX_ARTWORK_JOB_POINTS = 250000;
const MAX_COALESCED_STROKE_POINTS = 16;
const MAX_CAPTURED_BATCH_FRAMES = 8;

const readProjectBase64 = (value: unknown): string => {
  const dataBase64 = requireString(value, 'dataBase64');
  if (dataBase64.length > MAX_PROJECT_BASE64_CHARS) {
    throw new Error('dataBase64 exceeds the 24 MB bridge limit');
  }
  if (dataBase64.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(dataBase64)) {
    throw new Error('dataBase64 must be valid base64');
  }
  return dataBase64;
};

const readImageBase64 = (value: unknown): string => {
  const dataBase64 = requireString(value, 'dataBase64');
  if (dataBase64.length > MAX_IMAGE_BASE64_CHARS) {
    throw new Error('dataBase64 exceeds the 16 MB image bridge limit');
  }
  if (dataBase64.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(dataBase64)) {
    throw new Error('dataBase64 must be valid base64');
  }
  return dataBase64;
};

const readImageMimeType = (value: unknown) => {
  if (value !== 'image/png' && value !== 'image/jpeg' && value !== 'image/webp') {
    throw new Error('mimeType must be image/png, image/jpeg, or image/webp');
  }
  return value;
};

const readImageFit = (value: unknown): 'contain' | 'cover' | 'stretch' | undefined => {
  if (value === undefined) return undefined;
  if (value !== 'contain' && value !== 'cover' && value !== 'stretch') {
    throw new Error('fit must be contain, cover, or stretch');
  }
  return value;
};

const readTool = (value: unknown): 'brush' | 'eraser' => {
  if (value !== 'brush' && value !== 'eraser') {
    throw new Error('tool must be brush or eraser');
  }
  return value;
};

const readPoint = (value: unknown, index: number): VesselCollaborationPoint => {
  if (!isRecord(value)) {
    throw new Error(`points[${index}] must be an object`);
  }
  const pressure = value.pressure === undefined
    ? undefined
    : requireFiniteNumber(value.pressure, `points[${index}].pressure`);
  if (pressure !== undefined) {
    if (pressure < 0 || pressure > 1) {
      throw new Error(`points[${index}].pressure must be between 0 and 1`);
    }
  }
  return {
    x: requireFiniteNumber(value.x, `points[${index}].x`),
    y: requireFiniteNumber(value.y, `points[${index}].y`),
    pressure,
  };
};

const readPoints = (value: unknown, field = 'points'): VesselCollaborationPoint[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one point`);
  }
  if (value.length > 10000) {
    throw new Error(`${field} cannot contain more than 10000 points`);
  }
  return value.map((point, index) => readPoint(point, index));
};

const readShapePoints = (value: unknown, field: string): VesselCollaborationPoint[] => {
  const points = readPoints(value, field);
  if (points.length < 3) {
    throw new Error(`${field} must contain at least three points`);
  }
  return points;
};

const readDirectionPoints = (value: unknown, field: string): VesselCollaborationPoint[] => {
  const points = readPoints(value, field);
  if (points.length < 2) {
    throw new Error(`${field} must contain at least two points`);
  }
  return points;
};

const readPointsPerFrame = (value: unknown, field: string): number | undefined => {
  if (value === undefined) return undefined;
  const pointsPerFrame = requireInteger(value, field);
  if (pointsPerFrame < 1 || pointsPerFrame > 2) {
    throw new Error(`${field} must be 1 or 2`);
  }
  return pointsPerFrame;
};

const validateStrokePointBatch = (
  points: VesselCollaborationPoint[],
  pointsPerFrame: number | undefined,
  field: string,
) => {
  if (pointsPerFrame === 2 && points.length > MAX_COALESCED_STROKE_POINTS) {
    throw new Error(`${field} can only be 2 for strokes with at most 16 points`);
  }
};

const readBrushSettings = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error('settings must be an object');
  }
  const supportedKeys = new Set([
    'size',
    'opacity',
    'color',
    'spacing',
    'ditherEnabled',
    'ditherAlgorithm',
    'patternStyle',
    'fillResolution',
    'pressureLinkedFillResolution',
    'pressureLinkedFillMaxResolution',
    'ditherBackgroundFill',
    'ditherGradBgFill',
    'ditherPaletteSpread',
    'ditherPatternDiversity',
    'ditherPhaseJitter',
    'ccGradientRangeContrast',
    'ccSampledSoftSeamEnabled',
    'lostEdge',
    'pxlEdge',
    'colorCycleSpeed',
    'gradientBands',
    'colorCycleFillMode',
    'ccGradientDrawingShape',
    'colorCycleStampDitherEnabled',
    'colorCycleStampDitherPixelSize',
    'colorCycleStampDitherPressureLinked',
    'colorCycleStampDitherBgFill',
    'colorCycleStampShape',
  ]);
  const unsupportedKey = Object.keys(value).find((key) => !supportedKeys.has(key));
  if (unsupportedKey) {
    throw new Error(`unsupported brush setting: ${unsupportedKey}`);
  }
  const settings: Extract<VesselCollaborationCommand, { action: 'set-brush' }>['settings'] = {};
  if (value.size !== undefined) {
    settings.size = requireFiniteNumber(value.size, 'settings.size');
    if (settings.size <= 0 || settings.size > 4096) {
      throw new Error('settings.size must be greater than 0 and at most 4096');
    }
  }
  if (value.opacity !== undefined) {
    settings.opacity = requireFiniteNumber(value.opacity, 'settings.opacity');
    if (settings.opacity < 0 || settings.opacity > 1) {
      throw new Error('settings.opacity must be between 0 and 1');
    }
  }
  if (value.spacing !== undefined) {
    settings.spacing = requireFiniteNumber(value.spacing, 'settings.spacing');
    if (settings.spacing <= 0 || settings.spacing > 1000) {
      throw new Error('settings.spacing must be greater than 0 and at most 1000');
    }
  }
  if (value.color !== undefined) {
    settings.color = requireHexColor(value.color, 'settings.color');
  }
  if (value.ditherEnabled !== undefined) {
    settings.ditherEnabled = requireBoolean(value.ditherEnabled, 'settings.ditherEnabled');
  }
  if (value.ditherAlgorithm !== undefined) {
    const algorithm = requireString(value.ditherAlgorithm, 'settings.ditherAlgorithm');
    if (!DITHER_ALGORITHMS.has(algorithm as VesselCollaborationDitherAlgorithm)) {
      throw new Error(`unsupported dither algorithm: ${algorithm}`);
    }
    settings.ditherAlgorithm = algorithm as VesselCollaborationDitherAlgorithm;
  }
  if (value.patternStyle !== undefined) {
    const patternStyle = requireString(value.patternStyle, 'settings.patternStyle');
    if (!PATTERN_STYLES.has(patternStyle as VesselCollaborationPatternStyle)) {
      throw new Error(`unsupported pattern style: ${patternStyle}`);
    }
    settings.patternStyle = patternStyle as VesselCollaborationPatternStyle;
  }
  if (value.fillResolution !== undefined) {
    const resolution = requireFiniteNumber(value.fillResolution, 'settings.fillResolution');
    if (resolution < 1 || resolution > 64) {
      throw new Error('settings.fillResolution must be between 1 and 64');
    }
    settings.fillResolution = Math.round(resolution);
  }
  if (value.pressureLinkedFillResolution !== undefined) {
    settings.pressureLinkedFillResolution = requireBoolean(
      value.pressureLinkedFillResolution,
      'settings.pressureLinkedFillResolution',
    );
  }
  if (value.pressureLinkedFillMaxResolution !== undefined) {
    const maxResolution = requireFiniteNumber(
      value.pressureLinkedFillMaxResolution,
      'settings.pressureLinkedFillMaxResolution',
    );
    if (maxResolution < 1 || maxResolution > 999) {
      throw new Error('settings.pressureLinkedFillMaxResolution must be between 1 and 999');
    }
    settings.pressureLinkedFillMaxResolution = Math.round(maxResolution);
  }
  if (value.ditherBackgroundFill !== undefined) {
    settings.ditherBackgroundFill = requireBoolean(
      value.ditherBackgroundFill,
      'settings.ditherBackgroundFill',
    );
  }
  if (value.ditherGradBgFill !== undefined) {
    settings.ditherGradBgFill = requireBoolean(
      value.ditherGradBgFill,
      'settings.ditherGradBgFill',
    );
  }
  if (value.ccSampledSoftSeamEnabled !== undefined) {
    settings.ccSampledSoftSeamEnabled = requireBoolean(
      value.ccSampledSoftSeamEnabled,
      'settings.ccSampledSoftSeamEnabled',
    );
  }
  if (value.pxlEdge !== undefined) {
    settings.pxlEdge = requireBoolean(value.pxlEdge, 'settings.pxlEdge');
  }
  if (value.colorCycleStampDitherEnabled !== undefined) {
    settings.colorCycleStampDitherEnabled = requireBoolean(
      value.colorCycleStampDitherEnabled,
      'settings.colorCycleStampDitherEnabled',
    );
  }
  if (value.colorCycleStampDitherPressureLinked !== undefined) {
    settings.colorCycleStampDitherPressureLinked = requireBoolean(
      value.colorCycleStampDitherPressureLinked,
      'settings.colorCycleStampDitherPressureLinked',
    );
  }
  if (value.colorCycleStampDitherBgFill !== undefined) {
    settings.colorCycleStampDitherBgFill = requireBoolean(
      value.colorCycleStampDitherBgFill,
      'settings.colorCycleStampDitherBgFill',
    );
  }
  if (value.ditherPaletteSpread !== undefined) {
    settings.ditherPaletteSpread = requireNumberInRange(
      value.ditherPaletteSpread,
      'settings.ditherPaletteSpread',
      0,
      100,
    );
  }
  if (value.ditherPatternDiversity !== undefined) {
    settings.ditherPatternDiversity = requireNumberInRange(
      value.ditherPatternDiversity,
      'settings.ditherPatternDiversity',
      0,
      100,
    );
  }
  if (value.ditherPhaseJitter !== undefined) {
    settings.ditherPhaseJitter = requireNumberInRange(
      value.ditherPhaseJitter,
      'settings.ditherPhaseJitter',
      0,
      100,
    );
  }
  if (value.ccGradientRangeContrast !== undefined) {
    settings.ccGradientRangeContrast = requireNumberInRange(
      value.ccGradientRangeContrast,
      'settings.ccGradientRangeContrast',
      0,
      100,
    );
  }
  if (value.lostEdge !== undefined) {
    settings.lostEdge = requireNumberInRange(value.lostEdge, 'settings.lostEdge', 0, 100);
  }
  if (value.colorCycleSpeed !== undefined) {
    settings.colorCycleSpeed = requireNumberInRange(
      value.colorCycleSpeed,
      'settings.colorCycleSpeed',
      0,
      1.5,
    );
  }
  if (value.gradientBands !== undefined) {
    settings.gradientBands = requireIntegerInRange(
      value.gradientBands,
      'settings.gradientBands',
      1,
      128,
    );
  }
  if (value.colorCycleStampDitherPixelSize !== undefined) {
    settings.colorCycleStampDitherPixelSize = requireIntegerInRange(
      value.colorCycleStampDitherPixelSize,
      'settings.colorCycleStampDitherPixelSize',
      1,
      64,
    );
  }
  if (value.colorCycleFillMode !== undefined) {
    const mode = requireString(value.colorCycleFillMode, 'settings.colorCycleFillMode');
    if (mode !== 'concentric' && mode !== 'linear' && mode !== 'stroke') {
      throw new Error('settings.colorCycleFillMode must be concentric, linear, or stroke');
    }
    settings.colorCycleFillMode = mode;
  }
  if (value.ccGradientDrawingShape !== undefined) {
    const shape = requireString(value.ccGradientDrawingShape, 'settings.ccGradientDrawingShape');
    if (!CC_GRADIENT_DRAWING_SHAPES.has(shape)) {
      throw new Error(`unsupported CC gradient drawing shape: ${shape}`);
    }
    settings.ccGradientDrawingShape = shape as NonNullable<
      typeof settings.ccGradientDrawingShape
    >;
  }
  if (value.colorCycleStampShape !== undefined) {
    const shape = requireString(value.colorCycleStampShape, 'settings.colorCycleStampShape');
    if (!CC_STAMP_SHAPES.has(shape)) {
      throw new Error(`unsupported Color Cycle stamp shape: ${shape}`);
    }
    settings.colorCycleStampShape = shape as NonNullable<typeof settings.colorCycleStampShape>;
  }
  if (Object.keys(settings).length === 0) {
    throw new Error('settings must include at least one supported brush value');
  }
  return settings;
};

const readGradientSource = (
  value: unknown,
  field: string,
): VesselCollaborationGradientSource => {
  if (value !== 'manual' && value !== 'fg' && value !== 'sampled') {
    throw new Error(`${field} must be manual, fg, or sampled`);
  }
  return value;
};

const readPaletteOperation = (
  value: Record<string, unknown>,
): Omit<VesselCollaborationSetPaletteOperation, 'action'> => {
  const foreground = value.foreground === undefined
    ? undefined
    : requireHexColor(value.foreground, 'foreground');
  const background = value.background === undefined
    ? undefined
    : requireHexColor(value.background, 'background');
  const activeSlot = value.activeSlot === undefined
    ? undefined
    : value.activeSlot;
  if (activeSlot !== undefined && activeSlot !== 'foreground' && activeSlot !== 'background') {
    throw new Error('activeSlot must be foreground or background');
  }
  const swap = value.swap === undefined ? undefined : requireBoolean(value.swap, 'swap');
  if (swap && (foreground !== undefined || background !== undefined)) {
    throw new Error('swap cannot be combined with foreground or background');
  }
  if (
    foreground === undefined &&
    background === undefined &&
    activeSlot === undefined &&
    swap !== true
  ) {
    throw new Error('set-palette must change a color, activeSlot, or swap');
  }
  return { foreground, background, activeSlot, swap };
};

const readGradientStops = (value: unknown): VesselCollaborationGradientStop[] => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32) {
    throw new Error('stops must contain between 2 and 32 gradient stops');
  }
  let previousPosition = -1;
  return value.map((stop, index) => {
    if (!isRecord(stop)) {
      throw new Error(`stops[${index}] must be an object`);
    }
    const position = requireNumberInRange(stop.position, `stops[${index}].position`, 0, 1);
    if (position < previousPosition) {
      throw new Error('gradient stop positions must be in ascending order');
    }
    previousPosition = position;
    const opacity = stop.opacity === undefined
      ? undefined
      : requireNumberInRange(stop.opacity, `stops[${index}].opacity`, 0, 1);
    return {
      position,
      color: requireHexColor(stop.color, `stops[${index}].color`),
      opacity,
    };
  });
};

const readGradientOperation = (
  value: Record<string, unknown>,
): Omit<VesselCollaborationSetGradientOperation, 'action'> => {
  const stops = value.stops === undefined ? undefined : readGradientStops(value.stops);
  let foreground: VesselCollaborationSetGradientOperation['foreground'];
  if (value.foreground !== undefined) {
    if (!isRecord(value.foreground)) {
      throw new Error('foreground must be an object');
    }
    const supportedKeys = new Set([
      'lightness',
      'hueShift',
      'saturationShift',
      'opacity',
      'stopCount',
    ]);
    const unsupportedKey = Object.keys(value.foreground).find((key) => !supportedKeys.has(key));
    if (unsupportedKey) {
      throw new Error(`unsupported foreground gradient setting: ${unsupportedKey}`);
    }
    foreground = {
      lightness: value.foreground.lightness === undefined
        ? undefined
        : requireNumberInRange(value.foreground.lightness, 'foreground.lightness', 0, 100),
      hueShift: value.foreground.hueShift === undefined
        ? undefined
        : requireNumberInRange(value.foreground.hueShift, 'foreground.hueShift', -320, 320),
      saturationShift: value.foreground.saturationShift === undefined
        ? undefined
        : requireNumberInRange(
            value.foreground.saturationShift,
            'foreground.saturationShift',
            -45,
            45,
          ),
      opacity: value.foreground.opacity === undefined
        ? undefined
        : requireNumberInRange(value.foreground.opacity, 'foreground.opacity', 0, 100),
      stopCount: value.foreground.stopCount === undefined
        ? undefined
        : requireIntegerInRange(value.foreground.stopCount, 'foreground.stopCount', 2, 6),
    };
    if (Object.values(foreground).every((entry) => entry === undefined)) {
      throw new Error('foreground must include at least one gradient setting');
    }
  }
  const resetSample = value.resetSample === undefined
    ? undefined
    : requireBoolean(value.resetSample, 'resetSample');
  if (stops === undefined && foreground === undefined && resetSample !== true) {
    throw new Error('set-gradient must include stops, foreground settings, or resetSample');
  }
  return { stops, foreground, resetSample };
};

const readEraserSettings = (
  value: unknown,
): VesselCollaborationSetEraserOperation['settings'] => {
  if (!isRecord(value)) {
    throw new Error('settings must be an object');
  }
  const supportedKeys = new Set(['size', 'opacity', 'linkSizeToBrush', 'tip']);
  const unsupportedKey = Object.keys(value).find((key) => !supportedKeys.has(key));
  if (unsupportedKey) {
    throw new Error(`unsupported eraser setting: ${unsupportedKey}`);
  }
  const settings: VesselCollaborationSetEraserOperation['settings'] = {};
  if (value.size !== undefined) {
    settings.size = requireNumberInRange(value.size, 'settings.size', 1, 4096);
  }
  if (value.opacity !== undefined) {
    settings.opacity = requireNumberInRange(value.opacity, 'settings.opacity', 0, 1);
  }
  if (value.linkSizeToBrush !== undefined) {
    settings.linkSizeToBrush = requireBoolean(
      value.linkSizeToBrush,
      'settings.linkSizeToBrush',
    );
  }
  if (value.tip !== undefined) {
    const tip = requireString(value.tip, 'settings.tip');
    if (!ERASER_TIPS.has(tip as VesselCollaborationEraserTip)) {
      throw new Error(`unsupported eraser tip: ${tip}`);
    }
    settings.tip = tip as VesselCollaborationEraserTip;
  }
  if (Object.keys(settings).length === 0) {
    throw new Error('settings must include at least one supported eraser value');
  }
  return settings;
};

const readCaptureOptions = (value: Record<string, unknown>): VesselCollaborationCaptureOptions => {
  const options: VesselCollaborationCaptureOptions = {};
  if (value.runtimeFence !== undefined) {
    if (!isRecord(value.runtimeFence)) {
      throw new Error('runtimeFence must be an object');
    }
    const protocolVersion = requireInteger(
      value.runtimeFence.protocolVersion,
      'runtimeFence.protocolVersion',
    );
    const leaseEpoch = requireInteger(value.runtimeFence.leaseEpoch, 'runtimeFence.leaseEpoch');
    const expectedProjectRevision = value.runtimeFence.expectedProjectRevision === undefined
      ? undefined
      : requireInteger(
          value.runtimeFence.expectedProjectRevision,
          'runtimeFence.expectedProjectRevision',
        );
    const expectedCheckpointId = value.runtimeFence.expectedCheckpointId === undefined
      ? undefined
      : value.runtimeFence.expectedCheckpointId === null
        ? null
        : readOperationIdentifier(
            value.runtimeFence.expectedCheckpointId,
            'runtimeFence.expectedCheckpointId',
          );
    options.runtimeFence = {
      protocolVersion,
      runtimeBuildId: requireString(
        value.runtimeFence.runtimeBuildId,
        'runtimeFence.runtimeBuildId',
      ),
      runtimeInstanceId: requireString(
        value.runtimeFence.runtimeInstanceId,
        'runtimeFence.runtimeInstanceId',
      ),
      leaseEpoch,
      ...(value.runtimeFence.expectedProjectId === undefined
        ? {}
        : {
            expectedProjectId: value.runtimeFence.expectedProjectId === null
              ? null
              : requireString(
                  value.runtimeFence.expectedProjectId,
                  'runtimeFence.expectedProjectId',
                ),
          }),
      ...(expectedProjectRevision === undefined ? {} : { expectedProjectRevision }),
      ...(expectedCheckpointId === undefined ? {} : { expectedCheckpointId }),
    };
  }
  if (value.capture !== undefined) {
    const capture = requireString(value.capture, 'capture');
    if (
      capture !== 'none' &&
      capture !== 'final-thumbnail' &&
      capture !== 'each-thumbnail' &&
      capture !== 'full'
    ) {
      throw new Error('capture must be none, final-thumbnail, each-thumbnail, or full');
    }
    options.capture = capture;
  }
  if (value.thumbnailMaxSize !== undefined) {
    const thumbnailMaxSize = requireInteger(value.thumbnailMaxSize, 'thumbnailMaxSize');
    if (thumbnailMaxSize < 256 || thumbnailMaxSize > 1024) {
      throw new Error('thumbnailMaxSize must be between 256 and 1024');
    }
    options.thumbnailMaxSize = thumbnailMaxSize;
  }
  return options;
};

const readCheckpointName = (value: unknown, field: string) => {
  const name = requireString(value, field).trim();
  if (name.length > 64) {
    throw new Error(`${field} cannot exceed 64 characters`);
  }
  return name;
};

const readCheckpointCapture = (
  value: unknown,
  field: string,
): 'final-thumbnail' | 'full' | undefined => {
  if (value === undefined) return undefined;
  if (value !== 'final-thumbnail' && value !== 'full') {
    throw new Error(`${field} must be final-thumbnail or full`);
  }
  return value;
};

const readCheckpointThumbnailMaxSize = (
  value: unknown,
  field: string,
): number | undefined => {
  if (value === undefined) return undefined;
  const size = requireInteger(value, field);
  if (size < 256 || size > 1024) {
    throw new Error(`${field} must be between 256 and 1024`);
  }
  return size;
};

const readLayerType = (value: unknown, field: string): 'normal' | 'color-cycle' => {
  if (value !== 'normal' && value !== 'color-cycle') {
    throw new Error(`${field} must be normal or color-cycle`);
  }
  return value;
};

const readLayerName = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  const name = requireString(value, field).trim();
  if (name.length > 100) {
    throw new Error(`${field} cannot exceed 100 characters`);
  }
  return name;
};

const readConstructionPhase = (
  value: unknown,
  field: string,
): VesselCollaborationConstructionPhase | undefined => {
  if (value === undefined) return undefined;
  if (value !== 'primary' && value !== 'medium' && value !== 'focal' && value !== 'revision') {
    throw new Error(`${field} must be primary, medium, focal, or revision`);
  }
  return value;
};

const readOperationIdentifier = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  const identifier = requireString(value, field);
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(identifier)) {
    throw new Error(`${field} must use 1-128 letters, numbers, dots, colons, dashes, or underscores`);
  }
  return identifier;
};

const readGestureMetadata = (value: Record<string, unknown>, index: number) => {
  const id = readOperationIdentifier(value.id, `operations[${index}].id`);
  const parentMassId = readOperationIdentifier(
    value.parentMassId,
    `operations[${index}].parentMassId`,
  );
  const sourceRegionId = readOperationIdentifier(
    value.sourceRegionId,
    `operations[${index}].sourceRegionId`,
  );
  const basedOnRevision = value.basedOnRevision === undefined
    ? undefined
    : requireInteger(value.basedOnRevision, `operations[${index}].basedOnRevision`);
  if (basedOnRevision !== undefined && basedOnRevision < 0) {
    throw new Error(`operations[${index}].basedOnRevision must be at least 0`);
  }
  return {
    ...(id === undefined ? {} : { id }),
    ...(basedOnRevision === undefined ? {} : { basedOnRevision }),
    ...(parentMassId === undefined ? {} : { parentMassId }),
    ...(sourceRegionId === undefined ? {} : { sourceRegionId }),
  };
};

const readPriorityCoverage = (
  value: unknown,
): VesselCollaborationPriorityCoverageRequest | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('priorityCoverage must be an object');
  const priorityMaskId = readOperationIdentifier(
    value.priorityMaskId,
    'priorityCoverage.priorityMaskId',
  );
  const priorityMaskFingerprint = readOperationIdentifier(
    value.priorityMaskFingerprint,
    'priorityCoverage.priorityMaskFingerprint',
  );
  if (!priorityMaskId || !priorityMaskFingerprint) {
    throw new Error('priorityCoverage requires mask ID and fingerprint');
  }
  const width = requireInteger(value.width, 'priorityCoverage.width');
  const height = requireInteger(value.height, 'priorityCoverage.height');
  const coverageBaselineRevision = requireInteger(
    value.coverageBaselineRevision,
    'priorityCoverage.coverageBaselineRevision',
  );
  if (width < 1 || height < 1 || coverageBaselineRevision < 0) {
    throw new Error('priorityCoverage dimensions must be positive and its baseline non-negative');
  }
  if (!Array.isArray(value.spans) || value.spans.length === 0) {
    throw new Error('priorityCoverage.spans must contain at least one span');
  }
  const occupied = new Set<number>();
  const spans = value.spans.map((spanValue, index) => {
    if (!isRecord(spanValue)) throw new Error(`priorityCoverage.spans[${index}] must be an object`);
    const y = requireInteger(spanValue.y, `priorityCoverage.spans[${index}].y`);
    const xStart = requireInteger(spanValue.xStart, `priorityCoverage.spans[${index}].xStart`);
    const xEndExclusive = requireInteger(
      spanValue.xEndExclusive,
      `priorityCoverage.spans[${index}].xEndExclusive`,
    );
    if (y < 0 || y >= height || xStart < 0 || xStart >= xEndExclusive || xEndExclusive > width) {
      throw new Error(`priorityCoverage.spans[${index}] is outside the canvas`);
    }
    for (let x = xStart; x < xEndExclusive; x += 1) {
      const pixel = y * width + x;
      if (occupied.has(pixel)) throw new Error('priorityCoverage spans cannot overlap');
      occupied.add(pixel);
      if (occupied.size > MAX_PRIORITY_MASK_PIXELS) {
        throw new Error('priorityCoverage cannot exceed 4000000 pixels');
      }
    }
    return { y, xStart, xEndExclusive };
  });
  return {
    priorityMaskId,
    priorityMaskFingerprint,
    coverageBaselineRevision,
    width,
    height,
    spans,
  };
};

const readBatchOperation = (value: unknown, index: number): VesselCollaborationBatchOperation => {
  if (!isRecord(value)) {
    throw new Error(`operations[${index}] must be an object`);
  }
  const action = requireString(value.action, `operations[${index}].action`);
  switch (action) {
    case 'stroke':
    case 'shape': {
      const pointsPerFrame = readPointsPerFrame(
        value.pointsPerFrame,
        `operations[${index}].pointsPerFrame`,
      );
      const points = action === 'shape'
        ? readShapePoints(value.points, `operations[${index}].points`)
        : readPoints(value.points, `operations[${index}].points`);
      if (action === 'stroke') {
        validateStrokePointBatch(points, pointsPerFrame, `operations[${index}].pointsPerFrame`);
      }
      return {
        action,
        ...readGestureMetadata(value, index),
        points,
        phase: readConstructionPhase(value.phase, `operations[${index}].phase`),
        ...(action === 'stroke'
          ? { tool: value.tool === undefined ? undefined : readTool(value.tool) }
          : {
              direction: value.direction === undefined
                ? undefined
                : readDirectionPoints(value.direction, `operations[${index}].direction`),
            }),
        ...(pointsPerFrame === undefined ? {} : { pointsPerFrame }),
      } as VesselCollaborationBatchOperation;
    }
    case 'set-tool':
      return { action, tool: readTool(value.tool) };
    case 'set-brush-preset':
      return {
        action,
        presetId: requireString(value.presetId, `operations[${index}].presetId`),
      };
    case 'set-brush':
      return { action, settings: readBrushSettings(value.settings) };
    case 'set-palette':
      return { action, ...readPaletteOperation(value) };
    case 'set-gradient-source':
      return {
        action,
        source: readGradientSource(value.source, `operations[${index}].source`),
      };
    case 'set-gradient':
      return { action, ...readGradientOperation(value) };
    case 'set-eraser':
      return { action, settings: readEraserSettings(value.settings) };
    case 'set-active-layer':
      return {
        action,
        layerId: requireString(value.layerId, `operations[${index}].layerId`),
      };
    case 'set-layer-visibility':
      return {
        action,
        layerId: requireString(value.layerId, `operations[${index}].layerId`),
        visible: requireBoolean(value.visible, `operations[${index}].visible`),
      };
    case 'create-layer':
      return {
        action,
        layerType: readLayerType(value.layerType, `operations[${index}].layerType`),
        name: readLayerName(value.name, `operations[${index}].name`),
      };
    case 'checkpoint': {
      const capture = readCheckpointCapture(
        value.capture,
        `operations[${index}].capture`,
      );
      const thumbnailMaxSize = readCheckpointThumbnailMaxSize(
        value.thumbnailMaxSize,
        `operations[${index}].thumbnailMaxSize`,
      );
      return {
        action,
        name: readCheckpointName(value.name, `operations[${index}].name`),
        ...(capture === undefined ? {} : { capture }),
        ...(thumbnailMaxSize === undefined ? {} : { thumbnailMaxSize }),
      };
    }
    default:
      throw new Error(`unsupported batch operation: ${action}`);
  }
};

export const parseVesselCollaborationCommand = (value: unknown): VesselCollaborationCommand => {
  if (!isRecord(value)) {
    throw new Error('command must be an object');
  }
  const id = requireString(value.id, 'id');
  const action = requireString(value.action, 'action');
  const captureOptions = readCaptureOptions(value);

  switch (action) {
    case 'observe':
    case 'undo':
    case 'redo':
      return { id, action, ...captureOptions };
    case 'new-project': {
      const width = requireInteger(value.width, 'width');
      const height = requireInteger(value.height, 'height');
      if (width < 1 || width > 16384 || height < 1 || height > 16384) {
        throw new Error('width and height must be between 1 and 16384');
      }
      return {
        id,
        action,
        width,
        height,
        name: readLayerName(value.name, 'name'),
        ...captureOptions,
      };
    }
    case 'open-project':
      return {
        id,
        action,
        fileName: requireString(value.fileName, 'fileName'),
        dataBase64: readProjectBase64(value.dataBase64),
        ...captureOptions,
      };
    case 'import-reference-image':
      return {
        id,
        action,
        fileName: requireString(value.fileName, 'fileName'),
        mimeType: readImageMimeType(value.mimeType),
        dataBase64: readImageBase64(value.dataBase64),
        fit: readImageFit(value.fit),
        ...captureOptions,
      };
    case 'stroke': {
      const pointsPerFrame = readPointsPerFrame(value.pointsPerFrame, 'pointsPerFrame');
      const points = readPoints(value.points);
      validateStrokePointBatch(points, pointsPerFrame, 'pointsPerFrame');
      return {
        id,
        action,
        points,
        phase: readConstructionPhase(value.phase, 'phase'),
        tool: value.tool === undefined ? undefined : readTool(value.tool),
        ...(pointsPerFrame === undefined ? {} : { pointsPerFrame }),
        ...captureOptions,
      };
    }
    case 'shape': {
      const pointsPerFrame = readPointsPerFrame(value.pointsPerFrame, 'pointsPerFrame');
      return {
        id,
        action,
        points: readShapePoints(value.points, 'points'),
        phase: readConstructionPhase(value.phase, 'phase'),
        direction: value.direction === undefined
          ? undefined
          : readDirectionPoints(value.direction, 'direction'),
        ...(pointsPerFrame === undefined ? {} : { pointsPerFrame }),
        ...captureOptions,
      };
    }
    case 'set-tool':
      return { id, action, tool: readTool(value.tool), ...captureOptions };
    case 'set-brush-preset':
      return {
        id,
        action,
        presetId: requireString(value.presetId, 'presetId'),
        ...captureOptions,
      };
    case 'set-brush':
      return { id, action, settings: readBrushSettings(value.settings), ...captureOptions };
    case 'set-palette':
      return { id, action, ...readPaletteOperation(value), ...captureOptions };
    case 'set-gradient-source':
      return {
        id,
        action,
        source: readGradientSource(value.source, 'source'),
        ...captureOptions,
      };
    case 'set-gradient':
      return { id, action, ...readGradientOperation(value), ...captureOptions };
    case 'set-eraser':
      return {
        id,
        action,
        settings: readEraserSettings(value.settings),
        ...captureOptions,
      };
    case 'create-layer':
      return {
        id,
        action,
        layerType: readLayerType(value.layerType, 'layerType'),
        name: readLayerName(value.name, 'name'),
        ...captureOptions,
      };
    case 'set-layer-visibility':
      return {
        id,
        action,
        layerId: requireString(value.layerId, 'layerId'),
        visible: requireBoolean(value.visible, 'visible'),
        ...captureOptions,
      };
    case 'batch': {
      if (!Array.isArray(value.operations) || value.operations.length === 0) {
        throw new Error('operations must contain at least one operation');
      }
      if (value.operations.length > MAX_BATCH_OPERATIONS) {
        throw new Error(`operations cannot contain more than ${MAX_BATCH_OPERATIONS} operations`);
      }
      const operations = value.operations.map(readBatchOperation);
      const gestureCount = operations.filter(
        (operation) => operation.action === 'stroke' || operation.action === 'shape',
      ).length;
      const checkpointNames = operations
        .filter((operation) => operation.action === 'checkpoint')
        .map((operation) => operation.name);
      if (new Set(checkpointNames).size !== checkpointNames.length) {
        throw new Error('checkpoint names must be unique within a batch');
      }
      const capturedFrameCount = checkpointNames.length + (
        captureOptions.capture === 'each-thumbnail' ? gestureCount : 0
      );
      if (
        captureOptions.capture === 'each-thumbnail' &&
        gestureCount > MAX_CAPTURED_BATCH_FRAMES
      ) {
        throw new Error('each-thumbnail batches cannot contain more than 8 gestures');
      }
      if (capturedFrameCount > MAX_CAPTURED_BATCH_FRAMES) {
        throw new Error('batches cannot return more than 8 checkpoint or gesture thumbnails');
      }
      if (
        captureOptions.capture === 'each-thumbnail' &&
        (captureOptions.thumbnailMaxSize ?? 768) > 768
      ) {
        throw new Error('each-thumbnail batches cannot exceed a 768px thumbnail');
      }
      const pointCount = operations.reduce((total, operation) => {
        if (operation.action === 'stroke') return total + operation.points.length;
        if (operation.action === 'shape') {
          return total + operation.points.length + (operation.direction?.length ?? 0);
        }
        return total;
      }, 0);
      if (pointCount > MAX_BATCH_POINTS) {
        throw new Error(`batch cannot contain more than ${MAX_BATCH_POINTS} points`);
      }
      return { id, action, operations, ...captureOptions };
    }
    case 'artwork-job': {
      if (!Array.isArray(value.operations) || value.operations.length === 0) {
        throw new Error('operations must contain at least one operation');
      }
      if (value.operations.length > MAX_ARTWORK_JOB_OPERATIONS) {
        throw new Error(
          `artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_OPERATIONS} operations`,
        );
      }
      if (captureOptions.capture === 'each-thumbnail') {
        throw new Error('artwork jobs use named checkpoints instead of each-thumbnail capture');
      }
      if (
        typeof captureOptions.runtimeFence?.expectedProjectId !== 'string' ||
        captureOptions.runtimeFence.expectedProjectId.length === 0 ||
        captureOptions.runtimeFence.expectedProjectRevision === undefined ||
        captureOptions.runtimeFence.expectedCheckpointId === undefined
      ) {
        throw new Error('artwork jobs require project, revision, and checkpoint fences');
      }
      const operations = value.operations.map(readBatchOperation);
      const unsupportedOperation = operations.find(
        (operation) =>
          operation.action === 'create-layer' ||
          operation.action === 'set-active-layer' ||
          operation.action === 'set-layer-visibility',
      );
      if (unsupportedOperation) {
        throw new Error(
          `unsupported artwork job operation: ${unsupportedOperation.action}`,
        );
      }
      const unphasedGestureIndex = operations.findIndex(
        (operation) =>
          (operation.action === 'stroke' || operation.action === 'shape') && !operation.phase,
      );
      if (unphasedGestureIndex >= 0) {
        throw new Error(
          `operations[${unphasedGestureIndex}].phase is required for artwork job gestures`,
        );
      }
      const checkpointNames = operations
        .filter((operation) => operation.action === 'checkpoint')
        .map((operation) => operation.name);
      if (checkpointNames.length !== 1 || operations.at(-1)?.action !== 'checkpoint') {
        throw new Error('artwork jobs require exactly one final named checkpoint');
      }
      const pointCount = operations.reduce((total, operation) => {
        if (operation.action === 'stroke') return total + operation.points.length;
        if (operation.action === 'shape') {
          return total + operation.points.length + (operation.direction?.length ?? 0);
        }
        return total;
      }, 0);
      if (pointCount > MAX_ARTWORK_JOB_POINTS) {
        throw new Error(
          `artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_POINTS} points`,
        );
      }
      const priorityCoverage = readPriorityCoverage(value.priorityCoverage);
      return {
        id,
        action,
        operations,
        ...captureOptions,
        ...(priorityCoverage ? { priorityCoverage } : {}),
      } as Extract<
        VesselCollaborationCommand,
        { action: 'artwork-job' }
      >;
    }
    case 'wait-for-frame': {
      const afterRevision = requireInteger(value.afterRevision, 'afterRevision');
      if (afterRevision < 0) {
        throw new Error('afterRevision must be at least 0');
      }
      const timeoutMs = value.timeoutMs === undefined
        ? undefined
        : requireInteger(value.timeoutMs, 'timeoutMs');
      if (timeoutMs !== undefined && (timeoutMs < 100 || timeoutMs > 30000)) {
        throw new Error('timeoutMs must be between 100 and 30000');
      }
      return { id, action, afterRevision, timeoutMs, ...captureOptions };
    }
    case 'set-active-layer':
      return {
        id,
        action,
        layerId: requireString(value.layerId, 'layerId'),
        ...captureOptions,
      };
    case 'save':
      return {
        id,
        action,
        filename: value.filename === undefined ? undefined : requireString(value.filename, 'filename'),
        ...captureOptions,
      };
    default:
      throw new Error(`unsupported action: ${action}`);
  }
};
