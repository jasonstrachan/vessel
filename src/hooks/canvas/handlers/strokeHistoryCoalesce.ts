import type React from 'react';
import type { Tool } from '@/types';

type StrokeSession = {
  id: string;
  layerId: string | null;
  tool: Tool | 'eraser';
  pointerId: number | string;
  startedAt: number;
  endedAt: number | null;
};

export type StrokeCoalescePayload = {
  key: string;
  maxIntervalMs: number;
  pointerSession: {
    pointerId: number | string;
    startedAt: number;
    endedAt: number;
  };
};

export const buildStrokeCoalescePayload = ({
  activeStrokeSessionRef,
  endStrokeSession,
  activeLayerId,
  currentTool,
  maxIntervalMs,
}: {
  activeStrokeSessionRef: React.MutableRefObject<StrokeSession | null>;
  endStrokeSession: () => void;
  activeLayerId: string;
  currentTool: Tool | 'eraser';
  maxIntervalMs: number;
}): StrokeCoalescePayload | undefined => {
  const strokeSession = activeStrokeSessionRef.current;
  if (strokeSession && strokeSession.endedAt == null) {
    endStrokeSession();
  }
  const shouldCoalesceStroke =
    strokeSession &&
    strokeSession.layerId === activeLayerId &&
    strokeSession.tool === currentTool &&
    (currentTool === 'brush' || currentTool === 'eraser');
  if (!shouldCoalesceStroke) {
    return undefined;
  }
  return {
    key: strokeSession.id,
    maxIntervalMs,
    pointerSession: {
      pointerId: strokeSession.pointerId,
      startedAt: strokeSession.startedAt,
      endedAt: strokeSession.endedAt ?? Date.now(),
    },
  };
};
