"use client";

import React, { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset } from '../types';
import PlusButton from './ui/PlusButton';
import { generateBrushThumbnail } from '../utils/brushThumbnailGenerator';
import { useToolSwitcher } from '@/utils/toolSwitch';
import { createCustomBrushPreset } from '@/utils/customBrushPreset';

const BRUSH_ICON_SIZE = 32;
const BRUSH_TEXT_LINE_HEIGHT = 11;

const BrushLibrary = () => {
  // FIX: Use individual selectors to avoid creating new objects on every render
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const project = useAppStore((state) => state.project);
  const defaultCustomBrushId = project?.defaultCustomBrushId ?? null;
  const tools = useAppStore((state) => state.tools);
  const brushEditor = useAppStore((state) => state.brushEditor);
  const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const switchTool = useToolSwitcher();
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const removeCustomBrush = useAppStore((state) => state.removeCustomBrush);
  const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);
  const setDefaultCustomBrush = useAppStore((state) => state.setDefaultCustomBrush);
  
  // Create combined list of brushes: regular presets + custom brushes from project
  const customBrushPresets = React.useMemo(() => {
    if (!project?.customBrushes) return [];

    return project.customBrushes.map((customBrush) =>
      createCustomBrushPreset(customBrush, {
        isDefault: defaultCustomBrushId === customBrush.id,
        thumbnail: customBrush.thumbnail
      })
    );
  }, [project?.customBrushes, defaultCustomBrushId]);

  // Generate thumbnails for regular brush presets (client-side only)
  const [brushThumbnails, setBrushThumbnails] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const thumbnails: Record<string, string> = {};

    brushPresets.forEach(preset => {
      if (preset.id === 'color-cycle-triangle') {
        return; // Hide triangle duplicate in the library; switcher handles it
      }
      if (!preset.isCustomBrush) {
        thumbnails[preset.id] = generateBrushThumbnail(preset, {
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
      ...brushPresets.filter(preset => preset.id !== 'color-cycle-triangle'),
      ...customBrushPresets
    ];
    
    // Sort brushes: Pixel Art first (with square brushes prioritized), then other categories
    return combined.sort((a, b) => {
      // Custom brushes always go last
      if (a.category === 'Custom' && b.category !== 'Custom') return 1;
      if (b.category === 'Custom' && a.category !== 'Custom') return -1;
      
      // Pixel Art brushes go first
      if (a.category === 'Pixel Art' && b.category !== 'Pixel Art') return -1;
      if (b.category === 'Pixel Art' && a.category !== 'Pixel Art') return 1;
      
      // Within Pixel Art, prioritize square brushes
      if (a.category === 'Pixel Art' && b.category === 'Pixel Art') {
        const aIsSquare = a.name.toLowerCase().includes('square') || a.id === 'square-pixel-1';
        const bIsSquare = b.name.toLowerCase().includes('square') || b.id === 'square-pixel-1';
        if (aIsSquare && !bIsSquare) return -1;
        if (bIsSquare && !aIsSquare) return 1;
      }
      
      // Keep original order for other brushes
      return 0;
    });
  }, [brushPresets, customBrushPresets]);

  const { currentTool, brushSettings } = tools;
  const { brushShape, selectedCustomBrush } = brushSettings;

  const activeBrushId = React.useMemo(() => {
    if (currentTool === 'recolor' || currentTool === 'fill') {
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
    brushShape,
    currentBrushPreset?.id,
    currentTool,
    selectedCustomBrush
  ]);
  
  // Check if there's an active custom brush that can be saved
  const activeCustomBrush = React.useMemo(() => {
    if (!tools.brushSettings.selectedCustomBrush) return null;
    
    // Check temporary custom brush first
    if (temporaryCustomBrush && temporaryCustomBrush.id === tools.brushSettings.selectedCustomBrush) {
      return temporaryCustomBrush;
    }
    
    // Then check project custom brushes
    if (project) {
      return project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush) || null;
    }
    
    return null;
  }, [tools.brushSettings.selectedCustomBrush, temporaryCustomBrush, project]);
  
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
  
  const canSaveCustomBrush = true; // Always show the + button
  
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
    await switchTool('brush');
    const preserveEditMode = preset.isCustomBrush;
    // Then apply the selected preset (preserve edit mode only for custom brushes)
    setBrushPreset(preset, preserveEditMode);
  };

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A]">
      <div className="flex items-center justify-between px-3 py-2 bg-[#1A1A1A] border-b border-[#4a4a4a]">
        <span className="font-medium text-[#D9D9D9]" style={{ fontSize: '14px' }}>Brush Library</span>
        <div className="flex items-center space-x-2">
          {canSaveCustomBrush && (
            <PlusButton
              onClick={handleSaveCustomBrushAsPreset}
              title="Save current custom brush to library"
            />
          )}
        </div>
      </div>
      
      <div className="flex-1 py-1 space-y-0 overflow-y-auto">
        {allBrushes.map((preset) => {
          const isSpamBrush = preset.id === 'spam-brush';
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

            {/* Insert Recolor and animate entry immediately after consolidated Color Cycle row */}
            {preset.id === 'color-cycle-stroke' && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  void switchTool('recolor');
                }}
                className={`group flex items-center justify-between px-2.5 py-0 cursor-pointer transition-colors ${
                  tools.currentTool === 'recolor' ? 'bg-[#D9D9D9] text-[#1A1A1A]' : 'text-[#D9D9D9]'
                }`}
                title="Open Color cycle + recolor panel"
              >
                <div className="flex items-center gap-0.5">
                  {brushThumbnails['color-cycle-shape'] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={brushThumbnails['color-cycle-shape']}
                      alt={`Color cycle + recolor icon`}
                      width={BRUSH_ICON_SIZE}
                      height={BRUSH_ICON_SIZE}
                      style={{
                        imageRendering: 'auto',
                        width: `${BRUSH_ICON_SIZE}px`,
                        height: `${BRUSH_ICON_SIZE}px`,
                        display: 'block',
                        flexShrink: 0,
                        filter: tools.currentTool === 'recolor' ? 'invert(1)' : 'none'
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: '12px',
                        flexShrink: 0,
                        width: `${BRUSH_ICON_SIZE}px`,
                        height: `${BRUSH_ICON_SIZE}px`,
                        color: tools.currentTool === 'recolor' ? '#1A1A1A' : '#D9D9D9',
                        border: tools.currentTool === 'recolor' ? '2px solid #1A1A1A' : '2px solid #D9D9D9'
                      }}
                      className="flex items-center justify-center"
                    >
                      □
                    </div>
                  )}
                  <span
                    style={{
                      fontSize: '12px',
                      lineHeight: `${BRUSH_TEXT_LINE_HEIGHT}px`,
                      color: tools.currentTool === 'recolor' ? '#1A1A1A' : '#D9D9D9'
                    }}
                    className={tools.currentTool === 'recolor' ? '' : 'transition-colors group-hover:text-[#F3F3F7]'}
                  >
                    Color cycle + recolor
                  </span>
                </div>
              </div>
            )}
          </React.Fragment>
        );
        })}
      </div>
    </div>
  );
};

export default BrushLibrary;
