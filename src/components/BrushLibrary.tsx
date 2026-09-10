"use client";

import React, { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, BrushPreset, CustomBrush } from '@/types';
import ButtonGroup from '@/components/ui/ButtonGroup';
import studioExtension from '@/extensions/studioExtension';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { showAppFeedback } from '@/utils/appFeedback';
import PlusButton from './ui/PlusButton';
import { generateBrushThumbnail } from '@/utils/brushThumbnailGenerator';
import { useToolSwitcher } from '@/utils/toolSwitch';
import { createCustomBrushPreset } from '@/utils/customBrushPreset';
import {
  selectDefaultCustomBrushId,
} from '@/stores/selectors/projectSelectors';
import {
  selectBrushEditor,
  selectBrushSettings,
  selectCurrentTool,
  selectTemporaryCustomBrush,
} from '@/stores/selectors/toolsSelectors';

const BRUSH_ICON_SIZE = 26;
const BRUSH_TEXT_LINE_HEIGHT = 11;
const GENERIC_PRESET_THUMBNAILS = new Set([
  '/assets/images/Brush.png',
  '/assets/images/Square.png',
]);
const LEADING_BRUSH_ORDER = new Map([
  ['pixel-square', 0],
  ['soft-round', 1],
]);
const TRAILING_BRUSH_ORDER = new Map([
  ['mosaic', 0],
  ['shape-fill', 1],
]);
const HIDDEN_BRUSH_PRESET_IDS = new Set([
  'color-cycle-triangle',
  'shape-gradient',
]);

const resolveBrushThumbnailUrl = (src: string): string => {
  if (!src.startsWith('/')) {
    return src;
  }

  const buildBasePath = process.env.VESSEL_BASE_PATH?.trim();
  if (buildBasePath) {
    return `${buildBasePath.replace(/\/$/, '')}${src}`;
  }

  if (typeof window === 'undefined') {
    return src;
  }

  const nextData = (window as typeof window & {
    __NEXT_DATA__?: {
      assetPrefix?: string;
      runtimeConfig?: { basePath?: string };
    };
  }).__NEXT_DATA__;

  const assetPrefix = nextData?.assetPrefix?.trim();
  if (assetPrefix) {
    return `${assetPrefix.replace(/\/$/, '')}${src}`;
  }

  const basePath = nextData?.runtimeConfig?.basePath?.trim();
  if (basePath) {
    return `${basePath.replace(/\/$/, '')}${src}`;
  }

  return src;
};

