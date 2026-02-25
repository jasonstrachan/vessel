/**
 * Vessel Color Cycle Animation Library
 * Efficient indexed color drawing with animated gradients
 */

// Core components
export { IndexBuffer } from './IndexBuffer';
export { GradientPalette } from './GradientPalette';
export { AnimationController } from './AnimationController';

// Integration layers
export { ColorCycleRenderer } from './ColorCycleRenderer';
export { ColorCycleAnimator } from './ColorCycleAnimator';
export type { CCIndexSurface, CCIndexSurfaceRect } from './colorCycle/CCIndexSurface';
export { SequentialEventLog } from './sequential/SequentialEventLog';
export { SequentialFrameCache } from './sequential/SequentialFrameCache';
export {
  decodeSequentialChunksToEvents,
  encodeSequentialEventsToChunks,
} from './sequential/SequentialStrokeChunk';
export type {
  SerializedSequentialStrokeChunkV1,
  SequentialChunkEncodeResult,
  SequentialStrokeChunkHeaderV1,
} from './sequential/SequentialStrokeChunk';
export {
  appendSequentialEventPayloadBytes,
  createSequentialPayloadBudgetRuntime,
  estimateSequentialLayerPayloadBytes,
  estimateSequentialProjectPayloadBytes,
  estimateSequentialStrokeEventPayloadBytes,
  readSequentialProjectPayloadBytes,
  resetSequentialPayloadBudgetRuntime,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
} from './sequential/SequentialPayloadBudget';
export { SequentialCpuMaterializer } from './sequential/materializer/SequentialCpuMaterializer';
export { SequentialGpuMaterializer } from './sequential/materializer/SequentialGpuMaterializer';
export type {
  SequentialMaterializerBackend,
  SequentialMaterializerBackendKind,
} from './sequential/materializer/SequentialMaterializerBackend';
export {
  clearSequentialLayerRendererAll,
  clearSequentialLayerRendererLayer,
  getSequentialLayerRenderCanvas,
  getSequentialLayerRendererStats,
} from './sequential/SequentialLayerRenderer';
export type { FrameTile, FrameTileSet, SequentialFrameCacheStats } from './sequential/types';

// Types
export type { GradientStop, RGBA } from './GradientPalette';
export type { AnimationConfig } from './AnimationController';
export type { ColorCycleConfig } from './ColorCycleRenderer';
export type { ColorCycleAnimatorConfig } from './ColorCycleAnimator';

// Demo
export { ColorCycleDemo, createColorCycleDemo } from './examples/ColorCycleDemo';
