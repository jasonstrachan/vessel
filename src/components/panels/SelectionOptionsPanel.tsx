'use client';

import React from 'react';
import ButtonGroup from '@/components/ui/ButtonGroup';
import CommittedNumberInput from '@/components/ui/CommittedNumberInput';
import MagicWandControls from '@/components/toolbar/MagicWandControls';
import { clampMarqueeDragRectToBounds } from '@/stores/helpers/selectionRoi';
import { useAppStore } from '@/stores/useAppStore';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';
import type { Rectangle, SelectionMode } from '@/types';

const OPTIONS: Array<{ label: string; value: SelectionMode }> = [
  { label: 'Marquee', value: 'marquee' },
  { label: 'Freehand', value: 'freehand' },
  { label: 'Click Line', value: 'click-line' },
  { label: 'Magic Wand', value: 'magic-wand' },
];

const HELP_TEXT: Record<SelectionMode, string> = {
  marquee: '',
  freehand: 'Drag a path and release to auto-close.',
  'click-line': 'Click points. Double-click or click near start to close.',
  'magic-wand': 'Click pixels to select matching areas on regular or color-cycle layers.',
};

const ACTION_BUTTON_CLASS_NAME =
  'h-7 px-2 text-[11px] rounded border border-[#3B3B3B] bg-[#262626] text-[#E2E8F0] transition-colors hover:bg-[#313131] disabled:cursor-not-allowed disabled:opacity-50';

const deriveSelectionRect = (
  selectionStart: { x: number; y: number } | null,
  selectionEnd: { x: number; y: number } | null,
  projectWidth: number,
  projectHeight: number,
): Rectangle | null => {
  return clampMarqueeDragRectToBounds(selectionStart, selectionEnd, projectWidth, projectHeight);
};

