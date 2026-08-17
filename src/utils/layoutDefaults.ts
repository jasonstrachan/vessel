import type {
  ExportContainerLayout,
  ExportLayoutAlign,
  ExportLayoutFlow,
  ExportLayoutJustify,
  Layer,
  LayerGroup,
  LayerAlignmentSettings,
  LayerHorizontalAlignment,
  LayerVerticalAlignment,
  PaletteState,
  Project
} from '@/types';
import { normalizeAlignment } from '@/utils/alignment/alignFitResolver';
import { normalizeCanvasShape } from '@/utils/canvasShape';
import { normalizeCcCustomTilePatternPack } from '@/utils/colorCycle/ccCustomTilePattern';
import { DEFAULT_GRADIENT_ID, GRADIENT_PRESETS } from '@/utils/gradientPresets';
import { normalizeTxtShapes } from '@/utils/txtShape';
import {
  normalizeReferenceAssets,
  normalizeReferenceSamplingSource,
} from '@/referenceStudio/referenceAssets';

const createDefaultColorCycleGradients = (): NonNullable<PaletteState['colorCycleGradients']> => (
  GRADIENT_PRESETS.map((gradient) => ({
    id: gradient.id,
    name: gradient.name,
    stops: gradient.stops.map((stop) => ({ ...stop, opacity: 1 })),
  }))
);

const normalizeColorCycleStops = (
  stops: unknown,
): NonNullable<PaletteState['colorCycleGradients']>[number]['stops'] | null => {
  if (!Array.isArray(stops)) return null;
  const normalized = stops
    .flatMap((stop) => {
      if (!stop || typeof stop !== 'object') return [];
      const candidate = stop as { position?: unknown; color?: unknown; opacity?: unknown };
      const position = Number(candidate.position);
      const color = typeof candidate.color === 'string' ? candidate.color.trim() : '';
      const opacity = candidate.opacity === undefined ? 1 : Number(candidate.opacity);
      if (
        !Number.isFinite(position) ||
        position < 0 ||
        position > 1 ||
        !color ||
        !Number.isFinite(opacity)
      ) {
        return [];
      }
      return [{
        position,
        color,
        opacity: Math.max(0, Math.min(1, opacity)),
      }];
    })
    .sort((left, right) => left.position - right.position);
  return normalized.length >= 2 ? normalized : null;
};

const normalizeColorCycleGradients = (
  gradients: PaletteState['colorCycleGradients'],
): NonNullable<PaletteState['colorCycleGradients']> => {
  if (!Array.isArray(gradients)) {
    return createDefaultColorCycleGradients();
  }

  const seen = new Set<string>();
  const normalized = gradients.flatMap((gradient) => {
    if (!gradient || typeof gradient !== 'object') return [];
    const legacyGradient = gradient as typeof gradient & {
      isRuntimePalette?: boolean;
    };
    const id = typeof gradient.id === 'string' ? gradient.id.trim() : '';
    if (!id || seen.has(id)) return [];
    const stops = normalizeColorCycleStops(gradient.stops);
    if (!stops) return [];
    const runtimeStops = normalizeColorCycleStops(gradient.runtimeStops)
      ?? (legacyGradient.isRuntimePalette === true ? stops.map((stop) => ({ ...stop })) : null);
    seen.add(id);
    return [{
      id,
      ...(typeof gradient.name === 'string' && gradient.name.trim()
        ? { name: gradient.name.trim() }
        : {}),
      stops,
      ...(runtimeStops ? { runtimeStops } : {}),
    }];
  });

  return normalized.length > 0 ? normalized : createDefaultColorCycleGradients();
};

const normalizeHorizontalAxis = (value?: string): LayerHorizontalAlignment => {
  switch (value) {
    case 'left':
    case 'center':
    case 'right':
      return value;
    case 'start':
      return 'left';
    case 'end':
      return 'right';
    default:
      return 'center';
  }
};

const normalizeVerticalAxis = (value?: string): LayerVerticalAlignment => {
  switch (value) {
    case 'top':
    case 'center':
    case 'bottom':
      return value;
    case 'start':
      return 'top';
    case 'end':
      return 'bottom';
    default:
      return 'center';
  }
};

