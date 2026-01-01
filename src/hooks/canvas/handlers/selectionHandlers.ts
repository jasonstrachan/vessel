import type React from 'react';
import { captureSelectionSnapshot, commitSelectionHistory, cloneSelectionSnapshot } from '@/history/helpers/selectionHistory';
import type { SelectionSnapshot } from '@/history/selectionState';
import type { InteractionAction, InteractionState } from '@/hooks/useCanvasInteraction';
import type { Tool } from '@/types';
import type { EventHandlerDynamicDeps } from '../utils/types';

export type SelectionHandlerDeps = {
  interaction: {
    state: InteractionState;
    dispatch: React.Dispatch<InteractionAction>;
    refs: {
      selectionStart: React.MutableRefObject<{ x: number; y: number } | null>;
    };
  };
  setSelectionBounds: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  clearSelection: () => void;
  setShowBrushCursor: React.Dispatch<React.SetStateAction<boolean>>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }) => void;
  updateBrushCursorVisibility: () => void;
  flushAndSetCurrentTool: (tool: Tool) => Promise<void> | void;
};

type SelectionDynamicDeps = Pick<
  EventHandlerDynamicDeps,
  'tools' | 'selectionStart' | 'selectionEnd' | 'selectionMask' | 'selectionMaskBounds' | 'floatingPaste' | 'canvas' | 'project' | 'activeLayerId'
>;

type PendingSelectionHistory =
  | {
      before: SelectionSnapshot;
      description: string;
      meta?: Record<string, unknown>;
    }
  | null;

export type SelectionHandlers = {
  handleSelectionHitTest: (args: {
    worldPos: { x: number; y: number };
    dynamic: SelectionDynamicDeps;
  }) => boolean;
  handleSelectionToolPointerDown: (args: {
    worldPos: { x: number; y: number };
    pointerId: number;
    tools: SelectionDynamicDeps['tools'];
  }) => boolean;
  handleSelectionClearOnOutsideClick: (args: {
    worldPos: { x: number; y: number };
    selectionStart: { x: number; y: number } | null;
    selectionEnd: { x: number; y: number } | null;
  }) => boolean;
  handleSelectionPointerMove: (args: {
    worldPos: { x: number; y: number };
  }) => boolean;
  handleSelectionPointerUp: (args: {
    event: React.PointerEvent<HTMLCanvasElement>;
    mousePos: { x: number; y: number };
    pan: { screenToWorld: (x: number, y: number, scale: number) => { x: number; y: number } };
    dynamic: SelectionDynamicDeps;
  }) => boolean;
};

