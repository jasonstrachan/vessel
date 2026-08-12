'use client';

import React from 'react';

import ButtonGroup from '@/components/ui/ButtonGroup';
import CommittedProgressSlider from '@/components/ui/CommittedProgressSlider';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { useAppStore } from '@/stores/useAppStore';
import type { InterlacePatternPreset } from '@/types';

const BUTTON_CLASS =
  'border border-[#545454] bg-[#262626] px-2 py-1 text-[11px] text-[#D9D9D9] hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-40';

const PATTERN_PRESETS: Array<{
  value: InterlacePatternPreset;
  label: string;
  description: string;
}> = [
  {
    value: 'classic',
    label: 'Classic pulse',
    description: 'The original registered Sierra rhythm.',
  },
  {
    value: 'ripple',
    label: 'Ripple',
    description: 'Pose coverage breathes through successive horizontal bands.',
  },
  {
    value: 'counterflow',
    label: 'Counterflow',
    description: 'Alternating bands oscillate against one another.',
  },
  {
    value: 'hypnotic',
    label: 'Hypnotic',
    description: 'Layered breathing and counter-motion create a denser pulse.',
  },
  {
    value: 'sierra-travel',
    label: 'Sierra travel',
    description: 'One full Sierra sheet crosses the stationary poses as a rigid horizontal plate.',
  },
];

