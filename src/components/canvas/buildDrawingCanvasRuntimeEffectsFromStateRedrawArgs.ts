import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';

type BuildArgs = UseDrawingCanvasRuntimeEffectsFromStateOptions;

export const buildDrawingCanvasRuntimeEffectsFromStateRedrawArgs = ({
  state,
  visualRuntime,
  renderRuntime,
}: BuildArgs): UseDrawingCanvasRuntimeEffectsHandlersOptions['redrawArgs'] => ({
  redrawBase: {
    layersNeedRecomposition: state.layersNeedRecomposition,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    hadSelectionRef: state.hadSelectionRef,
    refreshColorCycleSegments: visualRuntime.refreshColorCycleSegments,
  },
  compositeBase: {
    project: state.project,
    activeLayerId: state.activeLayerId,
    layersHash: renderRuntime.layersHash,
    layersNeedRecomposition: state.layersNeedRecomposition,
    compositeCanvasDirtyRef: state.compositeCanvasDirtyRef,
    lastCompositeHashRef: state.lastCompositeHashRef,
    lastActiveLayerIdRef: state.lastActiveLayerIdRef,
    lastSampleRef: renderRuntime.lastSampleRef,
    preferReferenceSampling: state.preferReferenceSampling,
    rebuildStaticComposite: renderRuntime.rebuildStaticComposite,
    renderSplitComposites: renderRuntime.renderSplitComposites,
  },
  redrawShared: {
    setLayersNeedRecomposition: state.setLayersNeedRecomposition,
    setNeedsRedraw: state.setNeedsRedraw,
  },
});
