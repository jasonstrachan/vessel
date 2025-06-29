import p5 from 'p5';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  frames: (p5.Framebuffer | null)[];
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  currentFrame: number;
  fps: number;
}

export interface BrushSettings {
  color: string;
  size: number;
  opacity: number;
  rotation: number;
  brushShape: 'square' | 'circle';
  pixelPerfect: boolean;
  followBrush: boolean;
  dottedStyle: {
    enabled: boolean;
    spacing: number;
    dashLength: number;
    dashSpacing: number;
  };
  pressureSettings: {
    enabled: boolean;
    minValue: number;
    maxValue: number;
  };
}

export interface OnionSkinSettings {
  enabled: boolean;
  framesBefore: number;
  framesAfter: number;
  opacity: number;
}

export enum Tool {
  BRUSH = 'brush',
  PIXEL_BRUSH = 'pixel_brush',
  ERASER = 'eraser',
  FILL = 'fill',
  SELECT = 'select',
  CLEAR = 'clear',
}

export interface UndoAction {
  layerId: string;
  frameIndex: number;
  framebuffer: p5.Framebuffer;
}

export interface AppState {
  project: Project;
  currentTool: Tool;
  currentLayer: number;
  brushSettings: BrushSettings;
  onionSkinSettings: OnionSkinSettings;
  isPlaying: boolean;
  undoStack: UndoAction[];
  redoStack: UndoAction[];
}