import type {
  ExportContainerLayout,
  Layer,
  LayerAlignmentSettings,
  LayerHorizontalAlignment,
  LayerVerticalAlignment,
  Project
} from '@/types';

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
  fit: 'none',
  horizontal: 'left',
  vertical: 'top',
  positioning: 'auto',
  offsetPx: { x: 0, y: 0 },
  offsetPercent: { x: 0, y: 0 }
});

export const cloneLayerAlignment = (alignment?: LayerAlignmentSettings): LayerAlignmentSettings => {
  const base = alignment ?? createDefaultLayerAlignment();
  return {
    fit: base.fit,
    horizontal: normalizeHorizontalAxis(base.horizontal),
    vertical: normalizeVerticalAxis(base.vertical),
    positioning: base.positioning ?? 'anchor',
    offsetPx: base.offsetPx ? { ...base.offsetPx } : { x: 0, y: 0 },
    offsetPercent: base.positioning === 'auto' || base.fit === 'percent'
      ? { ...(base.offsetPercent ?? { x: 0, y: 0 }) }
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

export const createDefaultExportLayout = (): ExportContainerLayout => ({
  flow: 'row',
  justify: 'start',
  align: 'start',
  wrap: false,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizeMode: 'fill'
});

export const cloneExportLayout = (layout?: ExportContainerLayout): ExportContainerLayout => {
  const base = layout ?? createDefaultExportLayout();
  return {
    flow: base.flow,
    justify: base.justify,
    align: base.align,
    wrap: base.wrap,
    gap: base.gap,
    padding: { ...base.padding },
    sizeMode: normalizeSizeMode(base.sizeMode),
    width: base.width,
    height: base.height
  };
};

export const normalizeLayer = <T extends Layer>(layer: T): T => ({
  ...layer,
  alignment: cloneLayerAlignment(layer.alignment)
});

export const normalizeLayers = <T extends Layer>(layers: T[]): T[] => layers.map(normalizeLayer);

export const normalizeProject = (project: Project): Project => ({
  ...project,
  exportLayout: cloneExportLayout(project.exportLayout),
  layers: normalizeLayers(project.layers)
});
