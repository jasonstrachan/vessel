import path from 'node:path';

import {
  assertDistinctPackingPaths,
  assertPartialPreviewIsDryRun,
} from '../../../../scripts/cc-shape-pack/pathSafety';

describe('CC shape packing CLI path safety', () => {
  it('rejects output paths that resolve to the input file', () => {
    const input = path.join(process.cwd(), 'artwork.vs');

    expect(() => assertDistinctPackingPaths(input, './artwork.vs')).toThrow(
      expect.objectContaining({ code: 'output-overwrites-input' }),
    );
  });

  it('allows a distinct output path', () => {
    expect(() => assertDistinctPackingPaths('artwork.vs', 'artwork-packed.vs')).not.toThrow();
  });

  it('rejects partial preview mode when an artifact could be written', () => {
    expect(() => assertPartialPreviewIsDryRun(true, false)).toThrow(
      expect.objectContaining({ code: 'partial-preview-requires-dry-run' }),
    );
    expect(() => assertPartialPreviewIsDryRun(true, true)).not.toThrow();
  });
});
