import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { BrushShape } from '@/types';
import { setSharedColorCycleGradient } from '@/utils/colorCycleGradients';
import { deserializeProject } from '@/utils/projectIO';

import { dispatchVesselCollaborationStroke } from '../dispatchVesselCollaborationStroke';
import { createVesselCollaborationExecutor } from '../vesselCollaborationExecutor';
import type { VesselCollaborationExecutionEvent } from '../vesselCollaborationProtocol';
import {
  executeVesselMultiplayerGesture,
  getVesselMultiplayerSnapshot,
  startVesselMultiplayerSession,
  stopVesselMultiplayerSession,
} from '../vesselMultiplayerSession';

jest.mock('@/stores/appStoreAccess', () => ({
  getAppStoreState: jest.fn(),
}));

jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: jest.fn(),
}));

jest.mock('@/utils/projectIO', () => ({
  deserializeProject: jest.fn(),
}));

jest.mock('@/utils/colorCycleGradients', () => ({
  setSharedColorCycleGradient: jest.fn(),
}));

jest.mock('../vesselMultiplayerSession', () => ({
  executeVesselMultiplayerGesture: jest.fn(),
  getVesselMultiplayerSnapshot: jest.fn(() => ({
    sessionId: null,
    status: 'idle',
    humanLayerId: null,
    aiLayerId: null,
    activeGestureId: null,
    aiCursor: null,
    stopReason: null,
    error: null,
  })),
  startVesselMultiplayerSession: jest.fn(),
  stopVesselMultiplayerSession: jest.fn(),
}));

const mockedGetAppStoreState = getAppStoreState as jest.MockedFunction<typeof getAppStoreState>;
const mockedGetColorCycleBrushManager = getColorCycleBrushManager as jest.MockedFunction<
  typeof getColorCycleBrushManager
>;
const mockedDeserializeProject = deserializeProject as jest.MockedFunction<typeof deserializeProject>;
const mockedSetSharedColorCycleGradient = setSharedColorCycleGradient as jest.MockedFunction<
  typeof setSharedColorCycleGradient
>;
const mockedExecuteVesselMultiplayerGesture = executeVesselMultiplayerGesture as jest.MockedFunction<
  typeof executeVesselMultiplayerGesture
>;
const mockedStartVesselMultiplayerSession = startVesselMultiplayerSession as jest.MockedFunction<
  typeof startVesselMultiplayerSession
>;
const mockedStopVesselMultiplayerSession = stopVesselMultiplayerSession as jest.MockedFunction<
  typeof stopVesselMultiplayerSession
>;
void getVesselMultiplayerSnapshot;
const originalCreateImageBitmap = globalThis.createImageBitmap;