/**
 * Factory for layer alignment defaults so new layers start with predictable transforms.
 */
export const createDefaultLayerAlignment = (): LayerAlignmentSettings => ({
  fit: 'contain',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'auto',
  offsetPx: { x: 0, y: 0 },
  offsetPercent: { x: 50, y: 50 }
});

export const cloneLayerAlignment = (alignment?: LayerAlignmentSettings): LayerAlignmentSettings => {
  const base = alignment ?? createDefaultLayerAlignment();
  const normalized = normalizeAlignment(base);
  return {
    fit: normalized.fit,
    horizontal: normalizeHorizontalAxis(normalized.horizontal),
    vertical: normalizeVerticalAxis(normalized.vertical),
    positioning: normalized.positioning,
    offsetPx: base.offsetPx ? { ...base.offsetPx } : { x: 0, y: 0 },
    offsetPercent: normalized.positioning === 'auto'
      ? { ...(normalized.offsetPercent ?? { x: 0, y: 0 }) }
      : undefined
  };
};

const normalizeSizeMode = (value?: string): ExportContainerLayout['sizeMode'] => {
  if (value === 'fixed' || value === 'hug' || value === 'fill') {
    return value;
  }
  if (value === 'auto') {
    return 'fill';
  }
  return 'fill';
};

const normalizeFlow = (value?: string): ExportLayoutFlow => {
  switch (value) {
    case 'row':
    case 'row-reverse':
    case 'column':
    case 'column-reverse':
    case 'stack':
      return value;
    default:
      return 'stack';
  }
};

const normalizeAlign = (value?: string): ExportLayoutAlign => {
  switch (value) {
    case 'start':
    case 'center':
    case 'end':
    case 'stretch':
      return value;
    default:
      return 'start';
  }
};

const normalizeJustify = (value?: string): ExportLayoutJustify => {
  switch (value) {
    case 'start':
    case 'center':
    case 'end':
    case 'space-between':
    case 'space-around':
      return value;
    default:
      return 'start';
  }
};

const normalizeWrap = (value?: unknown): boolean => value === true;

const normalizeGap = (value?: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
};

export const createDefaultExportLayout = (): ExportContainerLayout => ({
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizeMode: 'fill',
  flow: 'stack',
  wrap: false,
  gap: 0,
  align: 'start',
  justify: 'start'
});

export const cloneExportLayout = (layout?: ExportContainerLayout): ExportContainerLayout => {
  const base = layout ?? createDefaultExportLayout();
  return {
    padding: { ...base.padding },
    sizeMode: normalizeSizeMode(base.sizeMode),
    width: base.width,
    height: base.height,
    flow: normalizeFlow(base.flow),
    wrap: normalizeWrap(base.wrap),
    gap: normalizeGap(base.gap),
    align: normalizeAlign(base.align),
    justify: normalizeJustify(base.justify)
  };
};

export const normalizeLayer = <T extends Layer>(layer: T): T => ({
  ...layer,
  groupId: layer.groupId && layer.groupId.trim().length > 0 ? layer.groupId : undefined,
  alignment: cloneLayerAlignment(layer.alignment)
});

export const normalizeLayers = <T extends Layer>(layers: T[]): T[] => layers.map(normalizeLayer);

