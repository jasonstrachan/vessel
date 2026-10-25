/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecolorPanel } from '@/components/colorCycle/RecolorPanel';
import { Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { cloneRecolorSettings } from '@/history/deltas/recolorDelta';
import * as playback from '@/utils/colorCyclePlayback';

const { useRecolorState: useRealRecolorState } = jest.requireActual('../hooks/useRecolorState') as typeof import('../hooks/useRecolorState');
const panelUpdateGradient = jest.fn();
const panelProcessLayer = jest.fn().mockResolvedValue(true);
let mockConfiguredFPS = 60;
// eslint-disable-next-line no-var
var mockManager: Record<string, jest.Mock>;
jest.mock('@/lib/colorCycle/RecolorManager', () => {
  mockManager = Object.fromEntries(['processLayer','convertToNormal','setLayerSpeed','setLayerCycleColors','setLayerFlowDirection','setLayerMappingMode','setLayerFlowMapping','clearPaletteDirectionalOrder','updateGradient','setFPS','getConfiguredFPS','pause','playAll','renderOnce','registerExistingLayer','restoreLayer','removeLayer','getStats','onLayerUpdate','offLayerUpdate','onStatsUpdate','offStatsUpdate'].map((key) => [key, jest.fn()]));
  return { RecolorManager: { getInstance: () => mockManager } };
});

const clearError = jest.fn();
const mockCancelDraft = jest.fn();

jest.mock('../hooks/useRecolorState', () => ({
  useRecolorState: () => ({
    state: {
      mode: 'recolor',
      error: 'Something went wrong',
      gradientStops: [],
      selectedGradientId: 'default',
    },
    actions: {
      clearError,
    },
    processLayer: panelProcessLayer,
    toggleAnimation: jest.fn(),
    updateLayerSpeed: jest.fn(),
    updateLayerCycleColors: jest.fn(),
    updateLayerFlowDirection: jest.fn(),
    updateLayerMappingMode: jest.fn(),
    updateLayerFlowMapping: jest.fn(),
    updateGradient: panelUpdateGradient,
    updateGlobalFPS: jest.fn(),
    successMessage: '',
  }),
}));

jest.mock('@/components/ui/GradientEditor', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { GradientEditor: React.forwardRef(function EditorMock({ onChange }: { onChange: (stops: Array<{ position: number; color: string; opacity?: number }>) => void }, ref) {
    React.useImperativeHandle(ref, () => ({ cancelDraft: mockCancelDraft }));
    return <><button data-testid="gradient-editor" onClick={() => onChange([{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }])}>Edit gradient</button><button data-testid="transparent-stop" onClick={() => onChange([{ position: 0, color: '#123456', opacity: 0 }, { position: 1, color: '#abcdef', opacity: 0.4 }])}>Transparent</button></>;
  }) };
});
jest.mock('../controls/AnimationControls', () => ({ AnimationControls: ({ onFlowMappingChange }: { onFlowMappingChange: (value: 'luminance') => void }) => <button data-testid="planned-luminance" onClick={() => onFlowMappingChange('luminance')}>Luminance</button> }));
jest.mock('../dialogs/ConfirmationDialog', () => ({
  ConfirmationDialog: () => <div data-testid="confirmation-dialog" />,
}));

const makeLayer = (): Layer => ({
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: new ImageData(2, 2),
  framebuffer: (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    return canvas;
  })(),
  alignment: {
    fit: 'contain',
    horizontal: 'center',
    vertical: 'center',
    positioning: 'anchor',
    offsetPx: { x: 0, y: 0 },
  },
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'recolor',
    gradient: [],
    recolorSettings: {
      gradient: [] as any,
      originalImageData: new ImageData(2, 2),
      indexBuffer: new Uint8Array([1, 2, 3, 4]),
      palette: new Uint32Array([0, 0xff123456]),
      quantizationMode: 'rgb332',
      ditherMode: 'off',
      currentLOD: 'full',
      animation: {
        speed: 1,
        fps: 60,
        ticksPerFrame: 1,
        isPlaying: true,
        currentTick: 0,
        flowDirection: 'reverse',
      },
      cycleColors: 8,
      mappingMode: 'banded',
      flowMapping: 'palette',
    },
  },
});