const SelectionOptionsPanel: React.FC = () => {
  const currentTool = useAppStore(selectCurrentTool);
  const selectionMode = useAppStore((state) => state.tools.selectionMode);
  const setSelectionMode = useAppStore((state) => state.setSelectionMode);
  const setCurrentTool = useAppStore((state) => state.setCurrentTool);
  const project = useAppStore((state) => state.project);
  const selectionStart = useAppStore((state) => state.selectionStart);
  const selectionEnd = useAppStore((state) => state.selectionEnd);
  const selectionMask = useAppStore((state) => state.selectionMask);
  const selectionMaskBounds = useAppStore((state) => state.selectionMaskBounds);
  const floatingPaste = useAppStore((state) => state.floatingPaste);
  const extractSelectionToFloatingPaste = useAppStore((state) => state.extractSelectionToFloatingPaste);
  const flipFloatingPasteHorizontal = useAppStore((state) => state.flipFloatingPasteHorizontal);
  const flipFloatingPasteVertical = useAppStore((state) => state.flipFloatingPasteVertical);
  const invertSelection = useAppStore((state) => state.invertSelection);
  const adjustMarqueeSelection = useAppStore((state) => state.adjustMarqueeSelection);
  const setCropState = useAppStore((state) => state.setCropState);
  const [insetAmount, setInsetAmount] = React.useState(1);
  const [expandAmount, setExpandAmount] = React.useState(1);

  const hasSelectionBounds = Boolean(selectionStart && selectionEnd);
  const hasSelectionMask = Boolean(selectionMask && selectionMaskBounds);
  const canInvertSelection = hasSelectionBounds || hasSelectionMask;
  const canFlipSelection = Boolean(floatingPaste || hasSelectionBounds);
  const marqueeSelectionRect = React.useMemo(
    () => deriveSelectionRect(selectionStart, selectionEnd, project?.width ?? 0, project?.height ?? 0),
    [project?.height, project?.width, selectionEnd, selectionStart],
  );
  const canCropSelection = selectionMode === 'marquee' && Boolean(marqueeSelectionRect);
  const canAdjustMarquee = selectionMode === 'marquee' && Boolean(marqueeSelectionRect);
  const canInsetMarquee = Boolean(
    marqueeSelectionRect &&
    insetAmount > 0 &&
    marqueeSelectionRect.width > insetAmount * 2 &&
    marqueeSelectionRect.height > insetAmount * 2,
  );

  const handleFlipHorizontal = React.useCallback(() => {
    if (!floatingPaste) {
      const extracted = extractSelectionToFloatingPaste();
      if (!extracted) {
        return;
      }
    }
    flipFloatingPasteHorizontal();
  }, [extractSelectionToFloatingPaste, flipFloatingPasteHorizontal, floatingPaste]);

  const handleFlipVertical = React.useCallback(() => {
    if (!floatingPaste) {
      const extracted = extractSelectionToFloatingPaste();
      if (!extracted) {
        return;
      }
    }
    flipFloatingPasteVertical();
  }, [extractSelectionToFloatingPaste, flipFloatingPasteVertical, floatingPaste]);

  const handleCropSelection = React.useCallback(() => {
    if (!marqueeSelectionRect) {
      return;
    }

    setCropState({
      marquee: marqueeSelectionRect,
      status: 'ready',
      activeHandle: null,
      commitInFlight: false,
    });
    setCurrentTool('crop');
  }, [marqueeSelectionRect, setCropState, setCurrentTool]);

  const handleInsetMarquee = React.useCallback(() => {
    if (!canInsetMarquee) {
      return;
    }

    adjustMarqueeSelection(-insetAmount);
  }, [adjustMarqueeSelection, canInsetMarquee, insetAmount]);

  const handleExpandMarquee = React.useCallback(() => {
    if (!canAdjustMarquee || expandAmount <= 0) {
      return;
    }

    adjustMarqueeSelection(expandAmount);
  }, [adjustMarqueeSelection, canAdjustMarquee, expandAmount]);

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
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          className={ACTION_BUTTON_CLASS_NAME}
          onClick={handleFlipHorizontal}
          disabled={!canFlipSelection}
        >
          Flip H
        </button>
        <button
          type="button"
          className={ACTION_BUTTON_CLASS_NAME}
          onClick={handleFlipVertical}
          disabled={!canFlipSelection}
        >
          Flip V
        </button>
      </div>
      {selectionMode === 'marquee' && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-[1fr_64px] gap-2">
            <button
              type="button"
              className={ACTION_BUTTON_CLASS_NAME}
              onClick={handleInsetMarquee}
              disabled={!canInsetMarquee}
            >
              Inset
            </button>
            <CommittedNumberInput
              value={insetAmount}
              onCommit={setInsetAmount}
              min={1}
              step={1}
              title="Inset pixels"
              ariaLabel="Inset pixels"
              className="h-7 text-[11px]"
              disabled={!canAdjustMarquee}
            />
          </div>
          <div className="grid grid-cols-[1fr_64px] gap-2">
            <button
              type="button"
              className={ACTION_BUTTON_CLASS_NAME}
              onClick={handleExpandMarquee}
              disabled={!canAdjustMarquee || expandAmount <= 0}
            >
              Expand
            </button>
            <CommittedNumberInput
              value={expandAmount}
              onCommit={setExpandAmount}
              min={1}
              step={1}
              title="Expand pixels"
              ariaLabel="Expand pixels"
              className="h-7 text-[11px]"
              disabled={!canAdjustMarquee}
            />
          </div>
        </div>
      )}
      <button
        type="button"
        className={`mt-2 w-full ${ACTION_BUTTON_CLASS_NAME}`}
        onClick={invertSelection}
        disabled={!canInvertSelection}
      >
        Invert
      </button>
      {selectionMode === 'marquee' && (
        <button
          type="button"
          className={`mt-2 w-full ${ACTION_BUTTON_CLASS_NAME}`}
          onClick={handleCropSelection}
          disabled={!canCropSelection}
        >
          Crop
        </button>
      )}
      {selectionMode === 'magic-wand' && (
        <div className="mt-3 rounded border border-[#2F2F2F] bg-[#181818]">
          <MagicWandControls />
        </div>
      )}
      {HELP_TEXT[selectionMode] ? (
        <p className="mt-3 text-[10px] text-[#94A3B8] leading-snug">{HELP_TEXT[selectionMode]}</p>
      ) : null}
    </div>
  );
};

export default React.memo(SelectionOptionsPanel);
