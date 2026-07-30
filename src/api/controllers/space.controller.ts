import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import SpaceService from '~/api/services/space.service';
import { successResponse } from '~/api/routes/response';

const list = async (req: Request, res: Response) => {
  const { search, sort } = req.query as { search?: string; sort: any };
  const spaces = await SpaceService.list(req.userId!, { search, sort });

  return successResponse(res, { spaces });
};

const create = async (req: Request, res: Response) => {
  const { name, researchObjective } = req.body;
  const space = await SpaceService.create(req.userId!, { name, researchObjective });
  return res.status(StatusCodes.CREATED).json({ status: 'success', data: { space } });
};

export default {
  list,
  create,
};
