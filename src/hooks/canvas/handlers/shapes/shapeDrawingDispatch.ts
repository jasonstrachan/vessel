import type React from 'react';
import {
  continueShapeDrawing as continueShapeDrawingExternal,
  finalizeShapeDrawing as finalizeShapeDrawingExternal,
  startShapeDrawing as startShapeDrawingExternal,
} from './shapeDrawing';

type StartArgs = Parameters<typeof startShapeDrawingExternal>[0];
type StartDeps = Parameters<typeof startShapeDrawingExternal>[1];
type ContinueArgs = Parameters<typeof continueShapeDrawingExternal>[0];
type ContinueDeps = Parameters<typeof continueShapeDrawingExternal>[1];
type FinalizeArgs = Parameters<typeof finalizeShapeDrawingExternal>[0];
type FinalizeDeps = Parameters<typeof finalizeShapeDrawingExternal>[1];
type WorldPos = { x: number; y: number };
type DrawOptions = { renderPreview?: boolean };

export const dispatchStartShapeDrawing = (
  args: Omit<StartArgs, 'refs'> & { refs: StartArgs['refs'] },
  deps: StartDeps
) => {
  startShapeDrawingExternal(args, deps);
};

export const dispatchContinueShapeDrawing = (
  args: Omit<ContinueArgs, 'refs'> & { refs: ContinueArgs['refs'] },
  deps: ContinueDeps
) => {
  continueShapeDrawingExternal(args, deps);
};

export const dispatchFinalizeShapeDrawing = async (
  args: Omit<FinalizeArgs, 'refs'> & { refs: FinalizeArgs['refs'] },
  deps: FinalizeDeps,
  isPointerDownRef: React.MutableRefObject<boolean>
) => {
  try {
    await finalizeShapeDrawingExternal(args, deps);
  } finally {
    isPointerDownRef.current = false;
  }
};

interface CreateShapeDrawingDispatchersOptions {
  shapeMode: boolean;
  shapeDrawingRefs: StartArgs['refs'];
  shapeDrawingDeps: StartDeps;
  toolsRef: FinalizeArgs['toolsRef'];
  isPointerDownRef: React.MutableRefObject<boolean>;
}

export const createShapeDrawingDispatchers = ({
  shapeMode,
  shapeDrawingRefs,
  shapeDrawingDeps,
  toolsRef,
  isPointerDownRef,
}: CreateShapeDrawingDispatchersOptions) => {
  const startShapeDrawing = (
    worldPos: WorldPos,
    pressure: number = 0,
    timestamp?: number,
    rawPressure?: number,
    options?: DrawOptions
  ) => {
    isPointerDownRef.current = true;
    dispatchStartShapeDrawing(
      {
        worldPos,
        pressure,
        timestamp,
        rawPressure,
        shapeMode,
        refs: shapeDrawingRefs,
        renderPreview: options?.renderPreview,
      },
      shapeDrawingDeps
    );
  };

  const continueShapeDrawing = (
    worldPos: WorldPos,
    pressure: number = 0,
    timestamp?: number,
    rawPressure?: number,
    options?: DrawOptions
  ) => {
    dispatchContinueShapeDrawing(
      {
        worldPos,
        pressure,
        timestamp,
        rawPressure,
        shapeMode,
        refs: shapeDrawingRefs,
        renderPreview: options?.renderPreview,
      },
      shapeDrawingDeps
    );
  };

  const finalizeShapeDrawing = async () =>
    dispatchFinalizeShapeDrawing(
      {
        shapeMode,
        refs: shapeDrawingRefs,
        toolsRef,
      },
      shapeDrawingDeps,
      isPointerDownRef
    );

  return {
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
  };
};
