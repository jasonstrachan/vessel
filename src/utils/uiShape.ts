import type {
  Layer,
  UiShape,
  UiShapeComponent,
  UiShapeComponentAnimation,
  UiShapeComponentKind,
  UiShapeComponentState,
  UiShapePalette,
  UiShapeRegionPoint,
  UiShapeTheme,
} from '@/types';

export const UI_SHAPE_MIN_GRID_SIZE = 2;
export const UI_SHAPE_MAX_GRID_SIZE = 128;
export const UI_SHAPE_MAX_COMPONENTS = 4_096;

export interface UiShapeDrawOptions {
  subpixelScrollbars?: boolean;
}

export interface UiShapeScrollbarGeometry {
  crossSize: number;
  thumbLength: number;
  trackLength: number;
  travel: number;
}

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

export const MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE: UiShapePalette = {
  face: '#ffffff',
  highlight: '#ffffff',
  light: '#ffffff',
  shadow: '#000000',
  darkShadow: '#000000',
  text: '#000000',
  active: '#000000',
  activeText: '#ffffff',
  selection: '#000000',
  selectionText: '#ffffff',
};

export const WINDOWS_95_UI_SHAPE_PALETTE: UiShapePalette = {
  ...WINDOWS_31_UI_SHAPE_PALETTE,
};

export const UI_SHAPE_THEME_PALETTES: Record<UiShapeTheme, UiShapePalette> = {
  'macintosh-system-1': MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE,
  'windows-3.1': WINDOWS_31_UI_SHAPE_PALETTE,
  'windows-95': WINDOWS_95_UI_SHAPE_PALETTE,
};

const THEMES = new Set<UiShapeTheme>([
  'macintosh-system-1',
  'windows-3.1',
  'windows-95',
]);

const COMPONENT_KINDS = new Set<UiShapeComponentKind>([
  'window',
  'title-bar',
  'menu-strip',
  'panel',
  'group-box',
  'button',
  'radio-button',
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

export const resolveUiShapeScrollbarOffset = (
  travel: number,
  value: number,
  subpixel = false,
): number => {
  const offset = Math.max(0, travel) * clamp(value, 0, 1);
  return subpixel ? offset : Math.round(offset);
};

export const resolveUiShapeScrollbarGeometry = ({
  width,
  height,
  vertical,
  theme,
}: {
  width: number;
  height: number;
  vertical: boolean;
  theme: UiShapeTheme;
}): UiShapeScrollbarGeometry => {
  const mainSize = vertical ? height : width;
  const crossAxisSize = vertical ? width : height;
  const crossSize = theme === 'windows-95'
    ? Math.max(1, Math.floor(Math.min(16, crossAxisSize, mainSize / 3)))
    : Math.max(1, Math.min(crossAxisSize, mainSize / 3));
  const trackLength = Math.max(0, mainSize - crossSize * 2);
  const unconstrainedThumbLength = Math.max(crossSize, Math.round(trackLength * 0.28));
  const thumbLength = Math.min(trackLength, unconstrainedThumbLength);
  return {
    crossSize,
    thumbLength,
    trackLength,
    travel: Math.max(0, trackLength - thumbLength),
  };
};

const normalizeColor = (value: unknown, fallback: string): string => (
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback
);

const normalizePalette = (value: unknown, theme: UiShapeTheme): UiShapePalette => {
  const palette = value && typeof value === 'object'
    ? value as Partial<UiShapePalette>
    : {};
  const fallback = UI_SHAPE_THEME_PALETTES[theme];
  return {
    face: normalizeColor(palette.face, fallback.face),
    highlight: normalizeColor(palette.highlight, fallback.highlight),
    light: normalizeColor(palette.light, fallback.light),
    shadow: normalizeColor(palette.shadow, fallback.shadow),
    darkShadow: normalizeColor(palette.darkShadow, fallback.darkShadow),
    text: normalizeColor(palette.text, fallback.text),
    active: normalizeColor(palette.active, fallback.active),
    activeText: normalizeColor(palette.activeText, fallback.activeText),
    selection: normalizeColor(palette.selection, fallback.selection),
    selectionText: normalizeColor(
      palette.selectionText,
      fallback.selectionText,
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
  theme: UiShapeTheme,
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
    ...(component.palette && typeof component.palette === 'object'
      ? { palette: normalizePalette(component.palette, theme) }
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
    const theme = THEMES.has(shape.theme as UiShapeTheme)
      ? shape.theme as UiShapeTheme
      : 'windows-3.1';
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
            const normalized = normalizeComponent(component, componentIndex, width, height, theme);
            return normalized ? [normalized] : [];
          },
        )
      : [];
    const regionPath = normalizeRegionPath(shape.regionPath, width, height);
    shapeIds.add(id);
    const now = Date.now();
    return [{
      id,
      ...(typeof shape.groupId === 'string' && shape.groupId.trim()
        ? { groupId: shape.groupId.trim().slice(0, 160) }
        : {}),
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
      theme,
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
      palette: normalizePalette(shape.palette, theme),
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
    ...(component.palette ? { palette: { ...component.palette } } : {}),
    canonicalState: { ...component.canonicalState },
    animation: component.animation ? { ...component.animation } : undefined,
  })),
}));

