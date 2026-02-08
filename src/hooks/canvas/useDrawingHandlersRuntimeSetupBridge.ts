import { buildDrawingHandlersRuntimeBridgeArgs } from '@/hooks/canvas/buildDrawingHandlersRuntimeBridgeArgs';
import { useDrawingHandlersRuntimeBridge } from '@/hooks/canvas/useDrawingHandlersRuntimeBridge';
import type {
  UseDrawingHandlersRuntimeSetupBridgeOptions,
  UseDrawingHandlersRuntimeSetupBridgeResult,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

export const useDrawingHandlersRuntimeSetupBridge = (
  options: UseDrawingHandlersRuntimeSetupBridgeOptions
): UseDrawingHandlersRuntimeSetupBridgeResult =>
  useDrawingHandlersRuntimeBridge(buildDrawingHandlersRuntimeBridgeArgs(options));
