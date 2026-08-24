import type {
  UiShapeComponent,
  UiShapeComponentState,
  UiShapePalette,
} from '@/types';

type UiShapeCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type System7ScrollbarPressedPart = 'thumb' | 'decrement' | 'increment';

interface DrawSystem7ComponentOptions {
  subpixelScrollbars?: boolean;
  scrollbarPressedPart?: System7ScrollbarPressedPart;
}

const SYSTEM_7_TONES = {
  arrow: '#d0d0d0',
  arrowPressed: '#b8b8b8',
  track: '#e0e0e0',
  thumb: '#bcbcbc',
  thumbPressed: '#909090',
} as const;

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const fillRect = (
  ctx: UiShapeCanvasContext,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void => {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
};

const drawOutlineRect = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  if (width <= 0 || height <= 0) return;
  fillRect(ctx, color, x, y, width, 1);
  fillRect(ctx, color, x, y + height - 1, width, 1);
  fillRect(ctx, color, x, y, 1, height);
  fillRect(ctx, color, x + width - 1, y, 1, height);
};

const drawBevelRect = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  fill: string,
  includeBevel = true,
): void => {
  fillRect(ctx, fill, x, y, width, height);
  drawOutlineRect(ctx, x, y, width, height, palette.darkShadow);
  if (!includeBevel || width <= 3 || height <= 3) return;
  fillRect(ctx, palette.highlight, x + 1, y + 1, width - 2, 1);
  fillRect(ctx, palette.highlight, x + 1, y + 1, 1, height - 2);
  fillRect(ctx, palette.shadow, x + 1, y + height - 2, width - 2, 1);
  fillRect(ctx, palette.shadow, x + width - 2, y + 1, 1, height - 2);
};

const roundedRectContains = (
  column: number,
  row: number,
  width: number,
  height: number,
  radius: number,
): boolean => {
  if (column < 0 || row < 0 || column >= width || row >= height) return false;
  const resolvedRadius = Math.max(1, Math.min(radius, width / 2, height / 2));
  const leftCenter = resolvedRadius - 0.5;
  const rightCenter = width - resolvedRadius - 0.5;
  const topCenter = resolvedRadius - 0.5;
  const bottomCenter = height - resolvedRadius - 0.5;
  const centerX = column < resolvedRadius
    ? leftCenter
    : column >= width - resolvedRadius
      ? rightCenter
      : column;
  const centerY = row < resolvedRadius
    ? topCenter
    : row >= height - resolvedRadius
      ? bottomCenter
      : row;
  const deltaX = column - centerX;
  const deltaY = row - centerY;
  return deltaX * deltaX + deltaY * deltaY <= resolvedRadius * resolvedRadius;
};

const drawRoundedRect = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  outline?: string,
): void => {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = fill;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (roundedRectContains(column, row, width, height, radius)) {
        ctx.fillRect(x + column, y + row, 1, 1);
      }
    }
  }
  if (!outline) return;
  ctx.fillStyle = outline;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!roundedRectContains(column, row, width, height, radius)) continue;
      if (!roundedRectContains(column - 1, row - 1, width - 2, height - 2, radius - 1)) {
        ctx.fillRect(x + column, y + row, 1, 1);
      }
    }
  }
};

const drawRoundedOutline = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  thickness: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!roundedRectContains(column, row, width, height, radius)) continue;
      if (roundedRectContains(
        column - thickness,
        row - thickness,
        width - thickness * 2,
        height - thickness * 2,
        radius - thickness,
      )) {
        continue;
      }
      ctx.fillRect(x + column, y + row, 1, 1);
    }
  }
};

const drawDefaultButtonRing = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  drawRoundedOutline(ctx, x - 4, y - 4, width + 8, height + 8, 8, 3, color);
};