export const getUiShapesForLayer = (
  shapes: readonly UiShape[] | undefined,
  layerId: string,
): UiShape[] => shapes?.filter((shape) => shape.layerId === layerId) ?? [];

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
  const centerX = x + Math.floor((width - 1) / 2);
  const centerY = y + Math.floor((height - 1) / 2);
  const radius = Math.max(0, Math.min(3, Math.floor((Math.min(width, height) - 3) / 2)));
  const mainOffset = Math.floor(radius / 2);
  ctx.fillStyle = color;
  for (let step = 0; step <= radius; step += 1) {
    if (direction === 'left' || direction === 'right') {
      const halfHeight = direction === 'left' ? step : radius - step;
      ctx.fillRect(
        centerX - mainOffset + step,
        centerY - halfHeight,
        1,
        halfHeight * 2 + 1,
      );
    } else {
      const halfWidth = direction === 'up' ? step : radius - step;
      ctx.fillRect(
        centerX - halfWidth,
        centerY - mainOffset + step,
        halfWidth * 2 + 1,
        1,
      );
    }
  }
};

const RADIO_BUTTON_LAYERS = [
  '....1111....',
  '..11222211..',
  '.1223333221.',
  '.1233333321.',
  '123333333321',
  '123333333321',
  '123333333321',
  '123333333321',
  '.1233333321.',
  '.1223333221.',
  '..11222211..',
  '....1111....',
] as const;

const radioButtonPixel = (
  theme: UiShapeTheme,
  palette: UiShapePalette,
  layer: string,
  sourceX: number,
  sourceY: number,
): string | null => {
  if (layer === '.') return null;
  if (layer === '3') return palette.highlight;
  if (theme === 'macintosh-system-1') return palette.text;
  const isTopLeft = sourceX + sourceY < 11;
  if (theme === 'windows-95') {
    if (layer === '1') return isTopLeft ? palette.shadow : palette.highlight;
    return isTopLeft ? palette.darkShadow : palette.light;
  }
  if (layer === '1') return isTopLeft ? palette.darkShadow : palette.highlight;
  return isTopLeft ? palette.shadow : palette.light;
};

const drawRadioButton = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  theme: UiShapeTheme,
): void => {
  const size = Math.max(1, Math.min(12, width, height));
  const left = x + Math.floor((width - size) / 2);
  const top = y + Math.floor((height - size) / 2);
  for (let targetY = 0; targetY < size; targetY += 1) {
    const sourceY = Math.floor(targetY * 12 / size);
    const row = RADIO_BUTTON_LAYERS[sourceY]!;
    for (let targetX = 0; targetX < size; targetX += 1) {
      const sourceX = Math.floor(targetX * 12 / size);
      const color = radioButtonPixel(theme, palette, row[sourceX]!, sourceX, sourceY);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + targetX, top + targetY, 1, 1);
    }
  }
  if (state.checked !== true) return;
  const dotSize = Math.min(size, theme === 'macintosh-system-1' ? 6 : 4);
  const dotLeft = left + Math.floor((size - dotSize) / 2);
  const dotTop = top + Math.floor((size - dotSize) / 2);
  ctx.fillStyle = palette.text;
  for (let dotY = 0; dotY < dotSize; dotY += 1) {
    for (let dotX = 0; dotX < dotSize; dotX += 1) {
      const isCorner = (dotX === 0 || dotX === dotSize - 1)
        && (dotY === 0 || dotY === dotSize - 1);
      if (dotSize === 1 || !isCorner) ctx.fillRect(dotLeft + dotX, dotTop + dotY, 1, 1);
    }
  }
};

