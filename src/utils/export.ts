// Note: gif.js types are not perfect, using any for now
declare const GIF: any;

export interface ExportOptions {
  format: 'png' | 'gif';
  quality?: number;
  fps?: number;
  width?: number;
  height?: number;
}

export const exportProject = async (
  layers: any[],
  options: ExportOptions,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const { format, quality = 10, fps = 18 } = options;

  if (format === 'png') {
    return exportCurrentFrame(layers);
  } else if (format === 'gif') {
    return exportGIF(layers, { quality, fps }, onProgress);
  }

  throw new Error(`Unsupported export format: ${format}`);
};

const exportCurrentFrame = (layers: any[]): string => {
  // Create a temporary canvas to combine all visible layers
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error('Could not create canvas context');

  // Set canvas size (assuming 800x600 for now)
  canvas.width = 800;
  canvas.height = 600;

  // Fill with transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Render each visible layer (this would need P5 integration)
  layers.forEach(layer => {
    if (layer.visible && layer.frames.length > 0) {
      // This would need to be implemented with P5 framebuffer data
      // For now, just placeholder
    }
  });

  return canvas.toDataURL('image/png');
};

const exportGIF = (
  layers: any[],
  options: { quality: number; fps: number },
  onProgress?: (progress: number) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      // Initialize GIF.js
      const gif = new GIF({
        workers: 2,
        quality: options.quality,
        width: 800,
        height: 600,
        workerScript: '/gif.worker.js', // Will need to copy this to public folder
      });

      // Progress callback
      gif.on('progress', (progress: number) => {
        if (onProgress) onProgress(progress);
      });

      // Finished callback
      gif.on('finished', (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        resolve(url);
      });

      // Get maximum number of frames
      const maxFrames = Math.max(...layers.map(layer => layer.frames.length));

      // Add each frame to the GIF
      for (let frameIndex = 0; frameIndex < maxFrames; frameIndex++) {
        const canvas = createFrameCanvas(layers, frameIndex);
        gif.addFrame(canvas, { delay: 1000 / options.fps });
      }

      // Start rendering
      gif.render();
    } catch (error) {
      reject(error);
    }
  });
};

const createFrameCanvas = (layers: any[], frameIndex: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error('Could not create canvas context');

  canvas.width = 800;
  canvas.height = 600;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Render each visible layer for this frame
  layers.forEach(layer => {
    if (layer.visible && layer.frames[frameIndex]) {
      // This would need P5 framebuffer integration
      // For now, placeholder
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(10, 10, 50, 50);
    }
  });

  return canvas;
};

export const downloadFile = (url: string, filename: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};