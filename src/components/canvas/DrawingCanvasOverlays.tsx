import type { Tool } from '@/types';
import CropOverlay from './CropOverlay';
import FloatingPasteOverlay from './FloatingPasteOverlay';
import GridOverlay from './GridOverlay';
import SelectionMarqueeHandles from './SelectionMarqueeHandles';
import { useAppStore } from '@/stores/useAppStore';
import { selectGridState } from '@/stores/selectors/stateSelectors';

interface DrawingCanvasOverlaysProps {
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
  project,
  floatingPaste,
  canvasZoom,
  offsetX,
  offsetY,
  currentTool,
  isSpacePressed,
  displayProjectName,
}: DrawingCanvasOverlaysProps) => {
  const grid = useAppStore(selectGridState);
  const setZoom = useAppStore((state) => state.setZoom);

  return (
    <>
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
