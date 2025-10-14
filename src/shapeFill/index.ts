import { adjustParameterFromCursor } from './parameterAdjuster';
import { clampParameterValue, getParameterDefault, getParameterDefinition } from './parameters';
import { createShape, MAX_POINTS, SAMPLE_DISTANCE_PX } from './shapeFactory';
import {
  FillParams,
  FillStage,
  FillStrategy,
  ShapeDefinition,
  ShapeFillId,
  ShapeFillSession,
  ShapeFillParamKey,
  Vec2,
} from './types';

export interface ShapeFillOrchestratorConfig {
  parameterOrder?: ShapeFillParamKey[];
  onSessionChange?: (session: ShapeFillSession | null) => void;
}

export interface ShapeFillFinalizePayload {
  shape: ShapeDefinition;
  params: FillParams;
  result: ReturnType<FillStrategy['apply']>;
  strategy: FillStrategy;
  fillId: ShapeFillId;
}

export class ShapeFillOrchestrator {
  private session: ShapeFillSession | null = null;
  private parameterOrder: ShapeFillParamKey[];
  private onSessionChange?: (session: ShapeFillSession | null) => void;
  private strategy: FillStrategy | null = null;
  private baseParams: Partial<FillParams> = {};
  private activeFillId: ShapeFillId | null = null;

  constructor(config: ShapeFillOrchestratorConfig = {}) {
    this.parameterOrder =
      config.parameterOrder ?? (['spacing', 'rotation'] as ShapeFillParamKey[]);
    this.onSessionChange = config.onSessionChange;
  }

  setSessionListener(listener: ((session: ShapeFillSession | null) => void) | undefined): void {
    this.onSessionChange = listener;
  }

  setParameterOrder(order: ShapeFillParamKey[]): void {
    if (order.length > 0) {
      this.parameterOrder = [...order];
    }
  }

  getSession(): ShapeFillSession | null {
    return this.session;
  }

  begin(
    fillId: ShapeFillId,
    strategy: FillStrategy,
    points: Vec2[],
    baseParams: Partial<FillParams> = {}
  ): ShapeFillSession | null {
    if (points.length === 0) {
      this.reset();
      return null;
    }

    const normalizedPoints = normalizePoints(points);
    if (normalizedPoints.length === 0) {
      this.reset();
      return null;
    }

    const shape = createShape(normalizedPoints);
    this.strategy = strategy;
    this.activeFillId = fillId;
    this.baseParams = {
      ...strategy.defaults,
      ...baseParams,
    };

    const preferredOrder =
      strategy.adjustOrder !== undefined ? strategy.adjustOrder : this.parameterOrder;
    const queue = preferredOrder.filter(param => param in strategy.defaults);

    this.session = {
      stage: queue.length > 0 ? FillStage.AdjustingParam : FillStage.Finalized,
      points: normalizedPoints,
      params: { ...this.baseParams },
      paramQueue: queue,
      currentParam: queue[0],
      shape,
      cursorAnchorParam: undefined,
      cursorAnchorDirection: undefined,
      lastCursor: undefined,
    };

    this.emit();
    return this.session;
  }

  updateCursor(cursor: Vec2): void {
    if (!this.session || this.session.stage !== FillStage.AdjustingParam || !this.session.shape) {
      return;
    }

    const {
      currentParam,
      shape,
      params,
      cursorAnchorParam,
      cursorAnchorDirection,
      lastCursor,
    } = this.session;
    if (!currentParam) {
      return;
    }

    const baseValue =
      this.baseParams[currentParam] ??
      getParameterDefault(currentParam);

    const centroid = shape.centroid;
    const cursorVecX = cursor.x - centroid.x;
    const cursorVecY = cursor.y - centroid.y;
    const cursorDistance = Math.hypot(cursorVecX, cursorVecY);

    if (currentParam === 'rotation') {
      if (cursorDistance < 1e-3) {
        return;
      }

      let degrees = (Math.atan2(cursorVecY, cursorVecX) * 180) / Math.PI; // -180..180
      degrees = ((degrees % 180) + 180) % 180; // wrap to [0,180)
      const clamped = clampParameterValue(degrees, 'rotation');

      this.session = {
        ...this.session,
        cursorAnchorParam: currentParam,
        cursorAnchorDirection: { x: cursorVecX / cursorDistance, y: cursorVecY / cursorDistance },
        lastCursor: { ...cursor },
        params: {
          ...params,
          [currentParam]: clamped,
        },
      };

      this.emit();
      return;
    }

    const normalizedDirection =
      cursorDistance > 1e-3
        ? { x: cursorVecX / cursorDistance, y: cursorVecY / cursorDistance }
        : cursorAnchorDirection ?? { x: 1, y: 0 };

    if (
      currentParam === 'spacing' ||
      currentParam === 'thickness' ||
      currentParam === 'variance' ||
      currentParam === 'dashLength'
    ) {
      const definition = getParameterDefinition(currentParam);
      const rawValue = definition.min + cursorDistance * definition.scale;
      const clampedValue = clampParameterValue(rawValue, currentParam);

      this.session = {
        ...this.session,
        cursorAnchorParam: currentParam,
        cursorAnchorDirection: normalizedDirection,
        lastCursor: { ...cursor },
        params: {
          ...params,
          [currentParam]: clampedValue,
        },
      };

      this.emit();
      return;
    }

    if (currentParam === 'sierraDensity') {
      const definition = getParameterDefinition('sierraDensity');
      const maxRadius = shape.points.reduce((max, point) => {
        const dx = point.x - centroid.x;
        const dy = point.y - centroid.y;
        return Math.max(max, Math.hypot(dx, dy));
      }, 0);

      const normalizedDistance =
        maxRadius > 1e-3 ? Math.min(Math.max(cursorDistance / maxRadius, 0), 1) : 0;
      const rawValue = definition.max - normalizedDistance * (definition.max - definition.min);
      const clampedValue = clampParameterValue(rawValue, 'sierraDensity');

      this.session = {
        ...this.session,
        cursorAnchorParam: currentParam,
        cursorAnchorDirection: normalizedDirection,
        lastCursor: { ...cursor },
        params: {
          ...params,
          [currentParam]: clampedValue,
        },
      };

      this.emit();
      return;
    }

    let nextAnchorParam = cursorAnchorParam;
    let previousCursor = lastCursor;

    if (cursorAnchorParam !== currentParam || !previousCursor) {
      nextAnchorParam = currentParam;
      previousCursor = { ...cursor };
    }

    let radialDelta = 0;
    if (previousCursor) {
      const deltaX = cursor.x - previousCursor.x;
      const deltaY = cursor.y - previousCursor.y;
      radialDelta = deltaX * normalizedDirection.x + deltaY * normalizedDirection.y;
    }

    let value = adjustParameterFromCursor(shape, cursor, currentParam, {
      baseValue,
      cursorDistance,
      distanceDeltaOverride: radialDelta,
    });

    if (currentParam === 'sierraResolution') {
      value = Math.round(value);
    }

    this.session = {
      ...this.session,
      cursorAnchorParam: nextAnchorParam,
      cursorAnchorDirection: normalizedDirection,
      lastCursor: { ...cursor },
      params: {
        ...params,
        [currentParam]: value,
      },
    };

    this.emit();
  }

