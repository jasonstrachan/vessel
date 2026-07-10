import {
  prepareBrushSpeedExport,
  scaleEncodedSpeedBuffer,
  serializeColorCycleDataFromResolvedLayer,
} from '@/utils/export/goblet/gobletColorCycleSerializer';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import type { WebGLSerializedBrushState } from '@/utils/export/goblet/gobletTypes';
import type { Layer, Project } from '@/types';

const gradientStops = [
  { position: 0, color: '#000000' },
  { position: 1, color: '#ffffff' },
];

const createProject = (): Project => ({
  id: 'project',
  name: 'Project',
  width: 2,
  height: 2,
  backgroundColor: '#000000',
  layers: [],
  layerGroups: [],
  activeLayerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  version: '1.0.0',
} as unknown as Project);

const createLayer = (overrides: Partial<NonNullable<Layer['colorCycleData']>> = {}): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: { width: 2, height: 2 } as HTMLCanvasElement,
  alignment: {
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
  },
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'brush',
    isAnimating: true,
    hasContent: true,
    gradient: gradientStops,
    ...overrides,
  },
  version: 1,
} as unknown as Layer);

const createBrushState = (overrides: Partial<WebGLSerializedBrushState> = {}): WebGLSerializedBrushState => ({
  width: 2,
  height: 2,
  indexBuffer: [1, 1, 1, 1],
  gradientIdBuffer: [0, 0, 0, 0],
  gradientDefIdBuffer: [1, 1, 1, 1],
  speedBuffer: [encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.3)],
  flowBuffer: [1, 1, 1, 1],
  phaseBuffer: [0, 0, 0, 0],
  gradientStops,
  animationOffset: 0,
  ...overrides,
});

const createGradientDefStore = (speedCps: number) => [{
  id: 1,
  kind: 'linear' as const,
  stops: gradientStops,
  hash: 'slot-0',
  source: 'manual' as const,
  createdAtMs: 1,
  slot: 0,
  speedCps,
}];

const createSpeedPlan = (
  layer: Layer,
  brushState: WebGLSerializedBrushState,
  options: {
    layerSpeedScale?: number;
    fallbackToolSpeed?: number | null;
    forceBuffer?: boolean;
  } = {},
) => prepareBrushSpeedExport({
  layer,
  brushState,
  warnOnce: jest.fn(),
  layerSpeedScale: options.layerSpeedScale ?? 1,
  fallbackToolSpeed: options.fallbackToolSpeed,
  forceBuffer: options.forceBuffer,
});

const getSlotSpeed = (
  plan: ReturnType<typeof prepareBrushSpeedExport>,
  slot: number,
): number | undefined => plan?.slotSpeeds?.find((entry) => entry.slot === slot)?.speed;

