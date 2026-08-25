import { beforeEach, describe, expect, it, vi } from 'vitest';

const sourceRepo = vi.hoisted(() => ({ findStorageRefsBySpaceId: vi.fn() }));
const spaceRepo = vi.hoisted(() => ({
  findByNameAndOwner: vi.fn(),
  update: vi.fn(),
  deleteWithChildren: vi.fn()
}));
const access = vi.hoisted(() => ({ assertSpaceAccess: vi.fn() }));
const minio = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  deleteObjectsByPrefix: vi.fn()
}));

vi.mock('~/prisma/repositories/source.repository', () => ({
  default: sourceRepo
}));

vi.mock('~/prisma/repositories/space.repository', () => ({
  default: spaceRepo
}));

vi.mock('~/api/services/space-access', () => ({
  assertSpaceAccess: access.assertSpaceAccess
}));

vi.mock('~/api/utils/minio.util', () => ({
  deleteObject: minio.deleteObject,
  deleteObjectsByPrefix: minio.deleteObjectsByPrefix,
  // The real implementation only strips a `<bucket>/` prefix; the keys these
  // tests pass carry none, so identity is the faithful stand-in.
  normalizeStoredObjectKey: (key: string) => key
}));

vi.mock('~/config/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

import SpaceService, {
  buildSpaceUpdateData,
  isNameTakenByAnother
} from '~/api/services/space.service';
import { ErrorCode } from '~/api/errors/error-codes';
import { STORAGE_CLEANUP_CONCURRENCY } from '~/api/utils/constants';

const OWNER = 'owner-1';
const SPACE = 'space-1';

const fileSource = (id: string) => ({
  id,
  sourceType: 'File' as const,
  sourceUrl: `sources/${id}/original.pdf`
});

beforeEach(() => {
  vi.clearAllMocks();
  access.assertSpaceAccess.mockResolvedValue({ id: SPACE, ownerId: OWNER });
  sourceRepo.findStorageRefsBySpaceId.mockResolvedValue([]);
  spaceRepo.findByNameAndOwner.mockResolvedValue(null);
  spaceRepo.update.mockResolvedValue({ id: SPACE });
  spaceRepo.deleteWithChildren.mockResolvedValue(undefined);
  minio.deleteObject.mockResolvedValue(undefined);
  minio.deleteObjectsByPrefix.mockResolvedValue(undefined);
});

describe('buildSpaceUpdateData — partial update', () => {
  it('writes only the fields that were sent', () => {
    expect(buildSpaceUpdateData({ name: 'Renamed' })).toEqual({
      name: 'Renamed'
    });
  });

  it('leaves an omitted field absent rather than undefined, so Prisma does not touch the column', () => {
    const data = buildSpaceUpdateData({ researchObjective: 'New objective' });

    expect('name' in data).toBe(false);
    expect('isArchived' in data).toBe(false);
  });

  // The distinction the `!== undefined` check exists for: '' is a real edit
  // (the user cleared the objective), not an absent field.
  it('keeps an explicitly emptied objective', () => {
    expect(buildSpaceUpdateData({ researchObjective: '' })).toEqual({
      researchObjective: ''
    });
  });

  it('keeps isArchived: false, which a falsy check would drop', () => {
    expect(buildSpaceUpdateData({ isArchived: false })).toEqual({
      isArchived: false
    });
  });

  it('trims name and objective the way create does', () => {
    expect(
      buildSpaceUpdateData({ name: '  Spaced  ', researchObjective: '  Why  ' })
    ).toEqual({ name: 'Spaced', researchObjective: 'Why' });
  });

  // The validator rejects an empty body before this runs; this only pins that
  // an empty input cannot become a destructive write.
  it('produces no writes for an empty input', () => {
    expect(buildSpaceUpdateData({})).toEqual({});
  });
});

describe('isNameTakenByAnother — rename collision', () => {
  it('is a collision when another space already holds the name', () => {
    expect(isNameTakenByAnother({ id: 'other-space' }, 'this-space')).toBe(
      true
    );
  });

  // The bug this endpoint invites: the name lookup finds the space being
  // renamed and reports 409 against itself.
  it('is not a collision when the match is the space being updated', () => {
    expect(isNameTakenByAnother({ id: 'this-space' }, 'this-space')).toBe(
      false
    );
  });

  it('is not a collision when nothing holds the name', () => {
    expect(isNameTakenByAnother(null, 'this-space')).toBe(false);
  });
});

describe('update — rename collision', () => {
  it('does not 409 when the only match is the space being renamed', async () => {
    spaceRepo.findByNameAndOwner.mockResolvedValue({ id: SPACE });

    await expect(
      SpaceService.update(OWNER, SPACE, { name: 'Same Name' })
    ).resolves.toEqual({ id: SPACE });
    expect(spaceRepo.update).toHaveBeenCalledOnce();
  });

  it('409s and writes nothing when another space holds the name', async () => {
    spaceRepo.findByNameAndOwner.mockResolvedValue({ id: 'other-space' });

    await expect(
      SpaceService.update(OWNER, SPACE, { name: 'Taken' })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ErrorCode.SPACE_NAME_EXISTS
    });
    expect(spaceRepo.update).not.toHaveBeenCalled();
  });

  it('skips the name lookup entirely when no name was sent', async () => {
    await SpaceService.update(OWNER, SPACE, { isArchived: true });

    expect(spaceRepo.findByNameAndOwner).not.toHaveBeenCalled();
    expect(spaceRepo.update).toHaveBeenCalledWith(SPACE, OWNER, {
      isArchived: true
    });
  });
});

