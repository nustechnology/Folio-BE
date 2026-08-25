import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { SpaceSort, UpdateSpaceInput } from '~/api/types/space';
import SpaceService from '~/api/services/space.service';
import { paginatedResponse, successResponse } from '~/api/routes/response';

const list = async (req: Request, res: Response) => {
  const { search, sort, page, limit, archived } = req.query as unknown as {
    search?: string;
    sort: SpaceSort;
    page: number;
    limit: number;
    archived: boolean;
  };
  const { spaces, pagination } = await SpaceService.list(req.userId!, {
    search,
    sort,
    page,
    limit,
    archived
  });

  return paginatedResponse(res, 'spaces', spaces, pagination);
};

const get = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const space = await SpaceService.getById(req.userId!, spaceId);

  return successResponse(res, { space });
};

const create = async (req: Request, res: Response) => {
  const { name, researchObjective } = req.body;
  const space = await SpaceService.create(req.userId!, {
    name,
    researchObjective
  });
  return res
    .status(StatusCodes.CREATED)
    .json({ status: 'success', data: { space } });
};

const update = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const space = await SpaceService.update(
    req.userId!,
    spaceId,
    req.body as UpdateSpaceInput
  );

  return successResponse(res, { space });
};

// 200 with a body rather than 204, so the envelope matches every other route
// and the web client's JSON parsing does not need a special case.
const remove = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  await SpaceService.remove(req.userId!, spaceId);

  return successResponse(res, { deleted: true });
};

export default {
  list,
  get,
  create,
  update,
  remove
};
