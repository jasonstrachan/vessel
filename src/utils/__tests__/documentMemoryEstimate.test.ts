import {
  DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS,
  describeDocumentMemoryEstimateAssumptions,
  estimateDocumentMemoryUsage,
} from '@/utils/documentMemoryEstimate';

describe('documentMemoryEstimate', () => {
  it('accounts for the complete default editing footprint', () => {
    const estimate = estimateDocumentMemoryUsage(1, 1);

    expect(estimate.assumptions).toEqual(DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS);
    expect(estimate.breakdown).toEqual({
      bitmapSurfacesBytes: 12,
      colorCycleCanonicalBytes: 7,
      masksBytes: 16,
      historyBytes: 7,
      temporaryPublicationBytes: 11,
    });
    expect(estimate.totalBytes).toBe(53);
  });

  it.each([
    ['2048 square', 2048, 2048],
    ['4K', 3840, 2160],
    ['A4 portrait', 2480, 3508],
  ])('uses the byte-level formula for %s', (_label, width, height) => {
    const estimate = estimateDocumentMemoryUsage(width, height);

    expect(estimate.totalBytes).toBe(width * height * 53);
    expect(estimate.breakdown.colorCycleCanonicalBytes).toBe(width * height * 7);
    expect(estimate.breakdown.masksBytes).toBe(width * height * 16);
  });

  it('adds retained patch bytes without double-counting shared document reads', () => {
    const estimate = estimateDocumentMemoryUsage(10, 10, {
      retainedHistoryCanonicalGenerationCount: 0,
      retainedHistoryPatchBytes: 512,
      inFlightCanonicalGenerationCount: 0,
      compositorSurfaceCount: 0,
    });

    expect(estimate.breakdown.historyBytes).toBe(512);
    expect(estimate.breakdown.temporaryPublicationBytes).toBe(0);
    expect(estimate.totalBytes).toBe(1200 + 700 + 1600 + 512);
  });

  it('describes every assumption shown by the Document modal', () => {
    const description = describeDocumentMemoryEstimateAssumptions(
      estimateDocumentMemoryUsage(2048, 2048),
    );

    expect(description).toContain('3 RGBA surfaces');
    expect(description).toContain('1 resident color-cycle layer');
    expect(description).toContain('7 canonical bytes/pixel');
    expect(description).toContain('2 masks with 2 resident representations each');
    expect(description).toContain('1 retained history generation');
    expect(description).toContain('1 in-flight publication generation');
  });
});