const drawButton = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  if (state.active === true) {
    drawDefaultButtonRing(ctx, x, y, component.width, component.height, palette.darkShadow);
  }
  fillRect(ctx, palette.highlight, x, y, component.width, component.height);
  drawRoundedRect(
    ctx,
    x,
    y,
    component.width,
    component.height,
    Math.min(6, Math.floor(component.height / 2)),
    state.pressed === true ? palette.darkShadow : palette.highlight,
    palette.darkShadow,
  );
};

const drawCloseBox = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  palette: UiShapePalette,
): void => {
  const size = 14;
  fillRect(ctx, SYSTEM_7_TONES.track, x - 1, y, 1, size);
  fillRect(ctx, SYSTEM_7_TONES.track, x + size, y, 1, size);
  drawBevelRect(ctx, x, y, size, size, palette, palette.shadow);
};

const drawTitleBar = (
  ctx: UiShapeCanvasContext,
  component: Pick<UiShapeComponent, 'width' | 'height'>,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  const { width, height } = component;
  const isActive = state.active !== false;
  fillRect(ctx, isActive ? palette.face : palette.highlight, x, y, width, height);
  drawOutlineRect(ctx, x, y, width, height, palette.darkShadow);
  if (!isActive || width <= 2 || height <= 4) return;

  for (let offset = 4; offset < height - 1; offset += 3) {
    fillRect(ctx, palette.shadow, x + 1, y + offset, Math.max(0, width - 2), 1);
  }

  if (height >= 18 && width >= 35) {
    drawCloseBox(ctx, x + 10, y + 4, palette);
  }
};

const drawArrow = (
  ctx: UiShapeCanvasContext,
  direction: 'up' | 'down' | 'left' | 'right',
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  const centerX = x + Math.floor(width / 2);
  const centerY = y + Math.floor(height / 2);
  ctx.fillStyle = color;
  for (let step = 0; step <= 6; step += 1) {
    const halfSpan = Math.ceil(step / 2);
    if (direction === 'up') {
      ctx.fillRect(centerX - halfSpan, centerY - 3 + step, halfSpan * 2 + 1, 1);
    } else if (direction === 'down') {
      ctx.fillRect(centerX - halfSpan, centerY + 3 - step, halfSpan * 2 + 1, 1);
    } else if (direction === 'left') {
      ctx.fillRect(centerX - 3 + step, centerY - halfSpan, 1, halfSpan * 2 + 1);
    } else {
      ctx.fillRect(centerX + 3 - step, centerY - halfSpan, 1, halfSpan * 2 + 1);
    }
  }
};

const drawScrollbarThumb = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  vertical: boolean,
  pressed: boolean,
): void => {
  drawBevelRect(
    ctx,
    x,
    y,
    width,
    height,
    palette,
    pressed ? SYSTEM_7_TONES.thumbPressed : SYSTEM_7_TONES.thumb,
    !pressed,
  );
  if (pressed) return;
  const centerX = x + Math.floor(width / 2);
  const centerY = y + Math.floor(height / 2);
  if (vertical && height >= 12) {
    fillRect(ctx, palette.shadow, centerX - 3, centerY - 1, 8, 1);
    fillRect(ctx, palette.shadow, centerX - 3, centerY + 1, 8, 1);
  } else if (!vertical && width >= 12) {
    fillRect(ctx, palette.shadow, centerX - 1, centerY - 3, 1, 8);
    fillRect(ctx, palette.shadow, centerX + 1, centerY - 3, 1, 8);
  }
};

