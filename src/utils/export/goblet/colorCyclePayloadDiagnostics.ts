import type { GobletColorCyclePayloadDiagnostic } from '@/utils/export/goblet/colorCyclePayloadValidation';

export const formatGobletColorCycleDiagnostic = (
  diagnostic: GobletColorCyclePayloadDiagnostic
): string => `${diagnostic.code}: ${diagnostic.message}`;

export const formatGobletColorCycleDiagnostics = (
  diagnostics: GobletColorCyclePayloadDiagnostic[]
): string[] => diagnostics.map(formatGobletColorCycleDiagnostic);

export const getUserVisibleGobletColorCycleDiagnostics = (
  diagnostics: GobletColorCyclePayloadDiagnostic[]
): string[] => (
  diagnostics
    .filter((diagnostic) => diagnostic.severity !== 'info')
    .map(formatGobletColorCycleDiagnostic)
);
