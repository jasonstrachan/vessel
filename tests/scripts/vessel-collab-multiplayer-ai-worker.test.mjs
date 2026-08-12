import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVesselMultiplayerAiWorker,
  readVesselMultiplayerAiDecision,
} from '../../scripts/vessel-multiplayer-ai-worker.mjs';

const FRAME_BYTES = Buffer.from([0, 0, 0]);
const AI_RESPONSE = {
  brush: 'current-stroke',
  relationship: 'counterbalance',
  intent: 'Counterbalance the lower diagonal',
  targetStart: [0.3, 0.2],
  targetEnd: [0.7, 0.8],
  energy: 'wandering',
  reverse: false,
  pressureScale: 0.9,
  shapeFill: 'linear',
};

const HUMAN_PATH = [
  { x: 10, y: 9, pressure: 0.4 },
  { x: 14, y: 16, pressure: 0.6 },
  { x: 18, y: 11, pressure: 0.7 },
  { x: 22, y: 18, pressure: 0.5 },
];

const humanEnd = (overrides = {}) => ({
  eventId: 'human-event-1',
  type: 'human-gesture',
  actor: 'human',
  phase: 'end',
  sessionId: 'pixel-together',
  projectId: 'project-1',
  projectRevision: 7,
  gestureId: 'human-gesture-1',
  humanLayerId: 'jason-layer',
  tool: 'brush',
  shapeMode: false,
  pointerType: 'pen',
  point: { x: 22, y: 18, pressure: 0.5 },
  path: HUMAN_PATH,
  bounds: { minX: 10, minY: 9, maxX: 22, maxY: 18 },
  pointCount: 4,
  occurredAt: 1000,
  committed: true,
  committedAt: 1080,
  elapsedMs: 70,
  ...overrides,
});

const canvasFrame = (overrides = {}) => ({
  frameId: 'frame-1',
  sessionId: 'pixel-together',
  projectId: 'project-1',
  projectRevision: 7,
  aiLayerType: 'normal',
  capturedAt: 1100,
  width: 256,
  height: 128,
  sourceWidth: 100,
  sourceHeight: 50,
  mimeType: 'image/webp',
  gestureId: 'human-gesture-1',
  gesturePhase: 'end',
  gesturePointCount: 4,
  imageBuffer: FRAME_BYTES,
  ...overrides,
});

test('AI decisions map normalized points into bounded canvas coordinates', () => {
  const decision = readVesselMultiplayerAiDecision(
    AI_RESPONSE,
    { width: 101, height: 51, humanPath: HUMAN_PATH, layerType: 'normal' },
  );
  assert.equal(decision.intent, AI_RESPONSE.intent);
  assert.equal(decision.relationship, 'counterbalance');
  assert.equal(decision.energy, 'wandering');
  assert.equal(decision.points.length, 24);
  assert.ok(decision.points.every((point) => (
    point.x >= 0 && point.x < 101 && point.y >= 0 && point.y < 51 &&
    point.pressure >= 0.1 && point.pressure <= 1
  )));
  assert.deepEqual(decision.points[0], { x: 30, y: 10, pressure: 0.3456 });
  assert.ok(Math.abs(decision.points.at(-1).x - 70) < 0.001);
  assert.ok(Math.abs(decision.points.at(-1).y - 40) < 0.001);

  assert.throws(() => readVesselMultiplayerAiDecision({
    ...AI_RESPONSE,
    targetStart: [-0.1, 0.5],
  }, { width: 100, height: 100, humanPath: HUMAN_PATH, layerType: 'normal' }), /artistic gesture decision/);

  assert.throws(() => readVesselMultiplayerAiDecision({
    ...AI_RESPONSE,
    targetEnd: AI_RESPONSE.targetStart,
  }, { width: 100, height: 100, humanPath: HUMAN_PATH, layerType: 'normal' }), /target endpoints must be distinct/);

  assert.throws(() => readVesselMultiplayerAiDecision({
    ...AI_RESPONSE,
    intent: 'Collapsed path',
  }, {
    width: 100,
    height: 100,
    layerType: 'normal',
    humanPath: [{ x: 10, y: 10 }, { x: 10, y: 10 }],
  }), /too short/);

  assert.throws(() => readVesselMultiplayerAiDecision({
    ...AI_RESPONSE,
    brush: 'color-cycle-shape',
  }, {
    width: 100,
    height: 100,
    humanPath: HUMAN_PATH,
    layerType: 'normal',
  }), /artistic gesture decision/);
});

