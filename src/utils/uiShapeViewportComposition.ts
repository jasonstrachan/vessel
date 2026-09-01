import type {
  UiImageAsset,
  UiShape,
  UiShapeComponent,
  UiShapeComponentState,
  UiShapeViewportCompositionPreset,
} from '@/types';
import {
  clampUiShapeViewportValue,
  normalizeUiShapeViewportState,
  resolveUiShapeViewportLayout,
  UI_SHAPE_VIEWPORT_MAX_ZOOM,
  UI_SHAPE_VIEWPORT_MIN_ZOOM,
} from '@/utils/uiShapeViewport';

export const UI_SHAPE_VIEWPORT_COMPOSITION_PRESETS = [
  'cascade',
  'survey',
  'echo',
  'counterpoint',
] as const satisfies readonly UiShapeViewportCompositionPreset[];

export const DEFAULT_UI_SHAPE_VIEWPORT_COMPOSITION_PRESET: UiShapeViewportCompositionPreset =
  'cascade';

interface FocusPoint {
  x: number;
  y: number;
  weight: number;
}

interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const componentMap = (
  components: readonly UiShapeComponent[],
): ReadonlyMap<string, UiShapeComponent> => new Map(
  components.map((component) => [component.id, component]),
);

export const normalizeUiShapeViewportCompositionPreset = (
  value: unknown,
): UiShapeViewportCompositionPreset | undefined => (
  UI_SHAPE_VIEWPORT_COMPOSITION_PRESETS.includes(value as UiShapeViewportCompositionPreset)
    ? value as UiShapeViewportCompositionPreset
    : undefined
);

export const normalizeUiShapeViewportHierarchy = (
  components: readonly UiShapeComponent[],
): UiShapeComponent[] => {
  const byId = componentMap(components);
  return components.map((component) => {
    const requestedParentId = component.kind === 'image-viewport'
      && typeof component.parentId === 'string'
      ? component.parentId
      : undefined;
    const parent = requestedParentId ? byId.get(requestedParentId) : undefined;
    if (!parent || parent.kind !== 'image-viewport' || parent.id === component.id) {
      const next = { ...component };
      delete next.parentId;
      return next;
    }
    const visited = new Set([component.id]);
    let ancestor: UiShapeComponent | undefined = parent;
    while (ancestor) {
      if (visited.has(ancestor.id)) {
        const next = { ...component };
        delete next.parentId;
        return next;
      }
      visited.add(ancestor.id);
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    return { ...component, parentId: parent.id };
  });
};

export const resolveUiShapeViewportRootId = (
  components: readonly UiShapeComponent[],
  componentId: string,
): string | null => {
  const byId = componentMap(components);
  let current = byId.get(componentId);
  if (current?.kind !== 'image-viewport') return null;
  const visited = new Set<string>();
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (parent?.kind !== 'image-viewport') break;
    current = parent;
  }
  return current.id;
};

export const getUiShapeViewportDescendantIds = (
  components: readonly UiShapeComponent[],
  componentId: string,
): string[] => {
  const descendants: string[] = [];
  const queue = [componentId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    components.forEach((component) => {
      if (component.parentId !== parentId || descendants.includes(component.id)) return;
      descendants.push(component.id);
      queue.push(component.id);
    });
  }
  return descendants;
};

const resolveDepth = (
  component: UiShapeComponent,
  byId: ReadonlyMap<string, UiShapeComponent>,
): number => {
  let depth = 0;
  let current = component;
  const visited = new Set<string>();
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
};

export const sortUiShapeComponentsForRendering = (
  components: readonly UiShapeComponent[],
): UiShapeComponent[] => {
  const byId = componentMap(components);
  return components
    .map((component, index) => ({ component, depth: resolveDepth(component, byId), index }))
    .sort((left, right) => left.depth - right.depth || left.index - right.index)
    .map(({ component }) => component);
};

export const resolveUiShapeViewportAncestorClipRects = (
  shape: Pick<UiShape, 'components' | 'theme'>,
  componentId: string,
): Array<{ x: number; y: number; width: number; height: number }> => {
  const byId = componentMap(shape.components);
  const clips: Array<{ x: number; y: number; width: number; height: number }> = [];
  let current = byId.get(componentId);
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (parent?.kind !== 'image-viewport' || !parent.imageViewport) break;
    const layout = resolveUiShapeViewportLayout({
      width: parent.width,
      height: parent.height,
      naturalWidth: parent.imageViewport.naturalWidth,
      naturalHeight: parent.imageViewport.naturalHeight,
      scrollbars: parent.imageViewport.scrollbars,
      state: parent.canonicalState,
      theme: shape.theme,
    });
    clips.push({
      x: parent.x + layout.contentRect.x,
      y: parent.y + layout.contentRect.y,
      width: layout.contentRect.width,
      height: layout.contentRect.height,
    });
    current = parent;
  }
  return clips.reverse();
};

