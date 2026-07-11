import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CcShapePackingError,
  type CcQuarterTurn,
  type CcShapeSeparationOverride,
} from '@/lib/colorCycle/shapePacking';
import {
  buildContactSheetSvg,
  buildPackingReport,
  buildPackingSvg,
  buildSourceSvg,
} from './diagnostics';
import { packGobletArtifactColorCycleShapes } from './gobletArtifactAdapter';
import { assertDistinctPackingPaths, assertPartialPreviewIsDryRun } from './pathSafety';
import {
  packVsArchiveColorCycleShapes,
  type VsArchiveLayerSelector,
  type VsArchivePackingOptions,
} from './vsArchiveAdapter';

type CliConfig = {
  layers?: VsArchiveLayerSelector[];
  separation?: Record<string, CcShapeSeparationOverride>;
  packing?: {
    padding?: number;
    rotations?: CcQuarterTurn[];
    beamWidth?: number;
    minimumSupportSpanRatio?: number;
  };
};

type ParsedArgs = {
  input: string;
  output?: string;
  configPath?: string;
  layerNames?: string[];
  layerIds?: string[];
  destinationLayerId?: string;
  padding?: number;
  rotations?: CcQuarterTurn[];
  beamWidth?: number;
  splitByGradientDefId: boolean;
  allowNonGravityNesting: boolean;
  allowPartialPreview: boolean;
  allowOverlap: boolean;
  reportDir?: string;
  dryRun: boolean;
};

const usage = (): never => {
  throw new Error([
    'Usage: npm run pack:cc-shapes -- <input.vs|goblet.json|goblet.zip> --output <output> --layers "CC A,CC B"',
    'Options:',
    '  --layer-ids <id-a,id-b>    Select stable layer IDs instead of names.',
    '  --destination-layer-id <id> Consolidate into this selected CC layer.',
    '  --config <config.json>      Load selectors, separation seeds/cuts, and packing options.',
    '  --padding <0|1|...>         Pixel-mask clearance (default 1).',
    '  --rotations <0,90,180,270>  Allowed pixel-perfect rotations.',
    '  --split-by-gradient-def      Best-guess split using CC gradient-definition markers.',
    '  --allow-non-gravity-nesting  Permit collision-free cavity insertion after gravity placement fails.',
    '  --allow-partial-preview      Emit diagnostics for the best incomplete pile; use with --dry-run.',
    '  --allow-overlap              Allow late shapes to overlap in the destination layer.',
    '  --beam-width <n>            Deterministic packing search width.',
    '  --report-dir <path>         JSON/SVG proof output directory.',
    '  --dry-run                   Build reports without writing the packed archive.',
  ].join('\n'));
};

const splitList = (value: string): string[] => value.split(',').map((entry) => entry.trim()).filter(Boolean);

