import path from 'node:path';

import { CcShapePackingError } from '@/lib/colorCycle/shapePacking';

export const assertDistinctPackingPaths = (inputPath: string, outputPath: string | undefined): void => {
  if (!outputPath) return;
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedInput === resolvedOutput) {
    throw new CcShapePackingError(
      'output-overwrites-input',
      'The packed output path resolves to the input file. Choose a separate output path.',
      { inputPath: resolvedInput, outputPath: resolvedOutput },
    );
  }
};

export const assertPartialPreviewIsDryRun = (
  allowPartialPreview: boolean,
  dryRun: boolean,
): void => {
  if (!allowPartialPreview || dryRun) return;
  throw new CcShapePackingError(
    'partial-preview-requires-dry-run',
    '--allow-partial-preview is diagnostics-only and requires --dry-run.',
  );
};
