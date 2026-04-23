import type { ProjectSaveSizeReport } from '@/utils/projectIO';

export interface ProjectPreview {
  projectName: string;
  width: number;
  height: number;
  createdAt?: string;
  modifiedAt?: string;
  thumbnail?: string;
  hasEmbeddedThumbnail: boolean;
  fileName: string;
  fileSize: number;
  healthReport?: ProjectSaveSizeReport | null;
  healthWarning?: string | null;
}

export interface DirectoryProjectEntry {
  name: string;
  handle: FileSystemFileHandle;
  lastModified?: number;
}
