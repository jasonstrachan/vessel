import { getAppStoreState } from '@/stores/appStoreAccess';
import { BrushShape } from '@/types';
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
const originalCreateImageBitmap = globalThis.createImageBitmap;

describe('createVesselCollaborationExecutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
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
      commitColorCycleGradientDraft: jest.fn((stops) => {
        state.tools.brushSettings.colorCycleGradient = stops;
      }),
      setBrushSettings: jest.fn((settings) => {
        Object.assign(state.tools.brushSettings, settings);
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
    expect(state.commitColorCycleGradientDraft).toHaveBeenCalledWith([
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ]);
    expect(state.setBrushSettings).toHaveBeenNthCalledWith(1, {
      colorCycleFgLightness: 35,
      colorCycleFgHueShift: 20,
      colorCycleFgStops: 4,
    });
    expect(state.setBrushSettings).toHaveBeenNthCalledWith(2, {
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
          source: 'fg',
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
