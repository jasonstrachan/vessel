'use client';

import React, { useState, useCallback, memo, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer, BrushShape, type LayerAlignmentSettings, type ExportContainerLayout } from '../types';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { ThrottledColorAnalyzer, ColorSwatch } from '../utils/colorAnalyzer';
import { setColorCycleAnimationState } from './toolbar/BrushControls';
import { RecolorManager } from '../lib/colorCycle/RecolorManager';
import { recordBreadcrumb } from '../utils/debug';
// Removed floating color cycle panel integration; panel now lives in Brush Settings

// Component to display color swatches for a layer
const LayerColorSwatches = memo<{ 
  layer: Layer;
  visible: boolean;
}>(({ layer, visible }) => {
  const [swatches, setSwatches] = useState<ColorSwatch[]>([]);
  const analyzerRef = useRef<ThrottledColorAnalyzer | undefined>(undefined);
  
  useEffect(() => {
    // Create analyzer on mount
    analyzerRef.current = new ThrottledColorAnalyzer();
    
    return () => {
      // Cleanup on unmount
      analyzerRef.current?.dispose();
    };
  }, []);
  
  useEffect(() => {
    // Analyze colors when layer changes (watch version for content updates)
    if (layer.framebuffer && analyzerRef.current) {
      analyzerRef.current.analyze(
        layer.framebuffer,
        (newSwatches) => setSwatches(newSwatches),
        6 // Show top 6 colors
      );
    }
  }, [layer.framebuffer, layer.id, layer.version]);
  
  if (swatches.length === 0) {
    return (
      <div 
        className="flex-1 h-4 rounded mr-1"
        style={{
          backgroundColor: '#444',
          minWidth: '30px',
          opacity: visible ? 1 : 0.5
        }}
        title={layer.name}
      />
    );
  }
  
  // Create a gradient-like display from the color swatches
  const gradientStops = swatches
    .map((swatch, idx) => {
      const start = (idx / swatches.length) * 100;
      const end = ((idx + 1) / swatches.length) * 100;
      return `${swatch.color} ${start}%, ${swatch.color} ${end}%`;
    })
    .join(', ');
  
  return (
    <div 
      className="flex-1 h-4 rounded mr-1"
      style={{
        background: `linear-gradient(90deg, ${gradientStops})`,
        minWidth: '30px',
        opacity: visible ? 1 : 0.5
      }}
      title={layer.name}
    />
  );
});

LayerColorSwatches.displayName = 'LayerColorSwatches';

const fitOptions: Array<{ value: LayerAlignmentSettings['fit']; label: string }> = [
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'fill', label: 'Fill' },
  { value: 'fit-width', label: 'Fit Width' },
  { value: 'fit-height', label: 'Fit Height' },
  { value: 'scale-down', label: 'Scale Down' },
  { value: 'none', label: 'None' }
];

const axisOptions: Array<{ value: LayerAlignmentSettings['horizontal']; label: string }> = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' }
];

const flowOptions: Array<{ value: ExportContainerLayout['flow']; label: string; short: string }> = [
  { value: 'row', label: 'Row', short: '→' },
  { value: 'row-reverse', label: 'Row Reverse', short: '←' },
  { value: 'column', label: 'Column', short: '↓' },
  { value: 'column-reverse', label: 'Column Reverse', short: '↑' }
];

const justifyOptions: Array<{ value: ExportContainerLayout['justify']; label: string }> = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'space-between', label: 'Space Between' },
  { value: 'space-around', label: 'Space Around' }
];

const alignOptions: Array<{ value: ExportContainerLayout['align']; label: string }> = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Stretch' }
];

