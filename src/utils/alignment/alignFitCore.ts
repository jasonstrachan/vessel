export type Fit =
  | 'none'
  | 'contain'        // scale up or down relative to design
  | 'cover'
  | 'uniform'
  | 'fill'
  | 'tile';

export type Positioning = 'anchor' | 'auto';
export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export interface Size { width: number; height: number; }
export interface Rect { x: number; y: number; width: number; height: number; }

export interface AlignInput {
  fit: Fit;
  positioning: Positioning;
  horizontal?: 'left' | 'center' | 'right';
  vertical?: 'top' | 'center' | 'bottom';
  anchor?: Anchor;
  offsetPercent?: { x: number; y: number };
}

export interface BasisInput {
  surface: Size;
  painted: Size;
  frame: Rect;
  design?: Size;
  doc: Size;
  align: AlignInput;
}

export interface Placement {
  dest: Rect;
  tile?: { size: Size; phase: { x: number; y: number } };
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const pos = (value: number, fallback = 1) => (Number.isFinite(value) && value > 0 ? value : fallback);

function pivotFor(horizontal?: AlignInput['horizontal'], vertical?: AlignInput['vertical']) {
  const px = horizontal === 'center' ? 0.5 : horizontal === 'right' ? 1 : 0;
  const py = vertical === 'center' ? 0.5 : vertical === 'bottom' ? 1 : 0;
  return { px, py };
}

function pivotForAnchor(anchor?: Anchor, horizontal?: AlignInput['horizontal'], vertical?: AlignInput['vertical']) {
  if (anchor) {
    switch (anchor) {
      case 'center': return { px: 0.5, py: 0.5 };
      case 'top-left': return { px: 0, py: 0 };
      case 'top': return { px: 0.5, py: 0 };
      case 'top-right': return { px: 1, py: 0 };
      case 'left': return { px: 0, py: 0.5 };
      case 'right': return { px: 1, py: 0.5 };
      case 'bottom-left': return { px: 0, py: 1 };
      case 'bottom': return { px: 0.5, py: 1 };
      case 'bottom-right': return { px: 1, py: 1 };
    }
  }
  return pivotFor(horizontal, vertical);
}

export function scaleForFit(
  fit: Fit,
  painted: Size,
  frame: Size,
  uniformK = 1,
  design?: Size
): { sx: number; sy: number } {
  const sw = pos(painted.width);
  const sh = pos(painted.height);
  const fw = pos(frame.width);
  const fh = pos(frame.height);
  const sx = fw / sw;
  const sy = fh / sh;
  const uContain = Math.min(sx, sy);
  const uCover = Math.max(sx, sy);
  let normalizedContain = uContain;
  if (design) {
    const dw = pos(design.width);
    const dh = pos(design.height);
    if (dw > 0 && dh > 0) {
      const baseContain = Math.min(dw / sw, dh / sh) || 1;
      if (baseContain > 0) {
        normalizedContain = uContain / baseContain;
      }
    }
  }

  switch (fit) {
    case 'none':
      return { sx: 1, sy: 1 };
    case 'fill':
      return { sx, sy };
    case 'contain':
      return { sx: normalizedContain, sy: normalizedContain };
    case 'cover':
      return { sx: uCover, sy: uCover };
    case 'uniform':
      return { sx: uContain * uniformK, sy: uContain * uniformK };
    case 'tile':
      return { sx: 1, sy: 1 };
    default:
      return { sx: 1, sy: 1 };
  }
}

function originPercent(frame: Rect, offset?: { x: number; y: number }) {
  const ox = frame.x + clamp01((offset?.x ?? 0) / 100) * frame.width;
  const oy = frame.y + clamp01((offset?.y ?? 0) / 100) * frame.height;
  return { ox, oy };
}

// Anchor positioning only affects translation, never scale.
function originAnchor(
  frame: Rect,
  destWidth: number,
  destHeight: number,
  anchor?: Anchor,
  horizontal?: AlignInput['horizontal'],
  vertical?: AlignInput['vertical']
) {
  const { px, py } = pivotForAnchor(anchor, horizontal, vertical);
  const ax = frame.x + px * frame.width;
  const ay = frame.y + py * frame.height;
  return { ox: ax - px * destWidth, oy: ay - py * destHeight };
}

export function computePlacement(input: BasisInput, uniformK = 1): Placement {
  const painted = { width: pos(input.painted.width), height: pos(input.painted.height) };
  const frameSize = { width: pos(input.frame.width), height: pos(input.frame.height) };
  const frameRect = {
    x: Number.isFinite(input.frame.x) ? input.frame.x : 0,
    y: Number.isFinite(input.frame.y) ? input.frame.y : 0,
    width: frameSize.width,
    height: frameSize.height
  };

  if (input.align.fit === 'cover') {
    return {
      dest: {
        x: Math.round(frameRect.x),
        y: Math.round(frameRect.y),
        width: Math.max(1, Math.round(frameRect.width)),
        height: Math.max(1, Math.round(frameRect.height))
      }
    };
  }

  const sizeBasis = painted;
  // Always size from the painted content; normalize contain against design when provided.
  const { sx, sy } = scaleForFit(input.align.fit, sizeBasis, frameSize, uniformK, input.design);
  const destWidth = Math.max(1, sizeBasis.width * sx);
  const destHeight = Math.max(1, sizeBasis.height * sy);

  if (input.align.fit === 'tile') {
    return {
      dest: {
        x: frameRect.x,
        y: frameRect.y,
        width: frameRect.width,
        height: frameRect.height
      },
      tile: {
        size: { width: painted.width, height: painted.height },
        phase: {
          x: Math.floor(frameRect.x),
          y: Math.floor(frameRect.y)
        }
      }
    };
  }

  let origin: { ox: number; oy: number };
  if (input.align.positioning === 'anchor') {
    origin = originAnchor(
      frameRect,
      destWidth,
      destHeight,
      input.align.anchor,
      input.align.horizontal,
      input.align.vertical
    );
  } else {
    origin = originPercent(frameRect, input.align.offsetPercent);
  }

  const dest = {
    x: Math.round(origin.ox),
    y: Math.round(origin.oy),
    width: Math.max(1, Math.round(destWidth)),
    height: Math.max(1, Math.round(destHeight))
  };

  return { dest };
}
