import type React from 'react';

import type { Tool } from '@/types';

export type BrushStrokeSession = {
  id: string;
  pointerId: number | string;
  layerId: string | null;
  tool: Tool | 'eraser';
  brushId?: string | null;
  startedAt: number;
  endedAt: number | null;
};

export type BeginStrokeSessionOptions = {
  id?: string;
  pointerId: number | string;
  layerId: string | null;
  tool: Tool | 'eraser';
  brushId?: string | null;
  startedAt?: number;
};

export const beginStrokeSession = (
  options: BeginStrokeSessionOptions,
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>
): BrushStrokeSession => {
  const now = Date.now();
  const session: BrushStrokeSession = {
    id:
      options.id ??
      `stroke-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pointerId: options.pointerId,
    layerId: options.layerId,
    tool: options.tool,
    brushId: options.brushId,
    startedAt: options.startedAt ?? now,
    endedAt: null,
  };
  activeStrokeSessionRef.current = session;
  return session;
};

export const endStrokeSession = (
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>,
  endedAt?: number
): void => {
  if (activeStrokeSessionRef.current) {
    activeStrokeSessionRef.current.endedAt = endedAt ?? Date.now();
  }
};

export const clearStrokeSession = (
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>
): void => {
  activeStrokeSessionRef.current = null;
};