test('artistic relationships produce materially different paths from the same human gesture', () => {
  const connect = readVesselMultiplayerAiDecision(
    { ...AI_RESPONSE, relationship: 'connect' },
    { width: 101, height: 51, humanPath: HUMAN_PATH, layerType: 'normal' },
  );
  const interrupt = readVesselMultiplayerAiDecision(
    { ...AI_RESPONSE, relationship: 'interrupt' },
    { width: 101, height: 51, humanPath: HUMAN_PATH, layerType: 'normal' },
  );
  const baseline = { start: { x: 30, y: 10 }, end: { x: 70, y: 40 } };
  const dx = baseline.end.x - baseline.start.x;
  const dy = baseline.end.y - baseline.start.y;
  const length = Math.hypot(dx, dy);
  const maximumDeviation = (points) => Math.max(...points.map((point) => Math.abs(
    (point.x - baseline.start.x) * (-dy / length) +
    (point.y - baseline.start.y) * (dx / length),
  )));

  assert.ok(maximumDeviation(interrupt.points) > maximumDeviation(connect.points) * 2);
  assert.deepEqual(connect.points[0], interrupt.points[0]);
  assert.deepEqual(connect.points.at(-1), interrupt.points.at(-1));

  const closedGesture = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 10 },
  ];
  assert.doesNotThrow(() => readVesselMultiplayerAiDecision(
    { ...AI_RESPONSE, relationship: 'deepen' },
    { width: 101, height: 51, humanPath: closedGesture, layerType: 'normal' },
  ));
});

test('local worker prewarms the configured model with a synthetic vision image', async () => {
  const requests = [];
  const worker = createVesselMultiplayerAiWorker({
    client: { send: async () => ({ result: { ok: true } }) },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ message: { content: 'OK' } }), { status: 200 });
    },
  });

  await worker.warm();

  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.model, 'qwen2.5vl:3b');
  assert.equal(body.messages[0].images.length, 1);
  assert.match(body.messages[0].images[0], /^iVBORw0KGgo/);
  assert.equal(body.think, false);
  assert.equal(body.options.num_ctx, 4096);
  assert.equal(worker.getStatus().state, 'watching');
});

test('local worker starts from a live move observation before pointer-up', async () => {
  const commands = [];
  const requests = [];
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command, options) => {
        commands.push({ command, options });
        return { result: { ok: true } };
      },
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            ...AI_RESPONSE,
            intent: 'Echo the human diagonal with a shorter counter-stroke',
          }),
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  worker.handleRuntimeEvent(humanEnd({
    phase: 'move',
    committed: false,
    committedAt: undefined,
  }));
  await worker.whenIdle();
  assert.equal(requests.length, 0);
  worker.handleCanvasFrame(canvasFrame({ gesturePhase: 'move' }));
  await worker.whenIdle();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/chat');
  const requestBody = JSON.parse(requests[0].options.body);
  assert.equal(requestBody.model, 'qwen2.5vl:3b');
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.think, false);
  assert.equal(requestBody.messages[0].images[0], 'AAAA');
  assert.equal(requestBody.format.additionalProperties, false);
  assert.deepEqual(requestBody.format.properties.relationship.enum, [
    'echo', 'counterbalance', 'connect', 'interrupt', 'deepen',
  ]);
  assert.deepEqual(requestBody.format.properties.brush.enum, ['current-stroke']);
  assert.equal(requestBody.format.properties.targetStart.minItems, 2);
  assert.deepEqual(requestBody.format.properties.energy.enum, [
    'restrained', 'wandering', 'insistent',
  ]);
  assert.equal(requestBody.format.properties.reverse.type, 'boolean');
  assert.equal(requestBody.options.num_ctx, 4096);
  assert.equal(requestBody.options.num_predict, 160);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].command, {
    action: 'multiplayer-gesture',
    sessionId: 'pixel-together',
    gestureId: commands[0].command.gestureId,
    actor: 'ai',
    kind: 'stroke',
    points: commands[0].command.points,
    pointsPerFrame: 1,
    observedProjectId: 'project-1',
    observedProjectRevision: 7,
    observationId: 'frame-1',
    respondingToGestureId: 'human-gesture-1',
    capture: 'none',
  });
  assert.match(commands[0].command.gestureId, /^ai-/);
  assert.equal(commands[0].command.points.length, 24);
  assert.equal(worker.getStatus().state, 'watching');
  assert.equal(worker.getStatus().lastRelationship, 'counterbalance');
  assert.ok(Number.isFinite(worker.getStatus().lastInferenceMs));
});

