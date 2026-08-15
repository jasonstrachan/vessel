import type {
  Layer,
  ReferenceAsset,
  ReferenceAssetCrop,
  ReferenceSamplingSource,
} from '@/types';

const MIN_CROP_SIZE = 0.01;
export const MIN_REFERENCE_ASSET_SCALE = 0.01;
export const MAX_REFERENCE_ASSET_SCALE = 64;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const normalizeCrop = (crop?: Partial<ReferenceAssetCrop> | null): ReferenceAssetCrop => {
  const x = clamp(crop?.x ?? 0, 0, 1 - MIN_CROP_SIZE);
  const y = clamp(crop?.y ?? 0, 0, 1 - MIN_CROP_SIZE);
  const width = clamp(crop?.width ?? 1, MIN_CROP_SIZE, 1 - x);
  const height = clamp(crop?.height ?? 1, MIN_CROP_SIZE, 1 - y);
  return { x, y, width, height };
};

export const normalizeReferenceAsset = (
  asset: ReferenceAsset,
  index = 0,
): ReferenceAsset | null => {
  if (!asset || typeof asset.dataUrl !== 'string' || !asset.dataUrl.startsWith('data:image/')) {
    return null;
  }

  const naturalWidth = Math.max(1, Math.round(Number(asset.naturalWidth) || 1));
  const naturalHeight = Math.max(1, Math.round(Number(asset.naturalHeight) || 1));
  const now = Date.now();
  const id = typeof asset.id === 'string' && asset.id.trim()
    ? asset.id.trim()
    : `reference-${now}-${index}`;
  const name = typeof asset.name === 'string' && asset.name.trim()
    ? asset.name.trim()
    : `Reference ${index + 1}`;

  return {
    id,
    name,
    dataUrl: asset.dataUrl,
    naturalWidth,
    naturalHeight,
    visible: asset.visible !== false,
    locked: asset.locked === true,
    opacity: clamp(asset.opacity ?? 1, 0, 1),
    x: Number.isFinite(asset.x) ? asset.x : 0,
    y: Number.isFinite(asset.y) ? asset.y : 0,
    scale: clamp(asset.scale ?? 1, MIN_REFERENCE_ASSET_SCALE, MAX_REFERENCE_ASSET_SCALE),
    crop: normalizeCrop(asset.crop),
    flipX: asset.flipX === true,
    flipY: asset.flipY === true,
    createdAt: Number.isFinite(asset.createdAt) ? asset.createdAt : now,
    updatedAt: Number.isFinite(asset.updatedAt) ? asset.updatedAt : now,
  };
};

export const normalizeReferenceAssets = (
  assets: ReferenceAsset[] | null | undefined,
): ReferenceAsset[] => {
  if (!Array.isArray(assets)) {
    return [];
  }

  const usedIds = new Set<string>();
  const normalized: ReferenceAsset[] = [];
  assets.forEach((asset, index) => {
    const next = normalizeReferenceAsset(asset, index);
    if (!next || usedIds.has(next.id)) {
      return;
    }
    usedIds.add(next.id);
    normalized.push(next);
  });
  return normalized;
};

export const normalizeReferenceSamplingSource = ({
  source,
  assets,
  layers,
  legacyReferenceLayerId,
}: {
  source?: ReferenceSamplingSource | null;
  assets: ReferenceAsset[];
  layers: Layer[];
  legacyReferenceLayerId?: string | null;
}): ReferenceSamplingSource => {
  if (source?.kind === 'asset' && assets.some((asset) => asset.id === source.assetId)) {
    return source;
  }
  if (source?.kind === 'layer' && layers.some((layer) => layer.id === source.layerId)) {
    return source;
  }
  if (source?.kind === 'canvas') {
    return source;
  }
  if (
    legacyReferenceLayerId
    && layers.some((layer) => layer.id === legacyReferenceLayerId)
  ) {
    return { kind: 'layer', layerId: legacyReferenceLayerId };
  }
  return { kind: 'canvas' };
};

export const getReferenceAssetDisplayBounds = (asset: ReferenceAsset) => ({
  x: asset.x,
  y: asset.y,
  width: asset.naturalWidth * asset.crop.width * asset.scale,
  height: asset.naturalHeight * asset.crop.height * asset.scale,
});

export const fitReferenceAssetToProject = (
  asset: ReferenceAsset,
  projectWidth: number,
  projectHeight: number,
): Pick<ReferenceAsset, 'x' | 'y' | 'scale'> => {
  const targetWidth = Math.max(1, projectWidth);
  const targetHeight = Math.max(1, projectHeight);
  const croppedWidth = Math.max(1, asset.naturalWidth * asset.crop.width);
  const croppedHeight = Math.max(1, asset.naturalHeight * asset.crop.height);
  const scale = clamp(
    Math.min(targetWidth / croppedWidth, targetHeight / croppedHeight),
    MIN_REFERENCE_ASSET_SCALE,
    MAX_REFERENCE_ASSET_SCALE,
  );
  const width = croppedWidth * scale;
  const height = croppedHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    scale,
  };
};

export const mapProjectPointToReferencePixel = (
  asset: ReferenceAsset,
  projectX: number,
  projectY: number,
): { x: number; y: number } | null => {
  const bounds = getReferenceAssetDisplayBounds(asset);
  if (
    projectX < bounds.x
    || projectY < bounds.y
    || projectX >= bounds.x + bounds.width
    || projectY >= bounds.y + bounds.height
  ) {
    return null;
  }

  let unitX = (projectX - bounds.x) / Math.max(bounds.width, 1e-6);
  let unitY = (projectY - bounds.y) / Math.max(bounds.height, 1e-6);
  if (asset.flipX) unitX = 1 - unitX;
  if (asset.flipY) unitY = 1 - unitY;

  const sourceX = (asset.crop.x + unitX * asset.crop.width) * asset.naturalWidth;
  const sourceY = (asset.crop.y + unitY * asset.crop.height) * asset.naturalHeight;
  return {
    x: Math.max(0, Math.min(asset.naturalWidth - 1, Math.floor(sourceX))),
    y: Math.max(0, Math.min(asset.naturalHeight - 1, Math.floor(sourceY))),
  };
};
