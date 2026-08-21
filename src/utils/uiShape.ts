import type {
  Layer,
  UiShape,
  UiShapeComponent,
  UiShapeComponentAnimation,
  UiShapeComponentKind,
  UiShapeComponentState,
  UiShapePalette,
  UiShapeRegionPoint,
} from '@/types';

export const UI_SHAPE_MIN_GRID_SIZE = 2;
export const UI_SHAPE_MAX_GRID_SIZE = 128;
export const UI_SHAPE_MAX_COMPONENTS = 4_096;

export const WINDOWS_31_UI_SHAPE_PALETTE: UiShapePalette = {
  face: '#c0c0c0',
  highlight: '#ffffff',
  light: '#dfdfdf',
  shadow: '#808080',
  darkShadow: '#000000',
  text: '#000000',
  active: '#000080',
  activeText: '#ffffff',
  selection: '#000080',
  selectionText: '#ffffff',
};

const COMPONENT_KINDS = new Set<UiShapeComponentKind>([
  'window',
  'title-bar',
  'menu-strip',
  'panel',
  'group-box',
  'button',
  'scrollbar-horizontal',
  'scrollbar-vertical',
  'selection-field',
  'separator',
  'resize-corner',
]);

type UiShapeCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type UiShapeCanvasSurface = HTMLCanvasElement | OffscreenCanvas;

const finiteNumber = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const normalizeColor = (value: unknown, fallback: string): string => (
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback
);

const normalizePalette = (value: unknown): UiShapePalette => {
  const palette = value && typeof value === 'object'
    ? value as Partial<UiShapePalette>
    : {};
  return {
    face: normalizeColor(palette.face, WINDOWS_31_UI_SHAPE_PALETTE.face),
    highlight: normalizeColor(palette.highlight, WINDOWS_31_UI_SHAPE_PALETTE.highlight),
    light: normalizeColor(palette.light, WINDOWS_31_UI_SHAPE_PALETTE.light),
    shadow: normalizeColor(palette.shadow, WINDOWS_31_UI_SHAPE_PALETTE.shadow),
    darkShadow: normalizeColor(palette.darkShadow, WINDOWS_31_UI_SHAPE_PALETTE.darkShadow),
    text: normalizeColor(palette.text, WINDOWS_31_UI_SHAPE_PALETTE.text),
    active: normalizeColor(palette.active, WINDOWS_31_UI_SHAPE_PALETTE.active),
    activeText: normalizeColor(palette.activeText, WINDOWS_31_UI_SHAPE_PALETTE.activeText),
    selection: normalizeColor(palette.selection, WINDOWS_31_UI_SHAPE_PALETTE.selection),
    selectionText: normalizeColor(
      palette.selectionText,
      WINDOWS_31_UI_SHAPE_PALETTE.selectionText,
    ),
  };
};

const normalizeState = (value: unknown): UiShapeComponentState => {
  const state = value && typeof value === 'object'
    ? value as UiShapeComponentState
    : {};
  return {
    ...(typeof state.active === 'boolean' ? { active: state.active } : {}),
    ...(typeof state.checked === 'boolean' ? { checked: state.checked } : {}),
    ...(typeof state.open === 'boolean' ? { open: state.open } : {}),
    ...(typeof state.pressed === 'boolean' ? { pressed: state.pressed } : {}),
    ...(Number.isFinite(Number(state.value))
      ? { value: clamp(Number(state.value), 0, 1) }
      : {}),
  };
};

const normalizeAnimation = (value: unknown): UiShapeComponentAnimation | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const animation = value as Partial<UiShapeComponentAnimation>;
  const kind = animation.kind;
  if (kind !== 'scroll' && kind !== 'press' && kind !== 'activate' && kind !== 'open-close') {
    return undefined;
  }
  return {
    enabled: animation.enabled === true,
    kind,
    speed: clamp(finiteNumber(animation.speed, 0.25), 0.01, 8),
    direction: animation.direction === -1 ? -1 : 1,
    rangeStart: clamp(finiteNumber(animation.rangeStart, 0), 0, 1),
    rangeEnd: clamp(finiteNumber(animation.rangeEnd, 1), 0, 1),
    phaseOffset: clamp(finiteNumber(animation.phaseOffset, 0), 0, 1),
  };
};

