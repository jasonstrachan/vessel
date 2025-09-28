'use client';

import React, { useState, useCallback, memo, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer, BrushShape, type LayerAlignmentSettings } from '../types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { Eye, EyeOff, Plus, ChevronRight, X } from 'lucide-react';
import ProgressSlider from './ui/ProgressSlider';
import { ThrottledColorAnalyzer, ColorSwatch } from '../utils/colorAnalyzer';
import { toggleGlobalColorCyclePlayback } from '@/utils/colorCyclePlayback';
import { recordBreadcrumb } from '../utils/debug';
// Removed floating color cycle panel integration; panel now lives in Brush Settings

export const LAYER_TAG_CLASS = 'px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]';
export const LayerColorSwatches = memo<{ 
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

type AnchorKey = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
type AnchorSelection = AnchorKey | 'auto';

const ANCHOR_CONFIG: Record<AnchorKey, {
  horizontal: LayerAlignmentSettings['horizontal'];
  vertical: LayerAlignmentSettings['vertical'];
}> = {
  tl: { horizontal: 'left', vertical: 'top' },
  tc: { horizontal: 'center', vertical: 'top' },
  tr: { horizontal: 'right', vertical: 'top' },
  ml: { horizontal: 'left', vertical: 'center' },
  mc: { horizontal: 'center', vertical: 'center' },
  mr: { horizontal: 'right', vertical: 'center' },
  bl: { horizontal: 'left', vertical: 'bottom' },
  bc: { horizontal: 'center', vertical: 'bottom' },
  br: { horizontal: 'right', vertical: 'bottom' }
};

const ANCHOR_GRID: AnchorKey[][] = [
  ['tl', 'tc', 'tr'],
  ['ml', 'mc', 'mr'],
  ['bl', 'bc', 'br']
];

const ANCHOR_SUMMARY: Record<AnchorSelection, string> = {
  tl: 'Top Left',
  tc: 'Top Center',
  tr: 'Top Right',
  ml: 'Middle Left',
  mc: 'Middle Center',
  mr: 'Middle Right',
  bl: 'Bottom Left',
  bc: 'Bottom Center',
  br: 'Bottom Right',
  auto: 'Auto'
};

const anchorButtonBase = [
  'h-7 border transition-colors',
  'flex items-center justify-center'
].join(' ');

const anchorActiveClass = 'border-[#3D3D46] bg-[#5A5A68]';
const anchorInactiveClass = 'border-[#3D3D46] bg-transparent hover:bg-[#5A5A68]';

const fitOptions: Array<{ value: Exclude<LayerAlignmentSettings['fit'], 'percent' | 'fit-width' | 'fit-height'>; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'fill', label: 'Fill' },
  { value: 'scale-down', label: 'Scale Down' }
];

const fitButtonBase = [
  'w-full flex items-center gap-2.5',
  'px-1.5 py-1 text-sm transition-colors text-left'
].join(' ');

const fitButtonActive = 'text-[#F3F3F7] font-semibold';
const fitButtonInactive = 'text-[#D9D9E8] hover:text-white';

const resolveAnchorSelection = (alignment: LayerAlignmentSettings | null): AnchorSelection => {
  if (!alignment) {
    return 'auto';
  }

  if (alignment.positioning === 'auto') {
    return 'auto';
  }

  const match = (Object.entries(ANCHOR_CONFIG) as Array<[AnchorKey, (typeof ANCHOR_CONFIG)[AnchorKey]]>)
    .find(([, config]) => config.horizontal === alignment.horizontal && config.vertical === alignment.vertical);

  return match ? match[0] : 'mc';
};

type ControlDensity = 'compact' | 'comfortable';

interface DensityProps {
  density?: ControlDensity;
  className?: string;
}

interface LayerAlignmentControlsProps extends DensityProps {
  appearance?: 'panel' | 'plain';
  defaultExpanded?: boolean;
}

