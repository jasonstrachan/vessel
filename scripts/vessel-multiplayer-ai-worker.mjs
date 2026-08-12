import crypto from 'node:crypto';

import sharp from 'sharp';

const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_WARM_TIMEOUT_MS = 60_000;
const OLLAMA_CONTEXT_WINDOW = 4096;
const MAX_DECISION_TOKENS = 160;
const RESPONSE_POINT_COUNT = 24;
const MAX_INTENT_LENGTH = 160;
const MAX_DECISION_MEMORY = 8;
const MAX_TRACKED_GESTURES = 256;
const NOVELTY_MEMORY_WINDOW = 6;
const MAX_NOVELTY_REPLANS = 1;
const TARGET_CORRIDOR_DISTANCE = 0.055;
const TARGET_MIDPOINT_DISTANCE = 0.18;
const TARGET_PARALLEL_COSINE = Math.cos(Math.PI / 10);

const RELATIONSHIPS = ['echo', 'counterbalance', 'connect', 'interrupt', 'deepen'];
const ENERGIES = ['restrained', 'wandering', 'insistent'];
const REGULAR_LAYER_BRUSHES = ['current-stroke'];
const COLOR_CYCLE_LAYER_BRUSHES = [
  'color-cycle-stroke',
  'color-cycle-shape',
  'color-cycle-flat-dither',
];

const VISION_WARMUP_SVG = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="384" height="384">
    <rect width="384" height="384" fill="#f0f0f0"/>
    <rect width="192" height="192" fill="#202020"/>
    <rect x="192" y="192" width="192" height="192" fill="#202020"/>
  </svg>