const normalizeRegionPath = (
  value: unknown,
  width: number,
  height: number,
): UiShapeRegionPoint[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const points = value.slice(0, 4_096).flatMap<UiShapeRegionPoint>((point) => {
    if (!point || typeof point !== 'object') return [];
    const candidate = point as Partial<UiShapeRegionPoint>;
    if (!Number.isFinite(Number(candidate.x)) || !Number.isFinite(Number(candidate.y))) return [];
    return [{
      x: clamp(Number(candidate.x), 0, width),
      y: clamp(Number(candidate.y), 0, height),
    }];
  });
  return points.length >= 3 ? points : undefined;
};

const normalizeComponent = (
  value: unknown,
  index: number,
  width: number,
  height: number,
): UiShapeComponent | null => {
  if (!value || typeof value !== 'object') return null;
  const component = value as Partial<UiShapeComponent>;
  if (!COMPONENT_KINDS.has(component.kind as UiShapeComponentKind)) return null;
  const x = clamp(Math.round(finiteNumber(component.x)), 0, Math.max(0, width - 1));
  const y = clamp(Math.round(finiteNumber(component.y)), 0, Math.max(0, height - 1));
  const componentWidth = clamp(
    Math.round(finiteNumber(component.width, 1)),
    1,
    Math.max(1, width - x),
  );
  const componentHeight = clamp(
    Math.round(finiteNumber(component.height, 1)),
    1,
    Math.max(1, height - y),
  );
  const animation = normalizeAnimation(component.animation);
  return {
    id: typeof component.id === 'string' && component.id.trim()
      ? component.id.trim().slice(0, 160)
      : `ui-component-${index}`,
    kind: component.kind as UiShapeComponentKind,
    x,
    y,
    width: componentWidth,
    height: componentHeight,
    ...(typeof component.label === 'string'
      ? { label: component.label.slice(0, 64) }
      : {}),
    canonicalState: normalizeState(component.canonicalState),
    ...(animation ? { animation } : {}),
  };
};

export const normalizeUiShapes = (
  values: unknown,
  projectWidth: number,
  projectHeight: number,
  layers: readonly Pick<Layer, 'id' | 'layerType' | 'order'>[] = [],
): UiShape[] => {
  if (!Array.isArray(values)) return [];
  const normalLayers = layers
    .filter((layer) => layer.layerType === 'normal')
    .sort((left, right) => right.order - left.order);
  const validLayerIds = new Set(normalLayers.map((layer) => layer.id));
  const fallbackLayerId = normalLayers[0]?.id ?? '';
  const shapeIds = new Set<string>();
  return values.slice(0, 1_000).flatMap<UiShape>((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const shape = value as Partial<UiShape>;
    const id = typeof shape.id === 'string' && shape.id.trim()
      ? shape.id.trim().slice(0, 160)
      : `ui-shape-${index}`;
    if (shapeIds.has(id)) return [];
    const width = clamp(Math.round(finiteNumber(shape.width, 1)), 1, Math.max(1, projectWidth));
    const height = clamp(Math.round(finiteNumber(shape.height, 1)), 1, Math.max(1, projectHeight));
    const x = clamp(Math.round(finiteNumber(shape.x)), 0, Math.max(0, projectWidth - width));
    const y = clamp(Math.round(finiteNumber(shape.y)), 0, Math.max(0, projectHeight - height));
    const layerId = validLayerIds.has(shape.layerId ?? '')
      ? shape.layerId!
      : fallbackLayerId || shape.layerId || '';
    const componentKinds = Array.isArray(shape.componentKinds)
      ? [...new Set(shape.componentKinds.filter((kind): kind is UiShapeComponentKind => (
          COMPONENT_KINDS.has(kind as UiShapeComponentKind)
        )))].slice(0, COMPONENT_KINDS.size)
      : [];
    const components = Array.isArray(shape.components)
      ? shape.components.slice(0, UI_SHAPE_MAX_COMPONENTS).flatMap<UiShapeComponent>(
          (component, componentIndex) => {
            const normalized = normalizeComponent(component, componentIndex, width, height);
            return normalized ? [normalized] : [];
          },
        )
      : [];
    const regionPath = normalizeRegionPath(shape.regionPath, width, height);
    shapeIds.add(id);
    const now = Date.now();
    return [{
      id,
      layerId,
      x,
      y,
      width,
      height,
      gridSize: clamp(
        Math.round(finiteNumber(shape.gridSize, 8)),
        UI_SHAPE_MIN_GRID_SIZE,
        UI_SHAPE_MAX_GRID_SIZE,
      ),
      theme: 'windows-3.1',
      drawMode: shape.drawMode === 'place' ? 'place' : 'fill',
      regionKind: shape.regionKind === 'freehand' ? 'freehand' : 'rectangle',
      ...(regionPath ? { regionPath } : {}),
      componentKinds: componentKinds.length > 0
        ? componentKinds
        : [...new Set(components.map((component) => component.kind))],
      colorSource:
        shape.colorSource === 'manual'
        || shape.colorSource === 'sample'
        || shape.colorSource === 'derived'
          ? shape.colorSource
          : 'default',
      palette: normalizePalette(shape.palette),
      components,
      createdAt: finiteNumber(shape.createdAt, now),
      updatedAt: finiteNumber(shape.updatedAt, now),
    }];
  });
};

