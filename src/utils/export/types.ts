import type { DitherMethod } from '@/utils/gifDither';
import type { WebGLExportBundleFormat } from '@/types';
import type { WebGLExportMetadata, WebGLExportRequest } from '@/utils/export/webglExporter';

export type ExportKind = 'png' | 'gif' | 'video' | 'webgl';

export type ExportProgressPhase = 'prepare' | 'analyze' | 'encode' | 'finalize';

export interface ExportProgress {
  phase: ExportProgressPhase;
  percent: number;
  message?: string;
}

export interface AnimationSessionOptions {
  fps: number;
  totalFrames: number;
  kind: 'gif' | 'video' | 'estimate';
  useAbsolutePhase: boolean;
}

export interface AnimationStepOptions {
  frameIndex: number;
  totalFrames: number;
  useAbsolutePhase: boolean;
}

export interface AnimationSession {
  stepFrame: (options: AnimationStepOptions) => void;
  advanceFrame?: () => void;
  finish?: () => void;
}

export interface FrameProvider {
  getDimensions: () => { width: number; height: number };
  compositeToCanvas: (canvas: HTMLCanvasElement) => void;
  beginAnimationSession?: (options: AnimationSessionOptions) => AnimationSession;
}

export interface GifExportOptions {
  fps: number;
  durationSeconds: number;
  repeat: number;
  autoFrames: boolean;
  suggestedTotalFrames?: number;
  frameStep: number;
  ditherMethod: DitherMethod;
  ditherStrength: number;
  maxColors: number;
  autoColors: boolean;
}

export interface PngExportOptions {
  quality: number;
  includeBackground: boolean;
  backgroundColor?: string | null;
}

export interface VideoExportOptions {
  fps: number;
  durationSeconds: number;
  mimeType: 'video/mp4' | 'video/webm';
  bitrateKbps: number;
}

export interface WebglExportOptions {
  request: WebGLExportRequest;
  bundleFormat: WebGLExportBundleFormat;
  htmlTitle: string;
}

export interface PngExportRequest {
  kind: 'png';
  filenameBase: string;
  scale: number;
  frameProvider: FrameProvider;
  options: PngExportOptions;
}

export interface GifExportRequest {
  kind: 'gif';
  filenameBase: string;
  scale: number;
  frameProvider: FrameProvider;
  options: GifExportOptions;
  gifencModule?: typeof import('gifenc');
}

export interface VideoExportRequest {
  kind: 'video';
  filenameBase: string;
  scale: number;
  frameProvider: FrameProvider;
  options: VideoExportOptions;
}

export interface WebglExportRequest {
  kind: 'webgl';
  filenameBase: string;
  options: WebglExportOptions;
}

export type ExportRequest = PngExportRequest | GifExportRequest | VideoExportRequest | WebglExportRequest;

export interface ExportEstimateRequest {
  kind: 'gif';
  scale: number;
  frameProvider: FrameProvider;
  options: GifExportOptions;
  gifencModule?: typeof import('gifenc');
}

export interface ExportEstimate {
  paletteSize: number | null;
  estimatedBytes: number | null;
}

export type ExportResult =
  | {
      kind: 'png';
      filename: string;
      blob: Blob;
    }
  | {
      kind: 'gif';
      filename: string;
      blob: Blob;
      paletteSize: number | null;
    }
  | {
      kind: 'video';
      filename: string;
      blob: Blob;
      mimeType: string;
    }
  | {
      kind: 'webgl';
      filename: string;
      metadata: WebGLExportMetadata;
    };

export type ExportService = {
  runExport: (
    request: ExportRequest,
    onProgress: (progress: ExportProgress) => void,
    signal: AbortSignal
  ) => Promise<ExportResult>;
  estimateExport: (request: ExportEstimateRequest, signal?: AbortSignal) => Promise<ExportEstimate>;
};
