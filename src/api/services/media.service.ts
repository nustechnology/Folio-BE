// Images extracted from inside a document (DOCX figures, EPUB illustrations).
// They go to object storage rather than inline data: URIs, which would push
// megabytes of base64 through the database on every read. Keys are content
// hashes, so duplicates store once and re-ingestion overwrites in place.
import crypto from 'crypto';

import { getObjectStream, uploadBuffer } from '~/api/utils/minio.util';
import logger from '~/config/logger';

// Persists one embedded binary and returns the URL to reference it by.
export type MediaSink = (
  data: Buffer,
  contentType: string
) => Promise<string | null>;

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
  'image/x-emf': 'emf',
  'image/x-wmf': 'wmf'
};

// SVG is excluded deliberately: it can carry script, and serving one from our
// own origin would give an uploaded file a same-origin foothold.
const SERVABLE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp'
]);

const MEDIA_FILE_NAME = /^[0-9a-f]{32}\.[a-z0-9]{2,4}$/;

export const isValidMediaFileName = (fileName: string): boolean =>
  MEDIA_FILE_NAME.test(fileName);

export const mediaPrefix = (sourceId: string): string =>
  `sources/${sourceId}/media/`;

export const mediaObjectKey = (sourceId: string, fileName: string): string =>
  `${mediaPrefix(sourceId)}${fileName}`;

// Relative on purpose: the API host differs per environment, so the client
// resolves it rather than us baking a hostname into long-lived rows.
export const mediaUrl = (sourceId: string, fileName: string): string =>
  `/api/v1/sources/${sourceId}/media/${fileName}`;

// Returns null for media it declines to store, so callers drop the <img> and
// keep the rest of the document.
export const createMediaSink = (sourceId: string): MediaSink => {
  return async (data: Buffer, contentType: string): Promise<string | null> => {
    const mime = contentType.split(';')[0].trim().toLowerCase();

    if (!SERVABLE_MIME_TYPES.has(mime)) {
      logger.debug('[Media] Skipping embedded media of unsupported type', {
        sourceId,
        contentType: mime
      });
      return null;
    }

    if (data.length === 0 || data.length > MAX_MEDIA_BYTES) {
      logger.warn('[Media] Skipping embedded media outside the size limit', {
        sourceId,
        bytes: data.length,
        limit: MAX_MEDIA_BYTES
      });
      return null;
    }

    const digest = crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .slice(0, 32);
    const fileName = `${digest}.${EXTENSION_BY_MIME[mime] ?? 'bin'}`;

    try {
      await uploadBuffer(mediaObjectKey(sourceId, fileName), data, mime);
    } catch (error) {
      logger.error('[Media] Failed to store embedded media', {
        sourceId,
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }

    return mediaUrl(sourceId, fileName);
  };
};

// Read one stored media file back for the reader.
export const openMedia = async (sourceId: string, fileName: string) => {
  return getObjectStream(mediaObjectKey(sourceId, fileName));
};

export default {
  createMediaSink,
  isValidMediaFileName,
  mediaPrefix,
  mediaUrl,
  openMedia
};