const fallbackFocusPoints: FocusPoint[] = [
  { x: 0.5, y: 0.5, weight: 1 },
  { x: 0.3, y: 0.38, weight: 0.72 },
  { x: 0.7, y: 0.38, weight: 0.7 },
  { x: 0.32, y: 0.7, weight: 0.58 },
  { x: 0.68, y: 0.7, weight: 0.56 },
];

const focusPointsForAsset = (asset: UiImageAsset): FocusPoint[] => {
  const points = (asset.focusPoints ?? []).flatMap<FocusPoint>((point) => {
    if (![point.x, point.y, point.weight].every(Number.isFinite)) return [];
    return [{
      x: clampUiShapeViewportValue(point.x),
      y: clampUiShapeViewportValue(point.y),
      weight: Math.max(0, point.weight),
    }];
  });
  return (points.length > 0 ? points : fallbackFocusPoints)
    .slice()
    .sort((left, right) => right.weight - left.weight);
};

const stateForFocus = ({
  component,
  shape,
  focus,
  zoom,
}: {
  component: UiShapeComponent;
  shape: UiShape;
  focus: FocusPoint;
  zoom: number;
}): Required<Pick<UiShapeComponentState, 'panX' | 'panY' | 'zoom'>> => {
  const viewport = component.imageViewport!;
  const resolvedZoom = clamp(zoom, UI_SHAPE_VIEWPORT_MIN_ZOOM, UI_SHAPE_VIEWPORT_MAX_ZOOM);
  const layout = resolveUiShapeViewportLayout({
    width: component.width,
    height: component.height,
    naturalWidth: viewport.naturalWidth,
    naturalHeight: viewport.naturalHeight,
    scrollbars: viewport.scrollbars,
    state: { panX: 0.5, panY: 0.5, zoom: resolvedZoom },
    theme: shape.theme,
  });
  const scrollX = focus.x * viewport.naturalWidth * resolvedZoom - layout.contentRect.width / 2;
  const scrollY = focus.y * viewport.naturalHeight * resolvedZoom - layout.contentRect.height / 2;
  return {
    panX: layout.maxScrollX > 0 ? clampUiShapeViewportValue(scrollX / layout.maxScrollX) : 0.5,
    panY: layout.maxScrollY > 0 ? clampUiShapeViewportValue(scrollY / layout.maxScrollY) : 0.5,
    zoom: resolvedZoom,
  };
};

const sourceRectForState = (
  component: UiShapeComponent,
  shape: UiShape,
  state: UiShapeComponentState,
): SourceRect => {
  const viewport = component.imageViewport!;
  const layout = resolveUiShapeViewportLayout({
    width: component.width,
    height: component.height,
    naturalWidth: viewport.naturalWidth,
    naturalHeight: viewport.naturalHeight,
    scrollbars: viewport.scrollbars,
    state,
    theme: shape.theme,
  });
  const contentRect = {
    x: component.x + layout.contentRect.x,
    y: component.y + layout.contentRect.y,
    width: layout.contentRect.width,
    height: layout.contentRect.height,
  };
  const visibleRect = resolveUiShapeViewportAncestorClipRects(shape, component.id)
    .reduce((visible, clip) => {
      const x = Math.max(visible.x, clip.x);
      const y = Math.max(visible.y, clip.y);
      return {
        x,
        y,
        width: Math.max(0, Math.min(
          visible.x + visible.width,
          clip.x + clip.width,
        ) - x),
        height: Math.max(0, Math.min(
          visible.y + visible.height,
          clip.y + clip.height,
        ) - y),
      };
    }, contentRect);
  return {
    x: (layout.scrollX + visibleRect.x - contentRect.x) / layout.scaledWidth,
    y: (layout.scrollY + visibleRect.y - contentRect.y) / layout.scaledHeight,
    width: visibleRect.width / layout.scaledWidth,
    height: visibleRect.height / layout.scaledHeight,
  };
};

const overlapRatio = (left: SourceRect, right: SourceRect): number => {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  return intersection / Math.max(0.000001, Math.min(
    left.width * left.height,
    right.width * right.height,
  ));
};