const drawScrollbar = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  vertical: boolean,
  options: DrawSystem7ComponentOptions,
): void => {
  const mainSize = vertical ? component.height : component.width;
  const crossAxisSize = vertical ? component.width : component.height;
  const crossSize = Math.max(1, Math.min(16, crossAxisSize, mainSize / 3));
  const trackLength = Math.max(0, mainSize - crossSize * 2);
  const thumbLength = Math.min(trackLength, Math.max(10, Math.round(trackLength * 0.28)));
  const travel = Math.max(0, trackLength - thumbLength);
  const rawOffset = travel * clamp(state.value ?? 0.5, 0, 1);
  const offset = options.subpixelScrollbars ? rawOffset : Math.round(rawOffset);
  const pressedPart = options.scrollbarPressedPart;

  const trackX = vertical ? x : x + crossSize;
  const trackY = vertical ? y + crossSize : y;
  const trackWidth = vertical ? component.width : trackLength;
  const trackHeight = vertical ? trackLength : component.height;
  drawBevelRect(ctx, trackX, trackY, trackWidth, trackHeight, palette, SYSTEM_7_TONES.track);

  const drawScrollButton = (
    buttonX: number,
    buttonY: number,
    buttonWidth: number,
    buttonHeight: number,
    part: 'decrement' | 'increment',
    direction: 'up' | 'down' | 'left' | 'right',
  ): void => {
    drawBevelRect(
      ctx,
      buttonX,
      buttonY,
      buttonWidth,
      buttonHeight,
      palette,
      pressedPart === part ? SYSTEM_7_TONES.arrowPressed : SYSTEM_7_TONES.arrow,
    );
    drawArrow(ctx, direction, buttonX, buttonY, buttonWidth, buttonHeight, palette.text);
  };

  if (vertical) {
    drawScrollButton(x, y, component.width, crossSize, 'decrement', 'up');
    drawScrollButton(
      x,
      y + component.height - crossSize,
      component.width,
      crossSize,
      'increment',
      'down',
    );
    drawScrollbarThumb(
      ctx,
      x,
      y + crossSize + offset,
      component.width,
      thumbLength,
      palette,
      true,
      state.pressed === true || pressedPart === 'thumb',
    );
    return;
  }

  drawScrollButton(x, y, crossSize, component.height, 'decrement', 'left');
  drawScrollButton(
    x + component.width - crossSize,
    y,
    crossSize,
    component.height,
    'increment',
    'right',
  );
  drawScrollbarThumb(
    ctx,
    x + crossSize + offset,
    y,
    thumbLength,
    component.height,
    palette,
    false,
    state.pressed === true || pressedPart === 'thumb',
  );
};

const ellipseContains = (
  column: number,
  row: number,
  width: number,
  height: number,
): boolean => {
  if (column < 0 || row < 0 || column >= width || row >= height) return false;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const deltaX = (column + 0.5 - radiusX) / radiusX;
  const deltaY = (row + 0.5 - radiusY) / radiusY;
  return deltaX * deltaX + deltaY * deltaY <= 1;
};

const drawEllipse = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  outlineOnly = false,
): void => {
  ctx.fillStyle = color;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!ellipseContains(column, row, width, height)) continue;
      if (
        outlineOnly
        && ellipseContains(column - 1, row - 1, width - 2, height - 2)
      ) {
        continue;
      }
      ctx.fillRect(x + column, y + row, 1, 1);
    }
  }
};

const drawRadioButton = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  const size = Math.max(1, Math.min(12, width, height));
  const left = x + Math.floor((width - size) / 2);
  const top = y + Math.floor((height - size) / 2);
  fillRect(ctx, palette.highlight, left, top, size, size);
  drawEllipse(ctx, left, top, size, size, palette.text, true);
  if (state.checked !== true || size <= 6) return;
  drawEllipse(ctx, left + 3, top + 3, size - 6, size - 6, palette.text);
};

const drawResizeCorner = (
  ctx: UiShapeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  const length = Math.max(1, Math.min(16, width, height));
  for (let inset = 0; inset <= 8; inset += 4) {
    for (let index = inset; index < length; index += 1) {
      ctx.fillRect(x + width - length + index, y + height - 1 - index + inset, 1, 1);
    }
  }
};

