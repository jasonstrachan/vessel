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

export type StrokeSessionDispatchers = {
  beginStrokeSession: (options: BeginStrokeSessionOptions) => BrushStrokeSession;
  endStrokeSession: (endedAt?: number) => void;
  clearStrokeSession: () => void;
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

export const endStrokeSessionAndClearPointerDown = (
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>,
  isPointerDownRef: React.MutableRefObject<boolean>,
  endedAt?: number
): void => {
  endStrokeSession(activeStrokeSessionRef, endedAt);
  isPointerDownRef.current = false;
};

export const clearStrokeSession = (
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>
): void => {
  activeStrokeSessionRef.current = null;
};

export const clearStrokeSessionAndPointerDown = (
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>,
  isPointerDownRef: React.MutableRefObject<boolean>
): void => {
  clearStrokeSession(activeStrokeSessionRef);
  isPointerDownRef.current = false;
};

export const createStrokeSessionDispatchers = ({
  activeStrokeSessionRef,
  isPointerDownRef,
}: {
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>;
  isPointerDownRef: React.MutableRefObject<boolean>;
}): StrokeSessionDispatchers => ({
  beginStrokeSession: (options) => beginStrokeSession(options, activeStrokeSessionRef),
  endStrokeSession: (endedAt) =>
    endStrokeSessionAndClearPointerDown(activeStrokeSessionRef, isPointerDownRef, endedAt),
  clearStrokeSession: () => clearStrokeSessionAndPointerDown(activeStrokeSessionRef, isPointerDownRef),
});
