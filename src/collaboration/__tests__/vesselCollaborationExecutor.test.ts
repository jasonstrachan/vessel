import { getAppStoreState } from '@/stores/appStoreAccess';
import { deserializeProject } from '@/utils/projectIO';

import { dispatchVesselCollaborationStroke } from '../dispatchVesselCollaborationStroke';
import { createVesselCollaborationExecutor } from '../vesselCollaborationExecutor';

jest.mock('@/stores/appStoreAccess', () => ({
  getAppStoreState: jest.fn(),
}));

jest.mock('@/utils/projectIO', () => ({
  deserializeProject: jest.fn(),
}));

const mockedGetAppStoreState = getAppStoreState as jest.MockedFunction<typeof getAppStoreState>;
const mockedDeserializeProject = deserializeProject as jest.MockedFunction<typeof deserializeProject>;

describe('createVesselCollaborationExecutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
  });

  it('routes strokes through the canonical lifecycle and returns the rendered frame', async () => {
    const setCurrentTool = jest.fn();
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'AI paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 7 },
      setCurrentTool,
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>);

    const dispatchStroke = jest.fn(async () => undefined);
    const rebuildStaticComposite = jest.fn(async () => true);
    const requestRedraw = jest.fn();
    const canvas = {
      width: 512,
      height: 640,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;

    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite,
      requestRedraw,
    }));

    const result = await execute({
      id: 'command-1',
      action: 'stroke',
      tool: 'brush',
      points: [
        { x: 10, y: 20, pressure: 0.5 },
        { x: 30, y: 40, pressure: 0.75 },
        { x: 50, y: 60 },
      ],
    });

    expect(setCurrentTool).toHaveBeenCalledWith('brush');
    expect(dispatchStroke).toHaveBeenCalledWith(
      [
        { x: 10, y: 20, pressure: 0.5 },
        { x: 30, y: 40, pressure: 0.75 },
        { x: 50, y: 60 },
      ],
      { pointsPerFrame: 2 },
    );
    expect(rebuildStaticComposite).toHaveBeenCalledTimes(1);
    expect(requestRedraw).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      commandId: 'command-1',
      revision: 1,
      frame: {
        kind: 'thumbnail',
        width: 512,
        height: 640,
        sourceWidth: 512,
        sourceHeight: 640,
        dataUrl: 'data:image/png;base64,frame',
      },
      state: { activeLayerId: 'layer-1', dirtyRevision: 7 },
      profile: {
        mutationMs: expect.any(Number),
        presentationMs: expect.any(Number),
        captureMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });

    const observation = await execute({ id: 'command-2', action: 'observe' });
    expect(observation.revision).toBe(1);
  });

  it('refuses to draw on a locked layer', async () => {
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      layers: [{
        id: 'layer-1',
        name: 'Locked paint',
        layerType: 'normal',
        visible: true,
        locked: true,
        opacity: 1,
      }],
      tools: { currentTool: 'brush', brushSettings: {} },
      autosave: { dirtyRevision: 0 },
    } as unknown as ReturnType<typeof getAppStoreState>);

    const dispatchStroke = jest.fn();
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-locked',
      action: 'stroke',
      points: [{ x: 1, y: 1 }],
    });

    expect(result).toMatchObject({ ok: false, error: 'Active layer is locked: Locked paint' });
    expect(dispatchStroke).not.toHaveBeenCalled();
  });

  it('commits a two-stage shape as one operation with parity-safe pointer timing', async () => {
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'Shape paint',
        layerType: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: {
          size: 20,
          opacity: 1,
          color: '#112233',
          spacing: 1,
          shapeEnabled: true,
        },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
    } as unknown as ReturnType<typeof getAppStoreState>);
    const dispatchStroke = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    await execute({
      id: 'command-shape',
      action: 'shape',
      capture: 'none',
      pointsPerFrame: 2,
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      direction: [{ x: 20, y: 30 }, { x: 40, y: 30 }],
    });

    expect(dispatchStroke).toHaveBeenNthCalledWith(
      1,
      [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      { pointsPerFrame: 1 },
    );
    expect(dispatchStroke).toHaveBeenNthCalledWith(
      2,
      [{ x: 20, y: 30 }, { x: 40, y: 30 }],
      { pointsPerFrame: 1 },
    );
  });

  it('falls back to one pointer sample per frame for long strokes', async () => {
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Stroke paint',
        layerType: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: {
          size: 20,
          opacity: 1,
          color: '#112233',
          spacing: 1,
          shapeEnabled: false,
        },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
    } as unknown as ReturnType<typeof getAppStoreState>);
    const dispatchStroke = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));
    const points = Array.from({ length: 17 }, (_, index) => ({ x: index, y: index }));

    await execute({
      id: 'command-long-stroke',
      action: 'stroke',
      capture: 'none',
      points,
    });

    expect(dispatchStroke).toHaveBeenCalledWith(points, { pointsPerFrame: 1 });
  });

  it('imports a transferred project without opening a browser picker', async () => {
    const importedProject = {
      id: 'project-imported',
      name: 'Alan Turing',
      width: 2000,
      height: 2000,
      layers: [],
    };
    mockedDeserializeProject.mockResolvedValue(importedProject as never);
    const importProject = jest.fn(async () => undefined);
    const state = {
      project: importedProject,
      activeLayerId: null,
      layers: [],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      importProject,
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    const canvas = {
      width: 2000,
      height: 2000,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-open',
      action: 'open-project',
      fileName: 'turn-01-jason.vs',
      dataBase64: 'UEsDBA==',
    });

    expect(mockedDeserializeProject).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      lazyColorCycleRuntime: true,
    });
    expect(importProject).toHaveBeenCalledWith(importedProject, {
      fileName: 'turn-01-jason.vs',
      fileHandle: null,
    });
    expect(result).toMatchObject({ ok: true, action: 'open-project' });
  });

  it('selects a canonical brush preset by id', async () => {
    const preset = { id: 'color-cycle-flat-dither', name: 'CC Flat Dither' };
    const setBrushPreset = jest.fn();
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: null,
      currentBrushPreset: preset,
      layers: [],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      getBrushPresetById: jest.fn(() => preset),
      setBrushPreset,
    } as unknown as ReturnType<typeof getAppStoreState>);
    const canvas = {
      width: 512,
      height: 640,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;
    const rebuildStaticComposite = jest.fn(async () => true);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite,
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-preset',
      action: 'set-brush-preset',
      presetId: 'color-cycle-flat-dither',
    });

    expect(setBrushPreset).toHaveBeenCalledWith(preset);
    expect(result).toMatchObject({
      ok: true,
      action: 'set-brush-preset',
      state: { currentBrushPresetId: 'color-cycle-flat-dither' },
    });
    expect(rebuildStaticComposite).not.toHaveBeenCalled();
    expect(result.frame).toBeUndefined();
  });

  it('runs setup and gestures as one batch with a thumbnail per committed stroke', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'AI paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      setBrushSettings: jest.fn((settings) => {
        Object.assign(state.tools.brushSettings, settings);
      }),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);

    const dispatchStroke = jest.fn(async () => {
      state.autosave.dirtyRevision += 1;
    });
    const rebuildStaticComposite = jest.fn(async () => true);
    const canvas = {
      width: 512,
      height: 640,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite,
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-batch',
      action: 'batch',
      capture: 'each-thumbnail',
      operations: [
        { action: 'set-brush', settings: { fillResolution: 6 } },
        {
          action: 'stroke',
          pointsPerFrame: 2,
          points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
        },
        { action: 'set-brush', settings: { fillResolution: 3 } },
        {
          action: 'stroke',
          points: [{ x: 50, y: 60 }, { x: 70, y: 80 }],
        },
      ],
    });

    expect(dispatchStroke).toHaveBeenNthCalledWith(
      1,
      [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      { pointsPerFrame: 2 },
    );
    expect(dispatchStroke).toHaveBeenNthCalledWith(
      2,
      [{ x: 50, y: 60 }, { x: 70, y: 80 }],
      { pointsPerFrame: 2 },
    );
    expect(rebuildStaticComposite).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      frames: [
        { operationIndex: 1, revision: 1, frame: { kind: 'thumbnail' } },
        { operationIndex: 3, revision: 2, frame: { kind: 'thumbnail' } },
      ],
      profile: {
        operations: [
          { index: 0, action: 'set-brush', revision: 0 },
          { index: 1, action: 'stroke', revision: 1 },
          { index: 2, action: 'set-brush', revision: 1 },
          { index: 3, action: 'stroke', revision: 2 },
        ],
      },
    });
    expect(result.frame).toBeUndefined();
  });

  it('reports partial batch progress when a later operation fails', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: null,
      currentBrushPreset: null,
      layers: [],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      setBrushSettings: jest.fn(),
      getBrushPresetById: jest.fn(() => undefined),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-partial-batch',
      action: 'batch',
      capture: 'none',
      operations: [
        { action: 'set-brush', settings: { size: 24 } },
        { action: 'set-brush-preset', presetId: 'missing-preset' },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      completedOperations: 1,
      error: 'Brush preset not found: missing-preset',
      state: { project: { id: 'project-1' } },
      profile: {
        operations: [{ index: 0, action: 'set-brush' }],
      },
    });
  });

  it('waits for a later document revision and returns one thumbnail', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: null,
      currentBrushPreset: null,
      layers: [],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const canvas = {
      width: 512,
      height: 640,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    window.setTimeout(() => {
      state.autosave.dirtyRevision = 1;
    }, 5);
    const result = await execute({
      id: 'command-wait',
      action: 'wait-for-frame',
      afterRevision: 0,
      timeoutMs: 500,
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      timedOut: false,
      frame: { kind: 'thumbnail' },
    });
  });

  it('dispatches several pointer samples through one canonical coalesced move per frame', async () => {
    const originalPointerEvent = global.PointerEvent;
    class MockPointerEvent extends Event {
      clientX: number;
      clientY: number;
      pressure: number;
      buttons: number;

      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
        this.pressure = init.pressure ?? 0;
        this.buttons = init.buttons ?? 0;
      }
    }
    global.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

    try {
      const canvas = document.createElement('canvas');
      jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 10,
        top: 20,
      } as DOMRect);
      const dispatched: PointerEvent[] = [];
      ['pointerdown', 'pointermove', 'pointerup'].forEach((type) => {
        canvas.addEventListener(type, (event) => dispatched.push(event as PointerEvent));
      });
      const waitForFrame = jest.fn(async () => undefined);

      await dispatchVesselCollaborationStroke({
        canvas,
        pointsPerFrame: 3,
        zoom: 2,
        worldToScreen: (x, y, zoom) => ({ x: x * zoom, y: y * zoom }),
        isBusy: () => false,
        waitForFrame,
        points: [
          { x: 1, y: 2, pressure: 0.5 },
          { x: 3, y: 4, pressure: 0.6 },
          { x: 5, y: 6, pressure: 0.7 },
          { x: 7, y: 8, pressure: 0.8 },
          { x: 9, y: 10, pressure: 0.9 },
        ],
      });

      expect(dispatched.map((event) => event.type)).toEqual([
        'pointerdown',
        'pointermove',
        'pointermove',
        'pointerup',
      ]);
      const coalesced = dispatched[1].getCoalescedEvents();
      expect(coalesced).toHaveLength(3);
      expect(coalesced.map((event) => [event.clientX, event.clientY, event.pressure])).toEqual([
        [16, 28, 0.6],
        [20, 32, 0.7],
        [24, 36, 0.8],
      ]);
      expect(waitForFrame).toHaveBeenCalledTimes(5);
    } finally {
      global.PointerEvent = originalPointerEvent;
    }
  });
});