const drawTitleBar = (
  ctx: UiShapeCanvasContext,
  component: Pick<UiShapeComponent, 'height' | 'width'>,
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
};

const drawScrollbar = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  vertical: boolean,
  subpixel: boolean,
): void => {
  ctx.fillStyle = palette.light;
  ctx.fillRect(x, y, component.width, component.height);
  const {
    crossSize,
    thumbLength,
    travel,
  } = resolveUiShapeScrollbarGeometry({
    width: component.width,
    height: component.height,
    vertical,
    theme: 'windows-3.1',
  });
  if (vertical) {
    drawRaisedBox(ctx, x, y, component.width, crossSize, palette);
    drawRaisedBox(ctx, x, y + component.height - crossSize, component.width, crossSize, palette);
    drawArrow(ctx, 'up', x, y, component.width, crossSize, palette.text);
    drawArrow(ctx, 'down', x, y + component.height - crossSize, component.width, crossSize, palette.text);
    const thumbY = y + crossSize + resolveUiShapeScrollbarOffset(
      travel,
      state.value ?? 0.5,
      subpixel,
    );
    drawRaisedBox(ctx, x, thumbY, component.width, thumbLength, palette, state.pressed === true);
  } else {
    drawRaisedBox(ctx, x, y, crossSize, component.height, palette);
    drawRaisedBox(ctx, x + component.width - crossSize, y, crossSize, component.height, palette);
    drawArrow(ctx, 'left', x, y, crossSize, component.height, palette.text);
    drawArrow(ctx, 'right', x + component.width - crossSize, y, crossSize, component.height, palette.text);
    const thumbX = x + crossSize + resolveUiShapeScrollbarOffset(
      travel,
      state.value ?? 0.5,
      subpixel,
    );
    drawRaisedBox(ctx, thumbX, y, thumbLength, component.height, palette, state.pressed === true);
  }
};

const drawMacPattern = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  for (let row = 0; row < height; row += 2) {
    for (let column = row % 4 === 0 ? 0 : 1; column < width; column += 2) {
      ctx.fillRect(x + column, y + row, 1, 1);
    }
  }
};

const drawMacFrame = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  fill = palette.face,
): void => {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.darkShadow;
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillRect(x + width - 1, y, 1, height);
};

const drawMacTitleBar = (
  ctx: UiShapeCanvasContext,
  component: Pick<UiShapeComponent, 'height' | 'width'>,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  ctx.fillStyle = palette.face;
  ctx.fillRect(x, y, component.width, component.height);
  ctx.fillStyle = palette.darkShadow;
  ctx.fillRect(x, y, component.width, 1);
  ctx.fillRect(x, y + component.height - 1, component.width, 1);
  if (state.active !== false && component.height > 4) {
    for (let offset = 2; offset < component.height - 1; offset += 2) {
      ctx.fillRect(x + 1, y + offset, Math.max(0, component.width - 2), 1);
    }
  }
  const closeSize = Math.max(4, Math.min(11, component.height - 4));
  if (state.active !== false && component.width >= closeSize + 5) {
    drawMacFrame(
      ctx,
      x + 4,
      y + 2,
      closeSize,
      Math.max(3, component.height - 4),
      palette,
    );
  }
};

const drawMacScrollbar = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  vertical: boolean,
  subpixel: boolean,
): void => {
  ctx.fillStyle = palette.face;
  ctx.fillRect(x, y, component.width, component.height);
  drawMacPattern(ctx, x, y, component.width, component.height, palette.text);
  const {
    crossSize: cross,
    thumbLength: thumb,
    travel,
  } = resolveUiShapeScrollbarGeometry({
    width: component.width,
    height: component.height,
    vertical,
    theme: 'macintosh-system-1',
  });
  const button = (buttonX: number, buttonY: number, buttonWidth: number, buttonHeight: number) => {
    drawMacFrame(ctx, buttonX, buttonY, buttonWidth, buttonHeight, palette);
  };
  if (vertical) {
    button(x, y, component.width, cross);
    button(x, y + component.height - cross, component.width, cross);
    drawArrow(ctx, 'up', x, y, component.width, cross, palette.text);
    drawArrow(ctx, 'down', x, y + component.height - cross, component.width, cross, palette.text);
    const thumbY = y + cross + resolveUiShapeScrollbarOffset(
      travel,
      state.value ?? 0.5,
      subpixel,
    );
    drawMacFrame(ctx, x, thumbY, component.width, thumb, palette, state.pressed ? palette.text : palette.face);
  } else {
    button(x, y, cross, component.height);
    button(x + component.width - cross, y, cross, component.height);
    drawArrow(ctx, 'left', x, y, cross, component.height, palette.text);
    drawArrow(ctx, 'right', x + component.width - cross, y, cross, component.height, palette.text);
    const thumbX = x + cross + resolveUiShapeScrollbarOffset(
      travel,
      state.value ?? 0.5,
      subpixel,
    );
    drawMacFrame(ctx, thumbX, y, thumb, component.height, palette, state.pressed ? palette.text : palette.face);
  }
};

