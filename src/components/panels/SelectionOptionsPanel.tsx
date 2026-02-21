'use client';

import React from 'react';
import ButtonGroup from '@/components/ui/ButtonGroup';
import { useAppStore } from '@/stores/useAppStore';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';
import type { SelectionMode } from '@/types';

const OPTIONS: Array<{ label: string; value: SelectionMode }> = [
  { label: 'Marquee', value: 'marquee' },
  { label: 'Freehand', value: 'freehand' },
  { label: 'Click Line', value: 'click-line' },
];

const HELP_TEXT: Record<SelectionMode, string> = {
  marquee: 'Drag to create a rectangle.',
  freehand: 'Drag a path and release to auto-close.',
  'click-line': 'Click points. Double-click or click near start to close.',
};

const SelectionOptionsPanel: React.FC = () => {
  const currentTool = useAppStore(selectCurrentTool);
  const selectionMode = useAppStore((state) => state.tools.selectionMode);
  const setSelectionMode = useAppStore((state) => state.setSelectionMode);

  if (currentTool !== 'selection') {
    return null;
  }

  return (
    <div className="border-b border-[#242424] bg-[#1F1F1F] px-4 py-3 text-xs text-[#E2E8F0]">
      <div className="uppercase text-[10px] tracking-[0.2em] text-[#8F9BAD] mb-2">Selection</div>
      <ButtonGroup
        options={OPTIONS}
        value={selectionMode}
        onChange={(value) => setSelectionMode(value as SelectionMode)}
        size="sm"
      />
      <p className="mt-3 text-[10px] text-[#94A3B8] leading-snug">{HELP_TEXT[selectionMode]}</p>
    </div>
  );
};

export default React.memo(SelectionOptionsPanel);