export const LayerAlignmentControls = memo<LayerAlignmentControlsProps>(({ density = 'compact', className = '', defaultExpanded = true }) => {
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const activeLayer = useAppStore(state => state.layers.find(l => l.id === activeLayerId) ?? null);
  const selectedLayerIds = useAppStore(state => state.selectedLayerIds);
  const alignment = activeLayer?.alignment ?? null;
  const project = useAppStore(state => state.project);
  const updateLayerAlignment = useAppStore(state => state.updateLayerAlignment);

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const disabled = !alignment || !activeLayerId;
  const offset = alignment?.offsetPx ?? { x: 0, y: 0 };

  const derivedPercent = useMemo(() => {
    if (!alignment) {
      return { x: 0, y: 0 };
    }

    if (activeLayer && project) {
      try {
        return computeLayerPercentOffset(activeLayer, project);
      } catch (error) {
        console.warn('[LayerAlignmentControls] Failed to compute percent offset', error);
      }
    }

    if (alignment.offsetPercent) {
      return alignment.offsetPercent;
    }

    return { x: 0, y: 0 };
  }, [alignment, activeLayer, project]);

  const selectedAnchor = resolveAnchorSelection(alignment);
  const isAuto = alignment?.positioning === 'auto';
  const effectiveFit: LayerAlignmentSettings['fit'] = alignment?.fit ?? 'contain';

  const isComfortable = density === 'comfortable';

  const paddingClasses = isComfortable ? 'px-1 py-2' : 'px-1 py-1';
  const rootClasses = [paddingClasses, className].filter(Boolean).join(' ').trim();

  const titleClass = 'text-sm font-medium text-[#F1F1F6]';

  const helperClass = 'text-sm text-[#8F8FA3]';

  const summaryText = (() => {
    if (!alignment) {
      return 'Select a layer to configure';
    }
    if (isAuto) {
      const fitLabel = fitOptions.find(option => option.value === alignment.fit)?.label ?? alignment.fit;
      return `Auto • ${fitLabel} • Left ${Math.round(derivedPercent.x)}% / Top ${Math.round(derivedPercent.y)}%`;
    }
    const fitLabel = fitOptions.find(option => option.value === alignment.fit)?.label ?? alignment.fit;
    return `${fitLabel} • ${ANCHOR_SUMMARY[selectedAnchor]}`;
  })();

  const labelClass = 'text-sm font-medium text-[#D3D3DC]';

  const fieldClass = [
    'w-full rounded-none border border-[#4A4A4A] bg-[#4A4A4A] text-[#F3F3F7] placeholder:text-[#C6C6D0]',
    'transition-colors focus:border-[#A5A5BA] focus:outline-none focus:ring-0',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'h-7 px-2 text-sm'
  ].join(' ');

  const contentSpacingClass = 'px-2';

  const offsetDisabled = disabled || isAuto;

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const handleAlignmentChange = useCallback(
    (partial: Partial<LayerAlignmentSettings>) => {
      if (!alignment || !activeLayerId) {
        return;
      }
      const baseOffset = alignment.offsetPx ?? { x: 0, y: 0 };
      const basePercent = alignment.offsetPercent ?? { x: 0, y: 0 };

      const nextFit = partial.fit ?? alignment.fit;
      const nextPositioning = partial.positioning ?? alignment.positioning;

      const nextAlignment: LayerAlignmentSettings = {
        ...alignment,
        ...partial,
        fit: nextFit,
        positioning: nextPositioning,
        offsetPx: partial.offsetPx ? { ...partial.offsetPx } : baseOffset,
        offsetPercent: nextPositioning === 'auto' || nextFit === 'percent'
          ? { ...(partial.offsetPercent ?? basePercent) }
          : undefined
      };

      const targetLayerIds = selectedLayerIds.length > 1 && selectedLayerIds.includes(activeLayerId)
        ? selectedLayerIds
        : [activeLayerId];

      targetLayerIds.forEach((layerId) => {
        updateLayerAlignment(layerId, nextAlignment);
      });
    },
    [alignment, activeLayerId, selectedLayerIds, updateLayerAlignment]
  );

  const handleAnchorSelect = useCallback((selection: AnchorSelection) => {
    if (!alignment || !activeLayerId) {
      return;
    }

    if (selection === 'auto') {
      let nextPercent = derivedPercent;
      if (activeLayer && project) {
        try {
          nextPercent = computeLayerPercentOffset(activeLayer, project);
        } catch (error) {
          console.warn('[LayerAlignmentControls] Failed to compute percent offset for auto mode', error);
        }
      }

      handleAlignmentChange({
        positioning: 'auto',
        offsetPercent: nextPercent
      });
      return;
    }

    const config = ANCHOR_CONFIG[selection];

    handleAlignmentChange({
      positioning: 'anchor',
      horizontal: config.horizontal,
      vertical: config.vertical,
      offsetPercent: undefined
    });
  }, [activeLayer, activeLayerId, alignment, derivedPercent, handleAlignmentChange, project]);

  const handleFitSelect = useCallback((fit: LayerAlignmentSettings['fit']) => {
    handleAlignmentChange({ fit });
  }, [handleAlignmentChange]);

  const handleOffsetChange = useCallback(
    (axis: 'x' | 'y', raw: number) => {
      if (!alignment || !activeLayerId || alignment.positioning === 'auto') {
        return;
      }
      const baseOffset = alignment.offsetPx ?? { x: 0, y: 0 };
      const value = Number.isFinite(raw) ? raw : 0;
      const targetLayerIds = selectedLayerIds.length > 1 && selectedLayerIds.includes(activeLayerId)
        ? selectedLayerIds
        : [activeLayerId];

      targetLayerIds.forEach((layerId) => {
        updateLayerAlignment(layerId, {
          ...alignment,
          offsetPx: { ...baseOffset, [axis]: value }
        });
      });
    },
    [alignment, activeLayerId, selectedLayerIds, updateLayerAlignment]
  );

  return (
    <div className={rootClasses}>
      <button
        type="button"
        className={[
          'w-full bg-transparent flex items-center justify-between text-left cursor-pointer select-none gap-2 transition-colors',
          isComfortable ? 'py-1.5' : 'py-1'
        ].filter(Boolean).join(' ')}
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <span className={titleClass}>Layer alignment</span>
          <span className={`${helperClass} ${alignment ? '' : 'text-[#A5A5BA]'}`}>
            {summaryText}
          </span>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-[#8F8FA3] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>
      {isExpanded && (
        <div className={contentSpacingClass}>
          <div>
            <span className={`${labelClass} block`}>Anchor</span>
            <div className="grid grid-cols-3 bg-[#4A4A4A]">
              {ANCHOR_GRID.map((row, rowIndex) => (
                <React.Fragment key={rowIndex}>
                  {row.map((key) => {
                    const isSelected = selectedAnchor === key;
                    const buttonClass = [
                      anchorButtonBase,
                      isSelected ? anchorActiveClass : anchorInactiveClass,
                      disabled ? 'cursor-not-allowed opacity-60' : ''
                    ].filter(Boolean).join(' ');

                    return (
                      <button
                        key={key}
                        type="button"
                        className={buttonClass}
                        onClick={() => handleAnchorSelect(key)}
                        disabled={disabled}
                      >
                        <span className={`h-1.5 w-1.5 ${isSelected ? 'bg-[#F3F3F7]' : 'bg-[#9A9AB3]'} block`} aria-hidden />
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
            <button
              type="button"
              className={[
                anchorButtonBase,
                'w-full text-[#D9D9E8] border-[#3D3D46]',
                selectedAnchor === 'auto' ? 'bg-[#5A5A68]' : 'bg-[#4A4A4A]',
                disabled ? 'cursor-not-allowed opacity-60' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => handleAnchorSelect('auto')}
              disabled={disabled}
            >
              Auto
            </button>
          </div>

          <div className="mt-2">
            <span className={`${labelClass} block`}>Fit</span>
            <div>
              {fitOptions.map(option => {
                const isSelected = effectiveFit === option.value;
                const buttonClass = [
                  fitButtonBase,
                  isSelected ? fitButtonActive : fitButtonInactive,
                  disabled ? 'cursor-not-allowed opacity-60' : ''
                ].filter(Boolean).join(' ');

                return (
                  <button
                    key={option.value}
                    type="button"
                    className={buttonClass}
                    onClick={() => handleFitSelect(option.value)}
                    disabled={disabled}
                  >
                    <span
                      className={`h-3 w-3 ${isSelected ? 'bg-[#F3F3F7]' : 'bg-[#5C5C6A]'} block`}
                      aria-hidden
                    />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2">
            <span className={`${labelClass} block`}>Offset</span>
            <div className="grid grid-cols-2 gap-2">
              <label className={`${labelClass} flex flex-col`}>
                X (px)
                <input
                  type="number"
                  className={`${fieldClass} text-center`}
                  value={alignment ? offset.x : 0}
                  onChange={(event) => handleOffsetChange('x', Number(event.target.value))}
                  disabled={offsetDisabled}
                />
              </label>
              <label className={`${labelClass} flex flex-col`}>
                Y (px)
                <input
                  type="number"
                  className={`${fieldClass} text-center`}
                  value={alignment ? offset.y : 0}
                  onChange={(event) => handleOffsetChange('y', Number(event.target.value))}
                  disabled={offsetDisabled}
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

LayerAlignmentControls.displayName = 'LayerAlignmentControls';

interface ContainerLayoutControlsProps extends DensityProps {
  appearance?: 'panel' | 'plain';
  defaultExpanded?: boolean;
}

export const ContainerLayoutControls = memo<ContainerLayoutControlsProps>(() => null);

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
          }
          return (
            <span className="text-[#D9D9D9] text-xs flex-1 truncate">
              {layer.name}
            </span>
          );
        })()}

        {layer.layerType === 'color-cycle' ? (
          <div className="ml-1 flex items-center gap-1">
            <span className={LAYER_TAG_CLASS}>CC</span>
            <span className={LAYER_TAG_CLASS}>
              {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
            </span>
          </div>
        ) : (
          <div className="ml-1 flex items-center gap-1">
            <span className={LAYER_TAG_CLASS}>Layer</span>
          </div>
        )}
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
  const selectedLayerIds = useAppStore(state => state.selectedLayerIds);
  const globalColorCycleSpeed = useAppStore(state => state.tools.brushSettings.colorCycleSpeed || 0.1);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  // Actions
  const addLayer = useAppStore(state => state.addLayer);
  const updateLayer = useAppStore(state => state.updateLayer);
  const setActiveLayer = useAppStore(state => state.setActiveLayer);
  const reorderLayers = useAppStore(state => state.reorderLayers);
  const removeLayer = useAppStore(state => state.removeLayer);
  const setSelectedLayerIds = useAppStore(state => state.setSelectedLayerIds);

  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId), [layers, activeLayerId]);
  const isCCBrushLayer = activeLayer?.layerType === 'color-cycle' && activeLayer?.colorCycleData?.mode !== 'recolor';
  const colorCycleSpeedValue = isCCBrushLayer && typeof activeLayer?.colorCycleData?.brushSpeed === 'number'
    ? activeLayer.colorCycleData.brushSpeed
    : globalColorCycleSpeed;
  const canDeleteLayer = layers.length > 1;
  
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
    const targetLayer = layers.find(l => l.id === layerId);
    if (!targetLayer) {
      return;
    }

    const shouldApplyToSelection = selectedLayerIds.includes(layerId) && selectedLayerIds.length > 1;
    const layerIdsToUpdate = shouldApplyToSelection ? selectedLayerIds : [layerId];
    const nextVisible = !targetLayer.visible;

    layerIdsToUpdate.forEach((id) => {
      const layer = layers.find(l => l.id === id);
      if (layer && layer.visible !== nextVisible) {
        updateLayer(id, { visible: nextVisible });
      }
    });
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
  
  const handleLayerClick = (event: React.MouseEvent, layerId: string) => {
    if (event.shiftKey && activeLayerId) {
      const anchorIndex = layers.findIndex(l => l.id === activeLayerId);
      const targetIndex = layers.findIndex(l => l.id === layerId);

      if (anchorIndex !== -1 && targetIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const rangeSelection = layers.slice(start, end + 1).map(layer => layer.id);

        setActiveLayer(layerId);
        setSelectedLayerIds(rangeSelection);
        return;
      }
    }

    setActiveLayer(layerId);
    setSelectedLayerIds([layerId]);
  };

  const handleRemoveLayer = (layerId: string) => {
    removeLayer(layerId);
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
            const isSelected = selectedLayerIds.includes(layer.id);
            const isActive = activeLayerId === layer.id;
            return (
              <div
                key={layer.id}
                className={`
                  relative group cursor-move select-none
                  ${isActive ? 'bg-[#4A4A4A]' : isSelected ? 'bg-[#3F3F3F]' : 'hover:bg-[#353535]'}
                  ${dragOverLayerId === layer.id ? 'border-t-2 border-blue-400' : ''}
                  transition-all duration-150
                `}
                draggable
                onClick={(event) => handleLayerClick(event, layer.id)}
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
                  {layer.layerType === 'color-cycle' ? (
                    <div className="ml-1 flex items-center gap-1">
                      <span className={LAYER_TAG_CLASS}>CC</span>
                      <span className={LAYER_TAG_CLASS}>
                        {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
                      </span>
                    </div>
                  ) : (
                    <div className="ml-1 flex items-center gap-1">
                      <span className={LAYER_TAG_CLASS}>Layer</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`
                      ml-2 flex items-center justify-center rounded p-1 text-[#8F8FA3]
                      transition-opacity duration-150
                      opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                      hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[#8F8FA3]
                      ${canDeleteLayer ? '' : 'cursor-not-allowed opacity-0'}
                    `}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canDeleteLayer) {
                        return;
                      }
                      handleRemoveLayer(layer.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    draggable={false}
                    disabled={!canDeleteLayer}
                    aria-label={`Remove ${layer.name}`}
                  >
                    <X size={12} />
                  </button>
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

        {/* Color Cycle speed slider duplicated from brush controls for quick access */}
        <div className="border-t border-[#424242] px-2 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
              speed
            </span>
            <ProgressSlider
              value={colorCycleSpeedValue}
              min={0.02}
              max={1.0}
              step={0.01}
              onChange={(value) => {
                const clampedValue = Math.max(0.02, Math.min(1.0, value));
                setBrushSettings({ colorCycleSpeed: clampedValue });

                if (isCCBrushLayer && activeLayerId && activeLayer?.colorCycleData) {
                  const targetLayerIds = selectedLayerIds.length > 1 && activeLayerId && selectedLayerIds.includes(activeLayerId)
                    ? selectedLayerIds
                    : [activeLayerId];

                  targetLayerIds.forEach((layerId) => {
                    const targetLayer = layers.find(l => l.id === layerId);
                    if (targetLayer?.layerType === 'color-cycle' && targetLayer.colorCycleData) {
                      if (targetLayer.colorCycleData.brushSpeed !== clampedValue) {
                        updateLayer(layerId, {
                          colorCycleData: {
                            ...targetLayer.colorCycleData,
                            brushSpeed: clampedValue
                          }
                        });
                      }
                    }
                  });
                }
              }}
              aria-label="Color Cycle Speed"
              className="flex-1"
            />
          </div>
        </div>

        {/* Bottom Controls: Play/Pause for Color Cycle animation only */}
        <div className="border-t border-[#424242] p-2">
          <button
            onClick={async () => {
            const newIsAnimating = !isAnimating;
            await toggleGlobalColorCyclePlayback(newIsAnimating);
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