const drawWindow = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
): void => {
  const { width, height } = component;
  fillRect(ctx, palette.face, x, y, width, height);
  drawOutlineRect(ctx, x, y, width, height, palette.darkShadow);
  if (width > 3 && height > 3) {
    fillRect(ctx, palette.darkShadow, x + width - 3, y + 1, 2, height - 2);
    fillRect(ctx, palette.darkShadow, x + 1, y + height - 3, width - 4, 2);
  }
  const titleHeight = Math.max(7, Math.min(20, height));
  drawTitleBar(ctx, { width, height: titleHeight }, x, y, palette, state);
  if (state.open !== false && height > titleHeight + 1) {
    fillRect(
      ctx,
      palette.highlight,
      x + 1,
      y + titleHeight + 1,
      Math.max(0, width - 4),
      Math.max(0, height - titleHeight - 4),
    );
  }
  if (titleHeight < height) {
    fillRect(ctx, palette.darkShadow, x, y + titleHeight, width - 1, 1);
  }
};

/**
 * Source-aligned System 7 component geometry adapted from Kelsi Rae Davis' MIT-licensed
 * clean-room System7 implementation. See THIRD_PARTY_NOTICES.md.
 */
export const drawSystem7Component = (
  ctx: UiShapeCanvasContext,
  component: UiShapeComponent,
  x: number,
  y: number,
  palette: UiShapePalette,
  state: UiShapeComponentState,
  options: DrawSystem7ComponentOptions = {},
): void => {
  const { width, height } = component;
  switch (component.kind) {
    case 'window':
      drawWindow(ctx, component, x, y, palette, state);
      break;
    case 'title-bar':
      drawTitleBar(ctx, component, x, y, palette, state);
      break;
    case 'menu-strip':
      fillRect(ctx, palette.highlight, x, y, width, height);
      fillRect(ctx, palette.darkShadow, x, y + height - 1, width, 1);
      break;
    case 'panel':
      fillRect(ctx, palette.face, x, y, width, height);
      drawOutlineRect(ctx, x, y, width, height, palette.darkShadow);
      if (width > 4 && height > 4) {
        drawOutlineRect(ctx, x + 1, y + 1, width - 2, height - 2, palette.highlight);
        drawOutlineRect(ctx, x + 2, y + 2, width - 4, height - 4, palette.darkShadow);
      }
      break;
    case 'group-box': {
      fillRect(ctx, palette.face, x, y, width, height);
      const top = y + Math.min(9, Math.max(3, Math.floor(height * 0.16)));
      drawOutlineRect(ctx, x, top, width, Math.max(1, height - (top - y)), palette.darkShadow);
      break;
    }
    case 'button':
      drawButton(ctx, component, x, y, palette, state);
      break;
    case 'radio-button':
      drawRadioButton(ctx, x, y, width, height, palette, state);
      break;
    case 'scrollbar-horizontal':
      drawScrollbar(ctx, component, x, y, palette, state, false, options);
      break;
    case 'scrollbar-vertical':
      drawScrollbar(ctx, component, x, y, palette, state, true, options);
      break;
    case 'selection-field':
      fillRect(ctx, palette.highlight, x, y, width, height);
      if (state.active === false) {
        drawOutlineRect(ctx, x, y, width, height, palette.darkShadow);
      } else {
        drawOutlineRect(ctx, x, y, width, height, palette.darkShadow);
        if (width > 2 && height > 2) {
          drawOutlineRect(ctx, x + 1, y + 1, width - 2, height - 2, palette.darkShadow);
        }
        fillRect(ctx, palette.selection, x + 2, y + 2, width - 4, height - 4);
      }
      break;
    case 'separator': {
      const lineY = y + Math.max(0, Math.floor((height - 1) / 2));
      const inset = Math.min(8, Math.floor(width / 4));
      fillRect(ctx, palette.shadow, x + inset, lineY, Math.max(0, width - inset * 2), 1);
      break;
    }
    case 'resize-corner':
      fillRect(ctx, palette.highlight, x, y, width, height);
      drawResizeCorner(ctx, x, y, width, height, palette.text);
      break;
    case 'icon':
      break;
  }
};