  commitCurrentParameter(): void {
    if (!this.session || this.session.stage !== FillStage.AdjustingParam) {
      return;
    }

    const [current, ...rest] = this.session.paramQueue;
    if (!current) {
      this.finalize();
      return;
    }

    let committedValue = clampParameterValue(
      this.session.params[current] ?? getParameterDefault(current),
      current
    );

    if (current === 'sierraResolution') {
      committedValue = Math.round(committedValue);
    }

    this.baseParams = {
      ...this.baseParams,
      [current]: committedValue,
    };

    const nextQueue = rest;
    const nextParam = nextQueue[0];

    const nextStage = nextParam ? FillStage.AdjustingParam : FillStage.Finalized;

    this.session = {
      ...this.session,
      params: {
        ...this.session.params,
        [current]: committedValue,
      },
      paramQueue: nextQueue,
      currentParam: nextParam,
      stage: nextStage,
      cursorAnchorParam: undefined,
      cursorAnchorDirection: undefined,
      lastCursor: undefined,
    };

    this.emit();
  }

  setParameterValue(param: keyof FillParams, value: number | boolean | undefined): void {
    if (!this.session) {
      return;
    }

    let nextValue = value;
    if (typeof value === 'number' && isClampableParam(param)) {
      nextValue = clampParameterValue(value, param as ShapeFillParamKey);
      if (param === 'sierraResolution') {
        nextValue = Math.round(nextValue);
      }
    }

    this.baseParams = {
      ...this.baseParams,
      [param]: nextValue as never,
    };

    this.session = {
      ...this.session,
      params: {
        ...this.session.params,
        [param]: nextValue as never,
      },
      cursorAnchorParam: undefined,
      cursorAnchorDirection: undefined,
      lastCursor: undefined,
    };

    this.emit();
  }

  cancel(): void {
    this.reset();
  }

  finalize(): ShapeFillFinalizePayload | null {
    if (!this.session || !this.strategy || !this.session.shape || !this.activeFillId) {
      return null;
    }

    const finalParams: FillParams = {
      ...this.strategy.defaults,
      ...this.baseParams,
      ...this.session.params,
    };

    const payload: ShapeFillFinalizePayload = {
      shape: this.session.shape,
      params: finalParams,
      result: this.strategy.apply(this.session.shape, finalParams),
      strategy: this.strategy,
      fillId: this.activeFillId,
    };

    this.session = {
      ...this.session,
      stage: FillStage.Finalized,
      currentParam: undefined,
      paramQueue: [],
      params: finalParams,
      cursorAnchorParam: undefined,
      cursorAnchorDirection: undefined,
      lastCursor: undefined,
    };

    this.emit();
    return payload;
  }

  private reset() {
    this.session = null;
    this.strategy = null;
    this.baseParams = {};
    this.activeFillId = null;
    this.emit();
  }

  private emit() {
    this.onSessionChange?.(this.session);
  }
}

function normalizePoints(points: Vec2[]): Vec2[] {
  if (points.length <= 1) {
    return points;
  }

  const result: Vec2[] = [];
  let previous = points[0];
  result.push(previous);

  for (let i = 1; i < points.length && result.length < MAX_POINTS; i += 1) {
    const current = points[i];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (distance >= SAMPLE_DISTANCE_PX) {
      result.push(current);
      previous = current;
    }
  }

  return result;
}

function isClampableParam(param: keyof FillParams): param is ShapeFillParamKey {
  return [
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
    'sierraDensity',
    'sierraResolution',
    'flowSeedSpacing',
    'flowStepSize',
    'flowMaxSteps',
    'noiseScale',
    'noiseContrast',
    'noiseThreshold',
    'noiseOctaves',
    'noiseRandomness',
  ].includes(param as string);
}
