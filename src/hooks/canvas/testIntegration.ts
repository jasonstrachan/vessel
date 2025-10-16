/**
 * Type-only integration checks to ensure the modular handler hook stays
 * aligned with the expected EventHandlers contract without invoking React
 * hooks in an invalid context.
 */
import type { useCanvasEventHandlers } from './useCanvasEventHandlers';
import type { EventHandlerDependencies, EventHandlers } from './utils/types';

type CanvasEventHandlers = ReturnType<typeof useCanvasEventHandlers>;

type MissingHandlers = Exclude<keyof EventHandlers, keyof CanvasEventHandlers>;
type ExtraHandlers = Exclude<keyof CanvasEventHandlers, keyof EventHandlers>;

export type AssertCanvasEventHandlersShape = MissingHandlers extends never
  ? (ExtraHandlers extends never ? true : never)
  : never;

export type UseCanvasEventHandlersSignature = (
  deps: EventHandlerDependencies
) => CanvasEventHandlers;

export type VerifyUseCanvasEventHandlersSignature = typeof useCanvasEventHandlers extends UseCanvasEventHandlersSignature
  ? true
  : never;