describe('Goblet slot speed export', () => {
  it('uses painted speed bytes before gradient definition speed in slot mode', () => {
    const paintedByte = encodeColorCycleSpeedByte(0.3);
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer: [paintedByte, paintedByte, paintedByte, paintedByte] }),
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBeCloseTo(decodeColorCycleSpeedByte(paintedByte), 5);
    expect(getSlotSpeed(plan, 0)).not.toBeCloseTo(1.0, 5);
  });

  it('applies layer speed scale to painted byte slot speeds', () => {
    const paintedByte = encodeColorCycleSpeedByte(0.3);
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer: [paintedByte, paintedByte, paintedByte, paintedByte] }),
      { layerSpeedScale: 2 },
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBeCloseTo(decodeColorCycleSpeedByte(paintedByte) * 2, 5);
  });

  it('does not re-encode or clamp scaled slot speeds', () => {
    const paintedByte = encodeColorCycleSpeedByte(2.0);
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer: [paintedByte, paintedByte, paintedByte, paintedByte] }),
      { layerSpeedScale: 2 },
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBeCloseTo(decodeColorCycleSpeedByte(paintedByte) * 2, 5);
    expect(getSlotSpeed(plan, 0)).toBeGreaterThan(2.64);
  });

  it('exports explicit static speed for painted zero-only slots', () => {
    const slotZeroByte = encodeColorCycleSpeedByte(1.0);
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({
        gradientIdBuffer: [0, 0, 1, 1],
        speedBuffer: [slotZeroByte, slotZeroByte, 0, 0],
      }),
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBeCloseTo(decodeColorCycleSpeedByte(slotZeroByte), 5);
    expect(getSlotSpeed(plan, 1)).toBe(0);
  });

  it('treats a wholly zero speed buffer as absent legacy speed data', () => {
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer: [0, 0, 0, 0] }),
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBeCloseTo(1.0, 5);
  });

  it('keeps absent buffers on gradient definition or tool-speed fallback', () => {
    const defPlan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer: undefined }),
    );
    const toolPlan = createSpeedPlan(
      createLayer(),
      createBrushState({ speedBuffer: undefined }),
      { fallbackToolSpeed: 0.75 },
    );

    expect(defPlan?.speedMode).toBe('slot');
    expect(getSlotSpeed(defPlan, 0)).toBeCloseTo(1.0, 5);
    expect(toolPlan?.speedMode).toBe('slot');
    expect(getSlotSpeed(toolPlan, 0)).toBeCloseTo(0.75, 5);
  });

  it('applies the layer multiplier to tool speed when the painted speed buffer is absent', () => {
    const plan = createSpeedPlan(
      createLayer({ layerBaseSpeedCps: 2 }),
      createBrushState({ speedBuffer: undefined }),
      { fallbackToolSpeed: 0.1 },
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBeCloseTo(0.2, 5);
  });

  it('preserves explicit static tool speed when applying a layer multiplier fallback', () => {
    const plan = createSpeedPlan(
      createLayer({ layerBaseSpeedCps: 2 }),
      createBrushState({ speedBuffer: undefined }),
      { fallbackToolSpeed: 0 },
    );

    expect(plan?.speedMode).toBe('slot');
    expect(getSlotSpeed(plan, 0)).toBe(0);
  });

  it('keeps intra-slot speed byte conflicts in buffer mode', () => {
    const speedBuffer = [encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.6), 0, 0];
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer }),
    );

    expect(plan?.speedMode).toBe('buffer');
    expect(plan?.speedBufferOverride).toEqual(scaleEncodedSpeedBuffer(speedBuffer, 1));
  });

  it.each([
    [[0, encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.3)]],
    [[encodeColorCycleSpeedByte(0.3), 0, encodeColorCycleSpeedByte(0.3), encodeColorCycleSpeedByte(0.3)]],
  ])('keeps mixed static and animated bytes in one slot in buffer mode', (speedBuffer) => {
    const plan = createSpeedPlan(
      createLayer({ gradientDefStore: createGradientDefStore(1.0) }),
      createBrushState({ speedBuffer }),
    );

    expect(plan?.speedMode).toBe('buffer');
    expect(plan?.speedBufferOverride).toEqual(scaleEncodedSpeedBuffer(speedBuffer, 1));
  });

  it('serializes painted byte slot speeds through resolved layer export with layer speed scale', async () => {
    const paintedByte = encodeColorCycleSpeedByte(0.3);
    const brushState = createBrushState({
      speedBuffer: [paintedByte, paintedByte, paintedByte, paintedByte],
    });
    const layer = createLayer({
      gradientDefStore: createGradientDefStore(1.0),
      colorCycleBrush: {
        serialize: () => ({
          layers: [{
            layerId: 'cc-layer',
            data: {
              indexBuffer: {
                width: brushState.width,
                height: brushState.height,
                data: brushState.indexBuffer,
                gradientId: brushState.gradientIdBuffer,
                speedData: brushState.speedBuffer,
                flowData: brushState.flowBuffer,
                phaseData: brushState.phaseBuffer,
              },
              gradient: { gradientStops },
              animation: { offset: 0 },
            },
            strokeData: {
              gradientDefIdBuffer: brushState.gradientDefIdBuffer,
            },
          }],
        }),
      } as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
    });

    const payload = await serializeColorCycleDataFromResolvedLayer(
      layer,
      createProject(),
      undefined,
      { resolvedSource: 'live-runtime', layerSpeedScale: 2 },
    );

    expect(payload?.colorCycle?.speedMode).toBe('slot');
    expect(payload?.colorCycle?.brushState?.speedBuffer).toBeUndefined();
    expect(payload?.colorCycle?.slotSpeeds?.find((entry) => entry.slot === 0)?.speed)
      .toBeCloseTo(decodeColorCycleSpeedByte(paintedByte) * 2, 5);
  });

  it('serializes a resolved controller speed rather than the raw layer multiplier', async () => {
    const brushState = createBrushState();
    const layer = createLayer({
      layerBaseSpeedCps: 2,
      colorCycleBrush: {
        serialize: () => ({
          layers: [{
            layerId: 'cc-layer',
            data: {
              indexBuffer: {
                width: brushState.width,
                height: brushState.height,
                data: brushState.indexBuffer,
                gradientId: brushState.gradientIdBuffer,
                speedData: brushState.speedBuffer,
                flowData: brushState.flowBuffer,
                phaseData: brushState.phaseBuffer,
              },
              gradient: { gradientStops },
              animation: { offset: 0 },
            },
            strokeData: {
              gradientDefIdBuffer: brushState.gradientDefIdBuffer,
            },
          }],
        }),
      } as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
    });

    const payload = await serializeColorCycleDataFromResolvedLayer(
      layer,
      createProject(),
      undefined,
      { resolvedSource: 'live-runtime', toolSpeed: 0.1 },
    );

    expect(payload?.colorCycle?.layerBaseSpeedCps).toBeCloseTo(0.2, 5);
    expect(payload?.colorCycle?.controllerSpeedCps).toBeCloseTo(0.2, 5);
  });
});
