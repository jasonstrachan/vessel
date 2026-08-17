import type React from 'react';

import type { BrushPreset } from '@/types';

export interface StudioCanvasOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface VesselStudioExtension {
  brushPresets: readonly BrushPreset[];
  BrushControls?: React.ComponentType;
  CanvasOverlay?: React.ComponentType<StudioCanvasOverlayProps>;
}
