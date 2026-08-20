import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({ findReusableExtraction: vi.fn() }));
const minio = vi.hoisted(() => ({ downloadObject: vi.fn() }));
const parser = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock('~/prisma/repositories/source.repository', () => ({
  default: { findReusableExtraction: repo.findReusableExtraction }
}));

vi.mock('~/api/utils/minio.util', () => ({
  downloadObject: minio.downloadObject,
  normalizeStoredObjectKey: (key: string) => key
}));

vi.mock('~/api/services/parse.service', () => ({
  default: { parse: parser.parse }
}));

vi.mock('~/api/services/media.service', () => ({
  createMediaSink: () => async (): Promise<string | null> => null
}));

import { extract } from '~/api/services/extraction.service';

const PDF_MIME = 'application/pdf';

const input = (overrides: Record<string, unknown> = {}) => ({
  sourceId: 'source-new',
  sourceType: 'File' as const,
  sourceUrl: 'sources/abc/report.pdf',
  fileType: PDF_MIME,
  fileHash: 'hash-1',
  ...overrides
});

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'source-old',
  sourceUrl: 'sources/xyz/report.pdf',
  fileType: PDF_MIME,
  content: '[page 1]\nStored table text',
  structuredContent: { type: 'document', html: '<p>Stored</p>' },
  pageCount: 12,
  characterCount: 999,
  ...overrides
});

describe('extract — reusing an identical file', () => {
  beforeEach(() => {
    repo.findReusableExtraction.mockReset();
    minio.downloadObject.mockReset();
    parser.parse.mockReset();
    repo.findReusableExtraction.mockResolvedValue(null);
    minio.downloadObject.mockResolvedValue(Buffer.from('%PDF-1.7'));
    parser.parse.mockResolvedValue({
      content: 'freshly parsed',
      structuredContent: { type: 'document', html: '<p>Fresh</p>' },
      pageCount: 12
    });
  });

  it('returns the stored extraction without downloading or parsing', async () => {
    repo.findReusableExtraction.mockResolvedValue(stored());

    const result = await extract(input());

    expect(minio.downloadObject).not.toHaveBeenCalled();
    expect(parser.parse).not.toHaveBeenCalled();
    expect(result.content).toBe('[page 1]\nStored table text');
    expect(result.pageCount).toBe(12);
  });

  it('recomputes characterCount rather than trusting the stored one', async () => {
    repo.findReusableExtraction.mockResolvedValue(stored());

    const result = await extract(input());

    expect(result.characterCount).toBe('[page 1]\nStored table text'.length);
  });

  it('does not carry the previous title or author across', async () => {
    repo.findReusableExtraction.mockResolvedValue(
      stored({ title: 'A title its uploader typed', author: 'Someone else' })
    );

    const result = await extract(input());

    expect(result.title).toBeUndefined();
    expect(result.author).toBeUndefined();
  });

  it('parses instead when the same bytes were read as another format', async () => {
    // Identical bytes, but stored as CSV — a different parser, so a different
    // result. The checksum matching is not enough on its own.
    repo.findReusableExtraction.mockResolvedValue(
      stored({ sourceUrl: 'sources/xyz/report.csv', fileType: 'text/csv' })
    );

    const result = await extract(input());

    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('freshly parsed');
  });

  it('parses instead when the stored HTML points at its own media', async () => {
    repo.findReusableExtraction.mockResolvedValue(
      stored({
        structuredContent: {
          type: 'document',
          html: '<img src="/api/v1/sources/source-old/media/abc.png"/>'
        }
      })
    );

    const result = await extract(input());

    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('freshly parsed');
  });

  // `yarn reingest --reextract` exists to rebuild stored text under a changed
  // parser. A partial run — one space, say — leaves an untouched sibling with
  // the same checksum still marked ready, and reusing it would undo the run.
  it('parses instead when the caller forces a reparse', async () => {
    repo.findReusableExtraction.mockResolvedValue(stored());

    const result = await extract(input({ forceReparse: true }));

    expect(repo.findReusableExtraction).not.toHaveBeenCalled();
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('freshly parsed');
  });

  it('does not look for a twin when the file has no checksum', async () => {
    await extract(input({ fileHash: null }));

    expect(repo.findReusableExtraction).not.toHaveBeenCalled();
    expect(parser.parse).toHaveBeenCalledTimes(1);
  });

  it('parses normally when nothing identical has been ingested', async () => {
    const result = await extract(input());

    expect(repo.findReusableExtraction).toHaveBeenCalledWith({
      sourceId: 'source-new',
      fileHash: 'hash-1'
    });
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('freshly parsed');
  });
});
