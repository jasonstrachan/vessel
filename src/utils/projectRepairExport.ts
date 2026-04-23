import { PROJECT_FILE_EXTENSION } from '@/constants/projectFiles';
import {
  deserializeProjectWithReport,
  getProjectHealthReport,
  readProjectHealthReport,
  saveProjectToFile,
  type ProjectFileData,
  type ProjectHealthReport,
} from '@/utils/projectIO';
import type { ProjectLegacyMigrationSummary } from '@/utils/projectLegacyMigration';
import type { ProjectRepairRecord } from '@/utils/projectLegacyMigrationTypes';

export interface ProjectRepairExportSummary {
  repairCount: number;
  semanticRepairCount: number;
  beforeWarningCount: number;
  afterWarningCount: number;
  headline: string;
  detailLines: string[];
  confirmationMessage: string;
}

export interface ProjectRepairExportResult {
  project: Awaited<ReturnType<typeof deserializeProjectWithReport>>['project'];
  migration: ProjectLegacyMigrationSummary;
  beforeHealth: ProjectHealthReport;
  afterHealth: ProjectHealthReport;
  summary: ProjectRepairExportSummary;
  fileName: string;
  fileHandle: FileSystemFileHandle | null;
}

const buildRepairExportFileName = (fileName: string | null | undefined, projectName: string): string => {
  const baseName = (fileName ?? projectName ?? 'project')
    .replace(/\.(vs|tb)$/i, '')
    .trim();
  const safeBaseName = baseName.length > 0 ? baseName : 'project';
  return `${safeBaseName}-repaired${PROJECT_FILE_EXTENSION}`;
};

const summarizeRepairLines = (repairs: ProjectRepairRecord[]): string[] => {
  if (repairs.length === 0) {
    return ['No semantic legacy repairs were required; this will still save a fresh canonical copy.'];
  }

  return repairs
    .slice(0, 5)
    .map((repair) => repair.message);
};

const buildRepairExportSummary = (
  migration: ProjectLegacyMigrationSummary,
  beforeHealth: ProjectHealthReport,
  afterHealth: ProjectHealthReport,
): ProjectRepairExportSummary => {
  const repairCount = migration.repairs.length;
  const semanticRepairCount = migration.repairs.filter((repair) => repair.semantic).length;
  const detailLines = summarizeRepairLines(migration.repairs);
  const headline = repairCount > 0
    ? `Repair ${repairCount} legacy issue${repairCount === 1 ? '' : 's'} and save a canonical copy?`
    : 'Save a fresh canonical copy of this project?';

  const summaryLines = [
    headline,
    ...detailLines,
    `Warnings before save: ${beforeHealth.warnings.length}`,
    `Warnings after canonical save: ${afterHealth.warnings.length}`,
  ];

  return {
    repairCount,
    semanticRepairCount,
    beforeWarningCount: beforeHealth.warnings.length,
    afterWarningCount: afterHealth.warnings.length,
    headline,
    detailLines,
    confirmationMessage: summaryLines.join('\n'),
  };
};

export async function repairAndExportProject(
  projectData: ProjectFileData,
  options?: {
    fileName?: string | null;
    existingHandle?: FileSystemFileHandle | null;
    confirmWrite?: (summary: ProjectRepairExportSummary) => boolean | Promise<boolean>;
  },
): Promise<ProjectRepairExportResult | null> {
  const beforeHealth = await readProjectHealthReport(projectData);
  const { project, migration } = await deserializeProjectWithReport(projectData);
  const afterHealth = await getProjectHealthReport(project, project.layers);
  const summary = buildRepairExportSummary(migration, beforeHealth, afterHealth);

  if (options?.confirmWrite) {
    const shouldContinue = await options.confirmWrite(summary);
    if (!shouldContinue) {
      return null;
    }
  }

  const suggestedName = buildRepairExportFileName(options?.fileName, project.name);
  const { fileName, fileHandle } = await saveProjectToFile(
    project,
    suggestedName,
    project.layers,
    options?.existingHandle ?? null,
  );

  return {
    project,
    migration,
    beforeHealth,
    afterHealth,
    summary,
    fileName,
    fileHandle,
  };
}
