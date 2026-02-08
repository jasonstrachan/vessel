import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { Tool } from '@/types';

export const beginStrokeStartSession = ({
  isPointerDownRef,
  beginStrokeSession,
  activeLayerId,
  currentTool,
  currentBrushId,
  ensureOverlayInitialized,
}: {
  isPointerDownRef: React.MutableRefObject<boolean>;
  beginStrokeSession: (args: {
    pointerId: number;
    layerId: string | null;
    tool: Tool | 'eraser';
    brushId: string | null;
  }) => void;
  activeLayerId: AppState['activeLayerId'];
  currentTool: Tool | 'eraser';
  currentBrushId: string | null;
  ensureOverlayInitialized: () => void;
}): void => {
  isPointerDownRef.current = true;
  beginStrokeSession({
    pointerId: 0,
    layerId: activeLayerId ?? null,
    tool: currentTool,
    brushId: currentBrushId ?? null,
  });
  ensureOverlayInitialized();
};
