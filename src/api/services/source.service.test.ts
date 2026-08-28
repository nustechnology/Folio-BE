import { Readable } from 'stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sourceRepo = vi.hoisted(() => ({ findById: vi.fn() }));
const spaceRepo = vi.hoisted(() => ({ findByIdAndOwner: vi.fn() }));
const minio = vi.hoisted(() => ({ getObjectStream: vi.fn() }));

vi.mock('~/prisma/repositories/source.repository', () => ({
  default: sourceRepo
}));

vi.mock('~/prisma/repositories/space.repository', () => ({
  default: spaceRepo
}));

vi.mock('~/prisma/repositories/passage.repository', () => ({ default: {} }));
vi.mock('~/prisma/repositories/user.repository', () => ({ default: {} }));

vi.mock('~/api/utils/minio.util', () => ({
  deleteObject: vi.fn(),
  deleteObjectsByPrefix: vi.fn(),
  getObjectStream: minio.getObjectStream,
  isObjectNotFoundError: (error: unknown) =>
    (error as { name?: string } | null)?.name === 'NoSuchKey',
  // The real one strips a leading `<bucket>/`.
  normalizeStoredObjectKey: (key: string) =>
    key.startsWith('folio-sources/') ? key.slice('folio-sources/'.length) : key,
  uploadFile: vi.fn()
}));

vi.mock('~/queues/ingestion.queue', () => ({ enqueueIngestion: vi.fn() }));

vi.mock('~/config/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

import SourceService from '~/api/services/source.service';
import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { generateAccessToken } from '~/api/utils/token.util';

const OWNER = 'owner-1';
const SOURCE_ID = 'a24bc98e-0f1e-4c62-9d3a-7b1f5e2c8d40';
const OTHER_SOURCE_ID = 'b5518f77-1c2d-4e83-8a09-3f6d0b4e7c21';

const fileSource = (overrides: Record<string, unknown> = {}) => ({
  id: SOURCE_ID,
  researchSpaceId: 'space-1',
  sourceType: 'File' as const,
  sourceUrl: `sources/${SOURCE_ID}/paper.pdf`,
  fileName: 'paper.pdf',
  fileType: 'application/pdf',
  ...overrides
});

// The token has to survive a round trip through the query string.
const tokenFrom = (previewUrl: string) =>
  new URL(previewUrl, 'https://folio.example').searchParams.get('token') ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  sourceRepo.findById.mockResolvedValue(fileSource());
  spaceRepo.findByIdAndOwner.mockResolvedValue({ id: 'space-1' });
  minio.getObjectStream.mockResolvedValue({
    stream: Readable.from(['pdf-bytes']),
    contentType: 'application/pdf',
    contentLength: 9
  });
});

describe('getPreviewUrl', () => {
  it('points a File source back at this API, never at object storage', async () => {
    const url = await SourceService.getPreviewUrl(SOURCE_ID, OWNER);

    // The regression: the URL was built from MINIO_ENDPOINT, a
    // container-network host that resolves nowhere in a browser.
    expect(url).not.toContain('minio');
    expect(url).not.toContain(':9000');
    expect(url).toMatch(
      new RegExp(`^/api/v1/sources/${SOURCE_ID}/file\\?token=.+$`)
    );
  });

  it('returns a Web source’s own URL unchanged', async () => {
    sourceRepo.findById.mockResolvedValue({
      id: SOURCE_ID,
      researchSpaceId: 'space-1',
      sourceType: 'Web',
      sourceUrl: 'https://example.com/article'
    });

    await expect(SourceService.getPreviewUrl(SOURCE_ID, OWNER)).resolves.toBe(
      'https://example.com/article'
    );
  });

  it('is refused for a source the caller does not own', async () => {
    spaceRepo.findByIdAndOwner.mockResolvedValue(null);

    await expect(
      SourceService.getPreviewUrl(SOURCE_ID, 'someone-else')
    ).rejects.toMatchObject({ code: ErrorCode.SOURCE_NOT_FOUND });
  });
});

describe('openFile', () => {
  it('streams the stored object for a token minted for that source', async () => {
    const url = await SourceService.getPreviewUrl(SOURCE_ID, OWNER);
    const file = await SourceService.openFile(SOURCE_ID, tokenFrom(url!));

    expect(minio.getObjectStream).toHaveBeenCalledWith(
      `sources/${SOURCE_ID}/paper.pdf`
    );
    expect(file.contentType).toBe('application/pdf');
    expect(file.fileName).toBe('paper.pdf');
  });

  it('strips a bucket-qualified key before reading it', async () => {
    sourceRepo.findById.mockResolvedValue(
      fileSource({ sourceUrl: `folio-sources/sources/${SOURCE_ID}/paper.pdf` })
    );

    const url = await SourceService.getPreviewUrl(SOURCE_ID, OWNER);
    await SourceService.openFile(SOURCE_ID, tokenFrom(url!));

    expect(minio.getObjectStream).toHaveBeenCalledWith(
      `sources/${SOURCE_ID}/paper.pdf`
    );
  });

  it('will not open a different source than the token names', async () => {
    const url = await SourceService.getPreviewUrl(SOURCE_ID, OWNER);

    await expect(
      SourceService.openFile(OTHER_SOURCE_ID, tokenFrom(url!))
    ).rejects.toMatchObject({ code: ErrorCode.SOURCE_NOT_FOUND });
    expect(minio.getObjectStream).not.toHaveBeenCalled();
  });

  it('rejects a token that is not a file token', async () => {
    // Same secret, issuer and audience — only `typ` separates the two.
    const accessToken = generateAccessToken(OWNER, 'owner@example.com', 1);

    await expect(
      SourceService.openFile(SOURCE_ID, accessToken)
    ).rejects.toMatchObject({ code: ErrorCode.TOKEN_INVALID });
  });

  it('rejects a garbage token', async () => {
    await expect(
      SourceService.openFile(SOURCE_ID, 'not-a-token')
    ).rejects.toMatchObject({ code: ErrorCode.TOKEN_INVALID });
  });

  it('reports a missing object as 404 and a storage outage as 502', async () => {
    const url = await SourceService.getPreviewUrl(SOURCE_ID, OWNER);
    const token = tokenFrom(url!);

    minio.getObjectStream.mockRejectedValueOnce(
      Object.assign(new Error('no such key'), { name: 'NoSuchKey' })
    );
    await expect(
      SourceService.openFile(SOURCE_ID, token)
    ).rejects.toMatchObject({ statusCode: 404 });

    minio.getObjectStream.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), {
        name: 'AggregateError'
      })
    );
    const outage = await SourceService.openFile(SOURCE_ID, token).catch(
      (error) => error
    );
    expect(outage).toBeInstanceOf(AppError);
    expect(outage.statusCode).toBe(502);
    // The storage endpoint must not reach the caller.
    expect(outage.message).not.toContain('ECONNREFUSED');
  });
});