describe('remove — storage purge', () => {
  it('deletes the stored file and the media prefix of a file source', async () => {
    sourceRepo.findStorageRefsBySpaceId.mockResolvedValue([
      fileSource('source-a')
    ]);

    await expect(SpaceService.remove(OWNER, SPACE)).resolves.toEqual({
      deleted: true
    });
    expect(minio.deleteObject).toHaveBeenCalledWith(
      'sources/source-a/original.pdf'
    );
    expect(minio.deleteObjectsByPrefix).toHaveBeenCalledWith(
      'sources/source-a/media/'
    );
    expect(spaceRepo.deleteWithChildren).toHaveBeenCalledWith(SPACE);
  });

  // A Web or Manual source has no uploaded file, but extraction may still have
  // stored images for it — the prefix purge is not conditional.
  it('skips the file delete for a non-file source but still purges its media', async () => {
    sourceRepo.findStorageRefsBySpaceId.mockResolvedValue([
      { id: 'source-web', sourceType: 'Web', sourceUrl: 'https://example.com' },
      { id: 'source-manual', sourceType: 'Manual', sourceUrl: null }
    ]);

    await SpaceService.remove(OWNER, SPACE);

    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(minio.deleteObjectsByPrefix).toHaveBeenCalledTimes(2);
    expect(spaceRepo.deleteWithChildren).toHaveBeenCalledOnce();
  });

  // The promise the docblock and the OpenAPI description both make: a storage
  // failure leaves the space intact. An earlier revision swallowed it and
  // deleted the rows anyway, which is the opposite of what was documented.
  it('aborts the delete when the stored file cannot be removed', async () => {
    sourceRepo.findStorageRefsBySpaceId.mockResolvedValue([
      fileSource('source-a')
    ]);
    minio.deleteObject.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(SpaceService.remove(OWNER, SPACE)).rejects.toMatchObject({
      statusCode: 503,
      code: ErrorCode.STORAGE_CLEANUP_FAILED
    });
    expect(spaceRepo.deleteWithChildren).not.toHaveBeenCalled();
  });

  it('aborts the delete when the media prefix cannot be removed', async () => {
    sourceRepo.findStorageRefsBySpaceId.mockResolvedValue([
      { id: 'source-web', sourceType: 'Web', sourceUrl: null }
    ]);
    minio.deleteObjectsByPrefix.mockRejectedValue(
      new Error('Failed to delete 3 object(s) under a prefix')
    );

    await expect(SpaceService.remove(OWNER, SPACE)).rejects.toMatchObject({
      code: ErrorCode.STORAGE_CLEANUP_FAILED
    });
    expect(spaceRepo.deleteWithChildren).not.toHaveBeenCalled();
  });

  it('does not touch storage at all for a space with no sources', async () => {
    await SpaceService.remove(OWNER, SPACE);

    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(minio.deleteObjectsByPrefix).not.toHaveBeenCalled();
    expect(spaceRepo.deleteWithChildren).toHaveBeenCalledOnce();
  });

  it('reads nothing and deletes nothing when ownership fails', async () => {
    access.assertSpaceAccess.mockRejectedValue(new Error('not found'));

    await expect(SpaceService.remove(OWNER, SPACE)).rejects.toThrow(
      'not found'
    );
    expect(sourceRepo.findStorageRefsBySpaceId).not.toHaveBeenCalled();
    expect(spaceRepo.deleteWithChildren).not.toHaveBeenCalled();
  });
});

describe('remove — batching', () => {
  const sources = Array.from(
    { length: STORAGE_CLEANUP_CONCURRENCY * 2 + 3 },
    (_, i) => fileSource(`source-${i}`)
  );

  it('purges every source across more than one batch', async () => {
    sourceRepo.findStorageRefsBySpaceId.mockResolvedValue(sources);

    await SpaceService.remove(OWNER, SPACE);

    expect(minio.deleteObject).toHaveBeenCalledTimes(sources.length);
    expect(minio.deleteObjectsByPrefix).toHaveBeenCalledTimes(sources.length);
  });

  // Batches run in sequence so a storage outage stops early rather than firing
  // a purge for every source in a large corpus before giving up.
  it('stops after the failing batch instead of purging the rest', async () => {
    sourceRepo.findStorageRefsBySpaceId.mockResolvedValue(sources);
    minio.deleteObject.mockRejectedValue(new Error('storage down'));

    await expect(SpaceService.remove(OWNER, SPACE)).rejects.toMatchObject({
      code: ErrorCode.STORAGE_CLEANUP_FAILED
    });
    expect(minio.deleteObject.mock.calls.length).toBeLessThanOrEqual(
      STORAGE_CLEANUP_CONCURRENCY
    );
  });
});