export const cloneUiShapes = (shapes: readonly UiShape[]): UiShape[] => shapes.map((shape) => ({
  ...shape,
  palette: { ...shape.palette },
  regionPath: shape.regionPath?.map((point) => ({ ...point })),
  componentKinds: [...shape.componentKinds],
  components: shape.components.map((component) => ({
    ...component,
    canonicalState: { ...component.canonicalState },
    animation: component.animation ? { ...component.animation } : undefined,
  })),
}));

export const getUiShapesForLayer = (
  shapes: readonly UiShape[] | undefined,
  layerId: string,
): UiShape[] => shapes?.filter((shape) => shape.layerId === layerId) ?? [];

const GLYPHS: Record<string, readonly string[]> = {
  ' ': ['000', '000', '000', '000', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
  '/': ['001', '001', '010', '100', '100'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '110'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
};

const drawBitmapText = (
  ctx: UiShapeCanvasContext,
  text: string,
  x: number,
  y: number,
  color: string,
  maxWidth: number,
  scale: number,
): void => {
  const cell = Math.max(1, Math.round(scale));
  let cursorX = Math.round(x);
  ctx.fillStyle = color;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character] ?? GLYPHS[' '];
    const glyphWidth = 4 * cell;
    if (cursorX + glyphWidth > x + maxWidth) break;
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel === '1') {
          ctx.fillRect(cursorX + columnIndex * cell, y + rowIndex * cell, cell, cell);
        }
      });
    });
    cursorX += glyphWidth;
  }
};

const drawRaisedBox = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  pressed = false,
): void => {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = palette.face;
  ctx.fillRect(x, y, width, height);
  const topLeft = pressed ? palette.darkShadow : palette.highlight;
  const topLeftInner = pressed ? palette.shadow : palette.light;
  const bottomRight = pressed ? palette.highlight : palette.darkShadow;
  const bottomRightInner = pressed ? palette.light : palette.shadow;
  ctx.fillStyle = topLeft;
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillStyle = topLeftInner;
  if (width > 2 && height > 2) {
    ctx.fillRect(x + 1, y + 1, width - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, height - 2);
  }
  ctx.fillStyle = bottomRight;
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x + width - 1, y, 1, height);
  ctx.fillStyle = bottomRightInner;
  if (width > 2 && height > 2) {
    ctx.fillRect(x + 1, y + height - 2, width - 2, 1);
    ctx.fillRect(x + width - 2, y + 1, 1, height - 2);
  }
};

const drawRecessedBox = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  fill = palette.face,
): void => {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.darkShadow;
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillStyle = palette.highlight;
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x + width - 1, y, 1, height);
  if (width > 2 && height > 2) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + 1, y + 1, width - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, height - 2);
    ctx.fillStyle = palette.light;
    ctx.fillRect(x + 1, y + height - 2, width - 2, 1);
    ctx.fillRect(x + width - 2, y + 1, 1, height - 2);
  }
};

const drawArrow = (
  ctx: UiShapeCanvasContext,
  direction: 'left' | 'right' | 'up' | 'down',
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  const centerX = Math.floor(x + width / 2);
  const centerY = Math.floor(y + height / 2);
  const radius = Math.max(1, Math.floor(Math.min(width, height) / 4));
  ctx.fillStyle = color;
  for (let step = 0; step <= radius; step += 1) {
    if (direction === 'left') ctx.fillRect(centerX - step, centerY - step, 1, step * 2 + 1);
    if (direction === 'right') ctx.fillRect(centerX + step, centerY - step, 1, step * 2 + 1);
    if (direction === 'up') ctx.fillRect(centerX - step, centerY - step, step * 2 + 1, 1);
    if (direction === 'down') ctx.fillRect(centerX - step, centerY + step, step * 2 + 1, 1);
  }
};