const parseNumber = (value: string | undefined, option: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${option} requires a number.`);
  return parsed;
};

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const input = argv[0];
  if (!input || input.startsWith('--')) usage();
  const parsed: ParsedArgs = {
    input,
    dryRun: false,
    splitByGradientDefId: false,
    allowNonGravityNesting: false,
    allowPartialPreview: false,
    allowOverlap: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case '--output':
        parsed.output = value;
        index += 1;
        break;
      case '--config':
        parsed.configPath = value;
        index += 1;
        break;
      case '--layers':
        parsed.layerNames = splitList(value ?? '');
        index += 1;
        break;
      case '--layer-ids':
        parsed.layerIds = splitList(value ?? '');
        index += 1;
        break;
      case '--destination-layer-id':
        parsed.destinationLayerId = value;
        index += 1;
        break;
      case '--padding':
        parsed.padding = parseNumber(value, arg);
        index += 1;
        break;
      case '--rotations': {
        const rotations = splitList(value ?? '').map((entry) => parseNumber(entry, arg));
        if (rotations.some((rotation) => ![0, 90, 180, 270].includes(rotation))) {
          throw new Error('--rotations accepts only 0,90,180,270.');
        }
        parsed.rotations = rotations as CcQuarterTurn[];
        index += 1;
        break;
      }
      case '--beam-width':
        parsed.beamWidth = parseNumber(value, arg);
        index += 1;
        break;
      case '--split-by-gradient-def':
        parsed.splitByGradientDefId = true;
        break;
      case '--allow-non-gravity-nesting':
        parsed.allowNonGravityNesting = true;
        break;
      case '--allow-partial-preview':
        parsed.allowPartialPreview = true;
        break;
      case '--allow-overlap':
        parsed.allowOverlap = true;
        break;
      case '--report-dir':
        parsed.reportDir = value;
        index += 1;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!parsed.dryRun && !parsed.output) throw new Error('--output is required unless --dry-run is used.');
  return parsed;
};

const loadConfig = async (configPath: string | undefined): Promise<CliConfig> => {
  if (!configPath) return {};
  return JSON.parse(await readFile(configPath, 'utf8')) as CliConfig;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  assertDistinctPackingPaths(args.input, args.output);
  assertPartialPreviewIsDryRun(args.allowPartialPreview, args.dryRun);
  const config = await loadConfig(args.configPath);
  const selectors: VsArchiveLayerSelector[] = [
    ...(config.layers ?? []),
    ...(args.layerIds ?? []).map((id) => ({ id })),
    ...(args.layerNames ?? []).map((name) => ({ name })),
  ];
  const options: VsArchivePackingOptions = {
    selectors,
    destinationLayerId: args.destinationLayerId,
    splitByGradientDefId: args.splitByGradientDefId,
    allowNonGravityNesting: args.allowNonGravityNesting,
    allowPartialPreview: args.allowPartialPreview,
    allowOverlap: args.allowOverlap,
    separationByLayerId: config.separation,
    padding: args.padding ?? config.packing?.padding,
    rotations: args.rotations ?? config.packing?.rotations,
    beamWidth: args.beamWidth ?? config.packing?.beamWidth,
    minimumSupportSpanRatio: config.packing?.minimumSupportSpanRatio,
  };
  const input = new Uint8Array(await readFile(args.input));
  const isVsInput = args.input.toLowerCase().endsWith('.vs');
  const result = isVsInput
    ? await packVsArchiveColorCycleShapes(input, options)
    : await packGobletArtifactColorCycleShapes(input, options);
  const reportDir = args.reportDir ?? `${args.output ?? args.input}.packing-report`;
  await mkdir(reportDir, { recursive: true });
  const reportWrites: Promise<unknown>[] = [
    writeFile(path.join(reportDir, 'packing-report.json'), buildPackingReport(result.packing, result.selectedLayerIds)),
    writeFile(path.join(reportDir, 'packing-preview.svg'), buildPackingSvg(
      result.packing,
      result.canvasWidth,
      result.canvasHeight,
    )),
    writeFile(path.join(reportDir, 'source-preview.svg'), buildSourceSvg(
      result.packing,
      result.canvasWidth,
      result.canvasHeight,
    )),
    writeFile(path.join(reportDir, 'shape-contact-sheet.svg'), buildContactSheetSvg(result.packing)),
  ];
  if ('renderedPreviewPng' in result && result.renderedPreviewPng) {
    reportWrites.push(writeFile(path.join(reportDir, 'packing-preview-rendered.png'), result.renderedPreviewPng));
  }
  await Promise.all(reportWrites);
  if (!args.dryRun && args.output) {
    const output = 'archiveData' in result ? result.archiveData : result.artifactData;
    await writeFile(args.output, output);
  }
  process.stdout.write(`${JSON.stringify({
    output: args.dryRun ? null : args.output,
    reportDir,
    selectedLayerIds: result.selectedLayerIds,
    shapeCount: result.sourceShapeCount,
    metrics: result.packing.metrics,
  }, null, 2)}\n`);
};

main().catch((error: unknown) => {
  if (error instanceof CcShapePackingError) {
    process.stderr.write(`${JSON.stringify({
      error: error.code,
      message: error.message,
      details: error.details,
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
