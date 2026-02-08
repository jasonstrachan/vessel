import { useRef } from 'react';
import type { EventHandlerDynamicDeps } from './utils/types';

export const useCanvasEventHandlerDynamicDepsRef = (dynamicDeps: EventHandlerDynamicDeps) => {
  const dynamicDepsRef = useRef<EventHandlerDynamicDeps>(dynamicDeps);
  dynamicDepsRef.current = dynamicDeps;
  return dynamicDepsRef;
};
