export interface VesselMultiplayerCanvasFrame {
  frameId: string;
  sessionId: string;
  projectId: string;
  projectRevision: number;
  aiLayerType: 'normal' | 'color-cycle';
  capturedAt: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  mimeType: 'image/webp' | 'image/png';
  gestureId: string | null;
  gesturePhase: 'start' | 'move' | 'end' | 'cancel' | 'idle';
  gesturePointCount: number;
  blob: Blob;
}

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) => new Promise<Blob>((resolve, reject) => {
  try {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Vessel multiplayer canvas encoding failed'));
    }, type, quality);
  } catch (error) {
    reject(error);
  }
});

export const captureVesselMultiplayerCanvasFrame = async ({
  canvas,
  projectId,
  projectRevision,
  aiLayerType,
  sessionId,
  gestureId = null,
  gesturePhase = 'idle',
  gesturePointCount = 0,
  maxSize = 512,
}: {
  canvas: HTMLCanvasElement;
  projectId: string;
  projectRevision: number;
  aiLayerType: VesselMultiplayerCanvasFrame['aiLayerType'];
  sessionId: string;
  gestureId?: string | null;
  gesturePhase?: VesselMultiplayerCanvasFrame['gesturePhase'];
  gesturePointCount?: number;
  maxSize?: number;
}): Promise<VesselMultiplayerCanvasFrame> => {
  if (canvas.width < 1 || canvas.height < 1) {
    throw new Error('Rendered Vessel canvas is unavailable');
  }
  const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = width;
  frameCanvas.height = height;
  const context = frameCanvas.getContext('2d');
  if (!context) throw new Error('Vessel multiplayer frame canvas is unavailable');
  context.imageSmoothingEnabled = false;
  const capturedAt = Date.now();
  context.drawImage(canvas, 0, 0, width, height);

  let blob: Blob;
  try {
    blob = await canvasToBlob(frameCanvas, 'image/webp', 0.72);
  } catch {
    blob = await canvasToBlob(frameCanvas, 'image/png');
  }
  return {
    frameId: crypto.randomUUID(),
    sessionId,
    projectId,
    projectRevision,
    aiLayerType,
    capturedAt,
    width,
    height,
    sourceWidth: canvas.width,
    sourceHeight: canvas.height,
    mimeType: blob.type === 'image/png' ? 'image/png' : 'image/webp',
    gestureId,
    gesturePhase,
    gesturePointCount,
    blob,
  };
};
