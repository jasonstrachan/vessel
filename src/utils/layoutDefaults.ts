import type {
  ExportContainerLayout,
  ExportLayoutAlign,
  ExportLayoutFlow,
  ExportLayoutJustify,
  Layer,
  LayerAlignmentSettings,
  LayerHorizontalAlignment,
  LayerVerticalAlignment,
  Project
} from '@/types';
import { normalizeAlignment } from '@/utils/alignment/alignFitResolver';

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
  horizontal: 'left',
  vertical: 'top',
  positioning: 'auto',
  offsetPx: { x: 0, y: 0 },
  offsetPercent: { x: 0, y: 0 }
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
  alignment: cloneLayerAlignment(layer.alignment)
});

export const normalizeLayers = <T extends Layer>(layers: T[]): T[] => layers.map(normalizeLayer);

export const normalizeProject = (project: Project): Project => ({
  ...project,
  exportLayout: cloneExportLayout(project.exportLayout),
  layers: normalizeLayers(project.layers)
});
