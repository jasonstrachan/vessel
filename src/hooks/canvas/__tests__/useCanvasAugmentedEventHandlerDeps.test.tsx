import { renderHook } from '@testing-library/react';

import { splitCanvasEventHandlerDeps, type EventHandlerDependenciesInput } from '../canvasEventHandlerDeps';
import { useCanvasAugmentedEventHandlerDeps } from '../useCanvasAugmentedEventHandlerDeps';
import { useCanvasEventHandlerDynamicDepsRef } from '../useCanvasEventHandlerDynamicDepsRef';
import { useCanvasEventHandlerRefs } from '../useCanvasEventHandlerRefs';

it('preserves the supplied pointer suppression ref across the real handler composition', () => {
  const suppressionRef = { current: false };
  // Only static ref ownership is exercised; no pointer workflow reads these fixtures.
  const input = { suppressBootstrapUntilPointerUpRef: suppressionRef } as EventHandlerDependenciesInput;
  const { result, rerender } = renderHook(() => {
    const { staticDeps, dynamicDeps } = splitCanvasEventHandlerDeps(input);
    return useCanvasAugmentedEventHandlerDeps({
      staticDeps,
      dynamicDepsRef: useCanvasEventHandlerDynamicDepsRef(dynamicDeps),
      refs: useCanvasEventHandlerRefs(),
    });
  });

  expect(result.current.suppressBootstrapUntilPointerUpRef).toBe(suppressionRef);
  suppressionRef.current = true;
  rerender();
  expect(result.current.suppressBootstrapUntilPointerUpRef.current).toBe(true);
  result.current.suppressBootstrapUntilPointerUpRef.current = false;
  expect(suppressionRef.current).toBe(false);
});
