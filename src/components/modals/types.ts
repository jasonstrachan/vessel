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
}

export interface DirectoryProjectEntry {
  name: string;
  handle: FileSystemFileHandle;
  lastModified?: number;
}

