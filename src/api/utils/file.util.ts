import { ALLOWED_FILE_EXTENSIONS, MIME_TYPE_MAP } from '~/api/utils/constants';

export const getFileExtension = (fileName: string): string | null => {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
    return null;
  }
  return fileName.slice(lastDotIndex + 1).toLowerCase();
};

export const isValidFileExtension = (fileName: string): boolean => {
  const ext = getFileExtension(fileName);
  return (
    ext !== null && (ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(ext)
  );
};

export const getContentType = (fileName: string): string => {
  const ext = getFileExtension(fileName);
  return ext
    ? MIME_TYPE_MAP[ext] || 'application/octet-stream'
    : 'application/octet-stream';
};
