import { BrushShape, type Layer } from '@/types';
import {
  __TESTING__,
  applyDeterministicStampCap,
  captureSequentialStampsForActiveLayer,
  createSequentialPayloadNotificationRuntime,
  createSequentialStampCapRuntime,
  noteSequentialCaptureActivity,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { setFeatureFlag } from '@/config/featureFlags';
import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import {
  createSequentialPayloadBudgetRuntime,
  readSequentialProjectPayloadBytes,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
} from '@/lib/sequential/SequentialPayloadBudget';

const createLayer = (id: string, layerType: Layer['layerType']): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType,
    colorCycleData:
      layerType === 'color-cycle'
        ? {
            isAnimating: false,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          }
        : undefined,
    sequentialData:
      layerType === 'sequential'
        ? {
            frameCount: 12,
            fps: 12,
            durationMs: 1000,
            events: [],
          }
        : undefined,
  };
};

describe('sequentialCapture', () => {
  beforeEach(() => {
    __TESTING__.resetDefaultRuntime();
    setFeatureFlag('enableSequentialRecordMode', false);
    useAppStore.setState((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: true,
        suspendDepth: 0,
      },
      layers: [createLayer('layer-seq', 'sequential')],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 12,
        frameCount: 12,
        timeSmear: 1,
        currentFrame: 3,
        durationMs: 1000,
        isPointerDown: true,
        isCaptureActive: true,
        sessionStartMs: 1000,
      },
      tools: {
        ...state.tools,
        currentTool: 'brush',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.ROUND,
          size: 10,
          opacity: 0.7,
          spacing: 2,
          color: '#ff0000',
          blendMode: 'source-over',
        },
      },
    }));
    useAppStore.setState((state) => ({
      ui: {
        ...state.ui,
        notifications: [],
      },
    }));
  });

  it('caps stamps deterministically with a token bucket', () => {
    const runtime = createSequentialStampCapRuntime();
    const stamps = Array.from({ length: 700 }, (_, index) => ({
      x: index,
      y: 0,
      pressure: 1,
      rotation: 0,
      size: 1,
      alpha: 1,
    }));

    const first = applyDeterministicStampCap({
      runtime,
      sessionKey: 'session-a',
      stamps,
      nowMs: 1000,
    });
    expect(first).toHaveLength(600);

    const second = applyDeterministicStampCap({
      runtime,
      sessionKey: 'session-a',
      stamps,
      nowMs: 1000,
    });
    expect(second).toHaveLength(0);

    const third = applyDeterministicStampCap({
      runtime,
      sessionKey: 'session-a',
      stamps,
      nowMs: 1100,
    });
    expect(third).toHaveLength(600);
  });

  it('appends a sequential stroke event when capture is active', () => {
    setFeatureFlag('enableSequentialRecordMode', true);

    const appended = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1250,
      stamps: [
        { x: 10, y: 12, pressure: 0.8, rotation: 0.1, size: 5, alpha: 0.7 },
        { x: 12, y: 14, pressure: 0.9, rotation: 0.2, size: 6, alpha: 0.7 },
      ],
    });

    expect(appended).toBe(2);
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    const events = layer?.sequentialData?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].frameIndex).toBe(3);
    expect(events[0].timestampMs).toBe(250);
    expect(events[0].stamps).toHaveLength(2);
    expect(events[0].brush.brushShape).toBe(BrushShape.ROUND);
  });

  it('does not append when the feature flag is disabled', () => {
    const appended = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1250,
      stamps: [{ x: 5, y: 5, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });

    expect(appended).toBe(0);
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events ?? []).toHaveLength(0);
  });

  it('shows a soft warning once when sequential payload crosses the warning threshold', () => {
    setFeatureFlag('enableSequentialRecordMode', true);

    const payloadRuntime = createSequentialPayloadBudgetRuntime();
    const notificationRuntime = createSequentialPayloadNotificationRuntime();
    const payloadLimits = { softLimitBytes: 200, hardLimitBytes: 50_000 };

    const first = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1250,
      payloadRuntime,
      notificationRuntime,
      payloadLimits,
      stamps: [{ x: 5, y: 5, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(first).toBe(1);

    const notificationsAfterFirst = useAppStore.getState().ui.notifications;
    expect(notificationsAfterFirst.filter((notification) => notification.type === 'warning')).toHaveLength(1);

    const second = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1260,
      payloadRuntime,
      notificationRuntime,
      payloadLimits,
      stamps: [{ x: 8, y: 8, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(second).toBe(1);

    const notificationsAfterSecond = useAppStore.getState().ui.notifications;
    expect(notificationsAfterSecond.filter((notification) => notification.type === 'warning')).toHaveLength(1);
  });

  it('blocks capture at hard cap and does not spam error notifications', () => {
    setFeatureFlag('enableSequentialRecordMode', true);

    const payloadRuntime = createSequentialPayloadBudgetRuntime();
    const notificationRuntime = createSequentialPayloadNotificationRuntime();
    const payloadLimits = { softLimitBytes: 50, hardLimitBytes: 220 };

    const blockedFirst = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1250,
      payloadRuntime,
      notificationRuntime,
      payloadLimits,
      stamps: [{ x: 5, y: 5, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(blockedFirst).toBe(0);

    const blockedSecond = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1260,
      payloadRuntime,
      notificationRuntime,
      payloadLimits,
      stamps: [{ x: 8, y: 8, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(blockedSecond).toBe(0);

    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events ?? []).toHaveLength(0);

    const errorNotifications = useAppStore
      .getState()
      .ui.notifications.filter((notification) => notification.type === 'error');
    expect(errorNotifications).toHaveLength(1);
  });

  it('keeps a 2-minute capture within payload thresholds for typical single-stamp input', () => {
    setFeatureFlag('enableSequentialRecordMode', true);

    const payloadRuntime = createSequentialPayloadBudgetRuntime();
    const notificationRuntime = createSequentialPayloadNotificationRuntime();
    const startMs = 1000;
    const captureSteps = 1200; // 2 minutes sampled every 100ms
    let appendedTotal = 0;

    for (let index = 0; index < captureSteps; index += 1) {
      appendedTotal += captureSequentialStampsForActiveLayer({
        state: useAppStore.getState(),
        nowMs: startMs + index * 100,
        payloadRuntime,
        notificationRuntime,
        stamps: [{ x: index % 32, y: (index * 3) % 32, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
      });
    }

    const stateAfterCapture = useAppStore.getState();
    const events = stateAfterCapture.layers.find((entry) => entry.id === 'layer-seq')?.sequentialData?.events ?? [];
    const payloadBytes = readSequentialProjectPayloadBytes({
      layers: stateAfterCapture.layers,
      runtime: payloadRuntime,
    });

    expect(appendedTotal).toBe(captureSteps);
    expect(events).toHaveLength(captureSteps);
    expect(payloadBytes).toBeLessThan(SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES);
    expect(payloadBytes).toBeLessThan(SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES);

    const notifications = stateAfterCapture.ui.notifications;
    expect(notifications.filter((notification) => notification.type === 'warning')).toHaveLength(0);
    expect(notifications.filter((notification) => notification.type === 'error')).toHaveLength(0);
  });

  it('segments stroke ids when capture deactivates or brush snapshot changes', () => {
    setFeatureFlag('enableSequentialRecordMode', true);
    const runtime = createSequentialStampCapRuntime();

    const first = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1100,
      runtime,
      stamps: [{ x: 1, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(first).toBe(1);

    useAppStore.setState((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: false,
      },
    }));
    const inactiveAppend = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1200,
      runtime,
      stamps: [{ x: 2, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(inactiveAppend).toBe(0);

    useAppStore.setState((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: true,
      },
    }));
    const second = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1300,
      runtime,
      stamps: [{ x: 3, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(second).toBe(1);

    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          color: '#00ff00',
        },
      },
    }));
    const third = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1400,
      runtime,
      stamps: [{ x: 4, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(third).toBe(1);

    const events =
      useAppStore
        .getState()
        .layers.find((entry) => entry.id === 'layer-seq')?.sequentialData?.events ?? [];
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.strokeId)).toEqual([
      'stroke-1000-0',
      'stroke-1000-1',
      'stroke-1000-2',
    ]);
  });

  it('segments stroke ids after runtime capture deactivation without an inactive append call', () => {
    setFeatureFlag('enableSequentialRecordMode', true);
    const runtime = createSequentialStampCapRuntime();

    const first = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1100,
      runtime,
      stamps: [{ x: 1, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(first).toBe(1);

    noteSequentialCaptureActivity({ isActive: false, runtime });

    const second = captureSequentialStampsForActiveLayer({
      state: useAppStore.getState(),
      nowMs: 1200,
      runtime,
      stamps: [{ x: 2, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    });
    expect(second).toBe(1);

    const events =
      useAppStore
        .getState()
        .layers.find((entry) => entry.id === 'layer-seq')?.sequentialData?.events ?? [];
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.strokeId)).toEqual([
      'stroke-1000-0',
      'stroke-1000-1',
    ]);
  });
});
