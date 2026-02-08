import {
  buildDrawingHandlersResult,
} from '@/hooks/canvas/handlers/buildDrawingHandlersResult';

export const useDrawingHandlersResultBridge = <T extends Record<string, unknown>>(
  args: T
): T => buildDrawingHandlersResult(args);