const BrushLibrary = () => {
  const [libraryFilter, setLibraryFilter] = React.useState('all');
  const StudioPlaybackSettings = studioExtension.PlaybackSettings;
  const brushPanelSection = useAppStore((state) => state.ui.brushPanelSection);
  const layers = useAppStore((state) => state.layers);
  const layerGroups = useAppStore((state) => state.layerGroups);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const selectedLayerIds = useAppStore((state) => state.selectedLayerIds);
  const createInterlaceGroupFromSelection = useAppStore((state) => state.createInterlaceGroupFromSelection);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const brushPresets = useAppStore((state) => state.brushPresets);
  const projectCustomBrushes = useAppStore((state) => state.project?.customBrushes ?? []);
  const customBrushes = projectCustomBrushes;
  const defaultCustomBrushId = useAppStore(selectDefaultCustomBrushId);
  const brushSettings = useAppStore(selectBrushSettings);
  const currentTool = useAppStore(selectCurrentTool);
  const brushEditor = useAppStore(selectBrushEditor);
  const temporaryCustomBrush = useAppStore(selectTemporaryCustomBrush);
  const getCustomBrushByIdUnsafe = useAppStore((state) => state.getCustomBrushByIdUnsafe);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const setBrushPanelSection = useAppStore((state) => state.setBrushPanelSection);
  const switchTool = useToolSwitcher();
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
  const [saveCustomBrushAsPreset, removeCustomBrush, setDefaultCustomBrush] = useAppStore(
    useShallow((state) => [
      state.saveCustomBrushAsPreset,
      state.removeCustomBrush,
      state.setDefaultCustomBrush,
    ])
  );
  const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);

  // Create combined list of brushes: regular presets + custom brushes from project
  const customBrushPresets = React.useMemo(() => {
    if (customBrushes.length === 0) return [];

    return customBrushes.map((customBrush) =>
      createCustomBrushPreset(customBrush, {
        isDefault: defaultCustomBrushId === customBrush.id,
        thumbnail: customBrush.thumbnail
      })
    );
  }, [customBrushes, defaultCustomBrushId]);

  // Generate thumbnails for regular brush presets (client-side only)
  const [brushThumbnails, setBrushThumbnails] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const thumbnails: Record<string, string> = {};

    brushPresets.forEach(preset => {
      if (HIDDEN_BRUSH_PRESET_IDS.has(preset.id)) {
        return;
      }
      if (!preset.isCustomBrush) {
        const presetThumbnail = preset.thumbnail?.trim();
        thumbnails[preset.id] =
          presetThumbnail && !GENERIC_PRESET_THUMBNAILS.has(presetThumbnail)
            ? resolveBrushThumbnailUrl(presetThumbnail)
            : generateBrushThumbnail(preset, {
                size: BRUSH_ICON_SIZE,
                brushColor: '#D9D9D9',
                backgroundColor: 'transparent'
              });
      }
    });

    setBrushThumbnails(thumbnails);
  }, [brushPresets]);

  // Combine all brushes: regular presets + custom brushes
  const allBrushes = React.useMemo(() => {
    const combined = [
      ...brushPresets.filter(preset => !HIDDEN_BRUSH_PRESET_IDS.has(preset.id)),
      ...customBrushPresets
    ];
    
    // Sort brushes: Pixel Art first (with square brushes prioritized), then other categories
    const ordered = combined.sort((a, b) => {
      const getSortCategory = (preset: BrushPreset) =>
        preset.id === 'dither-grad' ? 'Pixel Art' : preset.category;
      const aCategory = getSortCategory(a);
      const bCategory = getSortCategory(b);

      // Custom brushes always go last
      if (aCategory === 'Custom' && bCategory !== 'Custom') return 1;
      if (bCategory === 'Custom' && aCategory !== 'Custom') return -1;

      // Studio text and UI brushes follow Shape Pattern via libraryOrderAfter.
      const aTrailingOrder = TRAILING_BRUSH_ORDER.get(a.id);
      const bTrailingOrder = TRAILING_BRUSH_ORDER.get(b.id);
      if (aTrailingOrder !== undefined || bTrailingOrder !== undefined) {
        return (aTrailingOrder ?? -1) - (bTrailingOrder ?? -1);
      }

      const aLeadingOrder = LEADING_BRUSH_ORDER.get(a.id);
      const bLeadingOrder = LEADING_BRUSH_ORDER.get(b.id);
      if (aLeadingOrder !== undefined || bLeadingOrder !== undefined) {
        return (aLeadingOrder ?? Number.MAX_SAFE_INTEGER) -
          (bLeadingOrder ?? Number.MAX_SAFE_INTEGER);
      }
      
      // Pixel Art brushes go first
      if (aCategory === 'Pixel Art' && bCategory !== 'Pixel Art') return -1;
      if (bCategory === 'Pixel Art' && aCategory !== 'Pixel Art') return 1;
      
      // Within Pixel Art, prioritize square brushes
      if (aCategory === 'Pixel Art' && bCategory === 'Pixel Art') {
        const aIsSquare = a.name.toLowerCase().includes('square') || a.id === 'pixel-square';
        const bIsSquare = b.name.toLowerCase().includes('square') || b.id === 'pixel-square';
        if (aIsSquare && !bIsSquare) return -1;
        if (bIsSquare && !aIsSquare) return 1;
      }

      const specialOrder = new Map([
        ['color-cycle-stroke', 1],
        ['color-cycle-gradient', 2],
        ['color-cycle-flat-dither', 3],
        ['checkered', 4],
        ['color-cycle-shape', 5],
      ]);
      const aSpecial = specialOrder.get(a.id);
      const bSpecial = specialOrder.get(b.id);
      if (aSpecial !== undefined && bSpecial !== undefined && aSpecial !== bSpecial) {
        return aSpecial - bSpecial;
      }
      
      // Keep original order for other brushes
      return 0;
    });

    const anchoredPresets = ordered.filter((preset) => preset.libraryOrderAfter);
    const insertionOffsets = new Map<string, number>();
    anchoredPresets.forEach((preset) => {
      const anchorId = preset.libraryOrderAfter;
      if (!anchorId || anchorId === preset.id) return;
      const currentIndex = ordered.findIndex((candidate) => candidate.id === preset.id);
      if (currentIndex < 0) return;
      ordered.splice(currentIndex, 1);
      const anchorIndex = ordered.findIndex((candidate) => candidate.id === anchorId);
      if (anchorIndex < 0) {
        ordered.splice(currentIndex, 0, preset);
        return;
      }
      const offset = insertionOffsets.get(anchorId) ?? 0;
      ordered.splice(anchorIndex + 1 + offset, 0, preset);
      insertionOffsets.set(anchorId, offset + 1);
    });

    return ordered;
  }, [brushPresets, customBrushPresets]);

  const { brushShape, selectedCustomBrush } = brushSettings;

  const activeBrushId = React.useMemo(() => {
    if (currentTool !== 'brush' || brushPanelSection !== 'tool') {
      return null;
    }

    if (brushShape === BrushShape.CUSTOM) {
      if (!selectedCustomBrush) {
        return null;
      }

      const candidateIds = [`custom_${selectedCustomBrush}`, selectedCustomBrush];
      const matchingId = candidateIds.find((candidate) =>
        allBrushes.some((brush) => brush.id === candidate)
      );

      return matchingId ?? null;
    }

    if (
      brushShape === BrushShape.COLOR_CYCLE ||
      brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
      brushShape === BrushShape.COLOR_CYCLE_SHAPE
    ) {
      if (
        currentBrushPreset?.id &&
        allBrushes.some((brush) => brush.id === currentBrushPreset.id)
      ) {
        return currentBrushPreset.id;
      }

      const fallbackId = allBrushes.some((brush) => brush.id === 'color-cycle-stroke')
        ? 'color-cycle-stroke'
        : null;

      return fallbackId;
    }

    return currentBrushPreset?.id ?? null;
  }, [
    allBrushes,
    brushPanelSection,
    brushShape,
    currentBrushPreset?.id,
    currentTool,
    selectedCustomBrush
  ]);

  // Check if there's an active custom brush that can be saved
  const activeCustomBrush = React.useMemo<CustomBrush | null>(() => {
    const selectedId = brushSettings.selectedCustomBrush;
    if (!selectedId) return null;

    if (temporaryCustomBrush && temporaryCustomBrush.id === selectedId) {
      return temporaryCustomBrush;
    }

    const savedBrush = getCustomBrushByIdUnsafe?.(selectedId) ?? null;
    if (savedBrush) {
      return savedBrush;
    }

    const brushTip = brushSettings.currentBrushTip;
    if (
      brushSettings.brushShape === BrushShape.CUSTOM &&
      brushTip &&
      brushTip.brushId === selectedId
    ) {
      const naturalWidth = brushTip.naturalWidth ?? brushTip.width ?? brushTip.imageData.width;
      const naturalHeight = brushTip.naturalHeight ?? brushTip.height ?? brushTip.imageData.height;
      return {
        id: selectedId,
        name: 'Temp Brush',
        imageData: brushTip.imageData,
        width: brushTip.width ?? brushTip.imageData.width,
        height: brushTip.height ?? brushTip.imageData.height,
        naturalWidth,
        naturalHeight,
        maxDimension: brushTip.maxDimension ?? Math.max(naturalWidth, naturalHeight),
        thumbnail: '',
        createdAt: Date.now(),
      };
    }

    return null;
  }, [
    brushSettings.brushShape,
    brushSettings.currentBrushTip,
    brushSettings.selectedCustomBrush,
    getCustomBrushByIdUnsafe,
    temporaryCustomBrush,
  ]);

  // Handle escape key to cancel editing
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && brushEditor.status === 'EDITING' && currentOffscreenCanvas) {
        cancelBrushEdit(currentOffscreenCanvas);
      }
    };

    if (brushEditor.status === 'EDITING') {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [brushEditor.status, cancelBrushEdit, currentOffscreenCanvas]);

  // REFACTOR: Removed the redundant useEffect for saving settings.
  // This is now handled reliably by the store before any tool/preset switch.

  const canSaveCustomBrush = Boolean(
    temporaryCustomBrush && activeCustomBrush?.id === temporaryCustomBrush.id
  );

  const handleSaveCustomBrushAsPreset = () => {
    if (!activeCustomBrush) return;

    saveCustomBrushAsPreset(activeCustomBrush.id);
  };

  const handleDeletePreset = (presetId: string) => {
    // Check if this is a custom brush from save file
    if (presetId.startsWith('custom_')) {
      // Extract the original custom brush ID
      const originalCustomBrushId = presetId.substring(7);
      removeCustomBrush(originalCustomBrushId);
    } else if (presetId.startsWith('preset_')) {
      // This is a custom brush saved as preset - remove the brush preset
      removeBrushPreset(presetId);
    } else {
      // Regular brush preset
      removeBrushPreset(presetId);
    }
  };

  const toggleDefaultForPreset = React.useCallback(
    (preset: BrushPreset) => {
      if (!preset.isCustomBrush || !preset.id.startsWith('custom_')) {
        return;
      }

      const originalCustomBrushId = preset.id.substring(7);
      if (!originalCustomBrushId) {
        return;
      }

      if (defaultCustomBrushId === originalCustomBrushId) {
        setDefaultCustomBrush(null);
      } else {
        setDefaultCustomBrush(originalCustomBrushId);
      }
    },
    [defaultCustomBrushId, setDefaultCustomBrush]
  );

  const handlePresetClick = async (preset: BrushPreset) => {
    // Switch to Brush tool first to avoid any chance of preset
    // application being overwritten by a subsequent tool change.
    setBrushPanelSection('tool');
    await switchTool('brush');
    const preserveEditMode = preset.isCustomBrush;
    // Then apply the selected preset (preserve edit mode only for custom brushes)
    setBrushPreset(preset, preserveEditMode);
  };

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A]">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[#4a4a4a]">
        <div role="group" aria-label="Library filter" className="min-w-0 flex-1">
          <ButtonGroup
            options={[
              { label: 'All', value: 'all' },
              { label: 'Brushes', value: 'brushes' },
              { label: 'Effects', value: 'effects' },
            ]}
            value={libraryFilter}
            onChange={setLibraryFilter}
            size="xs"
            wrap={false}
            className="w-full [&>button]:flex-1 [&>button]:basis-0 [&>button]:min-w-0"
          />
        </div>
        <PlusButton
          type="button"
          className="shrink-0"
          onClick={handleSaveCustomBrushAsPreset}
          disabled={!canSaveCustomBrush}
          aria-label="Save captured custom brush to library"
          title={canSaveCustomBrush
            ? 'Save captured custom brush to library'
            : 'Capture a custom brush before saving'}
        />
      </div>
      <div className="flex-1 py-1 space-y-0 overflow-y-auto">
        <div hidden={libraryFilter === 'effects'}>
        {(['custom', 'fill'] as const).map((tool) => (
          <button key={tool} type="button" aria-pressed={currentTool === tool && brushPanelSection === 'tool'}
            className={`flex w-full items-center gap-0.5 px-2.5 h-[26px] text-xs text-left ${currentTool === tool && brushPanelSection === 'tool' ? 'bg-[#D9D9D9] text-[#1A1A1A]' : 'text-[#D9D9D9] hover:bg-[#333]'}`}
            onClick={() => { setBrushPanelSection('tool'); void switchTool(tool); }}>
            <span aria-hidden="true" className="w-[26px] shrink-0 text-center">{tool === 'custom' ? 'Cb' : 'Fi'}</span>
            {tool === 'custom' ? 'Custom Brush' : 'Fill'}
          </button>
        ))}
        {allBrushes.map((preset) => {
          const isSpamBrush = preset.id === 'spam-text';
          const iconSizePx = BRUSH_ICON_SIZE;
          const textStyle = {
            fontSize: isSpamBrush ? '13px' : '12px',
            lineHeight: `${BRUSH_TEXT_LINE_HEIGHT}px`
          };
          const renderFallbackIcon = (shape: 'square' | 'circle' | 'text', highlight: boolean) => {
            if (shape === 'text') {
              return (
                <div
                  className="flex items-center"
                  style={{
                    color: highlight ? '#1A1A1A' : '#D9D9D9',
                    fontSize: isSpamBrush ? '13px' : '11px',
                    fontFamily: 'IBM Plex Mono, "Courier New", monospace',
                    paddingLeft: isSpamBrush ? '4px' : '3px',
                    width: `${iconSizePx}px`,
                    height: `${iconSizePx}px`,
                    flexShrink: 0
                  }}
                >
                  a
                </div>
              );
            }

            const borderRadius = shape === 'circle' ? '50%' : '2px';

            return (
              <div
                className="flex items-center justify-center"
                style={{ width: `${iconSizePx}px`, height: `${iconSizePx}px`, flexShrink: 0 }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    border: highlight ? '2px solid #1A1A1A' : '2px solid #D9D9D9',
                    borderRadius,
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            );
          };

          const isActive = activeBrushId === preset.id;
          const rowClass = isActive ? 'bg-[#D9D9D9] text-[#1A1A1A]' : 'text-[#D9D9D9]';
          const nameStyle = {
            ...textStyle,
            color: isActive ? '#1A1A1A' : '#D9D9D9'
          };
          const nameClass = isActive ? '' : 'transition-colors group-hover:text-[#F3F3F7]';

          return (
          <React.Fragment key={preset.id}>
            {/* Skip the separate Color Cycle Shape row to consolidate */}
            {preset.id !== 'color-cycle-shape' && (
              <div
                onClick={() => handlePresetClick(preset)}
                onContextMenu={(event) => {
                  if (!preset.isCustomBrush) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  toggleDefaultForPreset(preset);
                }}
                className={`group flex items-center justify-between px-2.5 py-0 cursor-pointer transition-colors ${rowClass}`}
              >
                <div className="flex items-center gap-0.5">
                  {preset.isCustomBrush ? (
                    <div
                      style={{
                        width: `${iconSizePx}px`,
                        height: `${iconSizePx}px`,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#FFFFFF',
                        borderRadius: '4px',
                        border: isActive ? '1px solid #1A1A1A' : '1px solid #3D3D3D',
                        padding: '2px',
                        boxSizing: 'border-box'
                      }}
                    >
                      {preset.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preset.thumbnail}
                          alt={`${preset.name} thumbnail`}
                          width={iconSizePx - 4}
                          height={iconSizePx - 4}
                          style={{
                            imageRendering: 'pixelated',
                            width: '100%',
                            height: '100%',
                            display: 'block'
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            backgroundImage:
                              'linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%), linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%)',
                            backgroundSize: '6px 6px',
                            backgroundPosition: '0 0, 3px 3px'
                          }}
                        />
                      )}
                    </div>
                  ) : brushThumbnails[preset.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={brushThumbnails[preset.id]}
                      alt={`${preset.name} thumbnail`}
                      width={iconSizePx}
                      height={iconSizePx}
                      style={{
                        imageRendering: 'auto',
                        width: `${iconSizePx}px`,
                        height: `${iconSizePx}px`,
                        display: 'block',
                        flexShrink: 0,
                        filter: isActive ? 'invert(1)' : 'none'
                      }}
                    />
                  ) : (
                    renderFallbackIcon(isSpamBrush ? 'text' : preset.category === 'Pixel Art' ? 'square' : 'circle', isActive)
                  )}
                  <span style={nameStyle} className={nameClass}>
                    {preset.id === 'color-cycle-stroke' ? 'Color Cycle Stroke' : preset.name}
                  </span>
                </div>
                {preset.isCustomBrush && (
                  <div className="flex items-center space-x-0.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDefaultForPreset(preset);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleDefaultForPreset(preset);
                      }}
                      className={`w-3 h-3 text-center flex items-center justify-center transition-colors ${
                        isActive ? 'text-[#5A5A5A]' : 'text-[#D9D9D9]'
                      } ${preset.isDefault ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                      style={{ fontSize: '12px' }}
                      title={preset.isDefault ? 'Unset as default brush' : 'Set as default brush'}
                      aria-pressed={preset.isDefault}
                    >
                      {preset.isDefault ? '★' : '☆'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePreset(preset.id);
                      }}
                      className={`w-3 h-3 transition-colors opacity-60 hover:opacity-100 text-center flex items-center justify-center ${
                        isActive ? 'text-[#5A5A5A] hover:text-red-600' : 'text-[#D9D9D9] hover:text-red-400'
                      }`}
                      title={`Delete ${preset.name}`}
                      style={{ fontSize: '14px' }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            )}

          </React.Fragment>
        );
        })}
        </div>
        <div hidden={libraryFilter === 'brushes'}>
          {(['color-adjust', 'recolor', 'filters', 'interlace'] as const).map((effect) => {
            const active = effect === 'interlace' || effect === 'filters' ? brushPanelSection === effect : brushPanelSection === 'tool' && currentTool === effect;
            return <button key={effect} type="button" aria-pressed={active}
              className={`flex w-full items-center gap-0.5 px-2.5 h-[26px] text-xs text-left ${active ? 'bg-[#D9D9D9] text-[#1A1A1A]' : 'text-[#D9D9D9] hover:bg-[#333]'}`}
              onClick={() => {
                if (effect === 'filters') {
                  setBrushPanelSection('filters');
                } else if (effect === 'interlace') {
                  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
                  const selectedLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));
                  const existingGroup = layerGroups.find((group) => isInterlaceGroup(group)
                    && (activeLayer?.groupId === group.id || selectedLayers.some((layer) => layer.groupId === group.id)));
                  if (!existingGroup) {
                    const eligibleIds = selectedLayers.filter((layer) => layer.layerType !== 'sequential').map((layer) => layer.id);
                    if (eligibleIds.length < 2 || !createInterlaceGroupFromSelection(eligibleIds)) {
                      showAppFeedback('Select at least two regular or Color Cycle layers');
                      return;
                    }
                  }
                  setBrushPanelSection('interlace');
                } else {
                  setBrushPanelSection('tool');
                  void switchTool(effect);
                }
              }}>
              <span aria-hidden="true" className="w-[26px] shrink-0 text-center">{effect === 'filters' ? 'Fl' : effect === 'interlace' ? 'In' : effect === 'recolor' ? 'Cc' : 'Hs'}</span>
              {effect === 'filters' ? 'Filters' : effect === 'interlace' ? 'Interlace' : effect === 'recolor' ? 'Color cycle + recolor' : 'Colour Adjust'}
            </button>;
          })}
          {studioExtension.UnresolveSettings && (
            <button
              type="button"
              aria-pressed={brushPanelSection === 'unresolve'}
              onClick={() => setBrushPanelSection('unresolve')}
              className={`flex h-[26px] w-full items-center gap-0.5 px-2.5 text-left text-xs ${brushPanelSection === 'unresolve' ? 'bg-[#D9D9D9] text-[#1A1A1A]' : 'text-[#D9D9D9] hover:bg-[#333]'}`}
            >
              <span aria-hidden="true" className="w-[26px] shrink-0 text-center">Un</span>
              Unresolve
            </button>
          )}
          <div className="px-2.5">
            {StudioPlaybackSettings && <StudioPlaybackSettings />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrushLibrary;
