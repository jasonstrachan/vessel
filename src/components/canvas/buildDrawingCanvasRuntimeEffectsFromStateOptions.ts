import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';
import {
  buildDrawingCanvasRuntimeEffectsFromStatePointerOptions,
  buildDrawingCanvasRuntimeEffectsFromStateShapeEditorOptions,
} from './buildDrawingCanvasRuntimeEffectsFromStatePointerOptions';
import { buildDrawingCanvasRuntimeEffectsFromStateInputArgs } from './buildDrawingCanvasRuntimeEffectsFromStateInputArgs';
import { buildDrawingCanvasRuntimeEffectsFromStateKeyboardArgs } from './buildDrawingCanvasRuntimeEffectsFromStateKeyboardArgs';
import { buildDrawingCanvasRuntimeEffectsFromStateToolSyncOptions } from './buildDrawingCanvasRuntimeEffectsFromStateToolSyncOptions';
import { buildDrawingCanvasRuntimeEffectsFromStateRedrawArgs } from './buildDrawingCanvasRuntimeEffectsFromStateRedrawArgs';
import { buildDrawingCanvasRuntimeEffectsFromStateUiArgs } from './buildDrawingCanvasRuntimeEffectsFromStateUiArgs';

export const buildDrawingCanvasRuntimeEffectsFromStateOptions = (
  options: UseDrawingCanvasRuntimeEffectsFromStateOptions
): UseDrawingCanvasRuntimeEffectsHandlersOptions => ({
  pointerUtilsOptions: buildDrawingCanvasRuntimeEffectsFromStatePointerOptions(options),
  shapeEditorBridgeOptions: buildDrawingCanvasRuntimeEffectsFromStateShapeEditorOptions(options),
  inputHandlersArgs: buildDrawingCanvasRuntimeEffectsFromStateInputArgs(options),
  keyboardArgs: buildDrawingCanvasRuntimeEffectsFromStateKeyboardArgs(options),
  toolSyncOptions: buildDrawingCanvasRuntimeEffectsFromStateToolSyncOptions(options),
  redrawArgs: buildDrawingCanvasRuntimeEffectsFromStateRedrawArgs(options),
  uiArgs: buildDrawingCanvasRuntimeEffectsFromStateUiArgs(options),
});
