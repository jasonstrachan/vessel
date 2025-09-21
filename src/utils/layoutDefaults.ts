import type {
  ExportContainerLayout,
  Layer,
  LayerAlignmentSettings,
  Project
} from '@/types';

/**
 * Factory for layer alignment defaults so new layers start with predictable transforms.
 */
export const createDefaultLayerAlignment = (): LayerAlignmentSettings => ({
  fit: 'contain',
  horizontal: 'center',
  vertical: 'center',
  offsetPx: { x: 0, y: 0 }
});

export const cloneLayerAlignment = (alignment?: LayerAlignmentSettings): LayerAlignmentSettings => {
  const base = alignment ?? createDefaultLayerAlignment();
  return {
    fit: base.fit,
    horizontal: base.horizontal,
    vertical: base.vertical,
    offsetPx: base.offsetPx ? { ...base.offsetPx } : { x: 0, y: 0 }
  };
};

export const createDefaultExportLayout = (): ExportContainerLayout => ({
  flow: 'row',
  justify: 'start',
  align: 'start',
  wrap: false,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizeMode: 'hug'
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
    sizeMode: base.sizeMode,
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
