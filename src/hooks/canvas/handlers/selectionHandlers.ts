import type React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { captureSelectionSnapshot, commitSelectionHistory, cloneSelectionSnapshot } from '@/history/helpers/selectionHistory';
import { strokeCurrentMarqueePath } from '@/utils/marqueeStroke';
import type { InteractionAction, InteractionState } from '@/hooks/useCanvasInteraction';
import type { SelectionMode, Tool } from '@/types';
import type {
  EventHandlerDynamicDeps,
  SelectionRuntimeState,
} from '../utils/types';

type Point = { x: number; y: number };
type SelectionDynamicDeps = Pick<
  EventHandlerDynamicDeps,
  'tools' | 'selectionStart' | 'selectionEnd' | 'selectionMask' | 'selectionMaskBounds' | 'floatingPaste' | 'canvas' | 'project' | 'activeLayerId'
>;

export type SelectionHandlerDeps = {
  interaction: {
    state: InteractionState;
    dispatch: React.Dispatch<InteractionAction>;
    refs: {
      selectionStart: React.MutableRefObject<Point | null>;
    };
  };
  setSelectionBounds: (start: Point, end: Point) => void;
  clearSelection: () => void;
  setShowBrushCursor: React.Dispatch<React.SetStateAction<boolean>>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement>;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }) => void;
  updateBrushCursorVisibility: () => void;
  flushAndSetCurrentTool: (tool: Tool) => Promise<void> | void;
  selectionRuntimeRef: React.MutableRefObject<SelectionRuntimeState>;
};

export type SelectionHandlers = {
  handleSelectionHitTest: (args: {
    worldPos: Point;
    dynamic: SelectionDynamicDeps;
  }) => boolean;
  handleSelectionToolPointerDown: (args: {
    worldPos: Point;
    pointerId: number;
    clickCount: number;
    tools: SelectionDynamicDeps['tools'];
    dynamic: SelectionDynamicDeps;
  }) => boolean;
  handleSelectionClearOnOutsideClick: (args: {
    worldPos: Point;
    selectionStart: Point | null;
    selectionEnd: Point | null;
  }) => boolean;
  handleSelectionPointerMove: (args: {
    worldPos: Point;
  }) => boolean;
  handleSelectionPointerUp: (args: {
    event: React.PointerEvent<Element>;
    worldPos: Point;
    dynamic: SelectionDynamicDeps;
  }) => boolean;
};

const closePolygon = (points: Point[]): Point[] => {
  if (points.length < 2) {
    return points;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) {
    return points;
  }
  return [...points, first];
};

const currentSelectionMode = (tools: SelectionDynamicDeps['tools']): SelectionMode => {
  if (tools.currentTool === 'custom') {
    return 'marquee';
  }
  return tools.selectionMode ?? 'marquee';
};

