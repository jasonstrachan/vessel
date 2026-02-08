import { useMemo } from 'react';
import type React from 'react';
import { useDrawingPlaybackRuntime } from '@/hooks/canvas/useDrawingPlaybackRuntime';
import { createFeedbackCallbackSetter } from '@/hooks/canvas/handlers/buildDrawingHandlersResult';

type PlaybackRuntimeArgs = Parameters<typeof useDrawingPlaybackRuntime>[0];

interface UseDrawingPlaybackHandlersBridgeOptions {
  playbackRuntimeOptions: PlaybackRuntimeArgs;
  feedbackMessageRef: React.MutableRefObject<((message: string) => void) | null>;
}

export const useDrawingPlaybackHandlersBridge = ({
  playbackRuntimeOptions,
  feedbackMessageRef,
}: UseDrawingPlaybackHandlersBridgeOptions) => {
  const { startContinuousColorCycleAnimation } = useDrawingPlaybackRuntime(
    playbackRuntimeOptions
  );
  const setFeedbackCallback = useMemo(
    () => createFeedbackCallbackSetter(feedbackMessageRef),
    [feedbackMessageRef]
  );

  return { startContinuousColorCycleAnimation, setFeedbackCallback };
};