describe('RecolorPanel', () => {
  afterEach(() => {
    clearError.mockClear();
  });

  it('shows no-layer hint when no active layer is provided', () => {
    render(<RecolorPanel activeLayer={null} isVisible onCommit={jest.fn()} />);

    expect(screen.getByText(/No Layer Selected/i)).toBeInTheDocument();
  });

  it('renders error banner and clears on dismiss', () => {
    render(<RecolorPanel activeLayer={makeLayer()} isVisible onCommit={jest.fn()} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByText('×'));
    expect(clearError).toHaveBeenCalled();
  });
});


describe('Recolor public history workflow', () => {
  const stops = [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }];
  let normal: Layer;
  const registeredLayers = new Map<string, Layer>();

  beforeEach(() => {
    jest.clearAllMocks();
    historyManager.clear();
    registeredLayers.clear();
    mockConfiguredFPS = 60;
    mockManager.getConfiguredFPS.mockImplementation(() => mockConfiguredFPS);
    normal = { ...makeLayer(), layerType: 'normal', colorCycleData: undefined, imageData: new ImageData(new Uint8ClampedArray([32, 64, 192, 255]), 1, 1) };
    normal.framebuffer.width = normal.framebuffer.height = 1;
    (normal.framebuffer.getContext('2d') as CanvasRenderingContext2D).putImageData(normal.imageData!, 0, 0);
    useAppStore.setState({
      layers: [normal], activeLayerId: normal.id, selectedLayerIds: [normal.id], layerGroups: [],
      project: { id: 'recolor-history', name: 'History', width: 1, height: 1, layers: [normal], backgroundColor: 'transparent', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] },
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0, playbackSpeedScale: 1 },
    });
    mockManager.processLayer.mockImplementation(async (layer: Layer) => {
      layer.layerType = 'color-cycle';
      layer.colorCycleData = { mode: 'recolor', recolorSettings: {
        quantizationMode: 'rgb332', ditherMode: 'off', cycleColors: 16, currentLOD: 'full',
        originalImageData: new ImageData(layer.imageData!.data.slice(), 1, 1),
        indexBuffer: new Uint8Array([42]), palette: new Uint32Array([0xff123456]), gradient: stops.map((stop) => ({ ...stop })),
        animation: { speed: 0.1, fps: 30, ticksPerFrame: 0.05, currentTick: 0, isPlaying: false, flowDirection: 'reverse' },
        mappingMode: 'banded', flowMapping: 'palette',
      } };
      registeredLayers.set(layer.id, layer);
      return true;
    });
    mockManager.setLayerSpeed.mockImplementation((id: string, speed: number) => {
      registeredLayers.get(id)!.colorCycleData!.recolorSettings!.animation.speed = speed;
      return true;
    });
    mockManager.setFPS.mockImplementation((fps: number) => {
      mockConfiguredFPS = fps;
      for (const layer of registeredLayers.values()) if (layer.colorCycleData?.recolorSettings) layer.colorCycleData.recolorSettings.animation.fps = fps;
    });
    mockManager.setLayerFlowDirection.mockImplementation((id: string, direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => {
      registeredLayers.get(id)!.colorCycleData!.recolorSettings!.animation.flowDirection = direction;
    });
    mockManager.setLayerMappingMode.mockImplementation((id: string, mode: 'banded' | 'continuous') => {
      registeredLayers.get(id)!.colorCycleData!.recolorSettings!.mappingMode = mode;
    });
    mockManager.setLayerFlowMapping.mockImplementation((id: string, value: 'palette' | 'directional' | 'luminance') => { registeredLayers.get(id)!.colorCycleData!.recolorSettings!.flowMapping = value; return true; });
    mockManager.updateGradient.mockImplementation((layer: Layer, gradient: typeof stops) => {
      layer.colorCycleData!.recolorSettings!.gradient = gradient;
      return true;
    });
    const registerCurrent = async (layer: Layer) => { registeredLayers.set(layer.id, layer); return true; };
    mockManager.removeLayer.mockImplementation((id: string) => registeredLayers.delete(id));
    mockManager.restoreLayer.mockImplementation(registerCurrent);
    mockManager.registerExistingLayer.mockImplementation(registerCurrent);
    mockManager.getStats.mockReturnValue({});
    jest.spyOn(playback, 'toggleToolbarColorCyclePlayback').mockImplementation(async () => {
      const settings = useAppStore.getState().layers[0].colorCycleData?.recolorSettings;
      if (settings) settings.animation.isPlaying = !settings.animation.isPlaying;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    historyManager.clear();
  });

  it('passes existing planned initialization into the conversion history workflow', async () => {
    render(<RecolorPanel activeLayer={normal} isVisible />);
    fireEvent.click(screen.getByTestId('gradient-editor'));
    await waitFor(() => expect(panelProcessLayer).toHaveBeenCalled());
    expect(panelProcessLayer.mock.calls.at(-1)?.[2]).toEqual({ speed: 0.1, fps: 30, flowDirection: 'reverse', mappingMode: 'banded', flowMapping: 'palette' });
  });

  it('preserves transparent opacity through conversion draft and Escape restoration', async () => {
    const onCommit = jest.fn();
    const view = render(<RecolorPanel activeLayer={normal} isVisible onCommit={onCommit} />);
    fireEvent.click(screen.getByTestId('planned-luminance'));
    fireEvent.click(screen.getByTestId('transparent-stop'));
    await waitFor(() => expect(panelProcessLayer).toHaveBeenCalled());
    const expected = [{ position: 0, color: '#123456', opacity: 0 }, { position: 1, color: '#abcdef', opacity: 0.4 }];
    expect(panelProcessLayer.mock.calls.at(-1)?.[1].customGradient).toEqual(expected);
    expect(panelProcessLayer.mock.calls.at(-1)?.[2].flowMapping).toBe('luminance');
    view.rerender(<RecolorPanel activeLayer={normal} isVisible={false} onCommit={onCommit} />);
    view.unmount();
    const indexed = makeLayer();
    indexed.colorCycleData!.recolorSettings!.gradient = expected;
    useAppStore.setState({ layers: [indexed], activeLayerId: indexed.id });
    render(<RecolorPanel activeLayer={indexed} isVisible />);
    fireEvent.click(screen.getByTestId('transparent-stop'));
    await waitFor(() => expect(panelUpdateGradient).toHaveBeenCalledWith(indexed, expected));
    fireEvent.click(screen.getByTestId('gradient-editor'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panelUpdateGradient).toHaveBeenLastCalledWith(indexed, expected);
  });

  it.each([false, true])('explicitly cancels the editor to original material on Escape (parent pending=%s)', async pending => {
    const indexed = makeLayer();
    const original = [{ position: 0, color: '#2060a0', opacity: 0.4 }, { position: 1, color: '#2060a0', opacity: 1 }];
    indexed.colorCycleData!.recolorSettings!.gradient = original;
    useAppStore.setState({ layers: [indexed], activeLayerId: indexed.id });
    render(<RecolorPanel activeLayer={indexed} isVisible />);
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      if (pending) fireEvent.click(screen.getByTestId('gradient-editor'));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(mockCancelDraft).toHaveBeenCalledWith(original);
      act(() => { jest.runOnlyPendingTimers(); });
      expect(original).toEqual([{ position: 0, color: '#2060a0', opacity: 0.4 }, { position: 1, color: '#2060a0', opacity: 1 }]);
      if (!pending) expect(panelUpdateGradient).not.toHaveBeenCalled();
      else {
        expect(panelUpdateGradient).toHaveBeenCalledTimes(1);
        expect(panelUpdateGradient).toHaveBeenLastCalledWith(indexed, original);
      }
    } finally { jest.useRealTimers(); }
  });

  it('rebinds live speed to the current store layer before subsequent FPS and flow controls', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    const old = registeredLayers.get(normal.id);
    await act(async () => { await result.current.updateLayerSpeed(normal.id, 0.7); });
    const current = useAppStore.getState().layers[0];
    expect(current).not.toBe(old);
    expect(registeredLayers.get(normal.id)).toBe(current);
    await act(async () => { await result.current.updateGlobalFPS(15); await result.current.updateLayerFlowDirection(normal.id, 'forward'); });
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.animation).toMatchObject({ speed: 0.7, fps: 15, flowDirection: 'forward' });
    expect(historyManager.entries()).toHaveLength(4);
  });

  it.each([
    ['updateLayerSpeed', 0.7, 'speed'], ['updateLayerCycleColors', 32, 'cycleColors'],
    ['updateLayerFlowDirection', 'forward', 'flowDirection'], ['updateLayerMappingMode', 'continuous', 'mappingMode'],
    ['updateLayerFlowMapping', 'luminance', 'flowMapping'],
  ] as const)('records %s as one immutable bounded control command with real global replay', async (method, value, key) => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    const originalLayer = useAppStore.getState().layers[0];
    const original = originalLayer.colorCycleData!.recolorSettings!;
    const read = () => { const r = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!; return key === 'speed' || key === 'flowDirection' ? r.animation[key] : r[key]; };
    const before = read();
    await act(async () => { await (result.current[method] as (id: string, nextValue: typeof value) => Promise<void>)(normal.id, value); });
    expect(read()).toBe(value);
    expect(useAppStore.getState().layers[0]).not.toBe(originalLayer);
    expect(historyManager.entries()).toHaveLength(2);
    expect(historyManager.entries()[1].meta?.approxBytes).toBeLessThan(1024);
    await act(async () => { await (result.current[method] as (id: string, nextValue: typeof value) => Promise<void>)(normal.id, value); });
    expect(historyManager.entries()).toHaveLength(2);
    await act(async () => { await useAppStore.getState().undo(); });
    expect(read()).toBe(before);
    await act(async () => { await useAppStore.getState().redo(); });
    expect(read()).toBe(value);
    const current = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
    expect(current.originalImageData).toBe(original.originalImageData);
    expect(current.indexBuffer).toBe(original.indexBuffer);
    expect(current.palette).toBe(original.palette);
  });

  it('retains bounded scalar commands at the existing50-entry cap and replays the last native range step', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    const before = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
    for (let i = 1; i <= 100; i += 1) await act(async () => { await result.current.updateLayerSpeed(normal.id, 0.1 + i * 0.005); });
    expect(historyManager.entries()).toHaveLength(50);
    expect(historyManager.entries().every(entry => entry.deltas.length === 1 && entry.deltas[0].approxBytes === 128)).toBe(true);
    await act(async () => { await useAppStore.getState().undo(); });
    expect(historyManager.entries()).toHaveLength(49);
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.animation.speed).toBe(0.1 + 99 * 0.005);
    await act(async () => { await useAppStore.getState().redo(); });
    expect(historyManager.entries()).toHaveLength(50);
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.animation.speed).toBe(0.6);
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.indexBuffer).toBe(before.indexBuffer);
  });

  it.each([['updateLayerSpeed', 0.7], ['updateLayerCycleColors', 32], ['updateLayerFlowDirection', 'forward'], ['updateLayerMappingMode', 'continuous'], ['updateLayerFlowMapping', 'luminance']] as const)('does not retain %s when current runtime registration rejects it', async (method, value) => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    const before = useAppStore.getState().layers[0];
    mockManager.restoreLayer.mockResolvedValueOnce(false);
    await act(async () => { await (result.current[method] as (id: string, nextValue: typeof value) => Promise<void>)(normal.id, value); });
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().layers[0]).toBe(before);
  });

  it('restores actual global configured FPS for two layers and inside the single conversion command', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    const other = { ...makeLayer(), id: 'other' };
    useAppStore.setState({ layers: [normal, other] }); registeredLayers.set(other.id, other);
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }, { speed: 0.7, fps: 15, flowDirection: 'forward', mappingMode: 'continuous', flowMapping: 'luminance' }); });
    expect(historyManager.entries()).toHaveLength(1);
    expect(mockConfiguredFPS).toBe(15);
    await act(async () => { await useAppStore.getState().undo(); });
    expect(mockConfiguredFPS).toBe(60);
    expect(useAppStore.getState().layers[0].layerType).toBe('normal');
    await act(async () => { await useAppStore.getState().redo(); });
    expect(mockConfiguredFPS).toBe(15);
    const before = useAppStore.getState().layers.map(l => l.colorCycleData!.recolorSettings!);
    await act(async () => { await result.current.updateGlobalFPS(30); });
    expect(mockConfiguredFPS).toBe(30);
    await act(async () => { await result.current.updateGlobalFPS(30); });
    expect(historyManager.entries()).toHaveLength(2);
    expect(useAppStore.getState().layers.every(l => l.colorCycleData!.recolorSettings!.animation.fps === 30)).toBe(true);
    expect(historyManager.entries()).toHaveLength(2);
    await act(async () => { await useAppStore.getState().undo(); });
    expect(mockConfiguredFPS).toBe(15);
    useAppStore.getState().layers.forEach((l, i) => expect(l.colorCycleData!.recolorSettings!.indexBuffer).toBe(before[i].indexBuffer));
    await act(async () => { await useAppStore.getState().redo(); });
    expect(mockConfiguredFPS).toBe(30);
  });

  it('compensates exact two-layer metadata and configured runtime FPS when replay finalization fails after mutation', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    const other = { ...makeLayer(), id: 'other' };
    useAppStore.setState({ layers: [normal, other] }); registeredLayers.set(other.id, other);
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); await result.current.updateGlobalFPS(15); });
    const state = useAppStore.getState();
    const before = state.layers.map(layer => ({ id: layer.id, animation: { ...layer.colorCycleData!.recolorSettings!.animation }, source: layer.colorCycleData!.recolorSettings!.indexBuffer }));
    const actualFPS = mockConfiguredFPS;
    mockManager.setFPS.mockImplementationOnce((fps: number) => {
      mockConfiguredFPS = fps;
      for (const layer of registeredLayers.values()) layer.colorCycleData!.recolorSettings!.animation.fps = fps;
      throw new Error('Rejected FPS runtime after scalar mutation');
    });
    await act(async () => { await expect(historyManager.undo()).rejects.toThrow(); });
    expect(mockConfiguredFPS).toBe(actualFPS);
    expect(useAppStore.getState().layers).toBe(state.layers);
    useAppStore.getState().layers.forEach((layer, index) => {
      expect(layer.colorCycleData!.recolorSettings!.animation).toEqual(before[index].animation);
      expect(layer.colorCycleData!.recolorSettings!.indexBuffer).toBe(before[index].source);
      expect(registeredLayers.get(layer.id)).toBe(layer);
    });
    expect(historyManager.entries()).toHaveLength(2);
    expect(historyManager.redoEntries()).toHaveLength(0);
  });

  it('rejects a stale unlocked normal conversion argument when the current target is locked', async () => {
    const locked = { ...normal, locked: true };
    act(() => { useAppStore.setState({ layers: [locked] }); });
    const before = useAppStore.getState();
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { expect(await result.current.processLayer(normal, { customGradient: stops })).toBe(false); });
    expect(mockManager.processLayer).not.toHaveBeenCalled();
    expect(useAppStore.getState().layers).toBe(before.layers);
    expect(locked.imageData).toBe(normal.imageData);
    expect(mockConfiguredFPS).toBe(60);
    expect(historyManager.entries()).toHaveLength(0);
    expect(playback.toggleToolbarColorCyclePlayback).not.toHaveBeenCalled();
  });

  it.each([
    ['updateLayerSpeed', 0.7], ['updateLayerCycleColors', 32], ['updateLayerFlowDirection', 'forward'],
    ['updateLayerMappingMode', 'continuous'], ['updateLayerFlowMapping', 'luminance'], ['gradient', null],
  ] as const)('rejects %s on a fresh locked Recolor owner despite a stale unlocked reference', async (method, value) => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    const stale = useAppStore.getState().layers[0], locked = { ...stale, locked: true };
    act(() => { useAppStore.setState({ layers: [locked] }); });
    const before = useAppStore.getState(), settings = cloneRecolorSettings(locked.colorCycleData!.recolorSettings), fps = mockConfiguredFPS;
    const restores = mockManager.restoreLayer.mock.calls.length;
    await act(async () => {
      if (method === 'gradient') result.current.updateGradient(stale, [{ position: 0, color: '#ffffff' }, { position: 1, color: '#000000' }]);
      else await (result.current[method] as (id: string, next: typeof value) => Promise<void>)(stale.id, value);
    });
    expect(useAppStore.getState().layers).toBe(before.layers);
    expect(locked.colorCycleData!.recolorSettings).toEqual(settings);
    expect(mockConfiguredFPS).toBe(fps);
    expect(mockManager.restoreLayer).toHaveBeenCalledTimes(restores);
    expect(mockManager.updateGradient).not.toHaveBeenCalled();
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.redoEntries()).toHaveLength(0);
  });

  it('disables the actual panel group and guards locked normal planning, gradient and Reset actions', async () => {
    const locked = { ...normal, locked: true };
    act(() => { useAppStore.setState({ layers: [locked] }); });
    const view = render(<RecolorPanel activeLayer={locked} isVisible />);
    const group = screen.getByRole('group', { name: 'Recolor controls' });
    expect(group).toBeDisabled();
    expect(group).toHaveAttribute('inert');
    expect(screen.getByTestId('gradient-editor')).toBeDisabled();
    fireEvent.click(screen.getByTestId('planned-luminance'));
    fireEvent.click(screen.getByTestId('gradient-editor'));
    expect(panelProcessLayer).not.toHaveBeenCalled();
    expect(panelUpdateGradient).not.toHaveBeenCalled();
    const indexed = { ...makeLayer(), locked: true };
    act(() => { useAppStore.setState({ layers: [indexed] }); });
    view.rerender(<RecolorPanel activeLayer={indexed} isVisible />);
    const reset = screen.getByRole('button', { name: 'Reset Flow Order' });
    expect(reset).toBeDisabled(); fireEvent.click(reset);
    expect(mockManager.clearPaletteDirectionalOrder).not.toHaveBeenCalled();
    act(() => { useAppStore.setState({ layers: [normal] }); });
    view.rerender(<RecolorPanel activeLayer={normal} isVisible />);
    expect(screen.getByRole('group', { name: 'Recolor controls' })).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('gradient-editor'));
    await waitFor(() => expect(panelProcessLayer).toHaveBeenCalled());
    expect(panelProcessLayer.mock.calls.at(-1)?.[2].flowMapping).toBe('palette');
  });

  it('allows an unlocked owner global FPS command to keep shared cadence coherent for a locked Recolor layer', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    const locked = { ...useAppStore.getState().layers[0], locked: true }, other = { ...makeLayer(), id: 'unlocked-other' };
    act(() => { useAppStore.setState({ layers: [locked, other], activeLayerId: other.id }); });
    const original = locked.colorCycleData!.recolorSettings!.indexBuffer;
    await act(async () => { await result.current.updateGlobalFPS(15); });
    expect(mockConfiguredFPS).toBe(15);
    expect(useAppStore.getState().layers.every(layer => layer.colorCycleData!.recolorSettings!.animation.fps === 15)).toBe(true);
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.indexBuffer).toBe(original);
    expect(historyManager.entries()).toHaveLength(2);
  });

  it('records conversion after nondefault initialization/autoplay and restores isolated normal/indexed state through real global history', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => {
      expect(await result.current.processLayer(normal, { customGradient: stops }, { speed: 0.7, fps: 15, flowDirection: 'forward', mappingMode: 'continuous', flowMapping: 'luminance' })).toBe(true);
    });
    const converted = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
    const expected = cloneRecolorSettings(converted);
    expect(expected!.animation).toMatchObject({ speed: 0.7, fps: 15, flowDirection: 'forward', isPlaying: true });
    expect(expected!.mappingMode).toBe('continuous');
    expect(expected!.flowMapping).toBe('luminance');
    expect(historyManager.entries()).toHaveLength(1);
    converted.indexBuffer!.fill(99);
    converted.originalImageData!.data.fill(0);
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { await useAppStore.getState().undo(); });
      const restored = useAppStore.getState().layers[0];
      expect(restored.layerType).toBe('normal');
      expect(restored.colorCycleData).toBeUndefined();
      expect(Array.from(restored.imageData!.data)).toEqual([32, 64, 192, 255]);
      const context = restored.framebuffer.getContext('2d') as CanvasRenderingContext2D;
      expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([32, 64, 192, 255]);
      await act(async () => { await useAppStore.getState().redo(); });
      expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(expected);
    }
    expect(playback.toggleToolbarColorCyclePlayback).toHaveBeenCalledTimes(1);
  });

  it('records bounded gradient edits without changing indexed source and ignores equal or failed updates', async () => {
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { await result.current.processLayer(normal, { customGradient: stops }); });
    historyManager.clear();
    const settings = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
    const index = settings.indexBuffer;
    const next = [{ position: 0, color: '#00ff00' }, { position: 1, color: '#0000ff' }];
    act(() => result.current.updateGradient(normal, next));
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.entries()[0].deltas[0].approxBytes).toBeLessThan(1024);
    await act(async () => { await useAppStore.getState().undo(); });
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.gradient).toEqual(stops);
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.indexBuffer).toBe(index);
    await act(async () => { await useAppStore.getState().redo(); });
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.gradient).toEqual(next);
    act(() => result.current.updateGradient(normal, next.map((stop) => ({ ...stop }))));
    expect(historyManager.entries()).toHaveLength(1);
    mockManager.updateGradient.mockReturnValue(false);
    act(() => result.current.updateGradient(normal, stops));
    expect(historyManager.entries()).toHaveLength(1);
  });

  it('keeps successful conversion undoable when later animation registration fails', async () => {
    mockManager.restoreLayer.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => {
      expect(await result.current.processLayer(normal, { customGradient: stops }, { speed: 0.7, fps: 15, flowDirection: 'forward', mappingMode: 'continuous', flowMapping: 'luminance' })).toBe(true);
    });
    expect(historyManager.entries()).toHaveLength(1);
    expect(result.current.state.error).toBe('Failed to initialize recolor animation');
    await act(async () => { await useAppStore.getState().undo(); });
    expect(useAppStore.getState().layers[0].layerType).toBe('normal');
    expect(Array.from(useAppStore.getState().layers[0].imageData!.data)).toEqual([32, 64, 192, 255]);
  });

  it('does not publish an old conversion into a different current project', async () => {
    let finish: ((success: boolean) => void) | undefined;
    mockManager.processLayer.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useRealRecolorState(normal));
    let pending: Promise<boolean> | undefined;
    act(() => { pending = result.current.processLayer(normal, { customGradient: stops }, { speed: 0.7, fps: 15, flowDirection: 'forward', mappingMode: 'continuous', flowMapping: 'luminance' }); });
    act(() => {
      useAppStore.setState((state) => ({ project: { ...state.project!, id: 'different-project' } }));
    });
    await act(async () => { finish!(true); expect(await pending).toBe(false); });
    expect(historyManager.entries()).toHaveLength(0);
    expect(playback.toggleToolbarColorCyclePlayback).not.toHaveBeenCalled();
  });

  it('does not publish a conversion history entry when the manager rejects conversion', async () => {
    mockManager.processLayer.mockResolvedValue(false);
    const { result } = renderHook(() => useRealRecolorState(normal));
    await act(async () => { expect(await result.current.processLayer(normal)).toBe(false); });
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().layers[0].layerType).toBe('normal');
  });
});
