import type { Palette, RGB, RGBA } from 'gifenc';
import { mapToIndexedWithDithering, type DitherMethod } from '@/utils/gifDither';
import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import type {
  AnimationSession,
  ExportEstimate,
  ExportEstimateRequest,
  ExportProgress,
  ExportRequest,
  ExportResult,
  FrameProvider,
  GifExportOptions,
  GifExportRequest,
  PngExportRequest,
  VideoExportRequest,
  WebglExportRequest
} from '@/utils/export/types';

const ALPHA_THRESHOLD = 16;

const toGifPalette = (p: number[][]): Palette => {
  if (p.length === 0) return [] as RGB[];
  const hasAlpha = p.some((c) => c.length >= 4);
  if (hasAlpha) {
    return p.map((c) => [c[0] | 0, c[1] | 0, c[2] | 0, (c[3] ?? 255) | 0] as RGBA) as RGBA[];
  }
  return p.map((c) => [c[0] | 0, c[1] | 0, c[2] | 0] as RGB) as RGB[];
};

const toRgbaEntries = (entries: number[][]): number[][] => (
  entries.map((entry) => (
    entry.length === 4 ? entry.slice(0, 4) : [entry[0], entry[1], entry[2], 255]
  ))
);

const resolveGifenc = async (override?: typeof import('gifenc')): Promise<typeof import('gifenc')> => {
  if (override) return override;
  return import('gifenc/dist/gifenc.esm.js');
};

const clampNumber = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
);

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
};