const drawMacComponent = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  subpixelScrollbars: boolean,
): void => {
  const { width, height } = component;
  switch (component.kind) {
    case 'window': {
      drawMacFrame(ctx, x, y, width, height, palette);
      const titleHeight = Math.max(7, Math.min(height, Math.round(Math.min(19, height * 0.24))));
      drawMacTitleBar(ctx, { ...component, height: titleHeight }, x, y, palette, state);
      break;
    }
    case 'title-bar':
      drawMacTitleBar(ctx, component, x, y, palette, state);
      break;
    case 'menu-strip':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = palette.text;
      ctx.fillRect(x, y + height - 1, width, 1);
      if (width >= 8 && height >= 7) {
        ctx.fillRect(x + 3, y + 3, 4, 3);
        ctx.fillRect(x + 4, y + 2, 2, 1);
        ctx.fillRect(x + 5, y + 1, 2, 1);
        ctx.fillStyle = palette.face;
        ctx.fillRect(x + 6, y + 3, 1, 1);
      }
      break;
    case 'panel':
      drawMacFrame(ctx, x, y, width, height, palette);
      break;
    case 'group-box':
      drawMacFrame(ctx, x, y + Math.max(3, Math.floor(height * 0.16)), width, Math.max(1, height - Math.max(3, Math.floor(height * 0.16))), palette);
      break;
    case 'button': {
      drawMacFrame(ctx, x, y, width, height, palette, state.pressed ? palette.text : palette.face);
      if (width > 4 && height > 4) {
        ctx.fillStyle = state.pressed ? palette.activeText : palette.darkShadow;
        ctx.fillRect(x + 2, y + 2, width - 4, 1);
        ctx.fillRect(x + 2, y + height - 3, width - 4, 1);
        ctx.fillRect(x + 2, y + 2, 1, height - 4);
        ctx.fillRect(x + width - 3, y + 2, 1, height - 4);
      }
      break;
    }
    case 'radio-button':
      drawRadioButton(ctx, x, y, width, height, palette, state, 'macintosh-system-1');
      break;
    case 'scrollbar-horizontal':
      drawMacScrollbar(ctx, component, x, y, palette, state, false, subpixelScrollbars);
      break;
    case 'scrollbar-vertical':
      drawMacScrollbar(ctx, component, x, y, palette, state, true, subpixelScrollbars);
      break;
    case 'selection-field': {
      const selected = state.active !== false;
      drawMacFrame(ctx, x, y, width, height, palette, selected ? palette.selection : palette.face);
      break;
    }
    case 'separator':
      ctx.fillStyle = palette.text;
      ctx.fillRect(x, y + Math.floor(height / 2), width, 1);
      break;
    case 'resize-corner':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = palette.text;
      for (let offset = 2; offset < Math.min(width, height); offset += 3) {
        ctx.beginPath();
        ctx.moveTo(x + width - offset, y + height - 1);
        ctx.lineTo(x + width - 1, y + height - offset);
        ctx.stroke();
      }
      break;
  }
};

