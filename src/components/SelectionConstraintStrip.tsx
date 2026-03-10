'use client';

import React from 'react';

import { useAppStore } from '@/stores/useAppStore';

const CONSTRAINED_TOOLS = new Set(['brush', 'eraser', 'fill', 'color-adjust']);

const SelectionConstraintStrip: React.FC = () => {
  const currentTool = useAppStore((state) => state.tools.currentTool);
  const selectionStart = useAppStore((state) => state.selectionStart);
  const selectionEnd = useAppStore((state) => state.selectionEnd);
  const selectionMask = useAppStore((state) => state.selectionMask);
  const selectionMaskBounds = useAppStore((state) => state.selectionMaskBounds);

  const hasSelection = Boolean(
    (selectionStart && selectionEnd) || (selectionMask && selectionMaskBounds)
  );

  if (!hasSelection || !CONSTRAINED_TOOLS.has(currentTool)) {
    return null;
  }

  return (
    <div
      className="fixed bottom-12 left-1/2 z-40 -translate-x-1/2 rounded border border-amber-400/60 bg-[#1E1910]/95 px-3 py-1 text-[12px] text-amber-100 shadow-lg pointer-events-none select-none"
      role="status"
      aria-live="polite"
    >
      Selection active: paint output constrained to selected area
    </div>
  );
};

export default React.memo(SelectionConstraintStrip);
