import type {
  UiShapeComponentState,
  UiShapeTheme,
  UiShapeViewportScrollbars,
} from '@/types';
import { getUiShapeComponentReferenceSpec } from '@/utils/uiShapeReference';

export const UI_SHAPE_VIEWPORT_MIN_ZOOM = 0.1;
export const UI_SHAPE_VIEWPORT_MAX_ZOOM = 16;
export const UI_SHAPE_VIEWPORT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const UI_SHAPE_VIEWPORT_MAX_IMAGE_PIXELS = 16_777_216;

export interface UiShapeViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiShapeViewportLayout {
  contentRect: UiShapeViewportRect;
  horizontalScrollbar: UiShapeViewportRect | null;
  verticalScrollbar: UiShapeViewportRect | null;
  cornerRect: UiShapeViewportRect | null;
  scaledWidth: number;
  scaledHeight: number;
  maxScrollX: number;
  maxScrollY: number;
  scrollX: number;
  scrollY: number;
  horizontalRatio: number;
  verticalRatio: number;
  panX: number;
  panY: number;
  zoom: number;
}

const finiteNumber = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const clampUiShapeViewportValue = (
  value: unknown,
  minimum = 0,
  maximum = 1,
): number => Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));

export const normalizeUiShapeViewportState = (
  state: UiShapeComponentState | undefined,
): Required<Pick<UiShapeComponentState, 'panX' | 'panY' | 'zoom'>> => ({
  panX: clampUiShapeViewportValue(state?.panX, 0, 1),
  panY: clampUiShapeViewportValue(state?.panY ?? 0.5, 0, 1),
  zoom: clampUiShapeViewportValue(
    finiteNumber(state?.zoom, 1),
    UI_SHAPE_VIEWPORT_MIN_ZOOM,
    UI_SHAPE_VIEWPORT_MAX_ZOOM,
  ),
});

const hasHorizontalScrollbar = (scrollbars: UiShapeViewportScrollbars): boolean => (
  scrollbars === 'horizontal' || scrollbars === 'both'
);

const hasVerticalScrollbar = (scrollbars: UiShapeViewportScrollbars): boolean => (
  scrollbars === 'vertical' || scrollbars === 'both'
);

export const resolveUiShapeViewportLayout = ({
  width,
  height,
  naturalWidth,
  naturalHeight,
  scrollbars,
  state,
  theme,
}: {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  scrollbars: UiShapeViewportScrollbars;
  state: UiShapeComponentState | undefined;
  theme: UiShapeTheme;
}): UiShapeViewportLayout => {
  const resolvedWidth = Math.max(1, finiteNumber(width, 1));
  const resolvedHeight = Math.max(1, finiteNumber(height, 1));
  const hasHorizontal = hasHorizontalScrollbar(scrollbars);
  const hasVertical = hasVerticalScrollbar(scrollbars);
  const horizontalReference = getUiShapeComponentReferenceSpec(theme, 'scrollbar-horizontal');
  const verticalReference = getUiShapeComponentReferenceSpec(theme, 'scrollbar-vertical');
  const frameInset = Math.min(2, Math.floor(Math.min(resolvedWidth, resolvedHeight) / 3));
  const availableWidth = Math.max(1, resolvedWidth - frameInset * 2);
  const availableHeight = Math.max(1, resolvedHeight - frameInset * 2);
  const verticalSize = hasVertical
    ? Math.min(availableWidth - 1, Math.max(1, verticalReference.width))
    : 0;
  const horizontalSize = hasHorizontal
    ? Math.min(availableHeight - 1, Math.max(1, horizontalReference.height))
    : 0;
  const contentWidth = Math.max(1, availableWidth - verticalSize);
  const contentHeight = Math.max(1, availableHeight - horizontalSize);
  const contentRect = {
    x: frameInset,
    y: frameInset,
    width: contentWidth,
    height: contentHeight,
  };
  const viewportState = normalizeUiShapeViewportState(state);
  const resolvedNaturalWidth = Math.max(1, finiteNumber(naturalWidth, 1));
  const resolvedNaturalHeight = Math.max(1, finiteNumber(naturalHeight, 1));
  const scaledWidth = resolvedNaturalWidth * viewportState.zoom;
  const scaledHeight = resolvedNaturalHeight * viewportState.zoom;
  const maxScrollX = Math.max(0, scaledWidth - contentWidth);
  const maxScrollY = Math.max(0, scaledHeight - contentHeight);

  return {
    contentRect,
    horizontalScrollbar: hasHorizontal ? {
      x: frameInset,
      y: frameInset + contentHeight,
      width: contentWidth,
      height: horizontalSize,
    } : null,
    verticalScrollbar: hasVertical ? {
      x: frameInset + contentWidth,
      y: frameInset,
      width: verticalSize,
      height: contentHeight,
    } : null,
    cornerRect: hasHorizontal && hasVertical ? {
      x: frameInset + contentWidth,
      y: frameInset + contentHeight,
      width: verticalSize,
      height: horizontalSize,
    } : null,
    scaledWidth,
    scaledHeight,
    maxScrollX,
    maxScrollY,
    scrollX: maxScrollX * viewportState.panX,
    scrollY: maxScrollY * viewportState.panY,
    horizontalRatio: Math.min(1, contentWidth / scaledWidth),
    verticalRatio: Math.min(1, contentHeight / scaledHeight),
    ...viewportState,
  };
};

