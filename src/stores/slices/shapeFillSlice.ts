import type { StateCreator } from 'zustand';
import historyManager from '@/history/historyService';
import { createShapeSessionDelta } from '@/history/deltas/shapeSessionDelta';
import { ShapeFillOrchestrator, type ShapeFillFinalizePayload } from '@/shapeFill';
import { getFillStrategy, listFillStrategies } from '@/shapeFill/strategies';
import type {
  FillParams,
  ShapeFillId,
  ShapeFillParamKey,
  ShapeFillSession,
  Vec2,
} from '@/shapeFill/types';
import { FillStage } from '@/shapeFill/types';

type AppState = import('../useAppStore').AppState;

export interface ShapeFillState {
  activeFillId: ShapeFillId;
  availableFillIds: ShapeFillId[];
  paramsByFill: Record<ShapeFillId, Partial<FillParams>>;
  session: ShapeFillSession | null;
  parameterOrder: ShapeFillParamKey[];
  lastFinalize: ShapeFillFinalizePayload | null;
  showOutline: boolean;
  sampleUnderShape: boolean;
  useBackgroundColor: boolean;
  pixelPerfectMode: boolean;
}

export interface ShapeFillSlice {
  shapeFill: ShapeFillState;
  setShapeFillActiveFill: (fillId: ShapeFillId) => void;
  setShapeFillParameterOrder: (order: ShapeFillParamKey[]) => void;
  setShapeFillParamValue: (
    fillId: ShapeFillId,
    param: keyof FillParams,
    value: number | boolean | undefined
  ) => void;
  setShapeFillShowOutline: (show: boolean) => void;
  setShapeFillSampleUnderShape: (sample: boolean) => void;
  setShapeFillUseBackground: (enabled: boolean) => void;
  setShapeFillPixelPerfect: (enabled: boolean) => void;
  beginShapeFillSession: (points: Vec2[]) => void;
  updateShapeFillCursor: (cursor: Vec2) => void;
  commitShapeFillParameter: () => void;
  finalizeShapeFillSession: () => ShapeFillFinalizePayload | null;
  cancelShapeFillSession: () => void;
}

const defaultShapeFillStrategies = listFillStrategies();
const defaultShapeFillIds = defaultShapeFillStrategies.map(strategy => strategy.id);
const defaultShapeFillParams = defaultShapeFillStrategies.reduce<Record<ShapeFillId, Partial<FillParams>>>(
  (acc, strategy) => {
    acc[strategy.id] = { ...strategy.defaults };
    return acc;
  },
  {} as Record<ShapeFillId, Partial<FillParams>>
);

export const defaultShapeFillState: ShapeFillState = {
  activeFillId: defaultShapeFillIds[0] ?? 'hatch',
  availableFillIds: defaultShapeFillIds,
  paramsByFill: defaultShapeFillParams,
  session: null,
  parameterOrder: ['spacing', 'rotation'],
  lastFinalize: null,
  showOutline: false,
  sampleUnderShape: false,
  useBackgroundColor: false,
  pixelPerfectMode: false,
};

const SHAPE_FILL_STORAGE_KEY = 'vessel-shape-fill-settings';

const cloneVec2 = (vec: Vec2 | undefined): Vec2 | undefined =>
  vec ? { x: vec.x, y: vec.y } : undefined;

const cloneShapeSession = (session: ShapeFillSession | null): ShapeFillSession | null => {
  if (!session) {
    return null;
  }
  return {
    ...session,
    points: session.points.map((point) => ({ ...point })),
    params: { ...(session.params ?? {}) },
    paramQueue: [...session.paramQueue],
    shape: session.shape
      ? {
          ...session.shape,
          points: session.shape.points.map((point) => ({ ...point })),
          centroid: { ...session.shape.centroid },
          bounds: { ...session.shape.bounds },
        }
      : undefined,
    cursorAnchorDirection: cloneVec2(session.cursorAnchorDirection),
    lastCursor: cloneVec2(session.lastCursor),
  };
};

type PersistedShapeFillSnapshot = {
  activeFillId?: ShapeFillId;
  paramsByFill?: Record<string, Partial<FillParams>>;
  showOutline?: boolean;
  sampleUnderShape?: boolean;
  useBackgroundColor?: boolean;
  pixelPerfectMode?: boolean;
};

