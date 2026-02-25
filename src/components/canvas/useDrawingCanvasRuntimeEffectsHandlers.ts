import { buildDrawingCanvasRuntimeEffectsBridgeOptions } from './buildDrawingCanvasRuntimeEffectsBridgeOptions';
import {
  buildDrawingCanvasRuntimeEffectsInputHandlersOptions,
  type BuildDrawingCanvasRuntimeEffectsInputHandlersOptionsArgs,
} from './buildDrawingCanvasRuntimeEffectsInputHandlersOptions';
import {
  buildDrawingCanvasRuntimeEffectsKeyboardOptions,
  type BuildDrawingCanvasRuntimeEffectsKeyboardOptionsArgs,
} from './buildDrawingCanvasRuntimeEffectsKeyboardOptions';
import {
  buildDrawingCanvasRuntimeEffectsToolSyncOptions,
  type BuildDrawingCanvasRuntimeEffectsToolSyncOptionsArgs,
} from './buildDrawingCanvasRuntimeEffectsToolSyncOptions';
import {
  buildDrawingCanvasRuntimeEffectsRedrawArgs,
  type BuildDrawingCanvasRuntimeEffectsRedrawArgs,
} from './buildDrawingCanvasRuntimeEffectsRedrawArgs';
import {
  buildDrawingCanvasRuntimeEffectsUiArgs,
  type BuildDrawingCanvasRuntimeEffectsUiArgs,
} from './buildDrawingCanvasRuntimeEffectsUiArgs';
import { useDrawingCanvasRuntimeEffectsBridge } from './useDrawingCanvasRuntimeEffectsBridge';

type PointerUtilsOptions = Parameters<typeof buildDrawingCanvasRuntimeEffectsBridgeOptions>[0]['pointerUtilsOptions'];
type ShapeEditorBridgeOptions =
  Parameters<typeof buildDrawingCanvasRuntimeEffectsBridgeOptions>[0]['shapeEditorBridgeOptions'];

export interface UseDrawingCanvasRuntimeEffectsHandlersOptions {
  pointerUtilsOptions: PointerUtilsOptions;
  shapeEditorBridgeOptions: ShapeEditorBridgeOptions;
  inputHandlersArgs: BuildDrawingCanvasRuntimeEffectsInputHandlersOptionsArgs;
  keyboardArgs: BuildDrawingCanvasRuntimeEffectsKeyboardOptionsArgs;
  toolSyncOptions: BuildDrawingCanvasRuntimeEffectsToolSyncOptionsArgs;
  redrawArgs: BuildDrawingCanvasRuntimeEffectsRedrawArgs;
  uiArgs: BuildDrawingCanvasRuntimeEffectsUiArgs;
}

export const useDrawingCanvasRuntimeEffectsHandlers = ({
  pointerUtilsOptions,
  shapeEditorBridgeOptions,
  inputHandlersArgs,
  keyboardArgs,
  toolSyncOptions,
  redrawArgs,
  uiArgs,
}: UseDrawingCanvasRuntimeEffectsHandlersOptions) =>
  useDrawingCanvasRuntimeEffectsBridge(
    buildDrawingCanvasRuntimeEffectsBridgeOptions({
      pointerUtilsOptions,
      shapeEditorBridgeOptions,
      inputHandlersOptions: buildDrawingCanvasRuntimeEffectsInputHandlersOptions(inputHandlersArgs),
      keyboardOptions: buildDrawingCanvasRuntimeEffectsKeyboardOptions(keyboardArgs),
      toolSyncOptions: buildDrawingCanvasRuntimeEffectsToolSyncOptions(toolSyncOptions),
      ...buildDrawingCanvasRuntimeEffectsRedrawArgs(redrawArgs),
      ...buildDrawingCanvasRuntimeEffectsUiArgs(uiArgs),
    })
  );
