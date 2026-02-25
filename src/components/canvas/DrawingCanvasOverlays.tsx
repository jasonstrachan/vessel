import type { Tool } from '@/types';
import CropOverlay from './CropOverlay';
import FloatingPasteOverlay from './FloatingPasteOverlay';
import SelectionMarqueeHandles from './SelectionMarqueeHandles';

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
}: DrawingCanvasOverlaysProps) => (
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
      <div className="bg-black/60 px-2 py-1 rounded min-w-[58px] text-center">
        {Math.round((canvasZoom || 1) * 100)}%
      </div>
    </div>
  </>
);
