'use client';

import React, { memo, useCallback, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { useAppStore } from '@/stores/useAppStore';
import type { LayerAlignmentSettings } from '@/types';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';

type AnchorKey = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
type AnchorSelection = AnchorKey | 'auto';

type ControlDensity = 'compact' | 'comfortable';

interface DensityProps {
  density?: ControlDensity;
  className?: string;
}

interface LayerAlignmentControlsProps extends DensityProps {
  appearance?: 'panel' | 'plain';
  defaultExpanded?: boolean;
}

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

const anchorButtonBase = [
  'h-6 border-0 transition-colors bg-transparent',
  'flex items-center justify-center',
  'text-[#D9D9D9]'
].join(' ');

const anchorActiveClass = 'bg-transparent text-white';
const anchorInactiveClass = 'bg-transparent hover:text-white';

const fitOptions: Array<{ value: LayerAlignmentSettings['fit']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'fill', label: 'Fill' },
  { value: 'tile', label: 'Tile' }
];

const fitButtonBase = [
  'w-full flex items-center gap-2',
  'px-0 py-0.5 text-sm transition-colors text-left'
].join(' ');

const fitButtonActive = 'text-[#F3F3F7] font-semibold';
const fitButtonInactive = 'text-[#D9D9D9] hover:text-white';

const resolveAnchorSelection = (alignment: LayerAlignmentSettings | null): AnchorSelection => {
  if (!alignment || alignment.positioning === 'auto') {
    return 'auto';
  }

  const match = (Object.entries(ANCHOR_CONFIG) as Array<[AnchorKey, (typeof ANCHOR_CONFIG)[AnchorKey]]>)
    .find(([, config]) => config.horizontal === alignment.horizontal && config.vertical === alignment.vertical);

  return match ? match[0] : 'mc';
};

export const LayerAlignmentControls = memo<LayerAlignmentControlsProps>(({ density = 'compact', className = '', defaultExpanded = true }) => {
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const activeLayer = useAppStore(state => state.layers.find(layer => layer.id === activeLayerId) ?? null);
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

  const paddingClasses = isComfortable ? 'px-2 py-1.5' : 'px-2 py-0.5';
  const rootClasses = [paddingClasses, className].filter(Boolean).join(' ').trim();

  const titleClass = 'text-sm font-medium text-[#F1F1F6]';
  const labelClass = 'text-sm font-medium text-[#D3D3DC]';

  const fieldClass = [
    'w-full rounded-none border border-[#D9D9D9] bg-transparent text-[#D9D9D9] placeholder:text-[#8F8FA3]',
    'transition-colors focus:border-[#F3F3F7] focus:outline-none focus:ring-0',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'h-6 px-2 text-sm'
  ].join(' ');

  const contentSpacingClass = 'mt-0.5';
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
      const shouldForceCenter = partial.fit === 'tile';
      const resolvedHorizontal = partial.horizontal ?? alignment.horizontal;
      const resolvedVertical = partial.vertical ?? alignment.vertical;
      const nextHorizontal = shouldForceCenter ? 'center' : resolvedHorizontal;
      const nextVertical = shouldForceCenter ? 'center' : resolvedVertical;

      const nextAlignment: LayerAlignmentSettings = {
        ...alignment,
        ...partial,
        fit: nextFit,
        horizontal: nextHorizontal,
        vertical: nextVertical,
        positioning: nextPositioning,
        offsetPx: partial.offsetPx ? { ...partial.offsetPx } : baseOffset,
        offsetPercent: nextPositioning === 'auto'
          ? { ...(partial.offsetPercent ?? basePercent) }
          : undefined
      };

      const targetLayerIds = selectedLayerIds.length > 1 && selectedLayerIds.includes(activeLayerId)
        ? selectedLayerIds
        : [activeLayerId];

      targetLayerIds.forEach(layerId => {
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
    if (fit === 'fill') {
      handleAlignmentChange({
        fit,
        positioning: 'anchor',
        horizontal: 'left',
        vertical: 'top',
        offsetPercent: undefined,
        offsetPx: { x: 0, y: 0 }
      });
      return;
    }

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

      targetLayerIds.forEach(layerId => {
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
          isComfortable ? 'py-1' : 'py-0.5'
        ].filter(Boolean).join(' ')}
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <span className={titleClass}>Layer alignment</span>
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
            <div className="grid grid-cols-3 text-current border border-current">
              {ANCHOR_GRID.map((row, rowIndex) => (
                <React.Fragment key={rowIndex}>
                  {row.map((key, colIndex) => {
                    const isSelected = selectedAnchor === key;
                    const buttonClass = [
                      anchorButtonBase,
                      isSelected ? anchorActiveClass : anchorInactiveClass,
                      disabled ? 'cursor-not-allowed opacity-60' : '',
                      colIndex < row.length - 1 ? 'border-r border-current' : '',
                      rowIndex < ANCHOR_GRID.length - 1 ? 'border-b border-current' : ''
                    ].filter(Boolean).join(' ');

                    return (
                      <button
                        key={key}
                        type="button"
                        className={buttonClass}
                        onClick={() => handleAnchorSelect(key)}
                        disabled={disabled}
                      >
                        <span
                          className={[
                            'h-1.5 w-1.5 block',
                            
                            isSelected
                              ? 'bg-[#F3F3F7]'
                              : 'border border-current bg-transparent'
                          ].join(' ')}
                          aria-hidden
                        />
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
                'w-full text-[#D9D9D9] border border-current mt-1',
                selectedAnchor === 'auto' ? 'bg-transparent' : 'bg-transparent',
                disabled ? 'cursor-not-allowed opacity-60' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => handleAnchorSelect('auto')}
              disabled={disabled}
            >
              Auto
            </button>
          </div>

          <div className="mt-1.5">
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
                      className={[
                        'h-3 w-3 block',
                        isSelected
                          ? 'bg-[#F3F3F7] border border-transparent'
                          : 'bg-transparent border border-current'
                      ].join(' ')}
                      aria-hidden
                    />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-1.5">
            <span className={`${labelClass} block`}>Offset</span>
            <div className="grid grid-cols-2 gap-1.5">
              <label className={`${labelClass} flex flex-col`}>
                X (px)
                <input
                  type="number"
                  className={`${fieldClass} text-center`}
                  value={alignment ? offset.x : 0}
                  onChange={event => handleOffsetChange('x', Number(event.target.value))}
                  disabled={offsetDisabled}
                />
              </label>
              <label className={`${labelClass} flex flex-col`}>
                Y (px)
                <input
                  type="number"
                  className={`${fieldClass} text-center`}
                  value={alignment ? offset.y : 0}
                  onChange={event => handleOffsetChange('y', Number(event.target.value))}
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

interface AlignmentPanelProps extends DensityProps {
  defaultExpanded?: boolean;
}

const AlignmentPanel: React.FC<AlignmentPanelProps> = ({ density = 'comfortable', defaultExpanded = true, className = '' }) => {
  const panelClass = [
    'bg-[#1A1A1A] border-t border-[#404040] px-2 py-2',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClass}>
      <LayerAlignmentControls
        density={density}
        defaultExpanded={defaultExpanded}
        className="bg-transparent"
      />
    </div>
  );
};

export default memo(AlignmentPanel);