export const InterlaceSettingsPanel: React.FC = () => {
  const layers = useAppStore((state) => state.layers);
  const layerGroups = useAppStore((state) => state.layerGroups);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const selectedLayerIds = useAppStore((state) => state.selectedLayerIds);
  const createInterlaceGroup = useAppStore((state) => state.createInterlaceGroupFromSelection);
  const updateInterlaceGroup = useAppStore((state) => state.updateInterlaceGroup);
  const moveLayersToGroup = useAppStore((state) => state.moveLayersToGroup);
  const removeLayerGroup = useAppStore((state) => state.removeLayerGroup);
  const reorderLayerBlock = useAppStore((state) => state.reorderLayerBlock);
  const [addLayerId, setAddLayerId] = React.useState('');
  const [draggedLayerId, setDraggedLayerId] = React.useState<string | null>(null);

  const selectedSet = React.useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);
  const selectedGroupId = React.useMemo(() => {
    const active = layers.find((layer) => layer.id === activeLayerId);
    if (active?.groupId && isInterlaceGroup(layerGroups.find((group) => group.id === active.groupId))) {
      return active.groupId;
    }
    return layers.find((layer) => (
      selectedSet.has(layer.id)
      && layer.groupId
      && isInterlaceGroup(layerGroups.find((group) => group.id === layer.groupId))
    ))?.groupId ?? null;
  }, [activeLayerId, layerGroups, layers, selectedSet]);
  const group = layerGroups.find((candidate) => candidate.id === selectedGroupId);
  const interlaceGroup = isInterlaceGroup(group) ? group : null;
  const members = interlaceGroup
    ? layers.filter((layer) => layer.groupId === interlaceGroup.id && layer.layerType !== 'sequential')
    : [];
  const eligibleSelection = layers.filter((layer) => (
    selectedSet.has(layer.id) && layer.layerType !== 'sequential'
  ));
  const addableLayers = React.useMemo(() => (
    interlaceGroup
      ? layers.filter((layer) => (
          layer.layerType !== 'sequential' && layer.groupId !== interlaceGroup.id
        ))
      : []
  ), [interlaceGroup, layers]);
  const selectedPatternPreset = PATTERN_PRESETS.find(
    (preset) => preset.value === interlaceGroup?.interlace.patternPreset,
  ) ?? PATTERN_PRESETS[0];
  const isSierraTravel = interlaceGroup?.interlace.patternPreset === 'sierra-travel';

  React.useEffect(() => {
    if (!addableLayers.some((layer) => layer.id === addLayerId)) {
      setAddLayerId(addableLayers[0]?.id ?? '');
    }
  }, [addLayerId, addableLayers]);

  if (!interlaceGroup) {
    return (
      <div className="space-y-3 px-4 py-4 text-[#D9D9D9]">
        <div>
          <h2 className="text-sm font-semibold">Interlace</h2>
          <p className="mt-1 text-[11px] text-[#9CA3AF]">
            Select two or more regular or Color Cycle layers. Their stack order becomes pose order.
          </p>
        </div>
        <button
          className={BUTTON_CLASS}
          disabled={eligibleSelection.length < 2}
          onClick={() => createInterlaceGroup(eligibleSelection.map((layer) => layer.id))}
          type="button"
        >
          Create from selection
        </button>
      </div>
    );
  }

  const firstMemberIndex = Math.min(...members.map((member) => layers.findIndex((layer) => layer.id === member.id)));
  const lastMemberIndex = Math.max(...members.map((member) => layers.findIndex((layer) => layer.id === member.id)));
  const reorderMember = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const nextIds = members.map((member) => member.id);
    const sourceIndex = nextIds.indexOf(sourceId);
    const targetIndex = nextIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    nextIds.splice(targetIndex, 0, nextIds.splice(sourceIndex, 1)[0]);
    reorderLayerBlock(nextIds, firstMemberIndex);
  };

  return (
    <div className="space-y-4 px-4 py-4 text-[#D9D9D9]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{interlaceGroup.name}</h2>
          <p className="text-[10px] text-[#8F98A4]">Hard-edged Interlace animation · fixed source artwork</p>
        </div>
        <button className={BUTTON_CLASS} onClick={() => removeLayerGroup(interlaceGroup.id)} type="button">
          Release
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">Pose order</div>
        {members.map((layer, index) => (
          <div
            className="flex items-center gap-2 border border-[#3F3F46] bg-[#232326] px-2 py-1.5 text-[11px]"
            draggable
            key={layer.id}
            onDragEnd={() => setDraggedLayerId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDragStart={() => setDraggedLayerId(layer.id)}
            onDrop={() => {
              if (draggedLayerId) reorderMember(draggedLayerId, layer.id);
              setDraggedLayerId(null);
            }}
          >
            <span className="w-5 text-[#7DD3FC]">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{layer.name}</span>
            <button
              aria-label={`Move ${layer.name} earlier`}
              className={BUTTON_CLASS}
              disabled={index === 0}
              onClick={() => reorderMember(layer.id, members[index - 1]?.id ?? layer.id)}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={`Move ${layer.name} later`}
              className={BUTTON_CLASS}
              disabled={index === members.length - 1}
              onClick={() => reorderMember(layer.id, members[index + 1]?.id ?? layer.id)}
              type="button"
            >
              ↓
            </button>
            <button
              aria-label={`Remove ${layer.name} from interlace`}
              className={BUTTON_CLASS}
              onClick={() => moveLayersToGroup([layer.id], undefined, lastMemberIndex + 1)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <select
          aria-label="Layer to add to interlace"
          className="min-w-0 flex-1 border border-[#545454] bg-[#202024] px-2 py-1 text-[11px] text-[#D9D9D9]"
          onChange={(event) => setAddLayerId(event.target.value)}
          value={addLayerId}
        >
          {addableLayers.length === 0 && <option value="">No available layers</option>}
          {addableLayers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
        </select>
        <button
          className={BUTTON_CLASS}
          disabled={!addLayerId}
          onClick={() => moveLayersToGroup([addLayerId], interlaceGroup.id, lastMemberIndex + 1)}
          type="button"
        >
          Add
        </button>
      </div>

      <label className="block space-y-1 text-[11px]">
        <span>Pattern size · {interlaceGroup.interlace.cellSize}px</span>
        <CommittedProgressSlider
          aria-label="Interlace pattern size"
          max={64}
          min={2}
          onChange={(cellSize, previousCellSize) => updateInterlaceGroup(
            interlaceGroup.id,
            { cellSize },
            {
              previousSettings: {
                ...interlaceGroup.interlace,
                cellSize: previousCellSize,
              },
            },
          )}
          onPreview={(cellSize) => updateInterlaceGroup(
            interlaceGroup.id,
            { cellSize },
            { recordHistory: false },
          )}
          value={interlaceGroup.interlace.cellSize}
        />
      </label>
      <label className="block space-y-1 text-[11px]">
        <span>Pattern animation</span>
        <select
          aria-label="Interlace pattern animation"
          className="w-full border border-[#545454] bg-[#202024] px-2 py-1.5 text-[11px] text-[#D9D9D9]"
          onChange={(event) => updateInterlaceGroup(interlaceGroup.id, {
            patternPreset: event.target.value as InterlacePatternPreset,
          })}
          value={selectedPatternPreset.value}
        >
          {PATTERN_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
        </select>
        <span className="block text-[10px] text-[#8F98A4]">
          {selectedPatternPreset.description}
        </span>
      </label>
      {isSierraTravel ? (
        <div className="space-y-1">
          <div className="text-[11px] text-[#D9D9D9]">Window action · Leading edge B → trailing edge A</div>
          <p className="text-[10px] text-[#8F98A4]">
            Every aperture moves with the same unchanged sheet; the paintings remain fixed.
          </p>
        </div>
      ) : (
        <label className="block space-y-1 text-[11px]">
          <span>Pose dominance · {Math.round(interlaceGroup.interlace.dominance * 100)}%</span>
          <CommittedProgressSlider
            aria-label="Interlace pose dominance"
            max={100}
            min={50}
            onChange={(dominance, previousDominance) => updateInterlaceGroup(
              interlaceGroup.id,
              { dominance: dominance / 100 },
              {
                previousSettings: {
                  ...interlaceGroup.interlace,
                  dominance: previousDominance / 100,
                },
              },
            )}
            onPreview={(dominance) => updateInterlaceGroup(
              interlaceGroup.id,
              { dominance: dominance / 100 },
              { recordHistory: false },
            )}
            value={interlaceGroup.interlace.dominance * 100}
          />
          <span className="block text-[10px] text-[#8F98A4]">
            Maximum pose coverage; its neighbour remains {Math.round((1 - interlaceGroup.interlace.dominance) * 100)}% visible.
          </span>
        </label>
      )}
      {isSierraTravel ? (
        <div className="space-y-1">
          <div className="text-[11px] text-[#D9D9D9]">Pattern motion · Rigid horizontal sheet</div>
          <p className="text-[10px] text-[#8F98A4]">
            The full-canvas Sierra pattern translates left or right without regenerating or deforming.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-[11px] text-[#D9D9D9]">Pattern motion</div>
          <ButtonGroup
            onChange={(motionMode) => updateInterlaceGroup(interlaceGroup.id, {
              motionMode: motionMode === 'travel' ? 'travel' : 'fixed',
            })}
            options={[{ label: 'Fixed', value: 'fixed' }, { label: 'Travel', value: 'travel' }]}
            size="sm"
            value={interlaceGroup.interlace.motionMode === 'travel' ? 'travel' : 'fixed'}
          />
          <p className="text-[10px] text-[#8F98A4]">
            Fixed keeps the cell field registered while the reveal moves inside it.
          </p>
        </div>
      )}
      <div className="space-y-1">
        <div className="text-[11px] text-[#D9D9D9]">Direction</div>
        <ButtonGroup
          onChange={(direction) => updateInterlaceGroup(interlaceGroup.id, {
            direction: direction === 'left' ? 'left' : 'right',
          })}
          options={[{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }]}
          size="sm"
          value={interlaceGroup.interlace.direction}
        />
      </div>
    </div>
  );
};
