import type {
  UiImageAsset,
  UiShape,
  UiShapeImageViewport,
} from '@/types';
import {
  UI_SHAPE_VIEWPORT_MAX_IMAGE_BYTES,
  UI_SHAPE_VIEWPORT_MAX_IMAGE_PIXELS,
} from '@/utils/uiShapeViewport';

export const UI_IMAGE_ASSET_LIMIT = 128;

const maximumDataUrlLength = Math.ceil(UI_SHAPE_VIEWPORT_MAX_IMAGE_BYTES * 4 / 3) + 512;

const isValidImageDataUrl = (value: unknown): value is string => (
  typeof value === 'string'
  && value.startsWith('data:image/')
  && value.length <= maximumDataUrlLength
);

const finiteDimension = (value: unknown): number => (
  Math.max(1, Math.min(16_384, Math.round(Number(value) || 1)))
);

const normalizeDimensions = (
  naturalWidth: unknown,
  naturalHeight: unknown,
): { naturalWidth: number; naturalHeight: number } => {
  const width = finiteDimension(naturalWidth);
  const height = finiteDimension(naturalHeight);
  const scale = Math.min(1, Math.sqrt(UI_SHAPE_VIEWPORT_MAX_IMAGE_PIXELS / (width * height)));
  return {
    naturalWidth: Math.max(1, Math.floor(width * scale)),
    naturalHeight: Math.max(1, Math.floor(height * scale)),
  };
};

const normalizeFocusPoints = (
  value: unknown,
): UiImageAsset['focusPoints'] => {
  if (!Array.isArray(value)) return undefined;
  const points = value.slice(0, 12).flatMap<NonNullable<UiImageAsset['focusPoints']>[number]>(
    (entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const point = entry as { x?: unknown; y?: unknown; weight?: unknown };
      const x = Number(point.x);
      const y = Number(point.y);
      const weight = Number(point.weight);
      if (![x, y, weight].every(Number.isFinite)) return [];
      return [{
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        weight: Math.max(0, Math.min(1, weight)),
      }];
    },
  );
  return points.length > 0 ? points : undefined;
};