describe('createVesselCollaborationExecutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetColorCycleBrushManager.mockReturnValue({
      getDocument: jest.fn(() => undefined),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    mockedSetSharedColorCycleGradient.mockImplementation((stops) => {
      getAppStoreState().setBrushSettings({
        colorCycleGradient: stops,
        ccGradientSource: 'manual',
        colorCycleUseForegroundGradient: false,
        autoSampleGradient: false,
        autoSampleGradientRealtime: false,
      });
    });
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
  });

  it('routes multiplayer commands without changing Jason\'s active tool or layer', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 100, height: 100 },
      activeLayerId: 'jason-layer',
      currentBrushPreset: null,
      layers: [],
      tools: { currentTool: 'brush', brushSettings: { size: 10, opacity: 1, spacing: 1 } },
      palette: { foregroundColor: '#000000', backgroundColor: '#ffffff', activeSlot: 'foreground' },
      autosave: { dirtyRevision: 0 },
      brushPresets: [],
      ccGradientSampleCount: 0,
      colorPickerPreferReferenceLayer: true,
      referenceLayerId: null,
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    mockedStartVesselMultiplayerSession.mockResolvedValue({ status: 'active' } as never);
    mockedExecuteVesselMultiplayerGesture.mockResolvedValue({ status: 'active' } as never);
    const runtime = {
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
      scheduleHistoryCommit: jest.fn(async () => undefined),
    };
    const execute = createVesselCollaborationExecutor(() => runtime);

    await execute({
      id: 'start',
      action: 'multiplayer-start',
      sessionId: 'portrait-together',
    });
    await execute({
      id: 'gesture',
      action: 'multiplayer-gesture',
      sessionId: 'portrait-together',
      gestureId: 'ai-1',
      actor: 'ai',
      kind: 'stroke',
      points: [{ x: 1, y: 2 }],
    });
    await execute({
      id: 'stop',
      action: 'multiplayer-stop',
      sessionId: 'portrait-together',
    });

    expect(mockedStartVesselMultiplayerSession).toHaveBeenCalledWith({
      sessionId: 'portrait-together',
    });
    expect(mockedExecuteVesselMultiplayerGesture).toHaveBeenCalledWith(
      expect.objectContaining({ gestureId: 'ai-1', actor: 'ai' }),
      runtime,
      undefined,
    );
    expect(mockedStopVesselMultiplayerSession).toHaveBeenCalledWith({
      sessionId: 'portrait-together',
    });
    expect(state.activeLayerId).toBe('jason-layer');
    expect(state.tools.currentTool).toBe('brush');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.createImageBitmap = originalCreateImageBitmap;
  });

  it('creates a new project through the canonical project lifecycle', async () => {
    const state = {
      project: { id: 'project-old', name: 'Old', width: 1024, height: 512 },
      activeLayerId: 'layer-old',
      currentBrushPreset: null,
      layers: [],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 10 },
      newProject: jest.fn(),
    } as unknown as ReturnType<typeof getAppStoreState>;
    (state.newProject as jest.Mock).mockImplementation((width, height, name) => {
      state.project = { ...state.project!, id: 'project-new', name, width, height };
      state.activeLayerId = 'layer-new-cc';
      state.autosave.dirtyRevision = 11;
    });
    mockedGetAppStoreState.mockImplementation(() => state);
    const rebuildStaticComposite = jest.fn(async () => true);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite,
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-new-project',
      action: 'new-project',
      width: 512,
      height: 640,
      name: 'Sea Light Study',
      capture: 'none',
    });

    expect(state.newProject).toHaveBeenCalledWith(512, 640, 'Sea Light Study');
    expect(rebuildStaticComposite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      action: 'new-project',
      revision: 1,
      state: {
        project: { id: 'project-new', name: 'Sea Light Study', width: 512, height: 640 },
        activeLayerId: 'layer-new-cc',
      },
    });
  });

  it('imports, bottoms, and marks a reference image through canonical layer actions', async () => {
    const imageData = { width: 512, height: 640 } as ImageData;
    const context = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => imageData),
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
    const framebuffer = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context),
    } as unknown as HTMLCanvasElement;
    jest.spyOn(document, 'createElement').mockReturnValueOnce(framebuffer);
    const bitmap = { width: 1077, height: 1350, close: jest.fn() } as unknown as ImageBitmap;
    globalThis.createImageBitmap = jest.fn(async () => bitmap) as typeof createImageBitmap;

    const state = {
      project: { id: 'project-1', name: 'Study', width: 512, height: 640 },
      activeLayerId: 'layer-cc',
      referenceLayerId: null,
      colorPickerPreferReferenceLayer: false,
      currentBrushPreset: null,
      layers: [
        { id: 'layer-normal', name: 'Layer 1', layerType: 'normal', visible: true, locked: false, opacity: 1 },
        { id: 'layer-cc', name: 'CC Layer 1', layerType: 'color-cycle', visible: true, locked: false, opacity: 1 },
      ],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 8, opacity: 1, color: '#000000', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      addLayer: jest.fn(),
      reorderLayers: jest.fn(),
      setReferenceLayer: jest.fn(),
      setColorPickerPreferReferenceLayer: jest.fn(),
    } as unknown as ReturnType<typeof getAppStoreState>;
    (state.addLayer as jest.Mock).mockImplementation((layer) => {
      state.layers.push({ ...layer, id: 'layer-reference', order: state.layers.length });
      state.activeLayerId = 'layer-reference';
      return 'layer-reference';
    });
    (state.reorderLayers as jest.Mock).mockImplementation((sourceIndex, destinationIndex) => {
      const [layer] = state.layers.splice(sourceIndex, 1);
      state.layers.splice(destinationIndex, 0, layer);
    });
    (state.setReferenceLayer as jest.Mock).mockImplementation((layerId) => {
      state.referenceLayerId = layerId;
    });
    (state.setColorPickerPreferReferenceLayer as jest.Mock).mockImplementation((prefer) => {
      state.colorPickerPreferReferenceLayer = prefer;
    });
    mockedGetAppStoreState.mockImplementation(() => state);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-reference-image',
      action: 'import-reference-image',
      fileName: 'reference.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw==',
      fit: 'cover',
      capture: 'none',
    });

    expect(state.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'reference.png',
      layerType: 'normal',
      imageData,
      framebuffer,
    }));
    expect(state.reorderLayers).toHaveBeenCalledWith(2, 0);
    expect(state.setReferenceLayer).toHaveBeenCalledWith('layer-reference');
    expect(state.setColorPickerPreferReferenceLayer).toHaveBeenCalledWith(true);
    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      state: {
        activeLayerId: 'layer-reference',
        referenceLayerId: 'layer-reference',
        preferReferenceSampling: true,
      },
    });
  });

  it('changes layer visibility through the canonical multi-layer action', async () => {
    const setLayersVisibility = jest.fn();
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Study', width: 512, height: 640 },
      activeLayerId: 'layer-reference',
      referenceLayerId: 'layer-reference',
      colorPickerPreferReferenceLayer: true,
      currentBrushPreset: null,
      layers: [{
        id: 'layer-reference',
        name: 'reference.png',
        layerType: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 8, opacity: 1, color: '#000000', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      setLayersVisibility,
    } as unknown as ReturnType<typeof getAppStoreState>);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-hide-reference',
      action: 'set-layer-visibility',
      layerId: 'layer-reference',
      visible: false,
      capture: 'none',
    });

    expect(setLayersVisibility).toHaveBeenCalledWith(['layer-reference'], false);
    expect(result.ok).toBe(true);
  });

  it('captures the complete document composite instead of the viewport canvas', async () => {
    const compositeLayersToCanvasSync = jest.fn(() => true);
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: null,
      currentBrushPreset: null,
      layers: [],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      compositeLayersToCanvasSync,
    } as unknown as ReturnType<typeof getAppStoreState>);
    const documentCanvas = {
      width: 0,
      height: 0,
      toDataURL: jest.fn(() => 'data:image/png;base64,document-frame'),
    } as unknown as HTMLCanvasElement;
    jest.spyOn(document, 'createElement').mockReturnValueOnce(documentCanvas);
    const viewportCanvas = {
      width: 1351,
      height: 1080,
      toDataURL: jest.fn(() => 'data:image/png;base64,viewport-frame'),
    } as unknown as HTMLCanvasElement;
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: viewportCanvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-observe-document',
      action: 'observe',
      capture: 'final-thumbnail',
    });

    expect(compositeLayersToCanvasSync).toHaveBeenCalledWith(documentCanvas);
    expect(viewportCanvas.toDataURL).not.toHaveBeenCalled();
    expect(result.frame).toMatchObject({
      width: 512,
      height: 640,
      sourceWidth: 512,
      sourceHeight: 640,
      dataUrl: 'data:image/png;base64,document-frame',
    });
  });

  it('reports canonical sampled Color Cycle paint evidence instead of transient brush sampling', async () => {
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 2, height: 2 },
      activeLayerId: 'layer-cc',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-cc',
        name: 'Portrait paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
        colorCycleData: {
          canvasWidth: 2,
          canvasHeight: 2,
          hasContent: true,
          gradientDefIdBuffer: new Uint16Array([0, 7, 7, 9]).buffer,
          gradientDefStore: [
            {
              id: 7,
              kind: 'linear',
              source: 'sampled',
              hash: 'sampled-hash',
              createdAtMs: 20,
              stops: [
                { position: 0, color: '#6f89bd' },
                { position: 1, color: '#d5d0c8' },
              ],
            },
            {
              id: 9,
              kind: 'linear',
              source: 'manual',
              hash: 'manual-hash',
              createdAtMs: 30,
              stops: [
                { position: 0, color: '#000000' },
                { position: 1, color: '#ffffff' },
              ],
            },
          ],
        },
      }],
      tools: {
        currentTool: 'brush',
        ccGradientSource: 'sampled',
        brushSettings: {
          size: 8,
          opacity: 1,
          color: '#000000',
          spacing: 1,
          colorCycleGradient: [
            { position: 0, color: '#111111' },
            { position: 1, color: '#eeeeee' },
          ],
        },
      },
      ccGradientSampleCount: 0,
      autosave: { dirtyRevision: 1 },
    } as unknown as ReturnType<typeof getAppStoreState>);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-observe-sampled-paint',
      action: 'observe',
      capture: 'none',
    });

    expect(result.state).toMatchObject({
      gradient: { sampleCount: 0 },
      colorCycle: {
        hasContent: true,
        gradientDefinitionCount: 2,
        sampledGradientDefinitionCount: 1,
        sampledPaintedPixelCount: 2,
        latestSampledGradient: {
          id: 7,
          stopCount: 2,
          uniqueColorCount: 2,
          stops: [
            { position: 0, color: '#6f89bd' },
            { position: 1, color: '#d5d0c8' },
          ],
        },
      },
    });
  });

  it('routes strokes through the canonical lifecycle and returns the rendered frame', async () => {
    const setCurrentTool = jest.fn();
    mockedGetAppStoreState.mockReturnValue({
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
      revision: 0,
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
    expect(observation.revision).toBe(0);
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
        layerType: 'color-cycle',
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
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
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
      { pointsPerFrame: 1, framePacing: 'finalize-only' },
    );
    expect(dispatchStroke).toHaveBeenNthCalledWith(
      2,
      [{ x: 20, y: 30 }, { x: 40, y: 30 }],
      { pointsPerFrame: 1, framePacing: 'finalize-only' },
    );
  });

  it('delivers every shape point rapidly while preserving the two-stage lifecycle', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'Shape paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 8, opacity: 1, shapeEnabled: true },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    const dispatchStroke = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));
    const points = Array.from({ length: 20 }, (_, index) => ({
      x: 100 + index,
      y: 100 + (index % 4),
    }));

    await execute({
      id: 'command-fast-shape',
      action: 'shape',
      capture: 'none',
      points,
      direction: [{ x: 105, y: 105 }, { x: 115, y: 105 }],
    });

    expect(dispatchStroke).toHaveBeenNthCalledWith(1, points, {
      pointsPerFrame: 1,
      framePacing: 'finalize-only',
    });
    expect(dispatchStroke).toHaveBeenNthCalledWith(2, [
      { x: 105, y: 105 },
      { x: 115, y: 105 },
    ], { pointsPerFrame: 1, framePacing: 'finalize-only' });
  });

  it('returns canonical changed-pixel evidence for a committed Color Cycle shape', async () => {
    const paint = new Uint8Array(16);
    const gradientDefIds = new Uint16Array(16);
    let documentVersion = 1;
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 4, height: 4 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'Shape paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 8, opacity: 1, shapeEnabled: true },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    mockedGetColorCycleBrushManager.mockReturnValue({
      getDocument: jest.fn(() => ({
        read: () => ({
          version: documentVersion,
          snapshot: {
            layerId: 'layer-1',
            width: 4,
            height: 4,
            paintBuffer: paint.buffer,
            gradientDefIdBuffer: gradientDefIds.buffer,
            gradientDefStore: [],
            hasContent: true,
            sources: { brushStateSnapshot: false, topLevelBuffers: true, legacyStateRefs: false },
          },
        }),
      })),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    const dispatchStroke = jest.fn(async () => {
      if (dispatchStroke.mock.calls.length === 2) {
        paint[5] = 7;
        gradientDefIds[5] = 11;
        state.autosave.dirtyRevision += 1;
        documentVersion += 1;
      }
    });
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-shape-evidence',
      action: 'shape',
      capture: 'none',
      phase: 'establish',
      points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
      direction: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      markEvidence: {
        layerId: 'layer-1',
        markType: 'shape',
        phase: 'establish',
        status: 'committed',
        changedPixels: 1,
        normalizedCoverage: 1 / 16,
        dirtyRevisionDelta: 1,
        documentVersionDelta: 1,
      },
    });
  });

  it('reports cumulative authored-buffer coverage for a fenced priority mask', async () => {
    const paint = new Uint8Array(16);
    const gradientDefIds = new Uint16Array(16);
    let documentVersion = 1;
    const state = {
      project: { id: 'project-1', name: 'Study', width: 4, height: 4 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'Paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 8, opacity: 1, shapeEnabled: true },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    mockedGetColorCycleBrushManager.mockReturnValue({
      getDocument: jest.fn(() => ({
        read: () => ({
          version: documentVersion,
          snapshot: {
            layerId: 'layer-1',
            width: 4,
            height: 4,
            paintBuffer: paint.buffer,
            gradientDefIdBuffer: gradientDefIds.buffer,
            gradientDefStore: [],
            hasContent: true,
            sources: { brushStateSnapshot: false, topLevelBuffers: true, legacyStateRefs: false },
          },
        }),
      })),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    const dispatchStroke = jest.fn(async () => {
      if (dispatchStroke.mock.calls.length === 2) {
        paint[5] = 9;
        gradientDefIds[5] = 2;
        state.autosave.dirtyRevision = 1;
        documentVersion = 2;
      }
    });
    const canvas = {
      width: 4,
      height: 4,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;
    const checkpointEvents: VesselCollaborationExecutionEvent[] = [];
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'coverage-job',
      action: 'artwork-job',
      runtimeFence: {
        protocolVersion: 4,
        runtimeBuildId: 'test',
        runtimeInstanceId: 'runtime',
        leaseEpoch: 1,
        expectedProjectId: 'project-1',
        expectedProjectRevision: 0,
        expectedCheckpointId: null,
      },
      priorityCoverage: {
        priorityMaskId: 'face-priority',
        priorityMaskFingerprint: 'mask-fingerprint',
        coverageBaselineRevision: 0,
        width: 4,
        height: 4,
        spans: [{ y: 1, xStart: 1, xEndExclusive: 3 }],
      },
      operations: [
        {
          id: 'face-light-1',
          action: 'shape',
          phase: 'deepen',
          points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
          direction: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        },
        { action: 'checkpoint', name: 'focal-1', capture: 'full' },
      ],
    }, {
      onEvent: async (event) => {
        checkpointEvents.push(event);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      checkpointId: 'coverage-job:focal-1',
      committedOperationIds: ['face-light-1'],
      priorityCoverage: {
        priorityMaskId: 'face-priority',
        maskPixels: 2,
        uniqueMeaningfullyChangedPixels: 1,
        cumulativePercentage: 0.5,
        baselineRevision: 0,
        currentRevision: 1,
      },
    });
    expect(checkpointEvents.at(-1)).toMatchObject({
      type: 'checkpoint',
      checkpointId: 'coverage-job:focal-1',
      priorityCoverage: { cumulativePercentage: 0.5 },
    });
  });

  it('returns committed operation IDs and the authoritative revision after partial failure', async () => {
    const paint = new Uint8Array(16);
    const gradientDefIds = new Uint16Array(16);
    let documentVersion = 1;
    const state = {
      project: { id: 'project-1', name: 'Study', width: 4, height: 4 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 1, opacity: 1, shapeEnabled: false },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    mockedGetColorCycleBrushManager.mockReturnValue({
      getDocument: jest.fn(() => ({
        read: () => ({
          version: documentVersion,
          snapshot: {
            layerId: 'layer-1',
            width: 4,
            height: 4,
            paintBuffer: paint.buffer,
            gradientDefIdBuffer: gradientDefIds.buffer,
            gradientDefStore: [],
            hasContent: true,
            sources: { brushStateSnapshot: false, topLevelBuffers: true, legacyStateRefs: false },
          },
        }),
      })),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    const dispatchStroke = jest.fn(async () => {
      if (dispatchStroke.mock.calls.length === 1) {
        paint[5] = 1;
        gradientDefIds[5] = 1;
        state.autosave.dirtyRevision = 1;
        documentVersion = 2;
        return;
      }
      throw new Error('synthetic second-operation failure');
    });
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'partial-job',
      action: 'artwork-job',
      runtimeFence: {
        protocolVersion: 4,
        runtimeBuildId: 'test',
        runtimeInstanceId: 'runtime',
        leaseEpoch: 1,
        expectedProjectId: 'project-1',
        expectedProjectRevision: 0,
        expectedCheckpointId: null,
      },
      operations: [
        { id: 'committed-stroke', action: 'stroke', phase: 'deepen', points: [{ x: 1, y: 1 }] },
        { id: 'failed-stroke', action: 'stroke', phase: 'deepen', points: [{ x: 2, y: 2 }] },
        { action: 'checkpoint', name: 'must-not-exist' },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      revision: 1,
      checkpointId: null,
      completedOperations: 1,
      committedOperationIds: ['committed-stroke'],
      outcome: { execution: 'failed', checkpoint: 'missing' },
      error: 'synthetic second-operation failure',
    });
    expect(dispatchStroke).toHaveBeenCalledTimes(2);
  });

  it('rejects a completed pointer lifecycle with no canonical Color Cycle delta', async () => {
    const paint = new Uint8Array(16);
    const gradientDefIds = new Uint16Array(16);
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 4, height: 4 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'Shape paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 8, opacity: 1, shapeEnabled: true },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    mockedGetColorCycleBrushManager.mockReturnValue({
      getDocument: jest.fn(() => ({
        read: () => ({
          version: 1,
          snapshot: {
            layerId: 'layer-1',
            width: 4,
            height: 4,
            paintBuffer: paint.buffer,
            gradientDefIdBuffer: gradientDefIds.buffer,
            gradientDefStore: [],
            hasContent: false,
            sources: { brushStateSnapshot: false, topLevelBuffers: true, legacyStateRefs: false },
          },
        }),
      })),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(async () => undefined),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-shape-no-delta',
      action: 'shape',
      capture: 'none',
      phase: 'establish',
      points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
      direction: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 0,
      markEvidence: {
        layerId: 'layer-1',
        markType: 'shape',
        phase: 'establish',
        status: 'rejected',
        changedPixels: 0,
        normalizedCoverage: 0,
        dirtyRevisionDelta: 0,
        rejectionReason: 'no-authored-delta',
      },
    });
  });

  it('falls back to one pointer sample per frame for long strokes', async () => {
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: null,
      layers: [{
        id: 'layer-1',
        name: 'Stroke paint',
        layerType: 'color-cycle',
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
          brushShape: BrushShape.COLOR_CYCLE,
        },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
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

  it('creates and activates a Color Cycle layer through the layer store', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'CC Layer 3',
        layerType: 'color-cycle',
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
          colorCycleGradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
          colorCycleFlowMode: 'reverse',
        },
      },
      autosave: { dirtyRevision: 0 },
      addLayer: jest.fn(),
      initColorCycleForLayer: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    (state.addLayer as jest.Mock).mockImplementation((layer) => {
      const id = 'layer-created';
      state.layers.push({ ...layer, id, order: 1 });
      state.activeLayerId = id;
      state.autosave.dirtyRevision += 1;
      return id;
    });
    mockedGetAppStoreState.mockImplementation(() => state);
    const rebuildStaticComposite = jest.fn();
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite,
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-create-layer',
      action: 'create-layer',
      layerType: 'color-cycle',
    });

    expect(state.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'CC Layer 4',
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        isAnimating: true,
        flowMode: 'reverse',
      },
    }));
    expect(state.ensureColorCycleLayerRuntime).toHaveBeenCalledWith('layer-created', {
      target: 'active',
    });
    expect(state.initColorCycleForLayer).toHaveBeenCalledWith('layer-created', 512, 640);
    expect((state.initColorCycleForLayer as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (state.ensureColorCycleLayerRuntime as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      state: { activeLayerId: 'layer-created' },
    });
    expect(result.frame).toBeUndefined();
    expect(rebuildStaticComposite).not.toHaveBeenCalled();
  });

  it('erases through the canonical stroke path on a Color Cycle layer', async () => {
    const setCurrentTool = jest.fn();
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'pixel-square' },
      layers: [{
        id: 'layer-1',
        name: 'CC details',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
        eraserSettings: { linkSizeToBrush: true, opacity: 1 },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool,
      setShapeMode: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>);
    const dispatchStroke = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-erase',
      action: 'stroke',
      tool: 'eraser',
      capture: 'none',
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    });

    expect(setCurrentTool).toHaveBeenCalledWith('eraser');
    expect(dispatchStroke).toHaveBeenCalledWith(
      [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      { pointsPerFrame: 2 },
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a Color Cycle brush on a normal layer before dispatching pointers', async () => {
    const setCurrentTool = jest.fn();
    mockedGetAppStoreState.mockReturnValue({
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
        layerType: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1 },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool,
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
      id: 'command-wrong-layer',
      action: 'stroke',
      capture: 'none',
      points: [{ x: 10, y: 20 }],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Color Cycle brush requires a Color Cycle layer: Layer 1',
    });
    expect(setCurrentTool).not.toHaveBeenCalled();
    expect(dispatchStroke).not.toHaveBeenCalled();
  });

  it('applies palette, gradient, dither, and eraser controls through canonical store actions', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      brushPresets: [{
        id: 'color-cycle-flat-dither',
        name: 'CC Flat Dither',
        category: 'Color Cycle',
        isCustomBrush: false,
      }],
      layers: [{
        id: 'layer-1',
        name: 'CC Layer 1',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      palette: {
        foregroundColor: '#000000',
        backgroundColor: '#ffffff',
        activeSlot: 'foreground',
      },
      tools: {
        currentTool: 'brush',
        ccGradientSource: 'manual',
        brushSettings: {
          size: 20,
          opacity: 1,
          color: '#000000',
          spacing: 1,
          colorCycleGradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
        },
        eraserSettings: {
          size: 20,
          opacity: 1,
          linkSizeToBrush: true,
          brushShape: BrushShape.SQUARE,
        },
      },
      ccGradientSampleCount: 7,
      autosave: { dirtyRevision: 0 },
      setPaletteColor: jest.fn((slot, color) => {
        if (slot === 'foreground') state.palette.foregroundColor = color;
        else state.palette.backgroundColor = color;
      }),
      swapPaletteColors: jest.fn(),
      setActivePaletteSlot: jest.fn((slot) => {
        state.palette.activeSlot = slot;
      }),
      setCcGradientSource: jest.fn((source) => {
        state.tools.ccGradientSource = source;
      }),
      setBrushSettings: jest.fn((settings) => {
        Object.assign(state.tools.brushSettings, settings);
        if (settings.ccGradientSource) {
          state.tools.ccGradientSource = settings.ccGradientSource;
        }
      }),
      resetCcGradientSample: jest.fn(() => {
        state.ccGradientSampleCount = 0;
      }),
      setEraserSettings: jest.fn((settings) => {
        Object.assign(state.tools.eraserSettings, settings);
      }),
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
      id: 'command-paint-controls',
      action: 'batch',
      capture: 'none',
      operations: [
        {
          action: 'set-palette',
          foreground: '#123456',
          background: '#abcdef',
          activeSlot: 'background',
        },
        { action: 'set-gradient-source', source: 'fg' },
        {
          action: 'set-gradient',
          stops: [
            { position: 0, color: '#112233' },
            { position: 1, color: '#ddeeff' },
          ],
          foreground: { lightness: 35, hueShift: 20, stopCount: 4 },
          resetSample: true,
        },
        {
          action: 'set-brush',
          settings: {
            ditherEnabled: true,
            ditherAlgorithm: 'sierra-lite',
            fillResolution: 6,
            colorCycleStampDitherEnabled: true,
            colorCycleStampDitherPixelSize: 5,
            colorCycleSpeed: 0.5,
          },
        },
        {
          action: 'set-eraser',
          settings: { size: 12, opacity: 0.6, linkSizeToBrush: false, tip: 'diamond5' },
        },
      ],
    });

    expect(state.setPaletteColor).toHaveBeenNthCalledWith(1, 'foreground', '#123456');
    expect(state.setPaletteColor).toHaveBeenNthCalledWith(2, 'background', '#abcdef');
    expect(state.setActivePaletteSlot).toHaveBeenCalledWith('background');
    expect(state.setCcGradientSource).toHaveBeenCalledWith('fg');
    expect(mockedSetSharedColorCycleGradient).toHaveBeenCalledWith([
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ], { fork: true });
    expect(state.setBrushSettings).toHaveBeenNthCalledWith(1, {
      colorCycleGradient: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#ddeeff' },
      ],
      ccGradientSource: 'manual',
      colorCycleUseForegroundGradient: false,
      autoSampleGradient: false,
      autoSampleGradientRealtime: false,
    });
    expect(state.setBrushSettings).toHaveBeenNthCalledWith(2, {
      colorCycleFgLightness: 35,
      colorCycleFgHueShift: 20,
      colorCycleFgStops: 4,
    });
    expect(state.setBrushSettings).toHaveBeenNthCalledWith(3, {
      ditherEnabled: true,
      ditherAlgorithm: 'sierra-lite',
      fillResolution: 6,
      colorCycleStampDitherEnabled: true,
      colorCycleStampDitherPixelSize: 5,
      colorCycleSpeed: 0.5,
    });
    expect(state.resetCcGradientSample).toHaveBeenCalledTimes(1);
    expect(state.setEraserSettings).toHaveBeenCalledWith(expect.objectContaining({
      size: 12,
      opacity: 0.6,
      linkSizeToBrush: false,
      brushShape: BrushShape.PIXEL_DITHER,
      ditherStrokeTipShape: 'diamond5',
      antialiasing: false,
    }));
    expect(result).toMatchObject({
      ok: true,
      completedOperations: 5,
      state: {
        currentBrushCapabilities: { canDither: false, forceDither: true },
        palette: {
          foreground: '#123456',
          background: '#abcdef',
          activeSlot: 'background',
        },
        gradient: {
          source: 'manual',
          sampleCount: 0,
          foreground: { lightness: 35, hueShift: 20, stopCount: 4 },
        },
        brush: {
          ditherEnabled: true,
          ditherAlgorithm: 'sierra-lite',
          fillResolution: 6,
          colorCycleStampDitherEnabled: true,
          colorCycleStampDitherPixelSize: 5,
          colorCycleSpeed: 0.5,
        },
        eraser: {
          size: 12,
          opacity: 0.6,
          linkSizeToBrush: false,
          tip: 'diamond5',
        },
      },
    });
  });

  it('restores the brush tool for a shape after an eraser command', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'dither-shape' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
        layerType: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: { size: 20, opacity: 1, color: '#112233', spacing: 1, shapeEnabled: true },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn((tool) => {
        state.tools.currentTool = tool;
      }),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const dispatchStroke = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(),
      requestRedraw: jest.fn(),
    }));

    await execute({
      id: 'command-shape-after-erase',
      action: 'batch',
      capture: 'none',
      operations: [
        { action: 'set-tool', tool: 'eraser' },
        {
          action: 'shape',
          points: [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 5, y: 10 }],
        },
      ],
    });

    expect(state.setCurrentTool).toHaveBeenNthCalledWith(1, 'eraser');
    expect(state.setCurrentTool).toHaveBeenNthCalledWith(2, 'brush');
    expect(dispatchStroke).toHaveBeenCalledTimes(1);
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

  it('captures named checkpoints inside one batch without a redundant final frame', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
      setShapeMode: jest.fn(),
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
      id: 'command-checkpoints',
      action: 'batch',
      operations: [
        { action: 'stroke', points: [{ x: 10, y: 20 }] },
        { action: 'checkpoint', name: 'landscape' },
        { action: 'stroke', points: [{ x: 30, y: 40 }] },
        { action: 'checkpoint', name: 'final-hat' },
      ],
    });

    expect(rebuildStaticComposite).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      completedOperations: 4,
      frames: [
        {
          operationIndex: 1,
          revision: 1,
          checkpointName: 'landscape',
          frame: { kind: 'thumbnail' },
        },
        {
          operationIndex: 3,
          revision: 2,
          checkpointName: 'final-hat',
          frame: { kind: 'thumbnail' },
        },
      ],
      profile: {
        operations: [
          { index: 0, action: 'stroke', revision: 1 },
          { index: 1, action: 'checkpoint', revision: 1, mutationMs: 0 },
          { index: 2, action: 'stroke', revision: 2 },
          { index: 3, action: 'checkpoint', revision: 2, mutationMs: 0 },
        ],
      },
    });
    expect(result.frame).toBeUndefined();
  });

  it('streams artwork-job progress and cancels safely between completed marks', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
      setShapeMode: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);

    const commandAbortController = new AbortController();
    const dispatchStroke = jest.fn(async () => {
      state.autosave.dirtyRevision += 1;
      commandAbortController.abort();
    });
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));
    const events: Array<{ type: string; completedOperations?: number }> = [];

    const result = await execute({
      id: 'command-artwork-job-cancel',
      action: 'artwork-job',
      capture: 'none',
      operations: [
        { action: 'stroke', phase: 'establish', points: [{ x: 10, y: 20 }] },
        { action: 'stroke', phase: 'establish', points: [{ x: 30, y: 40 }] },
        { action: 'stroke', phase: 'establish', points: [{ x: 50, y: 60 }] },
        { action: 'checkpoint', name: 'primary-masses' },
      ],
    }, {
      signal: commandAbortController.signal,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(dispatchStroke).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: 'validated', totalOperations: 4 },
      { type: 'progress', completedOperations: 1, totalOperations: 4, revision: 1 },
    ]);
    expect(result).toMatchObject({
      ok: true,
      action: 'artwork-job',
      revision: 1,
      completedOperations: 1,
      cancelled: true,
    });
  });

  it('keeps maximum-size artwork-job progress within the retained event budget', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
    const events: Array<{ type: string }> = [];

    const result = await execute({
      id: 'command-artwork-job-progress-budget',
      action: 'artwork-job',
      capture: 'none',
      operations: [
        ...Array.from({ length: 1999 }, () => ({
          action: 'set-tool' as const,
          tool: 'brush' as const,
        })),
        { action: 'checkpoint' as const, name: 'final' },
      ],
    }, {
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({ ok: true, completedOperations: 2000 });
    expect(events.filter((event) => event.type === 'progress')).toHaveLength(223);
    expect(events).toHaveLength(225);
  });

  it('rejects an artwork job before its first mark when any gesture starts outside', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const dispatchStroke = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-artwork-job-invalid-start',
      action: 'artwork-job',
      capture: 'none',
      operations: [
        { action: 'stroke', phase: 'establish', points: [{ x: 10, y: 20 }] },
        { action: 'stroke', phase: 'establish', points: [{ x: -1, y: 40 }] },
        { action: 'checkpoint', name: 'primary-masses' },
      ],
    });

    expect(dispatchStroke).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      completedOperations: undefined,
      error: 'operations[1].points[0] must be inside the project canvas',
    });
  });

  it('rejects malformed geometry before any artwork-job mark reaches Vessel', async () => {
    const paint = new Uint8Array(100);
    const gradientDefIds = new Uint16Array(100);
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 10, height: 10 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
        layerType: 'color-cycle',
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
      setShapeMode: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    mockedGetColorCycleBrushManager.mockReturnValue({
      getDocument: jest.fn(() => ({
        read: () => ({
          version: 7,
          snapshot: {
            layerId: 'layer-1',
            width: 10,
            height: 10,
            paintBuffer: paint.buffer,
            gradientDefIdBuffer: gradientDefIds.buffer,
            gradientDefStore: [],
            hasContent: true,
            sources: { brushStateSnapshot: false, topLevelBuffers: true, legacyStateRefs: false },
          },
        }),
      })),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    const canvas = {
      width: 10,
      height: 10,
      toDataURL: jest.fn(() => 'data:image/png;base64,frame'),
    } as unknown as HTMLCanvasElement;
    const dispatchStroke = jest.fn(async () => {
      state.autosave.dirtyRevision += 1;
    });
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }), { enforceGeometryPreflight: true });

    const result = await execute({
      id: 'command-artwork-job-candidate-rejection',
      action: 'artwork-job',
      capture: 'none',
      operations: [
        {
          action: 'shape',
          phase: 'establish',
          points: [
            { x: 1, y: 1 },
            { x: 8, y: 8 },
            { x: 1, y: 8 },
            { x: 8, y: 1 },
          ],
        },
        { action: 'stroke', phase: 'establish', points: [{ x: 2, y: 2 }] },
        { action: 'checkpoint', name: 'primary-masses' },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      completedOperations: undefined,
      error: 'operations[0].points must not self-intersect',
    });
    expect(dispatchStroke).not.toHaveBeenCalled();
  });

  it('does not let candidate geometry rejection bypass a hard layer contract', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 10, height: 10 },
      activeLayerId: 'normal-layer',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'normal-layer',
        name: 'Wrong paint layer',
        layerType: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        brushSettings: {
          size: 8,
          opacity: 1,
          shapeEnabled: true,
          brushShape: BrushShape.COLOR_CYCLE,
        },
      },
      autosave: { dirtyRevision: 0 },
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockReturnValue(state);
    const dispatchStroke = jest.fn();
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }), { enforceGeometryPreflight: true });

    const result = await execute({
      id: 'command-artwork-job-invalid-shape-wrong-layer',
      action: 'artwork-job',
      capture: 'none',
      operations: [
        {
          action: 'shape',
          phase: 'establish',
          points: [
            { x: 1, y: 1 },
            { x: 8, y: 1 },
            { x: 8, y: 8 },
            { x: 1, y: 8 },
          ],
        },
        { action: 'checkpoint', name: 'must-not-present' },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Color Cycle brush requires a Color Cycle layer: Wrong paint layer',
    });
    expect(dispatchStroke).not.toHaveBeenCalled();
  });

  it('settles presentation-side document revisions before returning a fence', async () => {
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
    const rebuildStaticComposite = jest.fn(async () => {
      state.autosave.dirtyRevision = 2;
      return true;
    });
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(),
      rebuildStaticComposite,
      requestRedraw: jest.fn(),
    }));

    const result = await execute({
      id: 'command-observe-settled-revision',
      action: 'observe',
      capture: 'final-thumbnail',
    });

    expect(result).toMatchObject({ ok: true, revision: 2, state: { dirtyRevision: 2 } });
  });

  it('waits for canonical work before capturing and returns a reusable revision fence', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const order: string[] = [];
    let deferredRevisionPublished = false;
    const waitForCanonicalIdle = jest.fn(async () => {
      order.push('idle');
      if (!deferredRevisionPublished && state.autosave.dirtyRevision === 1) {
        state.autosave.dirtyRevision = 3;
        deferredRevisionPublished = true;
      }
    });
    const canvas = {
      width: 512,
      height: 640,
      toDataURL: jest.fn(() => {
        order.push('capture');
        return 'data:image/png;base64,frame';
      }),
    } as unknown as HTMLCanvasElement;
    const dispatchStroke = jest.fn(async () => {
      order.push('gesture');
      state.autosave.dirtyRevision = 1;
    });
    const runtimeIdentity = {
      protocolVersion: 4 as const,
      runtimeBuildId: 'build-current',
      runtimeInstanceId: 'runtime-current',
      leaseEpoch: 3,
    };
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke,
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }), {
      getRuntimeIdentity: () => runtimeIdentity,
      requireRuntimeFence: true,
      waitForCanonicalIdle,
    });

    const first = await execute({
      id: 'command-canonical-idle-checkpoint',
      action: 'batch',
      runtimeFence: runtimeIdentity,
      operations: [
        { action: 'stroke', points: [{ x: 10, y: 20 }] },
        { action: 'checkpoint', name: 'settled' },
      ],
    });

    expect(first.error).toBeUndefined();
    expect(first).toMatchObject({ ok: true, revision: 3 });
    const gestureIndex = order.indexOf('gesture');
    const captureIndex = order.indexOf('capture');
    expect(order.slice(gestureIndex + 1, captureIndex)).toContain('idle');

    const second = await execute({
      id: 'command-canonical-idle-reuse',
      action: 'observe',
      capture: 'none',
      runtimeFence: {
        ...runtimeIdentity,
        expectedProjectId: 'project-1',
        expectedProjectRevision: 3,
      },
    });

    expect(second).toMatchObject({ ok: true, revision: 3 });
  });

  it('settles canonical work registered during capture before publishing a checkpoint event', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    let captureCompleted = false;
    let deferredRevisionPublished = false;
    const waitForCanonicalIdle = jest.fn(async () => {
      if (captureCompleted && !deferredRevisionPublished) {
        state.autosave.dirtyRevision = 2;
        deferredRevisionPublished = true;
      }
    });
    const canvas = {
      width: 512,
      height: 640,
      toDataURL: jest.fn(() => {
        captureCompleted = true;
        return 'data:image/png;base64,frame';
      }),
    } as unknown as HTMLCanvasElement;
    const runtimeIdentity = {
      protocolVersion: 4 as const,
      runtimeBuildId: 'build-current',
      runtimeInstanceId: 'runtime-current',
      leaseEpoch: 3,
    };
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: canvas },
      compositeCanvasDirtyRef: { current: false },
      dispatchStroke: jest.fn(async () => {
        state.autosave.dirtyRevision = 1;
      }),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }), {
      getRuntimeIdentity: () => runtimeIdentity,
      requireRuntimeFence: true,
      waitForCanonicalIdle,
    });
    const checkpointRevisions: number[] = [];

    const result = await execute({
      id: 'command-late-canonical-checkpoint',
      action: 'artwork-job',
      capture: 'none',
      runtimeFence: runtimeIdentity,
      operations: [
        { action: 'stroke', phase: 'establish', points: [{ x: 10, y: 20 }] },
        { action: 'checkpoint', name: 'settled' },
      ],
    }, {
      onEvent: (event) => {
        if (event.type === 'checkpoint') checkpointRevisions.push(event.revision);
      },
    });

    expect(checkpointRevisions).toEqual([2]);
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(waitForCanonicalIdle).toHaveBeenCalledTimes(4);
  });

  it('streams artwork-job checkpoint frames without duplicating them in the final result', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-stroke' },
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
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
      setShapeMode: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
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
      dispatchStroke: jest.fn(async () => {
        state.autosave.dirtyRevision += 1;
      }),
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
    }));
    const events: Array<{ type: string; checkpointName?: string; frame?: unknown }> = [];

    const result = await execute({
      id: 'command-artwork-job-checkpoint',
      action: 'artwork-job',
      capture: 'none',
      operations: [
        { action: 'stroke', phase: 'establish', points: [{ x: 10, y: 20 }] },
        { action: 'checkpoint', name: 'primary-masses', capture: 'full' },
      ],
    }, {
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      'validated',
      'progress',
      'checkpoint',
    ]);
    expect(events[2]).toMatchObject({
      checkpointName: 'primary-masses',
      frame: { kind: 'full', width: 512, height: 640 },
    });
    expect(result.frames).toBeUndefined();
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

  it('reads the mounted gesture runtime after tool state has propagated', async () => {
    const setCurrentTool = jest.fn();
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'dither-shape' },
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
        shapeMode: true,
        brushSettings: {
          size: 20,
          opacity: 1,
          color: '#112233',
          spacing: 1,
          shapeEnabled: true,
        },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool,
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const commitGesture = jest.fn(async () => undefined);
    const getRuntime = jest.fn(() => {
      expect(setCurrentTool).toHaveBeenCalledWith('brush');
      return {
        canvasRef: { current: null },
        compositeCanvasDirtyRef: { current: false },
        commitGesture,
        rebuildStaticComposite: jest.fn(),
        requestRedraw: jest.fn(),
      };
    });
    const execute = createVesselCollaborationExecutor(getRuntime);

    const result = await execute({
      id: 'command-fresh-shape-runtime',
      action: 'shape',
      capture: 'none',
      points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 60, y: 120 }],
    });

    expect(result.ok).toBe(true);
    expect(getRuntime).toHaveBeenCalled();
    expect(commitGesture).toHaveBeenCalledWith({
      kind: 'shape',
      points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 60, y: 120 }],
    });
  });

  it('requires shape direction only for the canonical multi-band linear fill', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'color-cycle-flat-dither' },
      layers: [{
        id: 'layer-1',
        name: 'CC Shape paint',
        layerType: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      }],
      tools: {
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          size: 20,
          opacity: 1,
          shapeEnabled: true,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'concentric',
          gradientBands: 4,
        },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
      ensureColorCycleLayerRuntime: jest.fn(async () => true),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const commitGesture = jest.fn(async () => undefined);
    const execute = createVesselCollaborationExecutor(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      commitGesture,
      rebuildStaticComposite: jest.fn(),
      requestRedraw: jest.fn(),
    }));
    const shape = {
      capture: 'none' as const,
      points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 60, y: 120 }],
    };

    await expect(execute({ id: 'command-concentric-shape', action: 'shape', ...shape }))
      .resolves.toMatchObject({ ok: true });
    state.tools.brushSettings.colorCycleFillMode = 'linear';
    await expect(execute({ id: 'command-linear-shape', action: 'shape', ...shape }))
      .resolves.toMatchObject({
        ok: false,
        error: 'This Color Cycle shape requires direction points',
      });
    expect(commitGesture).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale runtime fence before invoking any mutation runtime', async () => {
    const state = {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentBrushPreset: { id: 'dither-shape' },
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
        shapeMode: true,
        brushSettings: { size: 20, opacity: 1, shapeEnabled: true },
      },
      autosave: { dirtyRevision: 0 },
      setCurrentTool: jest.fn(),
    } as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetAppStoreState.mockImplementation(() => state);
    const getRuntime = jest.fn(() => ({
      canvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      commitGesture: jest.fn(),
      rebuildStaticComposite: jest.fn(),
      requestRedraw: jest.fn(),
    }));
    const execute = createVesselCollaborationExecutor(getRuntime, {
      requireRuntimeFence: true,
      getRuntimeIdentity: () => ({
        protocolVersion: 4,
        runtimeBuildId: 'build-current',
        runtimeInstanceId: 'runtime-current',
        leaseEpoch: 3,
      }),
    });

    const result = await execute({
      id: 'command-stale-runtime',
      action: 'shape',
      capture: 'none',
      runtimeFence: {
        protocolVersion: 4,
        runtimeBuildId: 'build-stale',
        runtimeInstanceId: 'runtime-stale',
        leaseEpoch: 2,
      },
      points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 60, y: 120 }],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Collaboration command targets a stale or incompatible Vessel runtime',
    });
    expect(getRuntime).not.toHaveBeenCalled();
    expect(state.setCurrentTool).not.toHaveBeenCalled();
  });

  it('dispatches every rapid shape point while waiting only for finalization', async () => {
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
      jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
      const dispatched: string[] = [];
      ['pointerdown', 'pointermove', 'pointerup'].forEach((type) => {
        canvas.addEventListener(type, () => dispatched.push(type));
      });
      const waitForFrame = jest.fn(async () => undefined);

      await dispatchVesselCollaborationStroke({
        canvas,
        pointsPerFrame: 1,
        framePacing: 'finalize-only',
        zoom: 1,
        worldToScreen: (x, y) => ({ x, y }),
        isBusy: () => false,
        waitForFrame,
        points: Array.from({ length: 20 }, (_, index) => ({ x: index, y: index })),
      });

      expect(dispatched).toEqual([
        'pointerdown',
        ...Array.from({ length: 19 }, () => 'pointermove'),
        'pointerup',
      ]);
      expect(waitForFrame).toHaveBeenCalledTimes(3);
    } finally {
      global.PointerEvent = originalPointerEvent;
    }
  });
});
