import { clampParameterValue, getParameterDefinition } from './parameters';
import type { ShapeFillParamKey } from './types';
import { ShapeDefinition, Vec2 } from './types';

export interface AdjustParameterOptions {
  baseValue?: number;
  scaleOverride?: number;
  clamp?: boolean;
  anchorDistance?: number;
  cursorDistance?: number;
  distanceDeltaOverride?: number;
}

export function adjustParameterFromCursor(
  shape: ShapeDefinition,
  cursor: Vec2,
  param: ShapeFillParamKey,
  options: AdjustParameterOptions = {}
): number {
  const definition = getParameterDefinition(param);
  const base = options.baseValue ?? definition.default;
  const scale = options.scaleOverride ?? definition.scale;

  const distance =
    typeof options.cursorDistance === 'number'
      ? options.cursorDistance
      : Math.hypot(cursor.x - shape.centroid.x, cursor.y - shape.centroid.y);
  const anchorDistance = options.anchorDistance;
  const distanceDelta =
    typeof options.distanceDeltaOverride === 'number'
      ? options.distanceDeltaOverride
      : typeof anchorDistance === 'number'
        ? distance - anchorDistance
        : distance;
  const nextValue = base + distanceDelta * scale;

  if (options.clamp === false) {
    return nextValue;
  }

  return clampParameterValue(nextValue, param);
}
