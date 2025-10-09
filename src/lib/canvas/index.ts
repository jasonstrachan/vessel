/**
 * Canvas operation management utilities
 *
 * Provides:
 * - OpController: Operation tracking and cancellation
 * - FinalizeQueue: Serialization of finalization operations
 * - CanvasSpaces: Single source of truth for transforms
 * - CanvasManager: Explicit canvas ownership by purpose
 */

export { OpController } from './OpController';
export type { OpId, CancelToken } from './OpController';

export { FinalizeQueue } from './FinalizeQueue';

export { createCanvasSpaces, getCurrentSpaces } from './CanvasSpaces';
export type { ViewTransform, CanvasSpaces } from './CanvasSpaces';

export { CanvasManager } from './CanvasManager';
export type { CanvasOwnership } from './CanvasManager';