const coverZoom = (component: UiShapeComponent, shape: UiShape): number => {
  const viewport = component.imageViewport!;
  const layout = resolveUiShapeViewportLayout({
    width: component.width,
    height: component.height,
    naturalWidth: viewport.naturalWidth,
    naturalHeight: viewport.naturalHeight,
    scrollbars: viewport.scrollbars,
    state: { zoom: 1 },
    theme: shape.theme,
  });
  return Math.max(
    layout.contentRect.width / Math.max(1, viewport.naturalWidth),
    layout.contentRect.height / Math.max(1, viewport.naturalHeight),
    UI_SHAPE_VIEWPORT_MIN_ZOOM,
  );
};

const zoomMultiplier = (
  preset: UiShapeViewportCompositionPreset,
  depth: number,
  state: 'a' | 'b',
): number => {
  const endpoint = state === 'b' ? 1.12 : 1;
  if (preset === 'cascade') return (1 + depth * 0.48) * endpoint;
  if (preset === 'survey') return 1.08 * endpoint;
  if (preset === 'echo') return (1 + depth * 0.3) * (state === 'b' ? 1.06 : 1);
  return (depth === 0 ? 1 : 1.42 + depth * 0.18) * endpoint;
};

const chooseFocus = ({
  points,
  component,
  shape,
  zoom,
  occupied,
  preset,
  depth,
  ordinal,
  endpoint,
}: {
  points: readonly FocusPoint[];
  component: UiShapeComponent;
  shape: UiShape;
  zoom: number;
  occupied: readonly SourceRect[];
  preset: UiShapeViewportCompositionPreset;
  depth: number;
  ordinal: number;
  endpoint: 'a' | 'b';
}): FocusPoint => {
  if (preset === 'echo') {
    const source = points[0] ?? fallbackFocusPoints[0]!;
    const sign = (depth + ordinal + (endpoint === 'b' ? 1 : 0)) % 2 === 0 ? -1 : 1;
    return {
      ...source,
      x: clampUiShapeViewportValue(source.x + sign * Math.min(0.18, 0.055 * (depth + 1))),
      y: clampUiShapeViewportValue(source.y - sign * Math.min(0.12, 0.035 * (depth + 1))),
    };
  }
  const overlapPenalty = preset === 'cascade' ? -0.45 : preset === 'survey' ? 1.35 : 0.9;
  const endpointOffset = endpoint === 'b' ? 1 : 0;
  return points.reduce((best, point, index) => {
    const rect = sourceRectForState(component, shape, stateForFocus({
      component,
      shape,
      focus: point,
      zoom,
    }));
    const overlap = occupied.reduce((total, candidate) => total + overlapRatio(rect, candidate), 0);
    const variety = ((index + ordinal + endpointOffset) % Math.max(1, points.length)) * 0.005;
    const score = point.weight - overlap * overlapPenalty + variety;
    return score > best.score ? { point, score } : best;
  }, { point: points[(ordinal + endpointOffset) % points.length]!, score: -Infinity }).point;
};

