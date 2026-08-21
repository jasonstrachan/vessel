'use client';

import React from 'react';
import { ArrowUpToLine, Trash2 } from 'lucide-react';

import ButtonGroup from '@/components/ui/ButtonGroup';
import CommittedNumberInput from '@/components/ui/CommittedNumberInput';
import CommittedProgressSlider from '@/components/ui/CommittedProgressSlider';
import CustomSwitch from '@/components/ui/CustomSwitch';
import Dropdown from '@/components/ui/Dropdown';
import LabeledSlider from '@/components/ui/LabeledSlider';
import type { ReferenceStudioSnapshot } from '@/referenceStudio/referenceStudioChannel';
import type { ReferenceAsset, ReferenceSamplingSource } from '@/types';

const actionClass = 'h-7 bg-[#282828] px-2 text-[11px] text-[#D9D9D9] transition-colors hover:bg-[#353535] disabled:cursor-not-allowed disabled:text-[#666]';
const iconActionClass = 'flex h-7 w-7 items-center justify-center bg-[#282828] text-[#B8B8B8] transition-colors hover:bg-[#353535] hover:text-white disabled:cursor-not-allowed disabled:text-[#555]';
const inputClass = '!h-7 !border-0 bg-[#101110] text-[11px] shadow-[inset_0_0_0_1px_#343434] focus:shadow-[inset_0_0_0_1px_#737373]';
const dropdownClass = 'w-full [&>button]:!h-7 [&>button]:!border-0 [&>button]:bg-[#101110] [&>button]:text-[11px] [&>button]:shadow-[inset_0_0_0_1px_#343434]';
type GridSnapshot = ReferenceStudioSnapshot['grid'];
export type ReferenceStudioTool = 'move' | 'liquify';

interface ReferenceStudioControlsPanelProps {
  grid: GridSnapshot;
  layers: ReferenceStudioSnapshot['layers'];
  assets: ReferenceAsset[];
  samplingSource: ReferenceSamplingSource;
  selectedId: string | null;
  activeTool: ReferenceStudioTool;
  liquifySize: number;
  liquifyStrength: number;
  error: string | null;
  onHide: () => void;
  onImportFiles: (files: File[]) => void;
  onSelectAsset: (id: string) => void;
  onPreviewAsset: (id: string, updates: Partial<ReferenceAsset>) => void;
  onClearAssetPreview: (id: string) => void;
  onUpdateAsset: (id: string, updates: Partial<ReferenceAsset>) => void;
  onRemoveAsset: (id: string) => void;
  onMoveAssetToTop: (id: string) => void;
  onFitSelectedAsset: () => void;
  onSetActiveTool: (tool: ReferenceStudioTool) => void;
  onSetLiquifySize: (size: number) => void;
  onSetLiquifyStrength: (strength: number) => void;
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

const SectionDivider = () => (
  <div className="h-px bg-[#2E2E2E]" data-testid="reference-section-divider" aria-hidden="true" />
);

export const ReferenceStudioControlsPanel = ({
  grid,
  layers,
  assets,
  samplingSource,
  selectedId,
  activeTool,
  liquifySize,
  liquifyStrength,
  error,
  onHide,
  onImportFiles,
  onSelectAsset,
  onPreviewAsset,
  onClearAssetPreview,
  onUpdateAsset,
  onRemoveAsset,
  onMoveAssetToTop,
  onFitSelectedAsset,
  onSetActiveTool,
  onSetLiquifySize,
  onSetLiquifyStrength,
  onSetSamplingSource,
  onSetGrid,
}: ReferenceStudioControlsPanelProps) => {
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;
  const didCommitOpacityRef = React.useRef(false);

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
              </div>

              <ButtonGroup
                options={[
                  { label: 'Move', value: 'move' },
                  {
                    label: 'Liquify',
                    value: 'liquify',
                    disabled: selectedAsset.locked,
                    title: selectedAsset.locked ? 'Unlock the reference to liquify it' : undefined,
                  },
                ]}
                value={activeTool}
                onChange={(value) => onSetActiveTool(value as ReferenceStudioTool)}
                size="sm"
                className="w-full [&>button]:flex-1"
              />

              {activeTool === 'liquify' ? (
                <div className="space-y-2" data-testid="reference-liquify-controls">
                  <LabeledSlider
                    label="Size"
                    value={liquifySize}
                    min={8}
                    max={1000}
                    step={1}
                    onChange={onSetLiquifySize}
                    ariaLabel="Liquify brush size"
                    labelWidthClass="w-12"
                    fontSizePx={11}
                  />
                  <LabeledSlider
                    label="Strength"
                    value={Math.round(liquifyStrength * 100)}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(value) => onSetLiquifyStrength(value / 100)}
                    ariaLabel="Liquify brush strength"
                    labelWidthClass="w-12"
                    fontSizePx={11}
                  />
                </div>
              ) : null}

              <label className="block space-y-1 text-[11px] text-[#B8B8B8]">
                <span className="block">Opacity</span>
                <CommittedProgressSlider
                  value={selectedAsset.opacity * 100}
                  min={0}
                  max={100}
                  step={1}
                  formatValue={(value) => `${Math.round(value)}%`}
                  onPreview={(value) => onPreviewAsset(selectedAsset.id, { opacity: value / 100 })}
                  onChange={(value) => {
                    didCommitOpacityRef.current = true;
                    onUpdateAsset(selectedAsset.id, { opacity: value / 100 });
                  }}
                  onCommit={() => {
                    if (!didCommitOpacityRef.current) {
                      onClearAssetPreview(selectedAsset.id);
                    }
                    didCommitOpacityRef.current = false;
                  }}
                  aria-label="Reference opacity"
                />
              </label>

              <div className="grid grid-cols-3 gap-1">
                <button type="button" className={actionClass} onClick={onFitSelectedAsset}>Fit</button>
                <button type="button" className={actionClass} onClick={() => onUpdateAsset(selectedAsset.id, { flipX: !selectedAsset.flipX })}>Flip X</button>
                <button type="button" className={actionClass} onClick={() => onUpdateAsset(selectedAsset.id, { flipY: !selectedAsset.flipY })}>Flip Y</button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
};
