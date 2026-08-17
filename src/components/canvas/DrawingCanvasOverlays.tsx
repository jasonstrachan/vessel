import type React from 'react';

import {
  stopVesselMultiplayerSession,
  useVesselMultiplayerSnapshot,
} from '@/collaboration/vesselMultiplayerSession';
import studioExtension from '@/extensions/studioExtension';
import { useAppStore } from '@/stores/useAppStore';
import { selectGridState } from '@/stores/selectors/stateSelectors';
import type { Tool } from '@/types';

import CropOverlay from './CropOverlay';
import FloatingPasteOverlay from './FloatingPasteOverlay';
import GridOverlay from './GridOverlay';
import SelectionMarqueeHandles from './SelectionMarqueeHandles';

interface DrawingCanvasOverlaysProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  project: { width: number; height: number } | null;
  floatingPaste: unknown;
  canvasZoom: number;
  offsetX: number;
  offsetY: number;
  currentTool: Tool;
  isSpacePressed: boolean;
  displayProjectName: string;
}

export const DrawingCanvasOverlays = ({
  canvasRef,
  project,
  floatingPaste,
  canvasZoom,
  offsetX,
  offsetY,
  currentTool,
  isSpacePressed,
  displayProjectName,
}: DrawingCanvasOverlaysProps) => {
  const StudioCanvasOverlay = studioExtension.CanvasOverlay;
  const grid = useAppStore(selectGridState);
  const setZoom = useAppStore((state) => state.setZoom);
  const multiplayer = useVesselMultiplayerSnapshot();
  const aiCursor = multiplayer.aiCursor;
  const showSession = multiplayer.status !== 'idle';
  const canStop = multiplayer.status === 'active' || multiplayer.status === 'stopping';
  const multiplayerStateLabel = multiplayer.status === 'active'
    ? multiplayer.bridgeStatus === 'connected'
      ? multiplayer.aiState
      : multiplayer.bridgeStatus
    : multiplayer.status;

  return (
    <>
      {project && StudioCanvasOverlay ? (
        <StudioCanvasOverlay
          canvasRef={canvasRef}
          zoom={canvasZoom || 1}
          offsetX={offsetX}
          offsetY={offsetY}
        />
      ) : null}

      {project && floatingPaste ? (
        <FloatingPasteOverlay
          projectWidth={project.width}
          projectHeight={project.height}
          zoom={canvasZoom || 1}
          offsetX={offsetX}
          offsetY={offsetY}
        />
      ) : null}

      {project ? (
        <SelectionMarqueeHandles
          zoom={canvasZoom || 1}
          offsetX={offsetX}
          offsetY={offsetY}
          projectWidth={project.width}
          projectHeight={project.height}
        />
      ) : null}

      {project ? (
        <GridOverlay
          enabled={grid.enabled}
          projectWidth={project.width}
          projectHeight={project.height}
          zoom={canvasZoom || 1}
          offsetX={offsetX}
          offsetY={offsetY}
          rows={grid.rows}
          columns={grid.columns}
        />
      ) : null}

      {currentTool === 'crop' && project ? (
        <CropOverlay
          active
          projectWidth={project.width}
          projectHeight={project.height}
          zoom={canvasZoom || 1}
          offsetX={offsetX}
          offsetY={offsetY}
          isSpacePressed={isSpacePressed}
        />
      ) : null}

      {showSession ? (
        <div
          className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2 bg-black/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white"
          data-testid="multiplayer-status"
          aria-live="polite"
          title={multiplayer.error ?? multiplayer.bridgeError ?? undefined}
        >
          <span className="text-[#52e5ff]">Jason</span>
          <span className="text-[#7d7d7d]">+</span>
          <span className="text-[#ff4fd8]">AI</span>
          <span className="text-[#b5b5b5]">
            {multiplayerStateLabel}
          </span>
          {canStop && multiplayer.sessionId ? (
            <button
              type="button"
              className="ml-1 border border-[#ff4fd8] bg-transparent px-2 py-1 text-[#ff9bea] hover:bg-[#ff4fd8]/20"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                stopVesselMultiplayerSession({
                  sessionId: multiplayer.sessionId!,
                  reason: 'Stopped from the Vessel canvas',
                });
              }}
              aria-label="Stop AI multiplayer painting"
            >
              Stop AI
            </button>
          ) : null}
        </div>
      ) : null}

      {project && aiCursor?.visible && showSession ? (
        <div
          className="pointer-events-none absolute z-[1001]"
          style={{
            left: offsetX + aiCursor.x * (canvasZoom || 1),
            top: offsetY + aiCursor.y * (canvasZoom || 1),
            transform: 'translate(-50%, -50%)',
          }}
          data-testid="multiplayer-ai-cursor"
          aria-hidden="true"
        >
          <div className={`h-5 w-5 border-2 border-[#ff4fd8] ${aiCursor.drawing ? 'bg-[#ff4fd8]/20' : ''}`} />
          <div className="absolute left-6 top-3 bg-black/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#ff4fd8]">
            AI
          </div>
        </div>
      ) : null}

      <div className="absolute bottom-4 right-4 flex items-center gap-2 text-[#b5b5b5] text-xs">
        <div className="bg-black/60 px-2 py-1 rounded max-w-[240px] truncate" title={displayProjectName}>
          {displayProjectName}
        </div>
        <button
          type="button"
          className="bg-black/60 px-2 py-1 rounded min-w-[58px] text-center cursor-pointer select-none hover:bg-black/75 transition-colors"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setZoom(1);
          }}
          aria-label="Reset canvas zoom to 100%"
          title="Double-click to reset zoom to 100%"
        >
          {Math.round((canvasZoom || 1) * 100)}%
        </button>
      </div>
    </>
  );
};
