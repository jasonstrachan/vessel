'use client';

import React from 'react';
import { ArrowUpToLine, Trash2 } from 'lucide-react';

import CommittedNumberInput from '@/components/ui/CommittedNumberInput';
import CommittedProgressSlider from '@/components/ui/CommittedProgressSlider';
import CustomSwitch from '@/components/ui/CustomSwitch';
import Dropdown from '@/components/ui/Dropdown';
import Input from '@/components/ui/Input';
import {
  MAX_REFERENCE_ASSET_SCALE,
  MIN_REFERENCE_ASSET_SCALE,
} from '@/referenceStudio/referenceAssets';
import type { ReferenceStudioSnapshot } from '@/referenceStudio/referenceStudioChannel';
import type { ReferenceAsset, ReferenceAssetCrop, ReferenceSamplingSource } from '@/types';

const actionClass = 'h-7 bg-[#282828] px-2 text-[11px] text-[#D9D9D9] transition-colors hover:bg-[#353535] disabled:cursor-not-allowed disabled:text-[#666]';
const iconActionClass = 'flex h-7 w-7 items-center justify-center bg-[#282828] text-[#B8B8B8] transition-colors hover:bg-[#353535] hover:text-white disabled:cursor-not-allowed disabled:text-[#555]';
const inputClass = '!h-7 !border-0 bg-[#101110] text-[11px] shadow-[inset_0_0_0_1px_#343434] focus:shadow-[inset_0_0_0_1px_#737373]';
const dropdownClass = 'w-full [&>button]:!h-7 [&>button]:!border-0 [&>button]:bg-[#101110] [&>button]:text-[11px] [&>button]:shadow-[inset_0_0_0_1px_#343434]';
const MIN_SCALE_EXPONENT = Math.log2(MIN_REFERENCE_ASSET_SCALE);
const MAX_SCALE_EXPONENT = Math.log2(MAX_REFERENCE_ASSET_SCALE);
const SCALE_SLIDER_MIDPOINT = 50;
const SCALE_SLIDER_STEP = 1 / 6;

const scaleToSliderValue = (scale: number): number => {
  const exponent = Math.log2(scale);
  if (scale <= 1) {
    return SCALE_SLIDER_MIDPOINT * (
      (exponent - MIN_SCALE_EXPONENT) / -MIN_SCALE_EXPONENT
    );
  }
  return SCALE_SLIDER_MIDPOINT + SCALE_SLIDER_MIDPOINT * (
    exponent / MAX_SCALE_EXPONENT
  );
};

const sliderValueToScale = (value: number): number => {
  if (value <= SCALE_SLIDER_MIDPOINT) {
    const progress = value / SCALE_SLIDER_MIDPOINT;
    return 2 ** (MIN_SCALE_EXPONENT * (1 - progress));
  }
  const progress = (value - SCALE_SLIDER_MIDPOINT) / SCALE_SLIDER_MIDPOINT;
  return 2 ** (MAX_SCALE_EXPONENT * progress);
};

type ProjectSnapshot = NonNullable<ReferenceStudioSnapshot['project']>;
type GridSnapshot = ReferenceStudioSnapshot['grid'];

interface ReferenceStudioControlsPanelProps {
  project: ProjectSnapshot;
  grid: GridSnapshot;
  layers: ReferenceStudioSnapshot['layers'];
  assets: ReferenceAsset[];
  samplingSource: ReferenceSamplingSource;
  selectedId: string | null;
  viewScale: number;
  error: string | null;
  onHide: () => void;
  onImportFiles: (files: File[]) => void;
  onSelectAsset: (id: string) => void;
  onPreviewAsset: (id: string, updates: Partial<ReferenceAsset>) => void;
  onUpdateAsset: (id: string, updates: Partial<ReferenceAsset>) => void;
  onRemoveAsset: (id: string) => void;
  onMoveAssetToTop: (id: string) => void;
  onFitSelectedAsset: () => void;
  onSetSamplingSource: (source: ReferenceSamplingSource) => void;
  onSetGrid: (updates: Partial<GridSnapshot>) => void;
}

const encodeSource = (source: ReferenceSamplingSource): string => {
  if (source.kind === 'layer') return `layer:${source.layerId}`;
  if (source.kind === 'asset') return `asset:${source.assetId}`;
  return 'canvas';
};

const decodeSource = (value: string): ReferenceSamplingSource => {
  if (value.startsWith('layer:')) return { kind: 'layer', layerId: value.slice(6) };
  if (value.startsWith('asset:')) return { kind: 'asset', assetId: value.slice(6) };
  return { kind: 'canvas' };
};

const updateCropEdge = (
  crop: ReferenceAssetCrop,
  edge: 'left' | 'top' | 'right' | 'bottom',
  percent: number,
): ReferenceAssetCrop => {
  const value = Math.max(0, Math.min(99, percent)) / 100;
  const right = 1 - crop.x - crop.width;
  const bottom = 1 - crop.y - crop.height;
  if (edge === 'left') return { ...crop, x: value, width: Math.max(0.01, 1 - value - right) };
  if (edge === 'top') return { ...crop, y: value, height: Math.max(0.01, 1 - value - bottom) };
  if (edge === 'right') return { ...crop, width: Math.max(0.01, 1 - crop.x - value) };
  return { ...crop, height: Math.max(0.01, 1 - crop.y - value) };
};