const buildMaskFromPath = (
  points: Point[],
  project: SelectionDynamicDeps['project']
): { bounds: { x: number; y: number; width: number; height: number }; mask: ImageData } | null => {
  if (!project || points.length < 3 || typeof document === 'undefined') {
    return null;
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i += 1) {
    minX = Math.min(minX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxX = Math.max(maxX, points[i].x);
    maxY = Math.max(maxY, points[i].y);
  }

  const x = Math.max(0, Math.min(project.width, Math.floor(minX)));
  const y = Math.max(0, Math.min(project.height, Math.floor(minY)));
  const right = Math.max(0, Math.min(project.width, Math.ceil(maxX)));
  const bottom = Math.max(0, Math.min(project.height, Math.ceil(maxY)));
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  const closed = closePolygon(points);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(closed[0].x - x, closed[0].y - y);
  for (let i = 1; i < closed.length; i += 1) {
    ctx.lineTo(closed[i].x - x, closed[i].y - y);
  }
  ctx.closePath();
  ctx.fill();

  return {
    bounds: { x, y, width, height },
    mask: ctx.getImageData(0, 0, width, height),
  };
};

const applyMaskSelection = (
  dynamic: SelectionDynamicDeps,
  points: Point[],
  mode: 'freehand' | 'click-line'
): boolean => {
  const built = buildMaskFromPath(points, dynamic.project);
  if (!built) {
    useAppStore.getState().clearSelection();
    return false;
  }

  useAppStore.setState({
    selectionStart: { x: built.bounds.x, y: built.bounds.y },
    selectionEnd: { x: built.bounds.x + built.bounds.width, y: built.bounds.y + built.bounds.height },
    selectionVectorPath: {
      mode,
      points: points.map((point) => ({ x: point.x, y: point.y })),
    },
    selectionMask: built.mask,
    selectionMaskBounds: built.bounds,
    selectionMaskLayerId: dynamic.activeLayerId ?? null,
  });
  return true;
};

export type SelectionRuntimeDynamicDeps = SelectionDynamicDeps;

const commitRuntimeSelectionHistory = (
  runtime: SelectionRuntimeState,
  extraMeta: Record<string, unknown>
): void => {
  if (!runtime.pendingSelectionHistory) {
    return;
  }

  commitSelectionHistory({
    before: runtime.pendingSelectionHistory.before,
    description: runtime.pendingSelectionHistory.description,
    meta: {
      ...(runtime.pendingSelectionHistory.meta ?? {}),
      ...extraMeta,
    },
  });
  runtime.pendingSelectionHistory = null;
};

export const finalizeClickLineSelectionSession = ({
  runtime,
  dynamic,
  clearOverlay,
  outcome,
  historyMeta,
}: {
  runtime: SelectionRuntimeState;
  dynamic: SelectionRuntimeDynamicDeps;
  clearOverlay?: () => void;
  outcome: string;
  historyMeta?: Record<string, unknown>;
}): boolean => {
  if (!runtime.clickLineSession.active) {
    return false;
  }

  if (runtime.clickLineSession.points.length < 3) {
    return false;
  }

  const points = [...runtime.clickLineSession.points];
  runtime.clickLineSession.active = false;
  runtime.clickLineSession.points = [];
  clearOverlay?.();

  if (applyMaskSelection(dynamic, points, 'click-line')) {
    commitRuntimeSelectionHistory(runtime, {
      outcome,
      ...(historyMeta ?? {}),
    });
    return true;
  }

  runtime.pendingSelectionHistory = null;
  return false;
};

export const cancelClickLineSelectionSession = ({
  runtime,
  clearOverlay,
}: {
  runtime: SelectionRuntimeState;
  clearOverlay?: () => void;
}): boolean => {
  if (!runtime.clickLineSession.active) {
    return false;
  }

  runtime.clickLineSession.active = false;
  runtime.clickLineSession.points = [];
  runtime.pendingSelectionHistory = null;
  clearOverlay?.();
  return true;
};

export const createSelectionHandlers = (
  deps: SelectionHandlerDeps,
  getDynamicDeps: () => SelectionDynamicDeps
): SelectionHandlers => {
  const runtime = deps.selectionRuntimeRef.current;
  const { freehandSession, clickLineSession } = runtime;

  const clearOverlay = () => {
    const overlayCanvas = deps.overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (overlayCanvas && overlayCtx) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  };

  const drawPathPreview = (points: Point[], current?: Point) => {
    const overlayCanvas = deps.overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!overlayCanvas || !overlayCtx) {
      return;
    }

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (points.length === 0) {
      return;
    }

    const transform = deps.viewTransformRef.current;
    const safeScale = Math.max(0.001, transform.scale);
    const strokeWidth = Math.max(0.75, 1.5 / safeScale);

    overlayCtx.save();
    overlayCtx.translate(transform.offsetX, transform.offsetY);
    overlayCtx.scale(transform.scale, transform.scale);
    if (points.length > 1 || current) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        overlayCtx.lineTo(points[i].x, points[i].y);
      }
      if (current) {
        overlayCtx.lineTo(current.x, current.y);
      } else if (points.length > 2) {
        overlayCtx.closePath();
        overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        overlayCtx.fill();
      }

      // Match marquee visual language: white base + black marching ants.
      strokeCurrentMarqueePath(overlayCtx, {
        scale: safeScale,
        animated: false,
        lineWidthMultiplier: strokeWidth * safeScale,
      });
    }

    overlayCtx.restore();
  };

  const isClickLineModeActive = (): boolean => {
    const { tools } = getDynamicDeps();
    return tools.currentTool === 'selection' && currentSelectionMode(tools) === 'click-line';
  };

  const clearStaleClickLineSession = (): void => {
    if (!clickLineSession.active || isClickLineModeActive()) {
      return;
    }

    cancelClickLineSelectionSession({
      runtime,
      clearOverlay,
    });
    if (deps.interaction.state.isSelecting) {
      deps.interaction.dispatch({ type: 'SELECTION_END' });
    }
    deps.interaction.refs.selectionStart.current = null;
  };

  const beginHistory = (tools: SelectionDynamicDeps['tools'], pointerId: number) => {
    const beforeSelection = captureSelectionSnapshot();
    runtime.pendingSelectionHistory = {
      before: cloneSelectionSnapshot(beforeSelection),
      description: beforeSelection.start && beforeSelection.end ? 'Adjust selection' : 'Create selection',
      meta: {
        source: tools.currentTool === 'custom' ? 'custom-selection-tool' : 'selection-tool',
        pointerId,
      },
    };
  };

  const finishHistory = (pointerId: number, outcome: string) => {
    commitRuntimeSelectionHistory(runtime, { pointerId, outcome });
  };

  const handleSelectionHitTest = ({ worldPos, dynamic }: {
    worldPos: Point;
    dynamic: SelectionDynamicDeps;
  }): boolean => {
    clearStaleClickLineSession();
    const { selectionStart, selectionEnd, selectionMask, selectionMaskBounds, floatingPaste } = dynamic;
    const hasSelection = Boolean(selectionMask || (selectionStart && selectionEnd));
    if (!hasSelection || floatingPaste || clickLineSession.active) {
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
    clickCount,
    tools,
    dynamic,
  }: {
    worldPos: Point;
    pointerId: number;
    clickCount: number;
    tools: SelectionDynamicDeps['tools'];
    dynamic: SelectionDynamicDeps;
  }): boolean => {
    clearStaleClickLineSession();
    if (tools.currentTool !== 'selection' && tools.currentTool !== 'custom') {
      return false;
    }

    const mode = currentSelectionMode(tools);
    if (mode === 'click-line' && tools.currentTool === 'selection') {
      if (!clickLineSession.active) {
        beginHistory(tools, pointerId);
        clickLineSession.active = true;
        clickLineSession.points = [worldPos];
        drawPathPreview(clickLineSession.points);
        return true;
      }

      const first = clickLineSession.points[0];
      const dx = worldPos.x - first.x;
      const dy = worldPos.y - first.y;
      const hasEnoughPoints = clickLineSession.points.length >= 3;
      const nearStart = dx * dx + dy * dy <= 16 && hasEnoughPoints;
      const shouldClose = hasEnoughPoints && (clickCount >= 2 || nearStart);

      if (shouldClose) {
        return finalizeClickLineSelectionSession({
          runtime,
          dynamic,
          clearOverlay,
          outcome: 'selection-click-line',
          historyMeta: { pointerId },
        });
      }

      clickLineSession.points = [...clickLineSession.points, worldPos];
      drawPathPreview(clickLineSession.points);
      return true;
    }

    beginHistory(tools, pointerId);
    deps.interaction.dispatch({ type: 'SELECTION_START' });

    if (mode === 'freehand' && tools.currentTool === 'selection') {
      deps.interaction.refs.selectionStart.current = null;
      freehandSession.active = true;
      freehandSession.points = [worldPos];
      drawPathPreview(freehandSession.points);
      return true;
    }

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
    worldPos: Point;
    selectionStart: Point | null;
    selectionEnd: Point | null;
  }): boolean => {
    clearStaleClickLineSession();
    if (clickLineSession.active) {
      return true;
    }

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
      runtime.pendingSelectionHistory = null;
      return true;
    }

    return false;
  };

  const handleSelectionPointerMove = ({
    worldPos,
  }: {
    worldPos: Point;
  }): boolean => {
    clearStaleClickLineSession();
    if (clickLineSession.active) {
      drawPathPreview(clickLineSession.points, worldPos);
      return true;
    }

    if (freehandSession.active) {
      const points = freehandSession.points;
      const last = points[points.length - 1];
      const dx = worldPos.x - last.x;
      const dy = worldPos.y - last.y;
      if (dx * dx + dy * dy >= 0.25) {
        points.push(worldPos);
        drawPathPreview(points);
      }
      return true;
    }

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
    worldPos: rawWorldPos,
    dynamic,
  }: {
    event: React.PointerEvent<Element>;
    worldPos: Point;
    dynamic: SelectionDynamicDeps;
  }): boolean => {
    clearStaleClickLineSession();
    if (clickLineSession.active) {
      return true;
    }

    if (freehandSession.active) {
      let worldPos = rawWorldPos;
      if (dynamic.project) {
        worldPos = {
          x: Math.max(0, Math.min(dynamic.project.width - 1, worldPos.x)),
          y: Math.max(0, Math.min(dynamic.project.height - 1, worldPos.y)),
        };
      }

      if (deps.interaction.state.isSelecting) {
        deps.interaction.dispatch({ type: 'SELECTION_END' });
      }
      const points = [...freehandSession.points, worldPos];
      freehandSession.active = false;
      freehandSession.points = [];
      clearOverlay();
      if (applyMaskSelection(dynamic, points, 'freehand')) {
        finishHistory(event.pointerId, 'selection-freehand');
      } else {
        runtime.pendingSelectionHistory = null;
      }
      deps.interaction.refs.selectionStart.current = null;
      return true;
    }

    if (!deps.interaction.state.isSelecting) {
      return false;
    }

    deps.interaction.dispatch({ type: 'SELECTION_END' });
    let worldPos = rawWorldPos;

    if (dynamic.project) {
      worldPos = {
        x: Math.max(0, Math.min(dynamic.project.width - 1, worldPos.x)),
        y: Math.max(0, Math.min(dynamic.project.height - 1, worldPos.y)),
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

    finishHistory(
      event.pointerId,
      dynamic.tools.currentTool === 'custom' ? 'custom-selection' : 'selection'
    );

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
