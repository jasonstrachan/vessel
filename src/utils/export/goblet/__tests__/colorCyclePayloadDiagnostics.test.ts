import {
  formatGobletColorCycleDiagnostics,
  getUserVisibleGobletColorCycleDiagnostics,
} from '@/utils/export/goblet/colorCyclePayloadDiagnostics';

describe('colorCyclePayloadDiagnostics', () => {
  const diagnostics = [
    {
      code: 'hydrated-export-local-archive-state',
      severity: 'info' as const,
      message: 'Color-cycle archive data was materialized into an export-local layer snapshot.',
    },
    {
      code: 'missing-color-cycle-document',
      severity: 'info' as const,
      message: 'No color-cycle document is available for Goblet export.',
    },
    {
      code: 'missing-archive-ref',
      severity: 'warning' as const,
      message: 'stale archive ref',
    },
    {
      code: 'missing-required-buffer',
      severity: 'error' as const,
      message: 'indexBuffer is required.',
    },
  ];

  it('keeps full diagnostic context for failure display', () => {
    expect(formatGobletColorCycleDiagnostics(diagnostics)).toEqual([
      'hydrated-export-local-archive-state: Color-cycle archive data was materialized into an export-local layer snapshot.',
      'missing-color-cycle-document: No color-cycle document is available for Goblet export.',
      'missing-archive-ref: stale archive ref',
      'missing-required-buffer: indexBuffer is required.',
    ]);
  });

  it('hides info diagnostics from user-facing successful export diagnostics', () => {
    expect(getUserVisibleGobletColorCycleDiagnostics(diagnostics)).toEqual([
      'missing-archive-ref: stale archive ref',
      'missing-required-buffer: indexBuffer is required.',
    ]);
  });
});