const VALID_FILL_PARAM_KEYS: (keyof FillParams)[] = [
  'spacing',
  'rotation',
  'thickness',
  'variance',
  'seed',
  'dashLength',
  'dashLengthJitter',
  'dashWeightJitter',
  'scatter',
  'nearFalloff',
  'farFalloff',
  'angleDrift',
  'angleScale',
  'segments',
  'sierraDensity',
  'sierraResolution',
  'organic',
  'cross',
  'flowSeedSpacing',
  'flowStepSize',
  'flowMaxSteps',
  'flowFieldStep',
  'flowUseOrthogonal',
  'noiseScale',
  'noiseContrast',
  'noiseThreshold',
  'noiseOctaves',
  'noiseRandomness',
];

const VALID_FILL_PARAM_KEY_SET = new Set<keyof FillParams>(VALID_FILL_PARAM_KEYS);

const cloneDefaultShapeFillParams = (): Record<ShapeFillId, Partial<FillParams>> => {
  return defaultShapeFillStrategies.reduce<Record<ShapeFillId, Partial<FillParams>>>(
    (acc, strategy) => {
      acc[strategy.id] = { ...(defaultShapeFillParams[strategy.id] ?? {}) };
      return acc;
    },
    {} as Record<ShapeFillId, Partial<FillParams>>
  );
};

const sanitizePersistedParams = (
  _fillId: ShapeFillId,
  params: unknown
): Partial<FillParams> => {
  if (!params || typeof params !== 'object') {
    return {};
  }

  const sanitized: Partial<FillParams> = {};
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (!VALID_FILL_PARAM_KEY_SET.has(key as keyof FillParams)) {
      return;
    }

    if (key === 'cross') {
      // Crosshatch toggle removed; ignore persisted flag.
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key as keyof FillParams] = value as never;
    }
  });

  return sanitized;
};

const loadPersistedShapeFillState = (): PersistedShapeFillSnapshot | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SHAPE_FILL_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedShapeFillSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const persistShapeFillState = (state: ShapeFillState): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const snapshot: PersistedShapeFillSnapshot = {
    activeFillId: state.activeFillId,
    paramsByFill: state.paramsByFill,
    showOutline: state.showOutline,
    sampleUnderShape: state.sampleUnderShape,
    useBackgroundColor: state.useBackgroundColor,
    pixelPerfectMode: state.pixelPerfectMode,
  };

  try {
    window.localStorage.setItem(SHAPE_FILL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota and serialization errors — persistence is best effort.
  }
};

export const createInitialShapeFillState = (): ShapeFillState => {
  const base: ShapeFillState = {
    ...defaultShapeFillState,
    paramsByFill: cloneDefaultShapeFillParams(),
  };

  const persisted = loadPersistedShapeFillState();
  if (!persisted) {
    return base;
  }

  if (persisted.paramsByFill && typeof persisted.paramsByFill === 'object') {
    Object.entries(persisted.paramsByFill).forEach(([id, params]) => {
      if (!base.availableFillIds.includes(id as ShapeFillId)) {
        return;
      }

      const fillId = id as ShapeFillId;
      const sanitized = sanitizePersistedParams(fillId, params);

      base.paramsByFill[fillId] = {
        ...base.paramsByFill[fillId],
        ...sanitized,
      };
    });
  }

  if (persisted.activeFillId && base.availableFillIds.includes(persisted.activeFillId)) {
    base.activeFillId = persisted.activeFillId;
  }

  base.showOutline = Boolean(persisted.showOutline);
  base.sampleUnderShape = Boolean(persisted.sampleUnderShape);
  base.useBackgroundColor = Boolean(persisted.useBackgroundColor);
  if (typeof persisted.pixelPerfectMode === 'boolean') {
    base.pixelPerfectMode = persisted.pixelPerfectMode;
  }

  persistShapeFillState(base);
  return base;
};

const pickFillParamsForPersist = (params: FillParams, defaults: FillParams): Partial<FillParams> => {
  const persisted: Partial<FillParams> = {};
  (Object.keys(defaults) as (keyof FillParams)[]).forEach(key => {
    const value = params[key];
    if (value !== undefined) {
      persisted[key] = value as never;
    }
  });
  return persisted;
};

