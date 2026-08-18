import type React from 'react';

import type { BrushPreset, BrushSettings, Tool } from '@/types';
import type { WebGLExportMetadata } from '@/utils/export/goblet/gobletTypes';

export interface StudioCanvasOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  zoom: number;
  offsetX: number;
  offsetY: number;
  isSpacePressed: boolean;
  sampleColorAtPosition: (x: number, y: number) => string;
}

export interface StudioBracketShortcutContext {
  currentTool: Tool;
  brushSettings: BrushSettings;
  direction: -1 | 1;
}

export interface VesselStudioExtension {
  brushPresets: readonly BrushPreset[];
  BrushControls?: React.ComponentType;
  CanvasOverlay?: React.ComponentType<StudioCanvasOverlayProps>;
  resolveBracketShortcut?: (
    context: StudioBracketShortcutContext,
  ) => Partial<BrushSettings> | null;
  transformGobletTemplate?: (
    template: string,
    context: { metadata: WebGLExportMetadata },
  ) => string;
}
