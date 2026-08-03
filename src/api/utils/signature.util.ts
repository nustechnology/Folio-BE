import crypto from 'crypto';
import fs from 'fs';

import { getFileExtension } from '~/api/utils/file.util';

// File signature + checksum validation (technical proposal step 3).
//
// The multer middleware only checks the filename extension, which is easy to
// spoof (rename virus.exe → paper.pdf). `verifyFileSignature` reads the file's
// magic bytes with `file-type` and confirms the actual format matches the
// extension before the file is stored.

// Only these formats have reliable magic bytes; txt/md/csv are plain text with
// no header to check, so signature validation is skipped for them.
const SIGNATURABLE_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'epub'
]);

const EXPECTED_MIMES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  epub: ['application/epub+zip']
};

export type SignatureCheckResult = {
  valid: boolean;
  detectedMime?: string;
};

// Verify the file at filePath really matches its filename extension.
// If `file-type` can't detect a type (or the format isn't signaturable), we
// accept it — the extension filter already ran in multer.
export const verifyFileSignature = async (
  filePath: string,
  fileName: string
): Promise<SignatureCheckResult> => {
  const ext = getFileExtension(fileName);
  if (!ext || !SIGNATURABLE_EXTENSIONS.has(ext)) {
    return { valid: true };
  }

  // file-type is ESM-only, hence the dynamic import from CommonJS.
  const { fileTypeFromFile } = await import('file-type');
  const result = await fileTypeFromFile(filePath);
  if (!result) {
    return { valid: true };
  }

  const expected = EXPECTED_MIMES[ext] ?? [];
  return {
    valid: expected.includes(result.mime),
    detectedMime: result.mime
  };
};

// SHA-256 hash of a file, streamed so it never buffers the whole file in memory
// (important for files up to the 50 MB limit). Used for integrity + dedup.
export const computeFileHash = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};