const drawWindows95TitleBar = (
  ctx: UiShapeCanvasContext,
  component: Pick<UiShapeComponent, 'height' | 'width'>,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, component.width, component.height);
  ctx.clip();
  const active = state.active !== false;
  ctx.fillStyle = active ? palette.active : palette.shadow;
  ctx.fillRect(x, y, component.width, component.height);
  const buttonHeight = Math.max(5, Math.min(14, component.height - 4));
  const buttonWidth = Math.max(6, Math.min(16, buttonHeight + 2));
  const buttonY = y + Math.max(1, Math.floor((component.height - buttonHeight) / 2));
  const closeX = x + component.width - buttonWidth - 2;
  const maximizeX = closeX - buttonWidth - 2;
  const minimizeX = maximizeX - buttonWidth;
  ([
    ['min', minimizeX],
    ['max', maximizeX],
    ['close', closeX],
  ] as const).forEach(([kind, controlX]) => {
    if (controlX < x + 2) return;
    drawRaisedBox(ctx, controlX, buttonY, buttonWidth, buttonHeight, palette);
    ctx.fillStyle = palette.darkShadow;
    ctx.strokeStyle = palette.darkShadow;
    if (kind === 'min') {
      ctx.fillRect(
        controlX + 4,
        buttonY + buttonHeight - 4,
        Math.max(2, buttonWidth - 8),
        2,
      );
    }
    if (kind === 'max') {
      const iconWidth = Math.max(3, buttonWidth - 7);
      const iconHeight = Math.max(3, buttonHeight - 6);
      ctx.fillRect(controlX + 3, buttonY + 3, iconWidth, 2);
      ctx.fillRect(controlX + 3, buttonY + 3, 1, iconHeight);
      ctx.fillRect(controlX + 3, buttonY + iconHeight + 2, iconWidth, 1);
      ctx.fillRect(controlX + iconWidth + 2, buttonY + 3, 1, iconHeight);
    }
    if (kind === 'close') {
      const glyphSize = Math.max(2, Math.min(buttonWidth - 7, buttonHeight - 6));
      for (let offset = 0; offset < glyphSize; offset += 1) {
        ctx.fillRect(controlX + 4 + offset, buttonY + 3 + offset, 1, 1);
        ctx.fillRect(
          controlX + 4 + glyphSize - offset - 1,
          buttonY + 3 + offset,
          1,
          1,
        );
      }
    }
  });
  const iconSize = Math.max(5, Math.min(14, component.height - 4));
  if (component.width > buttonWidth * 3 + iconSize + 12) {
    const iconX = x + 2;
    const iconY = y + Math.max(1, Math.floor((component.height - iconSize) / 2));
    ctx.fillStyle = palette.darkShadow;
    ctx.fillRect(iconX + 2, iconY + 1, Math.max(2, iconSize - 4), iconSize - 2);
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(iconX + 3, iconY + 2, Math.max(1, iconSize - 6), iconSize - 4);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(iconX + iconSize - 4, iconY + 2, 1, 3);
    ctx.fillRect(iconX + iconSize - 6, iconY + 4, 3, 1);
  }
  ctx.restore();
};

const drawWindows95WindowFrame = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
): void => {
  ctx.fillStyle = palette.face;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.light;
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillStyle = palette.darkShadow;
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x + width - 1, y, 1, height);
  if (width > 2 && height > 2) {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(x + 1, y + 1, width - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, height - 2);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + 1, y + height - 2, width - 2, 1);
    ctx.fillRect(x + width - 2, y + 1, 1, height - 2);
  }
};

const drawWindows95Field = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  fill: string,
): void => {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillStyle = palette.highlight;
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x + width - 1, y, 1, height);
  if (width > 2 && height > 2) {
    ctx.fillStyle = palette.darkShadow;
    ctx.fillRect(x + 1, y + 1, width - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, height - 2);
    ctx.fillStyle = palette.light;
    ctx.fillRect(x + 1, y + height - 2, width - 2, 1);
    ctx.fillRect(x + width - 2, y + 1, 1, height - 2);
  }
};

const drawWindows95Track = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
): void => {
  ctx.fillStyle = palette.highlight;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.face;
  for (let row = 0; row < height; row += 1) {
    for (let column = row % 2; column < width; column += 2) {
      ctx.fillRect(x + column, y + row, 1, 1);
    }
  }
};

