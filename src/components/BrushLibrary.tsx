"use client";

import React, { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset, ComponentType } from '../types';
import PlusButton from './ui/PlusButton';
import { generateBrushThumbnail } from '../utils/brushThumbnailGenerator';
import { useToolSwitcher } from '@/utils/toolSwitch';

const BRUSH_ICON_SIZE = 32;
const BRUSH_TEXT_LINE_HEIGHT = 11;

const BrushLibrary = () => {
  // FIX: Use individual selectors to avoid creating new objects on every render
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const project = useAppStore((state) => state.project);
  const tools = useAppStore((state) => state.tools);
  const brushEditor = useAppStore((state) => state.brushEditor);
  const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const switchTool = useToolSwitcher();
  const startBrushEdit = useAppStore((state) => state.startBrushEdit);
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const removeCustomBrush = useAppStore((state) => state.removeCustomBrush);
  const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);
  
  // Create combined list of brushes: regular presets + custom brushes from project
  const customBrushPresets = React.useMemo(() => {
    if (!project?.customBrushes) return [];
    
    
    return project.customBrushes.map(customBrush => ({
      id: `custom_${customBrush.id}`,
      name: customBrush.name,
      category: 'Custom',
      components: [
        {
          id: 'custom-shape-renderer',
          type: ComponentType.SHAPE_RENDERER,
          parameters: {
            shape: BrushShape.CUSTOM
          },
          priority: 40,
          enabled: true
        }
      ],
      thumbnail: customBrush.thumbnail,
      tags: ['custom', 'loaded'],
      isDefault: false,
      createdAt: new Date(customBrush.createdAt),
      modifiedAt: new Date(customBrush.createdAt),
      isCustomBrush: true,
      customBrushData: {
        imageData: customBrush.imageData,
        width: customBrush.width,
        height: customBrush.height
      }
    } as BrushPreset));
  }, [project?.customBrushes]);

  // Generate thumbnails for regular brush presets (client-side only)
  const [brushThumbnails, setBrushThumbnails] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const thumbnails: Record<string, string> = {};

    brushPresets.forEach(preset => {
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
    const combined = [...brushPresets, ...customBrushPresets];
    
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

      if (brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) {
        const triangleId = allBrushes.some((brush) => brush.id === 'color-cycle-triangle')
          ? 'color-cycle-triangle'
          : null;
        if (triangleId) {
          return triangleId;
        }
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
  
  const handlePresetClick = async (preset: BrushPreset) => {
    // Switch to Brush tool first to avoid any chance of preset
    // application being overwritten by a subsequent tool change.
    await switchTool('brush');
    // Then apply the selected preset (preserve edit mode if active)
    setBrushPreset(preset, true);
  };

  const handleEditClick = (e: React.MouseEvent, preset: BrushPreset) => {
    e.stopPropagation();
    
    if (!currentOffscreenCanvas) {
      console.error('No offscreen canvas reference available in store');
      return;
    }
    
    // For regular brushes, we need to create a temporary custom brush from the current brush state
    if (!preset.isCustomBrush) {
      // First, select the brush preset to use it as the base for editing
      setBrushPreset(preset);
      
      // Draw a sample of the brush to create a custom brush from it
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 64;
      tempCanvas.height = 64;
      const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
      
      if (ctx) {
        // Clear with transparency
        ctx.clearRect(0, 0, 64, 64);
        
        // Draw a sample brush stroke in the center
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(32, 32, 20, 0, Math.PI * 2);
        ctx.fill();
        
        // Get the image data to create a temporary custom brush
        ctx.getImageData(0, 0, 64, 64);
        
        // Start editing with this temporary brush data
        // Use the preset ID as the brush ID for editing
        startBrushEdit(preset.id, currentOffscreenCanvas);
      }
    } else {
      // For custom brushes, use the existing logic - DON'T call setBrushPreset
      const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
      const isEditingThisBrush = brushEditor.status === 'EDITING' && brushEditor.editingBrushId === customBrushId;

      if (isEditingThisBrush) {
        // Do nothing - already editing this brush
        return;
      } else {
        if (brushEditor.status === 'EDITING') {
          cancelBrushEdit(currentOffscreenCanvas);
        }
        startBrushEdit(customBrushId, currentOffscreenCanvas);
      }
    }
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
                className={`group flex items-center justify-between px-2.5 py-0 cursor-pointer transition-colors ${rowClass}`}
              >
                <div className="flex items-center gap-0.5">
                  {preset.isCustomBrush ? (
                    preset.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preset.thumbnail}
                        alt={`${preset.name} thumbnail`}
                        width={iconSizePx}
                        height={iconSizePx}
                        style={{
                          imageRendering: 'pixelated',
                          width: `${iconSizePx}px`,
                          height: `${iconSizePx}px`,
                          display: 'block',
                          flexShrink: 0,
                          filter: isActive ? 'invert(1)' : 'none'
                        }}
                      />
                    ) : (
                      renderFallbackIcon(isSpamBrush ? 'text' : 'square', isActive)
                    )
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
                    {preset.id === 'color-cycle-stroke'
                      ? 'Color Cycle Stroke'
                      : preset.id === 'color-cycle-triangle'
                        ? 'Color Cycle Triangle'
                        : preset.name}
                  </span>
                </div>
                {preset.isCustomBrush && (
                <div className="flex items-center space-x-0.5">
                    <button
                      onClick={(e) => handleEditClick(e, preset)}
                      className={`px-1.5 py-0 text-xs transition-colors opacity-60 hover:opacity-100 border rounded ${
                        isActive
                          ? 'text-[#1A1A1A] border-[#1A1A1A] hover:border-green-400 hover:text-green-600'
                          : 'text-[#D9D9D9] border-[#606060] hover:text-green-400 hover:border-green-400'
                      }`}
                      title={brushEditor.status === 'EDITING' && brushEditor.editingBrushId === (preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id) ? 'Save changes' : 'Edit brush'}
                    >
                      {brushEditor.status === 'EDITING' && brushEditor.editingBrushId === (preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id) ? 'Save' : 'Edit'}
                    </button>
                    <span className="text-[#D9D9D9] w-3 text-center" style={{ fontSize: '12px' }}>
                      {preset.isDefault ? '★' : '☆'}
                    </span>
                    {!preset.isDefault && (
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
                   )}
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
