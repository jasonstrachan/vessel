import { parseVesselCollaborationCommand } from '../vesselCollaborationProtocol';

describe('parseVesselCollaborationCommand', () => {
  it('accepts bounded multiplayer start, gesture, and stop commands', () => {
    expect(parseVesselCollaborationCommand({
      id: 'multiplayer-start-command',
      action: 'multiplayer-start',
      sessionId: 'portrait-together',
      aiLayerName: 'AI portrait marks',
    })).toEqual({
      id: 'multiplayer-start-command',
      action: 'multiplayer-start',
      sessionId: 'portrait-together',
      aiLayerName: 'AI portrait marks',
    });

    expect(parseVesselCollaborationCommand({
      id: 'multiplayer-gesture-command',
      action: 'multiplayer-gesture',
      sessionId: 'portrait-together',
      gestureId: 'ai-mark-1',
      actor: 'ai',
      kind: 'stroke',
      pointsPerFrame: 4,
      points: [{ x: 12, y: 14, pressure: 0.5 }, { x: 22, y: 24 }],
      settings: { size: 18, ditherAlgorithm: 'sierra-lite' },
      observedProjectId: 'project-1',
      observedProjectRevision: 7,
      observationId: 'frame-1',
      respondingToGestureId: 'human-mark-1',
    })).toEqual({
      id: 'multiplayer-gesture-command',
      action: 'multiplayer-gesture',
      sessionId: 'portrait-together',
      gestureId: 'ai-mark-1',
      actor: 'ai',
      kind: 'stroke',
      pointsPerFrame: 4,
      points: [{ x: 12, y: 14, pressure: 0.5 }, { x: 22, y: 24, pressure: undefined }],
      direction: undefined,
      settings: { size: 18, ditherAlgorithm: 'sierra-lite' },
      observedProjectId: 'project-1',
      observedProjectRevision: 7,
      observationId: 'frame-1',
      respondingToGestureId: 'human-mark-1',
    });

    expect(parseVesselCollaborationCommand({
      id: 'multiplayer-stop-command',
      action: 'multiplayer-stop',
      sessionId: 'portrait-together',
      reason: 'Jason stopped the AI',
    })).toMatchObject({ action: 'multiplayer-stop', reason: 'Jason stopped the AI' });

    expect(() => parseVesselCollaborationCommand({
      id: 'multiplayer-human-command',
      action: 'multiplayer-gesture',
      sessionId: 'portrait-together',
      gestureId: 'human-mark-1',
      actor: 'human',
      kind: 'stroke',
      points: [{ x: 1, y: 2 }],
      observedProjectId: 'project-1',
      observedProjectRevision: 7,
      observationId: 'frame-1',
      respondingToGestureId: 'human-mark-1',
    })).toThrow('actor must be ai');

    expect(() => parseVesselCollaborationCommand({
      id: 'multiplayer-stroke-direction-command',
      action: 'multiplayer-gesture',
      sessionId: 'portrait-together',
      gestureId: 'ai-mark-direction',
      actor: 'ai',
      kind: 'stroke',
      points: [{ x: 1, y: 2 }],
      observedProjectId: 'project-1',
      observedProjectRevision: 7,
      observationId: 'frame-1',
      respondingToGestureId: 'human-mark-1',
      direction: [{ x: 1, y: 2 }, { x: 2, y: 3 }],
    })).toThrow('direction is only supported for multiplayer shapes');

    expect(() => parseVesselCollaborationCommand({
      id: 'multiplayer-brush-kind-command',
      action: 'multiplayer-gesture',
      sessionId: 'portrait-together',
      gestureId: 'ai-mark-wrong-brush',
      actor: 'ai',
      kind: 'stroke',
      brushPresetId: 'color-cycle-flat-dither',
      points: [{ x: 1, y: 2 }],
      observedProjectId: 'project-1',
      observedProjectRevision: 7,
      observationId: 'frame-1',
      respondingToGestureId: 'human-mark-1',
    })).toThrow('requires multiplayer kind shape');
  });

  it('accepts bounded new-project dimensions and an optional name', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-new-project',
      action: 'new-project',
      width: 512,
      height: 640,
      name: 'Sea Light Study',
    })).toEqual({
      id: 'command-new-project',
      action: 'new-project',
      width: 512,
      height: 640,
      name: 'Sea Light Study',
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-new-project-invalid',
      action: 'new-project',
      width: 0,
      height: 640,
    })).toThrow('width and height must be between 1 and 16384');
  });

  it('accepts a bounded pressure-aware stroke', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-1',
      action: 'stroke',
      tool: 'brush',
      points: [
        { x: 10, y: 20, pressure: 0.25 },
        { x: 30, y: 40 },
      ],
    })).toEqual({
      id: 'command-1',
      action: 'stroke',
      tool: 'brush',
      points: [
        { x: 10, y: 20, pressure: 0.25 },
        { x: 30, y: 40, pressure: undefined },
      ],
    });
  });

  it('rejects invalid coordinates and pressure', () => {
    expect(() => parseVesselCollaborationCommand({
      id: 'command-1',
      action: 'stroke',
      points: [{ x: Number.NaN, y: 20 }],
    })).toThrow('points[0].x must be a finite number');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-2',
      action: 'stroke',
      points: [{ x: 10, y: 20, pressure: 2 }],
    })).toThrow('points[0].pressure must be between 0 and 1');
  });

  it('limits brush settings to the supported safe subset', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-3',
      action: 'set-brush',
      settings: { size: 24, opacity: 0.5, color: '#aabbcc', spacing: 2 },
    })).toEqual({
      id: 'command-3',
      action: 'set-brush',
      settings: { size: 24, opacity: 0.5, color: '#aabbcc', spacing: 2 },
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-4',
      action: 'set-brush',
      settings: { blendMode: 'erase' },
    })).toThrow('unsupported brush setting: blendMode');
  });

  it('accepts the bounded dither settings needed for shape collaboration', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-dither',
      action: 'set-brush',
      settings: {
        ditherEnabled: true,
        ditherAlgorithm: 'sierra-lite',
        fillResolution: 6,
        pressureLinkedFillResolution: false,
        pressureLinkedFillMaxResolution: 12,
      },
    })).toEqual({
      id: 'command-dither',
      action: 'set-brush',
      settings: {
        ditherEnabled: true,
        ditherAlgorithm: 'sierra-lite',
        fillResolution: 6,
        pressureLinkedFillResolution: false,
        pressureLinkedFillMaxResolution: 12,
      },
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-dither-invalid',
      action: 'set-brush',
      settings: { fillResolution: 65 },
    })).toThrow('settings.fillResolution must be between 1 and 64');
  });

  it('accepts the brush-specific Color Cycle and dither controls', () => {
    const settings = {
      patternStyle: 'crosshatch' as const,
      ditherBackgroundFill: false,
      ditherGradBgFill: true,
      ditherPaletteSpread: 25,
      ditherPatternDiversity: 80,
      ditherPhaseJitter: 12,
      ccGradientRangeContrast: 70,
      ccSampledSoftSeamEnabled: true,
      lostEdge: 18,
      pxlEdge: true,
      colorCycleSpeed: 0.75,
      gradientBands: 16,
      ccFlatCycleDither: true,
      ccFlatCycleBands: 0,
      colorCycleFillMode: 'linear' as const,
      ccGradientDrawingShape: 'freehand' as const,
      colorCycleStampDitherEnabled: true,
      colorCycleStampDitherPixelSize: 6,
      colorCycleStampDitherPressureLinked: false,
      colorCycleStampDitherBgFill: true,
      colorCycleStampShape: 'checkered' as const,
      pressureEnabled: false,
      rotationEnabled: false,
      dashedEnabled: false,
      gridSnapEnabled: false,
      gridSnapSize: 16,
    };
    expect(parseVesselCollaborationCommand({
      id: 'command-cc-controls',
      action: 'set-brush',
      settings,
    })).toEqual({
      id: 'command-cc-controls',
      action: 'set-brush',
      settings,
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-speed-invalid',
      action: 'set-brush',
      settings: { colorCycleSpeed: 1.51 },
    })).toThrow('settings.colorCycleSpeed must be between 0 and 1.5');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-flat-cycle-bands-invalid',
      action: 'set-brush',
      settings: { ccFlatCycleBands: 33 },
    })).toThrow('settings.ccFlatCycleBands must be between 0 and 32');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-tile-without-identity',
      action: 'set-brush',
      settings: { patternStyle: 'image-tile' },
    })).toThrow('unsupported pattern style: image-tile');
  });

  it('accepts a base64-encoded project transfer', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-open',
      action: 'open-project',
      fileName: 'portrait.vs',
      dataBase64: 'UEsDBA==',
    })).toEqual({
      id: 'command-open',
      action: 'open-project',
      fileName: 'portrait.vs',
      dataBase64: 'UEsDBA==',
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-invalid-open',
      action: 'open-project',
      fileName: 'portrait.vs',
      dataBase64: 'not base64',
    })).toThrow('dataBase64 must be valid base64');
  });

  it('accepts a bounded reference-image transfer and fit mode', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-reference-image',
      action: 'import-reference-image',
      fileName: 'reference.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw==',
      fit: 'cover',
    })).toEqual({
      id: 'command-reference-image',
      action: 'import-reference-image',
      fileName: 'reference.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw==',
      fit: 'cover',
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-reference-image-invalid',
      action: 'import-reference-image',
      fileName: 'reference.gif',
      mimeType: 'image/gif',
      dataBase64: 'R0lGODlh',
    })).toThrow('mimeType must be image/png, image/jpeg, or image/webp');
  });

  it('accepts canonical brush-preset selection', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-preset',
      action: 'set-brush-preset',
      presetId: 'color-cycle-flat-dither',
    })).toEqual({
      id: 'command-preset',
      action: 'set-brush-preset',
      presetId: 'color-cycle-flat-dither',
    });
  });

  it('accepts normal and Color Cycle layer creation', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-create-cc-layer',
      action: 'create-layer',
      layerType: 'color-cycle',
      name: 'Sky texture',
    })).toEqual({
      id: 'command-create-cc-layer',
      action: 'create-layer',
      layerType: 'color-cycle',
      name: 'Sky texture',
    });

    expect(parseVesselCollaborationCommand({
      id: 'command-create-normal-layer',
      action: 'create-layer',
      layerType: 'normal',
    })).toEqual({
      id: 'command-create-normal-layer',
      action: 'create-layer',
      layerType: 'normal',
      name: undefined,
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-create-invalid-layer',
      action: 'create-layer',
      layerType: 'sequential',
    })).toThrow('layerType must be normal or color-cycle');
  });

  it('accepts layer visibility changes directly and in batches', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-hide-layer',
      action: 'set-layer-visibility',
      layerId: 'reference-layer',
      visible: false,
    })).toEqual({
      id: 'command-hide-layer',
      action: 'set-layer-visibility',
      layerId: 'reference-layer',
      visible: false,
    });

    expect(parseVesselCollaborationCommand({
      id: 'command-hide-layer-batch',
      action: 'batch',
      operations: [{
        action: 'set-layer-visibility',
        layerId: 'reference-layer',
        visible: false,
      }],
    })).toMatchObject({
      operations: [{
        action: 'set-layer-visibility',
        layerId: 'reference-layer',
        visible: false,
      }],
    });
  });

  it('accepts palette, gradient-source, gradient, and eraser controls', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-palette',
      action: 'set-palette',
      foreground: '#102030',
      background: '#f0e0d0',
      activeSlot: 'foreground',
    })).toEqual({
      id: 'command-palette',
      action: 'set-palette',
      foreground: '#102030',
      background: '#f0e0d0',
      activeSlot: 'foreground',
      swap: undefined,
    });

    expect(parseVesselCollaborationCommand({
      id: 'command-source',
      action: 'set-gradient-source',
      source: 'sampled',
    })).toEqual({
      id: 'command-source',
      action: 'set-gradient-source',
      source: 'sampled',
    });

    expect(parseVesselCollaborationCommand({
      id: 'command-gradient',
      action: 'set-gradient',
      stops: [
        { position: 0, color: '#000000', opacity: 0.5 },
        { position: 1, color: '#ffffff' },
      ],
      foreground: {
        lightness: 40,
        hueShift: -20,
        saturationShift: 10,
        opacity: 90,
        stopCount: 4,
      },
      resetSample: true,
    })).toEqual({
      id: 'command-gradient',
      action: 'set-gradient',
      stops: [
        { position: 0, color: '#000000', opacity: 0.5 },
        { position: 1, color: '#ffffff', opacity: undefined },
      ],
      foreground: {
        lightness: 40,
        hueShift: -20,
        saturationShift: 10,
        opacity: 90,
        stopCount: 4,
      },
      resetSample: true,
    });

    expect(parseVesselCollaborationCommand({
      id: 'command-eraser',
      action: 'set-eraser',
      settings: { size: 18, opacity: 0.75, linkSizeToBrush: false, tip: 'diamond5' },
    })).toEqual({
      id: 'command-eraser',
      action: 'set-eraser',
      settings: { size: 18, opacity: 0.75, linkSizeToBrush: false, tip: 'diamond5' },
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-palette-ambiguous',
      action: 'set-palette',
      foreground: '#000000',
      swap: true,
    })).toThrow('swap cannot be combined with foreground or background');
  });

  it('accepts painting controls inside one batch', () => {
    const command = parseVesselCollaborationCommand({
      id: 'command-control-batch',
      action: 'batch',
      capture: 'none',
      operations: [
        { action: 'set-palette', foreground: '#ffffff' },
        { action: 'set-gradient-source', source: 'fg' },
        { action: 'set-gradient', foreground: { stopCount: 3 } },
        { action: 'set-eraser', settings: { tip: 'round' } },
      ],
    });

    expect(command).toMatchObject({
      action: 'batch',
      operations: [
        { action: 'set-palette', foreground: '#ffffff' },
        { action: 'set-gradient-source', source: 'fg' },
        { action: 'set-gradient', foreground: { stopCount: 3 } },
        { action: 'set-eraser', settings: { tip: 'round' } },
      ],
    });
  });

  it('accepts a bounded batch with capture and point batching controls', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-batch',
      action: 'batch',
      capture: 'each-thumbnail',
      thumbnailMaxSize: 768,
      operations: [
        {
          action: 'set-brush',
          settings: {
            ditherEnabled: true,
            ditherAlgorithm: 'sierra-lite',
            fillResolution: 6,
          },
        },
        {
          action: 'create-layer',
          layerType: 'color-cycle',
          name: 'AI details',
        },
        {
          action: 'stroke',
          pointsPerFrame: 2,
          points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
        },
        {
          action: 'shape',
          points: [{ x: 50, y: 60 }, { x: 70, y: 80 }, { x: 60, y: 90 }],
          direction: [{ x: 60, y: 75 }, { x: 90, y: 75 }],
        },
        { action: 'set-brush', settings: { fillResolution: 3 } },
      ],
    })).toEqual({
      id: 'command-batch',
      action: 'batch',
      capture: 'each-thumbnail',
      thumbnailMaxSize: 768,
      operations: [
        {
          action: 'set-brush',
          settings: {
            ditherEnabled: true,
            ditherAlgorithm: 'sierra-lite',
            fillResolution: 6,
          },
        },
        {
          action: 'create-layer',
          layerType: 'color-cycle',
          name: 'AI details',
        },
        {
          action: 'stroke',
          tool: undefined,
          pointsPerFrame: 2,
          points: [
            { x: 10, y: 20, pressure: undefined },
            { x: 30, y: 40, pressure: undefined },
          ],
        },
        {
          action: 'shape',
          points: [
            { x: 50, y: 60, pressure: undefined },
            { x: 70, y: 80, pressure: undefined },
            { x: 60, y: 90, pressure: undefined },
          ],
          direction: [
            { x: 60, y: 75, pressure: undefined },
            { x: 90, y: 75, pressure: undefined },
          ],
        },
        { action: 'set-brush', settings: { fillResolution: 3 } },
      ],
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-batch-invalid',
      action: 'batch',
      operations: [{ action: 'stroke', pointsPerFrame: 3, points: [{ x: 1, y: 2 }] }],
    })).toThrow('operations[0].pointsPerFrame must be 1 or 2');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-batch-too-many-coalesced',
      action: 'batch',
      operations: [{
        action: 'stroke',
        pointsPerFrame: 2,
        points: Array.from({ length: 17 }, (_, index) => ({ x: index, y: index })),
      }],
    })).toThrow('operations[0].pointsPerFrame can only be 2 for strokes with at most 16 points');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-batch-too-many-frames',
      action: 'batch',
      capture: 'each-thumbnail',
      operations: Array.from({ length: 9 }, () => ({
        action: 'stroke',
        points: [{ x: 1, y: 2 }],
      })),
    })).toThrow('each-thumbnail batches cannot contain more than 8 gestures');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-batch-frame-too-large',
      action: 'batch',
      capture: 'each-thumbnail',
      thumbnailMaxSize: 1024,
      operations: [{ action: 'stroke', points: [{ x: 1, y: 2 }] }],
    })).toThrow('each-thumbnail batches cannot exceed a 768px thumbnail');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-shape-direction-too-short',
      action: 'shape',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
      direction: [{ x: 5, y: 5 }],
    })).toThrow('direction must contain at least two points');
  });

  it('accepts bounded named checkpoints and rejects ambiguous frame batches', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-checkpoints',
      action: 'batch',
      capture: 'none',
      operations: [
        { action: 'stroke', points: [{ x: 10, y: 20 }] },
        { action: 'checkpoint', name: 'landscape' },
        {
          action: 'shape',
          points: [{ x: 50, y: 60 }, { x: 70, y: 80 }, { x: 60, y: 90 }],
        },
        { action: 'checkpoint', name: 'final-hat' },
      ],
    })).toEqual({
      id: 'command-checkpoints',
      action: 'batch',
      capture: 'none',
      operations: [
        {
          action: 'stroke',
          tool: undefined,
          points: [{ x: 10, y: 20, pressure: undefined }],
        },
        { action: 'checkpoint', name: 'landscape' },
        {
          action: 'shape',
          points: [
            { x: 50, y: 60, pressure: undefined },
            { x: 70, y: 80, pressure: undefined },
            { x: 60, y: 90, pressure: undefined },
          ],
          direction: undefined,
        },
        { action: 'checkpoint', name: 'final-hat' },
      ],
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-duplicate-checkpoints',
      action: 'batch',
      operations: [
        { action: 'checkpoint', name: 'same' },
        { action: 'checkpoint', name: 'same' },
      ],
    })).toThrow('checkpoint names must be unique within a batch');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-too-many-checkpoints',
      action: 'batch',
      operations: Array.from({ length: 9 }, (_, index) => ({
        action: 'checkpoint',
        name: `checkpoint-${index}`,
      })),
    })).toThrow('batches cannot return more than 8 checkpoint or gesture thumbnails');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-too-many-mixed-frames',
      action: 'batch',
      capture: 'each-thumbnail',
      operations: [
        ...Array.from({ length: 7 }, () => ({
          action: 'stroke',
          points: [{ x: 1, y: 2 }],
        })),
        { action: 'checkpoint', name: 'one' },
        { action: 'checkpoint', name: 'two' },
      ],
    })).toThrow('batches cannot return more than 8 checkpoint or gesture thumbnails');
  });

  it('keeps atomic batches bounded and accepts a larger streamed artwork job', () => {
    const runtimeFence = {
      protocolVersion: 6,
      runtimeBuildId: 'test-build',
      runtimeInstanceId: 'test-runtime',
      leaseEpoch: 1,
      expectedProjectId: 'test-project',
      expectedProjectRevision: 0,
      expectedCheckpointId: null,
    };
    expect(() => parseVesselCollaborationCommand({
      id: 'command-batch-over-limit',
      action: 'batch',
      operations: Array.from({ length: 101 }, () => ({
        action: 'set-tool',
        tool: 'brush',
      })),
    })).toThrow('operations cannot contain more than 100 operations');

    const job = parseVesselCollaborationCommand({
      id: 'command-artwork-job',
      action: 'artwork-job',
      capture: 'final-thumbnail',
      runtimeFence,
      operations: [
        ...Array.from({ length: 120 }, () => ({
          action: 'set-tool' as const,
          tool: 'brush' as const,
        })),
        {
          action: 'checkpoint',
          name: 'primary-masses',
          capture: 'full',
          thumbnailMaxSize: 512,
        },
      ],
    });
    expect(job.action).toBe('artwork-job');
    if (job.action !== 'artwork-job') throw new Error('Expected artwork job');
    expect(job.operations).toHaveLength(121);
    expect(job.operations.at(-1)).toEqual({
      action: 'checkpoint',
      name: 'primary-masses',
      capture: 'full',
      thumbnailMaxSize: 512,
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-each-frame',
      action: 'artwork-job',
      capture: 'each-thumbnail',
      operations: [{ action: 'set-tool', tool: 'brush' }],
    })).toThrow('artwork jobs use named checkpoints instead of each-thumbnail capture');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-no-checkpoint',
      action: 'artwork-job',
      runtimeFence,
      operations: [{ action: 'set-tool', tool: 'brush' }],
    })).toThrow('artwork jobs require exactly one final named checkpoint');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-early-checkpoint',
      action: 'artwork-job',
      runtimeFence,
      operations: [
        { action: 'checkpoint', name: 'too-early' },
        { action: 'set-tool', tool: 'brush' },
      ],
    })).toThrow('artwork jobs require exactly one final named checkpoint');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-layer-switch',
      action: 'artwork-job',
      runtimeFence,
      operations: [
        { action: 'create-layer', layerType: 'color-cycle' },
        { action: 'checkpoint', name: 'primary-masses' },
      ],
    })).toThrow('unsupported artwork job operation: create-layer');

    for (const operation of [
      { action: 'set-tool', tool: 'eraser' },
      { action: 'set-eraser', settings: { size: 8 } },
      {
        action: 'stroke',
        tool: 'eraser',
        phase: 'establish',
        points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      },
    ]) {
      expect(() => parseVesselCollaborationCommand({
        id: 'command-artwork-job-eraser',
        action: 'artwork-job',
        runtimeFence,
        operations: [operation, { action: 'checkpoint', name: 'establish-review' }],
      })).toThrow('artwork jobs cannot erase committed marks');
    }

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-unphased-mark',
      action: 'artwork-job',
      runtimeFence,
      operations: [
        {
          action: 'shape',
          id: 'unphased-shape',
          points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 3, y: 5 }],
        },
        { action: 'checkpoint', name: 'primary-masses' },
      ],
    })).toThrow('operations[0].phase is required for artwork job gestures');

    const phasedJob = parseVesselCollaborationCommand({
      id: 'command-artwork-job-phased-mark',
      action: 'artwork-job',
      runtimeFence,
      massObservationPlan: {
        schemaVersion: 3,
        checkpointId: 'visible-checkpoint-17',
        fingerprint: 'mass-plan-sha256-17',
        observedMassCount: 1,
        basedOnRevision: 0,
        basedOnCheckpointId: null,
      },
      priorityCoverage: {
        priorityMaskId: 'face-priority',
        priorityMaskFingerprint: 'mask-fingerprint',
        coverageBaselineRevision: 0,
        width: 10,
        height: 10,
        spans: [{ y: 1, xStart: 1, xEndExclusive: 4 }],
      },
      operations: [
        {
          action: 'shape',
          id: 'primary-shape',
          phase: 'establish',
          basedOnRevision: 0,
          parentMassId: 'head-shadow',
          sourceRegionId: 'reference-region-17',
          boundaryAnchorCount: 37,
          points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 3, y: 5 }],
        },
        { action: 'checkpoint', name: 'primary-masses' },
      ],
    });
    if (phasedJob.action !== 'artwork-job') throw new Error('Expected artwork job');
    expect(phasedJob.operations[0]).toMatchObject({
      id: 'primary-shape',
      phase: 'establish',
      basedOnRevision: 0,
      parentMassId: 'head-shadow',
      sourceRegionId: 'reference-region-17',
      boundaryAnchorCount: 37,
    });
    expect(phasedJob.massObservationPlan).toEqual({
      schemaVersion: 3,
      checkpointId: 'visible-checkpoint-17',
      fingerprint: 'mass-plan-sha256-17',
      observedMassCount: 1,
      basedOnRevision: 0,
      basedOnCheckpointId: null,
    });
    expect(phasedJob.priorityCoverage).toMatchObject({
      priorityMaskId: 'face-priority',
      coverageBaselineRevision: 0,
    });
    expect(phasedJob.operations[1]).toMatchObject({
      action: 'checkpoint',
      name: 'primary-masses',
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-unobserved-mark',
      action: 'artwork-job',
      runtimeFence,
      massObservationPlan: {
        schemaVersion: 3,
        checkpointId: 'visible-checkpoint-18',
        fingerprint: 'mass-plan-sha256-18',
        observedMassCount: 1,
        basedOnRevision: 0,
        basedOnCheckpointId: null,
      },
      operations: [
        {
          action: 'shape',
          id: 'generic-face-blob',
          phase: 'establish',
          boundaryAnchorCount: 20,
          points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 3, y: 5 }],
        },
        { action: 'checkpoint', name: 'must-not-dispatch' },
      ],
    })).toThrow('sourceRegionId is required by the mass observation plan');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-invalid-checkpoint-capture',
      action: 'artwork-job',
      runtimeFence,
      operations: [{ action: 'checkpoint', name: 'review', capture: 'none' }],
    })).toThrow('operations[0].capture must be final-thumbnail or full');

    expect(() => parseVesselCollaborationCommand({
      id: 'command-artwork-job-over-limit',
      action: 'artwork-job',
      runtimeFence,
      operations: Array.from({ length: 2001 }, () => ({
        action: 'set-tool',
        tool: 'brush',
      })),
    })).toThrow('artwork jobs cannot contain more than 2000 operations');
  });

  it('accepts revision waits and rejects invalid capture bounds', () => {
    expect(parseVesselCollaborationCommand({
      id: 'command-wait',
      action: 'wait-for-frame',
      afterRevision: 12,
      timeoutMs: 25000,
      capture: 'final-thumbnail',
      thumbnailMaxSize: 1024,
    })).toEqual({
      id: 'command-wait',
      action: 'wait-for-frame',
      afterRevision: 12,
      timeoutMs: 25000,
      capture: 'final-thumbnail',
      thumbnailMaxSize: 1024,
    });

    expect(() => parseVesselCollaborationCommand({
      id: 'command-capture-invalid',
      action: 'observe',
      capture: 'gigantic',
    })).toThrow('capture must be none, final-thumbnail, each-thumbnail, or full');
    expect(() => parseVesselCollaborationCommand({
      id: 'command-thumbnail-invalid',
      action: 'observe',
      thumbnailMaxSize: 2048,
    })).toThrow('thumbnailMaxSize must be between 256 and 1024');
  });

  it('rejects unsupported actions', () => {
    expect(() => parseVesselCollaborationCommand({
      id: 'command-5',
      action: 'replace-project-state',
    })).toThrow('unsupported action: replace-project-state');
  });

});