const SectionDivider = () => (
  <div className="h-px bg-[#2E2E2E]" data-testid="reference-section-divider" aria-hidden="true" />
);

export const ReferenceStudioControlsPanel = ({
  project,
  grid,
  layers,
  assets,
  samplingSource,
  selectedId,
  viewScale,
  error,
  onHide,
  onImportFiles,
  onSelectAsset,
  onPreviewAsset,
  onUpdateAsset,
  onRemoveAsset,
  onMoveAssetToTop,
  onFitSelectedAsset,
  onSetSamplingSource,
  onSetGrid,
}: ReferenceStudioControlsPanelProps) => {
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;
  const [nameDraft, setNameDraft] = React.useState(selectedAsset?.name ?? '');

  React.useEffect(() => {
    setNameDraft(selectedAsset?.name ?? '');
  }, [selectedAsset?.id, selectedAsset?.name]);

  const sourceOptions = React.useMemo(() => [
    { value: 'canvas', label: 'Canvas composite' },
    ...layers.map((layer) => ({
      value: `layer:${layer.id}`,
      label: layer.name,
      group: 'Artwork layers',
    })),
    ...assets.map((asset) => ({
      value: `asset:${asset.id}`,
      label: asset.name,
      group: 'Reference Studio',
    })),
  ], [assets, layers]);

  return (
    <aside
      id="reference-studio-controls"
      className="flex h-screen w-[260px] flex-shrink-0 flex-col bg-[#1A1A1A] shadow-[inset_-1px_0_0_#2E2E2E]"
      data-testid="reference-controls"
      data-vessel-panel="true"
    >
      <header className="flex h-10 flex-shrink-0 items-center justify-between px-2 shadow-[inset_0_-1px_0_#2E2E2E]">
        <div className="text-sm font-medium text-[#F1F1F6]">Reference Studio</div>
        <button type="button" className={actionClass} onClick={onHide}>Hide</button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-[#8F98A4]">
          <span className="min-w-0 truncate" data-testid="reference-project-name">
            {project.name} · {project.width}×{project.height}
          </span>
          <span className="flex-shrink-0">View {Math.round(viewScale * 100)}%</span>
        </div>

        <label className="flex h-7 cursor-pointer items-center justify-center bg-[#2A2A2A] text-[11px] text-[#E5E5E5] transition-colors hover:bg-[#353535]">
          Add image
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            data-testid="reference-file-input"
            onChange={(event) => {
              onImportFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = '';
            }}
          />
        </label>
        {error ? <div role="alert" className="mt-2 text-[11px] text-[#FF9B9B]">{error}</div> : null}

        <div className="my-3"><SectionDivider /></div>

        <section className="space-y-1.5">
          <div className="text-sm font-medium text-[#F1F1F6]">Sample source</div>
          <Dropdown
            value={encodeSource(samplingSource)}
            options={sourceOptions}
            onChange={(value) => onSetSamplingSource(decodeSource(value))}
            className={dropdownClass}
          />
        </section>

        <div className="my-3"><SectionDivider /></div>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-[#F1F1F6]">Grid</div>
            <div className="flex items-center gap-2 text-[11px] text-[#B8B8B8]">
              <span>Visible</span>
              <CustomSwitch
                checked={grid.enabled}
                onChange={(enabled) => onSetGrid({ enabled })}
                aria-label="Reference grid visible"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['rows', 'columns'] as const).map((key) => (
              <label key={key} className="space-y-1 text-[11px] capitalize text-[#B8B8B8]">
                <span className="block">{key}</span>
                <CommittedNumberInput
                  value={grid[key]}
                  onCommit={(value) => onSetGrid({ [key]: value })}
                  min={1}
                  max={128}
                  ariaLabel={`Reference grid ${key}`}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
        </section>

        <div className="my-3"><SectionDivider /></div>

        <section data-testid="reference-list">
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="text-sm font-medium text-[#F1F1F6]">References</div>
            <span className="text-[10px] text-[#8F98A4]">{assets.length}</span>
          </div>
          <div className="space-y-1">
            {assets.map((asset, index) => {
              const isSelected = selectedId === asset.id;
              const rowClass = isSelected
                ? 'bg-[#E8F2FF] text-[#0F172A] shadow-[inset_3px_0_0_#0EA5E9]'
                : 'bg-[#202020] text-[#D9D9D9] hover:bg-[#292929]';
              return (
                <div key={asset.id} className={`px-2 py-1.5 transition-colors ${rowClass}`} data-selected={isSelected ? 'true' : 'false'}>
                  <button
                    type="button"
                    className="block w-full truncate bg-transparent text-left text-[11px] font-semibold"
                    onClick={() => onSelectAsset(asset.id)}
                  >
                    {asset.name}
                  </button>
                  <div className="mt-1.5 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-[10px]">
                        <span>Show</span>
                        <CustomSwitch
                          checked={asset.visible}
                          onChange={(visible) => onUpdateAsset(asset.id, { visible })}
                          aria-label={`Show ${asset.name}`}
                        />
                      </div>
                      <div className="flex items-center gap-1 text-[10px]">
                        <span>Lock</span>
                        <CustomSwitch
                          checked={asset.locked}
                          onChange={(locked) => onUpdateAsset(asset.id, { locked })}
                          aria-label={`Lock ${asset.name}`}
                        />
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={iconActionClass}
                        aria-label={`Move ${asset.name} to top`}
                        title="Move to top"
                        disabled={index === assets.length - 1}
                        onClick={() => onMoveAssetToTop(asset.id)}
                      >
                        <ArrowUpToLine size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={iconActionClass}
                        aria-label={`Remove ${asset.name}`}
                        title="Remove"
                        onClick={() => onRemoveAsset(asset.id)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {selectedAsset ? (
          <>
            <div className="my-3"><SectionDivider /></div>
            <section className="space-y-2.5" data-testid="reference-inspector">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-[#F1F1F6]">Selected reference</div>
                <button type="button" className={actionClass} onClick={onFitSelectedAsset}>Fit</button>
              </div>

              <label className="block space-y-1 text-[11px] text-[#B8B8B8]">
                <span className="block">Name</span>
                <Input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => {
                    if (nameDraft !== selectedAsset.name) {
                      onUpdateAsset(selectedAsset.id, { name: nameDraft });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                      setNameDraft(selectedAsset.name);
                      event.currentTarget.blur();
                    }
                  }}
                  fullWidth
                  className={inputClass}
                  aria-label="Reference name"
                />
              </label>

              <div className="grid grid-cols-2 gap-1.5">
                {(['x', 'y'] as const).map((key) => (
                  <label key={key} className="space-y-1 text-[11px] uppercase text-[#B8B8B8]">
                    <span className="block">{key}</span>
                    <CommittedNumberInput
                      value={Math.round(selectedAsset[key])}
                      onCommit={(value) => onUpdateAsset(selectedAsset.id, { [key]: value })}
                      ariaLabel={`Reference ${key}`}
                      className={inputClass}
                    />
                  </label>
                ))}
              </div>

              <label className="block space-y-1 text-[11px] text-[#B8B8B8]">
                <span className="block">Scale</span>
                <CommittedProgressSlider
                  value={scaleToSliderValue(selectedAsset.scale)}
                  min={0}
                  max={100}
                  step={SCALE_SLIDER_STEP}
                  formatValue={(value) => `${Math.round(sliderValueToScale(value) * 100)}%`}
                  onPreview={(value) => onPreviewAsset(selectedAsset.id, {
                    scale: sliderValueToScale(value),
                  })}
                  onChange={(value) => onUpdateAsset(selectedAsset.id, {
                    scale: sliderValueToScale(value),
                  })}
                  aria-label="Reference scale"
                />
              </label>

              <label className="block space-y-1 text-[11px] text-[#B8B8B8]">
                <span className="block">Opacity</span>
                <CommittedProgressSlider
                  value={selectedAsset.opacity * 100}
                  min={0}
                  max={100}
                  step={1}
                  formatValue={(value) => `${Math.round(value)}%`}
                  onPreview={(value) => onPreviewAsset(selectedAsset.id, { opacity: value / 100 })}
                  onChange={(value) => onUpdateAsset(selectedAsset.id, { opacity: value / 100 })}
                  aria-label="Reference opacity"
                />
              </label>

              <div className="grid grid-cols-4 gap-1">
                {(['left', 'top', 'right', 'bottom'] as const).map((edge) => {
                  const percent = edge === 'left'
                    ? selectedAsset.crop.x * 100
                    : edge === 'top'
                      ? selectedAsset.crop.y * 100
                      : edge === 'right'
                        ? (1 - selectedAsset.crop.x - selectedAsset.crop.width) * 100
                        : (1 - selectedAsset.crop.y - selectedAsset.crop.height) * 100;
                  return (
                    <label key={edge} className="space-y-1 text-[9px] capitalize text-[#8F98A4]">
                      <span className="block">{edge}</span>
                      <CommittedNumberInput
                        value={Math.round(percent)}
                        onCommit={(value) => onUpdateAsset(selectedAsset.id, {
                          crop: updateCropEdge(selectedAsset.crop, edge, value),
                        })}
                        min={0}
                        max={99}
                        ariaLabel={`Reference crop ${edge}`}
                        className={`${inputClass} !px-0`}
                      />
                    </label>
                  );
                })}
              </div>

              <div className="grid grid-cols-[1fr_1fr_1.35fr] gap-1">
                <button type="button" className={actionClass} onClick={() => onUpdateAsset(selectedAsset.id, { flipX: !selectedAsset.flipX })}>Flip X</button>
                <button type="button" className={actionClass} onClick={() => onUpdateAsset(selectedAsset.id, { flipY: !selectedAsset.flipY })}>Flip Y</button>
                <button type="button" className={actionClass} onClick={() => onUpdateAsset(selectedAsset.id, { crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
};
