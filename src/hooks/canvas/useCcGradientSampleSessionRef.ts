import { useRef } from 'react';
import { createCcGradientSampleSession } from '@/hooks/canvas/handlers/colorCycle/ccGradientSampling';

export const useCcGradientSampleSessionRef = () => {
  return useRef(createCcGradientSampleSession());
};
