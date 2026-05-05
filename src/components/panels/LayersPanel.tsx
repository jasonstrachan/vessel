'use client';

import { getAppStoreState } from '@/stores/appStoreAccess';
import React from 'react';
import { ChevronRight, Eye, EyeOff, Plus } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import {
  selectLayers,
  selectActiveLayerId,
  selectLayerGroups,
  selectSelectedLayerIds,
} from '@/stores/selectors/layersSelectors';
import { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { LayerColorSwatches } from '@/components/MinimalLayerList';
import ProgressSlider from '@/components/ui/ProgressSlider';

const LAYER_GROUPS_COLLAPSED_STORAGE_KEY = 'vessel-layer-groups-collapsed';
const GROUP_DRAG_PAYLOAD_PREFIX = 'group:';

const encodeGroupDragPayload = (groupId: string): string => `${GROUP_DRAG_PAYLOAD_PREFIX}${groupId}`;

const decodeGroupDragPayload = (payload: string): string | null => (
  payload.startsWith(GROUP_DRAG_PAYLOAD_PREFIX)
    ? payload.slice(GROUP_DRAG_PAYLOAD_PREFIX.length)
    : null
);

const formatLayerPanelDebugToken = (layerId: string): string => {
  const timestampMatch = layerId.match(/^layer-(\d+)/);
  if (timestampMatch) {
    return timestampMatch[1].slice(-6);
  }
  return layerId.slice(-6);
};

const loadCollapsedLayerGroups = (): Set<string> => {
  if (typeof window === 'undefined') {
    return new Set();
  }

  try {
    const serialized = window.localStorage.getItem(LAYER_GROUPS_COLLAPSED_STORAGE_KEY);
    if (!serialized) {
      return new Set();
    }
    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
};

const persistCollapsedLayerGroups = (groupIds: Set<string>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      LAYER_GROUPS_COLLAPSED_STORAGE_KEY,
      JSON.stringify(Array.from(groupIds)),
    );
  } catch {
    // Ignore storage errors and preserve in-memory state.
  }
};

