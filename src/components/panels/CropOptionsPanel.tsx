'use client';

import React, { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';
import { useCropState } from '@/hooks/useCropState';

const formatDimension = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

const CropOptionsPanel: React.FC = () => {
  const project = useAppStore((state) => state.project);
  const currentTool = useAppStore(selectCurrentTool);
  const { crop } = useCropState();

  const isCropActive = currentTool === 'crop';

  const selectionLabel = useMemo(() => {
    if (!crop.marquee) {
      return 'Drag to select an area';
    }
    return `${formatDimension(crop.marquee.width)} × ${formatDimension(crop.marquee.height)} px`;
  }, [crop.marquee]);

  const canvasLabel = project
    ? `${formatDimension(project.width)} × ${formatDimension(project.height)} px`
    : '—';

  if (!project) {
    return null;
  }

  const selectionExtendsBounds = crop.marquee
    ? crop.marquee.x < 0 ||
      crop.marquee.y < 0 ||
      crop.marquee.x + crop.marquee.width > project.width ||
      crop.marquee.y + crop.marquee.height > project.height
    : false;

  return (
    <div className="border-b border-[#242424] bg-[#1F1F1F] px-4 py-3 text-xs text-[#E2E8F0]">
      <div className="uppercase text-[10px] tracking-[0.2em] text-[#8F9BAD] mb-2">Crop Options</div>
      <dl className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#94A3B8]">Canvas</dt>
          <dd className="font-mono text-[11px] text-[#F8FAFC]">{canvasLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#94A3B8]">Selection</dt>
          <dd className="font-mono text-[11px] text-right text-[#F8FAFC]">{selectionLabel}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[10px] text-[#94A3B8] leading-snug">
        {isCropActive
          ? selectionExtendsBounds
            ? 'Release to extend the canvas to fit this selection.'
            : 'Drag handles past the edges to add space, or press Enter to crop.'
          : 'Select the Crop tool (C) to adjust the canvas bounds.'}
      </p>
    </div>
  );
};

export default React.memo(CropOptionsPanel);