export const createSelectionHandlers = (
  deps: SelectionHandlerDeps,
  getDynamicDeps: () => SelectionDynamicDeps
): SelectionHandlers => {
  void getDynamicDeps;
  let pendingSelectionHistory: PendingSelectionHistory = null;

  const handleSelectionHitTest = ({ worldPos, dynamic }: {
    worldPos: { x: number; y: number };
    dynamic: SelectionDynamicDeps;
  }): boolean => {
    const { selectionStart, selectionEnd, selectionMask, selectionMaskBounds, floatingPaste } = dynamic;
    const hasSelection = Boolean(selectionMask || (selectionStart && selectionEnd));
    if (!hasSelection || floatingPaste) {
      return false;
    }

    let hit = false;
    if (selectionMask && selectionMaskBounds) {
      const localX = worldPos.x - selectionMaskBounds.x;
      const localY = worldPos.y - selectionMaskBounds.y;
      if (localX >= 0 && localY >= 0 && localX < selectionMask.width && localY < selectionMask.height) {
        const idx = (Math.floor(localY) * selectionMask.width + Math.floor(localX)) * 4 + 3;
        hit = selectionMask.data[idx] > 0;
      }
    } else if (selectionStart && selectionEnd) {
      hit = worldPos.x >= Math.min(selectionStart.x, selectionEnd.x) &&
        worldPos.x <= Math.max(selectionStart.x, selectionEnd.x) &&
        worldPos.y >= Math.min(selectionStart.y, selectionEnd.y) &&
        worldPos.y <= Math.max(selectionStart.y, selectionEnd.y);
    }

    if (!hit) {
      deps.clearSelection();
      return true;
    }

    return false;
  };

  const handleSelectionToolPointerDown = ({
    worldPos,
    pointerId,
    tools,
  }: {
    worldPos: { x: number; y: number };
    pointerId: number;
    tools: SelectionDynamicDeps['tools'];
  }): boolean => {
    if (tools.currentTool !== 'selection' && tools.currentTool !== 'custom') {
      return false;
    }

    const beforeSelection = captureSelectionSnapshot();
    pendingSelectionHistory = {
      before: cloneSelectionSnapshot(beforeSelection),
      description: beforeSelection.start && beforeSelection.end ? 'Adjust selection' : 'Create selection',
      meta: {
        source: tools.currentTool === 'custom' ? 'custom-selection-tool' : 'selection-tool',
        pointerId,
      },
    };
    deps.interaction.dispatch({ type: 'SELECTION_START' });
    deps.interaction.refs.selectionStart.current = worldPos;
    deps.setSelectionBounds(worldPos, worldPos);
    if (tools.currentTool === 'custom') {
      deps.setShowBrushCursor(false);
    }
    return true;
  };

  const handleSelectionClearOnOutsideClick = ({
    worldPos,
    selectionStart,
    selectionEnd,
  }: {
    worldPos: { x: number; y: number };
    selectionStart: { x: number; y: number } | null;
    selectionEnd: { x: number; y: number } | null;
  }): boolean => {
    if (!selectionStart || !selectionEnd) {
      return false;
    }

    const minX = Math.min(selectionStart.x, selectionEnd.x);
    const maxX = Math.max(selectionStart.x, selectionEnd.x);
    const minY = Math.min(selectionStart.y, selectionEnd.y);
    const maxY = Math.max(selectionStart.y, selectionEnd.y);

    if (worldPos.x < minX || worldPos.x > maxX || worldPos.y < minY || worldPos.y > maxY) {
      const beforeSelection = captureSelectionSnapshot();
      deps.clearSelection();
      commitSelectionHistory({
        before: beforeSelection,
        description: 'Clear selection',
        meta: { source: 'click-outside' },
      });
      pendingSelectionHistory = null;
      return true;
    }

    return false;
  };

  const handleSelectionPointerMove = ({
    worldPos,
  }: {
    worldPos: { x: number; y: number };
  }): boolean => {
    if (!deps.interaction.state.isSelecting) {
      return false;
    }

    if (deps.interaction.refs.selectionStart.current) {
      deps.setSelectionBounds(deps.interaction.refs.selectionStart.current, worldPos);
    }
    const canvas = deps.canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      deps.draw(ctx, deps.viewTransformRef.current);
    }
    return true;
  };

  const handleSelectionPointerUp = ({
    event,
    mousePos,
    pan,
    dynamic,
  }: {
    event: React.PointerEvent<HTMLCanvasElement>;
    mousePos: { x: number; y: number };
    pan: { screenToWorld: (x: number, y: number, scale: number) => { x: number; y: number } };
    dynamic: SelectionDynamicDeps;
  }): boolean => {
    if (!deps.interaction.state.isSelecting) {
      return false;
    }

    deps.interaction.dispatch({ type: 'SELECTION_END' });
    const scale = dynamic.canvas?.zoom || 1;
    let worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);

    if (dynamic.project) {
      worldPos = {
        x: Math.max(0, Math.min(dynamic.project.width - 1, worldPos.x)),
        y: Math.max(0, Math.min(dynamic.project.height - 1, worldPos.y))
      };
    }

    if (deps.interaction.refs.selectionStart.current) {
      deps.setSelectionBounds(deps.interaction.refs.selectionStart.current, worldPos);
      if (dynamic.tools.currentTool === 'custom') {
        void deps.flushAndSetCurrentTool('brush');
        deps.clearSelection();
        deps.updateBrushCursorVisibility();
      }
    }

    if (pendingSelectionHistory) {
      commitSelectionHistory({
        before: pendingSelectionHistory.before,
        description: pendingSelectionHistory.description,
        meta: {
          ...(pendingSelectionHistory.meta ?? {}),
          pointerId: event.pointerId,
          outcome: dynamic.tools.currentTool === 'custom' ? 'custom-selection' : 'selection',
        },
      });
      pendingSelectionHistory = null;
    }

    deps.interaction.refs.selectionStart.current = null;
    return true;
  };

  return {
    handleSelectionHitTest,
    handleSelectionToolPointerDown,
    handleSelectionClearOnOutsideClick,
    handleSelectionPointerMove,
    handleSelectionPointerUp,
  };
};