const hashImageDataUrl = (dataUrl: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const createAssetId = (
  dataUrl: string,
  assets: readonly UiImageAsset[],
): string => {
  const base = `ui-image-${hashImageDataUrl(dataUrl)}`;
  if (!assets.some((asset) => asset.id === base && asset.dataUrl !== dataUrl)) return base;
  let suffix = 2;
  while (assets.some((asset) => asset.id === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

export const normalizeUiImageAssets = (value: unknown): UiImageAsset[] => {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const dataUrls = new Set<string>();
  const assets: UiImageAsset[] = [];
  value.slice(0, UI_IMAGE_ASSET_LIMIT).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Partial<UiImageAsset>;
    if (!isValidImageDataUrl(candidate.dataUrl) || dataUrls.has(candidate.dataUrl)) return;
    const dimensions = normalizeDimensions(candidate.naturalWidth, candidate.naturalHeight);
    const requestedId = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 160) : '';
    let id = requestedId || createAssetId(candidate.dataUrl, assets);
    if (ids.has(id)) id = createAssetId(candidate.dataUrl, assets);
    const focusPoints = normalizeFocusPoints(candidate.focusPoints);
    const createdAt = Number.isFinite(Number(candidate.createdAt))
      ? Number(candidate.createdAt)
      : Date.now() + index;
    assets.push({
      id,
      name: typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim().slice(0, 160)
        : `Image ${index + 1}`,
      dataUrl: candidate.dataUrl,
      ...dimensions,
      ...(focusPoints ? { focusPoints } : {}),
      createdAt,
      updatedAt: Number.isFinite(Number(candidate.updatedAt))
        ? Number(candidate.updatedAt)
        : createdAt,
    });
    ids.add(id);
    dataUrls.add(candidate.dataUrl);
  });
  return assets;
};

export const upsertUiImageAsset = ({
  assets: inputAssets,
  dataUrl,
  name,
  naturalWidth,
  naturalHeight,
  focusPoints,
}: {
  assets: readonly UiImageAsset[] | undefined;
  dataUrl: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  focusPoints?: UiImageAsset['focusPoints'];
}): { asset: UiImageAsset; assets: UiImageAsset[] } => {
  if (!isValidImageDataUrl(dataUrl)) throw new Error('Image data is invalid or too large.');
  const assets = normalizeUiImageAssets(inputAssets);
  const existing = assets.find((asset) => asset.dataUrl === dataUrl);
  const normalizedFocusPoints = normalizeFocusPoints(focusPoints);
  if (existing) {
    if (existing.focusPoints || !normalizedFocusPoints) return { asset: existing, assets };
    const asset = { ...existing, focusPoints: normalizedFocusPoints, updatedAt: Date.now() };
    return {
      asset,
      assets: assets.map((candidate) => candidate.id === asset.id ? asset : candidate),
    };
  }
  if (assets.length >= UI_IMAGE_ASSET_LIMIT) {
    throw new Error(`This project already contains ${UI_IMAGE_ASSET_LIMIT} UI images.`);
  }
  const now = Date.now();
  const asset: UiImageAsset = {
    id: createAssetId(dataUrl, assets),
    name: name.trim().slice(0, 160) || `Image ${assets.length + 1}`,
    dataUrl,
    ...normalizeDimensions(naturalWidth, naturalHeight),
    ...(normalizedFocusPoints ? { focusPoints: normalizedFocusPoints } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { asset, assets: [...assets, asset] };
};

export const resolveUiShapeViewportImageDataUrl = (
  viewport: UiShapeImageViewport | undefined,
  assets: readonly UiImageAsset[] | undefined,
): string | undefined => {
  if (viewport?.assetId) {
    const asset = assets?.find((candidate) => candidate.id === viewport.assetId);
    if (asset) return asset.dataUrl;
  }
  return isValidImageDataUrl(viewport?.dataUrl) ? viewport.dataUrl : undefined;
};

export const normalizeUiShapeImageAssets = ({
  assets: inputAssets,
  shapes,
}: {
  assets: unknown;
  shapes: readonly UiShape[];
}): { assets: UiImageAsset[]; shapes: UiShape[] } => {
  let assets = normalizeUiImageAssets(inputAssets);
  const shapesWithAssets = shapes.map((shape) => ({
    ...shape,
    components: shape.components.map((component) => {
      if (component.kind !== 'image-viewport' || !component.imageViewport) return component;
      const viewport = component.imageViewport;
      let asset = viewport.assetId
        ? assets.find((candidate) => candidate.id === viewport.assetId)
        : undefined;
      if (!asset && isValidImageDataUrl(viewport.dataUrl)) {
        try {
          const result = upsertUiImageAsset({
            assets,
            dataUrl: viewport.dataUrl,
            name: `Image ${assets.length + 1}`,
            naturalWidth: viewport.naturalWidth,
            naturalHeight: viewport.naturalHeight,
          });
          assets = result.assets;
          asset = result.asset;
        } catch {
          // Preserve a valid legacy payload when the normalized project shelf is full.
        }
      }
      return {
        ...component,
        imageViewport: {
          ...(asset ? { assetId: asset.id } : {}),
          ...(!asset && isValidImageDataUrl(viewport.dataUrl)
            ? { dataUrl: viewport.dataUrl }
            : {}),
          naturalWidth: asset?.naturalWidth ?? viewport.naturalWidth,
          naturalHeight: asset?.naturalHeight ?? viewport.naturalHeight,
          scrollbars: viewport.scrollbars,
          ...(viewport.compositionPreset
            ? { compositionPreset: viewport.compositionPreset }
            : {}),
          ...(typeof viewport.autoCropA === 'boolean' ? { autoCropA: viewport.autoCropA } : {}),
          ...(typeof viewport.autoCropB === 'boolean' ? { autoCropB: viewport.autoCropB } : {}),
        },
      };
    }),
  }));
  return { assets, shapes: shapesWithAssets };
};
