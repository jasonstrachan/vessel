import type {
  StampDitherState,
  StampDitherStrokeData,
} from './strokeStampDither';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export type ColorCycleStampDitherStrokeData = StampDitherStrokeData & {
  flowBuffer?: Uint8Array;
  phaseBuffer?: Uint8Array;
};

export type ColorCycleExternalBaseContext = {
  ensureStrokeState(layerId: string): LayerStrokeState;
  setStrokeState(layerId: string, strokeData: LayerStrokeState): void;
};

export function markColorCycleLayerHasExternalBase(
  context: ColorCycleExternalBaseContext,
  layerId: string,
): void {
  if (!layerId) {
    return;
  }
  const strokeData = context.ensureStrokeState(layerId);
  strokeData.externalBase.hasExternalBase = true;
  context.setStrokeState(layerId, strokeData);
}

export function ensureColorCycleStampDitherState(
  strokeData: LayerStrokeState,
): StampDitherState {
  if (!strokeData.stampDither) {
    strokeData.stampDither = {};
  }
  return strokeData.stampDither;
}

export function getColorCycleStampDitherStrokeData(
  strokeData: LayerStrokeState,
): ColorCycleStampDitherStrokeData {
  const stampDither = ensureColorCycleStampDitherState(strokeData);
  const stampStroke = stampDither as ColorCycleStampDitherStrokeData;
  stampStroke.paint = strokeData.buffers.paint;
  stampStroke.gradientIdBuffer = strokeData.buffers.gid;
  stampStroke.gradientDefIdBuffer = strokeData.buffers.def;
  stampStroke.speedBuffer = strokeData.buffers.spd;
  stampStroke.flowBuffer = strokeData.buffers.flow;
  stampStroke.phaseBuffer = strokeData.buffers.phase;
  return stampStroke;
}

export function markColorCycleStrokeStateContentWritten(
  strokeData: LayerStrokeState | undefined,
): void {
  if (!strokeData) {
    return;
  }
  strokeData.hasContent = true;
  strokeData.contentIsOptimistic = false;
}