`);
let visionWarmupImagePromise = null;
const getVisionWarmupImageBase64 = () => {
  visionWarmupImagePromise ??= sharp(VISION_WARMUP_SVG)
    .png()
    .toBuffer()
    .then((buffer) => buffer.toString('base64'));
  return visionWarmupImagePromise;
};

const availableBrushesForDecision = (layerType, memory) => {
  if (layerType !== 'color-cycle') return REGULAR_LAYER_BRUSHES;
  const lastBrush = memory.at(-1)?.brush;
  const repeatedBrush = lastBrush && memory.at(-2)?.brush === lastBrush ? lastBrush : null;
  return repeatedBrush
    ? COLOR_CYCLE_LAYER_BRUSHES.filter((brush) => brush !== repeatedBrush)
    : COLOR_CYCLE_LAYER_BRUSHES;
};

const responseSchemaForLayer = (layerType, memory = []) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    brush: {
      type: 'string',
      enum: availableBrushesForDecision(layerType, memory),
    },
    relationship: { type: 'string', enum: RELATIONSHIPS },
    intent: { type: 'string' },
    targetStart: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number', minimum: 0, maximum: 1 },
    },
    targetEnd: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number', minimum: 0, maximum: 1 },
    },
    energy: { type: 'string', enum: ENERGIES },
    reverse: { type: 'boolean' },
    pressureScale: { type: 'number', minimum: 0.6, maximum: 1.2 },
    shapeFill: { type: 'string', enum: ['linear', 'concentric'] },
  },
  required: [
    'brush',
    'relationship',
    'intent',
    'targetStart',
    'targetEnd',
    'energy',
    'reverse',
    'pressureScale',
    'shapeFill',
  ],
});

const DEFAULT_BRIEF = [
  'You are painting live alongside Jason in Vessel.',
  'Study the whole current canvas and Jason\'s latest live or completed gesture.',
  'Look, hold the relationship in memory, then decide exactly one response that develops something specific already present.',
  'Choose relationship echo, counterbalance, connect, interrupt, or deepen. These are real construction modes: echo carries the gesture beside a related edge; counterbalance answers its weight elsewhere; connect joins two specific visible events; interrupt crosses a dominant direction; deepen stays near a particular nested edge or mass.',
  'Return targetStart and targetEnd as normalized canvas coordinates. They must identify two distinct observed locations and define the real direction and extent of the response.',
  'Choose energy restrained, wandering, or insistent, whether to reverse Jason\'s measured gesture rhythm, and pressureScale from 0.6 to 1.2.',
  'Choose exactly one available brush. Current Stroke preserves the regular brush already selected for the session. Color Cycle Stroke is a moving linear contour. Color Cycle Shape is a solid bounded animated field. Color Cycle Flat Dither is a bounded linear field with stable Sierra Lite texture and moving colour.',
  'Choose shapeFill linear for a directional plane or passage and concentric only for a source, body, portal, or genuinely radiating mass. shapeFill is ignored for strokes.',
  'Use a shape brush for a particular observed mass or bounded area, not merely because a shape tool is available. Keep its contour responsive, irregular, and tied to real turns already visible on the canvas.',
  'Preserve every existing mark. Do not trace, decorate empty space generically, write text, sign the work, or try to finish the painting.',
  'The runtime composes a new gesture from Jason\'s measured curvature and pressure while applying your observed relationship; do not request random jitter.',
  'Recent AI responses are hypotheses for continuity, not style rules. Choose a visibly different target corridor when a recent response already occupies the same region and direction; the runtime rejects near-parallel overlapping targets before paint.',
  'Return only JSON matching the supplied schema. Coordinates are normalized from 0 to 1 across the full canvas.',
].join(' ');

const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const requirePositiveDimension = (value, label) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return value;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const pointToSegmentDistance = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const progress = clamp(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    0,
    1,
  );
  return distance(point, [start[0] + dx * progress, start[1] + dy * progress]);
};

const sampleSegment = (start, end) => [0, 0.25, 0.5, 0.75, 1].map((progress) => [
  start[0] + (end[0] - start[0]) * progress,
  start[1] + (end[1] - start[1]) * progress,
]);

const targetCorridorsRepeat = (candidate, previous) => {
  const candidateLength = distance(candidate.targetStart, candidate.targetEnd);
  const previousLength = distance(previous.targetStart, previous.targetEnd);
  if (candidateLength === 0 || previousLength === 0) return false;
  const candidateDirection = [
    (candidate.targetEnd[0] - candidate.targetStart[0]) / candidateLength,
    (candidate.targetEnd[1] - candidate.targetStart[1]) / candidateLength,
  ];
  const previousDirection = [
    (previous.targetEnd[0] - previous.targetStart[0]) / previousLength,
    (previous.targetEnd[1] - previous.targetStart[1]) / previousLength,
  ];
  const parallel = Math.abs(
    candidateDirection[0] * previousDirection[0] +
    candidateDirection[1] * previousDirection[1],
  ) >= TARGET_PARALLEL_COSINE;
  if (!parallel) return false;

  const midpointDistance = distance([
    (candidate.targetStart[0] + candidate.targetEnd[0]) / 2,
    (candidate.targetStart[1] + candidate.targetEnd[1]) / 2,
  ], [
    (previous.targetStart[0] + previous.targetEnd[0]) / 2,
    (previous.targetStart[1] + previous.targetEnd[1]) / 2,
  ]);
  if (midpointDistance > TARGET_MIDPOINT_DISTANCE) return false;

  const candidateSamples = sampleSegment(candidate.targetStart, candidate.targetEnd);
  const previousSamples = sampleSegment(previous.targetStart, previous.targetEnd);
  const symmetricCorridorDistance = (
    candidateSamples.reduce((sum, point) => (
      sum + pointToSegmentDistance(point, previous.targetStart, previous.targetEnd)
    ), 0) +
    previousSamples.reduce((sum, point) => (
      sum + pointToSegmentDistance(point, candidate.targetStart, candidate.targetEnd)
    ), 0)
  ) / (candidateSamples.length + previousSamples.length);
  return symmetricCorridorDistance <= TARGET_CORRIDOR_DISTANCE;
};

const findRepeatedTarget = (decision, memory) => memory
  .slice(-NOVELTY_MEMORY_WINDOW)
  .reverse()
  .find((previous) => targetCorridorsRepeat(decision, previous)) ?? null;

const readCanvasPath = (value, width, height) => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) {
    throw new Error('Human gesture path must contain 2 to 64 sampled points');
  }
  return value.map((point, index) => {
    if (!isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        (point.pressure !== undefined && !Number.isFinite(point.pressure))) {
      throw new Error(`Human gesture path point ${index + 1} is invalid`);
    }
    return {
      x: clamp(point.x, 0, Math.max(0, width - 1)),
      y: clamp(point.y, 0, Math.max(0, height - 1)),
      pressure: clamp(Number.isFinite(point.pressure) ? point.pressure : 0.5, 0.1, 1),
    };
  });
};

const resamplePath = (points, count) => {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    ));
  }
  const totalLength = cumulative.at(-1);
  if (!Number.isFinite(totalLength) || totalLength < 1) {
    throw new Error('Human gesture path is too short for an AI response');
  }
  const result = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const target = totalLength * index / Math.max(1, count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const start = points[segment - 1];
    const end = points[segment];
    const span = cumulative[segment] - cumulative[segment - 1];
    const t = span <= 0 ? 0 : (target - cumulative[segment - 1]) / span;
    result.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      pressure: start.pressure + (end.pressure - start.pressure) * t,
    });
  }
  return result;
};

export const readVesselMultiplayerAiDecision = (
  value,
  { width, height, humanPath, layerType, availableBrushes: allowedBrushes },
) => {
  const canvasWidth = requirePositiveDimension(width, 'Canvas width');
  const canvasHeight = requirePositiveDimension(height, 'Canvas height');
  const availableBrushes = allowedBrushes ?? (layerType === 'color-cycle'
    ? COLOR_CYCLE_LAYER_BRUSHES
    : layerType === 'normal' ? REGULAR_LAYER_BRUSHES : []);
  const validTarget = (target) => Array.isArray(target) && target.length === 2 &&
    target.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
  if (!isObject(value) || !availableBrushes.includes(value.brush) ||
      !RELATIONSHIPS.includes(value.relationship) ||
      typeof value.intent !== 'string' || !validTarget(value.targetStart) ||
      !validTarget(value.targetEnd) || !ENERGIES.includes(value.energy) ||
      typeof value.reverse !== 'boolean' ||
      !['linear', 'concentric'].includes(value.shapeFill) ||
      !Number.isFinite(value.pressureScale) ||
      value.pressureScale < 0.6 || value.pressureScale > 1.2) {
    throw new Error('AI response must contain a valid artistic gesture decision');
  }
  const intent = value.intent.trim();
  if (!intent || intent.length > MAX_INTENT_LENGTH) {
    throw new Error(`AI response intent must contain 1 to ${MAX_INTENT_LENGTH} characters`);
  }
  const sampled = resamplePath(
    readCanvasPath(humanPath, canvasWidth, canvasHeight),
    RESPONSE_POINT_COUNT,
  );
  if (value.reverse) sampled.reverse();
  let sourceStart = sampled[0];
  let sourceEnd = sampled.at(-1);
  let sourceLength = Math.hypot(sourceEnd.x - sourceStart.x, sourceEnd.y - sourceStart.y);
  if (sourceLength < 1) {
    for (let startIndex = 0; startIndex < sampled.length - 1; startIndex += 1) {
      for (let endIndex = startIndex + 1; endIndex < sampled.length; endIndex += 1) {
        const candidateLength = Math.hypot(
          sampled[endIndex].x - sampled[startIndex].x,
          sampled[endIndex].y - sampled[startIndex].y,
        );
        if (candidateLength > sourceLength) {
          sourceStart = sampled[startIndex];
          sourceEnd = sampled[endIndex];
          sourceLength = candidateLength;
        }
      }
    }
  }
  if (sourceLength < 1) throw new Error('Human gesture path is too short for an AI response');
  const sourceDx = sourceEnd.x - sourceStart.x;
  const sourceDy = sourceEnd.y - sourceStart.y;
  const sourceUnit = { x: sourceDx / sourceLength, y: sourceDy / sourceLength };
  const sourceNormal = { x: -sourceUnit.y, y: sourceUnit.x };

  const targetStart = {
    x: value.targetStart[0] * Math.max(0, canvasWidth - 1),
    y: value.targetStart[1] * Math.max(0, canvasHeight - 1),
  };
  const targetEnd = {
    x: value.targetEnd[0] * Math.max(0, canvasWidth - 1),
    y: value.targetEnd[1] * Math.max(0, canvasHeight - 1),
  };
  const targetDx = targetEnd.x - targetStart.x;
  const targetDy = targetEnd.y - targetStart.y;
  const targetLength = Math.hypot(targetDx, targetDy);
  if (targetLength < 2) throw new Error('AI response target endpoints must be distinct');
  const targetUnit = { x: targetDx / targetLength, y: targetDy / targetLength };
  const targetNormal = { x: -targetUnit.y, y: targetUnit.x };

  const relationshipProfile = {
    echo: { along: 0.75, across: 1 },
    counterbalance: { along: 0.55, across: -1.15 },
    connect: { along: 0.2, across: 0.42 },
    interrupt: { along: 0.12, across: 1.45 },
    deepen: { along: 0.4, across: 0.72 },
  }[value.relationship];
  const energyProfile = {
    restrained: { deviation: 0.65, pressure: 0.92 },
    wandering: { deviation: 1.3, pressure: 0.96 },
    insistent: { deviation: 0.9, pressure: 1.08 },
  }[value.energy];

  let points = sampled.map((point, index) => {
    const progress = index / Math.max(1, sampled.length - 1);
    const sourceBase = {
      x: sourceStart.x + sourceDx * progress,
      y: sourceStart.y + sourceDy * progress,
    };
    const relative = { x: point.x - sourceBase.x, y: point.y - sourceBase.y };
    const alongDeviation = (
      relative.x * sourceUnit.x + relative.y * sourceUnit.y
    ) / sourceLength;
    const acrossDeviation = (
      relative.x * sourceNormal.x + relative.y * sourceNormal.y
    ) / sourceLength;
    const targetBase = {
      x: targetStart.x + targetDx * progress,
      y: targetStart.y + targetDy * progress,
    };
    const taper = Math.sin(Math.PI * progress);
    const deviationScale = targetLength * energyProfile.deviation * taper;
    return {
      x: targetBase.x + targetUnit.x * alongDeviation * deviationScale * relationshipProfile.along +
        targetNormal.x * acrossDeviation * deviationScale * relationshipProfile.across,
      y: targetBase.y + targetUnit.y * alongDeviation * deviationScale * relationshipProfile.along +
        targetNormal.y * acrossDeviation * deviationScale * relationshipProfile.across,
      pressure: clamp(
        point.pressure * value.pressureScale * energyProfile.pressure,
        0.1,
        1,
      ),
    };
  });
  const pointBounds = () => ({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  });
  let bounds = pointBounds();
  const fit = Math.min(
    1,
    (canvasWidth - 1) / Math.max(1, bounds.maxX - bounds.minX),
    (canvasHeight - 1) / Math.max(1, bounds.maxY - bounds.minY),
  );
  if (fit < 1) {
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    points = points.map((point) => ({
      ...point,
      x: center.x + (point.x - center.x) * fit,
      y: center.y + (point.y - center.y) * fit,
    }));
    bounds = pointBounds();
  }
  const shiftX = bounds.minX < 0
    ? -bounds.minX
    : bounds.maxX >= canvasWidth ? canvasWidth - 1 - bounds.maxX : 0;
  const shiftY = bounds.minY < 0
    ? -bounds.minY
    : bounds.maxY >= canvasHeight ? canvasHeight - 1 - bounds.maxY : 0;
  points = points.map((point) => ({
    ...point,
    x: point.x + shiftX,
    y: point.y + shiftY,
  }));
  let pathLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    pathLength += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  const diagonal = Math.hypot(canvasWidth, canvasHeight);
  if (pathLength < 1 || pathLength > diagonal * 2.5) {
    throw new Error('AI response path length is outside the multiplayer safety limit');
  }
  return {
    brush: value.brush,
    relationship: value.relationship,
    intent,
    energy: value.energy,
    shapeFill: value.shapeFill,
    targetStart: [...value.targetStart],
    targetEnd: [...value.targetEnd],
    points,
  };
};

const readFrameBase64 = (frame) => {
  if (!isObject(frame) || typeof frame.frameId !== 'string' ||
      typeof frame.sessionId !== 'string' || typeof frame.projectId !== 'string' ||
      !Number.isInteger(frame.projectRevision) || !Number.isFinite(frame.capturedAt) ||
      !['normal', 'color-cycle'].includes(frame.aiLayerType)) {
    throw new Error('Vessel multiplayer frame metadata is invalid');
  }
  const width = requirePositiveDimension(frame.sourceWidth, 'Canvas width');
  const height = requirePositiveDimension(frame.sourceHeight, 'Canvas height');
  if (!Buffer.isBuffer(frame.imageBuffer) || frame.imageBuffer.length === 0 ||
      !['image/png', 'image/webp'].includes(frame.mimeType)) {
    throw new Error('Vessel multiplayer frame must contain a PNG or WebP image');
  }
  return {
    width,
    height,
    layerType: frame.aiLayerType,
    imageBase64: frame.imageBuffer.toString('base64'),
  };
};

const speedForEnergy = (energy, brush) => {
  if (brush === 'color-cycle-stroke') {
    return { restrained: 0.01, wandering: 0.02, insistent: 0.04 }[energy];
  }
  return { restrained: 0.01, wandering: 0.02, insistent: 0.06 }[energy];
};

const detailForEnergy = (energy) => ({ restrained: 3, wandering: 2, insistent: 1 })[energy];

const buildGestureBrush = (decision, { width, height, layerType }) => {
  if (layerType === 'normal') {
    return {
      kind: 'stroke',
      brushPresetId: undefined,
      settings: undefined,
      direction: undefined,
    };
  }
  const direction = [
    {
      x: decision.targetStart[0] * Math.max(0, width - 1),
      y: decision.targetStart[1] * Math.max(0, height - 1),
    },
    {
      x: decision.targetEnd[0] * Math.max(0, width - 1),
      y: decision.targetEnd[1] * Math.max(0, height - 1),
    },
  ];
  const speed = speedForEnergy(decision.energy, decision.brush);
  const detail = detailForEnergy(decision.energy);
  if (decision.brush === 'color-cycle-stroke') {
    return {
      kind: 'stroke',
      brushPresetId: decision.brush,
      direction: undefined,
      settings: {
        size: Math.max(1, 4 * Math.min(width, height) / 512),
        colorCycleSpeed: speed,
        colorCycleStampDitherPixelSize: detail,
      },
    };
  }
  if (decision.brush === 'color-cycle-flat-dither') {
    return {
      kind: 'shape',
      brushPresetId: decision.brush,
      direction,
      settings: {
        colorCycleSpeed: speed,
        fillResolution: detail,
      },
    };
  }
  return {
    kind: 'shape',
    brushPresetId: decision.brush,
    direction: decision.shapeFill === 'linear' ? direction : undefined,
    settings: {
      colorCycleSpeed: speed,
      ditherEnabled: false,
      colorCycleFillMode: decision.shapeFill,
    },
  };
};

const requestAiDecision = async ({
  event,
  fetchImpl,
  frame,
  memory,
  model,
  brief,
  rejectedDecision,
  signal,
  url,
}) => {
  const image = readFrameBase64(frame);
  const responseSchema = responseSchemaForLayer(image.layerType, memory);
  const context = JSON.stringify({
    canvas: {
      width: image.width,
      height: image.height,
      aiLayerType: image.layerType,
      availableBrushes: responseSchema.properties.brush.enum,
    },
    latestHumanGesture: {
      phase: event.phase,
      tool: event.tool,
      shapeMode: event.shapeMode,
      pointCount: event.pointCount,
      latestPoint: event.point,
      bounds: event.bounds,
      committed: event.committed,
      pathSample: event.path.filter((_, index) => (
        index === 0 || index === event.path.length - 1 ||
        index % Math.max(1, Math.ceil(event.path.length / 10)) === 0
      )).slice(0, 12),
    },
    recentAiResponses: memory,
    ...(rejectedDecision ? {
      rejectedCandidate: {
        reason: 'This target overlaps a recent AI corridor and would repeat an existing response.',
        targetStart: rejectedDecision.targetStart,
        targetEnd: rejectedDecision.targetEnd,
        relationship: rejectedDecision.relationship,
        instruction: 'Select two different observed locations whose corridor does not overlap any recent AI response.',
      },
    } : {}),
  });
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: `${brief}\nCurrent gesture context: ${context}\nJSON schema: ${JSON.stringify(responseSchema)}`,
        images: [image.imageBase64],
      }],
      format: responseSchema,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: {
        temperature: 0.28,
        num_ctx: OLLAMA_CONTEXT_WINDOW,
        num_predict: MAX_DECISION_TOKENS,
      },
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Local Ollama request failed (${response.status})`);
  }
  const payload = await response.json();
  if (typeof payload?.message?.content !== 'string' || !payload.message.content.trim()) {
    throw new Error('Local vision model returned no multiplayer decision');
  }
  return readVesselMultiplayerAiDecision(
    JSON.parse(payload.message.content),
    {
      width: image.width,
      height: image.height,
      humanPath: event.path,
      layerType: image.layerType,
      availableBrushes: responseSchema.properties.brush.enum,
    },
  );
};

