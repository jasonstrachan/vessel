import type { CanvasSnapshot } from '../types';

export function captureCanvasSnapshot(
  canvas: HTMLCanvasElement, 
  actionType: CanvasSnapshot['actionType'], 
  description: string
): CanvasSnapshot {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Cannot capture snapshot: canvas context is null');
  }
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  return {
    id: `snapshot_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    imageData,
    actionType,
    description
  };
}

export function restoreCanvasSnapshot(
  canvas: HTMLCanvasElement, 
  snapshot: CanvasSnapshot
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Cannot restore snapshot: canvas context is null');
  }
  
  // Ensure canvas dimensions match snapshot
  if (canvas.width !== snapshot.imageData.width || canvas.height !== snapshot.imageData.height) {
    canvas.width = snapshot.imageData.width;
    canvas.height = snapshot.imageData.height;
  }
  
  // Clear canvas and restore snapshot
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(snapshot.imageData, 0, 0);
}

export function enableHistoryCapture(): void {
  // Mark that history capture should resume
}

export function disableHistoryCapture(): void {
  // Mark that history capture should pause
}