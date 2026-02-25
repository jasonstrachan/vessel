/**
 * CanvasSpaces - Single source of truth for coordinate transforms
 *
 * Compute spaces = {world↔device, css↔device} once per frame;
 * pass into both preview and final. No ad-hoc ctx.setTransform scattered around.
 * This directly fixes preview/final drift.
 */

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CanvasSpaces {
  // World to device (canvas pixels)
  worldToDevice: (wx: number, wy: number) => { x: number; y: number };
  deviceToWorld: (dx: number, dy: number) => { x: number; y: number };

  // CSS to device
  cssToDevice: (cx: number, cy: number) => { x: number; y: number };
  deviceToCss: (dx: number, dy: number) => { x: number; y: number };

  // Direct transform application to context
  applyToContext: (ctx: CanvasRenderingContext2D) => void;
  resetContext: (ctx: CanvasRenderingContext2D) => void;

  // Raw values for direct use
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Create a unified transform space calculator
 */
export function createCanvasSpaces(transform: ViewTransform): CanvasSpaces {
  const { scale, offsetX, offsetY } = transform;

  return {
    worldToDevice: (wx: number, wy: number) => ({
      x: wx * scale + offsetX,
      y: wy * scale + offsetY,
    }),

    deviceToWorld: (dx: number, dy: number) => ({
      x: (dx - offsetX) / scale,
      y: (dy - offsetY) / scale,
    }),

    cssToDevice: (cx: number, cy: number) => ({
      x: cx,
      y: cy,
    }),

    deviceToCss: (dx: number, dy: number) => ({
      x: dx,
      y: dy,
    }),

    applyToContext: (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    },

    resetContext: (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },

    scale,
    offsetX,
    offsetY,
  };
}

/**
 * Helper to get current spaces from a view transform ref
 */
export function getCurrentSpaces(
  viewTransformRef: React.MutableRefObject<ViewTransform>
): CanvasSpaces {
  return createCanvasSpaces(viewTransformRef.current);
}