const drawTitleBar = (
  ctx: UiShapeCanvasContext,
  component: Pick<UiShapeComponent, 'height' | 'label' | 'width'>,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  const active = state.active !== false;
  ctx.fillStyle = active ? palette.active : palette.shadow;
  ctx.fillRect(x, y, component.width, component.height);
  const controlSize = Math.max(5, Math.min(component.height - 2, 12));
  const controlX = x + component.width - controlSize - 1;
  drawRaisedBox(ctx, controlX, y + 1, controlSize, Math.max(3, component.height - 2), palette);
  ctx.fillStyle = palette.darkShadow;
  ctx.fillRect(controlX + 2, y + Math.max(2, component.height - 4), Math.max(1, controlSize - 4), 1);
  drawBitmapText(
    ctx,
    component.label ?? 'WINDOW',
    x + 3,
    y + Math.max(1, Math.floor((component.height - 5) / 2)),
    active ? palette.activeText : palette.text,
    Math.max(0, component.width - controlSize - 6),
    component.height >= 14 ? 2 : 1,
  );
};

const drawScrollbar = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  vertical: boolean,
): void => {
  drawRecessedBox(ctx, x, y, component.width, component.height, palette, palette.light);
  const crossSize = Math.max(4, Math.min(
    vertical ? component.width : component.height,
    vertical ? component.height / 3 : component.width / 3,
  ));
  if (vertical) {
    drawRaisedBox(ctx, x, y, component.width, crossSize, palette);
    drawRaisedBox(ctx, x, y + component.height - crossSize, component.width, crossSize, palette);
    drawArrow(ctx, 'up', x, y, component.width, crossSize, palette.text);
    drawArrow(ctx, 'down', x, y + component.height - crossSize, component.width, crossSize, palette.text);
    const trackLength = Math.max(0, component.height - crossSize * 2);
    const thumbLength = Math.max(crossSize, Math.round(trackLength * 0.28));
    const travel = Math.max(0, trackLength - thumbLength);
    const thumbY = y + crossSize + Math.round(travel * clamp(state.value ?? 0.5, 0, 1));
    drawRaisedBox(ctx, x, thumbY, component.width, thumbLength, palette, state.pressed === true);
  } else {
    drawRaisedBox(ctx, x, y, crossSize, component.height, palette);
    drawRaisedBox(ctx, x + component.width - crossSize, y, crossSize, component.height, palette);
    drawArrow(ctx, 'left', x, y, crossSize, component.height, palette.text);
    drawArrow(ctx, 'right', x + component.width - crossSize, y, crossSize, component.height, palette.text);
    const trackLength = Math.max(0, component.width - crossSize * 2);
    const thumbLength = Math.max(crossSize, Math.round(trackLength * 0.28));
    const travel = Math.max(0, trackLength - thumbLength);
    const thumbX = x + crossSize + Math.round(travel * clamp(state.value ?? 0.5, 0, 1));
    drawRaisedBox(ctx, thumbX, y, thumbLength, component.height, palette, state.pressed === true);
  }
};