export const dedupeLayerIds = <T extends Layer>(layers: T[]): T[] => {
  const seenIds = new Set<string>();

  return layers.map((layer, index) => {
    const baseId = typeof layer.id === 'string' && layer.id.trim().length > 0
      ? layer.id
      : `layer-${index + 1}`;

    let nextId = baseId;
    let suffix = 1;
    while (seenIds.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(nextId);

    if (nextId === layer.id) {
      return layer;
    }

    return {
      ...layer,
      id: nextId,
    };
  });
};

export const createDefaultPalette = (): PaletteState => ({
  foregroundColor: '#000000',
  backgroundColor: '#FFFFFF',
  activeSlot: 'foreground',
  colorCycleGradients: createDefaultColorCycleGradients(),
  activeColorCycleGradientId: DEFAULT_GRADIENT_ID,
});

export const normalizePalette = (palette?: PaletteState | null): PaletteState => {
  if (!palette) {
    return createDefaultPalette();
  }

  const foregroundColor =
    typeof palette.foregroundColor === 'string' && palette.foregroundColor.trim().length > 0
      ? palette.foregroundColor
      : '#000000';
  const backgroundColor =
    typeof palette.backgroundColor === 'string' && palette.backgroundColor.trim().length > 0
      ? palette.backgroundColor
      : '#FFFFFF';
  const activeSlot = palette.activeSlot === 'background' ? 'background' : 'foreground';
  const colorCycleGradients = normalizeColorCycleGradients(palette.colorCycleGradients);
  const activeColorCycleGradientId = colorCycleGradients.some(
    (gradient) => gradient.id === palette.activeColorCycleGradientId,
  )
    ? palette.activeColorCycleGradientId
    : colorCycleGradients[0]?.id;

  return {
    foregroundColor,
    backgroundColor,
    activeSlot,
    colorCycleGradients,
    ...(activeColorCycleGradientId ? { activeColorCycleGradientId } : {}),
  };
};

export const normalizeProject = (project: Project): Project => {
  const customBrushes = Array.isArray(project.customBrushes) ? project.customBrushes : [];
  const ccCustomTilePatterns = Array.isArray(project.ccCustomTilePatterns)
    ? project.ccCustomTilePatterns
    : [];
  const validTileIds = new Set(ccCustomTilePatterns.map((pattern) => pattern.id));
  const ccCustomTilePatternPacks = Array.isArray(project.ccCustomTilePatternPacks)
    ? project.ccCustomTilePatternPacks
        .map((pack) => normalizeCcCustomTilePatternPack(pack, validTileIds))
        .filter((pack): pack is NonNullable<Project['ccCustomTilePatternPacks']>[number] => Boolean(pack))
    : [];
  const defaultCustomBrushId =
    customBrushes.find((brush) => brush.id === project.defaultCustomBrushId) !== undefined
      ? project.defaultCustomBrushId ?? null
      : null;

  const normalizedLayers = dedupeLayerIds(normalizeLayers(project.layers));
  const usedGroupIds = new Set(
    normalizedLayers
      .map((layer) => layer.groupId)
      .filter((groupId): groupId is string => typeof groupId === 'string')
  );
  const rawGroups = Array.isArray(project.layerGroups) ? project.layerGroups : [];
  const dedupedGroupIds = new Set<string>();
  const normalizedLayerGroups: LayerGroup[] = [];
  rawGroups.forEach((group, index) => {
    if (!group?.id || dedupedGroupIds.has(group.id) || !usedGroupIds.has(group.id)) {
      return;
    }
    dedupedGroupIds.add(group.id);
    const name = group.name?.trim();
    normalizedLayerGroups.push({
      id: group.id,
      name: name && name.length > 0 ? name : `Group ${index + 1}`,
    });
  });
  const validGroupIds = new Set(normalizedLayerGroups.map((group) => group.id));
  const layersWithValidGroups = normalizedLayers.map((layer) => (
    layer.groupId && !validGroupIds.has(layer.groupId)
      ? { ...layer, groupId: undefined }
      : layer
  ));
  const referenceAssets = normalizeReferenceAssets(project.referenceAssets);
  const referenceSamplingSource = normalizeReferenceSamplingSource({
    source: project.referenceSamplingSource,
    assets: referenceAssets,
    layers: layersWithValidGroups,
    legacyReferenceLayerId: project.referenceLayerId,
  });

  return {
    ...project,
    customBrushes,
    ccCustomTilePatterns,
    ccCustomTilePatternPacks,
    defaultCustomBrushId,
    exportLayout: cloneExportLayout(project.exportLayout),
    layers: layersWithValidGroups,
    layerGroups: normalizedLayerGroups,
    palette: normalizePalette(project.palette),
    canvasShape: normalizeCanvasShape(project.canvasShape, project.width, project.height),
    txtShapes: normalizeTxtShapes(
      project.txtShapes,
      project.width,
      project.height,
      layersWithValidGroups,
    ),
    referenceAssets,
    referenceSamplingSource,
  };
};
