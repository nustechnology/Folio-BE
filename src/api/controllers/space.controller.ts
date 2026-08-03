import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { SpaceSort } from '~/api/types/space';
import SpaceService from '~/api/services/space.service';
import { paginatedResponse } from '~/api/routes/response';

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

export default {
  list,
  create
};
