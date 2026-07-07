export type ColorCycleCompositorCommandType =
  | 'ping'
  | 'ensure-layer'
  | 'dispose-layer'
  | 'frame-request'
  | 'apply-mask'
  | 'shutdown';

export type ColorCycleCompositorMessage =
  | { type: 'ping'; requestId?: number }
  | { type: 'ensure-layer'; layerId: string; width: number; height: number; documentVersion?: number; requestId?: number }
  | { type: 'dispose-layer'; layerId: string; requestId?: number }
  | { type: 'frame-request'; requestId?: number }
  | { type: 'apply-mask'; layerId: string; maskBitmap: ImageBitmap | null; documentVersion?: number; requestId?: number }
  | { type: 'shutdown'; requestId?: number };

export interface ColorCycleCompositorLayerInput {
  layerId: string;
  width: number;
  height: number;
  builtFromVersion: number | null;
}

export interface ColorCycleCompositorLayerFrame {
  layerId: string;
  bitmap: ImageBitmap;
  opacity: number;
  blendMode: GlobalCompositeOperation;
  builtFromVersion: number | null;
}

export type ColorCycleCompositorResponse =
  | { type: 'pong'; requestId?: number }
  | { type: 'ack'; requestId?: number; command: ColorCycleCompositorCommandType }
  | { type: 'frame'; requestId?: number; layers: ColorCycleCompositorLayerFrame[] }
  | { type: 'error'; requestId?: number; message: string };
