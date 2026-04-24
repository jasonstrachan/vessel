import type { Layer, LayerGroup } from '@/types';

export const normalizeLayerGroupName = (
  name: string | undefined,
  fallbackIndex: number
): string => {
  const trimmed = name?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : `Group ${fallbackIndex + 1}`;
};

export const sanitizeLayerGroups = (
  layers: Pick<Layer, 'groupId'>[],
  layerGroups: LayerGroup[]
): LayerGroup[] => {
  const usedGroupIds = new Set(
    layers
      .map((layer) => layer.groupId)
      .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0)
  );
  const deduped = new Set<string>();
  const sanitized: LayerGroup[] = [];

  layerGroups.forEach((group, index) => {
    if (!group?.id || !usedGroupIds.has(group.id) || deduped.has(group.id)) {
      return;
    }
    deduped.add(group.id);
    sanitized.push({
      id: group.id,
      name: normalizeLayerGroupName(group.name, index),
    });
  });

  return sanitized;
};

export const sanitizeHiddenLayerGroupIds = (
  hiddenGroupIds: string[],
  layerGroups: LayerGroup[]
): string[] => {
  if (hiddenGroupIds.length === 0) {
    return hiddenGroupIds;
  }
  const validGroupIds = new Set(layerGroups.map((group) => group.id));
  return hiddenGroupIds.filter((groupId) => validGroupIds.has(groupId));
};

export const generateLayerGroupName = (existingGroups: LayerGroup[]): string => {
  const usedNames = new Set(existingGroups.map((group) => group.name));
  let suffix = existingGroups.length + 1;
  while (suffix < 1000) {
    const candidate = `Group ${suffix}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
  return `Group ${Date.now()}`;
};