export const composeUiShapeViewportCrops = ({
  shape,
  rootId,
  assets,
  preset,
  resetManual = false,
}: {
  shape: UiShape;
  rootId: string;
  assets: readonly UiImageAsset[];
  preset: UiShapeViewportCompositionPreset;
  resetManual?: boolean;
}): UiShape => {
  const normalizedComponents = normalizeUiShapeViewportHierarchy(shape.components);
  const byId = componentMap(normalizedComponents);
  const root = byId.get(rootId);
  if (root?.kind !== 'image-viewport') return shape;
  const memberIds = new Set([rootId, ...getUiShapeViewportDescendantIds(normalizedComponents, rootId)]);
  const members = sortUiShapeComponentsForRendering(normalizedComponents)
    .filter((component) => memberIds.has(component.id) && component.kind === 'image-viewport');
  const occupiedA = new Map<string, SourceRect[]>();
  const occupiedB = new Map<string, SourceRect[]>();
  const nextById = new Map<string, UiShapeComponent>();
  members.forEach((component) => {
    const viewport = component.imageViewport;
    const asset = assets.find((candidate) => candidate.id === viewport?.assetId);
    if (!viewport || !asset) return;
    const existingA = normalizeUiShapeViewportState(component.canonicalState);
    const existingB = normalizeUiShapeViewportState({
      panX: component.animation?.rangeEnd ?? existingA.panX,
      panY: component.animation?.panYEnd ?? existingA.panY,
      zoom: component.animation?.zoomEnd ?? existingA.zoom,
    });
    if (!resetManual && viewport.autoCropA !== true) {
      occupiedA.set(asset.id, [
        ...(occupiedA.get(asset.id) ?? []),
        sourceRectForState(component, shape, existingA),
      ]);
    }
    if (!resetManual && viewport.autoCropB !== true) {
      occupiedB.set(asset.id, [
        ...(occupiedB.get(asset.id) ?? []),
        sourceRectForState(component, shape, existingB),
      ]);
    }
  });
  members.forEach((component, ordinal) => {
    const viewport = component.imageViewport;
    const asset = assets.find((candidate) => candidate.id === viewport?.assetId);
    if (!viewport || !asset) return;
    const depth = resolveDepth(component, byId);
    const points = focusPointsForAsset(asset);
    const parent = component.parentId ? nextById.get(component.parentId) : undefined;
    const parentA = parent ? normalizeUiShapeViewportState(parent.canonicalState) : undefined;
    const parentB = parent ? normalizeUiShapeViewportState({
      panX: parent.animation?.rangeEnd ?? parentA?.panX,
      panY: parent.animation?.panYEnd ?? parentA?.panY,
      zoom: parent.animation?.zoomEnd ?? parentA?.zoom,
    }) : undefined;
    const requestedZoomA = coverZoom(component, shape) * zoomMultiplier(preset, depth, 'a');
    const requestedZoomB = coverZoom(component, shape) * zoomMultiplier(preset, depth, 'b');
    const zoomA = preset === 'cascade' && parentA
      ? Math.max(requestedZoomA, parentA.zoom * 1.24)
      : requestedZoomA;
    const zoomB = preset === 'cascade' && parentB
      ? Math.max(requestedZoomB, parentB.zoom * 1.24)
      : requestedZoomB;
    const existingA = normalizeUiShapeViewportState(component.canonicalState);
    const existingB = normalizeUiShapeViewportState({
      panX: component.animation?.rangeEnd ?? existingA.panX,
      panY: component.animation?.panYEnd ?? existingA.panY,
      zoom: component.animation?.zoomEnd ?? existingA.zoom,
    });
    const shouldComposeA = resetManual || viewport.autoCropA === true;
    const shouldComposeB = resetManual || viewport.autoCropB === true;
    const focusA = chooseFocus({
      points,
      component,
      shape,
      zoom: zoomA,
      occupied: occupiedA.get(asset.id) ?? [],
      preset,
      depth,
      ordinal,
      endpoint: 'a',
    });
    const stateA = shouldComposeA
      ? stateForFocus({ component, shape, focus: focusA, zoom: zoomA })
      : existingA;
    const focusB = chooseFocus({
      points,
      component,
      shape,
      zoom: zoomB,
      occupied: occupiedB.get(asset.id) ?? [],
      preset,
      depth,
      ordinal,
      endpoint: 'b',
    });
    const stateB = shouldComposeB
      ? stateForFocus({ component, shape, focus: focusB, zoom: zoomB })
      : existingB;
    if (shouldComposeA) {
      occupiedA.set(asset.id, [
        ...(occupiedA.get(asset.id) ?? []),
        sourceRectForState(component, shape, stateA),
      ]);
    }
    if (shouldComposeB) {
      occupiedB.set(asset.id, [
        ...(occupiedB.get(asset.id) ?? []),
        sourceRectForState(component, shape, stateB),
      ]);
    }
    nextById.set(component.id, {
      ...component,
      imageViewport: {
        ...viewport,
        ...(component.id === rootId ? { compositionPreset: preset } : {}),
        autoCropA: shouldComposeA,
        autoCropB: shouldComposeB,
      },
      canonicalState: { ...component.canonicalState, ...stateA },
      animation: {
        ...(component.animation?.kind === 'viewport-pan-zoom'
          ? component.animation
          : {
              enabled: true,
              kind: 'viewport-pan-zoom' as const,
              speed: 0.18,
              direction: 1 as const,
              phaseOffset: 0,
            }),
        rangeStart: stateA.panX,
        rangeEnd: stateB.panX,
        panYStart: stateA.panY,
        panYEnd: stateB.panY,
        zoomStart: stateA.zoom,
        zoomEnd: stateB.zoom,
      },
    });
  });
  return {
    ...shape,
    components: normalizedComponents.map((component) => nextById.get(component.id) ?? component),
    updatedAt: Date.now(),
  };
};
