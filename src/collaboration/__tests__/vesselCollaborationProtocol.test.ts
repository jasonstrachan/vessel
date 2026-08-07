import { parseVesselCollaborationCommand } from '../vesselCollaborationProtocol';

describe('parseVesselCollaborationCommand', () => {
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