export const resolveUiShapeViewportPanFromDrag = ({
  layout,
  deltaX,
  deltaY,
}: {
  layout: UiShapeViewportLayout;
  deltaX: number;
  deltaY: number;
}): Pick<UiShapeComponentState, 'panX' | 'panY'> => ({
  panX: layout.maxScrollX > 0
    ? clampUiShapeViewportValue((layout.scrollX - deltaX) / layout.maxScrollX)
    : layout.panX,
  panY: layout.maxScrollY > 0
    ? clampUiShapeViewportValue((layout.scrollY - deltaY) / layout.maxScrollY)
    : layout.panY,
});

export const resolveUiShapeViewportZoomAtPoint = ({
  layout,
  localX,
  localY,
  zoom,
  naturalWidth,
  naturalHeight,
}: {
  layout: UiShapeViewportLayout;
  localX: number;
  localY: number;
  zoom: number;
  naturalWidth: number;
  naturalHeight: number;
}): Pick<UiShapeComponentState, 'panX' | 'panY' | 'zoom'> => {
  const nextZoom = clampUiShapeViewportValue(
    zoom,
    UI_SHAPE_VIEWPORT_MIN_ZOOM,
    UI_SHAPE_VIEWPORT_MAX_ZOOM,
  );
  const pointX = Math.max(0, Math.min(layout.contentRect.width, localX));
  const pointY = Math.max(0, Math.min(layout.contentRect.height, localY));
  const sourceX = (layout.scrollX + pointX) / layout.zoom;
  const sourceY = (layout.scrollY + pointY) / layout.zoom;
  const nextMaxScrollX = Math.max(
    0,
    Math.max(1, naturalWidth) * nextZoom - layout.contentRect.width,
  );
  const nextMaxScrollY = Math.max(
    0,
    Math.max(1, naturalHeight) * nextZoom - layout.contentRect.height,
  );
  const nextScrollX = sourceX * nextZoom - pointX;
  const nextScrollY = sourceY * nextZoom - pointY;
  return {
    panX: nextMaxScrollX > 0
      ? clampUiShapeViewportValue(nextScrollX / nextMaxScrollX)
      : layout.panX,
    panY: nextMaxScrollY > 0
      ? clampUiShapeViewportValue(nextScrollY / nextMaxScrollY)
      : layout.panY,
    zoom: nextZoom,
  };
};
