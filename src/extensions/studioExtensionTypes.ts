import type React from 'react';

import type {
  BrushPreset,
  BrushSettings,
  Tool,
  TxtShape,
  TxtShapePlaybackSettings,
} from '@/types';
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

export type StudioClipboardAction =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'paste-in-place'
  | 'duplicate';

export interface StudioClipboardActionContext {
  action: StudioClipboardAction;
  event: KeyboardEvent | ClipboardEvent;
}

export interface VesselStudioExtension {
  brushPresets: readonly BrushPreset[];
  ToolbarItems?: React.ComponentType;
  PlaybackSettings?: React.ComponentType;
  PlaybackControls?: React.ComponentType<{ children: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>> }>;
  ExportControls?: React.ComponentType;
  BrushControls?: React.ComponentType;
  BrushSettingsControls?: React.ComponentType;
  /** Transient, unmasked canvas for an active layer edit; never part of canonical export data. */
  getColorCycleLayerPreview?: (layerId: string) => HTMLCanvasElement | null;
  /** Snapshot at stroke start; coordinates are integer canvas pixels, sampled at their centres. */
  createColorCycleStrokePaintMask?: (context: {
    currentTool: Tool;
    presetId: string | null;
    brushSettings: BrushSettings;
  }) => StudioStrokePaintMask | null;
  CanvasOverlay?: React.ComponentType<StudioCanvasOverlayProps>;
  resolveBracketShortcut?: (
    context: StudioBracketShortcutContext,
  ) => Partial<BrushSettings> | null;
  handleClipboardAction?: (
    context: StudioClipboardActionContext,
  ) => boolean | Promise<boolean>;
  transformGobletMetadata?: (
    metadata: WebGLExportMetadata,
  ) => WebGLExportMetadata;
  getGobletAuthoredDynamicFeatures?: (
    metadata: WebGLExportMetadata,
  ) => readonly string[];
  transformGobletRasterTextShapes?: (
    shapes: readonly TxtShape[],
    context: { txtShapePlayback: TxtShapePlaybackSettings },
  ) => readonly TxtShape[];
  transformGobletTemplate?: (
    template: string,
    context: { metadata: WebGLExportMetadata },
  ) => string;
}

export interface StudioStrokePaintMask {
  readonly acceptsPixel: (x: number, y: number) => boolean;
}