test('Color Cycle sessions let the model dispatch canonical Flat Dither shapes', async () => {
  const commands = [];
  let requestBody;
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            ...AI_RESPONSE,
            brush: 'color-cycle-flat-dither',
            energy: 'insistent',
          }),
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  worker.handleRuntimeEvent(humanEnd());
  worker.handleCanvasFrame(canvasFrame({ aiLayerType: 'color-cycle' }));
  await worker.whenIdle();

  assert.deepEqual(requestBody.format.properties.brush.enum, [
    'color-cycle-stroke',
    'color-cycle-shape',
    'color-cycle-flat-dither',
  ]);
  assert.deepEqual(commands[0].direction, [
    { x: 29.7, y: 9.8 },
    { x: 69.3, y: 39.2 },
  ]);
  assert.equal(commands[0].kind, 'shape');
  assert.equal(commands[0].brushPresetId, 'color-cycle-flat-dither');
  assert.equal(commands[0].settings.colorCycleSpeed, 0.06);
  assert.equal(commands[0].settings.fillResolution, 1);
  assert.deepEqual(Object.keys(commands[0].settings).sort(), [
    'colorCycleSpeed',
    'fillResolution',
  ]);
});

test('Color Cycle Shape can use a directional linear fill', async () => {
  const commands = [];
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: JSON.stringify({
          ...AI_RESPONSE,
          brush: 'color-cycle-shape',
          shapeFill: 'linear',
        }),
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  worker.handleRuntimeEvent(humanEnd());
  worker.handleCanvasFrame(canvasFrame({ aiLayerType: 'color-cycle' }));
  await worker.whenIdle();

  assert.equal(commands[0].kind, 'shape');
  assert.equal(commands[0].brushPresetId, 'color-cycle-shape');
  assert.equal(commands[0].settings.colorCycleFillMode, 'linear');
  assert.deepEqual(commands[0].direction, [
    { x: 29.7, y: 9.8 },
    { x: 69.3, y: 39.2 },
  ]);
});