export const createShapeFillSlice: StateCreator<AppState, [], [], ShapeFillSlice> = (set, get) => {
  const shapeFillOrchestrator = new ShapeFillOrchestrator();
  shapeFillOrchestrator.setParameterOrder(defaultShapeFillState.parameterOrder);
  shapeFillOrchestrator.setSessionListener((session) => {
    const nextSession = cloneShapeSession(session);
    set((state) => ({
      shapeFill: {
        ...state.shapeFill,
        session: nextSession,
      },
    }));
  });

  return {
    shapeFill: createInitialShapeFillState(),
    setShapeFillActiveFill: (fillId) => {
      const current = get();
      if (!current.shapeFill.availableFillIds.includes(fillId)) {
        return;
      }
      set((state) => ({
        shapeFill: { ...state.shapeFill, activeFillId: fillId }
      }));
      persistShapeFillState(get().shapeFill);
    },
    setShapeFillParameterOrder: (order) => {
      shapeFillOrchestrator.setParameterOrder(order);
      set((state) => ({
        shapeFill: { ...state.shapeFill, parameterOrder: [...order] }
      }));
    },
    setShapeFillParamValue: (fillId, param, value) => {
      const current = get();
      if (!current.shapeFill.availableFillIds.includes(fillId)) {
        return;
      }

      set((state) => ({
        shapeFill: {
          ...state.shapeFill,
          paramsByFill: {
            ...state.shapeFill.paramsByFill,
            [fillId]: {
              ...(state.shapeFill.paramsByFill[fillId] ?? {}),
              [param]: value,
            },
          },
        },
      }));
      persistShapeFillState(get().shapeFill);

      const session = shapeFillOrchestrator.getSession();
      const activeFillId = get().shapeFill.activeFillId;
      if (session && activeFillId === fillId) {
        shapeFillOrchestrator.setParameterValue(param, value);
      }
    },
    setShapeFillShowOutline: (show) => {
      set((state) => ({
        shapeFill: {
          ...state.shapeFill,
          showOutline: Boolean(show),
        },
      }));
      persistShapeFillState(get().shapeFill);
    },
    setShapeFillSampleUnderShape: (sample) => {
      set((state) => ({
        shapeFill: {
          ...state.shapeFill,
          sampleUnderShape: Boolean(sample),
        },
      }));
      persistShapeFillState(get().shapeFill);
    },
    setShapeFillUseBackground: (enabled) => {
      set((state) => ({
        shapeFill: {
          ...state.shapeFill,
          useBackgroundColor: Boolean(enabled),
        },
      }));
      persistShapeFillState(get().shapeFill);
    },
    setShapeFillPixelPerfect: (enabled) => {
      set((state) => ({
        shapeFill: {
          ...state.shapeFill,
          pixelPerfectMode: Boolean(enabled),
        },
      }));
      persistShapeFillState(get().shapeFill);
    },
    beginShapeFillSession: (points) => {
      const state = get();
      const fillId = state.shapeFill.activeFillId;
      const strategy = getFillStrategy(fillId);
      if (!strategy) {
        return;
      }

      const baseParams = state.shapeFill.paramsByFill[fillId] ?? strategy.defaults;
      shapeFillOrchestrator.begin(fillId, strategy, points, baseParams);
      set((prevState) => ({
        shapeFill: {
          ...prevState.shapeFill,
          lastFinalize: null,
        },
      }));
    },
    updateShapeFillCursor: (cursor) => {
      shapeFillOrchestrator.updateCursor(cursor);
    },
    commitShapeFillParameter: () => {
      shapeFillOrchestrator.commitCurrentParameter();
    },
    finalizeShapeFillSession: () => {
      const payload = shapeFillOrchestrator.finalize();
      if (!payload) {
        return null;
      }

      const strategy = getFillStrategy(payload.fillId);
      if (strategy) {
        set((state) => ({
          shapeFill: {
            ...state.shapeFill,
            lastFinalize: payload,
            paramsByFill: {
              ...state.shapeFill.paramsByFill,
              [payload.fillId]: {
                ...state.shapeFill.paramsByFill[payload.fillId],
                ...pickFillParamsForPersist(payload.params, strategy.defaults),
              },
            },
          },
        }));
        persistShapeFillState(get().shapeFill);
      }
      return payload;
    },
    cancelShapeFillSession: () => {
      const previousSession = shapeFillOrchestrator.getSession();
      shapeFillOrchestrator.cancel();

      const shouldRecordDelta =
        previousSession != null && previousSession.stage !== FillStage.Finalized;

      if (shouldRecordDelta) {
        const delta = createShapeSessionDelta({ forward: null, backward: previousSession });
        if (delta) {
          const txn = historyManager.begin('shape-session');
          txn.push(delta);
          txn.commit('Cancel Shape Session');
        }
      }

      set((currentState) => ({
        shapeFill: {
          ...currentState.shapeFill,
        },
      }));
    },
  };
};

export type { ShapeFillFinalizePayload } from '@/shapeFill';
