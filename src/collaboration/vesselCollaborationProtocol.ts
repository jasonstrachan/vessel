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
}

type VesselCollaborationDitherAlgorithm =
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

interface VesselCollaborationStrokeOperation {
  action: 'stroke';
  points: VesselCollaborationPoint[];
  tool?: 'brush' | 'eraser';
  pointsPerFrame?: number;
}

interface VesselCollaborationShapeOperation {
  action: 'shape';
  points: VesselCollaborationPoint[];
  direction?: VesselCollaborationPoint[];
  pointsPerFrame?: number;
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
    fillResolution?: number;
    pressureLinkedFillResolution?: boolean;
    pressureLinkedFillMaxResolution?: number;
  };
}

export type VesselCollaborationBatchOperation =
  | VesselCollaborationStrokeOperation
  | VesselCollaborationShapeOperation
  | { action: 'set-tool'; tool: 'brush' | 'eraser' }
  | { action: 'set-brush-preset'; presetId: string }
  | VesselCollaborationSetBrushOperation
  | { action: 'set-active-layer'; layerId: string };

type WithCaptureOptions<T> = T & VesselCollaborationCaptureOptions;

export type VesselCollaborationCommand =
  | WithCaptureOptions<{ id: string; action: 'observe' }>
  | WithCaptureOptions<{ id: string; action: 'open-project'; fileName: string; dataBase64: string }>
  | WithCaptureOptions<{ id: string } & VesselCollaborationStrokeOperation>
  | WithCaptureOptions<{ id: string } & VesselCollaborationShapeOperation>
  | WithCaptureOptions<{ id: string; action: 'set-tool'; tool: 'brush' | 'eraser' }>
  | WithCaptureOptions<{ id: string; action: 'set-brush-preset'; presetId: string }>
  | WithCaptureOptions<{ id: string } & VesselCollaborationSetBrushOperation>
  | {
      id: string;
      action: 'batch';
      operations: VesselCollaborationBatchOperation[];
      capture?: VesselCollaborationCapturePolicy;
      thumbnailMaxSize?: number;
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

export interface VesselCollaborationProfile {
  mutationMs: number;
  presentationMs: number;
  captureMs: number;
  totalMs: number;
  operations?: Array<{
    index: number;
    action: VesselCollaborationBatchOperation['action'];
    mutationMs: number;
    revision: number;
  }>;
}

export interface VesselCollaborationResult {
  ok: boolean;
  commandId: string;
  action: VesselCollaborationCommand['action'];
  revision: number;
  state?: {
    project: { id: string; name: string; width: number; height: number } | null;
    activeLayerId: string | null;
    currentTool: string;
    currentBrushPresetId: string | null;
    brush: {
      size: number;
      opacity: number;
      color: string;
      spacing: number;
      shapeEnabled: boolean;
      ditherEnabled: boolean;
      ditherAlgorithm: string | null;
      fillResolution: number | null;
      pressureLinkedFillResolution: boolean;
      pressureLinkedFillMaxResolution: number | null;
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
    frame: VesselCollaborationFrame;
  }>;
  profile?: VesselCollaborationProfile;
  completedOperations?: number;
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

const MAX_PROJECT_BASE64_CHARS = 24 * 1024 * 1024;
const MAX_BATCH_OPERATIONS = 100;
const MAX_BATCH_POINTS = 50000;
const MAX_COALESCED_STROKE_POINTS = 16;
const MAX_CAPTURED_BATCH_GESTURES = 8;

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
    'fillResolution',
    'pressureLinkedFillResolution',
    'pressureLinkedFillMaxResolution',
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
    const color = requireString(value.color, 'settings.color');
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error('settings.color must be a six-digit hex color');
    }
    settings.color = color;
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
  if (Object.keys(settings).length === 0) {
    throw new Error('settings must include at least one supported brush value');
  }
  return settings;
};

const readCaptureOptions = (value: Record<string, unknown>): VesselCollaborationCaptureOptions => {
  const options: VesselCollaborationCaptureOptions = {};
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
        points,
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
    case 'set-active-layer':
      return {
        action,
        layerId: requireString(value.layerId, `operations[${index}].layerId`),
      };
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
    case 'open-project':
      return {
        id,
        action,
        fileName: requireString(value.fileName, 'fileName'),
        dataBase64: readProjectBase64(value.dataBase64),
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
      if (
        captureOptions.capture === 'each-thumbnail' &&
        gestureCount > MAX_CAPTURED_BATCH_GESTURES
      ) {
        throw new Error('each-thumbnail batches cannot contain more than 8 gestures');
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