const LayersPanel: React.FC = () => {
  const [layerMenuState, setLayerMenuState] = React.useState<{
    layerId: string;
    vertical: 'above' | 'below';
    horizontal: 'left' | 'right';
  } | null>(null);
  const [draggedLayerId, setDraggedLayerId] = React.useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = React.useState<string | null>(null);
  const opacityPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const [dragOverBottom, setDragOverBottom] = React.useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = React.useState<Set<string>>(
    loadCollapsedLayerGroups,
  );

  const layers = useAppStore(selectLayers);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const selectedLayerIds = useAppStore(selectSelectedLayerIds);
  const layerGroups = useAppStore(selectLayerGroups);
  const hiddenLayerGroupIds = useAppStore((state) => state.hiddenLayerGroupIds);
  const addLayer = useAppStore((state) => state.addLayer);
  const duplicateLayers = useAppStore((state) => state.duplicateLayers);
  const removeLayer = useAppStore((state) => state.removeLayer);
  const removeLayers = useAppStore((state) => state.removeLayers);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const setActiveLayer = useAppStore((state) => state.setActiveLayer);
  const reorderLayerBlock = useAppStore((state) => state.reorderLayerBlock);
  const setSelectedLayerIds = useAppStore((state) => state.setSelectedLayerIds);
  const selectLayerAlpha = useAppStore((state) => state.selectLayerAlpha);
  const initColorCycleForLayer = useAppStore((state) => state.initColorCycleForLayer);
  const setReferenceLayer = useAppStore((state) => state.setReferenceLayer);
  const referenceLayerId = useAppStore((state) => state.referenceLayerId);
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const mergeLayers = useAppStore((state) => state.mergeLayers);
  const createLayerGroupFromSelection = useAppStore((state) => state.createLayerGroupFromSelection);
  const removeLayerGroup = useAppStore((state) => state.removeLayerGroup);
  const setLayerGroupVisibility = useAppStore((state) => state.setLayerGroupVisibility);
  const setLayersVisibility = useAppStore((state) => state.setLayersVisibility);
  const sequentialRecord = useAppStore((state) => state.sequentialRecord);
  const layerGroupsById = React.useMemo(
    () => new Map(layerGroups.map((group) => [group.id, group] as const)),
    [layerGroups]
  );
  const layerGroupIds = React.useMemo(
    () => new Set(layerGroups.map((group) => group.id)),
    [layerGroups],
  );
  const visibleLayers = React.useMemo(() => layers.slice().reverse(), [layers]);
  const hiddenLayerGroupIdSet = React.useMemo(
    () => new Set(hiddenLayerGroupIds),
    [hiddenLayerGroupIds],
  );
  const layerGroupVisibilityById = React.useMemo(() => {
    const visibilityByGroupId = new Map<string, boolean>();
    layerGroups.forEach((group) => {
      visibilityByGroupId.set(group.id, !hiddenLayerGroupIdSet.has(group.id));
    });
    return visibilityByGroupId;
  }, [hiddenLayerGroupIdSet, layerGroups]);
  const layerIdsByGroupId = React.useMemo(() => {
    const idsByGroupId = new Map<string, string[]>();
    layers.forEach((layer) => {
      const groupId = layer.groupId;
      if (!groupId || !layerGroupsById.has(groupId)) {
        return;
      }
      const existing = idsByGroupId.get(groupId);
      if (existing) {
        existing.push(layer.id);
        return;
      }
      idsByGroupId.set(groupId, [layer.id]);
    });
    return idsByGroupId;
  }, [layerGroupsById, layers]);

  const resolveActionLayerIds = React.useCallback((layerId: string) => {
    if (!selectedLayerIds.includes(layerId) || selectedLayerIds.length <= 1) {
      return [layerId];
    }

    const selectedIdSet = new Set(selectedLayerIds);
    return layers
      .filter((layer) => selectedIdSet.has(layer.id))
      .map((layer) => layer.id);
  }, [layers, selectedLayerIds]);

  const updateResolvedLayers = React.useCallback((layerId: string, updates: Partial<Layer>) => {
    const targetLayerIds = resolveActionLayerIds(layerId);
    targetLayerIds.forEach((targetLayerId) => {
      updateLayer(targetLayerId, updates);
    });
  }, [resolveActionLayerIds, updateLayer]);

  React.useEffect(() => {
    setCollapsedGroupIds((previous) => {
      const next = new Set(Array.from(previous).filter((groupId) => layerGroupIds.has(groupId)));
      if (next.size === previous.size) {
        return previous;
      }
      persistCollapsedLayerGroups(next);
      return next;
    });
  }, [layerGroupIds]);

  const handleToggleGroupCollapsed = React.useCallback((groupId: string) => {
    setCollapsedGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      persistCollapsedLayerGroups(next);
      return next;
    });
  }, []);
  const handleExpandGroup = React.useCallback((groupId: string) => {
    setCollapsedGroupIds((previous) => {
      if (!previous.has(groupId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(groupId);
      persistCollapsedLayerGroups(next);
      return next;
    });
  }, []);

  const insertionGroupId = React.useMemo(() => {
    if (!activeLayerId) {
      return undefined;
    }
    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    if (!activeLayer?.groupId) {
      return undefined;
    }
    if (!layerGroupsById.has(activeLayer.groupId)) {
      return undefined;
    }
    const groupLayerIds = layerIdsByGroupId.get(activeLayer.groupId) ?? [];
    const isEntireGroupSelected =
      groupLayerIds.length > 0 && groupLayerIds.every((id) => selectedLayerIds.includes(id));
    if (isEntireGroupSelected) {
      return undefined;
    }
    return activeLayer.groupId;
  }, [activeLayerId, layerGroupsById, layerIdsByGroupId, layers, selectedLayerIds]);

  const handleAddRegularLayer = React.useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      groupId: insertionGroupId,
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId && !activeLayerId) {
      setActiveLayer(newLayerId);
      setSelectedLayerIds([newLayerId]);
    }
  }, [activeLayerId, addLayer, insertionGroupId, layers.length, setActiveLayer, setSelectedLayerIds]);

  const handleAddColorCycleLayer = React.useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const store = getAppStoreState();
    const currentGradient = store.tools.brushSettings.colorCycleGradient || [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `CC Layer ${layers.filter(layer => layer.layerType === 'color-cycle').length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      groupId: insertionGroupId,
      colorCycleData: {
        gradient: currentGradient,
        isAnimating: true,
        flowMode: store.tools.brushSettings.colorCycleFlowMode ?? 'forward'
      }
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId) {
      if (store.project) {
        initColorCycleForLayer(newLayerId, store.project.width, store.project.height);
      }

      const currentPresetId = currentBrushPreset?.id ?? null;
      const isCurrentCcPreset =
        currentPresetId === 'color-cycle-gradient' ||
        currentPresetId === 'color-cycle-stroke' ||
        currentPresetId === 'color-cycle-shape' ||
        currentPresetId === 'color-cycle-triangle';
      const targetPresetId = isCurrentCcPreset ? currentPresetId : 'color-cycle-gradient';
      const targetPreset =
        brushPresets.find((preset) => preset.id === targetPresetId) ??
        brushPresets.find((preset) => preset.id === 'color-cycle-gradient') ??
        brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
      if (targetPreset) {
        setBrushPreset(targetPreset, true);
      }

      if (!activeLayerId) {
        setActiveLayer(newLayerId);
        setSelectedLayerIds([newLayerId]);
      }
    }
  }, [
    activeLayerId,
    addLayer,
    brushPresets,
    currentBrushPreset,
    initColorCycleForLayer,
    insertionGroupId,
    layers,
    setActiveLayer,
    setBrushPreset,
    setSelectedLayerIds,
  ]);

  const handleAddSequentialLayer = React.useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const frameCount = Math.max(1, Math.round(sequentialRecord.frameCount || 24));
    const fps = Math.max(1, Math.round(sequentialRecord.fps || 24));
    const durationMs = Math.round((frameCount * 1000) / fps);

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Sequence ${layers.filter((layer) => layer.layerType === 'sequential').length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      groupId: insertionGroupId,
      sequentialData: {
        frameCount,
        fps,
        durationMs,
        events: [],
      },
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId && !activeLayerId) {
      setActiveLayer(newLayerId);
      setSelectedLayerIds([newLayerId]);
    }
  }, [activeLayerId, addLayer, insertionGroupId, layers, sequentialRecord, setActiveLayer, setSelectedLayerIds]);

  const handleDeleteLayer = React.useCallback((layerId: string) => {
    const targetLayerIds = resolveActionLayerIds(layerId);
    if (layers.length > targetLayerIds.length) {
      if (targetLayerIds.length === 1) {
        removeLayer(layerId);
        return;
      }
      removeLayers(targetLayerIds);
    }
  }, [layers.length, removeLayer, removeLayers, resolveActionLayerIds]);

  const handleDuplicateLayer = React.useCallback((layerId: string) => {
    const duplicatedIds = duplicateLayers(resolveActionLayerIds(layerId));
    return duplicatedIds;
  }, [duplicateLayers, resolveActionLayerIds]);

  const handleToggleVisibility = React.useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      setLayersVisibility(resolveActionLayerIds(layerId), !layer.visible);
    }
  }, [layers, resolveActionLayerIds, setLayersVisibility]);

  const handleToggleLock = React.useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateResolvedLayers(layerId, { locked: !layer.locked });
    }
  }, [layers, updateResolvedLayers]);

  const handleOpacityChange = React.useCallback((layerId: string, opacityPercent: number) => {
    updateResolvedLayers(layerId, { opacity: opacityPercent / 100 });
  }, [updateResolvedLayers]);

  const handleToggleTransparencyLock = React.useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateResolvedLayers(layerId, { transparencyLocked: layer.transparencyLocked !== true });
    }
  }, [layers, updateResolvedLayers]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        layerMenuState &&
        opacityPopoverRef.current &&
        !opacityPopoverRef.current.contains(event.target as Node)
      ) {
        setLayerMenuState(null);
      }
    };

    if (layerMenuState) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }

    return undefined;
  }, [layerMenuState]);

  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>, layerId: string) => {
    setDraggedLayerId(layerId);
    setDraggedGroupId(null);
    event.dataTransfer.setData('text/plain', layerId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleGroupDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>, groupId: string) => {
    setDraggedGroupId(groupId);
    setDraggedLayerId(null);
    event.dataTransfer.setData('text/plain', encodeGroupDragPayload(groupId));
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverBottom) {
      setDragOverBottom(false);
    }
  }, [dragOverBottom]);

  const handleGroupDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>, groupId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const transferData = event.dataTransfer.getData('text/plain');
    if (!transferData) {
      return;
    }

    const sourceGroupId = decodeGroupDragPayload(transferData);
    if (sourceGroupId) {
      if (!sourceGroupId || sourceGroupId === groupId) {
        setDraggedGroupId(null);
        return;
      }

      const sourceLayerIds = layers
        .filter((layer) => layer.groupId === sourceGroupId)
        .map((layer) => layer.id);
      if (sourceLayerIds.length === 0) {
        setDraggedGroupId(null);
        return;
      }

      const targetIndices = layers
        .map((layer, index) => ({ layer, index }))
        .filter(({ layer }) => layer.groupId === groupId)
        .map(({ index }) => index);
      if (targetIndices.length === 0) {
        setDraggedGroupId(null);
        return;
      }

      // In the panel (top -> bottom), dropping on a group header inserts the dragged group above it.
      const targetTopIndex = Math.max(...targetIndices);
      reorderLayerBlock(sourceLayerIds, targetTopIndex + 1);
      setDraggedGroupId(null);
      setDragOverBottom(false);
      return;
    }

    const draggedId = transferData;

    const sourceLayerIds = resolveActionLayerIds(draggedId);
    const draggedLayer = layers.find((layer) => layer.id === draggedId);
    if (!draggedLayer || sourceLayerIds.length === 0) {
      return;
    }

    const groupMembersInPanelOrder = layers
      .slice()
      .reverse()
      .filter((layer) => layer.groupId === groupId && layer.id !== draggedId);
    const targetLayerId = groupMembersInPanelOrder[0]?.id;

    sourceLayerIds.forEach((sourceLayerId) => {
      updateLayer(sourceLayerId, { groupId });
    });

    if (targetLayerId && targetLayerId !== draggedId) {
      const originalTargetIndex = layers.findIndex((layer) => layer.id === targetLayerId);
      if (originalTargetIndex !== -1) {
        reorderLayerBlock(sourceLayerIds, originalTargetIndex);
      }
    }

    setDraggedLayerId(null);
    setDraggedGroupId(null);
    setDragOverBottom(false);
  }, [layers, reorderLayerBlock, resolveActionLayerIds, updateLayer]);

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>, targetLayerId: string) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');

    if (draggedId) {
      const sourceLayerIds = resolveActionLayerIds(draggedId);
      if (sourceLayerIds.includes(targetLayerId)) {
        setDraggedLayerId(null);
        setDraggedGroupId(null);
        setDragOverBottom(false);
        return;
      }

      const targetLayer = layers.find((layer) => layer.id === targetLayerId) ?? null;
      if (targetLayer) {
        const nextGroupId = targetLayer.groupId && layerGroupsById.has(targetLayer.groupId)
          ? targetLayer.groupId
          : undefined;
        const draggedLayer = layers.find((layer) => layer.id === draggedId) ?? null;
        if (draggedLayer && draggedLayer.groupId !== nextGroupId) {
          sourceLayerIds.forEach((sourceLayerId) => {
            updateLayer(sourceLayerId, { groupId: nextGroupId });
          });
        }
      }

      const targetIndex = layers.findIndex((layer) => layer.id === targetLayerId);

      if (targetIndex !== -1) {
        reorderLayerBlock(sourceLayerIds, targetIndex);
      }
    }

    setDraggedLayerId(null);
    setDraggedGroupId(null);
    setDragOverBottom(false);
  }, [layerGroupsById, layers, reorderLayerBlock, resolveActionLayerIds, updateLayer]);

  const handleDragOverBottom = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!dragOverBottom) {
      setDragOverBottom(true);
    }
    if (draggedLayerId) {
      setDraggedLayerId(null);
    }
    if (draggedGroupId) {
      setDraggedGroupId(null);
    }
  }, [dragOverBottom, draggedGroupId, draggedLayerId]);

  const handleDropBottom = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    if (draggedId) {
      if (decodeGroupDragPayload(draggedId)) {
        setDragOverBottom(false);
        setDraggedGroupId(null);
        return;
      }
      const sourceLayerIds = resolveActionLayerIds(draggedId);
      if (sourceLayerIds.length > 0) {
        reorderLayerBlock(sourceLayerIds, 0);
      }
    }
    setDragOverBottom(false);
    setDraggedLayerId(null);
    setDraggedGroupId(null);
  }, [reorderLayerBlock, resolveActionLayerIds]);

  const handleDragEnd = React.useCallback(() => {
    setDraggedLayerId(null);
    setDraggedGroupId(null);
    setDragOverBottom(false);
  }, []);

  const handleRowClick = React.useCallback((event: React.MouseEvent, layerId: string) => {
    // Shift+click adds the layer to the current selection without toggling others.
    if (event.shiftKey) {
      const nextSelection = selectedLayerIds.includes(layerId)
        ? selectedLayerIds
        : [...selectedLayerIds, layerId];
      setSelectedLayerIds(nextSelection);
      setActiveLayer(layerId, { preserveSelection: true });
      setLayerMenuState(null);
      return;
    }

    // Plain click selects only this layer.
    setActiveLayer(layerId);
    setSelectedLayerIds([layerId]);
    setLayerMenuState(null);
  }, [selectedLayerIds, setActiveLayer, setLayerMenuState, setSelectedLayerIds]);

  const generateGradientCSS = React.useCallback((gradient?: Array<{ position: number; color: string }>) => {
    if (!gradient || gradient.length === 0) {
      return 'linear-gradient(90deg, #888 0%, #888 100%)';
    }

    const stops = gradient
      .map(stop => `${stop.color} ${stop.position * 100}%`)
      .join(', ');

    return `linear-gradient(90deg, ${stops})`;
  }, []);

  const estimateLayerMenuPosition = React.useCallback((anchor: HTMLDivElement) => {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const POPOVER_WIDTH = 208; // tailwind w-52 ≈ 13rem
    const POPOVER_HEIGHT = 220; // estimated height of menu content
    const OFFSET = 8;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const vertical = spaceBelow >= POPOVER_HEIGHT + OFFSET || spaceBelow >= spaceAbove
      ? 'below'
      : 'above';

    const wouldOverflowRight = rect.left + POPOVER_WIDTH + OFFSET > viewportWidth;
    const horizontal = wouldOverflowRight && rect.right - POPOVER_WIDTH - OFFSET >= 0 ? 'right' : 'left';

    return { vertical, horizontal } as const;
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#1A1A1A]">
      <div className="flex-shrink-0 flex border-b border-[#404040]">
        <button
          onClick={handleAddRegularLayer}
          className="flex-1 flex items-center justify-center gap-1 py-2 border-r border-[#424242] text-[11px] text-[#D9D9D9] hover:bg-[#353535] transition-colors"
          title="Add Regular Layer"
        >
          <Plus size={14} className="text-[#D9D9D9]" />
          <span>Layer</span>
        </button>
        <button
          onClick={handleAddSequentialLayer}
          className="flex-1 flex items-center justify-center gap-1 py-2 border-r border-[#424242] text-[11px] text-[#D9D9D9] hover:bg-[#353535] transition-colors"
          title="Add Sequence Layer"
        >
          <Plus size={14} className="text-[#D9D9D9]" />
          <span>Sequence</span>
        </button>
        <button
          onClick={handleAddColorCycleLayer}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-[#D9D9D9] hover:bg-[#353535] transition-colors"
          title="Add CC Layer"
        >
          <Plus size={14} className="text-[#D9D9D9]" />
          <span>CC</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {(() => {
          const renderedGroupIds = new Set<string>();
          return visibleLayers.map((layer, index) => {
          const isActive = activeLayerId === layer.id;
          const isSelected = selectedLayerIds.includes(layer.id);
          const isHighlighted = isActive || isSelected;
          const isColorCycle = layer.layerType === 'color-cycle';
          const isSequential = layer.layerType === 'sequential';
          const gradient = layer.colorCycleData?.gradient || layer.colorCycleData?.recolorSettings?.gradient;
          const isMenuOpen = layerMenuState?.layerId === layer.id;
          const isReferenceLayer = referenceLayerId === layer.id;
          const sliderPercent = Math.round(layer.opacity * 100);
          const groupId = layer.groupId && layerGroupsById.has(layer.groupId) ? layer.groupId : null;
          const shouldRenderGroupHeader = Boolean(groupId && !renderedGroupIds.has(groupId));
          if (groupId) {
            renderedGroupIds.add(groupId);
          }
          const groupName = groupId ? (layerGroupsById.get(groupId)?.name ?? 'Group') : null;
          const groupAllVisible = Boolean(groupId && layerGroupVisibilityById.get(groupId));
          const isGroupCollapsed = Boolean(groupId && collapsedGroupIds.has(groupId));
          const groupLayerIds = groupId ? (layerIdsByGroupId.get(groupId) ?? []) : [];
          const isGroupSelected = groupLayerIds.length > 0 && groupLayerIds.every((id) => selectedLayerIds.includes(id));
          const groupVisibleIconClass = groupAllVisible
            ? (isGroupSelected ? 'text-[#1A1A1A]' : 'text-[#D9D9D9]')
            : (isGroupSelected ? 'text-[#5A5A5A]' : 'text-[#666]');
          const rowVisualClass = isHighlighted
            ? 'bg-[#E8F2FF] text-[#0F172A] border-l-4 border-[#0EA5E9] shadow-[0_0_0_1px_rgba(14,165,233,0.25),inset_4px_0_0_#0EA5E922]'
            : 'hover:bg-[#383838]/20 text-[#D9D9D9] border-l-4 border-transparent';
          const visibleIconClass = layer.visible
            ? (isHighlighted ? 'text-[#1A1A1A]' : 'text-[#D9D9D9]')
            : (isHighlighted ? 'text-[#5A5A5A]' : 'text-[#666]');
          const deleteButtonColor = isHighlighted
            ? 'text-[#5A5A5A]'
            : 'text-[#666]';
          const hoverDeleteColor = isHighlighted
            ? 'hover:text-red-600'
            : 'hover:text-red-500';
          const layerDebugToken = formatLayerPanelDebugToken(layer.id);
          const layerTitle = `${layer.name}\nLayer ID: ${layer.id}`;
          const debugTagClass = 'inline-flex h-4 w-10 shrink-0 items-center justify-center rounded border text-[8px] font-semibold leading-none';
          const labelClass = `${debugTagClass} ${
            isHighlighted
              ? 'bg-[#D7E7F7] text-[#23425C] border-[#9BC7E8]'
              : 'bg-[#2E2E34] text-[#AEB6C2] border-[#4B4B55]'
          }`;
          const layerKindLabel = isColorCycle ? 'CC' : isSequential ? 'Seq' : 'Reg';
          const layerKindTitle = isColorCycle
            ? `Color-cycle ${layer.colorCycleData?.mode === 'recolor' ? 'recolor' : 'brush'} layer${layer.colorCycleData?.deferredRuntimeRestore ? ' (cold runtime)' : ''}`
            : isSequential
              ? `Sequence layer, ${Math.max(1, Math.round(layer.sequentialData?.frameCount ?? sequentialRecord.frameCount))} frames`
              : 'Regular layer';

          return (
            <React.Fragment key={`${layer.id}-${layer.order}-${index}`}>
              {shouldRenderGroupHeader && groupId && (
                <div
                  draggable
                  className={`flex items-center gap-2 border-b border-[#3F3F3F] px-2 py-1 text-[10px] uppercase tracking-wide ${
                    isGroupSelected ? 'bg-[#E8F2FF] text-[#0F172A]' : 'bg-[#25252A] text-[#B8C0CC]'
                  } ${draggedGroupId === groupId ? 'opacity-60' : ''}`}
                  onDragStart={(event) => {
                    handleGroupDragStart(event, groupId);
                  }}
                  onDragEnd={handleDragEnd}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    handleGroupDrop(event, groupId);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (groupLayerIds.length === 0) {
                      return;
                    }
                    setSelectedLayerIds(groupLayerIds);
                    const topLayerId = groupLayerIds[groupLayerIds.length - 1];
                    if (topLayerId) {
                      setActiveLayer(topLayerId, { preserveSelection: true });
                    }
                    setLayerMenuState(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (groupLayerIds.length === 0) {
                      return;
                    }
                    handleExpandGroup(groupId);
                    setSelectedLayerIds(groupLayerIds);
                    const topLayerId = groupLayerIds[groupLayerIds.length - 1];
                    if (topLayerId) {
                      setActiveLayer(topLayerId, { preserveSelection: true });
                    }
                    const anchor = event.currentTarget as HTMLDivElement;
                    const placement = estimateLayerMenuPosition(anchor);
                    setLayerMenuState({
                      layerId: groupLayerIds[0],
                      ...placement,
                    });
                  }}
                >
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      handleToggleGroupCollapsed(groupId);
                    }}
                    className="flex h-4 w-4 items-center justify-center text-[#9EA8B6] hover:text-white"
                    title={isGroupCollapsed ? `Expand group: ${groupName}` : `Collapse group: ${groupName}`}
                    aria-label={isGroupCollapsed ? `Expand group: ${groupName}` : `Collapse group: ${groupName}`}
                    aria-expanded={!isGroupCollapsed}
                  >
                    <ChevronRight size={12} className={isGroupCollapsed ? '' : 'rotate-90'} />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setLayerGroupVisibility(groupId, !groupAllVisible);
                    }}
                    className={`flex h-4 w-4 items-center justify-center ${groupVisibleIconClass} ${
                      isGroupSelected ? 'hover:text-[#000]' : 'hover:text-white'
                    }`}
                    title={groupAllVisible ? `Hide group: ${groupName}` : `Show group: ${groupName}`}
                  >
                    {groupAllVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <span className="truncate">{groupName}</span>
                </div>
              )}
              {isGroupCollapsed ? null : (
              <div
                draggable={!isMenuOpen}
                onContextMenu={event => {
                  event.preventDefault();
                  const anchor = event.currentTarget as HTMLDivElement;
                  const placement = estimateLayerMenuPosition(anchor);

                  if (!selectedLayerIds.includes(layer.id)) {
                    setSelectedLayerIds([layer.id]);
                    setActiveLayer(layer.id);
                  }

                  setLayerMenuState({
                    layerId: layer.id,
                    ...placement
                  });
                }}
                className={`group relative border-b border-[#404040] ${
                  rowVisualClass
                } ${draggedLayerId === layer.id ? 'opacity-50 shadow-lg' : ''} ${
                  isMenuOpen ? 'z-30' : ''
                } cursor-pointer transition-colors`}
                onClick={(event) => handleRowClick(event, layer.id)}
                onDragStart={event => handleDragStart(event, layer.id)}
                onDragOver={handleDragOver}
                onDrop={event => handleDrop(event, layer.id)}
                onDragEnd={handleDragEnd}
              >
                <div className={`flex items-start gap-2 px-2 py-1.5 ${groupId ? 'pl-4' : ''}`}>
                <button
                  onClick={event => {
                    event.stopPropagation();
                    handleToggleVisibility(layer.id);
                  }}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${
                    visibleIconClass
                  } ${isActive ? 'hover:text-[#000]' : 'hover:text-white'}`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>

                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                  <div className="flex h-3 w-6 shrink-0 items-center overflow-hidden rounded">
                    {isColorCycle ? (
                      <div
                        className="h-3 w-full"
                        style={{
                          background: generateGradientCSS(gradient),
                          opacity: layer.visible ? 1 : 0.5
                        }}
                      />
                    ) : (
                      <LayerColorSwatches layer={layer} visible={layer.visible} />
                    )}
                  </div>
                  <span
                    className={`min-w-0 flex-1 truncate text-[11px] font-semibold leading-4 ${isHighlighted ? 'text-[#0F172A]' : 'text-[#F2F2F2]'}`}
                    title={layerTitle}
                  >
                    {layer.name}
                  </span>
                    <span className={labelClass} title={layerKindTitle}>
                      {layerKindLabel}
                    </span>
                    <span className={labelClass} title={layerTitle}>
                      #{layerDebugToken}
                    </span>
                </div>

                <div className="ml-1 flex shrink-0 items-center gap-1">
                  {layers.length > 1 && (
                    <button
                      onClick={event => {
                        event.stopPropagation();
                        handleDeleteLayer(layer.id);
                      }}
                      className={`flex h-4 w-4 items-center justify-center transition-opacity ${deleteButtonColor} ${hoverDeleteColor} group-hover:opacity-100 opacity-0`}
                      title="Delete Layer"
                    >
                      ×
                    </button>
                  )}
                </div>
                {isMenuOpen && (
                  <div
                    ref={opacityPopoverRef}
                    className={`absolute z-50 w-52 border border-[#666] bg-[#2A2A32] p-2.5 shadow-lg space-y-2 ${
                      layerMenuState.vertical === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'
                    } ${layerMenuState.horizontal === 'right' ? 'right-2' : 'left-2'}`}
                    onClick={event => event.stopPropagation()}
                  >
                    <div className="space-y-1.5">
                      <div
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => event.stopPropagation()}
                      >
                        <ProgressSlider
                          value={sliderPercent}
                          min={0}
                          max={100}
                          step={1}
                          onChange={value => handleOpacityChange(layer.id, value)}
                          aria-label="Layer Opacity"
                        />
                      </div>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          handleToggleTransparencyLock(layer.id);
                        }}
                        className={`w-full flex items-center justify-center gap-2 px-1.5 py-0.5 text-[11px] border border-[#545454] transition-colors ${
                          layer.transparencyLocked ? 'bg-[#3C3C3C] text-[#F8D866]' : 'bg-transparent text-[#B0B0B0]'
                        } hover:bg-[#3C3C3C]`}
                        aria-pressed={layer.transparencyLocked === true}
                        title={layer.transparencyLocked ? 'Unlock transparent pixels' : 'Lock transparent pixels'}
                      >
                        <span>{layer.transparencyLocked ? 'Unlock transparency' : 'Lock transparency'}</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          selectLayerAlpha(layer.id);
                          setActiveLayer(layer.id);
                          setSelectedLayerIds([layer.id]);
                          setLayerMenuState(null);
                        }}
                        className="w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A] transition-colors"
                        title="Select all non-transparent pixels on this layer"
                      >
                        <span>Select alpha</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          handleToggleLock(layer.id);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] transition-colors ${
                          layer.locked ? 'text-[#D9D9D9] bg-[#3A3A3A]' : 'text-[#B0B0B0] bg-transparent'
                        } hover:bg-[#3A3A3A]`}
                      >
                        <span>{layer.locked ? 'Unlock layer' : 'Lock layer'}</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          setReferenceLayer(isReferenceLayer ? null : layer.id);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          isReferenceLayer
                            ? 'border-[#4C6B3C] text-[#D4F7C4] bg-[#2E3A29]'
                            : 'border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A]'
                        }`}
                        title="Use this layer when sampling colors"
                        aria-pressed={isReferenceLayer}
                      >
                        <span>{isReferenceLayer ? 'Unmark reference layer' : 'Mark as reference layer'}</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          const duplicatedIds = handleDuplicateLayer(layer.id);
                          if (duplicatedIds.length > 0) {
                            setLayerMenuState(null);
                          }
                        }}
                        className="w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A] transition-colors"
                        title="Duplicate this layer"
                      >
                        <span>Duplicate layer</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          const targetIds =
                            selectedLayerIds.length > 1 && selectedLayerIds.includes(layer.id)
                              ? selectedLayerIds
                              : [layer.id];
                          createLayerGroupFromSelection(targetIds);
                          setLayerMenuState(null);
                        }}
                        className="w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A] transition-colors"
                        title="Create a visual group from selection"
                      >
                        <span>Group selection</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          if (!layer.groupId) {
                            return;
                          }
                          removeLayerGroup(layer.groupId);
                          setLayerMenuState(null);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          layer.groupId
                            ? 'border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A]'
                            : 'border-[#3A3A3A] text-[#777] cursor-not-allowed'
                        }`}
                        disabled={!layer.groupId}
                        title="Remove this layer's group"
                      >
                        <span>Ungroup</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          const targetIds =
                            selectedLayerIds.length > 1 && selectedLayerIds.includes(layer.id)
                              ? selectedLayerIds
                              : [layer.id];
                          mergeLayers(targetIds);
                          setLayerMenuState(null);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          selectedLayerIds.length > 1
                            ? 'border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A]'
                            : 'border-[#3A3A3A] text-[#777] cursor-not-allowed'
                        }`}
                        disabled={selectedLayerIds.length < 2}
                        title="Merge selected layers into one"
                      >
                        <span>Merge layers</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          if (layers.length <= 1) {
                            return;
                          }
                          handleDeleteLayer(layer.id);
                          setLayerMenuState(null);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          layers.length > 1
                            ? 'border-[#803232] text-[#FF6B6B] hover:bg-[#3A1F1F]'
                            : 'border-[#3A3A3A] text-[#555] cursor-not-allowed'
                        }`}
                        disabled={layers.length <= 1}
                        title={layers.length > 1 ? 'Delete this layer' : 'At least one layer is required'}
                      >
                        <span>Delete layer</span>
                      </button>
                    </div>
                  </div>
                )}
                </div>
              </div>
              )}
            </React.Fragment>
          );
        });
        })()}
        <div
          className={`h-3 ${dragOverBottom ? 'border-t-2 border-blue-400' : ''}`}
          onDragOver={handleDragOverBottom}
          onDragLeave={() => setDragOverBottom(false)}
          onDrop={handleDropBottom}
        />
      </div>
    </div>
  );
};

export default React.memo(LayersPanel);