export const createVesselMultiplayerAiWorker = ({
  client,
  model = 'qwen2.5vl:3b',
  fetchImpl = fetch,
  url = OLLAMA_CHAT_URL,
  brief = DEFAULT_BRIEF,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  warmTimeoutMs = DEFAULT_WARM_TIMEOUT_MS,
  onStatus,
}) => {
  if (!client || typeof client.send !== 'function') {
    throw new Error('A Vessel collaboration bridge client is required for multiplayer AI');
  }
  if (typeof model !== 'string' || !/^[a-z0-9][a-z0-9._:/-]{0,127}$/i.test(model)) {
    throw new Error('A valid local Ollama model name is required for multiplayer AI');
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 120_000) {
    throw new Error('AI request timeout must be between 1000 and 120000 milliseconds');
  }
  if (!Number.isInteger(warmTimeoutMs) || warmTimeoutMs < 1000 || warmTimeoutMs > 120_000) {
    throw new Error('AI warmup timeout must be between 1000 and 120000 milliseconds');
  }

  let latestFrame = null;
  let observationContext = null;
  let observationContextAt = 0;
  let pendingLiveGestureId = null;
  let drainPromise = null;
  let drainRequested = false;
  let warmPromise = null;
  let stopped = false;
  let responseAbortController = null;
  let activeInferenceFrame = null;
  let warmAbortController = null;
  const humanGestures = new Map();
  const framesByGesture = new Map();
  const trackedGestureIds = new Set();
  const trackedGestureOrder = [];
  const completedGestureIds = [];
  const completedGestureSet = new Set();
  const respondedGestureIds = new Set();
  const respondedGestureOrder = [];
  const retriedCompletedGestureIds = new Set();
  const decisionMemory = [];
  let status = {
    enabled: true,
    model,
    state: 'watching',
    sessionId: null,
    lastFrameAt: null,
    lastError: null,
    lastIntent: null,
    lastRelationship: null,
    lastInferenceMs: null,
    lastDispatchMs: null,
    lastTotalMs: null,
    lastSkippedReason: null,
  };

  const publishStatus = (updates) => {
    status = { ...status, ...updates };
    onStatus?.({ ...status });
  };

  const forgetGesture = (gestureId) => {
    humanGestures.delete(gestureId);
    framesByGesture.delete(gestureId);
    completedGestureSet.delete(gestureId);
    if (pendingLiveGestureId === gestureId) pendingLiveGestureId = null;
  };

  const resetObservationContext = (observation) => {
    const nextContext = `${observation.sessionId}\u0000${observation.projectId}`;
    const observedAt = Number.isFinite(observation.capturedAt)
      ? observation.capturedAt
      : Number.isFinite(observation.occurredAt) ? observation.occurredAt : 0;
    if (observationContext === nextContext) {
      observationContextAt = Math.max(observationContextAt, observedAt);
      return true;
    }
    if (observationContext && observedAt < observationContextAt) return false;
    observationContext = nextContext;
    observationContextAt = observedAt;
    pendingLiveGestureId = null;
    humanGestures.clear();
    framesByGesture.clear();
    trackedGestureIds.clear();
    trackedGestureOrder.length = 0;
    completedGestureIds.length = 0;
    completedGestureSet.clear();
    respondedGestureIds.clear();
    respondedGestureOrder.length = 0;
    retriedCompletedGestureIds.clear();
    decisionMemory.length = 0;
    publishStatus({
      sessionId: observation.sessionId,
      lastIntent: null,
      lastRelationship: null,
      lastSkippedReason: null,
    });
    return true;
  };

  const trackGesture = (gestureId) => {
    if (trackedGestureIds.has(gestureId)) return;
    trackedGestureIds.add(gestureId);
    trackedGestureOrder.push(gestureId);
    while (trackedGestureOrder.length > MAX_TRACKED_GESTURES) {
      const oldest = trackedGestureOrder.shift();
      trackedGestureIds.delete(oldest);
      if (oldest !== activeInferenceFrame?.gestureId) forgetGesture(oldest);
    }
  };

  const markGestureResponded = (gestureId) => {
    respondedGestureIds.add(gestureId);
    retriedCompletedGestureIds.delete(gestureId);
    respondedGestureOrder.push(gestureId);
    if (respondedGestureOrder.length > MAX_TRACKED_GESTURES) {
      respondedGestureIds.delete(respondedGestureOrder.shift());
    }
  };

  const frameAndEventMatch = (frame, event) => Boolean(
    frame && event && frame.gestureId && frame.gestureId === event.gestureId &&
    frame.sessionId === event.sessionId && frame.projectId === event.projectId &&
    frame.capturedAt >= event.occurredAt && frame.gesturePointCount >= 2 &&
    (frame.gesturePhase !== 'end' || (event.phase === 'end' && event.committed === true)),
  );

  const queueFrame = (frame) => {
    if (!frame.gestureId || respondedGestureIds.has(frame.gestureId)) return;
    trackGesture(frame.gestureId);
    framesByGesture.set(frame.gestureId, frame);
    if (frame.gesturePhase === 'end') {
      if (!completedGestureSet.has(frame.gestureId)) {
        while (completedGestureIds.length > 0) {
          const supersededGestureId = completedGestureIds.shift();
          if (supersededGestureId === frame.gestureId) continue;
          markGestureResponded(supersededGestureId);
          forgetGesture(supersededGestureId);
        }
        completedGestureSet.add(frame.gestureId);
        completedGestureIds.push(frame.gestureId);
      }
      if (pendingLiveGestureId === frame.gestureId) pendingLiveGestureId = null;
    } else if (frame.gesturePhase === 'move' && !completedGestureSet.has(frame.gestureId)) {
      pendingLiveGestureId = frame.gestureId;
    }
  };

  const takePending = () => {
    while (completedGestureIds.length > 0) {
      const gestureId = completedGestureIds[0];
      if (respondedGestureIds.has(gestureId) || !completedGestureSet.has(gestureId)) {
        completedGestureIds.shift();
        forgetGesture(gestureId);
        continue;
      }
      const frame = framesByGesture.get(gestureId);
      const event = humanGestures.get(gestureId);
      if (!frameAndEventMatch(frame, event)) return null;
      completedGestureIds.shift();
      completedGestureSet.delete(gestureId);
      return { frame, event };
    }
    if (!pendingLiveGestureId) return null;
    const gestureId = pendingLiveGestureId;
    const frame = framesByGesture.get(gestureId);
    const event = humanGestures.get(gestureId);
    if (!frameAndEventMatch(frame, event)) return null;
    pendingLiveGestureId = null;
    return { frame, event };
  };

  const drain = async () => {
    while (!stopped) {
      const pending = takePending();
      if (!pending) return;
      const { frame, event } = pending;
      if (warmPromise) await warmPromise;
      publishStatus({ state: 'thinking', sessionId: event.sessionId, lastError: null });
      const abortController = new AbortController();
      responseAbortController = abortController;
      activeInferenceFrame = frame;
      const timeout = setTimeout(() => abortController.abort(
        new Error(`Local AI response timed out after ${requestTimeoutMs} milliseconds`),
      ), requestTimeoutMs);
      const responseStartedAt = Date.now();
      try {
        let decision = await requestAiDecision({
          event,
          fetchImpl,
          frame,
          memory: decisionMemory,
          model,
          brief,
          signal: abortController.signal,
          url,
        });
        let repeatedTarget = findRepeatedTarget(decision, decisionMemory);
        for (let attempt = 0; repeatedTarget && attempt < MAX_NOVELTY_REPLANS; attempt += 1) {
          decision = await requestAiDecision({
            event,
            fetchImpl,
            frame,
            memory: decisionMemory,
            model,
            brief,
            rejectedDecision: decision,
            signal: abortController.signal,
            url,
          });
          repeatedTarget = findRepeatedTarget(decision, decisionMemory);
        }
        const inferenceMs = Date.now() - responseStartedAt;
        if (stopped) return;
        const currentFrame = framesByGesture.get(frame.gestureId);
        if (!currentFrame || currentFrame.sessionId !== frame.sessionId ||
            currentFrame.projectId !== frame.projectId ||
            currentFrame.gesturePhase === 'cancel') {
          forgetGesture(frame.gestureId);
          continue;
        }
        if (repeatedTarget) {
          markGestureResponded(frame.gestureId);
          forgetGesture(frame.gestureId);
          publishStatus({
            state: 'watching',
            lastInferenceMs: inferenceMs,
            lastDispatchMs: null,
            lastTotalMs: Date.now() - responseStartedAt,
            lastSkippedReason: 'Repeated target corridor rejected before paint',
          });
          continue;
        }
        publishStatus({ state: 'drawing', lastInferenceMs: inferenceMs });
        const dispatchStartedAt = Date.now();
        const gestureBrush = buildGestureBrush(decision, {
          width: frame.sourceWidth,
          height: frame.sourceHeight,
          layerType: frame.aiLayerType,
        });
        const drawn = await client.send({
          action: 'multiplayer-gesture',
          sessionId: event.sessionId,
          gestureId: `ai-${crypto.randomUUID()}`,
          actor: 'ai',
          kind: gestureBrush.kind,
          ...(gestureBrush.brushPresetId
            ? { brushPresetId: gestureBrush.brushPresetId }
            : {}),
          points: decision.points,
          ...(gestureBrush.direction ? { direction: gestureBrush.direction } : {}),
          ...(gestureBrush.settings ? { settings: gestureBrush.settings } : {}),
          pointsPerFrame: 1,
          observedProjectId: frame.projectId,
          observedProjectRevision: frame.projectRevision,
          observationId: frame.frameId,
          respondingToGestureId: frame.gestureId,
          capture: 'none',
        }, {
          requestId: `mp-ai-draw:${crypto.randomUUID()}`,
          timeoutMs: requestTimeoutMs,
        });
        const dispatchMs = Date.now() - dispatchStartedAt;
        if (!drawn.result?.ok) {
          const rejection = drawn.result?.error ?? 'Vessel rejected the AI multiplayer mark';
          if (/stale|different Vessel project/i.test(rejection) &&
              currentFrame.frameId !== frame.frameId) {
            queueFrame(currentFrame);
            continue;
          }
          markGestureResponded(frame.gestureId);
          forgetGesture(frame.gestureId);
          publishStatus({
            state: 'watching',
            lastInferenceMs: inferenceMs,
            lastDispatchMs: dispatchMs,
            lastTotalMs: Date.now() - responseStartedAt,
            lastError: null,
            lastSkippedReason: rejection,
          });
          continue;
        }
        markGestureResponded(frame.gestureId);
        decisionMemory.push({
          brush: decision.brush,
          shapeFill: decision.shapeFill,
          relationship: decision.relationship,
          energy: decision.energy,
          targetStart: decision.targetStart,
          targetEnd: decision.targetEnd,
          intent: decision.intent,
        });
        if (decisionMemory.length > MAX_DECISION_MEMORY) decisionMemory.shift();
        forgetGesture(frame.gestureId);
        publishStatus({
          state: 'watching',
          lastIntent: decision.intent,
          lastRelationship: decision.relationship,
          lastInferenceMs: inferenceMs,
          lastDispatchMs: dispatchMs,
          lastTotalMs: Date.now() - responseStartedAt,
          lastSkippedReason: null,
        });
      } catch (error) {
        if (!stopped) {
          const errorMessage = error instanceof Error
            ? error.message
            : 'AI multiplayer response failed';
          const currentFrame = framesByGesture.get(frame.gestureId) ?? latestFrame;
          const currentEvent = humanGestures.get(frame.gestureId);
          const wasCancelled = abortController.signal.aborted &&
            currentEvent?.phase === 'cancel' &&
            currentEvent.sessionId === frame.sessionId &&
            currentEvent.projectId === frame.projectId;
          const wasSuperseded = wasCancelled || (abortController.signal.aborted && currentFrame && (
            currentFrame.sessionId !== frame.sessionId ||
            currentFrame.projectId !== frame.projectId ||
            (currentFrame.gestureId === frame.gestureId &&
              currentFrame.gesturePhase === 'cancel')
          ));
          const shouldRetryCompleted = !wasSuperseded &&
            currentFrame?.gestureId === frame.gestureId &&
            currentFrame.frameId !== frame.frameId &&
            currentFrame.gesturePhase === 'end' &&
            currentEvent?.phase === 'end' && currentEvent.committed === true &&
            !retriedCompletedGestureIds.has(frame.gestureId);
          forgetGesture(frame.gestureId);
          if (wasSuperseded) {
            retriedCompletedGestureIds.delete(frame.gestureId);
            publishStatus({
              state: wasCancelled || currentFrame?.gesturePhase === 'cancel'
                ? 'watching'
                : 'observing',
              sessionId: currentEvent?.sessionId ?? currentFrame?.sessionId ?? null,
              lastError: null,
            });
          } else if (shouldRetryCompleted) {
            retriedCompletedGestureIds.add(frame.gestureId);
            trackGesture(frame.gestureId);
            humanGestures.set(frame.gestureId, currentEvent);
            queueFrame(currentFrame);
            publishStatus({ state: 'observing', lastError: null });
          } else if (/Human gesture path is too short/i.test(errorMessage)) {
            markGestureResponded(frame.gestureId);
            publishStatus({
              state: 'watching',
              lastError: null,
              lastSkippedReason: 'Tap gesture skipped because it contained no drawable path',
            });
          } else {
            retriedCompletedGestureIds.delete(frame.gestureId);
            publishStatus({
              state: 'error',
              lastError: errorMessage,
            });
          }
        }
      } finally {
        clearTimeout(timeout);
        if (responseAbortController === abortController) responseAbortController = null;
        if (activeInferenceFrame === frame) activeInferenceFrame = null;
      }
    }
  };

  const scheduleDrain = () => {
    if (stopped) return;
    if (drainPromise) {
      drainRequested = true;
      return;
    }
    drainRequested = false;
    drainPromise = drain().finally(() => {
      drainPromise = null;
      if (drainRequested) scheduleDrain();
    });
  };

  const warm = () => {
    if (warmPromise || stopped) return warmPromise ?? Promise.resolve();
    publishStatus({ state: 'warming', lastError: null });
    const abortController = new AbortController();
    warmAbortController = abortController;
    const timeout = setTimeout(() => abortController.abort(
      new Error(`Local AI warmup timed out after ${warmTimeoutMs} milliseconds`),
    ), warmTimeoutMs);
    warmPromise = getVisionWarmupImageBase64().then((imageBase64) => fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: 'Reply OK.',
          images: [imageBase64],
        }],
        stream: false,
        think: false,
        keep_alive: '30m',
        options: {
          temperature: 0,
          num_ctx: OLLAMA_CONTEXT_WINDOW,
          num_predict: 1,
        },
      }),
      signal: abortController.signal,
    })).then((response) => {
      if (!response.ok) throw new Error(`Local Ollama warmup failed (${response.status})`);
      if (!stopped) publishStatus({ state: 'watching' });
    }).catch((error) => {
      if (!stopped) {
        publishStatus({
          state: 'error',
          lastError: error instanceof Error ? error.message : 'Local Ollama warmup failed',
        });
      }
    }).finally(() => {
      clearTimeout(timeout);
      warmAbortController = null;
    });
    return warmPromise;
  };

  return {
    getStatus: () => ({ ...status }),
    handleCanvasFrame: (frame) => {
      if (stopped) return;
      if (!resetObservationContext(frame)) return;
      latestFrame = frame;
      const isPendingGestureFrame = Boolean(
        frame.gestureId &&
        (frame.gesturePhase === 'move' || frame.gesturePhase === 'end') &&
        frame.gesturePointCount >= 2 &&
        !respondedGestureIds.has(frame.gestureId),
      );
      if (activeInferenceFrame && (
        frame.sessionId !== activeInferenceFrame.sessionId ||
        frame.projectId !== activeInferenceFrame.projectId ||
        (frame.gestureId === activeInferenceFrame.gestureId &&
          frame.gesturePhase === 'cancel')
      )) {
        responseAbortController?.abort();
      }
      publishStatus({
        state: isPendingGestureFrame &&
          (status.state === 'watching' || status.state === 'observing')
          ? 'observing'
          : status.state,
        sessionId: frame.sessionId,
        lastFrameAt: frame.capturedAt,
      });
      if (isPendingGestureFrame) {
        queueFrame(frame);
        scheduleDrain();
      } else if (frame.gestureId && frame.gesturePhase === 'cancel') {
        forgetGesture(frame.gestureId);
      }
    },
    handleRuntimeEvent: (event) => {
      if (stopped || !isObject(event)) return;
      if (event.type === 'human-gesture' && typeof event.gestureId === 'string') {
        if (!resetObservationContext(event)) return;
        trackGesture(event.gestureId);
        humanGestures.set(event.gestureId, event);
        if (event.phase === 'cancel') {
          const isActiveGesture = activeInferenceFrame?.gestureId === event.gestureId &&
            activeInferenceFrame.sessionId === event.sessionId &&
            activeInferenceFrame.projectId === event.projectId;
          markGestureResponded(event.gestureId);
          if (isActiveGesture) {
            responseAbortController?.abort(new Error('Human gesture was cancelled'));
          } else {
            forgetGesture(event.gestureId);
          }
          publishStatus({
            state: isActiveGesture ? status.state : 'watching',
            lastError: null,
          });
          scheduleDrain();
          return;
        }
        const frame = framesByGesture.get(event.gestureId);
        if (frame && (frame.gesturePhase === 'move' || frame.gesturePhase === 'end')) {
          queueFrame(frame);
        }
        scheduleDrain();
      }
    },
    warm,
    stop: () => {
      stopped = true;
      latestFrame = null;
      observationContext = null;
      observationContextAt = 0;
      pendingLiveGestureId = null;
      humanGestures.clear();
      framesByGesture.clear();
      trackedGestureIds.clear();
      trackedGestureOrder.length = 0;
      completedGestureIds.length = 0;
      completedGestureSet.clear();
      respondedGestureIds.clear();
      respondedGestureOrder.length = 0;
      retriedCompletedGestureIds.clear();
      decisionMemory.length = 0;
      responseAbortController?.abort();
      warmAbortController?.abort();
      publishStatus({ state: 'stopped', sessionId: null });
    },
    whenIdle: async () => {
      while (drainPromise) await drainPromise;
    },
  };
};
