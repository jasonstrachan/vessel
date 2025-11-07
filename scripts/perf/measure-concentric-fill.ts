import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fillConcentricToBuffer } from '../../src/utils/colorCycle/concentricFillCore';
import { recordColorCycleFillPerf, CC_PERF } from '../../src/utils/perf/ccPerfProbe';

type Point = { x: number; y: number };

type FillMode = 'scanline' | 'block';

type ConcentricProfilingEntry = {
  mode: FillMode;
  width: number;
  height: number;
  area: number;
  vertices: number;
  bands: number;
  cellSize: number;
  ditherEnabled: boolean;
  maskMs: number;
  edtMs: number;
  fillMs: number;
};

type MeasureResult = {
  label: string;
  durationMs: number;
  checksum: number;
  profiling?: ConcentricProfilingEntry | null;
};

const bboxWidth = Number(process.env.CC_BBOX_W ?? 2048);
const bboxHeight = Number(process.env.CC_BBOX_H ?? 1536);
const bbox = { minX: 0, minY: 0, width: bboxWidth, height: bboxHeight }; // default ~3.1M px
const area = bbox.width * bbox.height;

const makePolygon = (sides: number, radius: number): Point[] => {
  const points: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const x = bbox.minX + bbox.width / 2 + Math.cos(theta) * radius;
    const y = bbox.minY + bbox.height / 2 + Math.sin(theta) * radius;
    points.push({ x, y });
  }
  return points;
};

const starPolygon = (): Point[] => {
  const points: Point[] = [];
  const centerX = bbox.width / 2;
  const centerY = bbox.height / 2;
  const outer = Math.min(bbox.width, bbox.height) * 0.45;
  const inner = outer * 0.45;
  for (let i = 0; i < 10; i++) {
    const theta = (i / 10) * Math.PI * 2;
    const radius = i % 2 === 0 ? outer : inner;
    points.push({ x: centerX + Math.cos(theta) * radius, y: centerY + Math.sin(theta) * radius });
  }
  return points;
};

const concavePolygon = (): Point[] => {
  const base = makePolygon(6, Math.min(bbox.width, bbox.height) * 0.45);
  base.splice(2, 0, { x: bbox.width / 2, y: bbox.minY + bbox.height * 0.15 });
  base.splice(5, 0, { x: bbox.width * 0.2, y: bbox.height * 0.65 });
  return base;
};

const spikyPolygon = (): Point[] => {
  const spikes = 64;
  const points: Point[] = [];
  const outer = Math.min(bbox.width, bbox.height) * 0.48;
  const inner = outer * 0.2;
  for (let i = 0; i < spikes; i++) {
    const theta = (i / spikes) * Math.PI * 2;
    const radius = i % 2 === 0 ? outer : inner + ((i % 4 === 1 ? 0.1 : -0.1) * outer);
    const jitter = i % 5 === 0 ? 0.05 * outer : 0;
    points.push({
      x: bbox.width / 2 + Math.cos(theta) * (radius + jitter),
      y: bbox.height / 2 + Math.sin(theta) * (radius + jitter),
    });
  }
  return points;
};

const fixtures: Record<string, Point[]> = {
  decagon: makePolygon(10, Math.min(bbox.width, bbox.height) * 0.48),
  star: starPolygon(),
  concave: concavePolygon(),
  spiky: spikyPolygon(),
};

const baseParams = {
  bbox,
  bands: 24,
  baseOffset: 37,
  maxDist: Math.sqrt(bbox.width ** 2 + bbox.height ** 2) / 2,
  ditherStrength: 0.75,
  ditherPixelSize: 6,
  noiseSeed: 0.42,
};

type Mode = FillMode;

type Options = {
  label: string;
  fixtures: string[] | null;
  modes: Mode[] | null;
};

const parseListArg = (value?: string | null) => {
  if (!value) return null;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
};

const args = process.argv.slice(2);
const options: Options = {
  label: process.env.CC_PERF_LABEL || 'run',
  fixtures: parseListArg(process.env.CC_PERF_FIXTURES),
  modes: parseListArg(process.env.CC_PERF_MODES) as Mode[] | null,
};

for (const arg of args) {
  if (arg.startsWith('--label=')) {
    options.label = arg.slice('--label='.length) || options.label;
  } else if (arg.startsWith('--fixtures=')) {
    options.fixtures = parseListArg(arg.slice('--fixtures='.length));
  } else if (arg.startsWith('--modes=')) {
    options.modes = parseListArg(arg.slice('--modes='.length)) as Mode[] | null;
  }
}

(globalThis as { __VesselConcentricProfiling?: ConcentricProfilingEntry[] }).__VesselConcentricProfiling = [];

async function measure(label: string, vertices: Point[], mode: FillMode): Promise<MeasureResult> {
  const params = {
    ...baseParams,
    vertices,
    ditherEnabled: mode === 'block',
  };
  const t0 = performance.now();
  const profilingBucket = (globalThis as { __VesselConcentricProfiling?: ConcentricProfilingEntry[] }).__VesselConcentricProfiling;
  const beforeLen = profilingBucket?.length ?? 0;
  const buffer = await fillConcentricToBuffer(params);
  const durationMs = performance.now() - t0;
  recordColorCycleFillPerf({
    path: 'worker',
    mode: 'concentric',
    durationMs,
    area,
    vertices: vertices.length,
  });
  let checksum = 0;
  for (let i = 0; i < buffer.length; i += Math.floor(buffer.length / 1024) || 1) {
    checksum = (checksum + buffer[i]) % 65536;
  }
  const profilingEntry = profilingBucket && profilingBucket.length > beforeLen
    ? profilingBucket[profilingBucket.length - 1]
    : null;
  return { label: `${label}-${mode}`, durationMs, checksum, profiling: profilingEntry };
}

(async () => {
  const selectedFixtures = Object.entries(fixtures).filter(([name]) => {
    if (!options.fixtures) return true;
    return options.fixtures.includes(name);
  });
  const selectedModes: Mode[] = options.modes ?? ['scanline', 'block'];
  const results: MeasureResult[] = [];
  // warm-up
  await fillConcentricToBuffer({ ...baseParams, vertices: fixtures.decagon, ditherEnabled: true });

  for (const [name, vertices] of selectedFixtures) {
    for (const mode of selectedModes) {
      results.push(await measure(name, vertices, mode));
    }
  }

  const payload = { area, bbox, options, results, counters: CC_PERF.counters };
  const outDir = path.resolve(__dirname, '../../../results');
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${options.label}.json`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Saved results to ${outPath}`);
})();
