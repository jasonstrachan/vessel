import type React from 'react';

export const createFeedbackCallbackSetter = (
  feedbackMessageRef: React.MutableRefObject<((message: string) => void) | null>
) => {
  return (callback: (message: string) => void) => {
    feedbackMessageRef.current = callback;
  };
};

export const buildDrawingHandlersResult = <
  T extends Record<string, unknown>
>(
  handlers: T
): T => handlers;
