import type { FieldGeneratorResult, StrokeJob } from '../types';

export interface StrokePipelineOptions {
  priority: 'preview' | 'final';
  color?: string;
}

export interface StrokePipelineResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  origin: { x: number; y: number };
  release(): void;
}

export class StrokePipeline {
  async render(
    _job: StrokeJob,
    _field: FieldGeneratorResult | null,
    _options: StrokePipelineOptions
  ): Promise<StrokePipelineResult | null> {
    void _job;
    void _field;
    void _options;
    return null;
  }

  dispose(): void {
    // No-op
  }
}

let pipelineInstance: StrokePipeline | null = null;

export const getStrokePipeline = (): StrokePipeline => {
  if (!pipelineInstance) {
    pipelineInstance = new StrokePipeline();
  }
  return pipelineInstance;
};

export const disposeStrokePipeline = (): void => {
  pipelineInstance?.dispose();
  pipelineInstance = null;
};