const ensureContext = (canvas: HTMLCanvasElement, options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D => {
  const ctx = canvas.getContext('2d', options);
  if (!ctx) throw new Error('No canvas context available for export');
  return ctx;
};

const createRenderTargets = (frameProvider: FrameProvider, scale: number) => {
  const { width, height } = frameProvider.getDimensions();
  const base = createCanvas(width, height);
  const isScaled = scale !== 1;
  if (!isScaled) {
    const ctx = ensureContext(base, { willReadFrequently: true, colorSpace: 'srgb' });
    return { base, scaled: base, ctx, scaledWidth: base.width, scaledHeight: base.height, isScaled: false };
  }
  const scaledWidth = Math.max(1, Math.floor(base.width * scale));
  const scaledHeight = Math.max(1, Math.floor(base.height * scale));
  const scaled = createCanvas(scaledWidth, scaledHeight);
  const ctx = ensureContext(scaled, { willReadFrequently: true, colorSpace: 'srgb' });
  return { base, scaled, ctx, scaledWidth, scaledHeight, isScaled: true };
};

const drawScaledFrame = (
  targets: ReturnType<typeof createRenderTargets>,
  usePixelPerfectScaling = true
) => {
  if (!targets.isScaled) {
    return;
  }
  targets.ctx.clearRect(0, 0, targets.scaledWidth, targets.scaledHeight);
  targets.ctx.imageSmoothingEnabled = !usePixelPerfectScaling;
  targets.ctx.imageSmoothingQuality = usePixelPerfectScaling ? 'low' : 'high';
  targets.ctx.drawImage(targets.base, 0, 0, targets.scaledWidth, targets.scaledHeight);
};

const renderFrameToScaled = (
  frameProvider: FrameProvider,
  targets: ReturnType<typeof createRenderTargets>
): ImageData => {
  frameProvider.compositeToCanvas(targets.base);
  drawScaledFrame(targets, true);
  return targets.ctx.getImageData(0, 0, targets.scaledWidth, targets.scaledHeight);
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> => (
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Failed to create ${type} blob`));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  })
);

const sampleGifPalette = (
  frames: ImageData[],
  options: GifExportOptions,
  usedRGB: Set<number>,
  usesTransparency: boolean
): { palette: number[][]; paletteSize: number } => {
  const needTransparentSlot = usesTransparency;
  const MAX_GIF_COLORS = 256;
  const buildSampleBuffer = (): Uint8Array => {
    const targetSamples = 500_000;
    const totalPixels = frames.reduce((acc, f) => acc + (f.width * f.height), 0);
    const stride = Math.max(1, Math.floor(totalPixels / targetSamples));
    const totalRGBA = frames.reduce((acc, f) => acc + f.data.length, 0);
    const approxLen = Math.ceil(totalRGBA / stride);
    const sample = new Uint8Array(approxLen);
    let w = 0;
    for (let fi = 0; fi < frames.length; fi++) {
      const arr = frames[fi].data;
      for (let i = 0; i < arr.length; i += 4 * stride) {
        const a = arr[i + 3];
        if (a <= ALPHA_THRESHOLD) continue;
        if (w + 4 > sample.length) break;
        sample[w++] = arr[i];
        sample[w++] = arr[i + 1];
        sample[w++] = arr[i + 2];
        sample[w++] = a;
      }
    }
    if (w === 0) {
      const count = Math.max(1, usedRGB.size);
      const fallback = new Uint8Array(count * 4);
      let o = 0;
      if (usedRGB.size > 0) {
        for (const rgb of usedRGB) {
          if (o + 4 > fallback.length) break;
          fallback[o++] = (rgb >> 16) & 255;
          fallback[o++] = (rgb >> 8) & 255;
          fallback[o++] = rgb & 255;
          fallback[o++] = 255;
        }
      } else {
        fallback[0] = 0; fallback[1] = 0; fallback[2] = 0; fallback[3] = 255;
      }
      return fallback;
    }
    return sample.slice(0, w);
  };

  if (options.autoColors) {
    const colorCountCandidate = usedRGB.size + (needTransparentSlot ? 1 : 0);
    if (colorCountCandidate <= MAX_GIF_COLORS) {
      const palette: number[][] = [];
      if (needTransparentSlot) palette.push([0, 0, 0, 0]);
      for (const rgb of usedRGB) {
        const r = (rgb >> 16) & 255;
        const g = (rgb >> 8) & 255;
        const b = rgb & 255;
        palette.push([r, g, b, 255]);
      }
      return { palette, paletteSize: palette.length };
    }
    const sample = buildSampleBuffer();
    const target = needTransparentSlot ? MAX_GIF_COLORS - 1 : MAX_GIF_COLORS;
    const quantized = toRgbaEntries(sampleGifencQuantize(sample, target));
    const palette = needTransparentSlot ? [[0, 0, 0, 0], ...quantized] : quantized;
    return { palette, paletteSize: palette.length };
  }

  const sample = buildSampleBuffer();
  const target = needTransparentSlot ? options.maxColors - 1 : options.maxColors;
  let palette = toRgbaEntries(sampleGifencQuantize(sample, Math.max(1, target)));
  if (needTransparentSlot) palette = [[0, 0, 0, 0], ...palette];

  const desired = options.maxColors;
  if (palette.length < desired) {
    const fill = palette.find((c) => c.length < 4 || c[3] !== 0) || [0, 0, 0, 255];
    while (palette.length < desired) {
      const f = fill.length === 3 ? [fill[0], fill[1], fill[2], 255] : fill.slice(0, 4);
      palette.push(f);
    }
  } else if (palette.length > desired) {
    palette = palette.slice(0, desired);
  }
  return { palette, paletteSize: palette.length };
};

let sampleGifencQuantize: (rgba: Uint8Array, target: number) => number[][] = () => [];

const ensureQuantize = (quantize: typeof import('gifenc').quantize) => {
  sampleGifencQuantize = (rgba: Uint8Array, target: number) => (
    quantize(rgba, target, { format: 'rgb565' }) as number[][]
  );
};

const applyGifPalette = (
  data: Uint8ClampedArray,
  palette: number[][],
  ditherMethod: DitherMethod,
  ditherStrength: number,
  width: number,
  height: number,
  transparentIndex: number
): Uint8Array => {
  if (ditherMethod === 'none') {
    const { applyPalette } = gifencModuleCache;
    const index = applyPalette(data, toGifPalette(palette));
    if (transparentIndex >= 0) {
      for (let p = 0, px = 0; p < data.length; p += 4, px++) {
        if (data[p + 3] <= ALPHA_THRESHOLD) index[px] = transparentIndex;
      }
    }
    return index;
  }
  return mapToIndexedWithDithering(
    data,
    width,
    height,
    palette,
    { method: ditherMethod, strength: ditherStrength, alphaThreshold: ALPHA_THRESHOLD }
  );
};

let gifencModuleCache: typeof import('gifenc');

const runPngExport = async (request: PngExportRequest): Promise<ExportResult> => {
  const { frameProvider, scale, filenameBase, options } = request;
  const targets = createRenderTargets(frameProvider, scale);
  frameProvider.compositeToCanvas(targets.base);

  let finalCanvas = targets.scaled;
  if (targets.isScaled) {
    drawScaledFrame(targets, true);
  }

  if (options.includeBackground && options.backgroundColor && options.backgroundColor !== 'transparent') {
    const withBg = createCanvas(targets.scaledWidth, targets.scaledHeight);
    const bgctx = ensureContext(withBg, { colorSpace: 'srgb' });
    bgctx.fillStyle = options.backgroundColor;
    bgctx.fillRect(0, 0, withBg.width, withBg.height);
    bgctx.drawImage(finalCanvas, 0, 0);
    finalCanvas = withBg;
  }

  const quality = clampNumber(options.quality, 0.1, 1);
  const blob = await canvasToBlob(finalCanvas, 'image/png', quality);
  return {
    kind: 'png',
    filename: `${filenameBase}@${scale}x.png`,
    blob
  };
};

const runGifExport = async (
  request: GifExportRequest,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal
): Promise<ExportResult> => {
  const { frameProvider, scale, filenameBase, options } = request;
  const effectiveFps = Math.max(1, Math.floor(options.fps / Math.max(1, options.frameStep)));
  const totalFrames = options.autoFrames && options.suggestedTotalFrames
    ? Math.max(1, options.suggestedTotalFrames)
    : Math.max(1, Math.round(options.durationSeconds * effectiveFps));

  gifencModuleCache = await resolveGifenc(request.gifencModule);
  ensureQuantize(gifencModuleCache.quantize);
  const { GIFEncoder } = gifencModuleCache;

  const targets = createRenderTargets(frameProvider, scale);
  const gif = GIFEncoder();

  const frames: ImageData[] = [];
  const usedRGB = new Set<number>();
  let usesTransparency = false;

  const animationSession = frameProvider.beginAnimationSession?.({
    fps: effectiveFps,
    totalFrames,
    kind: 'gif',
    useAbsolutePhase: options.autoFrames
  });

  for (let i = 0; i < totalFrames; i++) {
    if (signal.aborted) break;
    animationSession?.stepFrame({
      frameIndex: i,
      totalFrames,
      useAbsolutePhase: options.autoFrames
    });

    const frame = renderFrameToScaled(frameProvider, targets);
    frames.push(frame);

    const data = frame.data;
    for (let p = 0; p < data.length; p += 4) {
      const a = data[p + 3];
      if (a <= ALPHA_THRESHOLD) {
        usesTransparency = true;
        continue;
      }
      usedRGB.add((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
      if (usedRGB.size > 512) {
        // Avoid runaway memory; palette will be quantized later if needed.
      }
    }

    onProgress({ phase: 'analyze', percent: Math.round((((i + 1) / totalFrames) * 100) * 0.5) });
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(1000 / effectiveFps))));
  }

  const { palette: fixedPalette, paletteSize } = sampleGifPalette(frames, options, usedRGB, usesTransparency);
  const transparentIndex = fixedPalette.findIndex((c) => (c.length >= 4 && c[3] === 0));

  for (let i = 0; i < frames.length; i++) {
    if (signal.aborted) break;
    const frame = frames[i];
    const index = applyGifPalette(
      frame.data,
      fixedPalette,
      options.ditherMethod,
      options.ditherStrength,
      targets.scaledWidth,
      targets.scaledHeight,
      transparentIndex
    );

    gif.writeFrame(index, targets.scaledWidth, targets.scaledHeight, {
      palette: toGifPalette(fixedPalette),
      delay: Math.round(1000 / effectiveFps),
      repeat: options.repeat,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : undefined,
    });

    onProgress({ phase: 'encode', percent: 50 + Math.round(((i + 1) / frames.length) * 50) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  animationSession?.finish?.();

  gif.finish();
  const bytes = gif.bytes();
  const bytesCopy = new Uint8Array(bytes.length);
  bytesCopy.set(bytes);
  const blob = new Blob([bytesCopy], { type: 'image/gif' });

  return {
    kind: 'gif',
    filename: `${filenameBase}@${scale}x.gif`,
    blob,
    paletteSize
  };
};

const runVideoExport = async (
  request: VideoExportRequest,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal
): Promise<ExportResult> => {
  const { frameProvider, scale, filenameBase, options } = request;
  const targets = createRenderTargets(frameProvider, scale);
  const mediaRecorderCtor = (window as typeof window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!mediaRecorderCtor) {
    throw new Error('MediaRecorder is not supported in this browser');
  }

  const mimeCandidates = options.mimeType === 'video/mp4'
    ? [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]
    : [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4'
    ];

  const resolveSupportedMime = (candidates: string[]): string | null => {
    for (const candidate of candidates) {
      if (
        typeof mediaRecorderCtor.isTypeSupported === 'function'
        && mediaRecorderCtor.isTypeSupported(candidate)
      ) {
        return candidate;
      }
    }
    return null;
  };

  const supportedMime = resolveSupportedMime(mimeCandidates) ?? 'video/webm;codecs=vp8';

  const stream = typeof targets.scaled.captureStream === 'function' ? targets.scaled.captureStream(options.fps) : null;
  if (!stream) throw new Error('Canvas captureStream not supported');
  const stopCaptureTracks = () => {
    if (!stream || typeof stream.getTracks !== 'function') {
      return;
    }
    for (const track of stream.getTracks()) {
      if (track && typeof track.stop === 'function') {
        track.stop();
      }
    }
  };

  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: supportedMime,
      videoBitsPerSecond: Math.max(1000, options.bitrateKbps * 1000),
    } as MediaRecorderOptions);
  } catch {
    // Last-resort fallback for engines that misreport support.
    recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: Math.max(1000, options.bitrateKbps * 1000),
    } as MediaRecorderOptions);
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const totalFrames = Math.max(1, Math.round(options.durationSeconds * options.fps));
  const animationSession = frameProvider.beginAnimationSession?.({
    fps: options.fps,
    totalFrames,
    kind: 'video',
    useAbsolutePhase: false
  });

  try {
    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Video export failed: recorder error'));
      recorder.start();
      let frame = 0;
      const interval = Math.max(0, Math.floor(1000 / options.fps));
      const tick = () => {
        if (signal.aborted || frame >= totalFrames) {
          recorder.stop();
          return;
        }

        animationSession?.stepFrame({
          frameIndex: frame,
          totalFrames,
          useAbsolutePhase: false
        });
        frameProvider.compositeToCanvas(targets.base);
        drawScaledFrame(targets, true);

        frame += 1;
        onProgress({ phase: 'encode', percent: Math.round((frame / totalFrames) * 100) });
        setTimeout(tick, interval);
      };
      setTimeout(tick, 0);
    });

    if (chunks.length === 0) {
      throw new Error('Video export failed: recorder produced no frames');
    }

    const outputMime = recorder.mimeType || supportedMime || 'video/webm';
    const blob = new Blob(chunks, { type: outputMime });
    if (blob.size === 0) {
      throw new Error('Video export failed: empty output file');
    }

    const ext = outputMime.includes('mp4') ? 'mp4' : 'webm';
    return {
      kind: 'video',
      filename: `${filenameBase}@${scale}x.${ext}`,
      blob,
      mimeType: outputMime,
    };
  } finally {
    animationSession?.finish?.();
    stopCaptureTracks();
  }
};

const runWebglExport = async (request: WebglExportRequest): Promise<ExportResult> => {
  const metadata = await exportProjectAsWebGL(request.options.request);
  return {
    kind: 'webgl',
    filename: request.filenameBase,
    metadata,
  };
};

export const estimateExport = async (
  request: ExportEstimateRequest,
  signal?: AbortSignal
): Promise<ExportEstimate> => {
  if (signal?.aborted) {
    return { paletteSize: null, estimatedBytes: null };
  }

  gifencModuleCache = await resolveGifenc(request.gifencModule);
  ensureQuantize(gifencModuleCache.quantize);
  const { GIFEncoder, applyPalette } = gifencModuleCache;

  const { frameProvider, scale, options } = request;
  const fps = Math.max(1, Math.floor(options.fps / Math.max(1, options.frameStep)));
  const duration = options.autoFrames && options.suggestedTotalFrames
    ? options.suggestedTotalFrames / fps
    : options.durationSeconds;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const sampleFrames = Math.max(1, Math.min(3, totalFrames));
  const sampleIndices = new Set<number>();
  if (sampleFrames === 1) sampleIndices.add(0);
  else if (sampleFrames === 2) { sampleIndices.add(0); sampleIndices.add(totalFrames - 1); }
  else { sampleIndices.add(0); sampleIndices.add(Math.floor(totalFrames / 2)); sampleIndices.add(totalFrames - 1); }

  const targets = createRenderTargets(frameProvider, scale);
  const frames: ImageData[] = [];
  const usedRGB = new Set<number>();
  let usesTransparency = false;

  const animationSession: AnimationSession | undefined = frameProvider.beginAnimationSession?.({
    fps,
    totalFrames,
    kind: 'estimate',
    useAbsolutePhase: options.autoFrames
  });

  try {
    let captured = 0;
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        return { paletteSize: null, estimatedBytes: null };
      }
      if (sampleIndices.has(i)) {
        animationSession?.stepFrame({
          frameIndex: i,
          totalFrames,
          useAbsolutePhase: options.autoFrames
        });
        const img = renderFrameToScaled(frameProvider, targets);
        frames.push(img);
        const data = img.data;
        for (let p = 0; p < data.length; p += 4) {
          const a = data[p + 3];
          if (a <= ALPHA_THRESHOLD) { usesTransparency = true; continue; }
          usedRGB.add((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
        }
        captured += 1;
        if (captured >= sampleFrames) break;
      }
      animationSession?.advanceFrame?.();
    }

    const { palette, paletteSize } = sampleGifPalette(frames, options, usedRGB, usesTransparency);

    try {
      const enc = GIFEncoder();
      const tIndex = palette.findIndex((c) => (c.length >= 4 && c[3] === 0));
      for (const img of frames) {
        let index: Uint8Array;
        if (options.ditherMethod === 'none') {
          index = applyPalette(img.data, toGifPalette(palette));
          if (tIndex >= 0) {
            for (let p = 0, px = 0; p < img.data.length; p += 4, px++) {
              if (img.data[p + 3] <= ALPHA_THRESHOLD) index[px] = tIndex;
            }
          }
        } else {
          index = mapToIndexedWithDithering(
            img.data, targets.scaledWidth, targets.scaledHeight, palette,
            { method: options.ditherMethod, strength: options.ditherStrength, alphaThreshold: ALPHA_THRESHOLD }
          );
        }
        enc.writeFrame(index, targets.scaledWidth, targets.scaledHeight, {
          palette: toGifPalette(palette),
          delay: Math.round(1000 / fps),
          repeat: options.repeat,
          transparentIndex: tIndex >= 0 ? tIndex : undefined,
        });
      }
      enc.finish();
      const size = enc.bytes().length;
      const estimatedBytes = Math.max(1, Math.round(size * (totalFrames / Math.max(1, frames.length))));
      return { paletteSize, estimatedBytes };
    } catch {
      return { paletteSize, estimatedBytes: null };
    }
  } finally {
    animationSession?.finish?.();
  }
};

export const runExport = async (
  request: ExportRequest,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal
): Promise<ExportResult> => {
  onProgress({ phase: 'prepare', percent: 0 });

  if (request.kind === 'png') {
    const result = await runPngExport(request);
    onProgress({ phase: 'finalize', percent: 100 });
    return result;
  }

  if (request.kind === 'gif') {
    const result = await runGifExport(request, onProgress, signal);
    onProgress({ phase: 'finalize', percent: 100 });
    return result;
  }

  if (request.kind === 'video') {
    const result = await runVideoExport(request, onProgress, signal);
    onProgress({ phase: 'finalize', percent: 100 });
    return result;
  }

  const result = await runWebglExport(request);
  onProgress({ phase: 'finalize', percent: 100 });
  return result;
};
