/**
 * @jest-environment node
 */

import path from 'path';
import { Worker } from 'worker_threads';
import type { ColorCycleFillJob, ConcentricFillJob } from '@/workers/colorCycleFillTypes';

jest.setTimeout(15000);

type WorkerResponse = {
  id: number;
  ok: boolean;
  type: string;
  result?: { width: number; height: number; indices: ArrayBuffer };
  error?: string;
};

const workerHarness = path.resolve(__dirname, './workerHarness.ts');
const workerEntry = path.resolve(__dirname, '../colorCycleFill.worker.ts');

const runWorkerJob = (job: ColorCycleFillJob): Promise<WorkerResponse> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerHarness, {
      execArgv: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'],
      env: {
        ...process.env,
        TS_NODE_PROJECT: path.resolve(__dirname, '../../../tsconfig.jest.json'),
      },
      workerData: {
        entry: workerEntry,
      },
    });

    worker.once('message', (message: WorkerResponse) => {
      worker.terminate().catch(() => {});
      resolve(message);
    });

    worker.once('error', (error) => {
      worker.terminate().catch(() => {});
      reject(error);
    });

    worker.postMessage({ id: Date.now(), job });
  });
};

describe('colorCycleFill worker contract', () => {
  it('returns concentric fill results with transferable buffers', async () => {
    const job: ConcentricFillJob = {
      type: 'concentric-fill',
      vertices: new Float32Array([
        0, 0,
        8, 0,
        0, 8,
      ]),
      bbox: { minX: 0, minY: 0, width: 8, height: 8 },
      bands: 4,
      baseOffset: 0,
      maxDist: 12,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 42,
    };

    const response = await runWorkerJob(job);

    expect(response.ok).toBe(true);
    expect(response.type).toBe('concentric-fill');
    expect(response.result).toBeTruthy();
    expect(response.result?.width).toBe(job.bbox.width);
    expect(response.result?.height).toBe(job.bbox.height);
    expect(response.result?.indices.byteLength).toBe(job.bbox.width * job.bbox.height);
  });

  it('rejects unsupported job types with an error payload', async () => {
    const response = await runWorkerJob({
      type: 'unknown-type' as ColorCycleFillJob['type'],
    } as ColorCycleFillJob);

    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/Unknown colorCycle fill job/);
  });
});
