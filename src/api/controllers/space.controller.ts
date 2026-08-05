import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { SpaceSort } from '~/api/types/space';
import SpaceService from '~/api/services/space.service';
import { paginatedResponse, successResponse } from '~/api/routes/response';

const list = async (req: Request, res: Response) => {
  const { search, sort, page, limit } = req.query as unknown as {
    search?: string;
    sort: SpaceSort;
    page: number;
    limit: number;
  };
  const { spaces, pagination } = await SpaceService.list(req.userId!, {
    search,
    sort,
    page,
    limit
  });

  return paginatedResponse(res, 'spaces', spaces, pagination);
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
  const { id } = req.params;
  const { name, researchObjective } = req.body;
  const space = await SpaceService.update(req.userId!, id, {
    name,
    researchObjective
  });

  return successResponse(res, { space });
};

const remove = async (req: Request, res: Response) => {
  const { id } = req.params;
  await SpaceService.remove(req.userId!, id);

  return successResponse(res, { success: true });
};

const get = async (req: Request, res: Response) => {
  const { id } = req.params;
  const space = await SpaceService.get(req.userId!, id);

  return successResponse(res, { space });
};

export default {
  list,
  create,
  update,
  remove,
  get
};