export const drawUiShapeComponent = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  originX: number,
  originY: number,
  palette: UiShapePalette,
  stateOverride?: UiShapeComponentState,
): void => {
  const x = Math.round(originX + component.x);
  const y = Math.round(originY + component.y);
  const state = stateOverride ?? component.canonicalState;
  const { width, height } = component;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  switch (component.kind) {
    case 'window': {
      if (state.open === false) {
        ctx.fillStyle = palette.face;
        ctx.fillRect(x, y, width, height);
        const collapsedHeight = Math.max(7, Math.min(16, height));
        drawRaisedBox(ctx, x, y, width, collapsedHeight, palette);
        drawTitleBar(
          ctx,
          { ...component, height: Math.max(3, collapsedHeight - 4) },
          x + 2,
          y + 2,
          palette,
          state,
        );
        break;
      }
      drawRaisedBox(ctx, x, y, width, height, palette);
      const titleHeight = Math.max(7, Math.min(height - 4, Math.round(Math.min(18, height * 0.24))));
      drawTitleBar(ctx, { ...component, height: titleHeight }, x + 2, y + 2, palette, state);
      if (height > titleHeight + 5) {
        drawRecessedBox(
          ctx,
          x + 2,
          y + titleHeight + 2,
          Math.max(1, width - 4),
          Math.max(1, height - titleHeight - 4),
          palette,
          palette.face,
        );
      }
      break;
    }
    case 'title-bar':
      drawTitleBar(ctx, component, x, y, palette, state);
      break;
    case 'menu-strip':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      drawBitmapText(
        ctx,
        component.label ?? 'FILE EDIT VIEW',
        x + 2,
        y + Math.max(1, Math.floor((height - 5) / 2)),
        palette.text,
        Math.max(0, width - 4),
        height >= 14 ? 2 : 1,
      );
      break;
    case 'panel':
      drawRecessedBox(ctx, x, y, width, height, palette);
      break;
    case 'group-box':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = palette.shadow;
      ctx.strokeRect(x + 1.5, y + Math.max(3, Math.floor(height * 0.16)) + 0.5, width - 3, height - 3);
      drawBitmapText(
        ctx,
        component.label ?? 'GROUP',
        x + 4,
        y + 1,
        palette.text,
        Math.max(0, width - 8),
        height >= 20 ? 2 : 1,
      );
      break;
    case 'button':
      drawRaisedBox(ctx, x, y, width, height, palette, state.pressed === true);
      drawBitmapText(
        ctx,
        component.label ?? 'OK',
        x + Math.max(2, Math.floor(width * 0.18)),
        y + Math.max(2, Math.floor((height - 5) / 2)),
        palette.text,
        Math.max(0, Math.floor(width * 0.64)),
        height >= 16 ? 2 : 1,
      );
      break;
    case 'scrollbar-horizontal':
      drawScrollbar(ctx, component, x, y, palette, state, false);
      break;
    case 'scrollbar-vertical':
      drawScrollbar(ctx, component, x, y, palette, state, true);
      break;
    case 'selection-field': {
      const selected = state.active !== false;
      drawRecessedBox(
        ctx,
        x,
        y,
        width,
        height,
        palette,
        selected ? palette.selection : palette.highlight,
      );
      drawBitmapText(
        ctx,
        component.label ?? 'SELECTED',
        x + 3,
        y + Math.max(2, Math.floor((height - 5) / 2)),
        selected ? palette.selectionText : palette.text,
        Math.max(0, width - 6),
        height >= 16 ? 2 : 1,
      );
      break;
    }
    case 'separator':
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(x, y + Math.floor(height / 2), width, 1);
      if (height > 1) {
        ctx.fillStyle = palette.highlight;
        ctx.fillRect(x, y + Math.floor(height / 2) + 1, width, 1);
      }
      break;
    case 'resize-corner':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = palette.shadow;
      for (let offset = 3; offset < Math.min(width, height); offset += 4) {
        ctx.beginPath();
        ctx.moveTo(x + width - offset, y + height - 1);
        ctx.lineTo(x + width - 1, y + height - offset);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
};

export const drawUiShape = (
  ctx: UiShapeCanvasContext,
  shape: UiShape,
  stateOverrides?: ReadonlyMap<string, UiShapeComponentState>,
): void => {
  ctx.save();
  ctx.beginPath();
  if (shape.regionKind === 'freehand' && shape.regionPath && shape.regionPath.length >= 3) {
    ctx.moveTo(shape.x + shape.regionPath[0]!.x, shape.y + shape.regionPath[0]!.y);
    shape.regionPath.slice(1).forEach((point) => {
      ctx.lineTo(shape.x + point.x, shape.y + point.y);
    });
    ctx.closePath();
  } else {
    ctx.rect(shape.x, shape.y, shape.width, shape.height);
  }
  ctx.clip();
  shape.components.forEach((component) => {
    drawUiShapeComponent(
      ctx,
      component,
      shape.x,
      shape.y,
      shape.palette,
      stateOverrides?.get(component.id),
    );
  });
  ctx.restore();
};

export const drawUiShapesForLayer = (
  ctx: UiShapeCanvasContext,
  shapes: readonly UiShape[] | undefined,
  layerId: string,
  dirtyRects?: readonly { x: number; y: number; width: number; height: number }[],
): void => {
  const layerShapes = getUiShapesForLayer(shapes, layerId);
  if (layerShapes.length === 0) return;
  ctx.save();
  if (dirtyRects?.length) {
    ctx.beginPath();
    dirtyRects.forEach((rect) => ctx.rect(rect.x, rect.y, rect.width, rect.height));
    ctx.clip();
  }
  layerShapes.forEach((shape) => drawUiShape(ctx, shape));
  ctx.restore();
};

interface UiShapeLayerRasterCacheEntry {
  shapes: readonly UiShape[];
  width: number;
  height: number;
  shapeCanvas: UiShapeCanvasSurface;
  shapeContext: UiShapeCanvasContext;
  combinedCanvas: UiShapeCanvasSurface;
  combinedContext: UiShapeCanvasContext;
}

const uiShapeLayerRasterCache = new Map<string, UiShapeLayerRasterCacheEntry>();

const createCanvasSurface = (width: number, height: number): UiShapeCanvasSurface | null => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const getCanvasContext = (canvas: UiShapeCanvasSurface): UiShapeCanvasContext | null => (
  canvas.getContext('2d') as UiShapeCanvasContext | null
);

const resolveUiShapeLayerRasterCache = ({
  shapes,
  layerId,
  width,
  height,
}: {
  shapes: readonly UiShape[] | undefined;
  layerId: string;
  width: number;
  height: number;
}): UiShapeLayerRasterCacheEntry | null => {
  if (!shapes?.some((shape) => shape.layerId === layerId)) return null;
  let cache = uiShapeLayerRasterCache.get(layerId);
  let repaint = false;
  if (!cache || cache.width !== width || cache.height !== height) {
    const shapeCanvas = createCanvasSurface(width, height);
    const combinedCanvas = createCanvasSurface(width, height);
    if (!shapeCanvas || !combinedCanvas) return null;
    const shapeContext = getCanvasContext(shapeCanvas);
    const combinedContext = getCanvasContext(combinedCanvas);
    if (!shapeContext || !combinedContext) return null;
    cache = {
      shapes,
      width,
      height,
      shapeCanvas,
      shapeContext,
      combinedCanvas,
      combinedContext,
    };
    uiShapeLayerRasterCache.set(layerId, cache);
    if (uiShapeLayerRasterCache.size > 64) {
      const oldest = uiShapeLayerRasterCache.keys().next().value;
      if (oldest) uiShapeLayerRasterCache.delete(oldest);
    }
    repaint = true;
  }
  if (cache.shapes !== shapes) {
    cache.shapes = shapes;
    repaint = true;
  }
  if (repaint) {
    cache.shapeContext.clearRect(0, 0, width, height);
    drawUiShapesForLayer(cache.shapeContext, shapes, layerId);
  }
  return cache;
};

export const composeUiShapesIntoLayerSource = ({
  source,
  shapes,
  layerId,
  width,
  height,
}: {
  source: CanvasImageSource | null;
  shapes: readonly UiShape[] | undefined;
  layerId: string;
  width: number;
  height: number;
}): CanvasImageSource | null => {
  const cache = resolveUiShapeLayerRasterCache({ shapes, layerId, width, height });
  if (!cache) return source;
  if (!source) return cache.shapeCanvas as CanvasImageSource;
  cache.combinedContext.clearRect(0, 0, width, height);
  cache.combinedContext.drawImage(source, 0, 0);
  cache.combinedContext.drawImage(cache.shapeCanvas as CanvasImageSource, 0, 0);
  return cache.combinedCanvas as CanvasImageSource;
};

export const createUiShapeLayerRasterCache = ({
  layer,
  shapes,
  width,
  height,
}: {
  layer: Pick<Layer, 'id' | 'framebuffer' | 'imageData'>;
  shapes: readonly UiShape[] | undefined;
  width: number;
  height: number;
}): UiShapeCanvasSurface | null => {
  if (getUiShapesForLayer(shapes, layer.id).length === 0) return null;
  const canvas = createCanvasSurface(width, height);
  if (!canvas) return null;
  const context = getCanvasContext(canvas);
  if (!context) return null;
  if (layer.framebuffer) context.drawImage(layer.framebuffer as CanvasImageSource, 0, 0);
  else if (layer.imageData) context.putImageData(layer.imageData, 0, 0);
  drawUiShapesForLayer(context, shapes, layer.id);
  return canvas;
};