test('a Color Cycle brush used twice is excluded from the next decision schema', async () => {
  const requests = [];
  const decisions = [
    {
      ...AI_RESPONSE,
      brush: 'color-cycle-shape',
      targetStart: [0.1, 0.1],
      targetEnd: [0.3, 0.35],
    },
    {
      ...AI_RESPONSE,
      brush: 'color-cycle-shape',
      targetStart: [0.55, 0.1],
      targetEnd: [0.8, 0.3],
    },
    {
      ...AI_RESPONSE,
      brush: 'color-cycle-stroke',
      targetStart: [0.15, 0.8],
      targetEnd: [0.75, 0.7],
    },
  ];
  const worker = createVesselMultiplayerAiWorker({
    client: { send: async () => ({ result: { ok: true } }) },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        message: { content: JSON.stringify(decisions[requests.length - 1]) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  for (let index = 0; index < decisions.length; index += 1) {
    const gestureId = `cc-gesture-${index + 1}`;
    worker.handleRuntimeEvent(humanEnd({
      eventId: `cc-event-${index + 1}`,
      gestureId,
      projectRevision: index + 1,
      occurredAt: 1000 + index * 200,
      committedAt: 1050 + index * 200,
    }));
    worker.handleCanvasFrame(canvasFrame({
      frameId: `cc-frame-${index + 1}`,
      gestureId,
      projectRevision: index + 1,
      capturedAt: 1100 + index * 200,
      aiLayerType: 'color-cycle',
    }));
    await worker.whenIdle();
  }

  assert.deepEqual(requests[1].format.properties.brush.enum, [
    'color-cycle-stroke',
    'color-cycle-shape',
    'color-cycle-flat-dither',
  ]);
  assert.deepEqual(requests[2].format.properties.brush.enum, [
    'color-cycle-stroke',
    'color-cycle-flat-dither',
  ]);
});

test('a stale multiplayer session rejection does not poison AI availability', async () => {
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async () => ({
        result: {
          ok: false,
          error: 'Multiplayer session is not active: stopped-session',
        },
      }),
    },
    fetchImpl: async () => new Response(JSON.stringify({
      message: { content: JSON.stringify(AI_RESPONSE) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  worker.handleRuntimeEvent(humanEnd());
  worker.handleCanvasFrame(canvasFrame());
  await worker.whenIdle();

  assert.equal(worker.getStatus().state, 'watching');
  assert.equal(worker.getStatus().lastError, null);
  assert.match(worker.getStatus().lastSkippedReason, /session is not active/);
});

test('local worker rejects an invalid gesture decision without repeating full vision inference', async () => {
  const commands = [];
  let requestCount = 0;
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({
        message: { content: JSON.stringify({ ...AI_RESPONSE, energy: 'chaotic' }) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  worker.handleRuntimeEvent(humanEnd({
    phase: 'move',
    committed: false,
    committedAt: undefined,
  }));
  worker.handleCanvasFrame(canvasFrame({ gesturePhase: 'move' }));
  await worker.whenIdle();

  assert.equal(requestCount, 1);
  assert.equal(commands.length, 0);
  assert.equal(worker.getStatus().state, 'error');
  assert.match(worker.getStatus().lastError, /artistic gesture decision/);
});

test('a failed live decision retries once from the newer committed observation', async () => {
  const commands = [];
  let requestCount = 0;
  let releaseLiveRequest;
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise((resolve) => {
          releaseLiveRequest = () => resolve(new Response(JSON.stringify({
            message: { content: JSON.stringify({ ...AI_RESPONSE, energy: 'chaotic' }) },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });
      }
      return new Response(JSON.stringify({
        message: { content: JSON.stringify(AI_RESPONSE) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  worker.handleRuntimeEvent(humanEnd({
    phase: 'move',
    committed: false,
    committedAt: undefined,
  }));
  worker.handleCanvasFrame(canvasFrame({ gesturePhase: 'move' }));
  await new Promise((resolve) => setImmediate(resolve));
  worker.handleRuntimeEvent(humanEnd({ occurredAt: 1200, committedAt: 1250 }));
  worker.handleCanvasFrame(canvasFrame({
    frameId: 'frame-committed',
    capturedAt: 1300,
  }));
  releaseLiveRequest();
  await worker.whenIdle();

  assert.equal(requestCount, 2);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].observationId, 'frame-committed');
  assert.equal(worker.getStatus().state, 'watching');
});

test('completed human gestures keep the in-flight response and coalesce backlog to the latest', async () => {
  const commands = [];
  let requestCount = 0;
  let releaseFirstRequest;
  const decisions = [
    AI_RESPONSE,
    {
      ...AI_RESPONSE,
      intent: 'Answer a separate lower-left event',
      targetStart: [0.05, 0.85],
      targetEnd: [0.28, 0.42],
    },
    {
      ...AI_RESPONSE,
      intent: 'Answer a separate upper-right event',
      targetStart: [0.74, 0.12],
      targetEnd: [0.92, 0.5],
    },
  ];
  const decisionResponse = (decision) => new Response(JSON.stringify({
    message: {
      content: JSON.stringify({
        ...decision,
        intent: 'Answer the current diagonal',
      }),
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise((resolve) => {
          releaseFirstRequest = () => resolve(decisionResponse(decisions[0]));
        });
      }
      return decisionResponse(decisions[requestCount - 1]);
    },
  });

  worker.handleRuntimeEvent(humanEnd({
    phase: 'move',
    committed: false,
    committedAt: undefined,
  }));
  worker.handleCanvasFrame(canvasFrame({ gesturePhase: 'move' }));
  await new Promise((resolve) => setImmediate(resolve));
  worker.handleRuntimeEvent(humanEnd({
    gestureId: 'human-gesture-2',
    projectRevision: 8,
    occurredAt: 1200,
    committedAt: 1250,
  }));
  worker.handleCanvasFrame(canvasFrame({
    frameId: 'frame-2',
    gestureId: 'human-gesture-2',
    projectRevision: 8,
    capturedAt: 1300,
  }));
  worker.handleRuntimeEvent(humanEnd({
    eventId: 'human-event-3',
    gestureId: 'human-gesture-3',
    projectRevision: 9,
    occurredAt: 1400,
    committedAt: 1450,
  }));
  worker.handleCanvasFrame(canvasFrame({
    frameId: 'frame-3',
    gestureId: 'human-gesture-3',
    projectRevision: 9,
    capturedAt: 1500,
  }));
  releaseFirstRequest();
  await worker.whenIdle();

  assert.equal(requestCount, 2);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands.map((command) => command.observedProjectRevision), [7, 9]);
  assert.deepEqual(commands.map((command) => command.observationId), [
    'frame-1', 'frame-3',
  ]);
});

test('decision memory stays within one multiplayer project and resets for the next', async () => {
  const requests = [];
  const decisions = [
    AI_RESPONSE,
    {
      ...AI_RESPONSE,
      intent: 'Answer a separate lower-left event',
      targetStart: [0.05, 0.85],
      targetEnd: [0.28, 0.42],
    },
    AI_RESPONSE,
  ];
  const worker = createVesselMultiplayerAiWorker({
    client: { send: async () => ({ result: { ok: true } }) },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        message: { content: JSON.stringify(decisions[requests.length - 1]) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const observe = async ({ gestureId, sessionId, projectId, revision, occurredAt }) => {
    worker.handleRuntimeEvent(humanEnd({
      eventId: `event-${gestureId}`,
      gestureId,
      sessionId,
      projectId,
      projectRevision: revision,
      occurredAt,
      committedAt: occurredAt + 50,
    }));
    worker.handleCanvasFrame(canvasFrame({
      frameId: `frame-${gestureId}`,
      gestureId,
      sessionId,
      projectId,
      projectRevision: revision,
      capturedAt: occurredAt + 100,
    }));
    await worker.whenIdle();
  };
  const readContext = (request) => {
    const content = request.messages[0].content;
    const start = content.indexOf('Current gesture context: ') + 'Current gesture context: '.length;
    const end = content.indexOf('\nJSON schema:', start);
    return JSON.parse(content.slice(start, end));
  };

  await observe({
    gestureId: 'human-gesture-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    revision: 7,
    occurredAt: 1000,
  });
  await observe({
    gestureId: 'human-gesture-2',
    sessionId: 'session-1',
    projectId: 'project-1',
    revision: 8,
    occurredAt: 1200,
  });
  await observe({
    gestureId: 'human-gesture-3',
    sessionId: 'session-2',
    projectId: 'project-2',
    revision: 1,
    occurredAt: 2000,
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(readContext(requests[0]).recentAiResponses, []);
  assert.deepEqual(readContext(requests[1]).recentAiResponses, [{
    brush: 'current-stroke',
    shapeFill: 'linear',
    relationship: 'counterbalance',
    energy: 'wandering',
    targetStart: [0.3, 0.2],
    targetEnd: [0.7, 0.8],
    intent: 'Counterbalance the lower diagonal',
  }]);
  assert.deepEqual(readContext(requests[2]).recentAiResponses, []);
});

test('a repeated target corridor is replanned once before Vessel receives a mark', async () => {
  const commands = [];
  const requests = [];
  const decisions = [
    AI_RESPONSE,
    {
      ...AI_RESPONSE,
      intent: 'Repeat the same corridor',
      targetStart: [0.31, 0.21],
      targetEnd: [0.69, 0.79],
    },
    {
      ...AI_RESPONSE,
      relationship: 'interrupt',
      intent: 'Move to a distinct observed edge',
      targetStart: [0.05, 0.8],
      targetEnd: [0.28, 0.35],
    },
  ];
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        message: { content: JSON.stringify(decisions[requests.length - 1]) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const observe = async (gestureId, revision, occurredAt) => {
    worker.handleRuntimeEvent(humanEnd({
      eventId: `event-${gestureId}`,
      gestureId,
      projectRevision: revision,
      occurredAt,
      committedAt: occurredAt + 50,
    }));
    worker.handleCanvasFrame(canvasFrame({
      frameId: `frame-${gestureId}`,
      gestureId,
      projectRevision: revision,
      capturedAt: occurredAt + 100,
    }));
    await worker.whenIdle();
  };

  await observe('human-gesture-1', 7, 1000);
  await observe('human-gesture-2', 8, 1200);

  assert.equal(requests.length, 3);
  assert.equal(commands.length, 2);
  assert.ok(requests[2].messages[0].content.includes('rejectedCandidate'));
  assert.equal(commands[1].points[0].x, 4.95);
  assert.equal(commands[1].points[0].y, 39.2);
  assert.equal(worker.getStatus().lastRelationship, 'interrupt');
  assert.equal(worker.getStatus().lastSkippedReason, null);
});

test('a target corridor that still repeats after replanning is skipped before paint', async () => {
  const commands = [];
  let requestCount = 0;
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({
        message: { content: JSON.stringify(AI_RESPONSE) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const observe = async (gestureId, revision, occurredAt) => {
    worker.handleRuntimeEvent(humanEnd({
      eventId: `event-${gestureId}`,
      gestureId,
      projectRevision: revision,
      occurredAt,
      committedAt: occurredAt + 50,
    }));
    worker.handleCanvasFrame(canvasFrame({
      frameId: `frame-${gestureId}`,
      gestureId,
      projectRevision: revision,
      capturedAt: occurredAt + 100,
    }));
    await worker.whenIdle();
  };

  await observe('human-gesture-1', 7, 1000);
  await observe('human-gesture-2', 8, 1200);
  worker.handleCanvasFrame(canvasFrame({
    frameId: 'frame-human-gesture-2-newer',
    gestureId: 'human-gesture-2',
    projectRevision: 8,
    capturedAt: 1400,
  }));
  await worker.whenIdle();

  assert.equal(requestCount, 3);
  assert.equal(commands.length, 1);
  assert.equal(worker.getStatus().state, 'watching');
  assert.equal(worker.getStatus().lastSkippedReason, 'Repeated target corridor rejected before paint');
});

test('a cancelled human gesture event aborts inference and rejects late frames', async () => {
  const commands = [];
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
        once: true,
      });
    }),
  });

  worker.handleRuntimeEvent(humanEnd({
    phase: 'move',
    committed: false,
    committedAt: undefined,
  }));
  worker.handleCanvasFrame(canvasFrame({ gesturePhase: 'move' }));
  await new Promise((resolve) => setImmediate(resolve));
  worker.handleRuntimeEvent(humanEnd({
    phase: 'cancel',
    committed: false,
    committedAt: undefined,
    occurredAt: 1150,
  }));
  worker.handleCanvasFrame(canvasFrame({
    frameId: 'frame-late-move',
    gesturePhase: 'move',
    capturedAt: 1200,
  }));
  await worker.whenIdle();

  assert.equal(commands.length, 0);
  assert.equal(worker.getStatus().state, 'watching');
  assert.equal(worker.getStatus().lastError, null);
});

test('malformed local vision output is rejected before Vessel receives a mark', async () => {
  const commands = [];
  const worker = createVesselMultiplayerAiWorker({
    client: {
      send: async (command) => {
        commands.push(command);
        return { result: { ok: true } };
      },
    },
    fetchImpl: async () => new Response(JSON.stringify({
      message: { content: '{"intent":"bad","placement":[]}' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  worker.handleCanvasFrame(canvasFrame());
  worker.handleRuntimeEvent(humanEnd());
  await worker.whenIdle();

  assert.equal(commands.length, 0);
  assert.equal(worker.getStatus().state, 'error');
  assert.match(worker.getStatus().lastError, /artistic gesture decision/);
});

test('a tap with no drawable path is skipped without poisoning multiplayer availability', async () => {
  const worker = createVesselMultiplayerAiWorker({
    client: { send: async () => ({ result: { ok: true } }) },
    fetchImpl: async () => new Response(JSON.stringify({
      message: { content: JSON.stringify(AI_RESPONSE) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  worker.handleRuntimeEvent(humanEnd({
    path: [{ x: 10, y: 10 }, { x: 10, y: 10 }],
    point: { x: 10, y: 10 },
  }));
  worker.handleCanvasFrame(canvasFrame());
  await worker.whenIdle();

  assert.equal(worker.getStatus().state, 'watching');
  assert.equal(worker.getStatus().lastError, null);
  assert.match(worker.getStatus().lastSkippedReason, /Tap gesture skipped/);
});
