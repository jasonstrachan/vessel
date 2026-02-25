import type {
  ConcentricFillJob,
  ConcentricFillResult,
  PerceptualDitherJob,
  PerceptualDitherResult,
} from '@/workers/colorCycleFillTypes';

const createBuffer = (length: number): ArrayBuffer => {
  const safeLength = Number.isFinite(length) && length > 0 ? Math.ceil(length) : 1;
  return new ArrayBuffer(safeLength);
};

export const runPerceptualDitherJob = async (
  job: PerceptualDitherJob
): Promise<PerceptualDitherResult> => {
  const pixelCount = job.width * job.height;
  return {
    width: job.width,
    height: job.height,
    indices: createBuffer(pixelCount),
  };
};

export const runConcentricFillJob = async (
  job: ConcentricFillJob
): Promise<ConcentricFillResult> => {
  const { width, height } = job.bbox;
  return {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    indices: createBuffer(width * height),
  };
};
