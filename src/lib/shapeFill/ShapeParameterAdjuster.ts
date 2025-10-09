import type { Vec2 } from './types';
import { computeDragScaledValue } from '@/utils/dragScale';

const EPSILON = 1e-3;

export interface AxisDistanceMapperBounds {
  min: number;
  max: number;
  exponent?: number;
}

export interface AxisDistanceMapperConfig {
  axis: 'x' | 'y';
  centroid: Vec2;
  referenceDistance: number;
  referenceValue: number;
  bounds: AxisDistanceMapperBounds;
  /** Optional multiplier applied to the measured distance prior to scaling */
  distanceScale?: number;
}

export interface AxisDistanceMapperResult {
  value: number;
  distance: number;
}

export type AxisDistanceMapper = (point: Vec2) => AxisDistanceMapperResult;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const measureAxisDistance = (config: AxisDistanceMapperConfig, point: Vec2): number => {
  const delta = config.axis === 'x'
    ? Math.abs(point.x - config.centroid.x)
    : Math.abs(point.y - config.centroid.y);
  const scaled = delta * (config.distanceScale ?? 1);
  return Math.max(scaled, EPSILON);
};

export const createAxisDistanceMapper = (config: AxisDistanceMapperConfig): AxisDistanceMapper => {
  const { bounds } = config;
  const referenceDistance = Math.max(config.referenceDistance, EPSILON);
  const referenceValue = clamp(config.referenceValue, bounds.min, bounds.max);

  return (point: Vec2): AxisDistanceMapperResult => {
    const distance = measureAxisDistance(config, point);

    const computed = computeDragScaledValue({
      startDistance: referenceDistance,
      currentDistance: distance,
      startValue: referenceValue,
      min: bounds.min,
      max: bounds.max,
      exponent: bounds.exponent,
    });

    return {
      value: clamp(computed, bounds.min, bounds.max),
      distance,
    };
  };
};

export interface VerticalSpacingMapperConfig {
  centroid: Vec2;
  referenceDistance: number;
  referenceValue: number;
  bounds: AxisDistanceMapperBounds;
  distanceScale?: number;
}

export const createVerticalSpacingMapper = (config: VerticalSpacingMapperConfig): AxisDistanceMapper =>
  createAxisDistanceMapper({
    axis: 'y',
    centroid: config.centroid,
    referenceDistance: config.referenceDistance,
    referenceValue: config.referenceValue,
    bounds: config.bounds,
    distanceScale: config.distanceScale,
  });

export interface ShapeParameterStepConfig {
  id: string;
  mapper: AxisDistanceMapper;
  onUpdate: (value: number, distance: number) => void;
  onCommit: (value: number, distance: number) => void;
}

export class ShapeParameterAdjustSequence {
  private readonly steps: ShapeParameterStepConfig[];

  private stepIndex = 0;

  private activePointerId: number | null = null;

  private currentValue: number | null = null;

  private lastDistance = 0;

  constructor(steps: ShapeParameterStepConfig[]) {
    if (!steps.length) {
      throw new Error('ShapeParameterAdjustSequence requires at least one step');
    }
    this.steps = steps;
  }

  get activeStepId(): string {
    return this.steps[this.stepIndex]?.id;
  }

  hasActivePointer(): boolean {
    return this.activePointerId !== null;
  }

  isActivePointer(pointerId: number): boolean {
    return this.activePointerId === pointerId;
  }

  getActivePointerId(): number | null {
    return this.activePointerId;
  }

  begin(pointer: Vec2, pointerId: number): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.activePointerId = pointerId;
    this.apply(pointer);
  }

  update(pointer: Vec2, pointerId: number): void {
    if (this.activePointerId !== pointerId) {
      return;
    }
    this.apply(pointer);
  }

  commit(pointerId: number): { id: string; value: number; done: boolean } | null {
    if (this.activePointerId !== pointerId) {
      return null;
    }
    const step = this.steps[this.stepIndex];
    if (!step || this.currentValue == null) {
      this.reset();
      return null;
    }

    const value = this.currentValue;
    const distance = this.lastDistance;
    step.onCommit(value, distance);

    this.stepIndex += 1;
    const done = this.stepIndex >= this.steps.length;
    this.activePointerId = null;
    this.currentValue = null;

    return {
      id: step.id,
      value,
      done,
    };
  }

  cancel(): void {
    this.reset();
  }

  private apply(pointer: Vec2): void {
    const step = this.steps[this.stepIndex];
    if (!step) {
      return;
    }
    const { value, distance } = step.mapper(pointer);
    this.currentValue = value;
    this.lastDistance = distance;
    step.onUpdate(value, distance);
  }

  private reset(): void {
    this.stepIndex = 0;
    this.activePointerId = null;
    this.currentValue = null;
    this.lastDistance = 0;
  }
}
