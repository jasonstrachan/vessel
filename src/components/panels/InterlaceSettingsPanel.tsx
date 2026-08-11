'use client';

import React from 'react';

import ButtonGroup from '@/components/ui/ButtonGroup';
import CommittedProgressSlider from '@/components/ui/CommittedProgressSlider';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { useAppStore } from '@/stores/useAppStore';

const BUTTON_CLASS =
  'border border-[#545454] bg-[#262626] px-2 py-1 text-[11px] text-[#D9D9D9] hover:bg-[#343434] disabled:cursor-not-allowed disabled:opacity-40';

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
          <p className="text-[10px] text-[#8F98A4]">Sierra Lite · hard cells · 10 second loop</p>
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
        <span>Cell size · {interlaceGroup.interlace.cellSize}px</span>
        <CommittedProgressSlider
          aria-label="Interlace cell size"
          max={64}
          min={2}
          onChange={(cellSize) => updateInterlaceGroup(interlaceGroup.id, { cellSize })}
          value={interlaceGroup.interlace.cellSize}
        />
      </label>
      <label className="block space-y-1 text-[11px]">
        <span>Pose dominance · {Math.round(interlaceGroup.interlace.dominance * 100)}%</span>
        <CommittedProgressSlider
          aria-label="Interlace pose dominance"
          max={100}
          min={50}
          onChange={(dominance) => updateInterlaceGroup(interlaceGroup.id, { dominance: dominance / 100 })}
          value={interlaceGroup.interlace.dominance * 100}
        />
      </label>
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
