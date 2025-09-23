'use client';

import React, { useState, useCallback, memo, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer, BrushShape, type LayerAlignmentSettings, type ExportContainerLayout } from '../types';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import { Eye, EyeOff, Plus, ChevronRight, ChevronDown } from 'lucide-react';
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

type ControlDensity = 'compact' | 'comfortable';

interface DensityProps {
  density?: ControlDensity;
  className?: string;
}

interface LayerAlignmentControlsProps extends DensityProps {
  appearance?: 'panel' | 'plain';
  defaultExpanded?: boolean;
}

export const LayerAlignmentControls = memo<LayerAlignmentControlsProps>(({ density = 'compact', className = '', appearance = 'panel', defaultExpanded = false }) => {
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const alignment = useAppStore(state => {
    if (!state.activeLayerId) {
      return null;
    }
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.alignment ?? null;
  });
  const updateLayerAlignment = useAppStore(state => state.updateLayerAlignment);

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const disabled = !alignment || !activeLayerId;
  const offset = alignment?.offsetPx ?? { x: 0, y: 0 };
  const isComfortable = density === 'comfortable';

  const paddingClasses = isComfortable ? 'px-1 py-3' : 'px-1 py-2';
  const rootClasses = [paddingClasses, className].filter(Boolean).join(' ').trim();

  const titleClass = 'text-sm font-medium text-[#F1F1F6]';

  const helperClass = 'text-sm text-[#8F8FA3]';

  const toTitleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  const summaryText = alignment
    ? `${(fitOptions.find(option => option.value === alignment.fit)?.label ?? alignment.fit)} • ${toTitleCase(alignment.horizontal)} / ${toTitleCase(alignment.vertical)}`
    : 'Select a layer to configure';

  const labelClass = 'text-sm font-medium text-[#D3D3DC]';
  const controlGapClass = 'gap-1';

  const fieldClass = [
    'w-full rounded-none border border-[#4A4A4A] bg-[#4A4A4A] text-[#F3F3F7] placeholder:text-[#C6C6D0]',
    'transition-colors focus:border-[#8E8EFF]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'h-7 px-2 text-sm'
  ].join(' ');

  const segmentedButtonBase = [
    'flex-1 rounded-none border border-[#3D3D46] transition-colors',
    'h-8 text-sm'
  ].join(' ');

  const segmentedActiveClass = 'bg-[#E6E6F2] text-[#1C1C24] border-[#E6E6F2]';
  const segmentedInactiveClass = 'bg-[#2F2F36] text-[#D9D9E8] hover:bg-[#3A3A42]';

  const contentSpacingClass = isComfortable ? 'mt-3 space-y-2' : 'mt-2 space-y-2';

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

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
            <label className={`${labelClass} block mb-2`}>Fit</label>
            <div className="relative">
              <select
                className={`${fieldClass} appearance-none pr-8`}
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
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8F8FA3]" aria-hidden />
            </div>
          </div>

          <div>
            <span className={`${labelClass} block mb-2`}>Horizontal</span>
            <div className={`flex ${controlGapClass}`}>
              {axisOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleAlignmentChange({ horizontal: option.value })}
                  disabled={disabled}
                  className={`${segmentedButtonBase} ${alignment?.horizontal === option.value ? segmentedActiveClass : segmentedInactiveClass} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={`${labelClass} block mb-2`}>Vertical</span>
            <div className={`flex ${controlGapClass}`}>
              {axisOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleAlignmentChange({ vertical: option.value })}
                  disabled={disabled}
                  className={`${segmentedButtonBase} ${alignment?.vertical === option.value ? segmentedActiveClass : segmentedInactiveClass} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={`grid grid-cols-2 ${controlGapClass}`}>
            <label className={`${labelClass} flex flex-col gap-1`}>
              Offset X
              <input
                type="number"
                className={`${fieldClass} text-center`}
                value={alignment ? offset.x : 0}
                onChange={(event) => handleOffsetChange('x', Number(event.target.value))}
                disabled={disabled}
              />
            </label>
            <label className={`${labelClass} flex flex-col gap-1`}>
              Offset Y
              <input
                type="number"
                className={`${fieldClass} text-center`}
                value={alignment ? offset.y : 0}
                onChange={(event) => handleOffsetChange('y', Number(event.target.value))}
                disabled={disabled}
              />
            </label>
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

export const ContainerLayoutControls = memo<ContainerLayoutControlsProps>(({ density = 'compact', className = '', appearance = 'panel', defaultExpanded = false }) => {
  const exportLayoutFromStore = useAppStore(state => state.project?.exportLayout);
  const layout = useMemo(
    () => exportLayoutFromStore ?? createDefaultExportLayout(),
    [exportLayoutFromStore]
  );
  const setExportLayout = useAppStore(state => state.setExportLayout);

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

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

  const paddingClasses = density === 'comfortable' ? 'px-1 py-3' : 'px-1 py-2';
  const rootClasses = [paddingClasses, className].filter(Boolean).join(' ').trim();

  const titleClass = 'text-sm font-medium text-[#F1F1F6]';

  const helperClass = 'text-sm text-[#8F8FA3]';

  const labelClass = 'text-sm font-medium text-[#D3D3DC]';
  const subLabelClass = 'text-sm text-[#A5A5BA]';
  const controlGapClass = 'gap-1';
  const contentSpacingClass = density === 'comfortable' ? 'mt-3 space-y-2' : 'mt-2 space-y-2';

  const fieldClass = [
    'w-full rounded-none border border-[#4A4A4A] bg-[#4A4A4A] text-[#F3F3F7] placeholder:text-[#C6C6D0]',
    'transition-colors focus:border-[#8E8EFF]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'h-7 px-2 text-sm'
  ].join(' ');

  const segmentedButtonBase = [
    'rounded-none border border-[#3D3D46] transition-colors',
    'h-8 text-sm'
  ].join(' ');

  const flowButtonExtraClass = 'h-10 px-3';

  const segmentedActiveClass = 'bg-[#E6E6F2] text-[#1C1C24] border-[#E6E6F2]';
  const segmentedInactiveClass = 'bg-[#2F2F36] text-[#D9D9E8] hover:bg-[#3A3A42]';

  const summaryParts: string[] = [];
  const flowSummary = flowOptions.find(option => option.value === layout.flow)?.label ?? layout.flow;
  summaryParts.push(flowSummary);
  summaryParts.push(layout.wrap ? 'Wrap on' : 'Wrap off');
  summaryParts.push(`Gap ${layout.gap}px`);
  if (layout.sizeMode === 'fixed') {
    const widthText = Number.isFinite(layout.width) ? `${layout.width}px` : 'auto';
    const heightText = Number.isFinite(layout.height) ? `${layout.height}px` : 'auto';
    summaryParts.push(`Fixed ${widthText} × ${heightText}`);
  } else {
    summaryParts.push('Hug content');
  }
  const summaryText = summaryParts.join(' • ');

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <div className={rootClasses}>
      <button
        type="button"
        className={[
          'w-full bg-transparent flex items-center justify-between text-left cursor-pointer select-none gap-2 transition-colors',
          density === 'comfortable' ? 'py-1.5' : 'py-1'
        ].filter(Boolean).join(' ')}
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <span className={titleClass}>Container layout</span>
          <span className={helperClass}>{summaryText}</span>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-[#8F8FA3] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>
      {isExpanded && (
        <div className={contentSpacingClass}>
          <div>
            <span className={`${labelClass} block mb-2`}>Flow</span>
            <div className={`grid grid-cols-4 ${controlGapClass}`}>
              {flowOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleLayoutChange({ flow: option.value })}
                  className={`${segmentedButtonBase} ${flowButtonExtraClass} flex items-center justify-center ${layout.flow === option.value ? segmentedActiveClass : segmentedInactiveClass}`}
                >
                  <span className={subLabelClass}>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`grid grid-cols-2 ${controlGapClass}`}>
            <label className={`${labelClass} flex flex-col gap-1`}>
              Justify
              <div className="relative">
                <select
                  className={`${fieldClass} appearance-none pr-8`}
                  value={layout.justify}
                  onChange={(event) => handleLayoutChange({ justify: event.target.value as ExportContainerLayout['justify'] })}
                >
                  {justifyOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8F8FA3]" aria-hidden />
              </div>
            </label>
            <label className={`${labelClass} flex flex-col gap-1`}>
              Align
              <div className="relative">
                <select
                  className={`${fieldClass} appearance-none pr-8`}
                  value={layout.align}
                  onChange={(event) => handleLayoutChange({ align: event.target.value as ExportContainerLayout['align'] })}
                >
                  {alignOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8F8FA3]" aria-hidden />
              </div>
            </label>
          </div>

          <div className={`grid grid-cols-[auto,1fr] items-center ${controlGapClass}`}>
            <span className={labelClass}>Wrap</span>
            <button
              type="button"
              onClick={() => handleLayoutChange({ wrap: !layout.wrap })}
              className={`${segmentedButtonBase} ${layout.wrap ? segmentedActiveClass : segmentedInactiveClass}`}
            >
              {layout.wrap ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className={`grid grid-cols-[auto,1fr] items-center ${controlGapClass}`}>
            <span className={labelClass}>Gap</span>
            <input
              type="number"
              min={0}
              className={`${fieldClass} text-center`}
              value={layout.gap}
              onChange={(event) => handleLayoutChange({ gap: Math.max(0, Number(event.target.value) || 0) })}
            />
          </div>

          <div>
            <span className={`${labelClass} block mb-2`}>Padding</span>
            <div className={`grid grid-cols-2 ${controlGapClass}`}>
              {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                <label key={side} className={`${labelClass} flex flex-col gap-1`}>
                  {side[0].toUpperCase() + side.slice(1)}
                  <input
                    type="number"
                    className={`${fieldClass} text-center`}
                    value={layout.padding[side]}
                    onChange={(event) => handlePaddingChange(side, Number(event.target.value))}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className={`${labelClass} block mb-2`}>Size mode</span>
            <div className={`flex ${controlGapClass}`}>
              <button
                type="button"
                onClick={() => handleLayoutChange({ sizeMode: 'hug', width: undefined, height: undefined })}
                className={`${segmentedButtonBase} flex-1 ${layout.sizeMode === 'hug' ? segmentedActiveClass : segmentedInactiveClass}`}
              >
                Hug content
              </button>
              <button
                type="button"
                onClick={() => handleLayoutChange({ sizeMode: 'fixed', width: layout.width ?? layout.padding.left + layout.padding.right, height: layout.height ?? layout.padding.top + layout.padding.bottom })}
                className={`${segmentedButtonBase} flex-1 ${layout.sizeMode === 'fixed' ? segmentedActiveClass : segmentedInactiveClass}`}
              >
                Fixed size
              </button>
            </div>
          </div>

          <div className={`grid grid-cols-2 ${controlGapClass}`}>
            <label className={`${labelClass} flex flex-col gap-1`}>
              Width
              <input
                type="number"
                className={`${fieldClass} text-center`}
                value={layout.width ?? ''}
                onChange={(event) => handleDimensionChange('width', event.target.value)}
                disabled={layout.sizeMode !== 'fixed'}
              />
            </label>
            <label className={`${labelClass} flex flex-col gap-1`}>
              Height
              <input
                type="number"
                className={`${fieldClass} text-center`}
                value={layout.height ?? ''}
                onChange={(event) => handleDimensionChange('height', event.target.value)}
                disabled={layout.sizeMode !== 'fixed'}
              />
            </label>
          </div>
        </div>
      )}
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
