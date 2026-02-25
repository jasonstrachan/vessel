import {
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_MIME_ACCEPT,
} from '@/constants/projectFiles';

const ACCEPTED_EXTENSIONS = new Set(
  PROJECT_FILE_ACCEPT.map((ext) => ext.toLowerCase()),
);

const ACCEPTED_MIME_TYPES = new Set(
  PROJECT_FILE_MIME_ACCEPT.map((mime) => mime.toLowerCase()),
);

export const FILE_INPUT_ACCEPT_ATTRIBUTE = [...PROJECT_FILE_ACCEPT, ...PROJECT_FILE_MIME_ACCEPT].join(',');

export const hasSupportedExtension = (fileName: string) => {
  const lower = fileName.toLowerCase();
  for (const ext of ACCEPTED_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
};

export const isAcceptableFile = (file: File | null | undefined): file is File => {
  if (!file) {
    return false;
  }
  if (hasSupportedExtension(file.name)) {
    return true;
  }
  const mime = file.type?.toLowerCase() ?? '';
  return mime !== '' && ACCEPTED_MIME_TYPES.has(mime);
};

export const extractFileFromItems = (items: DataTransferItemList | null | undefined): File | null => {
  if (!items || items.length === 0) {
    return null;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'file') {
      continue;
    }
    const file = item.getAsFile();
    if (isAcceptableFile(file)) {
      return file;
    }
  }
  return null;
};

export const findAcceptableFile = (fileList: FileList | null | undefined): File | null => {
  if (!fileList || fileList.length === 0) {
    return null;
  }
  for (const file of Array.from(fileList)) {
    if (isAcceptableFile(file)) {
      return file;
    }
  }
  return null;
};