const drawWindows95ScrollbarBox = (
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
  const topLeft = pressed ? palette.darkShadow : palette.light;
  const topLeftInner = pressed ? palette.shadow : palette.highlight;
  const bottomRight = pressed ? palette.light : palette.darkShadow;
  const bottomRightInner = pressed ? palette.highlight : palette.shadow;
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

const drawWindows95Scrollbar = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  vertical: boolean,
  subpixel: boolean,
): void => {
  const {
    crossSize: cross,
    thumbLength,
    travel,
  } = resolveUiShapeScrollbarGeometry({
    width: component.width,
    height: component.height,
    vertical,
    theme: 'windows-95',
  });
  drawWindows95Track(ctx, x, y, component.width, component.height, palette);
  if (vertical) {
    drawWindows95ScrollbarBox(ctx, x, y, component.width, cross, palette);
    drawWindows95ScrollbarBox(
      ctx,
      x,
      y + component.height - cross,
      component.width,
      cross,
      palette,
    );
    drawArrow(ctx, 'up', x, y, component.width, cross, palette.text);
    drawArrow(
      ctx,
      'down',
      x,
      y + component.height - cross,
      component.width,
      cross,
      palette.text,
    );
    const thumbY = y + cross + resolveUiShapeScrollbarOffset(
      travel,
      state.value ?? 0.5,
      subpixel,
    );
    drawWindows95ScrollbarBox(
      ctx,
      x,
      thumbY,
      component.width,
      thumbLength,
      palette,
      state.pressed === true,
    );
  } else {
    drawWindows95ScrollbarBox(ctx, x, y, cross, component.height, palette);
    drawWindows95ScrollbarBox(
      ctx,
      x + component.width - cross,
      y,
      cross,
      component.height,
      palette,
    );
    drawArrow(ctx, 'left', x, y, cross, component.height, palette.text);
    drawArrow(
      ctx,
      'right',
      x + component.width - cross,
      y,
      cross,
      component.height,
      palette.text,
    );
    const thumbX = x + cross + resolveUiShapeScrollbarOffset(
      travel,
      state.value ?? 0.5,
      subpixel,
    );
    drawWindows95ScrollbarBox(
      ctx,
      thumbX,
      y,
      thumbLength,
      component.height,
      palette,
      state.pressed === true,
    );
  }
};

const drawWindows95Component = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  subpixelScrollbars: boolean,
): void => {
  const { width, height } = component;
  switch (component.kind) {
    case 'window': {
      drawWindows95WindowFrame(ctx, x, y, width, height, palette);
      const inset = Math.min(3, Math.floor(Math.min(width, height) / 3));
      const titleHeight = Math.max(1, Math.min(18, height - inset * 2));
      drawWindows95TitleBar(
        ctx,
        { ...component, width: Math.max(1, width - inset * 2), height: titleHeight },
        x + inset,
        y + inset,
        palette,
        state,
      );
      if (state.open !== false && height > titleHeight + inset * 2) {
        ctx.fillStyle = palette.face;
        ctx.fillRect(
          x + inset,
          y + inset + titleHeight,
          Math.max(1, width - inset * 2),
          Math.max(1, height - titleHeight - inset * 2),
        );
      }
      break;
    }
    case 'title-bar':
      drawWindows95TitleBar(ctx, component, x, y, palette, state);
      break;
    case 'menu-strip':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      break;
    case 'panel':
      drawWindows95Field(ctx, x, y, width, height, palette, palette.face);
      break;
    case 'group-box': {
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      const top = y + Math.min(7, Math.max(3, Math.floor(height * 0.2)));
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(x + 1, top, Math.max(0, width - 2), 1);
      ctx.fillRect(x + 1, top, 1, Math.max(0, height - (top - y) - 1));
      ctx.fillStyle = palette.highlight;
      ctx.fillRect(x + 2, top + 1, Math.max(0, width - 3), 1);
      ctx.fillRect(x + width - 1, top + 1, 1, Math.max(0, height - (top - y) - 1));
      ctx.fillRect(x + 2, y + height - 1, Math.max(0, width - 2), 1);
      break;
    }
    case 'button': {
      drawRaisedBox(ctx, x, y, width, height, palette, state.pressed === true);
      if (state.active === true && width > 8 && height > 8) {
        ctx.fillStyle = palette.text;
        for (let offset = 4; offset < width - 4; offset += 2) {
          ctx.fillRect(x + offset, y + 4, 1, 1);
          ctx.fillRect(x + offset, y + height - 5, 1, 1);
        }
        for (let offset = 6; offset < height - 6; offset += 2) {
          ctx.fillRect(x + 4, y + offset, 1, 1);
          ctx.fillRect(x + width - 5, y + offset, 1, 1);
        }
      }
      break;
    }
    case 'radio-button':
      drawRadioButton(ctx, x, y, width, height, palette, state, 'windows-95');
      break;
    case 'scrollbar-horizontal':
      drawWindows95Scrollbar(
        ctx,
        component,
        x,
        y,
        palette,
        state,
        false,
        subpixelScrollbars,
      );
      break;
    case 'scrollbar-vertical':
      drawWindows95Scrollbar(
        ctx,
        component,
        x,
        y,
        palette,
        state,
        true,
        subpixelScrollbars,
      );
      break;
    case 'selection-field': {
      drawWindows95Field(ctx, x, y, width, height, palette, palette.highlight);
      const selected = state.active !== false;
      const inset = Math.min(2, Math.floor(Math.min(width, height) / 3));
      if (selected) {
        ctx.fillStyle = palette.selection;
        ctx.fillRect(
          x + inset,
          y + inset,
          Math.max(1, width - inset * 2),
          Math.max(1, height - inset * 2),
        );
      }
      break;
    }
    case 'separator': {
      const middle = y + Math.floor((height - 1) / 2);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(x, middle, width, 1);
      if (middle + 1 < y + height) {
        ctx.fillStyle = palette.highlight;
        ctx.fillRect(x, middle + 1, width, 1);
      }
      break;
    }
    case 'resize-corner':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      for (let offset = 3; offset < Math.min(width, height); offset += 4) {
        ctx.fillStyle = palette.highlight;
        for (let step = 0; step < offset; step += 1) {
          ctx.fillRect(x + width - offset + step, y + height - 1 - step, 1, 1);
        }
        ctx.fillStyle = palette.shadow;
        for (let step = 0; step < offset - 1; step += 1) {
          ctx.fillRect(x + width - offset + step + 1, y + height - 1 - step, 1, 1);
        }
      }
      break;
  }
};