export const LayerAlignmentControls = memo(() => {
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const alignment = useAppStore(state => {
    if (!state.activeLayerId) {
      return null;
    }
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.alignment ?? null;
  });
  const updateLayerAlignment = useAppStore(state => state.updateLayerAlignment);

  const disabled = !alignment || !activeLayerId;
  const offset = alignment?.offsetPx ?? { x: 0, y: 0 };

  const handleAlignmentChange = useCallback(
    (partial: Partial<LayerAlignmentSettings>) => {
      if (!alignment || !activeLayerId) {
        return;
      }
      const baseOffset = alignment.offsetPx ?? { x: 0, y: 0 };
      updateLayerAlignment(activeLayerId, {
        ...alignment,
        ...partial,
        offsetPx: partial.offsetPx ? { ...partial.offsetPx } : baseOffset
      });
    },
    [alignment, activeLayerId, updateLayerAlignment]
  );

  const handleOffsetChange = useCallback(
    (axis: 'x' | 'y', raw: number) => {
      if (!alignment || !activeLayerId) {
        return;
      }
      const baseOffset = alignment.offsetPx ?? { x: 0, y: 0 };
      const value = Number.isFinite(raw) ? raw : 0;
      updateLayerAlignment(activeLayerId, {
        ...alignment,
        offsetPx: { ...baseOffset, [axis]: value }
      });
    },
    [alignment, activeLayerId, updateLayerAlignment]
  );

  return (
    <div className="border-b border-[#424242] p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-[#D9D9D9]">Layer alignment</span>
        {!alignment && <span className="text-[9px] text-[#808080]">Select a layer</span>}
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-[9px] text-[#A5A5A5] block mb-1">Fit</label>
          <select
            className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF] disabled:text-[#666] disabled:bg-[#2C2C2C]"
            value={alignment?.fit ?? 'contain'}
            onChange={(event) => handleAlignmentChange({ fit: event.target.value as LayerAlignmentSettings['fit'] })}
            disabled={disabled}
          >
            {fitOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="text-[9px] text-[#A5A5A5] block mb-1">Horizontal</span>
          <div className="flex gap-1">
            {axisOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleAlignmentChange({ horizontal: option.value })}
                disabled={disabled}
                className={`flex-1 py-1 text-[9px] rounded transition-colors ${alignment?.horizontal === option.value ? 'bg-[#6F6FFF] text-white' : 'bg-[#2F2F2F] text-[#D9D9D9] hover:bg-[#3A3A3A]'} ${disabled ? '!bg-[#2C2C2C] !text-[#666]' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-[9px] text-[#A5A5A5] block mb-1">Vertical</span>
          <div className="flex gap-1">
            {axisOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleAlignmentChange({ vertical: option.value })}
                disabled={disabled}
                className={`flex-1 py-1 text-[9px] rounded transition-colors ${alignment?.vertical === option.value ? 'bg-[#6F6FFF] text-white' : 'bg-[#2F2F2F] text-[#D9D9D9] hover:bg-[#3A3A3A]'} ${disabled ? '!bg-[#2C2C2C] !text-[#666]' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
            Offset X
            <input
              type="number"
              className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF] disabled:text-[#666] disabled:bg-[#2C2C2C]"
              value={alignment ? offset.x : 0}
              onChange={(event) => handleOffsetChange('x', Number(event.target.value))}
              disabled={disabled}
            />
          </label>
          <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
            Offset Y
            <input
              type="number"
              className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF] disabled:text-[#666] disabled:bg-[#2C2C2C]"
              value={alignment ? offset.y : 0}
              onChange={(event) => handleOffsetChange('y', Number(event.target.value))}
              disabled={disabled}
            />
          </label>
        </div>
      </div>
    </div>
  );
});

LayerAlignmentControls.displayName = 'LayerAlignmentControls';

export const ContainerLayoutControls = memo(() => {
  const exportLayoutFromStore = useAppStore(state => state.project?.exportLayout);
  const layout = useMemo(
    () => exportLayoutFromStore ?? createDefaultExportLayout(),
    [exportLayoutFromStore]
  );
  const setExportLayout = useAppStore(state => state.setExportLayout);

  const handleLayoutChange = useCallback(
    (partial: Partial<ExportContainerLayout>) => {
      const next: ExportContainerLayout = {
        ...layout,
        ...partial,
        padding: partial.padding ? { ...partial.padding } : { ...layout.padding }
      };
      setExportLayout(next);
    },
    [layout, setExportLayout]
  );

  const handlePaddingChange = useCallback(
    (side: keyof ExportContainerLayout['padding'], raw: number) => {
      const value = Number.isFinite(raw) ? raw : 0;
      handleLayoutChange({
        padding: {
          ...layout.padding,
          [side]: value
        }
      });
    },
    [handleLayoutChange, layout.padding]
  );

  const handleDimensionChange = useCallback(
    (dimension: 'width' | 'height', raw: string) => {
      if (layout.sizeMode !== 'fixed') {
        return;
      }
      if (raw === '') {
        handleLayoutChange({ [dimension]: undefined } as Partial<ExportContainerLayout>);
        return;
      }
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        handleLayoutChange({ [dimension]: Math.max(0, numeric) } as Partial<ExportContainerLayout>);
      }
    },
    [handleLayoutChange, layout.sizeMode]
  );

  return (
    <div className="border-b border-[#424242] p-2">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-[#D9D9D9] block mb-2">Container layout</span>

      <div className="space-y-2">
        <div>
          <span className="text-[9px] text-[#A5A5A5] block mb-1">Flow</span>
          <div className="grid grid-cols-4 gap-1">
            {flowOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleLayoutChange({ flow: option.value })}
                className={`py-1 text-[9px] rounded transition-colors ${layout.flow === option.value ? 'bg-[#6F6FFF] text-white' : 'bg-[#2F2F2F] text-[#D9D9D9] hover:bg-[#3A3A3A]'}`}
              >
                <span className="block leading-none">{option.short}</span>
                <span className="block text-[8px] mt-0.5 opacity-80">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
            Justify
            <select
              className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
              value={layout.justify}
              onChange={(event) => handleLayoutChange({ justify: event.target.value as ExportContainerLayout['justify'] })}
            >
              {justifyOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
            Align
            <select
              className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
              value={layout.align}
              onChange={(event) => handleLayoutChange({ align: event.target.value as ExportContainerLayout['align'] })}
            >
              {alignOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-[auto,1fr] gap-2 items-center">
          <span className="text-[9px] text-[#A5A5A5]">Wrap</span>
          <button
            type="button"
            onClick={() => handleLayoutChange({ wrap: !layout.wrap })}
            className={`py-1 text-[9px] rounded transition-colors ${layout.wrap ? 'bg-[#6F6FFF] text-white' : 'bg-[#2F2F2F] text-[#D9D9D9] hover:bg-[#3A3A3A]'}`}
          >
            {layout.wrap ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div className="grid grid-cols-[auto,1fr] gap-2 items-center">
          <span className="text-[9px] text-[#A5A5A5]">Gap</span>
          <input
            type="number"
            min={0}
            className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
            value={layout.gap}
            onChange={(event) => handleLayoutChange({ gap: Math.max(0, Number(event.target.value) || 0) })}
          />
        </div>

        <div>
          <span className="text-[9px] text-[#A5A5A5] block mb-1">Padding</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
              Top
              <input
                type="number"
                className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
                value={layout.padding.top}
                onChange={(event) => handlePaddingChange('top', Number(event.target.value))}
              />
            </label>
            <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
              Right
              <input
                type="number"
                className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
                value={layout.padding.right}
                onChange={(event) => handlePaddingChange('right', Number(event.target.value))}
              />
            </label>
            <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
              Bottom
              <input
                type="number"
                className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
                value={layout.padding.bottom}
                onChange={(event) => handlePaddingChange('bottom', Number(event.target.value))}
              />
            </label>
            <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
              Left
              <input
                type="number"
                className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF]"
                value={layout.padding.left}
                onChange={(event) => handlePaddingChange('left', Number(event.target.value))}
              />
            </label>
          </div>
        </div>

        <div>
          <span className="text-[9px] text-[#A5A5A5] block mb-1">Size Mode</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => handleLayoutChange({ sizeMode: 'hug', width: undefined, height: undefined })}
              className={`flex-1 py-1 text-[9px] rounded transition-colors ${layout.sizeMode === 'hug' ? 'bg-[#6F6FFF] text-white' : 'bg-[#2F2F2F] text-[#D9D9D9] hover:bg-[#3A3A3A]'}`}
            >
              Hug Content
            </button>
            <button
              type="button"
              onClick={() => handleLayoutChange({ sizeMode: 'fixed', width: layout.width ?? layout.padding.left + layout.padding.right, height: layout.height ?? layout.padding.top + layout.padding.bottom })}
              className={`flex-1 py-1 text-[9px] rounded transition-colors ${layout.sizeMode === 'fixed' ? 'bg-[#6F6FFF] text-white' : 'bg-[#2F2F2F] text-[#D9D9D9] hover:bg-[#3A3A3A]'}`}
            >
              Fixed
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
            Width
            <input
              type="number"
              className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF] disabled:text-[#666] disabled:bg-[#2C2C2C]"
              value={layout.width ?? ''}
              onChange={(event) => handleDimensionChange('width', event.target.value)}
              disabled={layout.sizeMode !== 'fixed'}
            />
          </label>
          <label className="text-[9px] text-[#A5A5A5] flex flex-col gap-1">
            Height
            <input
              type="number"
              className="w-full bg-[#353535] text-[#E5E5E5] text-[10px] px-2 py-1 rounded outline-none focus:ring-1 focus:ring-[#6F6FFF] disabled:text-[#666] disabled:bg-[#2C2C2C]"
              value={layout.height ?? ''}
              onChange={(event) => handleDimensionChange('height', event.target.value)}
              disabled={layout.sizeMode !== 'fixed'}
            />
          </label>
        </div>
      </div>
    </div>
  );
});

ContainerLayoutControls.displayName = 'ContainerLayoutControls';

// Memoized layer item component to prevent unnecessary re-renders
const LayerItem = memo<{
  layer: Layer;
  isActive: boolean;
  isDragOver: boolean;
  onToggleVisibility: (e: React.MouseEvent, layerId: string) => void;
  onClick: (layerId: string) => void;
  onDragStart: (e: React.DragEvent, layerId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, layerId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, layerId: string) => void;
  generateGradientCSS: (gradient: Array<{ position: number; color: string }> | undefined) => string;
}>(({
  layer,
  isActive,
  isDragOver,
  onToggleVisibility,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  generateGradientCSS
}) => {
  return (
    <div
      className={`
        relative group cursor-move select-none
        ${isActive ? 'bg-[#4A4A4A]' : 'hover:bg-[#353535]'}
        ${isDragOver ? 'border-t-2 border-blue-400' : ''}
        transition-all duration-150
      `}
      draggable
      onClick={() => onClick(layer.id)}
      onDragStart={(e) => onDragStart(e, layer.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, layer.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, layer.id)}
    >
      <div className="flex items-center h-7 px-2">
        {/* Visibility Toggle */}
        <button
          onClick={(e) => onToggleVisibility(e, layer.id)}
          className={`
            w-4 h-4 mr-2 flex items-center justify-center
            ${layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'}
            hover:text-white
          `}
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        
        {/* Display gradient for CC layers or color swatches for normal layers */}
        {(() => {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.gradient) {
            return (
              <div 
                className="flex-1 h-4 rounded mr-1"
                style={{
                  background: generateGradientCSS(layer.colorCycleData.gradient),
                  minWidth: '30px',
                  opacity: layer.visible ? 1 : 0.5
                }}
                title={layer.name}
              />
            );
          } else if (layer.layerType === 'normal') {
            return <LayerColorSwatches layer={layer} visible={layer.visible} />;
          } else {
            return (
              <span className="text-[#D9D9D9] text-xs flex-1 truncate">
                {layer.name}
              </span>
            );
          }
        })()}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function - only re-render if relevant props change
  const shouldSkipRender = (
    prevProps.layer.id === nextProps.layer.id &&
    prevProps.layer.name === nextProps.layer.name &&
    prevProps.layer.visible === nextProps.layer.visible &&
    prevProps.layer.layerType === nextProps.layer.layerType &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isDragOver === nextProps.isDragOver &&
    // Deep check for color cycle data
    JSON.stringify(prevProps.layer.colorCycleData?.gradient) === JSON.stringify(nextProps.layer.colorCycleData?.gradient)
  );
  
  
  return shouldSkipRender;
});

LayerItem.displayName = 'LayerItem';

const MinimalLayerList = () => {
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [dragOverBottom, setDragOverBottom] = useState<boolean>(false);
  // Derived animation state
  const brushAnimating = useAppStore(state => state.layers.some(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor' && !!l.colorCycleData?.isAnimating));
  const [externalIsPlaying, setExternalIsPlaying] = useState(false);
  const isAnimating = brushAnimating || externalIsPlaying;

  // Keep local play/pause UI in sync with unified animation state
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ isPlaying: boolean }>;
        if (typeof ce.detail?.isPlaying === 'boolean') {
          setExternalIsPlaying(ce.detail.isPlaying);
        }
      } catch {}
    };
    window.addEventListener('colorCycleAnimationState', handler as EventListener);
    return () => {
      window.removeEventListener('colorCycleAnimationState', handler as EventListener);
    };
  }, []);
  
  // Store subscriptions
  const layers = useAppStore(state => state.layers);
  const activeLayerId = useAppStore(state => state.activeLayerId);
  // Actions
  const addLayer = useAppStore(state => state.addLayer);
  const updateLayer = useAppStore(state => state.updateLayer);
  const setActiveLayer = useAppStore(state => state.setActiveLayer);
  const reorderLayers = useAppStore(state => state.reorderLayers);
  
  // Remove local overrides; animation state comes from store + unified event
  
  // Generate gradient CSS for preview
  // Memoize gradient CSS generation to prevent recalculation on every render
  const generateGradientCSS = useCallback((gradient: Array<{ position: number; color: string }> | undefined) => {
    if (!gradient || gradient.length === 0) {
      return 'linear-gradient(90deg, #888 0%, #888 100%)';
    }
    const stops = gradient
      .map(stop => `${stop.color} ${stop.position * 100}%`)
      .join(', ');
    const css = `linear-gradient(90deg, ${stops})`;
    return css;
  }, []);
  
  const handleAddCCLayer = () => {
    // Unconditional trace to verify handler fires even when TB_DEBUG isn't set
    // quiet
    recordBreadcrumb('layers', { event: 'ui-add-cc-click', count: layers.length, activeLayerId });
    // quiet
    // Helper to create a framebuffer that works across browsers
    const makeFramebuffer = (): OffscreenCanvas | HTMLCanvasElement => {
      // Allocate tiny placeholder; resize lazily on first capture
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas;
    };
    
    // Get current gradient from brush settings or use default rainbow
    const currentGradient = useAppStore.getState().tools.brushSettings.colorCycleGradient || [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
    
    // Create a color-cycle layer
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `CC Layer ${layers.filter(l => l.layerType === 'color-cycle').length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: makeFramebuffer(),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle', // Color-cycle layer - cannot be converted to normal
      colorCycleData: {
        gradient: currentGradient,
        isAnimating: true,
        // Initialize per-layer brush speed from current brush setting
        brushSpeed: (useAppStore.getState().tools?.brushSettings?.colorCycleSpeed) || 0.1
      }
    };
    // quiet

    const newLayerId = addLayer(newLayer);
    // quiet
    
    
    // Auto-select the new layer
    if (newLayerId) {
      
      // Initialize the color cycle brush for this layer BEFORE setting active
      const state = useAppStore.getState();
      if (state.project) {
        state.initColorCycleForLayer(newLayerId, state.project.width, state.project.height);
      }
      
      // Set as active layer (this will also sync the gradient to brush settings)
      setActiveLayer(newLayerId);
      // quiet
      
      // IMPORTANT: Switch to CC brush mode when creating a CC layer
      // This ensures users can immediately draw on the new CC layer
      const updatedState = useAppStore.getState();
      updatedState.setBrushSettings({ brushShape: BrushShape.COLOR_CYCLE });
      // quiet
    }
    // quiet
  };
  
  const handleAddRegularLayer = () => {
    // Unconditional trace to verify handler fires even when TB_DEBUG isn't set
    // quiet
    recordBreadcrumb('layers', { event: 'ui-add-regular-click', count: layers.length, activeLayerId });
    // quiet
    const makeFramebuffer = (): OffscreenCanvas | HTMLCanvasElement => {
      // Allocate tiny placeholder; resize lazily on first capture
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas;
    };
    
    // Create a regular layer
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: makeFramebuffer(),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal' // Regular layer - cannot be converted to CC
    };
    // quiet
    // Execute synchronously to avoid race conditions with CC layers
    // Fetch fresh state before mutating
    // quiet
    const newLayerId = addLayer(newLayer);
    // quiet

    // Auto-select the new layer
    if (newLayerId) {
      // Use fresh state to avoid stale closures during fast interactions
      const freshState = useAppStore.getState();
      // quiet
      try {
        freshState.setActiveLayer(newLayerId);
        // quiet
      } catch {
        // quiet
      }
      
      // IMPORTANT: If CC brush is selected, switch to a regular brush
      // This ensures users can immediately draw on the new regular layer
      try {
        const finalState = useAppStore.getState();
        if (finalState.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE) {
          finalState.setBrushSettings({ brushShape: BrushShape.ROUND });
          // quiet
        }
      } catch {
        // As a last resort, force a safe brush shape
        try { useAppStore.getState().setBrushSettings({ brushShape: BrushShape.ROUND }); } catch {}
      }
    }
    // quiet
  };
  
  const handleToggleVisibility = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { visible: !layer.visible });
    }
  };
  
  // Handle drag start
  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
    
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };
  
  const handleDragEnd = (e: React.DragEvent) => {
    // Reset opacity
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragOverLayerId(null);
  };
  
  const handleDragOver = (e: React.DragEvent, layerId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverLayerId(layerId);
    if (dragOverBottom) setDragOverBottom(false);
  };
  
  const handleDragLeave = () => {
    setDragOverLayerId(null);
    setDragOverBottom(false);
  };
  
  const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    
    if (draggedId && draggedId !== targetLayerId) {
      const reversedLayers = layers.slice().reverse();
      const draggedIndex = reversedLayers.findIndex(l => l.id === draggedId);
      const targetIndex = reversedLayers.findIndex(l => l.id === targetLayerId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const originalDraggedIndex = layers.length - 1 - draggedIndex;
        const originalTargetIndex = layers.length - 1 - targetIndex;
        reorderLayers(originalDraggedIndex, originalTargetIndex);
      }
    }
    
    setDragOverLayerId(null);
    setDragOverBottom(false);
  };

  // Bottom drop zone handlers (drop at very bottom of stack)
  const handleDragOverBottom = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverBottom(true);
    if (dragOverLayerId) setDragOverLayerId(null);
  };

  const handleDropBottom = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId) {
      const originalDraggedIndex = layers.findIndex(l => l.id === draggedId);
      if (originalDraggedIndex !== -1) {
        // Destination index 0 = absolute bottom of stack
        reorderLayers(originalDraggedIndex, 0);
      }
    }
    setDragOverBottom(false);
    setDragOverLayerId(null);
  };
  
  const handleLayerClick = (layerId: string) => {
    setActiveLayer(layerId);
  };
  
  
  return (
    <div className="absolute right-0 top-0 h-full w-[240px] bg-[#2C2C2C] border-l border-r border-[#424242] z-30 flex flex-col">
      {/* Add Layer Buttons at the top */}
      <div className="border-b border-[#424242] bg-[#2C2C2C] flex">
        <button
          onClick={handleAddRegularLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors border-r border-[#424242]"
          title="Add Regular Layer"
        >
          <Plus size={16} className="text-[#D9D9D9]" />
          <span className="ml-1 text-[11px] text-[#D9D9D9]">Regular</span>
        </button>
        <button
          onClick={handleAddCCLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors"
          title="Add Color Cycle Layer"
        >
          <Plus size={16} className="text-[#D9D9D9]" />
          <span className="ml-1 text-[11px] text-[#D9D9D9]">CC</span>
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto" key={`${layers.length}-${layers.map(l => `${l.id}-${l.layerType}-${!!l.colorCycleData}`).join(',')}`}>
        <div className="py-1">
          {layers.slice().reverse().map((layer) => {
            
            return (
              <div
                key={layer.id}
                className={`
                  relative group cursor-move select-none
                  ${activeLayerId === layer.id ? 'bg-[#4A4A4A]' : 'hover:bg-[#353535]'}
                  ${dragOverLayerId === layer.id ? 'border-t-2 border-blue-400' : ''}
                  transition-all duration-150
                `}
                draggable
                onClick={() => handleLayerClick(layer.id)}
                onDragStart={(e) => handleDragStart(e, layer.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, layer.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, layer.id)}
              >
                <div className="flex items-center h-7 px-2">
                  {/* Visibility Toggle */}
                  <button
                    onClick={(e) => handleToggleVisibility(e, layer.id)}
                    className={`
                      w-4 h-4 mr-2 flex items-center justify-center
                      ${layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'}
                      hover:text-white
                    `}
                  >
                    {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  
                  {/* Display gradient for CC layers (brush or recolor) or color swatches for normal layers */}
                  {(() => {
                    if (layer.layerType === 'color-cycle') {
                      const ccGradient = layer.colorCycleData?.gradient || layer.colorCycleData?.recolorSettings?.gradient;
                      if (ccGradient && ccGradient.length > 0) {
                        return (
                          <div 
                            className="flex-1 h-4 rounded mr-1" 
                            style={{
                              background: generateGradientCSS(ccGradient),
                              minWidth: '30px',
                              opacity: layer.visible ? 1 : 0.5
                            }}
                            title={`${layer.name} - ${ccGradient.length} stops`}
                          />
                        );
                      }
                      // No gradient available yet; show a neutral bar
                      return (
                        <div 
                          className="flex-1 h-4 rounded mr-1"
                          style={{
                            background: '#555',
                            minWidth: '30px',
                            opacity: layer.visible ? 1 : 0.5
                          }}
                          title={layer.name}
                        />
                      );
                    } else if (layer.layerType === 'normal') {
                      return <LayerColorSwatches layer={layer} visible={layer.visible} />;
                    } else {
                      return (
                        <span className="text-[#D9D9D9] text-xs flex-1 truncate">
                          {layer.name}
                        </span>
                      );
                    }
                  })()}

                  {/* CC badges */}
                  {layer.layerType === 'color-cycle' && (
                    <div className="ml-1 flex items-center gap-1">
                      <span className="px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]">CC</span>
                      {layer.colorCycleData?.mode === 'recolor' ? (
                        <span className="px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]">Recolor</span>
                      ) : (
                        <span className="px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]">Brush</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Bottom drop sentinel: allows dropping below the last item */}
          <div
            className={`h-3 ${dragOverBottom ? 'border-t-2 border-blue-400' : ''}`}
            onDragOver={handleDragOverBottom}
            onDragLeave={() => setDragOverBottom(false)}
            onDrop={handleDropBottom}
          />
        </div>
      </div>
      
      <div className="border-t border-[#424242]">
        <LayerAlignmentControls />
        <ContainerLayoutControls />

        {/* Bottom Controls: Play/Pause for Color Cycle animation only */}
        <div className="border-t border-[#424242] p-2">
          <button
            onClick={async () => {
            const newIsAnimating = !isAnimating;

            // Brush-based color cycle (stroke/shape)
            try {
              setColorCycleAnimationState(newIsAnimating);
              const handlers = window.colorCycleAnimationHandlers;
              if (handlers) {
                if (newIsAnimating) handlers.startContinuousColorCycleAnimation();
                else handlers.stopContinuousColorCycleAnimation();
              }
            } catch {}

            // Recolor & animate layers (use pause/resume to avoid resetting state)
            try {
              const rm = RecolorManager.getInstance();
              const state = useAppStore.getState();
              if (newIsAnimating) {
                const recolorLayers = state.layers.filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode === 'recolor');
                await Promise.all(recolorLayers.map(l => rm.registerExistingLayer(l)));
              }
              if (newIsAnimating) {
                rm.playAll();
              } else {
                rm.pause();
              }
            } catch {}

            // Update store flags for ALL brush-based CC layers so render loop respects Pause/Play globally
            try {
              const st = useAppStore.getState();
              st.layers
                .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor')
                .forEach(l => {
                  const colorCycleData: Layer['colorCycleData'] = {
                    ...(l.colorCycleData ?? {}),
                    isAnimating: newIsAnimating
                  };
                  st.updateLayer(l.id, { colorCycleData });
                });
            } catch {}
            }}
            className="w-full h-10 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
          >
            <span className="text-[10px] mr-1">{isAnimating ? '⏸' : '▶'}</span>
            <span className="text-[10px]">{isAnimating ? 'Pause' : 'Play'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(MinimalLayerList);