export const drawUiShapeComponent = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  originX: number,
  originY: number,
  palette: UiShapePalette,
  stateOverride?: UiShapeComponentState,
  theme: UiShapeTheme = 'windows-3.1',
  subpixelScrollbars = false,
): void => {
  const x = Math.round(originX + component.x);
  const y = Math.round(originY + component.y);
  const state = stateOverride ?? component.canonicalState;
  const { width, height } = component;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (theme === 'macintosh-system-1') {
    drawMacComponent(ctx, component, x, y, palette, state, subpixelScrollbars);
    ctx.restore();
    return;
  }
  if (theme === 'windows-95') {
    drawWindows95Component(ctx, component, x, y, palette, state, subpixelScrollbars);
    ctx.restore();
    return;
  }
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
      break;
    case 'panel':
      drawRecessedBox(ctx, x, y, width, height, palette);
      break;
    case 'group-box':
      ctx.fillStyle = palette.face;
      ctx.fillRect(x, y, width, height);
      {
        const top = y + Math.max(3, Math.floor(height * 0.16));
        ctx.fillStyle = palette.shadow;
        ctx.fillRect(x + 1, top, Math.max(0, width - 2), 1);
        ctx.fillRect(x + 1, top, 1, Math.max(0, y + height - top - 1));
        ctx.fillRect(x + 1, y + height - 2, Math.max(0, width - 2), 1);
        ctx.fillRect(x + width - 2, top, 1, Math.max(0, y + height - top - 1));
      }
      break;
    case 'button':
      drawRaisedBox(ctx, x, y, width, height, palette, state.pressed === true);
      break;
    case 'radio-button':
      drawRadioButton(ctx, x, y, width, height, palette, state, 'windows-3.1');
      break;
    case 'scrollbar-horizontal':
      drawScrollbar(ctx, component, x, y, palette, state, false, subpixelScrollbars);
      break;
    case 'scrollbar-vertical':
      drawScrollbar(ctx, component, x, y, palette, state, true, subpixelScrollbars);
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
  options: UiShapeDrawOptions = {},
): void => {
  ctx.save();
  ctx.beginPath();
  // Freehand fill is already expressed by the grid-aligned component mask.
  // Clipping that mask to the raw gesture would cut diagonal edges through its cells.
  ctx.rect(shape.x, shape.y, shape.width, shape.height);
  ctx.clip();
  shape.components.forEach((component) => {
    const stateOverride = stateOverrides?.get(component.id);
    drawUiShapeComponent(
      ctx,
      component,
      shape.x,
      shape.y,
      component.palette ?? shape.palette,
      stateOverride,
      shape.theme,
      options.subpixelScrollbars === true && stateOverride !== undefined,
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
